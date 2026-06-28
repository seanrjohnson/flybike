import { SourceBase } from "./source-base";

export class DemoSource extends SourceBase {
  readonly kind = "demo" as const;
  private timer?: number;
  // Begin at the demo profile's 120 W cruise power so the player starts level.
  private effort = 120 / 260;

  async connect(): Promise<void> {
    this.setStatus({ state: "connected", deviceId: "demo", deviceName: "Demo controls" });
    this.timer = window.setInterval(() => {
      this.emitTelemetry({
        timestamp: performance.now(),
        powerW: Math.round(this.effort * 260),
        cadenceRpm: Math.round(this.effort * 95),
        speedKph: Math.round(this.effort * 38),
      });
    }, 100);
  }

  async disconnect(): Promise<void> {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = undefined;
    this.setStatus({ state: "disconnected" });
  }

  setEffort(effort: number): void {
    this.effort = Math.max(0, Math.min(1, effort));
  }
}
