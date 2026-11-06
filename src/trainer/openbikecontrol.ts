export const OBC_SERVICE = "d273f680-d548-419d-b9d1-fa0472345229";
export const OBC_BUTTON_STATE = "d273f681-d548-419d-b9d1-fa0472345229";
export const OBC_APP_INFO = "d273f683-d548-419d-b9d1-fa0472345229";

export type ControllerAction = "climb" | "menu" | "confirm" | "previous" | "next";

export type ButtonChange = { id: number; state: number };

// Button IDs per action in priority order. A controller may send several IDs for one press, such
// as Shift Up + Increase Difficulty + Select, so the first matching action wins.
const FLIGHT_ACTIONS: ReadonlyArray<readonly [ControllerAction, readonly number[]]> = [
  ["menu", [0x16, 0x33]],
  ["climb", [0x01, 0x10, 0x30]],
];
const PANEL_ACTIONS: ReadonlyArray<readonly [ControllerAction, readonly number[]]> = [
  ["confirm", [0x14, 0x34]],
  ["previous", [0x10, 0x12, 0x01, 0x30]],
  ["next", [0x11, 0x13, 0x02, 0x31]],
];

export const SUPPORTED_BUTTON_IDS = [
  ...new Set([...FLIGHT_ACTIONS, ...PANEL_ACTIONS].flatMap(([, ids]) => ids)),
];

export function decodeButtonState(value: DataView): ButtonChange[] {
  if (value.byteLength < 1 || value.getUint8(0) !== 0x01) return [];
  const changes: ButtonChange[] = [];
  // A trailing ID without a state is ignored.
  for (let offset = 1; offset + 1 < value.byteLength; offset += 2) {
    changes.push({ id: value.getUint8(offset), state: value.getUint8(offset + 1) });
  }
  return changes;
}

export function encodeAppInfo(appId: string, appVersion: string, buttonIds: number[]): Uint8Array {
  const text = (value: string) => {
    const bytes = [...new TextEncoder().encode(value)].slice(0, 32);
    return [bytes.length, ...bytes];
  };
  return Uint8Array.from([
    0x04,
    0x01,
    ...text(appId),
    ...text(appVersion),
    buttonIds.length,
    ...buttonIds,
  ]);
}

export function pickControllerAction(
  pressedIds: readonly number[],
  inFlight: boolean,
): ControllerAction | undefined {
  const actions = inFlight ? FLIGHT_ACTIONS : PANEL_ACTIONS;
  return actions.find(([, ids]) => ids.some((id) => pressedIds.includes(id)))?.[0];
}

/** Tracks held buttons so IDs newly pressed in one message count as a single press. */
export class ButtonPresses {
  private readonly held = new Set<number>();

  /** Returns the IDs newly pressed by one button state message. */
  update(changes: readonly ButtonChange[]): number[] {
    const pressed: number[] = [];
    for (const { id, state } of changes) {
      if (state === 0) this.held.delete(id);
      else if (!this.held.has(id)) {
        this.held.add(id);
        pressed.push(id);
      }
    }
    return pressed;
  }

  isHeld(id: number): boolean {
    return this.held.has(id);
  }

  clear(): void {
    this.held.clear();
  }
}
