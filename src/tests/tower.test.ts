import { describe, it, expect, beforeEach } from "vitest";
import { Tower } from "../engine/Tower";
import { GRID } from "../engine/facilities";

describe("Tower placement", () => {
  let tower: Tower;
  beforeEach(() => {
    tower = new Tower();
  });

  it("requires the first build to be on the ground floor", () => {
    expect(tower.canPlace("lobby", 5, 10).ok).toBe(false);
    expect(tower.canPlace("lobby", 1, 10).ok).toBe(true);
  });

  it("places a lobby and indexes occupancy", () => {
    const res = tower.place("lobby", 1, 10);
    expect(res.ok).toBe(true);
    expect(tower.unitAt(1, 10)?.kind).toBe("lobby");
    expect(tower.unitAt(1, 11)).toBeUndefined();
  });

  it("rejects overlapping placement", () => {
    tower.place("lobby", 1, 10);
    expect(tower.canPlace("lobby", 1, 10).ok).toBe(false);
  });

  it("rejects rooms without a floor underneath the whole span", () => {
    // Build a ground strip, then a single floor tile on level 2.
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    tower.place("floor", 2, 0);
    // Office needs 9 contiguous floor tiles.
    expect(tower.canPlace("office", 2, 0).ok).toBe(false);
    for (let i = 1; i < 12; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("office", 2, 0).ok).toBe(true);
  });

  it("keeps floors connected to existing structure", () => {
    for (let i = 0; i < 5; i++) tower.place("lobby", 1, i);
    // Floating floor far away is unsupported.
    expect(tower.canPlace("floor", 1, 100).ok).toBe(false);
    // Adjacent extension is fine.
    expect(tower.canPlace("floor", 1, 5).ok).toBe(true);
    // Stacking above is fine.
    expect(tower.canPlace("floor", 2, 0).ok).toBe(true);
  });

  it("enforces the buildable bounds", () => {
    tower.place("lobby", 1, 0);
    expect(tower.canPlace("floor", GRID.maxFloor + 1, 0).ok).toBe(false);
    expect(tower.canPlace("floor", GRID.minFloor - 1, 0).ok).toBe(false);
    expect(tower.canPlace("office", 1, GRID.width - 2).ok).toBe(false);
  });
});

describe("Tower transport", () => {
  let tower: Tower;
  beforeEach(() => {
    tower = new Tower();
    for (let i = 0; i < 40; i++) tower.place("lobby", 1, i);
    // Transports may only run through built floors, so raise structure first.
    for (let f = 2; f <= 30; f++) for (let i = 0; i < 40; i++) tower.place("floor", f, i);
  });

  it("rejects a shaft that runs outside the built structure", () => {
    // Floor 50 has no structure → an elevator reaching it is invalid.
    expect(tower.placeTransport("elevatorStandard", 4, 1, 50).ok).toBe(false);
    // A floating stair on bare floors above the build is rejected too.
    const t2 = new Tower();
    for (let i = 0; i < 10; i++) t2.place("lobby", 1, i);
    expect(t2.placeTransport("elevatorStandard", 4, 1, 10).ok).toBe(false);
  });

  it("places an elevator and allocates cars", () => {
    const res = tower.placeTransport("elevatorStandard", 4, 1, 20);
    expect(res.ok).toBe(true);
    const t = tower.transports[0];
    expect(t.cars).toBeGreaterThan(0);
    expect(t.carPositions.length).toBe(t.cars);
  });

  it("limits stairs to a single floor span", () => {
    expect(tower.placeTransport("stairs", 8, 1, 5).ok).toBe(false);
    expect(tower.placeTransport("stairs", 8, 1, 2).ok).toBe(true);
  });

  it("prevents overlapping shafts", () => {
    tower.placeTransport("elevatorStandard", 4, 1, 10);
    expect(tower.placeTransport("elevatorStandard", 4, 1, 10).ok).toBe(false);
    expect(tower.placeTransport("elevatorStandard", 12, 1, 10).ok).toBe(true);
  });

  it("computes floor reachability through linked transports", () => {
    // Elevator from ground to 15, then another from 15 to 30.
    tower.placeTransport("elevatorStandard", 4, 1, 15);
    expect(tower.isFloorServed(10)).toBe(true);
    expect(tower.isFloorServed(25)).toBe(false);
    tower.placeTransport("elevatorStandard", 12, 15, 30);
    expect(tower.isFloorServed(25)).toBe(true);
    // A disconnected floor stays unserved.
    expect(tower.isFloorServed(50)).toBe(false);
  });
});
