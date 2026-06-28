import type { CalibrationProfile } from "./calibration";

export const MAX_VERTICAL_SPEED = 90;

export class EffortMapper {
  private smoothedPower = 0;
  private initialized = false;

  constructor(
    private readonly profile: CalibrationProfile,
    private readonly halfLifeMs = 500,
    private readonly maxVerticalSpeed = MAX_VERTICAL_SPEED,
    private readonly deadbandFraction = 0,
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
      return this.maxVerticalSpeed * (1 - Math.max(0, powerW) / lowCruise);
    }
    if (powerW <= highCruise) return 0;
    const climb = Math.min(1, (powerW - highCruise) / (hardPowerW - highCruise));
    return -this.maxVerticalSpeed * climb;
  }

  getSmoothedPower(): number {
    return this.smoothedPower;
  }
}
