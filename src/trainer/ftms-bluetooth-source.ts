import { decodeIndoorBikeData, PacketDecodeError } from "./indoor-bike-data";
import {
  decodeResistanceRange,
  decodeTargetFeatures,
  encodeResistanceTarget,
  encodeSimulationGrade,
} from "./ftms-control";
import { SourceBase } from "./source-base";
import type { TrainerLoadControl } from "./types";

const FTMS_SERVICE = "00001826-0000-1000-8000-00805f9b34fb";
const INDOOR_BIKE_DATA = "00002ad2-0000-1000-8000-00805f9b34fb";
const FITNESS_MACHINE_FEATURE = "00002acc-0000-1000-8000-00805f9b34fb";
const FITNESS_MACHINE_CONTROL_POINT = "00002ad9-0000-1000-8000-00805f9b34fb";
const SUPPORTED_RESISTANCE_RANGE = "00002ad6-0000-1000-8000-00805f9b34fb";

type PendingControlCommand = {
  opcode: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
};

export class FtmsBluetoothSource extends SourceBase {
  readonly kind = "ftms-bluetooth" as const;
  private device?: BluetoothDevice;
  private characteristic?: BluetoothRemoteGATTCharacteristic;
  private controlPoint?: BluetoothRemoteGATTCharacteristic;
  private loadControl?: TrainerLoadControl;
  private pendingControlCommand?: PendingControlCommand;
  private controlGranted = false;
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
      await this.discoverLoadControl(service);

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
    if (this.controlPoint) {
      this.controlPoint.removeEventListener(
        "characteristicvaluechanged",
        this.handleControlResponse,
      );
      if (this.controlPoint.service.device.gatt?.connected) {
        await this.controlPoint.stopNotifications().catch(() => undefined);
      }
    }
    this.rejectPendingControlCommand(new Error("Trainer disconnected."));
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    this.device?.gatt?.disconnect();
    this.characteristic = undefined;
    this.controlPoint = undefined;
    this.loadControl = undefined;
    this.controlGranted = false;
    this.device = undefined;
    this.setStatus({ state: "disconnected" });
  }

  getLoadControl(): TrainerLoadControl | undefined {
    return this.loadControl;
  }

  async setTrainerLoad(value: number): Promise<void> {
    const capability = this.loadControl;
    if (!capability || !this.controlPoint) {
      throw new Error("This trainer does not advertise compatible FTMS load control.");
    }
    const clamped = Math.max(capability.minimum, Math.min(capability.maximum, value));
    if (!this.controlGranted) {
      await this.writeControlCommand(new Uint8Array([0x00]), 0x00);
      this.controlGranted = true;
    }

    if (capability.mode === "resistance") {
      await this.writeControlCommand(encodeResistanceTarget(clamped), 0x04);
      return;
    }

    await this.writeControlCommand(encodeSimulationGrade(clamped), 0x11);
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
    this.rejectPendingControlCommand(new Error("Trainer disconnected."));
    this.characteristic = undefined;
    this.setStatus({
      state: "disconnected",
      deviceId: this.device?.id,
      deviceName: this.device?.name,
      message: "Trainer disconnected. Reconnect when it is available.",
    });
  };

  private readonly handleControlResponse = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    const pending = this.pendingControlCommand;
    if (!value || value.byteLength < 3 || value.getUint8(0) !== 0x80 || !pending) return;
    if (value.getUint8(1) !== pending.opcode) return;
    window.clearTimeout(pending.timeout);
    this.pendingControlCommand = undefined;
    const result = value.getUint8(2);
    if (result === 0x01) pending.resolve();
    else pending.reject(new Error(this.controlResultMessage(result)));
  };

  private async discoverLoadControl(service: BluetoothRemoteGATTService): Promise<void> {
    this.loadControl = undefined;
    try {
      const feature = await service.getCharacteristic(FITNESS_MACHINE_FEATURE);
      const featureValue = await feature.readValue();
      const { supportsResistance, supportsSimulation } = decodeTargetFeatures(featureValue);
      if (!(supportsResistance || supportsSimulation)) return;

      this.controlPoint = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT);
      this.controlPoint.addEventListener("characteristicvaluechanged", this.handleControlResponse);
      await this.controlPoint.startNotifications();

      if (supportsResistance) {
        try {
          const rangeCharacteristic = await service.getCharacteristic(SUPPORTED_RESISTANCE_RANGE);
          const range = await rangeCharacteristic.readValue();
          const resistanceRange = decodeResistanceRange(range);
          if (resistanceRange) {
            this.loadControl = resistanceRange;
            return;
          }
        } catch {
          // A trainer may advertise resistance but omit a usable range; try simulation instead.
        }
      }

      if (supportsSimulation) {
        this.loadControl = {
          mode: "simulation-grade",
          label: "Simulated grade",
          unit: "%",
          minimum: 0,
          maximum: 8,
          increment: 0.5,
        };
      }
    } catch {
      this.controlPoint = undefined;
      this.loadControl = undefined;
    }
  }

  private writeControlCommand(command: Uint8Array, opcode: number): Promise<void> {
    if (!this.controlPoint) return Promise.reject(new Error("FTMS control point unavailable."));
    if (this.pendingControlCommand) {
      return Promise.reject(new Error("Another trainer control command is still running."));
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingControlCommand = undefined;
        reject(new Error("Trainer did not acknowledge the control command."));
      }, 3_000);
      this.pendingControlCommand = { opcode, resolve, reject, timeout };
      this.controlPoint!.writeValueWithResponse(command).catch((error: unknown) => {
        this.rejectPendingControlCommand(
          error instanceof Error ? error : new Error("Trainer control write failed."),
        );
      });
    });
  }

  private rejectPendingControlCommand(error: Error): void {
    if (!this.pendingControlCommand) return;
    window.clearTimeout(this.pendingControlCommand.timeout);
    const { reject } = this.pendingControlCommand;
    this.pendingControlCommand = undefined;
    reject(error);
  }

  private controlResultMessage(result: number): string {
    const messages: Record<number, string> = {
      0x02: "Trainer does not support that control command.",
      0x03: "Trainer rejected the requested load value.",
      0x04: "Trainer could not apply the requested load.",
      0x05: "Trainer control is not permitted.",
    };
    return messages[result] ?? `Trainer returned control error 0x${result.toString(16)}.`;
  }

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
