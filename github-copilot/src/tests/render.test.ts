import { describe, it, expect, beforeEach, vi } from "vitest";
import { Renderer } from "../core/render/Renderer.ts";
import { Game } from "../core/game/Game.ts";
import { ROOM_TYPES } from "../data/roomTypes.ts";

describe("Renderer", () => {
  let canvas: HTMLCanvasElement;
  let game: Game;
  let renderer: Renderer;
  let mockContext: any;

  beforeEach(() => {
    // Mock canvas context since Happy-DOM doesn't fully support Canvas API
    mockContext = {
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      canvas: { width: 800, height: 600 },
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      font: "",
      textAlign: "",
      textBaseline: "",
      lineWidth: 1,
    };

    canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    // Happy-DOM doesn't have getContext, so we add it
    (canvas as any).getContext = vi.fn().mockReturnValue(mockContext);

    game = new Game(ROOM_TYPES);
    renderer = new Renderer(canvas, game);
  });

  it("should initialize with correct properties", () => {
    expect(renderer.canvas).toBe(canvas);
    expect(renderer.camera.y).toBe(0);
  });

  describe("resize", () => {
    it("should update canvas dimensions", () => {
      // Mock getBoundingClientRect directly on canvas
      vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        width: 1024,
        height: 768,
        top: 0,
        left: 0,
        right: 1024,
        bottom: 768,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      renderer.resize();

      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
    });

    it("should handle missing parent", () => {
      // Mock getBoundingClientRect to return 0 dimensions (simulating no parent)
      vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      expect(() => renderer.resize()).not.toThrow();
    });
  });

  describe("scroll", () => {
    it("should update camera position", () => {
      const initialY = renderer.camera.y;

      renderer.scroll(2);

      expect(renderer.camera.y).toBe(initialY + 2);
    });

    it("should clamp camera within bounds", () => {
      game.minFloor = -5;
      game.maxFloor = 10;

      renderer.scroll(-1000);
      expect(renderer.camera.y).toBeGreaterThanOrEqual(game.minFloor - 2);

      renderer.scroll(2000);
      expect(renderer.camera.y).toBeLessThanOrEqual(game.maxFloor + 2);
    });
  });

  describe("screenToCell", () => {
    it("should convert screen coordinates to cell position", () => {
      const result = renderer.screenToCell(100, 100);

      expect(result).toHaveProperty("cellX");
      expect(result).toHaveProperty("floorIndex");
      expect(typeof result.cellX).toBe("number");
      expect(typeof result.floorIndex).toBe("number");
    });

    it("should handle negative coordinates", () => {
      const result = renderer.screenToCell(-10, -10);

      expect(result.cellX).toBeLessThan(0);
    });
  });

  describe("setGhost", () => {
    it("should set ghost preview", () => {
      const type = ROOM_TYPES.condo;

      renderer.setGhost({
        type,
        floorIndex: 1,
        startX: 5,
        valid: true,
      });

      expect(() => renderer.render()).not.toThrow();
    });

    it("should clear ghost preview", () => {
      renderer.setGhost(null);

      expect(() => renderer.render()).not.toThrow();
    });
  });

  describe("render", () => {
    it("should render without errors", () => {
      expect(() => renderer.render()).not.toThrow();
    });

    it("should render with ghost overlay", () => {
      renderer.setGhost({
        type: ROOM_TYPES.condo,
        floorIndex: 1,
        startX: 5,
        valid: true,
      });

      expect(() => renderer.render()).not.toThrow();
    });

    it("should render with invalid ghost", () => {
      renderer.setGhost({
        type: ROOM_TYPES.condo,
        floorIndex: 1,
        startX: 5,
        valid: false,
      });

      expect(() => renderer.render()).not.toThrow();
    });

    it("should render elevators", () => {
      game.placeRoom("elevator_standard", 1, 5);

      expect(() => renderer.render()).not.toThrow();
    });

    it("should render at different times of day", () => {
      game.time = 720; // Noon

      expect(() => renderer.render()).not.toThrow();

      game.time = 0; // Midnight

      expect(() => renderer.render()).not.toThrow();
    });

    it("should handle multiple floors", () => {
      for (let i = 1; i <= 5; i++) {
        game.placeRoom("condo", i, 5);
      }

      expect(() => renderer.render()).not.toThrow();
    });
  });
});
