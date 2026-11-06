import {
  createCalibration,
  createManualCalibration,
  loadCalibration,
  saveCalibration,
  type CalibrationProfile,
} from "./calibration";
import { GameAudio } from "./game/audio";
import { emitGameEvent, gameEvents } from "./game/events";
import type { TrajectoryPoint } from "./game/FlyScene";
import {
  defaultLevelSettings,
  DIFFICULTIES,
  getLevel,
  HILL_COURSE_LENGTHS,
  HILL_MAX_ELEVATIONS,
  HILL_STEEPNESS_STYLES,
  LEVELS,
  settingsFingerprint,
  type LevelId,
  type LevelSettings,
} from "./levels";
import { formatRunTime, formatSessionMinutes, RideStats } from "./ride-stats";
import {
  groupRideHistory,
  loadRideHistory,
  rideTotals,
  ridesSince,
  saveRideHistory,
  startOfPeriod,
  validateRideHistory,
  type PowerPoint,
  type RideHistoryEntry,
  type RideTotals,
} from "./ride-history";
import { DemoSource } from "./trainer/demo-source";
import { FtmsBluetoothSource } from "./trainer/ftms-bluetooth-source";
import { pickControllerAction } from "./trainer/openbikecontrol";
import { OpenBikeControlBluetooth } from "./trainer/openbikecontrol-bluetooth";
import { terrainLoadTarget } from "./trainer/terrain-load";
import type {
  ConnectionStatus,
  TelemetrySample,
  TrainerLoadControl,
  TrainerSource,
} from "./trainer/types";

const SCORE_KEY = "flybike.highScore.v1";

// Bluetooth choosers and file pickers need a real click or tap, not a controller press.
const GESTURE_BUTTONS = new Set([
  "connect-button",
  "controller-button",
  "reconnect-button",
  "history-import-button",
]);

const TRACE_STEPS = [
  { cue: "Cruise", instruction: "Hold your comfortable calibrated effort", durationMs: 10_000 },
  { cue: "Push", instruction: "Increase to your hard calibrated effort", durationMs: 8_000 },
  { cue: "Cruise", instruction: "Return to comfortable effort", durationMs: 10_000 },
  { cue: "Easy", instruction: "Pedal very lightly", durationMs: 8_000 },
  { cue: "Cruise", instruction: "Return to comfortable effort", durationMs: 10_000 },
  { cue: "Push", instruction: "Increase to your hard calibrated effort", durationMs: 8_000 },
  { cue: "Coast", instruction: "Stop pedaling and let the wheel slow", durationMs: 6_000 },
] as const;

