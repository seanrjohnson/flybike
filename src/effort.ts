import type { CalibrationProfile } from "./calibration";

export const MAX_VERTICAL_SPEED = 90;
export const TRAINER_CENTER_Y = 88;
export const TRAINER_ALTITUDE_RANGE = 60;
export const TRAINER_MAX_VERTICAL_SPEED = 34;
export const TRAINER_VELOCITY_RESPONSE_MS = 300;
const TRAINER_EFFORT_RANGE = 55;

export function trainerAltitudeVelocity(effortVelocity: number, currentY: number): number {
  const normalizedEffort = Math.max(-1, Math.min(1, effortVelocity / TRAINER_EFFORT_RANGE));
  const targetY = TRAINER_CENTER_Y + normalizedEffort * TRAINER_ALTITUDE_RANGE;
  return Math.max(
    -TRAINER_MAX_VERTICAL_SPEED,
    Math.min(TRAINER_MAX_VERTICAL_SPEED, (targetY - currentY) * 0.75),
  );
}

export class EffortMapper {
  private smoothedPower = 0;
  private initialized = false;

  constructor(
    private readonly profile: CalibrationProfile,
    private readonly halfLifeMs = 500,
    private readonly maxVerticalSpeed = MAX_VERTICAL_SPEED,
    private readonly deadbandFraction = 0,
    private readonly responseExponent = 1,
  ) {}

  update(powerW: number, deltaMs: number): number {
    const safePower = Math.max(0, powerW);
    if (!this.initialized) {
      this.smoothedPower = safePower;
      this.initialized = true;
    } else {
      const alpha = 1 - 2 ** (-Math.max(0, deltaMs) / this.halfLifeMs);
      this.smoothedPower += alpha * (safePower - this.smoothedPower);
    }
    return this.targetVelocity(this.smoothedPower);
  }

  targetVelocity(powerW: number): number {
    const { cruisePowerW, hardPowerW } = this.profile;
    const lowCruise = cruisePowerW * (1 - this.deadbandFraction);
    const highCruise = cruisePowerW + (hardPowerW - cruisePowerW) * this.deadbandFraction;
    if (powerW < lowCruise) {
      const descent = 1 - Math.max(0, powerW) / lowCruise;
      return this.maxVerticalSpeed * descent ** this.responseExponent;
    }
    if (powerW <= highCruise) return 0;
    const climb = Math.min(1, (powerW - highCruise) / (hardPowerW - highCruise));
    return -this.maxVerticalSpeed * climb ** this.responseExponent;
  }

  getSmoothedPower(): number {
    return this.smoothedPower;
  }
}
