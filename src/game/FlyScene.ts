import Phaser from "phaser";
import type { CalibrationProfile } from "../calibration";
import { EffortMapper, TRAINER_VELOCITY_RESPONSE_MS, trainerAltitudeVelocity } from "../effort";
import type { LevelId } from "../levels";
import { emitGameEvent, gameEvents } from "./events";
import {
  hillGradePercent,
  hillTargetSpeed,
  hillTerrainDerivative,
  hillTerrainY,
} from "./hill-physics";

type ObstaclePair = {
  top: Phaser.GameObjects.Rectangle;
  bottom: Phaser.GameObjects.Rectangle;
  topCap: Phaser.GameObjects.Rectangle;
  bottomCap: Phaser.GameObjects.Rectangle;
  scored: boolean;
};

type AsteroidObstacle = {
  body: Phaser.GameObjects.Container;
  radius: number;
  spin: number;
  scored: boolean;
};

type RaceRival = {
  body: Phaser.GameObjects.Container;
  startProgress: number;
  progress: number;
  lane: number;
  speed: number;
};

type StartRunDetail = {
  profile: CalibrationProfile;
  demo: boolean;
  mode: "game" | "trace";
  levelId: LevelId;
};

export type TrajectoryPoint = {
  elapsedMs: number;
  y: number;
  velocityY: number;
  targetVelocityY: number;
};

const WIDTH = 320;
const HEIGHT = 180;
const PLAYER_X = 65;
const PLAYER_WIDTH = 66;
const PLAYER_HEIGHT = 44;
const PITCH_STEP = Phaser.Math.DegToRad(2);
const HILL_PLAYER_X = 76;
const TRACK_CONTROL_POINTS = [
  { x: 55, y: 143 },
  { x: 125, y: 148 },
  { x: 171, y: 126 },
  { x: 238, y: 143 },
  { x: 286, y: 119 },
  { x: 270, y: 78 },
  { x: 221, y: 66 },
  { x: 195, y: 33 },
  { x: 130, y: 31 },
  { x: 94, y: 55 },
  { x: 45, y: 43 },
  { x: 28, y: 83 },
  { x: 38, y: 119 },
] as const;

