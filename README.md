# FlyBike

FlyBike is an endless arcade flight game controlled by a smart bike trainer. Pedaling power lifts a pixel-art, Da Vinci-inspired ornithopter; easing off lets it descend.

The app is a completely static SPA. Trainer data stays in the browser and no account or server is required.

Playable at: https://seanrjohnson.github.io/flybike/

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

Trainer setup also offers **Enter wattages manually**. Enter a sustainable cruise wattage and a controlled hard-effort wattage at least 30 W higher. Manual profiles use the same per-device local storage as guided calibration and can be replaced at any time.

The lower-left ride display shows active run time as minutes and seconds, with accumulated session minutes in parentheses. Distance is integrated from trainer-reported speed and shown in kilometers for the current run and controller session. Countdown, menu, and paused time are excluded; choosing a new controller starts a new session.

### Ride history

The home-screen **Ride history** view stores completed and manually ended runs locally. It includes distance, active time, level settings, score, five-second power curves, and summaries for today, this week, this month, this year, and previous calendar periods. History can be exported as JSON and imported on another browser; importing merges rides by ID. No history leaves the browser unless explicitly exported.

### Levels

- **Ornithopter Run** is the original endless gate course, now backed by independently scrolling clouds, distant mountains, midground hills, and foreground fields.
- **Asteroids** replaces the landscape with a moving starfield. Dodge incoming asteroids by pedaling higher or easing lower as the field accelerates.
- **Racer** is a fixed-screen overhead circuit inspired by classic arcade sprint racing. Steering is automatic; harder pedaling accelerates and moves toward the outer racing line, while easing slows and moves inward. Cars can pass through one another without collision penalties, keeping overtaking focused on speed.
- **Hill Climber** generates a finite mountain course with configurable distance, summit elevation, and slope character. The camera follows accumulated altitude, scenery progresses from lowlands through mountains and glaciers, and a minimap tracks the complete route. Uphill grades require additional watts to hold speed; downhills support coasting and reward pedaling.
- **Submarine Dive** moves the altitude controls underwater. Pilot through coral seas, dark trenches, or arctic depths while avoiding mines, reefs, or a mixture of both.
- **Dragon Flight** sends a pedal-powered dragon through fantasy skies. Thread rings over an emerald valley, volcanic peaks, or a moonlit kingdom using random, rolling, or alternating courses.

Selecting any level opens a customization screen before its countdown. Arcade levels offer map and Relaxed/Standard/Expert difficulty choices plus mode-specific options; Hill Climber instead offers course length, maximum elevation, and slope character. Disabling Ornithopter upper gates also enables a safe upper screen boundary, allowing sustained hard riding without a ceiling collision. Each unique combination has its own high score, so unlike configurations are never compared. The level catalog and option definitions live in `src/levels.ts`; gameplay-specific behavior lives in the Phaser scene. Additional level and platform ideas are tracked in [`docs/roadmap.md`](docs/roadmap.md).

### Guided traces

After connecting and calibrating a trainer, select **Guided trace** to run a one-minute obstacle-free session. Follow the on-screen cruise, push, easy, and coast cues. The bike remains visible at the edge of the screen, but the exported trajectory is not clamped by a roof or floor.

At the end, download the CSV. It contains cue timing, power, cadence, speed, raw trajectory, actual and requested vertical velocity, and the calibration wattages. Attach that file to a FlyBike issue or development conversation to tune the trainer model against real flywheel behavior. Trace data stays in the browser until you explicitly download it.

### Trainer load

Some FTMS trainers advertise direct resistance control; others advertise simulated grade. When either capability is available, setup shows a bounded load slider. Changing the slider alone does nothing: start at a low value and press **Apply load** to send it. FlyBike requests FTMS control, clamps the command to the advertised/safe range, and requires the trainer to acknowledge it. No load is restored or applied automatically after reconnecting.

During a flight, select the trainer name in the upper-right corner to pause and reopen the same load control. Apply the new setting, then resume after the countdown.

The separate **Menu** button pauses any normal game, including keyboard demo mode, and provides Resume, Levels, and Setup actions. The trainer-name button only opens Bluetooth bike settings; both controls are locked while another pause panel is open.

Hill Climber can also vary compatible FTMS resistance automatically with terrain. Before starting, choose Off, Gentle, Standard, or Strong. Virtual slope physics remain active in every setting. Automatic commands are throttled, use the manually applied load as their baseline, and restore that baseline when the game pauses or ends. The terrain effect can also be changed from the in-game bike settings screen.

If no load control appears, the trainer did not advertise a compatible FTMS target. Telemetry and gameplay still work normally.

If the trainer disconnects or stops reporting data, the game pauses. Reconnect or resolve the competing app connection before resuming.

Demo mode uses `Space`, `ArrowUp`, or press-and-hold anywhere outside a button to climb. Release to descend.

### Ride controllers

Select **Connect controller** on the home screen to pair an [OpenBikeControl](https://github.com/OpenBikeControl/openbikecontrol-protocol) remote alongside the trainer. During a flight, Menu or Pause opens the game menu, and in demo mode Shift Up, Up, or Increase Difficulty climbs while held. On setup and pause screens, Up/Left/Shift Up and Down/Right/Shift Down move between buttons, and Select or Resume presses the focused or highlighted button. Connecting a trainer or another controller still requires a click or tap.

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
- `src/trainer/openbikecontrol.ts` decodes OpenBikeControl button messages and picks one game action per press.
- `src/game/` contains the Phaser scene and original game presentation.
- `src/app.ts` owns setup, calibration, pause/reconnect, persistence, and DOM UI state.

New protocols should implement `TrainerSource` and emit the same normalized `TelemetrySample`; game physics must not depend on a transport.

## GitHub Pages

The Pages workflow publishes two builds in one atomic deployment:

- `https://seanrjohnson.github.io/flybike/` builds the protected `stable` branch.
- `https://seanrjohnson.github.io/flybike/dev/` builds the triggering `main` revision.

Every push to `main` tests the project and refreshes the development build while rebuilding the unchanged stable branch at the root. To promote a release, update `stable` to the approved `main` commit, push it, then manually run **Test and deploy GitHub Pages** from the Actions tab. Keep **GitHub Actions** selected as the Pages source in repository settings.

### Deployment workflow

Normal development is committed and pushed to `main`:

```sh
git push origin main
```

After the Pages workflow succeeds, verify the development build at `https://seanrjohnson.github.io/flybike/dev/`. When that revision is ready for stable release, advance the `stable` branch to the approved commit:

```sh
git fetch origin
git push origin main:stable
```

Then open **Actions → Test and deploy GitHub Pages → Run workflow** and run it from `main`. Verify the stable build at `https://seanrjohnson.github.io/flybike/`. If releasing an older tested commit rather than current `main`, update `stable` through a reviewed branch or pull request instead of force-pushing it. Protect `stable` in repository branch settings so routine development cannot update it accidentally.

## Art and license

The ornithopter sprite is an original project asset generated for FlyBike using OpenAI's built-in image generation tool, then chroma-keyed locally for transparency. The final prompt requested a single side-view 16-bit pixel-art pedal-powered Leonardo-style ornithopter on a flat green background, using an umber, brass, parchment, burgundy, and blue-gray palette with no text or logos.

Code and project assets are released under the [MIT License](LICENSE).
