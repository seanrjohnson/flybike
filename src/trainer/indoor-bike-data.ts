import type { TelemetrySample } from "./types";

export class PacketDecodeError extends Error {}

type Cursor = { offset: number };

function requireBytes(view: DataView, cursor: Cursor, count: number): void {
  if (cursor.offset + count > view.byteLength) {
    throw new PacketDecodeError("Truncated FTMS Indoor Bike Data packet");
  }
}

function skip(view: DataView, cursor: Cursor, count: number): void {
  requireBytes(view, cursor, count);
  cursor.offset += count;
}

function uint8(view: DataView, cursor: Cursor): number {
  requireBytes(view, cursor, 1);
  return view.getUint8(cursor.offset++);
}

function uint16(view: DataView, cursor: Cursor): number {
  requireBytes(view, cursor, 2);
  const value = view.getUint16(cursor.offset, true);
  cursor.offset += 2;
  return value;
}

function int16(view: DataView, cursor: Cursor): number {
  requireBytes(view, cursor, 2);
  const value = view.getInt16(cursor.offset, true);
  cursor.offset += 2;
  return value;
}

export function decodeIndoorBikeData(
  view: DataView,
  timestamp = performance.now(),
): TelemetrySample {
  if (view.byteLength < 2) throw new PacketDecodeError("Missing FTMS flags");

  const flags = view.getUint16(0, true);
  const cursor = { offset: 2 };
  const sample: TelemetrySample = { timestamp };

  // FTMS calls bit 0 "More Data": zero means instantaneous speed is present.
  if ((flags & (1 << 0)) === 0) sample.speedKph = uint16(view, cursor) * 0.01;
  if (flags & (1 << 1)) skip(view, cursor, 2); // average speed
  if (flags & (1 << 2)) sample.cadenceRpm = uint16(view, cursor) * 0.5;
  if (flags & (1 << 3)) skip(view, cursor, 2); // average cadence
  if (flags & (1 << 4)) skip(view, cursor, 3); // total distance
  if (flags & (1 << 5)) skip(view, cursor, 2); // resistance level
  if (flags & (1 << 6)) sample.powerW = int16(view, cursor);
  if (flags & (1 << 7)) skip(view, cursor, 2); // average power
  if (flags & (1 << 8)) {
    skip(view, cursor, 2); // total energy
    skip(view, cursor, 2); // energy per hour
    uint8(view, cursor); // energy per minute
  }
  if (flags & (1 << 9)) uint8(view, cursor); // heart rate
  if (flags & (1 << 10)) uint8(view, cursor); // metabolic equivalent
  if (flags & (1 << 11)) skip(view, cursor, 2); // elapsed time
  if (flags & (1 << 12)) skip(view, cursor, 2); // remaining time

  return sample;
}
