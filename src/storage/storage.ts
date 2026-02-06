import type { Game } from "@core/game/Game.ts";

const STORAGE_KEY = "simtower_save";

export interface SavedGameState {
  version: number;
  money: number;
  population: number;
  happiness: number;
  rating: number;
  day: number;
  time: number;
  unlockedBuildings: number[];
  floors: Array<{
    index: number;
    rooms: Array<{
      typeId: string;
      startX: number;
      buildRemaining: number;
      active: boolean;
      cleanliness: number;
    }>;
  }>;
  timestamp: number;
}

export function saveGame(game: Game): void {
  try {
    const floors = Array.from(game.floors.values()).map((floor) => ({
      index: floor.index,
      rooms: floor.rooms.map((room) => ({
        typeId: room.type.id,
        startX: room.startX,
        buildRemaining: room.buildRemaining,
        active: room.active,
        cleanliness: room.cleanliness,
      })),
    }));

    const saveData: SavedGameState = {
      version: 1,
      money: game.money,
      population: game.population,
      happiness: game.happiness,
      rating: game.rating,
      day: game.day,
      time: game.time,
      unlockedBuildings: Array.from(game.unlockedBuildings),
      floors,
      timestamp: Date.now(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
  } catch (error) {
    console.error("Failed to save game:", error);
  }
}

export function loadGame(game: Game): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;

    const data: SavedGameState = JSON.parse(saved) as unknown as SavedGameState;
    if (data.version !== 1) return false;

    // Restore basic state
    game.money = data.money;
    game.population = data.population;
    game.happiness = data.happiness;
    game.rating = data.rating;
    game.day = data.day;
    game.time = data.time;
    game.unlockedBuildings = new Set(data.unlockedBuildings || [1]);

    // Clear existing floors
    game.floors.clear();
    game.elevators = [];
    game.people = [];
    game.events = [];

    // Restore floors and rooms
    for (const floorData of data.floors) {
      for (const roomData of floorData.rooms) {
        const result = game.placeRoom(
          roomData.typeId,
          floorData.index,
          roomData.startX,
          true,
        );
        if (result.ok && result.room) {
          result.room.buildRemaining = roomData.buildRemaining;
          result.room.active = roomData.active;
          result.room.cleanliness = roomData.cleanliness;
        }
      }
    }

    return true;
  } catch (error) {
    console.error("Failed to load game:", error);
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Save cleared successfully
  } catch (error) {
    console.error("Failed to clear save:", error);
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function exportGame(game: Game): string {
  const floors = Array.from(game.floors.values()).map((floor) => ({
    index: floor.index,
    rooms: floor.rooms.map((room) => ({
      typeId: room.type.id,
      startX: room.startX,
      buildRemaining: room.buildRemaining,
      active: room.active,
      cleanliness: room.cleanliness,
    })),
  }));

  const saveData: SavedGameState = {
    version: 1,
    money: game.money,
    population: game.population,
    happiness: game.happiness,
    rating: game.rating,
    day: game.day,
    time: game.time,
    unlockedBuildings: Array.from(game.unlockedBuildings),
    floors,
    timestamp: Date.now(),
  };

  const json = JSON.stringify(saveData);
  return btoa(json); // Base64 encode
}

export function importGame(game: Game, encoded: string): boolean {
  try {
    const json = atob(encoded); // Base64 decode
    const data: SavedGameState = JSON.parse(json);

    if (data.version !== 1) {
      console.error("Unsupported save version");
      return false;
    }

    // Restore basic state
    game.money = data.money;
    game.population = data.population;
    game.happiness = data.happiness;
    game.rating = data.rating;
    game.day = data.day;
    game.time = data.time;
    game.unlockedBuildings = new Set(data.unlockedBuildings || [1]);

    // Clear existing floors
    game.floors.clear();
    game.elevators = [];
    game.people = [];
    game.events = [];

    // Restore floors and rooms
    for (const floorData of data.floors) {
      for (const roomData of floorData.rooms) {
        const result = game.placeRoom(
          roomData.typeId,
          floorData.index,
          roomData.startX,
          true,
        );
        if (result.ok && result.room) {
          result.room.buildRemaining = roomData.buildRemaining;
          result.room.active = roomData.active;
          result.room.cleanliness = roomData.cleanliness;
        }
      }
    }

    // Also save to localStorage
    saveGame(game);
    // Game imported successfully
    return true;
  } catch (error) {
    console.error("Failed to import game:", error);
    return false;
  }
}

