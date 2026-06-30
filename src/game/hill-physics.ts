export function hillTerrainY(worldX: number): number {
  return (
    126 +
    Math.sin(worldX / 160) * 17 +
    Math.sin(worldX / 62 + 0.8) * 6 +
    Math.sin(worldX / 330 + 2.1) * 10
  );
}

export function hillTerrainDerivative(worldX: number): number {
  return (
    (Math.cos(worldX / 160) * 17) / 160 +
    (Math.cos(worldX / 62 + 0.8) * 6) / 62 +
    (Math.cos(worldX / 330 + 2.1) * 10) / 330
  );
}

export function hillGradePercent(worldX: number): number {
  return Math.max(-14, Math.min(14, -hillTerrainDerivative(worldX) * 100));
}

export function hillTargetSpeed(powerW: number, hardPowerW: number, gradePercent: number): number {
  const normalizedEffort = Math.max(0, Math.min(1, powerW / hardPowerW));
  const pedalingSpeed = normalizedEffort * 78;
  const downhillBoost = Math.max(0, -gradePercent) * 4.8;
  const uphillPenalty = Math.max(0, gradePercent) * 3.5;
  return Math.max(0, Math.min(126, pedalingSpeed + downhillBoost - uphillPenalty));
}
