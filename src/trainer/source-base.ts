import type {
  ConnectionStatus,
  TelemetrySample,
  TrainerLoadControl,
  TrainerSource,
  Unsubscribe,
} from "./types";

export abstract class SourceBase implements TrainerSource {
  abstract readonly kind: "ftms-bluetooth" | "demo";
  protected status: ConnectionStatus = { state: "disconnected" };
  private readonly telemetryListeners = new Set<(sample: TelemetrySample) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getLoadControl(): TrainerLoadControl | undefined;
  abstract setTrainerLoad(value: number): Promise<void>;

  subscribe(listener: (sample: TelemetrySample) => void): Unsubscribe {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  protected emitTelemetry(sample: TelemetrySample): void {
    this.telemetryListeners.forEach((listener) => listener(sample));
  }

  protected setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}
