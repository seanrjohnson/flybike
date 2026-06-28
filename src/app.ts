import {
  createCalibration,
  loadCalibration,
  saveCalibration,
  type CalibrationProfile,
} from "./calibration";
import { GameAudio } from "./game/audio";
import { emitGameEvent, gameEvents } from "./game/events";
import { DemoSource } from "./trainer/demo-source";
import { FtmsBluetoothSource } from "./trainer/ftms-bluetooth-source";
import type { ConnectionStatus, TelemetrySample, TrainerSource } from "./trainer/types";

const SCORE_KEY = "flybike.highScore.v1";

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
  private wakeLock?: WakeLockSentinelLike;
  private readonly audio = new GameAudio();

  private readonly overlay = document.querySelector<HTMLElement>("#overlay")!;
  private readonly hud = document.querySelector<HTMLElement>("#hud")!;
  private readonly powerValue = document.querySelector<HTMLElement>("#power-value")!;
  private readonly cadenceValue = document.querySelector<HTMLElement>("#cadence-value")!;
  private readonly speedValue = document.querySelector<HTMLElement>("#speed-value")!;
  private readonly scoreValue = document.querySelector<HTMLElement>("#score-value")!;
  private readonly connectionPill = document.querySelector<HTMLElement>("#connection-pill")!;
  private readonly muteButton = document.querySelector<HTMLButtonElement>("#mute-button")!;

  constructor() {
    this.muteButton.textContent = this.audio.isMuted() ? "Sound off" : "Sound on";
    this.muteButton.addEventListener("click", () => {
      this.muteButton.textContent = this.audio.toggle() ? "Sound off" : "Sound on";
    });
    gameEvents.addEventListener("score", (event) => {
      const score = (event as CustomEvent<number>).detail;
      this.scoreValue.textContent = String(score);
      if (score > 0) this.audio.play("score");
    });
    gameEvents.addEventListener("game-over", (event) => {
      void this.handleGameOver((event as CustomEvent<number>).detail);
    });
    gameEvents.addEventListener("signal-stale", () => this.pauseForSignal());
    gameEvents.addEventListener("signal-returned", () => {
      if (this.gameActive) this.showPause("Signal restored", "Resume when you are ready.");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.gameActive) this.showPause("Paused", "The game lost focus.");
    });
    this.bindDemoControls();
    this.showHome();
  }

  private showHome(message?: string): void {
    this.gameActive = false;
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
        </div>
        <p class="fine-print">Bluetooth requires Chrome or Edge on desktop/Android. Close other trainer apps first.</p>
      </section>`;
    this.overlay
      .querySelector("#connect-button")
      ?.addEventListener("click", () => void this.connectTrainer());
    this.overlay
      .querySelector("#demo-button")
      ?.addEventListener("click", () => void this.startDemo());
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
    this.speedValue.textContent = sample.speedKph === undefined ? "—" : sample.speedKph.toFixed(1);
    this.sampleCollector?.(sample);
    if (this.gameActive && sample.powerW !== undefined) {
      emitGameEvent("telemetry", {
        powerW: Math.max(0, sample.powerW),
        timestamp: sample.timestamp,
      });
    }
  }

  private handleStatus(status: ConnectionStatus): void {
    this.connectionPill.dataset.state = status.state;
    this.connectionPill.textContent =
      status.state === "connected" ? (status.deviceName ?? "Connected") : status.state;
    if ((status.state === "stale" || status.state === "disconnected") && this.gameActive) {
      this.pauseForSignal(status.message);
    }
  }

  private showTrainerReady(status: ConnectionStatus, demo = false): void {
    const calibrated = Boolean(this.profile);
    this.overlay.classList.remove("hidden", "compact");
    this.overlay.innerHTML = `
      <section class="panel" aria-labelledby="ready-title">
        <p class="eyebrow">${demo ? "Demo controls" : "Trainer connected"}</p>
        <h2 id="ready-title">${escapeHtml(status.deviceName ?? "Ready to fly")}</h2>
        <div class="live-readout">
          <span><strong id="setup-power">${this.latestSample.powerW ?? "—"}</strong> W</span>
          <span><strong id="setup-cadence">${this.latestSample.cadenceRpm?.toFixed(0) ?? "—"}</strong> rpm</span>
        </div>
        <p>${demo ? "Hold Space, Arrow Up, or the screen to climb. Release to descend." : calibrated ? `Cruise ${this.profile!.cruisePowerW} W · Hard ${this.profile!.hardPowerW} W` : "A short two-effort calibration makes flight respond to you."}</p>
        <div class="actions">
          ${calibrated ? '<button id="fly-button" class="primary">Start flight</button>' : '<button id="calibrate-button" class="primary">Calibrate effort</button>'}
          ${!demo && calibrated ? '<button id="recalibrate-button">Recalibrate</button>' : ""}
          <button id="back-button">Back</button>
        </div>
      </section>`;
    const setupPower = this.overlay.querySelector("#setup-power");
    const setupCadence = this.overlay.querySelector("#setup-cadence");
    const unsubscribe = this.source?.subscribe((sample) => {
      if (setupPower && sample.powerW !== undefined) setupPower.textContent = String(sample.powerW);
      if (setupCadence && sample.cadenceRpm !== undefined)
        setupCadence.textContent = sample.cadenceRpm.toFixed(0);
    });
    this.overlay.querySelector("#fly-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.startRun();
    });
    this.overlay.querySelector("#calibrate-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.runCalibration();
    });
    this.overlay.querySelector("#recalibrate-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.runCalibration();
    });
    this.overlay.querySelector("#back-button")?.addEventListener("click", () => {
      unsubscribe?.();
      void this.source?.disconnect();
      this.showHome();
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

  private async startRun(): Promise<void> {
    if (!this.profile || this.countdownActive) return;
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
    this.countdownActive = false;
    this.audio.play("start");
    await this.requestWakeLock();
    if (this.demoSource) this.demoSource.setEffort(this.demoInputPressed ? 1 : 120 / 260);
    emitGameEvent("start-run", { profile: this.profile, demo: this.source?.kind === "demo" });
    if (this.latestSample.powerW !== undefined) {
      emitGameEvent("telemetry", {
        powerW: this.latestSample.powerW,
        timestamp: this.latestSample.timestamp,
      });
    }
  }

  private pauseForSignal(message = "Trainer data paused."): void {
    if (!this.gameActive) return;
    emitGameEvent("pause-run", undefined);
    this.showPause("Waiting for trainer", message);
  }

  private showPause(title: string, message: string): void {
    emitGameEvent("pause-run", undefined);
    const needsReconnect =
      this.source?.kind === "ftms-bluetooth" && this.source.getStatus().state !== "connected";
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
    emitGameEvent("resume-run", undefined);
  }

  private async countInGame(): Promise<void> {
    this.overlay.classList.remove("hidden");
    for (let count = 3; count > 0; count -= 1) {
      this.overlay.innerHTML = `<div class="countdown">${count}</div>`;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    this.overlay.classList.add("hidden");
  }

  private async handleGameOver(score: number): Promise<void> {
    this.gameActive = false;
    await this.releaseWakeLock();
    this.audio.play("crash");
    const previousBest = Number(localStorage.getItem(SCORE_KEY) ?? 0);
    const best = Math.max(score, previousBest);
    localStorage.setItem(SCORE_KEY, String(best));
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `
      <section class="panel small-panel"><p class="eyebrow">Flight over</p><h2>${score}</h2><p>Best ${best}</p>
        <div class="actions"><button id="again-button" class="primary">Fly again</button><button id="quit-button">Setup</button></div>
      </section>`;
    this.overlay
      .querySelector("#again-button")
      ?.addEventListener("click", () => void this.startRun());
    this.overlay.querySelector("#quit-button")?.addEventListener("click", () => this.quitRun());
  }

  private quitRun(): void {
    this.gameActive = false;
    this.hud.classList.add("hidden");
    void this.releaseWakeLock();
    this.showTrainerReady(
      this.source?.getStatus() ?? { state: "disconnected" },
      this.source?.kind === "demo",
    );
  }

  private bindDemoControls(): void {
    const setPressed = (pressed: boolean): void => {
      this.demoInputPressed = pressed;
      if (!this.gameActive || !this.demoSource) return;
      this.demoSource.setEffort(pressed ? 1 : 0);
    };
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