export class FlyScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Ellipse;
  private skyBackdrop!: Phaser.GameObjects.Container;
  private spaceBackdrop!: Phaser.GameObjects.Container;
  private racerBackdrop!: Phaser.GameObjects.Container;
  private hillBackdrop!: Phaser.GameObjects.Container;
  private clouds: Phaser.GameObjects.Ellipse[] = [];
  private stars: Phaser.GameObjects.Rectangle[] = [];
  private racerPlayer!: Phaser.GameObjects.Container;
  private hillPlayer!: Phaser.GameObjects.Container;
  private hillFarTerrain!: Phaser.GameObjects.Graphics;
  private hillMidTerrain!: Phaser.GameObjects.Graphics;
  private hillGround!: Phaser.GameObjects.Graphics;
  private raceRivals: RaceRival[] = [];
  private obstacles: ObstaclePair[] = [];
  private asteroids: AsteroidObstacle[] = [];
  private mapper?: EffortMapper;
  private powerW = 0;
  private lastTelemetryAt = 0;
  private velocityY = 0;
  private running = false;
  private pausedForSignal = false;
  private elapsed = 0;
  private spawnElapsed = 0;
  private score = 0;
  private velocityResponseMs = 350;
  private mode: "game" | "trace" = "game";
  private rawPlayerY = 88;
  private lastTrajectoryAt = 0;
  private trainerRun = false;
  private levelId: LevelId = "ornithopter-run";
  private racerProgress = 0;
  private racerSpeed = 0;
  private racerLane = 0;
  private racerHardPowerW = 260;
  private hillDistance = 0;
  private hillSpeed = 0;
  private hillStallElapsed = 0;
  private hillHardPowerW = 260;
  private lastTerrainGradeAt = 0;

  constructor() {
    super("fly");
  }

  preload(): void {
    this.load.image("ornithopter", "assets/ornithopter.png");
  }

  create(): void {
    this.cameras.main
      .setBounds(0, 0, WIDTH, HEIGHT)
      .setZoom(3)
      .centerOn(WIDTH / 2, HEIGHT / 2);
    // The generated sprite contains much finer detail than the logical game grid.
    // Linear filtering avoids nearest-neighbor shimmer while it is pitched in flight.
    this.textures.get("ornithopter").setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.createBackdrops();
    this.shadow = this.add.ellipse(PLAYER_X, 158, 38, 5, 0x553a2c, 0.16);
    this.player = this.add
      .image(PLAYER_X, 88, "ornithopter")
      .setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT);
    this.player.setOrigin(0.5);
    this.createRaceCars();
    this.createHillBike();
    this.setBackdrop("ornithopter-run");

    gameEvents.addEventListener("start-run", this.onStartRun);
    gameEvents.addEventListener("telemetry", this.onTelemetry);
    gameEvents.addEventListener("pause-run", this.onPauseRun);
    gameEvents.addEventListener("resume-run", this.onResumeRun);
    gameEvents.addEventListener("stop-run", this.onStopRun);

    emitGameEvent("scene-ready", undefined);
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.animateBackdrop(dt);
    if (!this.running || this.pausedForSignal || !this.mapper) return;

    this.elapsed += dt;
    this.spawnElapsed += dt;
    const effortVelocity = this.mapper.update(this.powerW, delta);
    if (this.levelId === "racer") {
      this.updateRacer(dt);
      this.checkTelemetryHealth();
      return;
    }
    if (this.levelId === "hill-climber") {
      this.updateHillClimber(dt);
      this.checkTelemetryHealth();
      return;
    }
    const targetVelocity = this.trainerRun
      ? this.trainerTargetVelocity(effortVelocity)
      : effortVelocity;
    const velocityEase = 1 - Math.exp(-delta / this.velocityResponseMs);
    this.velocityY += (targetVelocity - this.velocityY) * velocityEase;
    this.rawPlayerY += this.velocityY * dt;
    this.player.y =
      this.mode === "trace" ? Phaser.Math.Clamp(this.rawPlayerY, 10, HEIGHT - 20) : this.rawPlayerY;
    const targetPitch = Phaser.Math.Clamp(this.velocityY / 500, -0.25, 0.25);
    this.player.rotation = Math.round(targetPitch / PITCH_STEP) * PITCH_STEP;
    this.shadow.scaleX = Phaser.Math.Clamp(1.25 - this.player.y / HEIGHT, 0.35, 1);
    this.shadow.alpha = Phaser.Math.Clamp(this.player.y / HEIGHT / 4, 0.05, 0.2);

    if (this.mode === "trace") {
      if (performance.now() - this.lastTrajectoryAt >= 100) {
        this.lastTrajectoryAt = performance.now();
        emitGameEvent<TrajectoryPoint>("trajectory", {
          elapsedMs: this.elapsed * 1000,
          y: this.rawPlayerY,
          velocityY: this.velocityY,
          targetVelocityY: targetVelocity,
        });
      }
      this.checkTelemetryHealth();
      return;
    }

    const difficulty = Math.min(1, this.elapsed / 90);
    if (this.levelId === "asteroids") this.updateAsteroids(difficulty, dt);
    else this.updateGates(difficulty, dt);

    if (!this.checkTelemetryHealth()) return;
    if (this.collides()) this.endRun();
  }

  private updateGates(difficulty: number, dt: number): void {
    const speed = this.trainerRun
      ? Phaser.Math.Linear(38, 60, difficulty)
      : Phaser.Math.Linear(45, 76, difficulty);
    const spawnEvery = this.trainerRun
      ? Phaser.Math.Linear(2.45, 1.85, difficulty)
      : Phaser.Math.Linear(2.15, 1.55, difficulty);
    if (this.spawnElapsed >= spawnEvery) {
      this.spawnGate(difficulty);
      this.spawnElapsed = 0;
    }

    for (const pair of this.obstacles) {
      for (const part of [pair.top, pair.bottom, pair.topCap, pair.bottomCap]) part.x -= speed * dt;
      if (!pair.scored && pair.top.x + pair.top.width / 2 < PLAYER_X) {
        pair.scored = true;
        this.incrementScore();
      }
    }
    this.removeOldObstacles();
  }

  private updateAsteroids(difficulty: number, dt: number): void {
    const speed = this.trainerRun
      ? Phaser.Math.Linear(42, 70, difficulty)
      : Phaser.Math.Linear(50, 88, difficulty);
    const spawnEvery = this.trainerRun
      ? Phaser.Math.Linear(2.05, 1.25, difficulty)
      : Phaser.Math.Linear(1.8, 1.05, difficulty);
    if (this.spawnElapsed >= spawnEvery) {
      this.spawnAsteroid();
      this.spawnElapsed = 0;
    }

    for (const asteroid of this.asteroids) {
      asteroid.body.x -= speed * dt;
      asteroid.body.rotation += asteroid.spin * dt;
      if (!asteroid.scored && asteroid.body.x + asteroid.radius < PLAYER_X) {
        asteroid.scored = true;
        this.incrementScore();
      }
    }
    this.removeOldAsteroids();
  }

  private updateRacer(dt: number): void {
    const normalizedEffort = Phaser.Math.Clamp(
      this.mapper!.getSmoothedPower() / this.racerHardPowerW,
      0,
      1,
    );
    const targetSpeed = Phaser.Math.Linear(0.003, 0.062, normalizedEffort);
    const speedEase = 1 - Math.exp(-dt / (this.trainerRun ? 0.8 : 0.35));
    this.racerSpeed += (targetSpeed - this.racerSpeed) * speedEase;
    this.racerLane +=
      (Phaser.Math.Linear(8, -8, normalizedEffort) - this.racerLane) * (1 - Math.exp(-dt / 0.55));

    const previousLap = Math.floor(this.racerProgress);
    this.racerProgress += this.racerSpeed * dt;
    if (Math.floor(this.racerProgress) > previousLap) this.incrementScore();
    this.positionRaceCar(this.racerPlayer, this.racerProgress, this.racerLane);

    for (const rival of this.raceRivals) {
      rival.progress += rival.speed * dt;
      this.positionRaceCar(rival.body, rival.progress, rival.lane);
      if (
        Phaser.Math.Distance.Between(
          this.racerPlayer.x,
          this.racerPlayer.y,
          rival.body.x,
          rival.body.y,
        ) < 8
      ) {
        this.endRun();
        return;
      }
    }
  }

  private updateHillClimber(dt: number): void {
    const worldX = this.hillDistance + HILL_PLAYER_X;
    const gradePercent = hillGradePercent(worldX);
    const targetSpeed = hillTargetSpeed(
      this.mapper!.getSmoothedPower(),
      this.hillHardPowerW,
      gradePercent,
    );
    const responseSeconds = this.trainerRun ? 0.85 : 0.4;
    this.hillSpeed += (targetSpeed - this.hillSpeed) * (1 - Math.exp(-dt / responseSeconds));
    this.hillDistance += this.hillSpeed * dt;

    const currentScore = Math.floor(this.hillDistance / 500);
    if (currentScore > this.score) {
      this.score = currentScore;
      emitGameEvent("score", this.score);
    }

    const currentWorldX = this.hillDistance + HILL_PLAYER_X;
    const currentGrade = hillGradePercent(currentWorldX);
    const terrainAngle = Math.atan(hillTerrainDerivative(currentWorldX));
    this.hillPlayer
      .setPosition(HILL_PLAYER_X, hillTerrainY(currentWorldX) - 6)
      .setRotation(terrainAngle);
    this.drawHillLandscape();

    if (performance.now() - this.lastTerrainGradeAt >= 750) {
      this.lastTerrainGradeAt = performance.now();
      emitGameEvent("terrain-grade", { gradePercent: currentGrade });
    }

    if (this.elapsed > 3 && this.hillSpeed < 2.5) this.hillStallElapsed += dt;
    else this.hillStallElapsed = 0;
    if (this.hillStallElapsed >= 4) this.endRun();
  }

  private drawHillLandscape(): void {
    this.drawDistantHillLayer(this.hillFarTerrain, this.hillDistance * 0.14, 112, 17, 0x789b72);
    this.drawDistantHillLayer(this.hillMidTerrain, this.hillDistance * 0.34, 132, 22, 0x557b56);

    const surface: Phaser.Math.Vector2[] = [];
    for (let x = 0; x <= WIDTH; x += 4) {
      surface.push(new Phaser.Math.Vector2(x, hillTerrainY(this.hillDistance + x)));
    }
    this.hillGround.clear();
    this.hillGround
      .fillStyle(0x47733e)
      .fillPoints(
        [new Phaser.Math.Vector2(0, HEIGHT), ...surface, new Phaser.Math.Vector2(WIDTH, HEIGHT)],
        true,
      );
    this.hillGround.lineStyle(3, 0x87a94f).strokePoints(surface);
    this.hillGround.lineStyle(1, 0xd8c86e, 0.65);
    const firstMarker = Math.floor(this.hillDistance / 64);
    for (let marker = firstMarker; marker < firstMarker + 7; marker += 1) {
      const worldX = marker * 64 + 21;
      const x = worldX - this.hillDistance;
      if (x < 0 || x > WIDTH) continue;
      const y = hillTerrainY(worldX) - 2;
      const flowerColor = marker % 3 === 0 ? 0xf4d35e : marker % 3 === 1 ? 0xf2eee2 : 0xd96c75;
      this.hillGround.lineBetween(x, y, x, y - 5);
      this.hillGround.fillStyle(flowerColor).fillCircle(x, y - 6, 1.5);
    }
  }

  private drawDistantHillLayer(
    graphics: Phaser.GameObjects.Graphics,
    scroll: number,
    baseY: number,
    amplitude: number,
    color: number,
  ): void {
    const points = [new Phaser.Math.Vector2(0, HEIGHT)];
    for (let x = 0; x <= WIDTH; x += 6) {
      const y =
        baseY +
        Math.sin((x + scroll) / 58) * amplitude +
        Math.sin((x + scroll) / 23 + 1.4) * amplitude * 0.22;
      points.push(new Phaser.Math.Vector2(x, y));
    }
    points.push(new Phaser.Math.Vector2(WIDTH, HEIGHT));
    graphics.clear().fillStyle(color).fillPoints(points, true);
  }

  private positionRaceCar(car: Phaser.GameObjects.Container, progress: number, lane: number): void {
    const pose = this.trackPose(progress, lane);
    car.setPosition(pose.x, pose.y).setRotation(pose.angle);
  }

  private incrementScore(): void {
    this.score += 1;
    emitGameEvent("score", this.score);
  }

  private createBackdrops(): void {
    this.cameras.main.setBackgroundColor("#080b18");
    const skyObjects: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(160, 90, 320, 180, 0x86b9c2),
      this.add.circle(269, 31, 18, 0xf7d28a, 0.85),
      this.add.rectangle(160, 151, 320, 58, 0xa5a66a),
      this.add.triangle(60, 149, 0, 48, 50, 0, 100, 48, 0x71865d),
      this.add.triangle(160, 151, 0, 53, 60, 0, 120, 53, 0x829062),
      this.add.triangle(272, 151, 0, 45, 55, 0, 110, 45, 0x657956),
    ];
    for (let i = 0; i < 12; i += 1) {
      skyObjects.push(this.add.rectangle(i * 31, 163 + (i % 3) * 2, 22, 25, 0x67513c));
      skyObjects.push(this.add.rectangle(i * 31, 151 + (i % 3) * 2, 25, 4, 0xd3b36e));
    }
    for (let i = 0; i < 7; i += 1) {
      const cloud = this.add.ellipse(35 + i * 58, 30 + (i % 3) * 17, 36, 9, 0xf3ead6, 0.5);
      cloud.setData("drift", 2 + (i % 2));
      this.clouds.push(cloud);
      skyObjects.push(cloud);
    }
    this.skyBackdrop = this.add.container(0, 0, skyObjects).setDepth(-10);

    const spaceObjects: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(160, 90, 320, 180, 0x080b18),
    ];
    const starColors = [0xffffff, 0xc9ddff, 0xffe6ae];
    for (let i = 0; i < 52; i += 1) {
      const size = i % 9 === 0 ? 2 : 1;
      const star = this.add.rectangle(
        Phaser.Math.Between(0, WIDTH),
        Phaser.Math.Between(3, HEIGHT - 3),
        size,
        size,
        starColors[i % starColors.length],
        i % 5 === 0 ? 0.65 : 1,
      );
      star.setData("drift", 5 + (i % 4) * 4);
      this.stars.push(star);
      spaceObjects.push(star);
    }
    this.spaceBackdrop = this.add.container(0, 0, spaceObjects).setDepth(-10);

    const raceObjects: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(160, 90, 320, 180, 0x477342),
    ];
    const track = this.add.graphics();
    const trackPoints = Array.from({ length: 180 }, (_, index) => this.trackPoint(index / 180));
    track.lineStyle(42, 0x263128, 0.95).strokePoints(trackPoints, true);
    track.lineStyle(34, 0x77766f).strokePoints(trackPoints, true);
    track.lineStyle(1, 0xd9cf9a, 0.5);
    for (let index = 0; index < trackPoints.length; index += 10) {
      const current = trackPoints[index]!;
      const next = trackPoints[(index + 4) % trackPoints.length]!;
      track.lineBetween(current.x, current.y, next.x, next.y);
    }
    for (let index = 0; index < 90; index += 3) {
      const color = index % 6 === 0 ? 0xf2e5c4 : 0xb94d3c;
      const outer = this.trackPose(index / 90, 17);
      const inner = this.trackPose(index / 90, -17);
      track.fillStyle(color).fillCircle(outer.x, outer.y, 1.7);
      track.fillCircle(inner.x, inner.y, 1.7);
    }
    const finishInner = this.trackPose(0, -16);
    const finishOuter = this.trackPose(0, 16);
    track
      .lineStyle(3, 0xf5eee0)
      .lineBetween(finishInner.x, finishInner.y, finishOuter.x, finishOuter.y);
    raceObjects.push(track);
    raceObjects.push(this.add.ellipse(150, 82, 42, 20, 0x345c52, 0.9));
    raceObjects.push(this.add.rectangle(148, 81, 34, 2, 0x8cb4a4, 0.45));
    const trees: Array<[number, number]> = [
      [78, 94],
      [114, 102],
      [222, 101],
      [246, 43],
      [300, 160],
    ];
    for (const [x, y] of trees) {
      raceObjects.push(this.add.circle(x, y, 5, 0x274f31));
      raceObjects.push(this.add.circle(x - 2, y - 2, 2, 0x5d8d4f));
    }
    this.racerBackdrop = this.add.container(0, 0, raceObjects).setDepth(-10);

    this.hillFarTerrain = this.add.graphics();
    this.hillMidTerrain = this.add.graphics();
    this.hillGround = this.add.graphics();
    const hillObjects: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(160, 30, 320, 60, 0x83c7d8),
      this.add.rectangle(160, 90, 320, 60, 0xaed7ce),
      this.add.rectangle(160, 150, 320, 60, 0xe5d59f),
      this.add.circle(264, 28, 17, 0xffd477, 0.9),
      this.add.ellipse(53, 27, 44, 8, 0xf7f0d8, 0.7),
      this.add.ellipse(185, 42, 54, 10, 0xf7f0d8, 0.55),
      this.hillFarTerrain,
      this.hillMidTerrain,
      this.hillGround,
    ];
    this.hillBackdrop = this.add.container(0, 0, hillObjects).setDepth(-10);
    this.drawHillLandscape();
  }

  private createRaceCars(): void {
    this.racerPlayer = this.createRaceCar(0xd14b3f);
    const rivals = [
      { progress: 0.2, lane: -8, speed: 0.032, color: 0xf0c74f },
      { progress: 0.48, lane: 0, speed: 0.036, color: 0x4c79c6 },
      { progress: 0.73, lane: 8, speed: 0.029, color: 0xe8e2cb },
    ];
    this.raceRivals = rivals.map(({ color, ...rival }) => ({
      ...rival,
      startProgress: rival.progress,
      body: this.createRaceCar(color),
    }));
  }

  private createHillBike(): void {
    const wheels = [
      this.add.circle(-8, 0, 5, 0x263037).setStrokeStyle(1, 0xd8caa0),
      this.add.circle(8, 0, 5, 0x263037).setStrokeStyle(1, 0xd8caa0),
    ];
    const frame = this.add.graphics();
    frame.lineStyle(2, 0xb33f32).lineBetween(-8, 0, -1, -6);
    frame.lineBetween(-1, -6, 5, 0);
    frame.lineBetween(5, 0, -8, 0);
    frame.lineBetween(-1, -6, 8, 0);
    frame.lineStyle(1, 0x36251d).lineBetween(-2, -8, 2, -8);
    frame.lineBetween(7, -5, 10, -6);
    frame.lineBetween(7, -5, 8, 0);
    const rider = this.add.graphics();
    rider.fillStyle(0x435f8a).fillCircle(-1, -12, 3);
    rider.lineStyle(2, 0x594337).lineBetween(-1, -9, 2, -4);
    rider.lineBetween(2, -4, 7, -5);
    rider.lineBetween(2, -4, -1, -6);
    this.hillPlayer = this.add.container(HILL_PLAYER_X, 100, [...wheels, frame, rider]);
    this.hillPlayer.setVisible(false);
  }

  private createRaceCar(color: number): Phaser.GameObjects.Container {
    const body = this.add.rectangle(0, 0, 13, 7, color).setStrokeStyle(1, 0x211d1a);
    const cabin = this.add.rectangle(-1, 0, 5, 5, 0xb8d4d0, 0.8);
    const nose = this.add.rectangle(5, 0, 2, 4, 0xf1df9f, 0.8);
    const wheels = [-4, 4].flatMap((x) => [
      this.add.rectangle(x, -4, 3, 2, 0x191919),
      this.add.rectangle(x, 4, 3, 2, 0x191919),
    ]);
    return this.add.container(0, 0, [body, cabin, nose, ...wheels]).setVisible(false);
  }

  private trackPoint(progress: number): Phaser.Math.Vector2 {
    const wrapped = ((progress % 1) + 1) % 1;
    const scaled = wrapped * TRACK_CONTROL_POINTS.length;
    const index = Math.floor(scaled);
    const t = scaled - index;
    const point = (offset: number) =>
      TRACK_CONTROL_POINTS[
        (index + offset + TRACK_CONTROL_POINTS.length) % TRACK_CONTROL_POINTS.length
      ]!;
    const p0 = point(-1);
    const p1 = point(0);
    const p2 = point(1);
    const p3 = point(2);
    const interpolate = (a: number, b: number, c: number, d: number) =>
      0.5 *
      (2 * b +
        (-a + c) * t +
        (2 * a - 5 * b + 4 * c - d) * t * t +
        (-a + 3 * b - 3 * c + d) * t * t * t);
    return new Phaser.Math.Vector2(
      interpolate(p0.x, p1.x, p2.x, p3.x),
      interpolate(p0.y, p1.y, p2.y, p3.y),
    );
  }

  private trackPose(progress: number, lane = 0): { x: number; y: number; angle: number } {
    const point = this.trackPoint(progress);
    const before = this.trackPoint(progress - 0.001);
    const after = this.trackPoint(progress + 0.001);
    const angle = Phaser.Math.Angle.Between(before.x, before.y, after.x, after.y);
    return {
      x: point.x - Math.sin(angle) * lane,
      y: point.y + Math.cos(angle) * lane,
      angle,
    };
  }

  private animateBackdrop(dt: number): void {
    if (this.skyBackdrop.visible) {
      for (const cloud of this.clouds) {
        cloud.x -= (cloud.getData("drift") as number) * dt;
        if (cloud.x < -20) cloud.x = 340;
      }
    }
    if (this.spaceBackdrop.visible) {
      for (const star of this.stars) {
        star.x -= (star.getData("drift") as number) * dt;
        if (star.x < -2) star.x = WIDTH + 2;
      }
    }
  }

  private setBackdrop(levelId: LevelId): void {
    const inSpace = levelId === "asteroids";
    const onTrack = levelId === "racer";
    const inHills = levelId === "hill-climber";
    this.skyBackdrop.setVisible(!inSpace && !onTrack && !inHills);
    this.spaceBackdrop.setVisible(inSpace);
    this.racerBackdrop.setVisible(onTrack);
    this.hillBackdrop.setVisible(inHills);
    this.shadow.setVisible(!inSpace && !onTrack && !inHills);
    this.player.setVisible(!onTrack && !inHills);
    this.racerPlayer.setVisible(onTrack);
    for (const rival of this.raceRivals) rival.body.setVisible(onTrack);
    this.hillPlayer.setVisible(inHills);
  }

  private readonly onStartRun = (event: Event): void => {
    const { profile, demo, mode, levelId } = (event as CustomEvent<StartRunDetail>).detail;
    this.mode = mode;
    this.levelId = levelId;
    this.trainerRun = !demo;
    this.mapper = new EffortMapper(
      profile,
      demo ? 80 : 300,
      demo ? 90 : 55,
      demo ? 0 : 0.15,
      demo ? 1 : 1.35,
    );
    this.velocityResponseMs = demo ? 120 : TRAINER_VELOCITY_RESPONSE_MS;
    this.clearObstacles();
    this.player
      .setPosition(PLAYER_X, 88)
      .setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT)
      .setRotation(0);
    this.racerProgress = 0;
    this.racerSpeed = 0;
    this.racerLane = 0;
    this.racerHardPowerW = profile.hardPowerW;
    this.racerPlayer.setAlpha(1);
    this.positionRaceCar(this.racerPlayer, this.racerProgress, this.racerLane);
    for (const rival of this.raceRivals) {
      rival.progress = rival.startProgress;
      this.positionRaceCar(rival.body, rival.progress, rival.lane);
    }
    this.hillDistance = 0;
    this.hillSpeed = 0;
    this.hillStallElapsed = 0;
    this.hillHardPowerW = profile.hardPowerW;
    this.lastTerrainGradeAt = 0;
    this.hillPlayer.setAlpha(1);
    const hillWorldX = this.hillDistance + HILL_PLAYER_X;
    this.hillPlayer
      .setPosition(HILL_PLAYER_X, hillTerrainY(hillWorldX) - 6)
      .setRotation(Math.atan(hillTerrainDerivative(hillWorldX)));
    this.drawHillLandscape();
    this.setBackdrop(levelId);
    this.velocityY = 0;
    this.rawPlayerY = 88;
    this.powerW = profile.cruisePowerW;
    this.lastTelemetryAt = performance.now();
    this.elapsed = 0;
    this.spawnElapsed = 1;
    this.score = 0;
    this.lastTrajectoryAt = 0;
    this.pausedForSignal = false;
    this.running = true;
    emitGameEvent("score", 0);
  };

  private readonly onTelemetry = (event: Event): void => {
    const detail = (event as CustomEvent<{ powerW: number; timestamp: number }>).detail;
    this.powerW = detail.powerW;
    this.lastTelemetryAt = performance.now();
    if (this.pausedForSignal) emitGameEvent("signal-returned", undefined);
  };

  private readonly onPauseRun = (): void => {
    if (this.running) this.pausedForSignal = true;
  };

  private readonly onResumeRun = (): void => {
    if (this.running) {
      this.lastTelemetryAt = performance.now();
      this.pausedForSignal = false;
    }
  };

  private readonly onStopRun = (): void => {
    this.running = false;
    this.pausedForSignal = false;
    this.clearObstacles();
    this.rawPlayerY = 88;
    this.player.setPosition(PLAYER_X, 88).setRotation(0);
    this.levelId = "ornithopter-run";
    this.setBackdrop(this.levelId);
  };

  private spawnGate(difficulty: number): void {
    const gap = Math.round(
      this.trainerRun
        ? Phaser.Math.Linear(92, 68, difficulty)
        : Phaser.Math.Linear(72, 52, difficulty),
    );
    const margin = 18;
    const gapY = Phaser.Math.Between(margin + gap / 2, HEIGHT - margin - gap / 2 - 18);
    const width = 20;
    const x = WIDTH + width;
    const topHeight = gapY - gap / 2;
    const bottomY = gapY + gap / 2;
    const bottomHeight = HEIGHT - bottomY;
    const color = 0x66513e;
    const capColor = 0xc19a5b;
    this.obstacles.push({
      top: this.add.rectangle(x, topHeight / 2, width, topHeight, color),
      bottom: this.add.rectangle(x, bottomY + bottomHeight / 2, width, bottomHeight, color),
      topCap: this.add.rectangle(x, topHeight - 3, width + 7, 6, capColor),
      bottomCap: this.add.rectangle(x, bottomY + 3, width + 7, 6, capColor),
      scored: false,
    });
  }

  private spawnAsteroid(): void {
    const radius = Phaser.Math.Between(10, 19);
    const rock = this.add
      .circle(0, 0, radius, Phaser.Math.RND.pick([0x6f6b76, 0x817768, 0x5f6672]))
      .setStrokeStyle(2, 0xb0a58e, 0.8);
    const craterOne = this.add.circle(
      -radius * 0.28,
      -radius * 0.2,
      Math.max(2, radius * 0.2),
      0x3e414c,
      0.72,
    );
    const craterTwo = this.add.circle(
      radius * 0.3,
      radius * 0.24,
      Math.max(1.5, radius * 0.13),
      0x47434a,
      0.65,
    );
    const highlight = this.add.circle(
      radius * 0.25,
      -radius * 0.32,
      Math.max(1, radius * 0.1),
      0xd0c49f,
      0.55,
    );
    const body = this.add.container(
      WIDTH + radius + 5,
      Phaser.Math.Between(radius + 4, HEIGHT - radius - 4),
      [rock, craterOne, craterTwo, highlight],
    );
    body.rotation = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    this.asteroids.push({
      body,
      radius,
      spin: Phaser.Math.FloatBetween(-0.8, 0.8),
      scored: false,
    });
  }

  /**
   * A rider can hold a non-cruise power for seconds, unlike a keyboard player
   * tapping a key. Treat trainer effort as a requested altitude so flywheel and
   * telemetry lag cannot keep accelerating the aircraft off screen.
   */
  private trainerTargetVelocity(effortVelocity: number): number {
    return trainerAltitudeVelocity(effortVelocity, this.rawPlayerY);
  }

  private collides(): boolean {
    const hitboxWidth = this.trainerRun ? 26 : 34;
    const hitboxHeight =
      this.levelId === "asteroids" ? (this.trainerRun ? 11 : 16) : this.trainerRun ? 14 : 20;
    const playerBounds = new Phaser.Geom.Rectangle(
      this.player.x - hitboxWidth / 2,
      this.player.y - hitboxHeight / 2,
      hitboxWidth,
      hitboxHeight,
    );
    const bottomBoundary = this.levelId === "asteroids" ? HEIGHT : HEIGHT - 15;
    if (playerBounds.top <= 0 || playerBounds.bottom >= bottomBoundary) return true;
    if (this.levelId === "asteroids") {
      return this.asteroids.some((asteroid) =>
        Phaser.Geom.Intersects.CircleToRectangle(
          new Phaser.Geom.Circle(asteroid.body.x, asteroid.body.y, asteroid.radius * 0.82),
          playerBounds,
        ),
      );
    }
    return this.obstacles.some((pair) =>
      [pair.top, pair.bottom, pair.topCap, pair.bottomCap].some((part) =>
        Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, part.getBounds()),
      ),
    );
  }

  private removeOldObstacles(): void {
    const remaining: ObstaclePair[] = [];
    for (const pair of this.obstacles) {
      if (pair.top.x < -30) {
        for (const part of [pair.top, pair.bottom, pair.topCap, pair.bottomCap]) part.destroy();
      } else remaining.push(pair);
    }
    this.obstacles = remaining;
  }

  private removeOldAsteroids(): void {
    const remaining: AsteroidObstacle[] = [];
    for (const asteroid of this.asteroids) {
      if (asteroid.body.x < -asteroid.radius - 5) asteroid.body.destroy();
      else remaining.push(asteroid);
    }
    this.asteroids = remaining;
  }

  private clearObstacles(): void {
    for (const pair of this.obstacles) {
      for (const part of [pair.top, pair.bottom, pair.topCap, pair.bottomCap]) part.destroy();
    }
    this.obstacles = [];
    for (const asteroid of this.asteroids) asteroid.body.destroy();
    this.asteroids = [];
  }

  private checkTelemetryHealth(): boolean {
    if (performance.now() - this.lastTelemetryAt <= 2_000) return true;
    this.pausedForSignal = true;
    emitGameEvent("signal-stale", undefined);
    return false;
  }

  private endRun(): void {
    this.running = false;
    if (this.levelId === "racer") {
      this.racerPlayer.setAlpha(0.35);
    } else if (this.levelId === "hill-climber") {
      this.hillPlayer.setAlpha(0.35);
    } else {
      this.player.setTint(0xc96f51);
      this.time.delayedCall(180, () => this.player.clearTint());
    }
    emitGameEvent("game-over", this.score);
  }
}
