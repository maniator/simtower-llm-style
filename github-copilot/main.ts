import { ROOM_TYPES, CATEGORY_ORDER } from "./data.js";
import { Game } from "./sim.js";
import { Renderer } from "./render.js";
import { UI } from "./ui.js";
import { AudioSynth } from "./audio.js";

const canvasElement = document.getElementById("tower-canvas");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("Canvas element not found");
}

const canvas: HTMLCanvasElement = canvasElement;
const game = new Game(ROOM_TYPES);
const renderer = new Renderer(canvas, game);
const audio = new AudioSynth();
const ui = new UI(game, renderer, ROOM_TYPES, CATEGORY_ORDER, audio);

ui.init();
renderer.resize();

let lastTime: number = performance.now();
const loop = (now: number): void => {
  const delta: number = now - lastTime;
  lastTime = now;
  game.update(delta);
  renderer.render();
  ui.updateHUD();
  requestAnimationFrame(loop);
};

requestAnimationFrame(loop);
