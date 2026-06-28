import Phaser from "phaser";
import { FlyScene } from "./FlyScene";

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 960,
    height: 540,
    pixelArt: true,
    antialias: false,
    backgroundColor: "#86b9c2",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 960,
      height: 540,
    },
    scene: [FlyScene],
    render: { pixelArt: true, antialias: false, roundPixels: true },
  });
}
