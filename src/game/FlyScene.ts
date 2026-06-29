import Phaser from "phaser";
import type { CalibrationProfile } from "../calibration";
import { EffortMapper, TRAINER_VELOCITY_RESPONSE_MS, trainerAltitudeVelocity } from "../effort";
import { emitGameEvent, gameEvents } from "./events";

type ObstaclePair = {
  top: Phaser.GameObjects.Rectangle;
  bottom: Phaser.GameObjects.Rectangle;
  topCap: Phaser.GameObjects.Rectangle;
  bottomCap: Phaser.GameObjects.Rectangle;
  scored: boolean;
};

type StartRunDetail = {
  profile: CalibrationProfile;
  demo: boolean;
  mode: "game" | "trace";
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

export class FlyScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Ellipse;
  private obstacles: ObstaclePair[] = [];
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
    this.createBackdrop();
    this.shadow = this.add.ellipse(PLAYER_X, 158, 38, 5, 0x553a2c, 0.16);
    this.player = this.add
      .image(PLAYER_X, 88, "ornithopter")
      .setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT);
    this.player.setOrigin(0.5);

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
    const speed = this.trainerRun
      ? Phaser.Math.Linear(38, 60, difficulty)
      : Phaser.Math.Linear(45, 76, difficulty);
    const spawnEvery = this.trainerRun
      ? Phaser.Math.Linear(2.45, 1.85, difficulty)
      : Phaser.Math.Linear(2.15, 1.55, difficulty);
    if (this.spawnElapsed >= spawnEvery) {
      this.spawnObstacle(difficulty);
      this.spawnElapsed = 0;
    }

    for (const pair of this.obstacles) {
      for (const part of [pair.top, pair.bottom, pair.topCap, pair.bottomCap]) part.x -= speed * dt;
      if (!pair.scored && pair.top.x + pair.top.width / 2 < PLAYER_X) {
        pair.scored = true;
        this.score += 1;
        emitGameEvent("score", this.score);
      }
    }
    this.removeOldObstacles();

    if (!this.checkTelemetryHealth()) return;
    if (this.collides()) this.endRun();
  }

  private createBackdrop(): void {
    this.cameras.main.setBackgroundColor("#86b9c2");
    this.add.circle(269, 31, 18, 0xf7d28a, 0.85);
    this.add.rectangle(160, 151, 320, 58, 0xa5a66a);
    this.add.triangle(60, 149, 0, 48, 50, 0, 100, 48, 0x71865d);
    this.add.triangle(160, 151, 0, 53, 60, 0, 120, 53, 0x829062);
    this.add.triangle(272, 151, 0, 45, 55, 0, 110, 45, 0x657956);

    for (let i = 0; i < 12; i += 1) {
      this.add.rectangle(i * 31, 163 + (i % 3) * 2, 22, 25, 0x67513c);
      this.add.rectangle(i * 31, 151 + (i % 3) * 2, 25, 4, 0xd3b36e);
    }
    for (let i = 0; i < 7; i += 1) {
      const cloud = this.add.ellipse(35 + i * 58, 30 + (i % 3) * 17, 36, 9, 0xf3ead6, 0.5);
      cloud.setData("drift", 2 + (i % 2));
      cloud.setName("cloud");
    }
  }

  private animateBackdrop(dt: number): void {
    for (const object of this.children.list) {
      if (object.name !== "cloud") continue;
      const cloud = object as Phaser.GameObjects.Ellipse;
      cloud.x -= (cloud.getData("drift") as number) * dt;
      if (cloud.x < -20) cloud.x = 340;
    }
  }

  private readonly onStartRun = (event: Event): void => {
    const { profile, demo, mode } = (event as CustomEvent<StartRunDetail>).detail;
    this.mode = mode;
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
      .setRotation(0)
      .setVisible(true);
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
  };

  private spawnObstacle(difficulty: number): void {
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
    const hitboxHeight = this.trainerRun ? 14 : 20;
    const playerBounds = new Phaser.Geom.Rectangle(
      this.player.x - hitboxWidth / 2,
      this.player.y - hitboxHeight / 2,
      hitboxWidth,
      hitboxHeight,
    );
    if (playerBounds.top <= 0 || playerBounds.bottom >= HEIGHT - 15) return true;
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

  private clearObstacles(): void {
    for (const pair of this.obstacles) {
      for (const part of [pair.top, pair.bottom, pair.topCap, pair.bottomCap]) part.destroy();
    }
    this.obstacles = [];
  }

  private checkTelemetryHealth(): boolean {
    if (performance.now() - this.lastTelemetryAt <= 2_000) return true;
    this.pausedForSignal = true;
    emitGameEvent("signal-stale", undefined);
    return false;
  }

  private endRun(): void {
    this.running = false;
    this.player.setTint(0xc96f51);
    this.time.delayedCall(180, () => this.player.clearTint());
    emitGameEvent("game-over", this.score);
  }
}
