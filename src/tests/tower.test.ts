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

  it("treats lobbies as transit-only — no rooms on a lobby concourse", () => {
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    // The ground lobby cannot host a shop/office, exactly like the original.
    expect(tower.canPlace("fastFood", 1, 0).ok).toBe(false);
    expect(tower.canPlace("office", 1, 0).ok).toBe(false);
    // The same column on a plain floor above accepts rooms.
    for (let i = 0; i < 20; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("office", 2, 0).ok).toBe(true);
    // A sky lobby is likewise transit-only.
    for (let i = 0; i < 20; i++) {
      const u = tower.roomAt(2, i);
      void u;
    }
    for (let i = 0; i < 20; i++) tower.place("floor", 3, i);
    for (let i = 0; i < 20; i++) {
      tower.removeUnit(tower.unitAt(3, i)!.id);
      tower.place("lobby", 3, i);
    }
    expect(tower.canPlace("office", 3, 0).ok).toBe(false);
  });

  it("restricts lobbies to the ground floor and every 15th floor", () => {
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    for (let f = 2; f <= 14; f++) for (let i = 0; i < 20; i++) tower.place("floor", f, i);
    // Floor 15 is a valid sky-lobby floor (and empty, supported by floor 14).
    expect(tower.canPlace("lobby", 15, 0).ok).toBe(true);
    // Arbitrary floors are not.
    expect(tower.canPlace("lobby", 5, 0).ok).toBe(false);
    expect(tower.canPlace("lobby", 16, 0).ok).toBe(false);
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

  it("requires every storey of a multi-floor facility", () => {
    for (let i = 0; i < 30; i++) tower.place("lobby", 1, i);
    // Cinema is two storeys: floors 2 AND 3 must exist as structure.
    for (let i = 0; i < 30; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("cinema", 2, 0).ok).toBe(false); // floor 3 missing
    for (let i = 0; i < 30; i++) tower.place("floor", 3, i);
    expect(tower.canPlace("cinema", 2, 0).ok).toBe(true);
    const r = tower.place("cinema", 2, 0);
    expect(r.ok).toBe(true);
    // It occupies both floors, blocking a room directly above it.
    expect(tower.roomAt(2, 1)?.id).toBe(r.unitId);
    expect(tower.roomAt(3, 1)?.id).toBe(r.unitId);
  });

  it("restricts basement facilities to underground floors", () => {
    for (let i = 0; i < 40; i++) tower.place("lobby", 1, i);
    // Basements use continuous numbering: floor 0 = B1, -1 = B2. Build them
    // from the ground down so each connects to the structure above.
    for (let f = 0; f >= -2; f--) for (let i = 0; i < 40; i++) tower.place("floor", f, i);
    // Parking on the ground floor is rejected…
    expect(tower.canPlace("parking", 1, 0).ok).toBe(false);
    // …but allowed in the basement (B1 = floor 0).
    expect(tower.canPlace("parking", 0, 0).ok).toBe(true);
    // The metro spans THREE whole basement floors (full lot width).
    for (let i = 40; i < GRID.width; i++) for (let f = 0; f >= -2; f--) tower.place("floor", f, i);
    expect(tower.canPlace("metro", -2, 0).ok).toBe(true); // spans -2/-1/0
    expect(tower.canPlace("metro", 0, 0).ok).toBe(false); // would cross above ground
    expect(tower.canPlace("metro", 1, 0).ok).toBe(false);
  });

  it("keeps the ground floor (level 1) as a lobby-only concourse", () => {
    // Even a plain (non-lobby) floor tile on level 1 rejects rooms — the whole
    // ground floor is the entrance concourse, never a room floor.
    for (let i = 0; i < 20; i++) tower.place("floor", 1, i);
    expect(tower.canPlace("office", 1, 0).ok).toBe(false);
    expect(tower.canPlace("shop", 1, 0).ok).toBe(false);
    // A two-storey facility starting on the ground floor is rejected too.
    for (let i = 0; i < 20; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("cinema", 1, 0).ok).toBe(false);
    // Rooms are fine one floor up.
    expect(tower.canPlace("office", 2, 0).ok).toBe(true);
  });

  it("allows only commercial/service facilities underground", () => {
    for (let i = 0; i < 40; i++) tower.place("lobby", 1, i);
    for (let f = 0; f >= -1; f--) for (let i = 0; i < 40; i++) tower.place("floor", f, i);
    // Offices, condos and hotels need daylight — blocked in the basement…
    expect(tower.canPlace("office", 0, 0).ok).toBe(false);
    expect(tower.canPlace("condo", 0, 0).ok).toBe(false);
    expect(tower.canPlace("hotelSingle", 0, 0).ok).toBe(false);
    // …but shops and fast food are welcome down there.
    expect(tower.canPlace("shop", 0, 0).ok).toBe(true);
    expect(tower.canPlace("fastFood", 0, 0).ok).toBe(true);
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
