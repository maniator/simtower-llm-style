import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveGame,
  loadGame,
  clearSave,
  hasSave,
  exportGame,
  importGame,
} from "@storage/storage.ts";
import { Game } from "@core/game/Game.ts";
import { ROOM_TYPES } from "@data/roomTypes.ts";

describe("Storage", () => {
  let game: Game;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    game = new Game(ROOM_TYPES);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("saveGame", () => {
    it("should save game to localStorage", () => {
      game.money = 50000;
      game.day = 5;

      saveGame(game);

      const saved = localStorage.getItem("simtower_save");
      expect(saved).toBeTruthy();

      const data = JSON.parse(saved!);
      expect(data.money).toBe(50000);
      expect(data.day).toBe(5);
    });

    it("should handle save errors gracefully", () => {
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("Storage full");
      });

      // Should not throw even when localStorage fails
      expect(() => saveGame(game)).not.toThrow();
    });
  });

  describe("loadGame", () => {
    it("should load game from localStorage", () => {
      // Save a specific game state
      const saveGame1 = new Game(ROOM_TYPES);
      saveGame1.money = 50000;
      saveGame1.day = 5;
      saveGame1.placeRoom("condo", 1, 5);

      saveGame(saveGame1);

      // Load into a new game instance
      const newGame = new Game(ROOM_TYPES);
      const result = loadGame(newGame);

      expect(result).toBe(true);
      // Money should match what was saved from saveGame1 AFTER placing the condo
      expect(newGame.money).toBe(saveGame1.money);
      expect(newGame.day).toBe(5);
    });

    it("should return false when no save exists", () => {
      const result = loadGame(game);

      expect(result).toBe(false);
    });

    it("should handle invalid save data", () => {
      localStorage.setItem("simtower_save", "invalid json");
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = loadGame(game);

      expect(result).toBe(false);
    });

    it("should reject incompatible save versions", () => {
      localStorage.setItem(
        "simtower_save",
        JSON.stringify({ version: 999, money: 1000 }),
      );

      const result = loadGame(game);

      expect(result).toBe(false);
    });
  });

  describe("clearSave", () => {
    it("should clear saved game", () => {
      saveGame(game);
      expect(hasSave()).toBe(true);

      clearSave();

      expect(hasSave()).toBe(false);
    });

    it("should handle clear errors gracefully", () => {
      vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
        throw new Error("Storage error");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => clearSave()).not.toThrow();
    });
  });

  describe("hasSave", () => {
    it("should return true when save exists", () => {
      saveGame(game);

      expect(hasSave()).toBe(true);
    });

    it("should return false when no save exists", () => {
      expect(hasSave()).toBe(false);
    });

    it("should handle storage errors", () => {
      vi.spyOn(localStorage, "getItem").mockImplementation(() => {
        throw new Error("Storage error");
      });

      expect(hasSave()).toBe(false);
    });
  });

  describe("exportGame", () => {
    it("should export game as base64 string", () => {
      game.money = 50000;
      game.day = 5;

      const exported = exportGame(game);

      expect(typeof exported).toBe("string");
      expect(exported.length).toBeGreaterThan(0);

      // Should be valid base64
      expect(() => atob(exported)).not.toThrow();
    });

    it("should include all game state", () => {
      game.money = 50000;
      game.population = 100;
      game.rating = 3;

      const exported = exportGame(game);
      const decoded = JSON.parse(atob(exported));

      expect(decoded.money).toBe(50000);
      expect(decoded.population).toBe(100);
      expect(decoded.rating).toBe(3);
    });
  });

  describe("importGame", () => {
    it("should import game from base64 string", () => {
      game.money = 50000;
      game.day = 5;
      const exported = exportGame(game);

      const newGame = new Game(ROOM_TYPES);
      const result = importGame(newGame, exported);

      expect(result).toBe(true);
      expect(newGame.money).toBe(50000);
      expect(newGame.day).toBe(5);
    });

    it("should handle invalid base64", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = importGame(game, "invalid base64!!!");

      expect(result).toBe(false);
    });

    it("should reject incompatible versions", () => {
      const invalidData = btoa(JSON.stringify({ version: 999 }));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = importGame(game, invalidData);

      expect(result).toBe(false);
    });

    it("should save imported game to localStorage", () => {
      game.money = 50000;
      const exported = exportGame(game);

      const newGame = new Game(ROOM_TYPES);
      importGame(newGame, exported);

      expect(hasSave()).toBe(true);
    });
  });
});
