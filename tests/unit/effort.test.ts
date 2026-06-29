import { describe, expect, it } from "vitest";
import {
  EffortMapper,
  MAX_VERTICAL_SPEED,
  TRAINER_CENTER_Y,
  TRAINER_MAX_VERTICAL_SPEED,
  TRAINER_VELOCITY_RESPONSE_MS,
  trainerAltitudeVelocity,
} from "../../src/effort";

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

  it("gives trainer input a cruise deadband and gentler maximum speed", () => {
    const mapper = new EffortMapper(profile, 250, 55, 0.12);
    expect(mapper.targetVelocity(110)).toBe(0);
    expect(mapper.targetVelocity(130)).toBe(0);
    expect(mapper.targetVelocity(0)).toBe(55);
    expect(mapper.targetVelocity(240)).toBe(-55);
  });

  it("can soften partial trainer effort while preserving calibrated endpoints", () => {
    const linear = new EffortMapper(profile, 250, 55, 0.15);
    const softened = new EffortMapper(profile, 250, 55, 0.15, 1.35);

    expect(Math.abs(softened.targetVelocity(180))).toBeLessThan(
      Math.abs(linear.targetVelocity(180)),
    );
    expect(softened.targetVelocity(0)).toBe(55);
    expect(softened.targetVelocity(240)).toBe(-55);
  });

  it("treats trainer effort as a bounded target altitude", () => {
    expect(trainerAltitudeVelocity(0, TRAINER_CENTER_Y)).toBe(0);
    expect(trainerAltitudeVelocity(-55, TRAINER_CENTER_Y)).toBe(-TRAINER_MAX_VERTICAL_SPEED);
    expect(trainerAltitudeVelocity(55, TRAINER_CENTER_Y)).toBe(TRAINER_MAX_VERTICAL_SPEED);

    // Once the requested altitude is reached, sustained effort stops movement.
    expect(trainerAltitudeVelocity(-55, 28)).toBe(0);
    expect(trainerAltitudeVelocity(55, 148)).toBe(0);
  });

  it("stays clear of the roof and floor under sustained extreme effort", () => {
    const frameMs = 16;
    let y = TRAINER_CENTER_Y;
    let velocity = 0;
    let minimumY = y;
    let maximumY = y;

    for (const effort of [-55, 55]) {
      for (let elapsed = 0; elapsed < 30_000; elapsed += frameMs) {
        const targetVelocity = trainerAltitudeVelocity(effort, y);
        const ease = 1 - Math.exp(-frameMs / TRAINER_VELOCITY_RESPONSE_MS);
        velocity += (targetVelocity - velocity) * ease;
        y += velocity * (frameMs / 1000);
        minimumY = Math.min(minimumY, y);
        maximumY = Math.max(maximumY, y);
      }
    }

    const trainerHitboxHalfHeight = 7;
    const floorY = 165;
    expect(minimumY - trainerHitboxHalfHeight).toBeGreaterThan(0);
    expect(maximumY + trainerHitboxHalfHeight).toBeLessThan(floorY);
  });
});
