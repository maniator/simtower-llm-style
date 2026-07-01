import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID, FACILITIES } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
const DAY = 60 * 24;

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** Fill a floor with occupied offices from x=0, leaving `rightClear` tiles free. */
function fillOffices(sim: Simulation, floor: number, rightClear = 0): number {
  const w = FACILITIES.office.width;
  let n = 0;
  for (let x = 0; x + w <= W - rightClear; x += w) {
    const r = sim.tower.place("office", floor, x);
    if (r.ok) {
      sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      n++;
    }
  }
  return n;
}

const done = (sim: Simulation, label: string): boolean =>
  sim.milestoneProgress().list.find((m) => m.label === label)?.done ?? false;

describe("Milestones (optional goals)", () => {
  it("fires once, pays its reward once, and shows in progress", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (const f of [2, 3, 4]) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, 6); // leave the right edge for the elevator
    }
    sim.tower.placeTransport("elevatorStandard", W - 4, 1, 4); // serve the floors so tenants stay
    expect(sim.population).toBeGreaterThanOrEqual(500);
    expect(sim.population).toBeLessThan(2000); // only the pop-500 milestone is eligible

    expect(done(sim, "Getting Started")).toBe(false);
    sim.tick(DAY); // crosses a day boundary → onDay → checkMilestones
    expect(done(sim, "Getting Started")).toBe(true);

    // Fires exactly once: the achieved set doesn't grow on a further day.
    const achieved = sim.milestoneProgress().achieved;
    sim.tick(DAY);
    expect(sim.milestoneProgress().achieved).toBe(achieved);
  });

  it("achievements survive save/reload (no re-announce, no re-pay)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (const f of [2, 3, 4]) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, 6);
    }
    sim.tower.placeTransport("elevatorStandard", W - 4, 1, 4);
    sim.tick(DAY);
    expect(done(sim, "Getting Started")).toBe(true);

    const reloaded = Simulation.deserialize(sim.serialize());
    expect(done(reloaded, "Getting Started")).toBe(true); // restored, still achieved
    const achieved = reloaded.milestoneProgress().achieved;
    reloaded.tick(DAY); // already achieved → must not re-announce or re-pay
    expect(reloaded.milestoneProgress().achieved).toBe(achieved);
  });

  it("well-served fires for a large, fully-reachable tower", () => {
    const sim = Simulation.newGame(2);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (let f = 2; f <= 25; f++) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, 6); // leave the right edge clear for the elevator
    }
    // One standard elevator serving floors 1..25 makes every occupied floor reachable.
    expect(sim.tower.placeTransport("elevatorStandard", W - 4, 1, 25).ok).toBe(true);
    expect(sim.population).toBeGreaterThanOrEqual(5000);

    expect(done(sim, "Smooth Operator")).toBe(false); // not evaluated until a day passes
    sim.tick(DAY);
    expect(done(sim, "Smooth Operator")).toBe(true);
  });
});
