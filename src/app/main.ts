import { ROOM_TYPES, CATEGORY_ORDER } from "@data/roomTypes.ts";
import { Game } from "@core/game/Game.ts";
import { Renderer } from "@core/render/Renderer.ts";
import { UI } from "@ui/UI.ts";
import { AudioSynth } from "@core/audio/AudioSynth.ts";
import { saveGame, loadGame, hasSave } from "@storage/storage.ts";

const canvasElement = document.getElementById("tower-canvas");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("Canvas element not found");
}

const canvas: HTMLCanvasElement = canvasElement;

// Preserve game state across HMR updates
interface AppState {
  game: Game;
  rafId: number;
  resizeObserver?: ResizeObserver;
}

declare global {
  interface Window {
    __appState?: AppState;
  }
}

// Reuse game instance if HMR is reloading, otherwise load from save or create new
let game: Game;
if (window.__appState?.game) {
  game = window.__appState.game;
} else {
  game = new Game(ROOM_TYPES);
  if (hasSave()) {
    loadGame(game);
  }
}

const renderer = new Renderer(canvas, game);
const audio = new AudioSynth();
const ui = new UI(game, renderer, ROOM_TYPES, CATEGORY_ORDER, audio);

// Set up auto-save
game.setAutoSaveCallback(() => saveGame(game));

// Clean up previous instance
if (window.__appState) {
  cancelAnimationFrame(window.__appState.rafId);
  window.__appState.resizeObserver?.disconnect();
}

ui.init();
renderer.resize();

// Initialize background music
let currentMusicMode: boolean | null = null;
const updateBackgroundMusic = () => {
  const isDaytime = game.isDaytime();
  if (currentMusicMode !== isDaytime) {
    currentMusicMode = isDaytime;
    audio.playBackgroundMusic(isDaytime);
  }
};

// Start music on first user interaction (browsers require user gesture)
let musicStarted = false;
const startMusicOnInteraction = () => {
  if (!musicStarted) {
    musicStarted = true;
    updateBackgroundMusic();
    document.removeEventListener("click", startMusicOnInteraction);
    document.removeEventListener("keydown", startMusicOnInteraction);
  }
};
document.addEventListener("click", startMusicOnInteraction);
document.addEventListener("keydown", startMusicOnInteraction);

const resizeHandler = () => renderer.resize();
window.addEventListener("resize", resizeHandler);

let resizeObserver: ResizeObserver | undefined;
if ("ResizeObserver" in window) {
  resizeObserver = new ResizeObserver(() => renderer.resize());
  const parent = canvas.parentElement;
  if (parent) resizeObserver.observe(parent);
}

let lastTime: number = performance.now();
const loop = (now: number): void => {
  const delta: number = now - lastTime;
  lastTime = now;
  game.update(delta);
  renderer.render();
  ui.updateHUD();
  
  // Update background music based on time of day
  if (musicStarted) {
    updateBackgroundMusic();
  }
  
  window.__appState!.rafId = requestAnimationFrame(loop);
};

const rafId = requestAnimationFrame(loop);

// Store state for HMR
window.__appState = { game, rafId, resizeObserver };

// Save on visibility change (tab close, minimize)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    saveGame(game);
  }
});

// Save before page unload
window.addEventListener("beforeunload", () => {
  saveGame(game);
});

// Accept HMR updates
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.warn("HMR: Reloading...");
  });

  import.meta.hot.dispose(() => {
    if (window.__appState) {
      cancelAnimationFrame(window.__appState.rafId);
      window.__appState.resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeHandler);
    }
    saveGame(game);
  });
}

