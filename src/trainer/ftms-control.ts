import type { TrainerLoadControl } from "./types";

export type FtmsTargetFeatures = {
  supportsResistance: boolean;
  supportsSimulation: boolean;
};

export function decodeTargetFeatures(value: DataView): FtmsTargetFeatures {
  if (value.byteLength < 8) return { supportsResistance: false, supportsSimulation: false };
  const flags = value.getUint32(4, true);
  return {
    supportsResistance: (flags & (1 << 2)) !== 0,
    supportsSimulation: (flags & (1 << 13)) !== 0,
  };
}

export function decodeResistanceRange(value: DataView): TrainerLoadControl | undefined {
  if (value.byteLength < 6) return undefined;
  const minimum = value.getInt16(0, true) * 0.1;
  const maximum = value.getInt16(2, true) * 0.1;
  const increment = Math.max(0.1, value.getUint16(4, true) * 0.1);
  if (!Number.isFinite(minimum) || maximum <= minimum) return undefined;
  return {
    mode: "resistance",
    label: "Resistance level",
    unit: "",
    minimum,
    maximum,
    increment,
  };
}

export function encodeResistanceTarget(value: number): Uint8Array {
  const command = new Uint8Array(3);
  const view = new DataView(command.buffer);
  view.setUint8(0, 0x04);
  view.setInt16(1, Math.round(value / 0.1), true);
  return command;
}

export function encodeSimulationGrade(gradePercent: number): Uint8Array {
  const command = new Uint8Array(7);
  const view = new DataView(command.buffer);
  view.setUint8(0, 0x11);
  view.setInt16(1, 0, true); // wind speed, 0.001 m/s
  view.setInt16(3, Math.round(gradePercent / 0.01), true);
  view.setUint8(5, 40); // rolling resistance coefficient 0.004
  view.setUint8(6, 51); // wind resistance coefficient 0.51 kg/m
  return command;
}
