# FlyBike

FlyBike is an endless arcade flight game controlled by a smart bike trainer. Pedaling power lifts a pixel-art, Da Vinci-inspired ornithopter; easing off lets it descend.

The app is a completely static SPA. Trainer data stays in the browser and no account or server is required.

## Supported hardware and browsers

The first release reads the Bluetooth Fitness Machine Service (FTMS) Indoor Bike Data characteristic. It is designed for the Saris M2, and should work with other FTMS trainers that report instantaneous power.

- Chrome or Edge on Windows, macOS, and ChromeOS
- Chrome-family browsers on Android
- HTTPS in production (`localhost` is accepted during development)

Safari/iOS and Firefox do not currently expose the Web Bluetooth API needed by this app. A keyboard/touch demo mode remains available everywhere the game itself runs.

ANT+, Wahoo-specific BLE services, and Cycling Power Service sensors are future adapters; they are not included in this release.

## Playing

1. Power on the trainer and close Zwift, ROUVY, Saris, or any other app connected to it.
2. Open FlyBike and select **Connect trainer** from a compatible browser.
3. Select the trainer in the browser device chooser.
4. Complete the first-use cruise/hard calibration. It is stored locally for that trainer.
5. Select **Start flight**, choose a level, and begin. Cruise power maintains altitude, greater power climbs, and lower power descends.

Outside the explicitly enabled Hill Climber terrain effect, the app only reads telemetry unless you apply a supported load yourself. Set the bike gearing to a comfortable range and let the trainer use its normal progressive resistance curve when load control is off.

Trainer gameplay maps sustained effort to a requested altitude: cruise returns toward center, harder pedaling moves the target upward, and easing moves it downward. A wider cruise-power deadband, softened partial effort, bounded movement speed, larger and slower gates, and a smaller collision box compensate for trainer flywheel momentum and reporting delay.

The lower-left ride display shows active run time as minutes and seconds, with accumulated session minutes in parentheses. Distance is integrated from trainer-reported speed and shown in kilometers for the current run and controller session. Countdown, menu, and paused time are excluded; choosing a new controller starts a new session.

### Levels

- **Ornithopter Run** is the original endless gate course.
- **Asteroids** replaces the landscape with a moving starfield. Dodge incoming asteroids by pedaling higher or easing lower as the field accelerates.
- **Racer** is a fixed-screen overhead circuit inspired by classic arcade sprint racing. Steering is automatic; harder pedaling accelerates and moves toward the outer racing line, while easing slows and moves inward. Avoid rival cars and complete laps.
- **Hill Climber** is an endless procedurally generated side-scrolling landscape. Uphill grades require additional watts to hold speed. Downhills support coasting, and pedaling downhill produces a large speed boost.

Each level keeps a separate high score. The level catalog lives in `src/levels.ts`; gameplay-specific obstacle and backdrop behavior lives in the Phaser scene.

### Guided traces

After connecting and calibrating a trainer, select **Guided trace** to run a one-minute obstacle-free session. Follow the on-screen cruise, push, easy, and coast cues. The bike remains visible at the edge of the screen, but the exported trajectory is not clamped by a roof or floor.

At the end, download the CSV. It contains cue timing, power, cadence, speed, raw trajectory, actual and requested vertical velocity, and the calibration wattages. Attach that file to a FlyBike issue or development conversation to tune the trainer model against real flywheel behavior. Trace data stays in the browser until you explicitly download it.

### Trainer load

Some FTMS trainers advertise direct resistance control; others advertise simulated grade. When either capability is available, setup shows a bounded load slider. Changing the slider alone does nothing: start at a low value and press **Apply load** to send it. FlyBike requests FTMS control, clamps the command to the advertised/safe range, and requires the trainer to acknowledge it. No load is restored or applied automatically after reconnecting.

During a flight, select the trainer name in the upper-right corner to pause and reopen the same load control. Apply the new setting, then resume after the countdown.

Hill Climber can also vary compatible FTMS resistance automatically with terrain. Before starting, choose Off, Gentle, Standard, or Strong. Virtual slope physics remain active in every setting. Automatic commands are throttled, use the manually applied load as their baseline, and restore that baseline when the game pauses or ends. The terrain effect can also be changed from the in-game bike settings screen.

If no load control appears, the trainer did not advertise a compatible FTMS target. Telemetry and gameplay still work normally.

If the trainer disconnects or stops reporting data, the game pauses. Reconnect or resolve the competing app connection before resuming.

Demo mode uses `Space`, `ArrowUp`, or press-and-hold anywhere outside a button to climb. Release to descend.

## Development

Prerequisites: Node.js 22 and npm.

```sh
npm install
npm run dev
```

Useful checks:

```sh
npm run lint
npm run format
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The Bluetooth chooser requires a direct user gesture and cannot be automated in normal browser tests. FTMS parsing, calibration, and flight mapping are unit tested; Playwright covers the complete demo-mode flow. Physical trainer acceptance testing remains manual.

## Architecture

- `src/trainer/` contains the transport-neutral `TrainerSource` contract, FTMS adapter, demo adapter, and packet decoder.
- `src/trainer/ftms-control.ts` contains tested FTMS feature/range parsing and load command encoding.
- `src/calibration.ts` stores robust per-device cruise/hard effort profiles in local storage.
- `src/effort.ts` smooths instantaneous power and maps trainer effort to a bounded target altitude.
- `src/game/hill-physics.ts` defines testable terrain, grade, and hill-speed behavior.
- `src/trainer/terrain-load.ts` maps terrain grade to bounded, stepped FTMS load targets.
- `src/game/` contains the Phaser scene and original game presentation.
- `src/app.ts` owns setup, calibration, pause/reconnect, persistence, and DOM UI state.

New protocols should implement `TrainerSource` and emit the same normalized `TelemetrySample`; game physics must not depend on a transport.

## GitHub Pages

The Pages workflow tests and builds every push to `main`, then deploys `dist/` with the `/flybike/` base path. Enable **GitHub Actions** as the Pages source in the repository settings before the first deployment.

## Art and license

The ornithopter sprite is an original project asset generated for FlyBike using OpenAI's built-in image generation tool, then chroma-keyed locally for transparency. The final prompt requested a single side-view 16-bit pixel-art pedal-powered Leonardo-style ornithopter on a flat green background, using an umber, brass, parchment, burgundy, and blue-gray palette with no text or logos.

Code and project assets are released under the [MIT License](LICENSE).
