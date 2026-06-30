import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID, FACILITIES } from "../engine/facilities";

/** FAQ-parity (complete) tests: the canon star ladder, office noise, the
 * hotel-population rule and the VIP-in-suite gate. */

const W = GRID.width;
const C = Math.floor(W / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}
/** Fabricate `target` occupant-population of occupied offices across full floors. */
function towerWithPop(seed: number, target: number): Simulation {
  const sim = Simulation.newGame(seed);
  sim.money = 1e12;
  lay(sim, "lobby", 1);
  let pop = 0;
  let f = 2;
  while (pop < target && f <= 100) {
    lay(sim, "floor", f);
    for (let x = 0; x + 9 <= W && pop < target; x += 9) {
      const r = sim.tower.place("office", f, x);
      if (r.ok) {
        sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
        pop += FACILITIES.office.population;
      }
    }
    f++;
  }
  return sim;
}

describe("Canon star ladder (FAQ)", () => {
  it("4★ requires Medical + Recycling + >1 Suite + a favorable VIP", () => {
    const sim = towerWithPop(1, 5200);
    sim.star = 3;
    const top = sim.tower.highestFloor + 1;
    lay(sim, "floor", top);
    sim.tower.place("medical", top, 0);
    sim.tower.place("security", top, 60);
    sim.evaluateStar();
    expect(sim.star).toBe(3); // blocked: no recycling / suites / VIP yet

    // Add the missing amenities.
    lay(sim, "floor", 0);
    lay(sim, "floor", -1);
    sim.tower.place("recycling", -1, 0);
    sim.tower.place("hotelSuite", top, 20);
    sim.tower.place("hotelSuite", top, 40);
    sim.evaluateStar();
    expect(sim.star).toBe(3); // still blocked without the favorable VIP

    sim.vipFavorable = true;
    sim.evaluateStar();
    expect(sim.star).toBe(4);
  });

  it("5★ requires a Metro Station", () => {
    const sim = towerWithPop(2, 10200);
    sim.star = 4;
    sim.vipFavorable = true;
    const top = sim.tower.highestFloor + 1;
    lay(sim, "floor", top);
    sim.tower.place("medical", top, 0);
    sim.tower.place("security", top, 60);
    lay(sim, "floor", 0);
    lay(sim, "floor", -1);
    lay(sim, "floor", -2);
    sim.tower.place("recycling", -2, 0); // spans -2/-1, leaving floor 0 free for the metro
    sim.tower.place("hotelSuite", top, 20);
    sim.tower.place("hotelSuite", top, 40);
    sim.evaluateStar();
    expect(sim.star).toBe(4); // pop is there, but no Metro → capped at 4

    expect(sim.tower.place("metro", 0, 0).ok).toBe(true);
    sim.evaluateStar();
    expect(sim.star).toBe(5);
  });
});

describe("Hotel population counts only while climbing to 3★ (FAQ)", () => {
  it("hotel guests count for the rating below 3★ but not at/above it", () => {
    const sim = Simulation.newGame(3);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // 50 occupied single-hotel rooms = 50 guests (no offices).
    for (let i = 0, x = 0; i < 50 && x + 4 <= W; i++, x += 4) {
      const r = sim.tower.place("hotelSingle", 2, x);
      if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "asleep";
    }
    sim.star = 1;
    expect(sim.ratingPopulation()).toBeGreaterThan(0); // hotels count toward 2★
    sim.star = 3;
    expect(sim.ratingPopulation()).toBe(0); // hotels excluded once at 3★
  });
});

describe("Office noise (FAQ): offices annoy adjacent hotels/condos", () => {
  it("a hotel beside an office loses satisfaction; one apart does not", () => {
    const sim = Simulation.newGame(4);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2); // floor 2 served
    // Office at x, a hotel immediately to its right (noisy), and a hotel far away.
    sim.tower.place("office", 2, C);
    const noisy = sim.tower.place("hotelDouble", 2, C + 9);
    const quiet = sim.tower.place("hotelDouble", 2, C + 30);
    const a = sim.tower.units.find((u) => u.id === noisy.unitId)!;
    const b = sim.tower.units.find((u) => u.id === quiet.unitId)!;
    for (const u of [a, b]) { u.state = "asleep"; u.satisfaction = 1; }
    for (let i = 0; i < 6; i++) sim.tick(60);
    expect(a.satisfaction).toBeLessThan(b.satisfaction); // the office neighbor suffers
  });
});

