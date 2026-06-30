import { describe, expect, it } from "vitest";
import { formatRunTime, formatSessionMinutes, RideStats } from "../../src/ride-stats";

describe("RideStats", () => {
  it("accumulates active run and session distance from speed", () => {
    const stats = new RideStats();
    stats.beginRun(1_000);
    stats.tick(61_000, 36);
    stats.pause(61_000, 36);

    expect(stats.getSnapshot()).toMatchObject({
      runElapsedMs: 60_000,
      sessionElapsedMs: 60_000,
      runDistanceKm: 0.6,
      sessionDistanceKm: 0.6,
    });
  });

  it("resets each run while preserving session totals", () => {
    const stats = new RideStats();
    stats.beginRun(0);
    stats.pause(30_000, 12);
    stats.beginRun(40_000);
    stats.pause(70_000, 24);

    const snapshot = stats.getSnapshot();
    expect(snapshot).toMatchObject({
      runElapsedMs: 30_000,
      runDistanceKm: 0.2,
      sessionElapsedMs: 60_000,
    });
    expect(snapshot.sessionDistanceKm).toBeCloseTo(0.3);
  });

  it("formats run and session timers", () => {
    expect(formatRunTime(125_900)).toBe("02:05");
    expect(formatSessionMinutes(125_900)).toBe("2");
  });
});
