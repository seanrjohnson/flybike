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
      <div class="metric score"><strong id="score-value">0</strong><span>gates</span></div>
    </div>
    <div id="connection-pill" class="connection-pill" data-state="disconnected">disconnected</div>
    <button id="mute-button" class="mute-button" type="button">Sound on</button>
    <div id="overlay" class="overlay"></div>
  </main>`;

createGame(document.querySelector<HTMLElement>("#game-host")!);
new AppController();
