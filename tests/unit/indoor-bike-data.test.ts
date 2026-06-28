import { describe, expect, it } from "vitest";
import { decodeIndoorBikeData, PacketDecodeError } from "../../src/trainer/indoor-bike-data";

function packet(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

describe("decodeIndoorBikeData", () => {
  it("decodes speed, cadence, and signed instantaneous power", () => {
    const result = decodeIndoorBikeData(
      packet([0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00]),
      42,
    );
    expect(result).toEqual({ timestamp: 42, speedKph: 25, cadenceRpm: 90, powerW: 250 });
  });

  it("handles a packet where instantaneous speed is omitted", () => {
    const result = decodeIndoorBikeData(packet([0x41, 0x00, 0x9c, 0xff]), 7);
    expect(result).toEqual({ timestamp: 7, powerW: -100 });
  });

  it("walks optional fields in FTMS order", () => {
    const flags = 0x0fff;
    const bytes = [
      flags & 0xff,
      flags >> 8,
      0x10,
      0x27,
      0xb4,
      0x00,
      0xb0,
      0x00,
      1,
      2,
      3,
      5,
      0,
      200,
      0,
      190,
      0,
      1,
      0,
      2,
      0,
      3,
      120,
      8,
      10,
      0,
    ];
    expect(decodeIndoorBikeData(packet(bytes), 1)).toMatchObject({
      timestamp: 1,
      cadenceRpm: 90,
      powerW: 200,
    });
  });

  it("rejects truncated data", () => {
    expect(() => decodeIndoorBikeData(packet([0x40, 0x00, 0x10]))).toThrow(PacketDecodeError);
  });
});
