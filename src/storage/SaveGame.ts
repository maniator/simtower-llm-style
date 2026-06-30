import { Simulation } from "../engine/Simulation";
import type { SerializedGame } from "../engine/types";

/**
 * Persistence. Games are stored in localStorage: one auto-save slot plus a
 * handful of named manual slots, so the player can keep multiple towers. Also
 * supports JSON export/import for sharing or backups.
 *
 * (localStorage suffices for a single save object well under its ~5MB quota.
 * IndexedDB would only be needed for very large numbers of saves; see the
 * project notes for the v2 path.)
 */

const AUTO_KEY = "simtower-clone-save";
const SLOT_KEY = (n: number) => `simtower-clone-slot-${n}`;
export const SLOT_COUNT = 3;

export interface SlotInfo {
  slot: number | "auto";
  exists: boolean;
  towerName?: string;
  star?: number;
  population?: number;
  funds?: number;
  savedAt?: number;
}

function readSlot(key: string): SerializedGame | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SerializedGame;
  } catch {
    return null;
  }
}

function infoFrom(slot: number | "auto", key: string): SlotInfo {
  const data = readSlot(key);
  if (!data) return { slot, exists: false };
  let population = 0;
  try {
    population = Simulation.deserialize(data).population;
  } catch {
    /* ignore corrupt slot */
  }
  return {
    slot,
    exists: true,
    towerName: data.towerName,
    star: data.star,
    population,
    funds: data.money,
    savedAt: (data as SerializedGame & { savedAt?: number }).savedAt,
  };
}

export const SaveGame = {
  // ---- Auto-save slot (used on startup) --------------------------------
  save(sim: Simulation): void {
    this.saveTo(AUTO_KEY, sim);
  },
  hasSave(): boolean {
    return localStorage.getItem(AUTO_KEY) !== null;
  },
  load(): Simulation | null {
    const data = readSlot(AUTO_KEY);
    if (!data) return null;
    try {
      return Simulation.deserialize(data);
    } catch {
      return null;
    }
  },
  clear(): void {
    localStorage.removeItem(AUTO_KEY);
  },

  // ---- Named manual slots ----------------------------------------------
  saveSlot(n: number, sim: Simulation): void {
    this.saveTo(SLOT_KEY(n), sim);
  },
  loadSlot(n: number): Simulation | null {
    const data = readSlot(SLOT_KEY(n));
    if (!data) return null;
    try {
      return Simulation.deserialize(data);
    } catch {
      return null;
    }
  },
  deleteSlot(n: number): void {
    localStorage.removeItem(SLOT_KEY(n));
  },

  /** Metadata for every slot, for the saves manager UI. */
  listSlots(): SlotInfo[] {
    const slots: SlotInfo[] = [infoFrom("auto", AUTO_KEY)];
    for (let n = 1; n <= SLOT_COUNT; n++) slots.push(infoFrom(n, SLOT_KEY(n)));
    return slots;
  },

  // ---- Shared writer + export/import -----------------------------------
  saveTo(key: string, sim: Simulation): void {
    const data = sim.serialize() as SerializedGame & { savedAt: number };
    // Stamp save time without relying on a deterministic clock in the engine.
    data.savedAt = nowMs();
    localStorage.setItem(key, JSON.stringify(data));
  },

  export(sim: Simulation): string {
    return JSON.stringify(sim.serialize(), null, 2);
  },

  import(json: string): Simulation {
    const data = JSON.parse(json) as SerializedGame;
    if (typeof data.minutes !== "number" || !Array.isArray(data.units)) {
      throw new Error("Not a valid SimTower save file.");
    }
    return Simulation.deserialize(data);
  },
};

function nowMs(): number {
  // Date is unavailable in the deterministic engine, but the storage layer is
  // UI-side, so a wall-clock stamp here is fine.
  return typeof Date !== "undefined" ? Date.now() : 0;
}
