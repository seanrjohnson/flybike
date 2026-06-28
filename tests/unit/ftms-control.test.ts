import { describe, expect, it } from "vitest";
import {
  decodeResistanceRange,
  decodeTargetFeatures,
  encodeResistanceTarget,
  encodeSimulationGrade,
} from "../../src/trainer/ftms-control";

function view(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

describe("FTMS control encoding", () => {
  it("detects resistance and simulation target feature bits", () => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setUint32(4, (1 << 2) | (1 << 13), true);
    expect(decodeTargetFeatures(new DataView(bytes.buffer))).toEqual({
      supportsResistance: true,
      supportsSimulation: true,
    });
  });

  it("decodes the signed 0.1-resolution resistance range", () => {
    const bytes = new Uint8Array(6);
    const range = new DataView(bytes.buffer);
    range.setInt16(0, 0, true);
    range.setInt16(2, 1000, true);
    range.setUint16(4, 10, true);
    expect(decodeResistanceRange(range)).toMatchObject({
      minimum: 0,
      maximum: 100,
      increment: 1,
    });
  });

  it("encodes target resistance as opcode 0x04 and signed tenths", () => {
    expect([...encodeResistanceTarget(12.5)]).toEqual([0x04, 0x7d, 0x00]);
  });

  it("encodes a bounded simulation grade command", () => {
    const command = encodeSimulationGrade(4.5);
    expect(command[0]).toBe(0x11);
    expect(view([...command]).getInt16(3, true)).toBe(450);
    expect(command[5]).toBe(40);
    expect(command[6]).toBe(51);
  });
});
