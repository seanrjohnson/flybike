export type CalibrationProfile = {
  deviceId: string;
  cruisePowerW: number;
  hardPowerW: number;
  calibratedAt: string;
};

const STORAGE_KEY = "flybike.calibrations.v1";

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("At least one sample is required");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function percentile(values: number[], value: number): number {
  if (values.length === 0) throw new Error("At least one sample is required");
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(Math.max(0, Math.min(1, value)) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

export function createCalibration(
  deviceId: string,
  cruiseSamples: number[],
  hardSamples: number[],
): CalibrationProfile {
  if (cruiseSamples.length < 5 || hardSamples.length < 5) {
    throw new Error("Not enough valid power samples. Keep pedaling and retry.");
  }
  const cruisePowerW = Math.round(median(cruiseSamples));
  const hardPowerW = Math.round(percentile(hardSamples, 0.9));
  if (hardPowerW - cruisePowerW < 30) {
    throw new Error("Hard effort must be at least 30 W above cruise effort.");
  }
  return { deviceId, cruisePowerW, hardPowerW, calibratedAt: new Date().toISOString() };
}

export function loadCalibration(deviceId: string): CalibrationProfile | undefined {
  try {
    const profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      CalibrationProfile
    >;
    return profiles[deviceId];
  } catch {
    return undefined;
  }
}

export function saveCalibration(profile: CalibrationProfile): void {
  let profiles: Record<string, CalibrationProfile> = {};
  try {
    profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      CalibrationProfile
    >;
  } catch {
    // Replace corrupt local data.
  }
  profiles[profile.deviceId] = profile;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}
