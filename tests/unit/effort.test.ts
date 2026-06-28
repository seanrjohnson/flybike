import { describe, expect, it } from "vitest";
import { EffortMapper, MAX_VERTICAL_SPEED } from "../../src/effort";

const profile = {
  deviceId: "test",
  cruisePowerW: 120,
  hardPowerW: 240,
  calibratedAt: "2026-01-01T00:00:00.000Z",
};

describe("EffortMapper", () => {
  it("maps zero, cruise, and hard effort to descent, level, and climb", () => {
    const mapper = new EffortMapper(profile);
    expect(mapper.targetVelocity(0)).toBe(MAX_VERTICAL_SPEED);
    expect(mapper.targetVelocity(120)).toBe(0);
    expect(mapper.targetVelocity(240)).toBe(-MAX_VERTICAL_SPEED);
  });

  it("clamps values beyond the calibrated range", () => {
    const mapper = new EffortMapper(profile);
    expect(mapper.targetVelocity(-20)).toBe(MAX_VERTICAL_SPEED);
    expect(mapper.targetVelocity(600)).toBe(-MAX_VERTICAL_SPEED);
  });

  it("smooths abrupt power changes", () => {
    const mapper = new EffortMapper(profile);
    mapper.update(0, 16);
    expect(mapper.update(240, 100)).toBeGreaterThan(0);
    expect(mapper.getSmoothedPower()).toBeGreaterThan(0);
    expect(mapper.getSmoothedPower()).toBeLessThan(240);
  });
});
