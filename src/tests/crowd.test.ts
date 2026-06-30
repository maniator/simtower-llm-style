import { describe, it, expect } from "vitest";
import { Tower } from "../engine/Tower";
import { Clock } from "../engine/Clock";
import { Crowd } from "../engine/Crowd";

/**
 * The Crowd is SimTower's signature: real people who route through the tower.
 * These tests cover the BFS over the transport network (the routing brain) and
 * a basic spawn/advance loop (people appear, move, and report stress in range).
 */
describe("Crowd: routing and movement", () => {
  /** A tower with a ground lobby, floors up to `top`, and one elevator. */
  function towerWithElevator(top: number): Tower {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let f = 2; f <= top; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
    tower.placeTransport("elevatorStandard", 4, 1, top);
    return tower;
  }

  it("routes between two floors over a single shaft", () => {
    const tower = towerWithElevator(10);
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 8);
    expect(r).not.toBeNull();
    expect(r!.floors[0]).toBe(1);
    expect(r!.floors[r!.floors.length - 1]).toBe(8);
    expect(r!.shafts.length).toBe(1);
  });

  it("returns a trivial route to the same floor and null when unreachable", () => {
    const tower = towerWithElevator(10);
    const crowd = new Crowd();
    expect(crowd.route(tower, 5, 5)).toEqual({ floors: [5], shafts: [] });
    // Floor 50 has no structure or shaft serving it.
    expect(crowd.route(tower, 1, 50)).toBeNull();
  });

  it("finds a multi-shaft transfer route through a sky lobby", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let f = 2; f <= 30; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
    for (let x = 0; x < 40; x++) tower.place("lobby", 15, x); // sky lobby
    tower.placeTransport("elevatorStandard", 4, 1, 15); // lower bank
    tower.placeTransport("elevatorStandard", 10, 15, 30); // upper bank
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 30);
    expect(r).not.toBeNull();
    // Two rides, transferring at the floor-15 sky lobby.
    expect(r!.shafts.length).toBe(2);
    expect(r!.floors).toContain(15);
  });

  it("spawns and advances commuters, reporting stress in [0,1]", () => {
    const tower = towerWithElevator(8);
    // An occupied office up top gives morning commuters a destination.
    const r = tower.place("office", 5, 0);
    const u = tower.units.find((uu) => uu.id === r.unitId)!;
    u.state = "occupied";
    const crowd = new Crowd();
    const clock = new Clock(8 * 60); // Monday 08:00 — the morning rush
    for (let i = 0; i < 600; i++) crowd.update(0.05, tower, clock);
    expect(crowd.people.length).toBeGreaterThan(0);
    expect(crowd.stress).toBeGreaterThanOrEqual(0);
    expect(crowd.stress).toBeLessThanOrEqual(1);
    // Everyone is heading to or from a real floor on a real route.
    for (const p of crowd.people) {
      expect(p.floors.length).toBeGreaterThanOrEqual(2);
      expect(p.shafts.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("clears all people on reset", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const clock = new Clock(8 * 60);
    for (let i = 0; i < 200; i++) crowd.update(0.05, tower, clock);
    crowd.reset();
    expect(crowd.people.length).toBe(0);
    expect(crowd.stress).toBe(0);
  });
});
