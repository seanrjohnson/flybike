import "./style.css";
import { AppController } from "./app";
import { createGame } from "./game/create-game";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main id="shell">
    <div id="game-host" aria-label="FlyBike game"></div>
    <div id="hud" class="hud hidden" aria-live="polite">
      <div class="metric"><strong id="power-value">—</strong><span>watts</span></div>
      <div class="metric"><strong id="cadence-value">—</strong><span>rpm</span></div>
      <div class="metric"><strong id="speed-value">—</strong><span>km/h</span></div>
      <div class="metric score"><strong id="score-value">0</strong><span id="score-label">gates</span></div>
    </div>
    <div id="ride-stats" class="ride-stats hidden" aria-label="Ride statistics">
      <div><span>Time</span> <strong id="run-time">00:00</strong> <small>(<span id="session-time">0</span> min)</small></div>
      <div><span>Distance</span> <strong id="run-distance">0.00</strong> km <small>(<span id="session-distance">0.00</span> km)</small></div>
    </div>
    <button id="connection-pill" class="connection-pill" data-state="disconnected" type="button" disabled>disconnected</button>
    <button id="mute-button" class="mute-button" type="button">Sound on</button>
    <div id="trace-cue" class="trace-cue hidden" aria-live="polite">
      <strong id="trace-cue-title">Cruise</strong>
      <span id="trace-cue-copy">Hold your comfortable effort</span>
      <div class="trace-progress"><i id="trace-cue-progress"></i></div>
      <button id="trace-cancel" type="button">End trace</button>
    </div>
    <div id="overlay" class="overlay"></div>
  </main>`;

createGame(document.querySelector<HTMLElement>("#game-host")!);
new AppController();
