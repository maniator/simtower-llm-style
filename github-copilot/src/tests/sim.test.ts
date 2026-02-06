import { describe, it, expect, beforeEach } from "vitest";
import { Game } from "@core/game/Game.ts";
import { Room } from "@core/game/Room.ts";
import { ROOM_TYPES } from "@data/roomTypes.ts";

describe("Room", () => {
  it("should initialize with correct properties", () => {
    const type = ROOM_TYPES.lobby;
    const room = new Room(type, 0, 10);

    expect(room.type).toBe(type);
    expect(room.floorIndex).toBe(0);
    expect(room.startX).toBe(10);
    expect(room.endX).toBe(15); // lobby width is 6
    expect(room.buildRemaining).toBe(type.buildTime);
    expect(room.active).toBe(false);
    expect(room.cleanliness).toBe(100);
  });

  it("should complete construction after ticking", () => {
    const type = ROOM_TYPES.lobby;
    const room = new Room(type, 0, 10);
    const initialTime = room.buildRemaining;

    for (let i = 0; i < initialTime; i++) {
      room.tickConstruction();
    }

    expect(room.active).toBe(true);
    expect(room.buildRemaining).toBe(0);
  });

  it("should not decrease buildRemaining when already active", () => {
    const type = ROOM_TYPES.lobby;
    const room = new Room(type, 0, 10);
    room.active = true;
    room.buildRemaining = 0;

    room.tickConstruction();

    expect(room.buildRemaining).toBe(0);
  });
});

