import { beforeEach, describe, expect, it } from "vitest";
import {
  createCalibration,
  loadCalibration,
  median,
  percentile,
  saveCalibration,
} from "../../src/calibration";

describe("calibration", () => {
  beforeEach(() => localStorage.clear());

  it("calculates robust representative efforts", () => {
    expect(median([500, 100, 110, 120, 130])).toBe(120);
    expect(percentile([200, 220, 240, 260, 280], 0.9)).toBe(280);
  });

  it("creates and persists a per-device profile", () => {
    const profile = createCalibration(
      "trainer-1",
      [115, 120, 125, 122, 119],
      [200, 220, 240, 260, 280],
    );
    expect(profile).toMatchObject({ deviceId: "trainer-1", cruisePowerW: 120, hardPowerW: 280 });
    saveCalibration(profile);
    expect(loadCalibration("trainer-1")).toEqual(profile);
  });

  it("rejects weak or incomplete calibration stages", () => {
    expect(() => createCalibration("x", [100], [200])).toThrow("Not enough");
    expect(() =>
      createCalibration("x", [100, 100, 100, 100, 100], [110, 115, 120, 125, 129]),
    ).toThrow("30 W");
  });
});
