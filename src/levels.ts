export const LEVELS = [
  {
    id: "ornithopter-run",
    title: "Ornithopter Run",
    description: "Thread Leonardo's pedal-powered flying machine through an endless gate course.",
    scoreLabel: "gates",
  },
  {
    id: "asteroids",
    title: "Asteroids",
    description: "Pedal higher or ease lower to dodge an accelerating field of space rocks.",
    scoreLabel: "asteroids",
  },
  {
    id: "racer",
    title: "Racer",
    description:
      "Race an overhead circuit: pedal harder for speed and the outer line; ease for the inside.",
    scoreLabel: "laps",
  },
  {
    id: "hill-climber",
    title: "Hill Climber",
    description:
      "Ride an endless side-scrolling landscape where every slope changes the power needed for speed.",
    scoreLabel: "km",
  },
] as const;

export type LevelId = (typeof LEVELS)[number]["id"];

export function getLevel(levelId: LevelId) {
  return LEVELS.find(({ id }) => id === levelId) ?? LEVELS[0];
}