describe("Game", () => {
  let game: Game;

  beforeEach(() => {
    game = new Game(ROOM_TYPES);
  });

  describe("initialization", () => {
    it("should initialize with default values", () => {
      expect(game.money).toBe(180000);
      expect(game.population).toBe(0);
      expect(game.happiness).toBe(70);
      expect(game.rating).toBe(1);
      expect(game.day).toBe(1);
      expect(game.speed).toBe(1);
      expect(game.paused).toBe(false);
    });

    it("should start with lobby and elevator on ground floor", () => {
      const floor = game.getFloor(0);
      expect(floor.rooms.length).toBe(2);
      expect(floor.rooms[0].type.id).toBe("lobby");
      expect(floor.rooms[1].type.id).toBe("elevator_standard");
    });
  });

  describe("placeRoom", () => {
    it("should place a valid room", () => {
      const result = game.placeRoom("condo", 1, 5);

      expect(result.ok).toBe(true);
      expect(result.room).toBeDefined();
      expect(result.room?.type.id).toBe("condo");
    });

    it("should fail when not enough money", () => {
      game.money = 100;
      const result = game.placeRoom("lobby", 1, 5);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("money");
    });

    it("should fail when out of bounds", () => {
      const result = game.placeRoom("lobby", 0, 25);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("bounds");
    });

    it("should fail when space is occupied", () => {
      game.placeRoom("condo", 1, 5);
      const result = game.placeRoom("apartment", 1, 5);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("occupied");
    });

    it("should fail for locked rooms", () => {
      game.rating = 1;
      const result = game.placeRoom("hotel", 1, 5);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Unlock");
    });

    it("should enforce ground-only rules", () => {
      const result = game.placeRoom("lobby", 1, 5);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("ground floor");
    });

    it("should enforce basement-only rules", () => {
      // Unlock metro first by setting rating
      game.rating = 4;
      const result = game.placeRoom("metro", 0, 5);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("basement");
    });

    it("should require support for residential rooms", () => {
      const result = game.placeRoom("condo", 5, 5);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("support");
    });

    it("should deduct money when placing room", () => {
      const initialMoney = game.money;
      const cost = ROOM_TYPES.condo.cost;

      game.placeRoom("condo", 1, 5);

      expect(game.money).toBe(initialMoney - cost);
    });

    it("should create elevator when placing elevator room", () => {
      const initialElevators = game.elevators.length;
      game.placeRoom("elevator_standard", 1, 5);

      expect(game.elevators.length).toBe(initialElevators + 1);
    });
  });

  describe("canPlaceRoom", () => {
    it("should validate placement without placing", () => {
      // Floor 1 doesn't exist yet, so rooms.length should be undefined initially
      expect(game.floors.get(1)).toBeUndefined();

      const result = game.canPlaceRoom("condo", 1, 5);

      expect(result.ok).toBe(true);
      // Validation should not create the floor or place any rooms
      expect(game.floors.get(1)).toBeUndefined();
    });

    it("should return false for invalid placement", () => {
      const result = game.canPlaceRoom("condo", 1, 50);

      expect(result.ok).toBe(false);
    });
  });

  describe("removeRoom", () => {
    it("should remove under-construction room with appropriate refund", () => {
      const placed = game.placeRoom("condo", 1, 5);
      expect(placed.ok).toBe(true);

      // Partially construct the building to get a refund
      if (placed.ok && placed.room) {
        const buildTime = placed.room.type.buildTime;
        for (let i = 0; i < buildTime / 2; i++) {
          placed.room.tickConstruction();
        }
      }

      const initialMoney = game.money;
      const result = game.removeRoom(1, 5);

      expect(result.ok).toBe(true);
      expect(result.refund).toBeGreaterThan(0);
      expect(game.money).toBeGreaterThan(initialMoney);
    });

    it("should not remove completed buildings", () => {
      const placed = game.placeRoom("condo", 1, 5);
      if (placed.ok && placed.room) {
        placed.room.active = true;
        placed.room.buildRemaining = 0;
      }

      const result = game.removeRoom(1, 5);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Cannot remove");
    });

    it("should fail when no room at position", () => {
      const result = game.removeRoom(5, 10);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("No room");
    });
  });

  describe("reset", () => {
    it("should reset game to initial state", () => {
      game.money = 50000;
      game.day = 10;
      game.population = 100;
      game.placeRoom("condo", 1, 5);

      game.reset();

      expect(game.money).toBe(180000);
      expect(game.day).toBe(1);
      expect(game.population).toBe(0);
      expect(game.floors.size).toBe(1);
    });
  });

  describe("update", () => {
    it("should not update when paused", () => {
      game.paused = true;
      const initialTime = game.time;

      game.update(1000);

      expect(game.time).toBe(initialTime);
    });

    it("should update when speed is set", () => {
      game.speed = 1;
      game.paused = false;
      const initialTime = game.time;

      game.update(220);

      expect(game.time).toBeGreaterThan(initialTime);
    });

    it("should advance day after 1440 minutes", () => {
      game.time = 1439;
      const initialDay = game.day;

      game.update(220);

      expect(game.day).toBe(initialDay + 1);
      expect(game.time).toBe(0);
    });
  });

  describe("formatMoney", () => {
    it("should format money correctly", () => {
      game.money = 123456;
      expect(game.formatMoney()).toBe("$123,456");
    });
  });

  describe("getTimeLabel", () => {
    it("should format time correctly", () => {
      game.day = 5;
      game.time = 480; // 8:00

      const label = game.getTimeLabel();

      expect(label).toContain("Day 5");
      expect(label).toContain("8:00");
    });
  });

  describe("averageWait", () => {
    it("should return 0 when no wait samples", () => {
      expect(game.averageWait()).toBe(0);
    });

    it("should calculate average wait time", () => {
      game.waitSamples = [5, 10, 15];

      expect(game.averageWait()).toBe(10);
    });
  });

  describe("auto-save callback", () => {
    it("should call auto-save callback when set", () => {
      let called = false;
      game.setAutoSaveCallback(() => {
        called = true;
      });

      // Trigger auto-save (every 30 minutes in-game)
      game.time = 29;
      game.update(220); // Advances 1 minute to trigger save at minute 30

      expect(called).toBe(true);
    });
  });
});
