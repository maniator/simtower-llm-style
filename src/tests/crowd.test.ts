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

  it("re-routes after the transport network changes (adjacency cache invalidates)", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let f = 2; f <= 8; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
    const crowd = new Crowd();
    expect(crowd.route(tower, 1, 6)).toBeNull(); // no elevator yet — caches an empty graph
    tower.placeTransport("elevatorStandard", 4, 1, 8); // bumps tower.revision
    expect(crowd.route(tower, 1, 6)).not.toBeNull(); // cache must have refreshed
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

  it("never routes over carless stairs or escalators", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) tower.place("floor", 2, x);
    tower.placeTransport("stairs", 4, 1, 2); // a stair has no cars to board
    const crowd = new Crowd();
    // Floor 2 is reachable on foot via the stairs, but our riders only board
    // real elevator cars — so there is no boardable route for them.
    expect(crowd.route(tower, 1, 2)).toBeNull();
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
    // Everyone is heading to or from a real floor on a real route, and their
    // destination sits on built structure (tiles 0..39 here), not in midair.
    for (const p of crowd.people) {
      expect(p.floors.length).toBeGreaterThanOrEqual(2);
      expect(p.shafts.length).toBeGreaterThanOrEqual(1);
      expect(p.destX).toBeGreaterThanOrEqual(0);
      expect(p.destX).toBeLessThanOrEqual(39);
    }
  });

  it("does not send commuters to unstaffed weekend offices", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const saturday = new Clock(5 * 1440 + 8 * 60); // Sat 08:00
    expect(saturday.isWeekend).toBe(true);
    for (let i = 0; i < 400; i++) crowd.update(0.05, tower, saturday);
    // With only an office (no homes/venues), weekends produce no trips.
    expect(crowd.people.length).toBe(0);
  });

  it("never strands a rider when their car is removed", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const clock = new Clock(8 * 60);
    // Advance until at least one commuter is aboard a car.
    let rider;
    for (let i = 0; i < 4000 && !rider; i++) {
      crowd.update(0.05, tower, clock);
      rider = crowd.people.find((p) => p.state === "riding" && p.carIndex != null);
    }
    expect(rider).toBeTruthy();
    const elevator = tower.transports[0];
    // Force the rider onto a high car index, then trim the elevator to one car
    // (Tower.setCars shrinks carPositions out from under them).
    rider!.shaftId = elevator.id;
    rider!.carIndex = elevator.carPositions.length; // now out of range after the trim
    rider!.state = "riding";
    tower.setCars(elevator.id, 1);
    crowd.update(0.05, tower, clock);
    // The guard must have stepped them off rather than riding a phantom car.
    expect(rider!.state).toBe("done");
    // And no surviving rider references a car index that no longer exists.
    for (const p of crowd.people) {
      if (p.state === "riding") expect(p.carIndex!).toBeLessThan(elevator.carPositions.length);
    }
  });

  it("fully resets — no carried spawn backlog after switching sims", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const clock = new Clock(8 * 60);
    for (let i = 0; i < 200; i++) crowd.update(0.05, tower, clock);
    crowd.reset();
    expect(crowd.people.length).toBe(0);
    expect(crowd.stress).toBe(0);
    // A single tiny step must not immediately spawn a backlog from a leftover
    // accumulator (the bug: spawnAcc surviving reset).
    crowd.update(0.001, tower, clock);
    expect(crowd.people.length).toBe(0);
  });
});
