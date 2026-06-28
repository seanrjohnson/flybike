export type ConnectionState =
  "unsupported" | "disconnected" | "connecting" | "connected" | "stale" | "error";

export type ConnectionStatus = {
  state: ConnectionState;
  deviceId?: string;
  deviceName?: string;
  message?: string;
};

export type TelemetrySample = {
  timestamp: number;
  powerW?: number;
  cadenceRpm?: number;
  speedKph?: number;
};

export type Unsubscribe = () => void;

export interface TrainerSource {
  readonly kind: "ftms-bluetooth" | "demo";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (sample: TelemetrySample) => void): Unsubscribe;
  subscribeStatus(listener: (status: ConnectionStatus) => void): Unsubscribe;
  getStatus(): ConnectionStatus;
}
