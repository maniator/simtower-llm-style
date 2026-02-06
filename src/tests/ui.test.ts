import { describe, it, expect, beforeEach, vi } from "vitest";
import { UI } from "@ui/UI.ts";
import { Game } from "@core/game/Game.ts";
import { ROOM_TYPES, CATEGORY_ORDER } from "@data/roomTypes.ts";
import { exportGame } from "@storage/storage.ts";

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
      camera: { y: 0 },
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

  it("should handle reset button with confirmation", () => {
    (window as any).confirm = vi.fn(() => true);
    ui.init();

    const resetBtn = document.getElementById("reset-btn");
    resetBtn?.click();

    expect(game.rating).toBe(1);
    expect(game.money).toBe(180000);
    expect(renderer.camera.y).toBe(0);
  });

  it("should handle reset button cancellation", () => {
    (window as any).confirm = vi.fn(() => false);
    ui.init();

    const oldMoney = game.money;
    game.money = 500000;

    const resetBtn = document.getElementById("reset-btn");
    resetBtn?.click();

    expect(game.money).toBe(500000);
  });

  it("should handle export button", async () => {
    ui.init();

    const exportBtn = document.getElementById("export-btn");
    exportBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(audio.uiClick).toHaveBeenCalled();
  });

  it("should handle export button with clipboard failure", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn(() => Promise.reject(new Error("clipboard fail"))),
      },
      configurable: true,
    });
    (window as any).prompt = vi.fn();
    ui.init();

    const exportBtn = document.getElementById("export-btn");
    exportBtn?.click();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((window as any).prompt).toHaveBeenCalled();
  });

  it("should handle import button with valid code", () => {
    const validSave = exportGame(game);
    (window as any).prompt = vi.fn(() => validSave);
    ui.init();

    const importBtn = document.getElementById("import-btn");
    importBtn?.click();

    expect(renderer.camera.y).toBe(0);
    expect(audio.uiClick).toHaveBeenCalled();
  });

  it("should handle import button cancellation", () => {
    (window as any).prompt = vi.fn(() => null);
    ui.init();

    const oldMoney = game.money;
    const importBtn = document.getElementById("import-btn");
    importBtn?.click();

    expect(game.money).toBe(oldMoney);
  });

  it("should handle canvas click for room placement", () => {
    ui.init();

    const clickEvent = new MouseEvent("click", {
      clientX: 100,
      clientY: 100,
    });
    canvas.dispatchEvent(clickEvent);

    expect(audio.uiClick).toHaveBeenCalled();
  });

  it("should handle canvas right-click for room removal", () => {
    ui.init();
    game.placeRoom("condo", 1, 5);

    renderer.screenToCell = vi.fn(() => ({ cellX: 5, floorIndex: 1 }));

    const contextEvent = new MouseEvent("contextmenu", {
      clientX: 100,
      clientY: 100,
    });
    canvas.dispatchEvent(contextEvent);

    expect(audio.buildFail).toHaveBeenCalled();
  });

  it("should handle canvas mousemove for hover", () => {
    ui.init();

    const moveEvent = new MouseEvent("mousemove", {
      clientX: 100,
      clientY: 100,
    });
    canvas.dispatchEvent(moveEvent);

    expect(renderer.setGhost).toHaveBeenCalled();
  });

  it("should handle canvas mouseleave", () => {
    ui.init();

    const leaveEvent = new MouseEvent("mouseleave");
    canvas.dispatchEvent(leaveEvent);

    expect(renderer.setGhost).toHaveBeenCalledWith(null);
  });

  it("should handle canvas wheel for scrolling", () => {
    ui.init();

    const wheelEvent = new WheelEvent("wheel", {
      deltaY: 100,
    });
    canvas.dispatchEvent(wheelEvent);

    expect(renderer.scroll).toHaveBeenCalled();
  });

  it("should handle mousemove with out-of-bounds cell", () => {
    ui.init();

    renderer.screenToCell = vi.fn(() => ({ cellX: -1, floorIndex: 0 }));

    const moveEvent = new MouseEvent("mousemove", {
      clientX: 10,
      clientY: 10,
    });
    canvas.dispatchEvent(moveEvent);

    expect(renderer.setGhost).toHaveBeenCalledWith(null);
  });

  it("should not select locked room", () => {
    ui.init();

    game.rating = 1;
    const buttons = document.querySelectorAll<HTMLButtonElement>(".tool-btn");
    const lockedButton = Array.from(buttons).find(
      (btn) => btn.dataset.room === "penthouse",
    );

    if (lockedButton) {
      lockedButton.click();
      expect(lockedButton.classList.contains("active")).toBe(false);
    }
  });

  it("should update elevator panel with elevators", () => {
    ui.init();

    game.elevators = [
      {
        type: "Standard",
        position: 1.5,
        direction: 1,
        passengers: [],
        capacity: 8,
      } as any,
    ];

    ui.updateHUD();

    const elevatorPanel = document.getElementById("elevator-panel");
    expect(elevatorPanel?.innerHTML).toContain("Standard");
    expect(elevatorPanel?.innerHTML).toContain("Up");
  });

  it("should update info panel with room details", () => {
    ui.init();

    const infoPanel = document.getElementById("info-panel");
    expect(infoPanel?.innerHTML).toContain("Lobby");
    expect(infoPanel?.innerHTML).toContain("Cost:");
  });
});

