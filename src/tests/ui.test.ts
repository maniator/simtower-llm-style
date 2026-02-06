import { describe, it, expect, beforeEach, vi } from "vitest";
import { UI } from "@ui/UI.ts";
import { Game } from "@core/game/Game.ts";
import { ROOM_TYPES, CATEGORY_ORDER } from "@data/roomTypes.ts";

const setupDom = (): HTMLCanvasElement => {
  document.body.innerHTML = `
    <div id="money"></div>
    <div id="population"></div>
    <div id="happiness"></div>
    <div id="rating"></div>
    <div id="info-panel"></div>
    <div id="elevator-panel"></div>
    <div id="tool-categories"></div>
    <div id="status-text"></div>
    <div id="time-indicator"></div>
    <div id="zoom-indicator"></div>
    <button class="time-btn" data-speed="0">Pause</button>
    <button class="time-btn" data-speed="1">Play</button>
    <button class="time-btn" data-speed="3">Fast</button>
    <button id="reset-btn"></button>
    <button id="export-btn"></button>
    <button id="import-btn"></button>
  `;
  const canvas = document.createElement("canvas");
  canvas.id = "tower-canvas";
  document.body.appendChild(canvas);
  return canvas;
};

describe("UI", () => {
  let game: Game;
  let canvas: HTMLCanvasElement;
  let renderer: any;
  let audio: any;
  let ui: UI;

  beforeEach(() => {
    canvas = setupDom();
    game = new Game(ROOM_TYPES);
    renderer = {
      canvas,
      camera: { y: 0, zoom: 1.0 },
      screenToCell: vi.fn(() => ({ cellX: 0, floorIndex: 0 })),
      setGhost: vi.fn(),
      scroll: vi.fn(),
    };
    audio = {
      uiClick: vi.fn(),
      buildFail: vi.fn(),
      buildComplete: vi.fn(),
      populationGain: vi.fn(),
      vipArrival: vi.fn(),
    };
    ui = new UI(game, renderer, ROOM_TYPES, CATEGORY_ORDER, audio);

    (window as any).confirm = vi.fn(() => false);
    (window as any).prompt = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    });
  });

  it("should build the toolbar on init", () => {
    ui.init();

    const buttons = document.querySelectorAll(".tool-btn");
    expect(buttons.length).toBeGreaterThan(0);

    const active = document.querySelectorAll(".tool-btn.active");
    expect(active.length).toBeGreaterThan(0);
  });

  it("should update game speed from time controls", () => {
    ui.init();

    const buttons = document.querySelectorAll<HTMLButtonElement>(".time-btn");
    buttons[0].click();
    expect(game.paused).toBe(true);
    expect(game.speed).toBe(0);

    buttons[1].click();
    expect(game.paused).toBe(false);
    expect(game.speed).toBe(1);
  });

  it("should update HUD and trigger audio cues", () => {
    game.time = 480;
    game.day = 2;

    ui.updateHUD();

    game.population = 1;
    ui.updateHUD();

    game.population = 2;
    ui.updateHUD();
    expect(audio.populationGain).toHaveBeenCalledTimes(1);

    game.statusMessage = "construction started";
    ui.updateHUD();
    expect(audio.buildComplete).toHaveBeenCalledTimes(1);

    game.statusMessage = "VIP arrived";
    ui.updateHUD();
    expect(audio.vipArrival).toHaveBeenCalledTimes(1);

    const timeLabel = document.getElementById("time-indicator");
    expect(timeLabel?.textContent).toContain("Day 2");
  });
});

