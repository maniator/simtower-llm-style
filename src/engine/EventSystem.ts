import type { SimContext } from "./SimContext";
import type { Unit } from "./types";
import { FACILITIES } from "./facilities";

/**
 * SimTower's signature emergencies — fires (which spread unless contained) and
 * bomb threats — extracted from {@link Simulation} so the disaster logic owns
 * its own state (the set of burning units) and can be tested in isolation
 * against a small {@link SimContext}.
 */
export class EventSystem {
  /** Ids of units currently ablaze (a fire emergency in progress). */
  private active = new Set<number>();

  constructor(private readonly sim: SimContext) {}

  /** Number of units currently on fire (for the UI / stats). */
  get count(): number {
    return this.active.size;
  }

  /** Re-arm ongoing fires after loading a save. */
  restore(unitIds: Iterable<number>): void {
    for (const id of unitIds) this.active.add(id);
  }

  /** Roll the daily event: resolve any ongoing fire, then maybe start a new one. */
  maybeRandomEvent(): void {
    // An ongoing fire is fought (or spreads) every day until it's out.
    this.processFires();
    if (this.sim.star < 2) return;

    const roll = this.sim.rng.next();
    // A medical center's fast emergency response makes fires far less likely.
    const fireChance = this.sim.hasAny("medical") ? 0.04 : 0.09;
    if (this.active.size === 0 && roll < fireChance) {
      this.startFire();
      return;
    }
    // Bomb threats target prestigious towers (4★ and up).
    if (this.sim.star >= 4 && roll < fireChance + 0.05) {
      this.bombThreat();
      return;
    }
    // Otherwise the occasional flavorful headline.
    if (this.sim.rng.chance(0.15)) {
      if (this.sim.rng.chance(0.5)) this.sim.emit("A local newspaper praised your tower's design.", "good");
      else this.sim.emit("Tenants are happy with the tower today.", "info");
    }
  }

  /** Rooms that can catch fire (real, finished rooms — not structure). */
  private flammableUnits(): Unit[] {
    return this.sim.tower.units.filter(
      (u) =>
        u.kind !== "floor" &&
        u.kind !== "lobby" &&
        u.state !== "construction" &&
        u.state !== "fire",
    );
  }

  /** Ignite a random room. */
  startFire(): void {
    const candidates = this.flammableUnits();
    if (candidates.length === 0) return;
    const u = this.sim.rng.pick(candidates);
    u.state = "fire";
    u.occupants = 0;
    this.active.add(u.id);
    this.sim.emit(`🔥 Fire broke out in ${FACILITIES[u.kind].name} on ${this.sim.floorLabel(u.floor)}!`, "bad");
  }

  /** The room immediately left or right of a unit on the same floor. */
  private adjacentRoom(u: Unit): Unit | undefined {
    return this.sim.tower.roomAt(u.floor, u.x - 1) ?? this.sim.tower.roomAt(u.floor, u.x + u.width);
  }

  /**
   * Resolve active fires. Security and especially a medical center speed the
   * emergency response; without them a blaze is more likely to spread to the
   * neighboring room before it's contained — the core reason to staff your
   * tower in the original game.
   */
  private processFires(): void {
    if (this.active.size === 0) return;
    const control = 0.35 + (this.sim.hasAny("security") ? 0.2 : 0) + (this.sim.hasAny("medical") ? 0.3 : 0);
    for (const id of [...this.active]) {
      const u = this.sim.tower.units.find((x) => x.id === id);
      if (!u || u.state !== "fire") {
        this.active.delete(id);
        continue;
      }
      if (this.sim.rng.chance(control)) {
        // Contained: pay to repair the gutted unit, then it reopens vacant.
        const repair = Math.floor(FACILITIES[u.kind].cost * 0.3);
        this.sim.money -= repair;
        u.state = "empty";
        u.satisfaction = 1;
        u.everOccupied = false;
        u.label = FACILITIES[u.kind].name;
        this.active.delete(id);
        this.sim.emit(`Firefighters contained the blaze on ${this.sim.floorLabel(u.floor)}. Repairs cost $${repair.toLocaleString()}.`, "money");
      } else {
        const next = this.adjacentRoom(u);
        if (next && next.state !== "fire" && next.kind !== "floor" && next.kind !== "lobby" && next.state !== "construction") {
          next.state = "fire";
          next.occupants = 0;
          this.active.add(next.id);
          this.sim.emit(`The fire spread to ${FACILITIES[next.kind].name} on ${this.sim.floorLabel(next.floor)}!`, "bad");
        }
      }
    }
    // An active emergency rattles everyone still in the building.
    if (this.active.size > 0) {
      for (const u of this.sim.tower.units) {
        if (u.state === "occupied" || u.state === "asleep") {
          u.satisfaction = Math.max(0, u.satisfaction - 0.05);
        }
      }
    }
  }

  /** A bomb scare. Security defuses it; without guards it does real damage. */
  bombThreat(): void {
    if (this.sim.hasAny("security")) {
      const cost = 2_000 + this.sim.rng.int(0, 3_000);
      this.sim.money -= cost;
      this.sim.emit(`💣 A bomb threat was called in — security swept the tower and found nothing. The evacuation cost $${cost.toLocaleString()}.`, "info");
      return;
    }
    const fine = 15_000 + this.sim.rng.int(0, 15_000);
    this.sim.money -= fine;
    const targets = this.flammableUnits();
    if (targets.length > 0) {
      const u = this.sim.rng.pick(targets);
      u.state = "empty";
      u.occupants = 0;
      u.everOccupied = false;
      u.label = FACILITIES[u.kind].name;
    }
    this.sim.emit(`💣 A bomb threat caused chaos! With no security office the panic and damage cost $${fine.toLocaleString()} — build Security.`, "bad");
  }
}
