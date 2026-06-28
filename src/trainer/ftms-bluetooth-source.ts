import { decodeIndoorBikeData, PacketDecodeError } from "./indoor-bike-data";
import { SourceBase } from "./source-base";

const FTMS_SERVICE = "00001826-0000-1000-8000-00805f9b34fb";
const INDOOR_BIKE_DATA = "00002ad2-0000-1000-8000-00805f9b34fb";

export class FtmsBluetoothSource extends SourceBase {
  readonly kind = "ftms-bluetooth" as const;
  private device?: BluetoothDevice;
  private characteristic?: BluetoothRemoteGATTCharacteristic;
  private staleTimer?: number;
  private disconnectTimer?: number;
  private lastSampleAt = 0;

  constructor() {
    super();
    if (!("bluetooth" in navigator)) {
      this.status = {
        state: "unsupported",
        message: "Web Bluetooth is unavailable. Use Chrome or Edge on desktop or Android.",
      };
    }
  }

  async connect(): Promise<void> {
    if (!("bluetooth" in navigator)) {
      this.setStatus({ state: "unsupported", message: "Web Bluetooth is unavailable." });
      return;
    }

    this.setStatus({ state: "connecting", message: "Choose your FTMS trainer…" });

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE] }],
      });
      this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);
      const server = await this.device.gatt?.connect();
      if (!server) throw new Error("The trainer did not expose a GATT server.");

      const service = await server.getPrimaryService(FTMS_SERVICE);
      this.characteristic = await service.getCharacteristic(INDOOR_BIKE_DATA);
      this.characteristic.addEventListener("characteristicvaluechanged", this.handleData);
      await this.characteristic.startNotifications();

      this.lastSampleAt = performance.now();
      this.startHealthCheck();
      this.setStatus({
        state: "connected",
        deviceId: this.device.id,
        deviceName: this.device.name ?? "FTMS trainer",
      });
    } catch (error) {
      const canceled = error instanceof DOMException && error.name === "NotFoundError";
      this.setStatus({
        state: canceled ? "disconnected" : "error",
        message: canceled
          ? "No trainer selected."
          : error instanceof Error
            ? error.message
            : "Could not connect to the trainer.",
      });
    }
  }

  async disconnect(): Promise<void> {
    this.stopHealthCheck();
    if (this.characteristic) {
      this.characteristic.removeEventListener("characteristicvaluechanged", this.handleData);
      if (this.characteristic.service.device.gatt?.connected) {
        await this.characteristic.stopNotifications().catch(() => undefined);
      }
    }
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    this.device?.gatt?.disconnect();
    this.characteristic = undefined;
    this.device = undefined;
    this.setStatus({ state: "disconnected" });
  }

  private readonly handleData = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;

    try {
      const sample = decodeIndoorBikeData(value, performance.now());
      this.lastSampleAt = sample.timestamp;
      if (this.status.state === "stale") {
        this.setStatus({
          state: "connected",
          deviceId: this.device?.id,
          deviceName: this.device?.name ?? "FTMS trainer",
        });
      }
      this.emitTelemetry(sample);
    } catch (error) {
      if (!(error instanceof PacketDecodeError)) console.warn("Unexpected FTMS error", error);
    }
  };

  private readonly handleDisconnect = (): void => {
    this.stopHealthCheck();
    this.characteristic = undefined;
    this.setStatus({
      state: "disconnected",
      deviceId: this.device?.id,
      deviceName: this.device?.name,
      message: "Trainer disconnected. Reconnect when it is available.",
    });
  };

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.staleTimer = window.setInterval(() => {
      const elapsed = performance.now() - this.lastSampleAt;
      if (elapsed > 10_000) {
        this.disconnectTimer ??= window.setTimeout(() => this.handleDisconnect(), 0);
      } else if (elapsed > 2_000 && this.status.state === "connected") {
        this.setStatus({
          state: "stale",
          deviceId: this.device?.id,
          deviceName: this.device?.name,
          message: "Waiting for trainer data…",
        });
      }
    }, 500);
  }

  private stopHealthCheck(): void {
    if (this.staleTimer) window.clearInterval(this.staleTimer);
    if (this.disconnectTimer) window.clearTimeout(this.disconnectTimer);
    this.staleTimer = undefined;
    this.disconnectTimer = undefined;
  }
}
