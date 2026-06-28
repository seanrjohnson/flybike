# Repository Guidelines

## Project Structure & Module Organization

FlyBike is a Vite/TypeScript single-page game using Phaser. Application orchestration and DOM UI live in `src/app.ts`; game rendering and physics are under `src/game/`. Trainer transports, FTMS packet parsing, and control commands live in `src/trainer/`. Keep protocol code independent from Phaser by emitting normalized telemetry through `TrainerSource`. Calibration and effort mapping are isolated in `src/calibration.ts` and `src/effort.ts`.

Static assets belong in `public/assets/`. Unit tests are in `tests/unit/`, Playwright flows in `tests/e2e/`, and GitHub Pages deployment configuration in `.github/workflows/`.

## Build, Test, and Development Commands

- `npm install`: install locked dependencies.
- `npm run dev`: start the local Vite server at `http://localhost:5173`.
- `npm run build`: run strict TypeScript checks and produce `dist/`.
- `npm run preview`: serve the production build locally.
- `npm test`: run all Vitest unit tests once.
- `npm run test:e2e`: run desktop and mobile Playwright flows.
- `npm run lint`: check ESLint rules.
- `npm run format`: verify Prettier formatting.
- `npm run check`: run lint, formatting, unit tests, and build together.

## Coding Style & Naming Conventions

Use two-space indentation, double quotes, semicolons, and trailing commas; Prettier enforces these rules. Keep TypeScript strict and avoid `any`. Use `PascalCase` for classes/types, `camelCase` for functions and variables, and kebab-case filenames except Phaser scene classes such as `FlyScene.ts`. Prefer small protocol parsers and pure functions that can be unit tested.

## Testing Guidelines

Use Vitest for parsing, calibration, physics, and control encoding. Name files `*.test.ts`. Add packet fixtures for every new FTMS flag or command. Playwright tests use `*.spec.ts` and should cover user-visible setup and demo behavior. Run `npm run check` and `npm run test:e2e` before submitting changes. Physical trainer behavior must also be documented as manually tested or explicitly untested.

## Commit & Pull Request Guidelines

History uses short commit subjects. Prefer concise imperative messages such as `Add guided trainer trace`; avoid vague subjects like `bugfixes`. Pull requests should explain behavior changes, identify hardware/browser testing, link relevant issues, and include screenshots or recordings for visual changes. Call out FTMS writes, safety implications, compatibility limits, and any required GitHub Pages configuration.