describe("VIP stay (FAQ): only in a suite, gates the favorable review", () => {
  it("a well-run served suite earns a favorable VIP review", () => {
    const sim = Simulation.newGame(5);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    sim.star = 3;
    const r = sim.tower.place("hotelSuite", 2, 0);
    const suite = sim.tower.units.find((u) => u.id === r.unitId)!;
    suite.state = "asleep";
    suite.satisfaction = 1;
    expect(sim.vipFavorable).toBe(false);
    for (let i = 0; i < 24; i++) sim.tick(60); // a day → a VIP stays
    expect(sim.vipFavorable).toBe(true);
  });
});

describe("Events & amounts (FAQ Cluster B)", () => {
  it("rain depresses commercial income vs a clear day", () => {
    function dayIncome(weather: "clear" | "rain"): number {
      const sim = Simulation.newGame(7);
      sim.money = 1e12;
      sim.star = 3;
      lay(sim, "lobby", 1);
      lay(sim, "floor", 2);
      sim.buildTransport("elevatorStandard", C, 1, 2);
      const r = sim.tower.place("fastFood", 2, 0);
      sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      sim.weather = weather; // stays fixed within the day (no day boundary crossed)
      const before = sim.money;
      for (let i = 0; i < 10; i++) sim.tick(60); // 07:00→17:00, fast food open
      return sim.money - before;
    }
    expect(dayIncome("rain")).toBeLessThan(dayIncome("clear"));
  });

  it("a cinema carries a monthly film-booking cost", () => {
    const sim = Simulation.newGame(8);
    sim.money = 1e9;
    sim.star = 3;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    expect(sim.tower.place("cinema", 2, 0).ok).toBe(true); // spans floors 2–3
    const before = sim.money;
    sim.tick(60 * 24); // crosses the first day → monthly maintenance runs
    expect(before - sim.money).toBeGreaterThanOrEqual(150_000);
  });

  it("an unguarded bomb levels several rooms across ~5 floors", () => {
    const sim = Simulation.newGame(9);
    sim.money = 1e9;
    sim.star = 4;
    const x0 = C - 20;
    for (let f = 2; f <= 8; f++) {
      lay(sim, "floor", f);
      for (let i = 0; i < 4; i++) {
        const r = sim.tower.place("office", f, x0 + i * 9);
        if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      }
    }
    const liveBefore = sim.tower.units.filter((u) => u.kind === "office" && u.state === "occupied").length;
    sim.bombThreat(); // no security built
    const liveAfter = sim.tower.units.filter((u) => u.kind === "office" && u.state === "occupied").length;
    expect(liveBefore - liveAfter).toBeGreaterThan(1); // more than a single room destroyed
  });

  it("buried treasure is worth about half a million", () => {
    const sim = Simulation.newGame(42);
    sim.money = 1e9;
    sim.star = 3;
    for (let x = 0; x < 60; x++) sim.tower.place("floor", 0, C - 30 + x);
    for (let i = 0; i + 6 <= 60; i += 6) sim.build("parking", 0, C - 30 + i); // distinct fresh tiles
    const treasure = sim.log.find((e) => e.text.toLowerCase().includes("treasure"));
    expect(treasure).toBeDefined();
    const amount = Number(treasure!.text.replace(/[^0-9]/g, ""));
    expect(amount).toBeGreaterThanOrEqual(400_000);
  });
});

describe("Office parking demand (FAQ): offices want parking from 3★", () => {
  function occupiedFill(withParking: boolean): number {
    const sim = Simulation.newGame(123);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 4; f++) lay(sim, "floor", f);
    sim.buildTransport("elevatorStandard", W - 6, 1, 4);
    sim.tower.setCars(sim.tower.transports[0].id, 8);
    // Pre-occupy a block of offices on floor 2 to create real parking demand.
    for (let x = 0; x + 9 <= 180; x += 9) {
      const r = sim.tower.place("office", 2, x);
      if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    }
    // Empty offices on floors 3–4 are the ones that will (or won't) fill.
    for (let f = 3; f <= 4; f++) for (let x = 0; x + 9 <= 180; x += 9) sim.tower.place("office", f, x);
    sim.star = 3;
    if (withParking) {
      lay(sim, "floor", 0);
      for (let x = 0; x + 6 <= W; x += 6) sim.tower.place("parking", 0, x); // ample parking
    }
    for (let i = 0; i < 12; i++) sim.tick(60); // a Monday's working hours
    return sim.tower.units.filter((u) => u.kind === "office" && u.floor >= 3 && u.state === "occupied").length;
  }
  it("ample parking fills new offices faster than none (same seed)", () => {
    expect(occupiedFill(true)).toBeGreaterThan(occupiedFill(false));
  });
});