type TraceRecord = {
  elapsedMs: number;
  cue: string;
  powerW?: number;
  cadenceRpm?: number;
  speedKph?: number;
  trajectoryY?: number;
  velocityY?: number;
  targetVelocityY?: number;
};

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  };
  return value.replace(/[&<>'"]/g, (character) => entities[character]!);
}

type WakeLockSentinelLike = { release(): Promise<void> };

export class AppController {
  private source?: TrainerSource;
  private demoSource?: DemoSource;
  private profile?: CalibrationProfile;
  private latestSample: TelemetrySample = { timestamp: 0 };
  private sampleCollector?: (sample: TelemetrySample) => void;
  private sourceUnsubscribers: Array<() => void> = [];
  private gameActive = false;
  private countdownActive = false;
  private demoInputPressed = false;
  private controllerClimbIds: number[] = [];
  private traceActive = false;
  private traceRecords: TraceRecord[] = [];
  private traceStartedAt = 0;
  private traceCue = "Cruise";
  private traceGuideTimer?: number;
  private tracePosition?: TrajectoryPoint;
  private wakeLock?: WakeLockSentinelLike;
  private trainerLoadValue?: number;
  private selectedLevel: LevelId = LEVELS[0].id;
  private readonly levelSettings = Object.fromEntries(
    LEVELS.map((level) => [level.id, defaultLevelSettings(level.id)]),
  ) as Record<LevelId, LevelSettings>;
  private terrainResistanceScale = 1;
  private terrainLoadBusy = false;
  private pendingTerrainGrade?: number;
  private lastTerrainLoadValue?: number;
  private terrainRestoreRequested = false;
  private terrainLoadFailed = false;
  private runPanelOpen = false;
  private readonly rideStats = new RideStats();
  private rideStartedAt = 0;
  private ridePowerCurve: PowerPoint[] = [];
  private lastHistoryPowerAt = 0;
  private readonly audio = new GameAudio();
  private readonly controller = new OpenBikeControlBluetooth(
    (pressedIds) => this.handleControllerButtons(pressedIds),
    (status) => this.renderControllerStatus(status),
  );

  private readonly overlay = document.querySelector<HTMLElement>("#overlay")!;
  private readonly hud = document.querySelector<HTMLElement>("#hud")!;
  private readonly powerValue = document.querySelector<HTMLElement>("#power-value")!;
  private readonly cadenceValue = document.querySelector<HTMLElement>("#cadence-value")!;
  private readonly speedValue = document.querySelector<HTMLElement>("#speed-value")!;
  private readonly scoreValue = document.querySelector<HTMLElement>("#score-value")!;
  private readonly scoreLabel = document.querySelector<HTMLElement>("#score-label")!;
  private readonly rideStatsPanel = document.querySelector<HTMLElement>("#ride-stats")!;
  private readonly runTime = document.querySelector<HTMLElement>("#run-time")!;
  private readonly sessionTime = document.querySelector<HTMLElement>("#session-time")!;
  private readonly runDistance = document.querySelector<HTMLElement>("#run-distance")!;
  private readonly sessionDistance = document.querySelector<HTMLElement>("#session-distance")!;
  private readonly connectionPill = document.querySelector<HTMLButtonElement>("#connection-pill")!;
  private readonly menuButton = document.querySelector<HTMLButtonElement>("#menu-button")!;
  private readonly muteButton = document.querySelector<HTMLButtonElement>("#mute-button")!;
  private readonly traceCuePanel = document.querySelector<HTMLElement>("#trace-cue")!;
  private readonly traceCueTitle = document.querySelector<HTMLElement>("#trace-cue-title")!;
  private readonly traceCueCopy = document.querySelector<HTMLElement>("#trace-cue-copy")!;
  private readonly traceCueProgress = document.querySelector<HTMLElement>("#trace-cue-progress")!;

  constructor() {
    this.muteButton.textContent = this.audio.isMuted() ? "Sound off" : "Sound on";
    this.muteButton.addEventListener("click", () => {
      this.muteButton.textContent = this.audio.toggle() ? "Sound off" : "Sound on";
    });
    this.connectionPill.addEventListener("click", () => this.showBikeSettings());
    this.menuButton.addEventListener("click", () => this.showGameMenu());
    gameEvents.addEventListener("score", (event) => {
      const score = (event as CustomEvent<number>).detail;
      this.scoreValue.textContent = String(score);
      if (score > 0) this.audio.play("score");
    });
    gameEvents.addEventListener("game-over", (event) => {
      void this.handleGameOver((event as CustomEvent<number>).detail);
    });
    gameEvents.addEventListener("run-complete", (event) => {
      void this.handleGameOver((event as CustomEvent<number>).detail, true);
    });
    gameEvents.addEventListener("signal-stale", () => this.pauseForSignal());
    gameEvents.addEventListener("trajectory", (event) => {
      this.tracePosition = (event as CustomEvent<TrajectoryPoint>).detail;
    });
    gameEvents.addEventListener("terrain-grade", (event) => {
      const { gradePercent } = (event as CustomEvent<{ gradePercent: number }>).detail;
      this.handleTerrainGrade(gradePercent);
    });
    gameEvents.addEventListener("virtual-speed", (event) => {
      if (this.gameActive && this.selectedLevel === "hill-climber")
        this.speedValue.textContent = (event as CustomEvent<number>).detail.toFixed(1);
    });
    gameEvents.addEventListener("signal-returned", () => {
      if (this.gameActive) this.showPause("Signal restored", "Resume when you are ready.");
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden || !this.gameActive) return;
      if (this.traceActive) void this.finishTrace("Trace stopped when the game lost focus.");
      else this.showPause("Paused", "The game lost focus.");
    });
    document.querySelector("#trace-cancel")?.addEventListener("click", () => {
      void this.finishTrace("Trace ended early.");
    });
    window.setInterval(() => this.tickRideStats(), 250);
    this.bindDemoControls();
    this.showHome();
  }

  private showHome(message?: string): void {
    this.gameActive = false;
    this.traceActive = false;
    this.runPanelOpen = false;
    this.pauseRideStats();
    this.rideStatsPanel.classList.add("hidden");
    this.updateConnectionPillInteractivity();
    this.hud.classList.add("hidden");
    this.overlay.classList.remove("hidden", "compact");
    const supportsBluetooth = "bluetooth" in navigator;
    this.overlay.innerHTML = `
      <section class="panel home-panel" aria-labelledby="title">
        <p class="eyebrow">A pedal-powered arcade flight</p>
        <h1 id="title">FlyBike</h1>
        <p>Pedal Leonardo's improbable ornithopter through an endless sky.</p>
        ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
        <div class="actions">
          <button id="connect-button" class="primary" ${supportsBluetooth ? "" : "disabled"}>Connect trainer</button>
          <button id="demo-button">Play with keys / touch</button>
          <button id="controller-button" ${supportsBluetooth ? "" : "disabled"}>Connect controller</button>
          <button id="history-button">Ride history</button>
        </div>
        <p id="controller-status" class="fine-print"></p>
        <p class="fine-print">Bluetooth requires Chrome or Edge on desktop/Android. Close other trainer apps first.</p>
      </section>`;
    this.overlay
      .querySelector("#connect-button")
      ?.addEventListener("click", () => void this.connectTrainer());
    this.overlay
      .querySelector("#demo-button")
      ?.addEventListener("click", () => void this.startDemo());
    this.overlay
      .querySelector("#controller-button")
      ?.addEventListener("click", () => void this.controller.connect());
    this.overlay
      .querySelector("#history-button")
      ?.addEventListener("click", () => this.showRideHistory());
    this.renderControllerStatus(this.controller.getStatus());
  }

  private renderControllerStatus(status: ConnectionStatus): void {
    const label = this.overlay.querySelector("#controller-status");
    if (!label) return;
    // Device names come from Bluetooth, so they are only ever set as text.
    label.textContent =
      status.state === "connected"
        ? `Controller: ${status.deviceName ?? "connected"}`
        : (status.message ??
          "Optional OpenBikeControl remote: pause, pick menu buttons, and climb in demo mode.");
  }

  private handleControllerButtons(pressedIds: number[]): void {
    if (
      this.controllerClimbIds.length &&
      !this.controllerClimbIds.some((id) => this.controller.isHeld(id))
    ) {
      this.controllerClimbIds = [];
      this.setDemoInputPressed(false);
    }
    const inFlight = this.gameActive && !this.runPanelOpen && !this.countdownActive;
    const action = pickControllerAction(pressedIds, inFlight);
    if (action === "climb") {
      this.controllerClimbIds = pressedIds;
      this.setDemoInputPressed(true);
    } else if (action === "menu") this.showGameMenu();
    else if (action === "previous") this.moveOverlayFocus(-1);
    else if (action === "next") this.moveOverlayFocus(1);
    else if (action === "confirm") {
      const buttons = this.overlayButtons();
      const button =
        buttons.find((candidate) => candidate === document.activeElement) ??
        buttons.find((candidate) => candidate.classList.contains("primary"));
      if (button && !GESTURE_BUTTONS.has(button.id)) button.click();
    }
  }

  private overlayButtons(): HTMLButtonElement[] {
    if (this.overlay.classList.contains("hidden")) return [];
    return [...this.overlay.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  }

  private moveOverlayFocus(step: number): void {
    const buttons = this.overlayButtons();
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // With nothing focused yet, the first step lands on the first or last button.
    const start = index < 0 ? (step > 0 ? -1 : 0) : index;
    buttons[(start + step + buttons.length) % buttons.length]!.focus();
  }

  private async connectTrainer(): Promise<void> {
    await this.setSource(new FtmsBluetoothSource());
    await this.source?.connect();
    const status = this.source?.getStatus();
    if (status?.state === "connected" && status.deviceId) {
      this.profile = loadCalibration(status.deviceId);
      this.showTrainerReady(status);
    } else if (status?.state !== "connecting") {
      this.showHome(status?.message);
    }
  }

  private async startDemo(): Promise<void> {
    const demo = new DemoSource();
    this.demoSource = demo;
    await this.setSource(demo);
    await demo.connect();
    this.profile = {
      deviceId: "demo",
      cruisePowerW: 120,
      hardPowerW: 260,
      calibratedAt: new Date().toISOString(),
    };
    this.showTrainerReady(demo.getStatus(), true);
  }

  private async setSource(source: TrainerSource): Promise<void> {
    await this.source?.disconnect();
    this.sourceUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.sourceUnsubscribers = [];
    this.source = source;
    this.trainerLoadValue = undefined;
    this.rideStats.resetSession();
    this.renderRideStats();
    this.sourceUnsubscribers.push(
      source.subscribe((sample) => this.handleTelemetry(sample)),
      source.subscribeStatus((status) => this.handleStatus(status)),
    );
  }

  private handleTelemetry(sample: TelemetrySample): void {
    this.latestSample = { ...this.latestSample, ...sample };
    this.powerValue.textContent =
      sample.powerW === undefined ? "—" : String(Math.max(0, sample.powerW));
    this.cadenceValue.textContent =
      sample.cadenceRpm === undefined ? "—" : sample.cadenceRpm.toFixed(0);
    if (!this.gameActive || this.selectedLevel !== "hill-climber")
      this.speedValue.textContent =
        sample.speedKph === undefined ? "—" : sample.speedKph.toFixed(1);
    this.sampleCollector?.(sample);
    if (this.traceActive) {
      this.traceRecords.push({
        elapsedMs: Math.round(performance.now() - this.traceStartedAt),
        cue: this.traceCue,
        powerW: sample.powerW,
        cadenceRpm: sample.cadenceRpm,
        speedKph: sample.speedKph,
        trajectoryY: this.tracePosition?.y,
        velocityY: this.tracePosition?.velocityY,
        targetVelocityY: this.tracePosition?.targetVelocityY,
      });
    }
    if (this.gameActive && sample.powerW !== undefined) {
      if (performance.now() - this.lastHistoryPowerAt >= 5_000) {
        this.lastHistoryPowerAt = performance.now();
        this.ridePowerCurve.push({
          elapsedSeconds: Math.round((performance.now() - this.rideStartedAt) / 1000),
          powerW: Math.max(0, sample.powerW),
        });
      }
      emitGameEvent("telemetry", {
        powerW: Math.max(0, sample.powerW),
        cadenceRpm: sample.cadenceRpm,
        timestamp: sample.timestamp,
      });
    }
  }

  private beginRideStats(): void {
    this.rideStats.beginRun(performance.now());
    this.rideStartedAt = performance.now();
    this.lastHistoryPowerAt = 0;
    this.ridePowerCurve = [];
    this.rideStatsPanel.classList.remove("hidden");
    this.renderRideStats();
  }

  private pauseRideStats(): void {
    this.rideStats.pause(performance.now(), this.latestSample.speedKph ?? 0);
    this.renderRideStats();
  }

  private resumeRideStats(): void {
    this.rideStats.resume(performance.now());
    this.rideStatsPanel.classList.remove("hidden");
    this.renderRideStats();
  }

  private tickRideStats(): void {
    const hillStopped =
      this.gameActive &&
      this.selectedLevel === "hill-climber" &&
      (this.latestSample.speedKph ?? 0) < 0.5 &&
      (this.latestSample.cadenceRpm ?? 0) < 1 &&
      (this.latestSample.powerW ?? 0) < 5;
    if (hillStopped) this.rideStats.pause(performance.now(), 0);
    else if (this.gameActive && !this.runPanelOpen && !this.countdownActive)
      this.rideStats.resume(performance.now());
    this.rideStats.tick(performance.now(), this.latestSample.speedKph ?? 0);
    this.renderRideStats();
  }

  private renderRideStats(): void {
    const stats = this.rideStats.getSnapshot();
    this.runTime.textContent = formatRunTime(stats.runElapsedMs);
    this.sessionTime.textContent = formatSessionMinutes(stats.sessionElapsedMs);
    this.runDistance.textContent = stats.runDistanceKm.toFixed(2);
    this.sessionDistance.textContent = stats.sessionDistanceKm.toFixed(2);
  }

  private saveCurrentRide(score: number, completed: boolean): void {
    if (!this.rideStartedAt) return;
    const snapshot = this.rideStats.getSnapshot();
    if (snapshot.runElapsedMs < 1_000 && snapshot.runDistanceKm <= 0) return;
    const now = new Date();
    const entry: RideHistoryEntry = {
      id: `${now.toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: new Date(Date.now() - (performance.now() - this.rideStartedAt)).toISOString(),
      endedAt: now.toISOString(),
      durationMs: snapshot.runElapsedMs,
      distanceKm: snapshot.runDistanceKm,
      levelId: this.selectedLevel,
      settings: { ...this.levelSettings[this.selectedLevel] },
      score,
      completed,
      powerCurve: [...this.ridePowerCurve],
    };
    saveRideHistory([entry, ...loadRideHistory()]);
    this.rideStartedAt = 0;
  }

  private totalsMarkup(label: string, totals: RideTotals): string {
    return `<div class="history-total"><strong>${escapeHtml(label)}</strong><span>${totals.rides} rides · ${(totals.durationMs / 3_600_000).toFixed(1)} h · ${totals.distanceKm.toFixed(1)} km · ${totals.averagePowerW} W avg · ${totals.maximumPowerW} W max</span></div>`;
  }

  private powerCurveMarkup(entry: RideHistoryEntry): string {
    if (entry.powerCurve.length < 2) return '<span class="fine-print">No power curve</span>';
    const maximum = Math.max(1, ...entry.powerCurve.map(({ powerW }) => powerW));
    const lastTime = Math.max(1, entry.powerCurve.at(-1)!.elapsedSeconds);
    const points = entry.powerCurve
      .map(
        ({ elapsedSeconds, powerW }) =>
          `${(elapsedSeconds / lastTime) * 180},${40 - (powerW / maximum) * 36}`,
      )
      .join(" ");
    return `<svg class="power-curve" viewBox="0 0 180 42" role="img" aria-label="Power curve"><polyline points="${points}"/></svg>`;
  }

  private showRideHistory(message?: string): void {
    const entries = loadRideHistory();
    const now = new Date();
    const current = (["day", "week", "month", "year"] as const).map((period) =>
      this.totalsMarkup(
        period === "day" ? "Today" : `This ${period}`,
        rideTotals(ridesSince(entries, startOfPeriod(period, now))),
      ),
    );
    const archives = (["day", "month", "year"] as const)
      .flatMap((unit) =>
        groupRideHistory(
          entries.filter((entry) => new Date(entry.startedAt) < startOfPeriod(unit, now)),
          unit,
        ).slice(0, unit === "day" ? 14 : 12),
      )
      .map(({ key, totals }) => this.totalsMarkup(key, totals))
      .join("");
    const recent = entries
      .slice(0, 20)
      .map(
        (entry) =>
          `<article class="history-ride"><div><strong>${escapeHtml(getLevel(entry.levelId).title)}</strong><span>${new Date(entry.startedAt).toLocaleString()} · ${(entry.durationMs / 60_000).toFixed(0)} min · ${entry.distanceKm.toFixed(2)} km · score ${entry.score}</span><small>${escapeHtml(JSON.stringify(entry.settings))}</small></div>${this.powerCurveMarkup(entry)}</article>`,
      )
      .join("");
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `<section class="panel history-panel" aria-labelledby="history-title"><p class="eyebrow">Local progress</p><h2 id="history-title">Ride history</h2>${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}<div class="history-current">${current.join("")}</div><h3>Previous periods</h3><div class="history-archive">${archives || '<p class="fine-print">No previous periods yet.</p>'}</div><h3>Recent rides</h3><div class="history-rides">${recent || '<p class="fine-print">Complete a ride to start tracking progress.</p>'}</div><input id="history-import" type="file" accept="application/json" hidden><div class="actions"><button id="history-export">Export JSON</button><button id="history-import-button">Import JSON</button><button id="history-back" class="primary">Back</button></div><p class="fine-print">History stays in this browser unless exported.</p></section>`;
    this.overlay.querySelector("#history-back")?.addEventListener("click", () => this.showHome());
    this.overlay.querySelector("#history-export")?.addEventListener("click", () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `flybike-history-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
    const input = this.overlay.querySelector<HTMLInputElement>("#history-import")!;
    this.overlay
      .querySelector("#history-import-button")
      ?.addEventListener("click", () => input.click());
    input.addEventListener("change", () => void this.importRideHistory(input));
  }

  private async importRideHistory(input: HTMLInputElement): Promise<void> {
    try {
      const file = input.files?.[0];
      if (!file) return;
      const imported = validateRideHistory(JSON.parse(await file.text()));
      const merged = new Map(loadRideHistory().map((entry) => [entry.id, entry]));
      imported.forEach((entry) => merged.set(entry.id, entry));
      saveRideHistory([...merged.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
      this.showRideHistory(`Imported ${imported.length} rides.`);
    } catch (error) {
      this.showRideHistory(error instanceof Error ? error.message : "Could not import history.");
    }
  }

  private handleStatus(status: ConnectionStatus): void {
    if (status.state === "disconnected") {
      this.trainerLoadValue = undefined;
      this.pendingTerrainGrade = undefined;
      this.lastTerrainLoadValue = undefined;
      this.terrainLoadBusy = false;
    }
    this.connectionPill.dataset.state = status.state;
    this.connectionPill.textContent =
      status.state === "connected" ? (status.deviceName ?? "Connected") : status.state;
    this.updateConnectionPillInteractivity();
    if ((status.state === "stale" || status.state === "disconnected") && this.gameActive) {
      this.pauseForSignal(status.message);
    }
  }

  private updateConnectionPillInteractivity(): void {
    const canOpenRunPanel =
      this.gameActive && !this.traceActive && !this.runPanelOpen && !this.countdownActive;
    const canOpenSettings =
      canOpenRunPanel &&
      this.source?.kind === "ftms-bluetooth" &&
      this.source.getStatus().state === "connected";
    this.connectionPill.disabled = !canOpenSettings;
    this.connectionPill.title = canOpenSettings
      ? "Pause and open bike settings"
      : "Trainer connection status";
    this.connectionPill.setAttribute(
      "aria-label",
      canOpenSettings
        ? `${this.connectionPill.textContent ?? "Trainer"}: open bike settings`
        : "Trainer connection status",
    );
    this.menuButton.classList.toggle("hidden", !this.gameActive || this.traceActive);
    this.menuButton.disabled = !canOpenRunPanel;
  }

  private showTrainerReady(status: ConnectionStatus, demo = false): void {
    this.gameActive = false;
    this.runPanelOpen = false;
    this.pauseRideStats();
    this.rideStatsPanel.classList.add("hidden");
    this.updateConnectionPillInteractivity();
    const calibrated = Boolean(this.profile);
    const loadMarkup = demo ? "" : this.trainerLoadMarkup();
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `
      <section class="panel" aria-labelledby="ready-title">
        <p class="eyebrow">${demo ? "Demo controls" : "Trainer connected"}</p>
        <h2 id="ready-title">${escapeHtml(status.deviceName ?? "Ready to fly")}</h2>
        <div class="live-readout">
          <span><strong id="setup-power">${this.latestSample.powerW ?? "—"}</strong> W</span>
          <span><strong id="setup-cadence">${this.latestSample.cadenceRpm?.toFixed(0) ?? "—"}</strong> rpm</span>
        </div>
        <p>${demo ? "Hold Space, Arrow Up, or the screen to climb. Release to descend." : calibrated ? `Cruise near ${this.profile!.cruisePowerW} W to center flight · pedal toward ${this.profile!.hardPowerW} W to climb · ease off to descend.` : "A short two-effort calibration makes flight respond to you."}</p>
        ${loadMarkup}
        <div class="actions">
          ${calibrated ? '<button id="fly-button" class="primary">Start flight</button>' : '<button id="calibrate-button" class="primary">Calibrate effort</button>'}
          ${!demo && calibrated ? '<button id="trace-button">Guided trace</button>' : ""}
          ${!demo && calibrated ? '<button id="recalibrate-button">Recalibrate</button>' : ""}
          ${!demo ? '<button id="manual-calibration-button">Enter wattages manually</button>' : ""}
          <button id="back-button">Back</button>
        </div>
      </section>`;
    const setupPower = this.overlay.querySelector("#setup-power");
    const setupCadence = this.overlay.querySelector("#setup-cadence");
    this.bindTrainerLoadControl();
    const unsubscribe = this.source?.subscribe((sample) => {
      if (setupPower && sample.powerW !== undefined) setupPower.textContent = String(sample.powerW);
      if (setupCadence && sample.cadenceRpm !== undefined)
        setupCadence.textContent = sample.cadenceRpm.toFixed(0);
    });
    this.overlay.querySelector("#fly-button")?.addEventListener("click", () => {
      unsubscribe?.();
      this.showLevelSelect();
    });
    this.overlay.querySelector("#trace-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.startRun("trace");
    });
    this.overlay.querySelector("#calibrate-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.runCalibration();
    });
    this.overlay.querySelector("#recalibrate-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.runCalibration();
    });
    this.overlay.querySelector("#manual-calibration-button")?.addEventListener("click", () => {
      unsubscribe?.();
      this.showManualCalibration(status);
    });
    this.overlay.querySelector("#back-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.source?.disconnect();
      this.showHome();
    });
  }

  private showManualCalibration(status: ConnectionStatus, message?: string): void {
    const cruise = this.profile?.cruisePowerW ?? 120;
    const hard = this.profile?.hardPowerW ?? 260;
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `
      <section class="panel small-panel" aria-labelledby="manual-calibration-title">
        <p class="eyebrow">Trainer calibration</p>
        <h2 id="manual-calibration-title">Enter wattages</h2>
        <p>Enter a comfortable sustainable effort and a controlled hard effort. These values only affect game response.</p>
        ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
        <div class="level-settings">
          <label for="manual-cruise">Cruise power (watts)</label>
          <input id="manual-cruise" type="number" min="20" max="1970" step="1" value="${cruise}">
          <label for="manual-hard">Hard power (watts)</label>
          <input id="manual-hard" type="number" min="50" max="2000" step="1" value="${hard}">
        </div>
        <p class="fine-print">Hard power must be at least 30 W above cruise power.</p>
        <div class="actions"><button id="save-manual-calibration" class="primary">Save calibration</button><button id="cancel-manual-calibration">Cancel</button></div>
      </section>`;
    this.overlay.querySelector("#save-manual-calibration")?.addEventListener("click", () => {
      try {
        if (!status.deviceId) throw new Error("The connected trainer has no device identifier.");
        const profile = createManualCalibration(
          status.deviceId,
          Number(this.overlay.querySelector<HTMLInputElement>("#manual-cruise")!.value),
          Number(this.overlay.querySelector<HTMLInputElement>("#manual-hard")!.value),
        );
        saveCalibration(profile);
        this.profile = profile;
        this.showTrainerReady(status);
      } catch (error) {
        this.showManualCalibration(
          status,
          error instanceof Error ? error.message : "Calibration could not be saved.",
        );
      }
    });
    this.overlay
      .querySelector("#cancel-manual-calibration")
      ?.addEventListener("click", () => this.showTrainerReady(status));
  }

  private trainerLoadMarkup(): string {
    const loadControl = this.source?.getLoadControl();
    if (!loadControl) {
      return '<p class="fine-print">This trainer does not advertise compatible FTMS resistance or simulation control.</p>';
    }
    const value = this.currentTrainerLoad(loadControl);
    return `<div class="load-control">
      <label for="trainer-load">${escapeHtml(loadControl.label)}: <output id="trainer-load-value">${value}${escapeHtml(loadControl.unit)}</output></label>
      <input id="trainer-load" type="range" min="${loadControl.minimum}" max="${loadControl.maximum}" step="${loadControl.increment}" value="${value}">
      <button id="apply-load">Apply load</button>
      <span id="load-status" class="fine-print">${this.trainerLoadValue === undefined ? "Applied only when you press the button; start low." : "Current setting last acknowledged by the trainer."}</span>
    </div>`;
  }

  private currentTrainerLoad(control: TrainerLoadControl): number {
    const value = this.trainerLoadValue ?? 0;
    return Math.max(control.minimum, Math.min(control.maximum, value));
  }

  private bindTrainerLoadControl(): void {
    const loadControl = this.source?.getLoadControl();
    const loadSlider = this.overlay.querySelector<HTMLInputElement>("#trainer-load");
    const loadValue = this.overlay.querySelector<HTMLOutputElement>("#trainer-load-value");
    loadSlider?.addEventListener("input", () => {
      if (loadValue && loadControl)
        loadValue.textContent = `${loadSlider.value}${loadControl.unit}`;
    });
    this.overlay.querySelector("#apply-load")?.addEventListener("click", () => {
      if (loadSlider) void this.applyTrainerLoad(Number(loadSlider.value));
    });
  }

  private showLevelSelect(): void {
    this.gameActive = false;
    this.runPanelOpen = false;
    this.pauseRideStats();
    this.rideStatsPanel.classList.add("hidden");
    this.updateConnectionPillInteractivity();
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `
      <section class="panel" aria-labelledby="level-title">
        <p class="eyebrow">Choose a flight</p>
        <h2 id="level-title">Select level</h2>
        <div class="level-list">
          ${LEVELS.map(
            (level) => `<button class="level-card" data-level="${level.id}">
              <strong>${escapeHtml(level.title)}</strong>
              <span>${escapeHtml(level.description)}</span>
            </button>`,
          ).join("")}
        </div>
        <div class="actions"><button id="level-back">Back</button></div>
      </section>`;
    for (const button of this.overlay.querySelectorAll<HTMLButtonElement>("[data-level]")) {
      button.addEventListener("click", () => {
        this.selectedLevel = button.dataset.level as LevelId;
        this.previewLevel(this.levelSettings[this.selectedLevel]);
        this.showLevelSetup();
      });
    }
    this.overlay.querySelector("#level-back")?.addEventListener("click", () => {
      this.showTrainerReady(
        this.source?.getStatus() ?? { state: "disconnected" },
        this.source?.kind === "demo",
      );
    });
  }

  private showLevelSetup(): void {
    this.rideStatsPanel.classList.add("hidden");
    const level = getLevel(this.selectedLevel);
    const settings = this.levelSettings[this.selectedLevel];
    const hasOptions = "options" in level;
    const hasModifiers = "modifiers" in level;
    const isHillClimber = this.selectedLevel === "hill-climber";
    const loadControl =
      isHillClimber && this.source?.kind === "ftms-bluetooth"
        ? this.source.getLoadControl()
        : undefined;
    const supportsTerrainLoad = Boolean(loadControl);
    const selectedScale = supportsTerrainLoad ? this.terrainResistanceScale : 0;
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `
      <section class="panel" aria-labelledby="level-setup-title">
        <p class="eyebrow">${escapeHtml(level.title)}</p>
        <h2 id="level-setup-title">Customize level</h2>
        <p>${escapeHtml(level.description)}</p>
        <div class="level-settings">
          ${isHillClimber ? `<label for="hill-length">Course length</label><select id="hill-length">${HILL_COURSE_LENGTHS.map((value) => `<option value="${value}" ${value === settings.courseLengthKm ? "selected" : ""}>${value} km</option>`).join("")}</select><label for="hill-elevation">Maximum elevation</label><select id="hill-elevation">${HILL_MAX_ELEVATIONS.map((value) => `<option value="${value}" ${value === settings.maxElevationM ? "selected" : ""}>${value.toLocaleString()} m</option>`).join("")}</select><label for="hill-steepness">Slope character</label><select id="hill-steepness">${this.choiceOptions(HILL_STEEPNESS_STYLES, settings.steepnessStyle)}</select>` : `<label for="level-map">Map</label><select id="level-map">${this.choiceOptions(level.maps, settings.mapId)}</select><label for="level-difficulty">Difficulty</label><select id="level-difficulty">${this.choiceOptions(DIFFICULTIES, settings.difficulty)}</select>`}
          ${hasOptions ? `<label for="level-option">${escapeHtml(level.optionLabel)}</label><select id="level-option">${this.choiceOptions(level.options, settings.optionId)}</select>` : ""}
          ${hasModifiers ? `<label for="level-modifier">${escapeHtml(level.modifierLabel)}</label><select id="level-modifier">${this.choiceOptions(level.modifiers, settings.modifierId)}</select>` : ""}
        </div>
        ${
          isHillClimber
            ? `<p>Virtual slope physics are always active: climbs demand more watts, while descents reward coasting and high-speed pedaling.</p>
          <div class="load-control">
            <label for="terrain-resistance">Physical terrain resistance</label>
            <select id="terrain-resistance" ${supportsTerrainLoad ? "" : "disabled"}>
              ${this.terrainEffectOptions(selectedScale)}
            </select>
            <span class="fine-print">${supportsTerrainLoad ? `Starting the level will automatically vary ${escapeHtml(loadControl!.label.toLowerCase())} with the slope. Your manual setting remains the baseline.` : "This controller does not expose compatible automatic FTMS load control."}</span>
          </div>`
            : ""
        }
        <div class="actions">
          <button id="start-level" class="primary">Start ${escapeHtml(level.title)}</button>
          <button id="level-settings-back">Levels</button>
        </div>
      </section>`;
    const previewCurrentSettings = () => {
      this.previewLevel({
        mapId: isHillClimber
          ? "rolling-meadows"
          : this.overlay.querySelector<HTMLSelectElement>("#level-map")!.value,
        difficulty: isHillClimber
          ? "standard"
          : (this.overlay.querySelector<HTMLSelectElement>("#level-difficulty")!.value as
              "relaxed" | "standard" | "expert"),
        optionId: this.overlay.querySelector<HTMLSelectElement>("#level-option")?.value,
        modifierId: this.overlay.querySelector<HTMLSelectElement>("#level-modifier")?.value,
        courseLengthKm: Number(
          this.overlay.querySelector<HTMLSelectElement>("#hill-length")?.value ?? 5,
        ),
        maxElevationM: Number(
          this.overlay.querySelector<HTMLSelectElement>("#hill-elevation")?.value ?? 1000,
        ),
        steepnessStyle: (this.overlay.querySelector<HTMLSelectElement>("#hill-steepness")?.value ??
          "mixed") as LevelSettings["steepnessStyle"],
      });
    };
    for (const select of this.overlay.querySelectorAll<HTMLSelectElement>(
      ".level-settings select",
    )) {
      select.addEventListener("change", previewCurrentSettings);
    }
    this.overlay.querySelector("#start-level")?.addEventListener("click", () => {
      this.levelSettings[this.selectedLevel] = isHillClimber
        ? {
            mapId: "rolling-meadows",
            difficulty: "standard",
            courseLengthKm: Number(
              this.overlay.querySelector<HTMLSelectElement>("#hill-length")!.value,
            ),
            maxElevationM: Number(
              this.overlay.querySelector<HTMLSelectElement>("#hill-elevation")!.value,
            ),
            steepnessStyle: this.overlay.querySelector<HTMLSelectElement>("#hill-steepness")!
              .value as LevelSettings["steepnessStyle"],
          }
        : {
            mapId: this.overlay.querySelector<HTMLSelectElement>("#level-map")!.value,
            difficulty: this.overlay.querySelector<HTMLSelectElement>("#level-difficulty")!
              .value as LevelSettings["difficulty"],
            optionId: this.overlay.querySelector<HTMLSelectElement>("#level-option")?.value,
            modifierId: this.overlay.querySelector<HTMLSelectElement>("#level-modifier")?.value,
          };
      if (isHillClimber) {
        const terrain = this.overlay.querySelector<HTMLSelectElement>("#terrain-resistance");
        this.terrainResistanceScale = supportsTerrainLoad ? Number(terrain?.value ?? 0) : 0;
      }
      void this.startRun();
    });
    this.overlay.querySelector("#level-settings-back")?.addEventListener("click", () => {
      this.showLevelSelect();
    });
  }

  private previewLevel(settings: LevelSettings): void {
    emitGameEvent("preview-level", {
      levelId: this.selectedLevel,
      settings,
    });
  }

  private choiceOptions(
    choices: readonly { id: string; label: string }[],
    selectedId?: string,
  ): string {
    return choices
      .map(
        (choice) =>
          `<option value="${escapeHtml(choice.id)}" ${choice.id === selectedId ? "selected" : ""}>${escapeHtml(choice.label)}</option>`,
      )
      .join("");
  }

  private levelSettingsSummary(levelId: LevelId): string {
    const level = getLevel(levelId);
    const settings = this.levelSettings[levelId];
    const labels = [
      level.maps.find(({ id }) => id === settings.mapId)?.label ?? settings.mapId,
      DIFFICULTIES.find(({ id }) => id === settings.difficulty)?.label ?? settings.difficulty,
    ];
    if ("options" in level) {
      labels.push(
        level.options.find(({ id }) => id === settings.optionId)?.label ??
          settings.optionId ??
          "Default",
      );
    }
    if ("modifiers" in level) {
      labels.push(
        level.modifiers.find(({ id }) => id === settings.modifierId)?.label ??
          settings.modifierId ??
          "Default",
      );
    }
    if (levelId === "hill-climber")
      labels.splice(
        0,
        labels.length,
        `${settings.courseLengthKm} km`,
        `${settings.maxElevationM} m`,
        settings.steepnessStyle ?? "mixed",
        `Terrain effect ${this.terrainResistanceScale}×`,
      );
    return labels.join(" · ");
  }

  private showGameMenu(): void {
    if (!this.gameActive || this.traceActive || this.runPanelOpen) return;
    this.runPanelOpen = true;
    this.restoreTerrainLoad();
    this.pauseRideStats();
    emitGameEvent("pause-run", { reason: "ui" });
    this.updateConnectionPillInteractivity();
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `
      <section class="panel small-panel" aria-labelledby="game-menu-title">
        <p class="eyebrow">Run paused</p>
        <h2 id="game-menu-title">Menu</h2>
        <div class="actions">
          <button id="resume-button" class="primary">Resume</button>
          <button id="levels-button">Levels</button>
          <button id="quit-button">Setup</button>
        </div>
      </section>`;
    this.overlay
      .querySelector("#resume-button")
      ?.addEventListener("click", () => void this.resumeRun());
    this.overlay.querySelector("#levels-button")?.addEventListener("click", () => {
      this.leaveRunForLevels();
    });
    this.overlay.querySelector("#quit-button")?.addEventListener("click", () => this.quitRun());
  }

  private leaveRunForLevels(): void {
    const wasTrace = this.traceActive;
    this.gameActive = false;
    this.traceActive = false;
    this.runPanelOpen = false;
    this.pauseRideStats();
    if (!wasTrace) this.saveCurrentRide(Number(this.scoreValue.textContent ?? 0), false);
    this.rideStatsPanel.classList.add("hidden");
    this.restoreTerrainLoad();
    emitGameEvent("stop-run", undefined);
    void this.releaseWakeLock();
    this.showLevelSelect();
  }

  private showBikeSettings(): void {
    if (
      !this.gameActive ||
      this.traceActive ||
      this.runPanelOpen ||
      this.source?.kind !== "ftms-bluetooth" ||
      this.source.getStatus().state !== "connected"
    ) {
      return;
    }
    this.runPanelOpen = true;
    this.restoreTerrainLoad();
    this.pauseRideStats();
    emitGameEvent("pause-run", { reason: "ui" });
    this.updateConnectionPillInteractivity();
    const status = this.source.getStatus();
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `
      <section class="panel small-panel" aria-labelledby="bike-settings-title">
        <p class="eyebrow">Flight paused</p>
        <h2 id="bike-settings-title">Bike settings</h2>
        <p>${escapeHtml(status.deviceName ?? "Connected trainer")}</p>
        ${this.trainerLoadMarkup()}
        ${this.selectedLevel === "hill-climber" ? this.inGameTerrainEffectMarkup() : ""}
        <div class="actions">
          <button id="resume-button" class="primary">Resume flight</button>
          <button id="quit-button">Quit</button>
        </div>
      </section>`;
    this.bindTrainerLoadControl();
    this.bindInGameTerrainEffectControl();
    this.overlay
      .querySelector("#resume-button")
      ?.addEventListener("click", () => void this.resumeRun());
    this.overlay.querySelector("#quit-button")?.addEventListener("click", () => this.quitRun());
  }

  private terrainEffectOptions(selectedScale: number): string {
    return [
      [0, "Off"],
      [0.5, "Gentle"],
      [1, "Standard"],
      [1.5, "Strong"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${selectedScale === value ? "selected" : ""}>${label}</option>`,
      )
      .join("");
  }

  private inGameTerrainEffectMarkup(): string {
    const supported = Boolean(this.source?.getLoadControl());
    return `<div class="load-control">
      <label for="terrain-resistance">Terrain resistance effect</label>
      <select id="terrain-resistance" ${supported ? "" : "disabled"}>
        ${this.terrainEffectOptions(supported ? this.terrainResistanceScale : 0)}
      </select>
      <span class="fine-print">Changes take effect when the climb resumes.</span>
    </div>`;
  }

  private bindInGameTerrainEffectControl(): void {
    this.overlay
      .querySelector<HTMLSelectElement>("#terrain-resistance")
      ?.addEventListener("change", (event) => {
        this.terrainResistanceScale = Number((event.currentTarget as HTMLSelectElement).value);
        if (this.terrainResistanceScale === 0) this.restoreTerrainLoad();
      });
  }

  private async applyTrainerLoad(value: number): Promise<void> {
    const button = this.overlay.querySelector<HTMLButtonElement>("#apply-load");
    const status = this.overlay.querySelector<HTMLElement>("#load-status");
    if (button) button.disabled = true;
    if (status) status.textContent = "Applying…";
    try {
      await this.source?.setTrainerLoad(value);
      const loadControl = this.source?.getLoadControl();
      this.trainerLoadValue = loadControl
        ? Math.max(loadControl.minimum, Math.min(loadControl.maximum, value))
        : value;
      if (status) status.textContent = "Trainer acknowledged the new load.";
    } catch (error) {
      if (status)
        status.textContent =
          error instanceof Error ? error.message : "Trainer load could not be changed.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  private handleTerrainGrade(gradePercent: number): void {
    if (
      !this.gameActive ||
      this.selectedLevel !== "hill-climber" ||
      this.terrainResistanceScale <= 0 ||
      this.terrainLoadFailed ||
      this.source?.kind !== "ftms-bluetooth" ||
      !this.source.getLoadControl()
    ) {
      return;
    }
    this.pendingTerrainGrade = gradePercent;
    void this.flushTerrainLoad();
  }

  private async flushTerrainLoad(): Promise<void> {
    if (this.terrainLoadBusy || this.pendingTerrainGrade === undefined) return;
    const source = this.source;
    const control = source?.getLoadControl();
    if (!source || !control) return;
    const grade = this.pendingTerrainGrade;
    this.pendingTerrainGrade = undefined;
    const target = terrainLoadTarget(
      control,
      this.currentTrainerLoad(control),
      grade,
      this.terrainResistanceScale,
    );
    if (
      this.lastTerrainLoadValue !== undefined &&
      Math.abs(target - this.lastTerrainLoadValue) < control.increment * 0.5
    ) {
      return;
    }

    this.terrainLoadBusy = true;
    // A timeout is ambiguous: the trainer may have applied the command without
    // delivering its acknowledgement. Remember the target before writing so a
    // pause or failure still attempts to restore the manual baseline.
    this.lastTerrainLoadValue = target;
    try {
      await source.setTrainerLoad(target);
    } catch (error) {
      this.terrainLoadFailed = true;
      this.terrainRestoreRequested = true;
      console.warn("Automatic terrain resistance was disabled for this run.", error);
      if (this.gameActive && this.selectedLevel === "hill-climber") {
        this.showPause(
          "Terrain resistance unavailable",
          "The trainer did not acknowledge the load change. Virtual hill physics will continue with automatic resistance off.",
        );
      }
    } finally {
      this.terrainLoadBusy = false;
      if (this.terrainRestoreRequested) this.restoreTerrainLoad();
      else if (this.pendingTerrainGrade !== undefined) void this.flushTerrainLoad();
    }
  }

  private restoreTerrainLoad(): void {
    this.pendingTerrainGrade = undefined;
    if (this.terrainLoadBusy) {
      this.terrainRestoreRequested = true;
      return;
    }
    if (this.lastTerrainLoadValue === undefined) return;
    const source = this.source;
    const control = source?.getLoadControl();
    this.terrainRestoreRequested = false;
    this.lastTerrainLoadValue = undefined;
    if (!source || !control || source.getStatus().state !== "connected") return;
    const base = this.currentTrainerLoad(control);
    this.terrainLoadBusy = true;
    void source
      .setTrainerLoad(base)
      .catch((error: unknown) => console.warn("Could not restore the manual trainer load.", error))
      .finally(() => {
        this.terrainLoadBusy = false;
        if (this.pendingTerrainGrade !== undefined) void this.flushTerrainLoad();
      });
  }

  private async runCalibration(): Promise<void> {
    const deviceId = this.source?.getStatus().deviceId;
    if (!deviceId) return;
    this.overlay.innerHTML =
      '<section class="panel"><h2 id="cal-title">Get ready</h2><p id="cal-copy">Start pedaling.</p><div class="progress"><i id="cal-progress"></i></div></section>';
    try {
      await this.countdown(3, "Comfortable effort starts in");
      const cruise = await this.collectPower(10, 3, "Pedal at a comfortable cruising effort");
      await this.countdown(5, "Easy recovery");
      const hard = await this.collectPower(8, 0, "Pedal hard, but stay controlled");
      this.profile = createCalibration(deviceId, cruise, hard);
      saveCalibration(this.profile);
      this.audio.play("start");
      this.showTrainerReady(this.source!.getStatus());
    } catch (error) {
      this.showTrainerReady(this.source!.getStatus());
      const message = error instanceof Error ? error.message : "Calibration failed.";
      const panel = this.overlay.querySelector(".panel");
      panel?.insertAdjacentHTML("afterbegin", `<p class="notice">${escapeHtml(message)}</p>`);
    }
  }

  private countdown(seconds: number, label: string): Promise<void> {
    return new Promise((resolve) => {
      let remaining = seconds;
      const title = this.overlay.querySelector<HTMLElement>("#cal-title")!;
      const copy = this.overlay.querySelector<HTMLElement>("#cal-copy")!;
      const progress = this.overlay.querySelector<HTMLElement>("#cal-progress")!;
      title.textContent = String(remaining);
      copy.textContent = label;
      progress.style.width = "0%";
      const timer = window.setInterval(() => {
        remaining -= 1;
        title.textContent = remaining > 0 ? String(remaining) : "Go";
        progress.style.width = `${((seconds - remaining) / seconds) * 100}%`;
        if (remaining <= 0) {
          window.clearInterval(timer);
          window.setTimeout(resolve, 350);
        }
      }, 1000);
    });
  }

  private collectPower(
    seconds: number,
    ignoreFirstSeconds: number,
    instruction: string,
  ): Promise<number[]> {
    return new Promise((resolve) => {
      const samples: number[] = [];
      const startedAt = performance.now();
      const title = this.overlay.querySelector<HTMLElement>("#cal-title")!;
      const copy = this.overlay.querySelector<HTMLElement>("#cal-copy")!;
      const progress = this.overlay.querySelector<HTMLElement>("#cal-progress")!;
      copy.textContent = instruction;
      this.sampleCollector = (sample) => {
        if (
          sample.powerW !== undefined &&
          sample.powerW >= 0 &&
          performance.now() - startedAt >= ignoreFirstSeconds * 1000
        ) {
          samples.push(sample.powerW);
        }
      };
      const timer = window.setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000;
        title.textContent = `${Math.max(0, Math.ceil(seconds - elapsed))}s`;
        progress.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`;
        if (elapsed >= seconds) {
          window.clearInterval(timer);
          this.sampleCollector = undefined;
          resolve(samples);
        }
      }, 100);
    });
  }

  private async startRun(mode: "game" | "trace" = "game"): Promise<void> {
    if (!this.profile || this.countdownActive) return;
    this.terrainLoadFailed = false;
    this.terrainRestoreRequested = false;
    if (this.selectedLevel !== "hill-climber") this.restoreTerrainLoad();
    this.countdownActive = true;
    this.overlay.classList.remove("hidden");
    this.overlay.classList.add("compact");
    for (let count = 3; count > 0; count -= 1) {
      this.overlay.innerHTML = `<div class="countdown" aria-live="assertive">${count}</div>`;
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
    this.overlay.classList.add("hidden");
    this.overlay.classList.remove("compact");
    this.hud.classList.remove("hidden");
    this.gameActive = true;
    this.traceActive = mode === "trace";
    this.runPanelOpen = false;
    const levelId: LevelId = mode === "trace" ? "ornithopter-run" : this.selectedLevel;
    const settings = this.levelSettings[levelId];
    this.scoreLabel.textContent = getLevel(levelId).scoreLabel;
    this.countdownActive = false;
    this.updateConnectionPillInteractivity();
    this.audio.play("start");
    await this.requestWakeLock();
    if (this.demoSource) this.demoSource.setEffort(this.demoInputPressed ? 1 : 120 / 260);
    this.beginRideStats();
    emitGameEvent("start-run", {
      profile: this.profile,
      demo: this.source?.kind === "demo",
      mode,
      levelId,
      settings,
    });
    if (this.latestSample.powerW !== undefined) {
      emitGameEvent("telemetry", {
        powerW: this.latestSample.powerW,
        cadenceRpm: this.latestSample.cadenceRpm,
        timestamp: this.latestSample.timestamp,
      });
    }
    if (mode === "trace") this.beginTraceGuide();
  }

  private pauseForSignal(message = "Trainer data paused."): void {
    if (!this.gameActive) return;
    if (this.traceActive) {
      void this.finishTrace(message);
      return;
    }
    this.showPause("Waiting for trainer", message, "signal");
  }

  private showPause(title: string, message: string, reason: "ui" | "signal" = "ui"): void {
    this.runPanelOpen = true;
    this.restoreTerrainLoad();
    this.pauseRideStats();
    emitGameEvent("pause-run", { reason });
    const needsReconnect =
      this.source?.kind === "ftms-bluetooth" && this.source.getStatus().state !== "connected";
    this.updateConnectionPillInteractivity();
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `
      <section class="panel small-panel"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>
        <div class="actions">${needsReconnect ? '<button id="reconnect-button" class="primary">Reconnect trainer</button>' : '<button id="resume-button" class="primary">Resume</button>'}<button id="quit-button">Quit</button></div>
      </section>`;
    this.overlay
      .querySelector("#resume-button")
      ?.addEventListener("click", () => void this.resumeRun());
    this.overlay
      .querySelector("#reconnect-button")
      ?.addEventListener("click", () => void this.reconnectRun());
    this.overlay.querySelector("#quit-button")?.addEventListener("click", () => this.quitRun());
  }

  private async reconnectRun(): Promise<void> {
    await this.source?.connect();
    if (this.source?.getStatus().state === "connected") await this.resumeRun();
    else
      this.showPause(
        "Connection failed",
        this.source?.getStatus().message ?? "Try connecting again.",
      );
  }

  private async resumeRun(): Promise<void> {
    if (this.source?.getStatus().state !== "connected") return;
    this.overlay.classList.add("hidden");
    await this.countInGame();
    this.runPanelOpen = false;
    emitGameEvent("resume-run", undefined);
    this.resumeRideStats();
    this.updateConnectionPillInteractivity();
  }

  private async countInGame(): Promise<void> {
    this.overlay.classList.remove("hidden");
    for (let count = 3; count > 0; count -= 1) {
      this.overlay.innerHTML = `<div class="countdown">${count}</div>`;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    this.overlay.classList.add("hidden");
  }

  private async handleGameOver(score: number, completed = false): Promise<void> {
    this.gameActive = false;
    this.runPanelOpen = false;
    this.pauseRideStats();
    this.saveCurrentRide(score, completed);
    this.restoreTerrainLoad();
    this.updateConnectionPillInteractivity();
    await this.releaseWakeLock();
    this.audio.play(completed ? "score" : "crash");
    const settings = this.levelSettings[this.selectedLevel];
    const fingerprint = settingsFingerprint(
      settings,
      this.selectedLevel === "hill-climber" ? this.terrainResistanceScale : undefined,
    );
    const scoreKey = `${SCORE_KEY}.${this.selectedLevel}.${fingerprint}`;
    const usesDefaults =
      this.selectedLevel !== "hill-climber" &&
      settingsFingerprint(settings) ===
        settingsFingerprint(defaultLevelSettings(this.selectedLevel));
    const legacyBest = usesDefaults
      ? (localStorage.getItem(`${SCORE_KEY}.${this.selectedLevel}`) ??
        (this.selectedLevel === "ornithopter-run" ? localStorage.getItem(SCORE_KEY) : null))
      : null;
    const previousBest = Number(localStorage.getItem(scoreKey) ?? legacyBest ?? 0);
    const best = Math.max(score, previousBest);
    const level = getLevel(this.selectedLevel);
    localStorage.setItem(scoreKey, String(best));
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `
      <section class="panel small-panel"><p class="eyebrow">${escapeHtml(level.title)} ${completed ? "complete" : "over"}</p><h2>${score}</h2><p>Best ${best}</p><p class="fine-print">${escapeHtml(this.levelSettingsSummary(this.selectedLevel))}</p>
        <div class="actions"><button id="again-button" class="primary">Fly again</button><button id="levels-button">Levels</button><button id="quit-button">Setup</button></div>
      </section>`;
    this.overlay
      .querySelector("#again-button")
      ?.addEventListener("click", () => void this.startRun());
    this.overlay.querySelector("#levels-button")?.addEventListener("click", () => {
      this.showLevelSelect();
    });
    this.overlay.querySelector("#quit-button")?.addEventListener("click", () => this.quitRun());
  }

  private quitRun(): void {
    const wasTrace = this.traceActive;
    this.gameActive = false;
    this.traceActive = false;
    this.runPanelOpen = false;
    this.pauseRideStats();
    if (!wasTrace) this.saveCurrentRide(Number(this.scoreValue.textContent ?? 0), false);
    this.rideStatsPanel.classList.add("hidden");
    this.restoreTerrainLoad();
    this.updateConnectionPillInteractivity();
    this.stopTraceGuide();
    this.traceCuePanel.classList.add("hidden");
    this.hud.classList.add("hidden");
    emitGameEvent("stop-run", undefined);
    void this.releaseWakeLock();
    this.showTrainerReady(
      this.source?.getStatus() ?? { state: "disconnected" },
      this.source?.kind === "demo",
    );
  }

  private beginTraceGuide(): void {
    this.traceRecords = [];
    this.tracePosition = undefined;
    this.traceStartedAt = performance.now();
    this.traceCuePanel.classList.remove("hidden");
    this.updateTraceGuide();
    this.traceGuideTimer = window.setInterval(() => this.updateTraceGuide(), 100);
  }

  private updateTraceGuide(): void {
    const elapsed = performance.now() - this.traceStartedAt;
    let stepStart = 0;
    for (const step of TRACE_STEPS) {
      const stepEnd = stepStart + step.durationMs;
      if (elapsed < stepEnd) {
        this.traceCue = step.cue;
        this.traceCueTitle.textContent = step.cue;
        this.traceCueCopy.textContent = step.instruction;
        this.traceCueProgress.style.width = `${((elapsed - stepStart) / step.durationMs) * 100}%`;
        return;
      }
      stepStart = stepEnd;
    }
    void this.finishTrace("Guided trace complete.");
  }

  private stopTraceGuide(): void {
    if (this.traceGuideTimer) window.clearInterval(this.traceGuideTimer);
    this.traceGuideTimer = undefined;
  }

  private async finishTrace(message: string): Promise<void> {
    if (!this.traceActive) return;
    this.traceActive = false;
    this.gameActive = false;
    this.runPanelOpen = false;
    this.pauseRideStats();
    this.updateConnectionPillInteractivity();
    this.stopTraceGuide();
    this.traceCuePanel.classList.add("hidden");
    this.hud.classList.add("hidden");
    emitGameEvent("stop-run", undefined);
    await this.releaseWakeLock();
    const count = this.traceRecords.length;
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `
      <section class="panel small-panel"><p class="eyebrow">Flight trace</p><h2>${escapeHtml(message)}</h2>
        <p>Recorded ${count} trainer samples. Download the CSV and attach it when you want the flight model tuned to your trainer.</p>
        <div class="actions"><button id="download-trace" class="primary" ${count ? "" : "disabled"}>Download CSV</button><button id="trace-again">Run again</button><button id="quit-button">Setup</button></div>
      </section>`;
    this.overlay
      .querySelector("#download-trace")
      ?.addEventListener("click", () => this.downloadTrace());
    this.overlay
      .querySelector("#trace-again")
      ?.addEventListener("click", () => void this.startRun("trace"));
    this.overlay.querySelector("#quit-button")?.addEventListener("click", () => this.quitRun());
  }

  private downloadTrace(): void {
    const header = [
      "elapsed_ms",
      "cue",
      "power_w",
      "cadence_rpm",
      "speed_kph",
      "trajectory_y",
      "velocity_y",
      "target_velocity_y",
      "calibrated_cruise_w",
      "calibrated_hard_w",
    ];
    const rows = this.traceRecords.map((record) =>
      [
        record.elapsedMs,
        record.cue,
        record.powerW ?? "",
        record.cadenceRpm ?? "",
        record.speedKph ?? "",
        record.trajectoryY?.toFixed(3) ?? "",
        record.velocityY?.toFixed(3) ?? "",
        record.targetVelocityY?.toFixed(3) ?? "",
        this.profile?.cruisePowerW ?? "",
        this.profile?.hardPowerW ?? "",
      ].join(","),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `flybike-trace-${new Date().toISOString().replaceAll(":", "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private setDemoInputPressed(pressed: boolean): void {
    this.demoInputPressed = pressed;
    if (!this.gameActive || !this.demoSource) return;
    this.demoSource.setEffort(pressed ? 1 : 0);
  }

  private bindDemoControls(): void {
    const setPressed = (pressed: boolean): void => this.setDemoInputPressed(pressed);
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        setPressed(true);
      }
    });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space" || event.code === "ArrowUp") setPressed(false);
    });
    window.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      setPressed(true);
    });
    window.addEventListener("pointerup", () => setPressed(false));
    window.addEventListener("pointercancel", () => setPressed(false));
  }

  private async requestWakeLock(): Promise<void> {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (wakeLock) this.wakeLock = await wakeLock.request("screen").catch(() => undefined);
  }

  private async releaseWakeLock(): Promise<void> {
    await this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = undefined;
  }
}
