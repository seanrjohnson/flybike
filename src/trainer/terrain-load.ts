import type { TrainerLoadControl } from "./types";

export function terrainLoadTarget(
  control: TrainerLoadControl,
  baseLoad: number,
  gradePercent: number,
  effectScale: number,
): number {
  const clampedBase = Math.max(control.minimum, Math.min(control.maximum, baseLoad));
  const range = control.maximum - control.minimum;
  const delta =
    control.mode === "simulation-grade"
      ? gradePercent * effectScale
      : (gradePercent / 14) * range * 0.3 * effectScale;
  const rawTarget = Math.max(control.minimum, Math.min(control.maximum, clampedBase + delta));
  const stepped =
    control.minimum +
    Math.round((rawTarget - control.minimum) / control.increment) * control.increment;
  return Math.max(control.minimum, Math.min(control.maximum, stepped));
}
