import { ROOM_TYPES, CATEGORY_ORDER } from "./data.js";
import { Game } from "./sim.js";
import { Renderer } from "./render.js";
import { UI } from "./ui.js";
import { AudioSynth } from "./audio.js";

const canvas = document.getElementById("tower-canvas");
const game = new Game(ROOM_TYPES);
const renderer = new Renderer(canvas, game);
const audio = new AudioSynth();
const ui = new UI(game, renderer, ROOM_TYPES, CATEGORY_ORDER, audio);

ui.init();
renderer.resize();

let lastTime = performance.now();
const loop = (now) => {
  const delta = now - lastTime;
  lastTime = now;
  game.update(delta);
  renderer.render();
  ui.updateHUD();
  requestAnimationFrame(loop);
};

requestAnimationFrame(loop);
window.addEventListener("resize", () => renderer.resize());
