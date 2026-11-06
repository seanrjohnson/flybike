import { version } from "../../package.json";
import {
  ButtonPresses,
  decodeButtonState,
  encodeAppInfo,
  OBC_APP_INFO,
  OBC_BUTTON_STATE,
  OBC_SERVICE,
  SUPPORTED_BUTTON_IDS,
} from "./openbikecontrol";
import type { ConnectionStatus } from "./types";

/** An OpenBikeControl ride controller or remote. It only sends button input; it is not a trainer. */
export class OpenBikeControlBluetooth {
  private device?: BluetoothDevice;
  private characteristic?: BluetoothRemoteGATTCharacteristic;
  private readonly presses = new ButtonPresses();
  private status: ConnectionStatus = { state: "disconnected" };

  /**
   * `onButtons` receives the IDs newly pressed by each button message. It is also called with no
   * IDs when buttons are released or the link drops, so held actions can check `isHeld`.
   */
  constructor(
    private readonly onButtons: (pressedIds: number[]) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isHeld(id: number): boolean {
    return this.presses.isHeld(id);
  }

  async connect(): Promise<void> {
    if (!("bluetooth" in navigator)) {
      this.setStatus({ state: "unsupported", message: "Web Bluetooth is unavailable." });
      return;
    }
    await this.release();
    this.setStatus({ state: "connecting", message: "Choose your OpenBikeControl controller…" });

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [OBC_SERVICE] }],
      });
      this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);
      const server = await this.device.gatt?.connect();
      if (!server) throw new Error("The controller did not expose a GATT server.");

      const service = await server.getPrimaryService(OBC_SERVICE);
      this.characteristic = await service.getCharacteristic(OBC_BUTTON_STATE);
      this.characteristic.addEventListener("characteristicvaluechanged", this.handleData);
      await this.characteristic.startNotifications();
      try {
        // App Information is optional; a controller without it still sends every button.
        const appInfo = await service.getCharacteristic(OBC_APP_INFO);
        await appInfo.writeValueWithResponse(
          encodeAppInfo("flybike", version, SUPPORTED_BUTTON_IDS),
        );
      } catch (error) {
        console.warn("OpenBikeControl app information not sent", error);
      }

      this.setStatus({
        state: "connected",
        deviceId: this.device.id,
        deviceName: this.device.name ?? "OpenBikeControl controller",
      });
    } catch (error) {
      const canceled = error instanceof DOMException && error.name === "NotFoundError";
      await this.release();
      this.setStatus({
        state: canceled ? "disconnected" : "error",
        message: canceled
          ? "No controller selected."
          : error instanceof Error
            ? error.message
            : "Could not connect to the controller.",
      });
    }
  }

  async disconnect(): Promise<void> {
    await this.release();
    this.setStatus({ state: "disconnected" });
  }

  private async release(): Promise<void> {
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
    this.releaseButtons();
  }

  private readonly handleData = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) this.onButtons(this.presses.update(decodeButtonState(value)));
  };

  private readonly handleDisconnect = (): void => {
    this.characteristic = undefined;
    this.releaseButtons();
    this.setStatus({
      state: "disconnected",
      deviceName: this.device?.name,
      message: "Controller disconnected.",
    });
  };

  // A release lost with the link must not leave a held action running.
  private releaseButtons(): void {
    this.presses.clear();
    this.onButtons([]);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
