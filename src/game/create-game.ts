import Phaser from "phaser";
import { FlyScene } from "./FlyScene";

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 320,
    height: 180,
    pixelArt: true,
    antialias: false,
    backgroundColor: "#86b9c2",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 320,
      height: 180,
    },
    scene: [FlyScene],
    render: { pixelArt: true, antialias: false, roundPixels: true },
  });
}
