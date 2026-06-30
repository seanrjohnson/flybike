import { describe, expect, it } from "vitest";
import { terrainLoadTarget } from "../../src/trainer/terrain-load";
import type { TrainerLoadControl } from "../../src/trainer/types";

describe("terrainLoadTarget", () => {
  it("adds simulated grade uphill and removes it downhill", () => {
    const control: TrainerLoadControl = {
      mode: "simulation-grade",
      label: "Simulated grade",
      unit: "%",
      minimum: 0,
      maximum: 8,
      increment: 0.5,
    };
    expect(terrainLoadTarget(control, 2, 4, 1)).toBe(6);
    expect(terrainLoadTarget(control, 2, -4, 1)).toBe(0);
    expect(terrainLoadTarget(control, 2, 8, 0)).toBe(2);
  });

  it("scales and clamps resistance-mode terrain effects", () => {
    const control: TrainerLoadControl = {
      mode: "resistance",
      label: "Resistance",
      unit: "",
      minimum: 0,
      maximum: 100,
      increment: 1,
    };
    expect(terrainLoadTarget(control, 10, 14, 0.5)).toBe(25);
    expect(terrainLoadTarget(control, 90, 14, 1.5)).toBe(100);
    expect(terrainLoadTarget(control, 10, -14, 1)).toBe(0);
  });
});
