export type RideStatsSnapshot = {
  runElapsedMs: number;
  sessionElapsedMs: number;
  runDistanceKm: number;
  sessionDistanceKm: number;
};

export class RideStats {
  private snapshot: RideStatsSnapshot = {
    runElapsedMs: 0,
    sessionElapsedMs: 0,
    runDistanceKm: 0,
    sessionDistanceKm: 0,
  };
  private active = false;
  private lastUpdatedAt = 0;

  resetSession(): void {
    this.active = false;
    this.lastUpdatedAt = 0;
    this.snapshot = {
      runElapsedMs: 0,
      sessionElapsedMs: 0,
      runDistanceKm: 0,
      sessionDistanceKm: 0,
    };
  }

  beginRun(now: number): void {
    this.snapshot.runElapsedMs = 0;
    this.snapshot.runDistanceKm = 0;
    this.active = true;
    this.lastUpdatedAt = now;
  }

  resume(now: number): void {
    if (this.active) return;
    this.active = true;
    this.lastUpdatedAt = now;
  }

  pause(now: number, speedKph: number): void {
    this.tick(now, speedKph);
    this.active = false;
  }

  tick(now: number, speedKph: number): RideStatsSnapshot {
    if (this.active) {
      const deltaMs = Math.max(0, now - this.lastUpdatedAt);
      const distanceKm = Math.max(0, speedKph) * (deltaMs / 3_600_000);
      this.snapshot.runElapsedMs += deltaMs;
      this.snapshot.sessionElapsedMs += deltaMs;
      this.snapshot.runDistanceKm += distanceKm;
      this.snapshot.sessionDistanceKm += distanceKm;
      this.lastUpdatedAt = now;
    }
    return this.getSnapshot();
  }

  getSnapshot(): RideStatsSnapshot {
    return { ...this.snapshot };
  }
}

export function formatRunTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSessionMinutes(elapsedMs: number): string {
  return String(Math.floor(Math.max(0, elapsedMs) / 60_000));
}
