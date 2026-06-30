import { describe, expect, it } from "vitest";
import { hillTargetSpeed } from "../../src/game/hill-physics";

describe("hillTargetSpeed", () => {
  it("requires more power to hold speed uphill", () => {
    const flatSpeed = hillTargetSpeed(120, 240, 0);
    expect(hillTargetSpeed(120, 240, 8)).toBeLessThan(flatSpeed);
    expect(hillTargetSpeed(210, 240, 8)).toBeGreaterThanOrEqual(flatSpeed);
  });

  it("allows downhill coasting and strongly rewards downhill pedaling", () => {
    expect(hillTargetSpeed(0, 240, -8)).toBeGreaterThan(0);
    expect(hillTargetSpeed(240, 240, -8)).toBeGreaterThan(hillTargetSpeed(240, 240, 0));
  });
});
