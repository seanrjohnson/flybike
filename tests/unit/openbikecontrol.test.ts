import { describe, expect, it } from "vitest";
import {
  ButtonPresses,
  decodeButtonState,
  encodeAppInfo,
  pickControllerAction,
  SUPPORTED_BUTTON_IDS,
} from "../../src/trainer/openbikecontrol";

function view(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

function press(presses: ButtonPresses, bytes: number[]): number[] {
  return presses.update(decodeButtonState(view(bytes)));
}

describe("OpenBikeControl buttons", () => {
  it("decodes button ID and state pairs", () => {
    expect(decodeButtonState(view([0x01, 0x01, 0x01, 0x02, 0x00]))).toEqual([
      { id: 0x01, state: 1 },
      { id: 0x02, state: 0 },
    ]);
  });

  it("ignores other message types and a trailing ID without a state", () => {
    expect(decodeButtonState(view([0x02, 0x01, 0x01]))).toEqual([]);
    expect(decodeButtonState(view([]))).toEqual([]);
    expect(decodeButtonState(view([0x01, 0x14, 0x01, 0x15]))).toEqual([{ id: 0x14, state: 1 }]);
  });

  it("counts several IDs pressed in one message as one press", () => {
    const presses = new ButtonPresses();
    const pressed = press(presses, [0x01, 0x01, 0x01, 0x30, 0x01, 0x14, 0x01]);
    expect(pressed).toEqual([0x01, 0x30, 0x14]);
    expect(pickControllerAction(pressed, true)).toBe("climb");
    expect(pickControllerAction(pressed, false)).toBe("confirm");
  });

  it("acts again only after held buttons are released", () => {
    const presses = new ButtonPresses();
    expect(press(presses, [0x01, 0x10, 0x01])).toEqual([0x10]);
    expect(press(presses, [0x01, 0x10, 0x01])).toEqual([]);
    expect(presses.isHeld(0x10)).toBe(true);
    expect(press(presses, [0x01, 0x10, 0x00])).toEqual([]);
    expect(presses.isHeld(0x10)).toBe(false);
    expect(press(presses, [0x01, 0x10, 0x01])).toEqual([0x10]);
  });

  it("reports only the newly pressed button when another is still held", () => {
    const presses = new ButtonPresses();
    press(presses, [0x01, 0x01, 0x01]);
    expect(press(presses, [0x01, 0x01, 0x01, 0x16, 0x01])).toEqual([0x16]);
  });

  it("forgets held buttons when cleared", () => {
    const presses = new ButtonPresses();
    press(presses, [0x01, 0x01, 0x01]);
    presses.clear();
    expect(presses.isHeld(0x01)).toBe(false);
    expect(press(presses, [0x01, 0x01, 0x01])).toEqual([0x01]);
  });

  it("prefers the menu in flight and confirm in panels", () => {
    expect(pickControllerAction([0x01, 0x16], true)).toBe("menu");
    expect(pickControllerAction([0x33], true)).toBe("menu");
    expect(pickControllerAction([0x14], true)).toBeUndefined();
    expect(pickControllerAction([0x02, 0x31, 0x15], true)).toBeUndefined();
    expect(pickControllerAction([0x10, 0x14], false)).toBe("confirm");
    expect(pickControllerAction([0x34], false)).toBe("confirm");
    expect(pickControllerAction([0x01, 0x30], false)).toBe("previous");
    expect(pickControllerAction([0x02, 0x31, 0x15], false)).toBe("next");
    expect(pickControllerAction([0x18, 0x19], false)).toBeUndefined();
    expect(pickControllerAction([], false)).toBeUndefined();
  });
});

describe("OpenBikeControl app information", () => {
  it("encodes the app ID, version, and supported button IDs", () => {
    expect([...encodeAppInfo("flybike", "0.1.0", [0x01, 0x14])]).toEqual([
      0x04,
      0x01,
      7,
      ...new TextEncoder().encode("flybike"),
      5,
      ...new TextEncoder().encode("0.1.0"),
      2,
      0x01,
      0x14,
    ]);
  });

  it("lists every button ID the game acts on once", () => {
    expect(new Set(SUPPORTED_BUTTON_IDS).size).toBe(SUPPORTED_BUTTON_IDS.length);
    expect(SUPPORTED_BUTTON_IDS).toEqual(
      expect.arrayContaining([0x01, 0x02, 0x10, 0x11, 0x14, 0x16, 0x30, 0x31, 0x33, 0x34]),
    );
  });
});
