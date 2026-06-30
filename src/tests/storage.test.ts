import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { GRID } from "../engine/facilities";

describe("SaveGame", () => {
  beforeEach(() => localStorage.clear());

  function sampleGame(): Simulation {
    const sim = Simulation.newGame(42);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 12; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    sim.build("office", 2, x0);
    sim.money = 1234567;
    sim.tick(60 * 5);
    return sim;
  }

  it("persists the pending VIP inspection day across save/load", () => {
    const sim = sampleGame();
    // Simulate a Wedding Hall having scheduled the VIP a few days out.
    (sim as unknown as { vipVisitDay: number }).vipVisitDay = sim.clock.day + 3;
    const expected = (sim as unknown as { vipVisitDay: number }).vipVisitDay;
    const loaded = Simulation.deserialize(sim.serialize());
    expect((loaded as unknown as { vipVisitDay: number }).vipVisitDay).toBe(expected);
  });

  it("round-trips through localStorage", () => {
    const sim = sampleGame();
    SaveGame.save(sim);
    expect(SaveGame.hasSave()).toBe(true);
    const loaded = SaveGame.load()!;
    expect(loaded).not.toBeNull();
    expect(loaded.money).toBe(sim.money);
    expect(loaded.clock.minutes).toBe(sim.clock.minutes);
    expect(loaded.tower.units.length).toBe(sim.tower.units.length);
    expect(loaded.tower.transports.length).toBe(sim.tower.transports.length);
  });

  it("preserves occupancy lookups after load", () => {
    const sim = sampleGame();
    SaveGame.save(sim);
    const loaded = SaveGame.load()!;
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(loaded.tower.unitAt(2, x0)).toBeDefined();
  });

  it("exports and imports JSON", () => {
    const sim = sampleGame();
    const json = SaveGame.export(sim);
    const loaded = SaveGame.import(json);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.star).toBe(sim.star);
  });

  it("rejects malformed imports", () => {
    expect(() => SaveGame.import("{}")).toThrow();
    expect(() => SaveGame.import("not json")).toThrow();
  });

  it("returns null when no save exists", () => {
    expect(SaveGame.load()).toBeNull();
    expect(SaveGame.hasSave()).toBe(false);
  });

  it("drops units with an unrecognized kind on load", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    const before = data.units.length;
    // Inject a bogus unit as if from a tampered/old save file.
    (data.units as any).push({ ...data.units[0], id: 99999, kind: "spaceport" });
    const loaded = SaveGame.import(JSON.stringify(data));
    expect(loaded.tower.units.length).toBe(before);
    expect(loaded.tower.units.some((u) => (u.kind as string) === "spaceport")).toBe(false);
  });
});
