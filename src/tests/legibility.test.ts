import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
const DAY = 60 * 24;

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

describe("Legibility — functionalParkingSet (Tower)", () => {
  it("exposes the chained set; count delegates; dead space excluded; memoised", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 0);
    sim.tower.place("parkingRamp", 0, C);
    const a = sim.tower.place("parking", 0, C + 6); // chained to the ramp
    const b = sim.tower.place("parking", 0, C + 100); // isolated → dead
    const set = sim.tower.functionalParkingSet();
    expect(set.has(a.unitId!)).toBe(true);
    expect(set.has(b.unitId!)).toBe(false);
    expect(sim.tower.functionalParkingSpots()).toBe(set.size); // delegation invariant
    sim.tower.place("parking", 0, C + 12); // chain-extends off a
    expect(sim.tower.functionalParkingSet().size).toBe(2); // C+6 and C+12 now both chained
  });

  it("stacked parking with no ramp between floors is not connected", () => {
    const sim = Simulation.newGame(2);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 0);
    layFull(sim, "floor", -1);
    sim.tower.place("parkingRamp", -1, C);
    sim.tower.place("parking", -1, C + 6); // chained on B2
    const up = sim.tower.place("parking", 0, C + 6); // directly above, but no ramp on B1
    expect(sim.tower.functionalParkingSet().has(up.unitId!)).toBe(false);
  });
});

describe("Legibility — reachability & stranded floors (Simulation)", () => {
  function threeRideTower(seed: number): Simulation {
    const sim = Simulation.newGame(seed);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    for (let f = 2; f <= 45; f++) layFull(sim, "floor", f);
    sim.tower.placeTransport("elevatorStandard", C, 1, 15); // A
    sim.tower.placeTransport("elevatorStandard", C + 6, 15, 30); // B (transfer at 15)
    sim.tower.placeTransport("elevatorStandard", C + 12, 30, 45); // C (transfer at 30)
    const r = sim.tower.place("office", 40, C + 30); // a tenant 3 rides up
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    return sim;
  }

  it("floorReachable distinguishes served-but-too-far from truly reachable", () => {
    const sim = threeRideTower(3);
    expect(sim.floorReachable(1)).toBe(true);
    expect(sim.tower.isFloorServed(40)).toBe(true); // connected via the shaft chain
    expect(sim.floorReachable(40)).toBe(false); // ...but 3 rides → no commuter
    expect(sim.strandedFloors()).toContain(40);

    // A shaft that reaches 40 in one transfer (1→15→40) makes it reachable.
    expect(sim.tower.placeTransport("elevatorStandard", C - 10, 15, 45).ok).toBe(true);
    expect(sim.floorReachable(40)).toBe(true);
    expect(sim.strandedFloors()).not.toContain(40);
  });

  it("strandedFloors excludes tenant-less, below-ground, and reachable floors", () => {
    const sim = Simulation.newGame(4);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    sim.tower.placeTransport("elevatorStandard", C, 1, 2);
    const r = sim.tower.place("office", 2, 0);
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    expect(sim.strandedFloors()).toEqual([]); // floor 2 is reachable; nothing stranded
  });

  it("emits the stranded nudge once per 0→>0 crossing, not repeatedly", () => {
    const sim = threeRideTower(5);
    const count = () => sim.log.filter((e) => e.text.includes("3+ elevator rides")).length;
    sim.tick(DAY);
    expect(count()).toBe(1); // fired on the crossing
    sim.tick(DAY);
    expect(count()).toBe(1); // still stranded → no duplicate
  });
});

describe("Legibility — rating & stats (Simulation)", () => {
  it("hotelsCountTowardRating flips at 3★ and rating population diverges", () => {
    const sim = Simulation.newGame(6);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    for (let i = 0, x = 0; i < 40 && x + 4 <= W; i++, x += 4) {
      const r = sim.tower.place("hotelSingle", 2, x);
      if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "asleep";
    }
    sim.star = 1;
    expect(sim.hotelsCountTowardRating()).toBe(true);
    expect(sim.ratingPopulation()).toBe(sim.population); // hotels included below 3★
    sim.star = 3;
    expect(sim.hotelsCountTowardRating()).toBe(false);
    expect(sim.ratingPopulation()).toBeLessThan(sim.population); // hotels excluded at 3★+
  });

  it("stats() exposes cheap legibility fields; parking row omitted for a garage-less tower", () => {
    const sim = Simulation.newGame(7);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 0);
    expect(sim.stats().parkingSpaces).toBe(0); // no parking yet → stats row is omitted by the UI
    sim.tower.place("parkingRamp", 0, C);
    sim.tower.place("parking", 0, C + 6);
    sim.tower.place("parking", 0, C + 100); // dead
    const s = sim.stats();
    expect(s.parkingSpaces).toBe(2);
    expect(s.parkingWorking).toBe(1); // only the chained one works
    expect(s.ratingPopulation).toBe(sim.ratingPopulation());
  });
});
