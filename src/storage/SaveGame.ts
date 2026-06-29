import { Simulation } from "../engine/Simulation";
import type { SerializedGame } from "../engine/types";

const KEY = "simtower-clone-save";

/** Persists and restores games via localStorage, plus file export/import. */
export const SaveGame = {
  save(sim: Simulation): void {
    const data = sim.serialize();
    localStorage.setItem(KEY, JSON.stringify(data));
  },

  hasSave(): boolean {
    return localStorage.getItem(KEY) !== null;
  },

  load(): Simulation | null {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SerializedGame;
      return Simulation.deserialize(data);
    } catch {
      return null;
    }
  },

  clear(): void {
    localStorage.removeItem(KEY);
  },

  /** Serialize to a JSON string for file download. */
  export(sim: Simulation): string {
    return JSON.stringify(sim.serialize(), null, 2);
  },

  /** Parse a previously exported JSON string. Throws on malformed data. */
  import(json: string): Simulation {
    const data = JSON.parse(json) as SerializedGame;
    if (typeof data.minutes !== "number" || !Array.isArray(data.units)) {
      throw new Error("Not a valid SimTower save file.");
    }
    return Simulation.deserialize(data);
  },
};
