import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);

/**
 * Phase 2 (BMAD review F4 + spatial model) tests. Behavior changes land behind
 * `simModel: "v1" | "v2"`; v1 is the shipped, suite-pinned model and v2 is built
 * up step by step. Step 1 here: the real hourly clock.
 */

describe("F4 / Step 1 — v2 integrates per hour; v1 keeps the sampled behavior", () => {
  it("v1 fires onHour at most once for a multi-hour tick (the documented sampling)", () => {
    const sim = Simulation.newGame(1); // starts Mon 07:00, simModel defaults to v1
    sim.tick(60 * 5); // 07:00 -> 12:00
    expect(sim.hourTicks).toBe(1); // sampled: one onHour despite 5 hours elapsing
    expect(sim.clock.day).toBe(0);
  });

  it("v2 fires onHour once per elapsed hour and onDay per elapsed day", () => {
    const sim = Simulation.newGame(1);
    sim.simModel = "v2";
    sim.tick(60); // warm-up so lastHour settles on the current hour boundary
    const base = sim.hourTicks;
    const day0 = sim.clock.day;

    sim.tick(60 * 5); // 5 more hours
    expect(sim.hourTicks - base).toBe(5);

    sim.tick(60 * 24); // a full further day
    expect(sim.hourTicks - base).toBe(5 + 24);
    expect(sim.clock.day).toBe(day0 + 1);
  });

  it("v2 advances the same total game time as v1 (sub-stepping is exact)", () => {
    const a = Simulation.newGame(2);
    const b = Simulation.newGame(2);
    b.simModel = "v2";
    a.tick(247); // arbitrary, not hour-aligned
    b.tick(247);
    expect(b.clock.minutes).toBe(a.clock.minutes);
  });
});

describe("F3 / Step 2 — spatial congestion (v2): layout and parallel shafts matter", () => {
  function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
    for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
    for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
  }
  /** A v2 tower with a full-width ground lobby and floors 2..top, no transport. */
  function clusterTower(seed: number, top: number): Simulation {
    const sim = Simulation.newGame(seed);
    sim.simModel = "v2";
    sim.money = 1_000_000_000;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= top; f++) lay(sim, "floor", f);
    return sim;
  }
  function fillFloor(sim: Simulation, floor: number, count: number): void {
    let placed = 0;
    for (let x = 0; x + 9 <= W && placed < count; x += 9) {
      const r = sim.tower.place("office", floor, x);
      if (r.ok) {
        sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
        placed++;
      }
    }
  }

  it("adding a parallel shaft relieves a congested band", () => {
    const sim = clusterTower(1, 10);
    for (let f = 2; f <= 10; f++) fillFloor(sim, f, 18); // a packed 9-floor band on one shaft
    sim.buildTransport("elevatorStandard", W - 6, 1, 10);
    sim.tower.setCars(sim.tower.transports[0].id, 1); // deliberately weak
    const before = sim.congestionAt(8);
    expect(before).toBeGreaterThan(1); // the band overwhelms one weak shaft

    sim.buildTransport("elevatorStandard", W - 12, 1, 10); // a second parallel shaft
    sim.tower.setCars(sim.tower.transports[1].id, 1);
    const after = sim.congestionAt(8);
    expect(after).toBeLessThan(before * 0.6); // load splits across shafts → ~halved
  });

  it("a distant cluster on its own shaft does not raise another cluster's congestion", () => {
    const sim = clusterTower(2, 30);
    // Shaft A serves the low band (1..10), shaft B serves the high band (10..30),
    // transferring at floor 10. They overlap only at floor 10 (no offices there).
    sim.buildTransport("elevatorStandard", W - 6, 1, 10);
    sim.tower.setCars(sim.tower.transports[0].id, 1);
    sim.buildTransport("elevatorStandard", W - 12, 10, 30);
    sim.tower.setCars(sim.tower.transports[1].id, 1);

    for (let f = 2; f <= 9; f++) fillFloor(sim, f, 18); // cluster A (served by A only)
    const aAlone = sim.congestionAt(8);

    for (let f = 11; f <= 30; f++) fillFloor(sim, f, 18); // cluster B (served by B only)
    const aAfter = sim.congestionAt(8);

    // The old single global scalar would have jumped when cluster B filled in;
    // the spatial model leaves floor 8 (served only by shaft A) unchanged.
    expect(aAfter).toBeCloseTo(aAlone, 5);
    expect(sim.congestionAt(25)).toBeGreaterThan(0); // cluster B is genuinely loaded
  });
});

describe("F15 / Step 3 — service coverage radius (v2): placement matters", () => {
  function tallTower(seed: number): Simulation {
    const sim = Simulation.newGame(seed);
    sim.simModel = "v2";
    sim.money = 1_000_000_000;
    for (let x = C; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let x = C - 1; x >= 0; x--) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 100; f++)
      for (let x = C; x < W; x++) sim.tower.place("floor", f, x);
    return sim;
  }

  it("a fire is contained faster near a station than far from it (v2)", () => {
    const sim = tallTower(1);
    sim.tower.place("security", 2, C); // ground-level security only
    sim.tower.place("medical", 2, C + 8);
    const near = sim.fireContainmentChance(3); // within radius
    const far = sim.fireContainmentChance(100); // a floor-100 fire, far away
    expect(near).toBeGreaterThan(far);
    expect(near).toBeCloseTo(0.85, 5); // security + medical both cover floor 3
    expect(far).toBeCloseTo(0.35, 5); // neither covers floor 100
  });

  it("v1 keeps tower-wide coverage (one station protects everywhere)", () => {
    const sim = tallTower(2);
    sim.simModel = "v1";
    sim.tower.place("security", 2, C);
    sim.tower.place("medical", 2, C + 8);
    expect(sim.fireContainmentChance(3)).toBeCloseTo(sim.fireContainmentChance(100), 5);
  });

  it("distributing stations up a tall tower restores full coverage (why the 10-cap bites)", () => {
    const sim = tallTower(3);
    for (let f = 5; f <= 95; f += 15) sim.tower.place("security", f, C); // ~7 stations
    // Every occupied band now has a station within the security radius.
    expect(sim.fireContainmentChance(10)).toBeGreaterThan(0.5);
    expect(sim.fireContainmentChance(90)).toBeGreaterThan(0.5);
  });
});
