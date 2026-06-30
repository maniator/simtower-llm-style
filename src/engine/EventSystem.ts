import type { SimContext } from "./SimContext";
import type { Unit } from "./types";
import { FACILITIES } from "./facilities";
import { RNG } from "./rng";

/**
 * SimTower's signature emergencies — fires (which spread unless contained) and
 * bomb threats — extracted from {@link Simulation} so the disaster logic owns
 * its own state (the set of burning units) and can be tested in isolation
 * against a small {@link SimContext}.
 */
export class EventSystem {
  /** Ids of units currently ablaze (a fire emergency in progress). */
  private active = new Set<number>();
  /** Dedicated RNG for the seasonal/visitor events, so adding them never
   * disturbs the gameplay RNG stream the rest of the sim depends on. */
  private extra: RNG;
  /** Year index of the last Santa visit, so he comes at most once a year. */
  private lastSantaYear = -1;

  /** Coverage radius (floors) for services in the v2 spatial model (review F15):
   * a Security/Medical office only speeds the emergency response within this many
   * floors, so one in a basement corner can't protect a floor-100 fire and a
   * tall tower needs several — which is why the original caps each at 10. */
  private static readonly SECURITY_RADIUS = 8;
  private static readonly MEDICAL_RADIUS = 12;

  constructor(private readonly sim: SimContext, seed = 1) {
    this.extra = new RNG((seed ^ 0x5a17a) >>> 0);
  }

  /** Persist the seasonal-event state (RNG position + Santa guard) for saves. */
  saveState(): { lastSantaYear: number; rngState: number } {
    return { lastSantaYear: this.lastSantaYear, rngState: this.extra.seed };
  }

  /** Restore seasonal-event state from a save (no-op for older saves). Coerces
   * the fields, since saves are untrusted and may be hand-edited or stale. */
  loadState(state?: { lastSantaYear: number; rngState: number }): void {
    if (!state) return;
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    this.lastSantaYear = num(state.lastSantaYear, -1);
    this.extra = new RNG(num(state.rngState, 1) >>> 0 || 1);
  }

  /** Number of units currently on fire (for the UI / stats). */
  get count(): number {
    return this.active.size;
  }

  /** Re-arm ongoing fires after loading a save (idempotent — replaces, not adds). */
  restore(unitIds: Iterable<number>): void {
    this.active.clear();
    for (const id of unitIds) this.active.add(id);
  }

  /** Roll the daily event: resolve any ongoing fire, then maybe start a new one. */
  maybeRandomEvent(): void {
    // An ongoing fire is fought (or spreads) every day until it's out.
    this.processFires();
    // Seasonal / visitor events roll on their own RNG, independent of the
    // emergency rolls below, so they never shift the gameplay sequence.
    this.maybeSanta();
    this.maybeThief();
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

  /** True if an operational unit of `kind` is within `radius` floors of `floor`. */
  private serviceWithin(kind: Unit["kind"], floor: number, radius: number): boolean {
    return this.sim.tower.units.some(
      (u) =>
        u.kind === kind &&
        u.state !== "construction" &&
        u.state !== "fire" &&
        Math.abs(u.floor - floor) <= radius,
    );
  }

  /**
   * Probability a fire on `floor` is contained this day. In v2 the Security /
   * Medical bonuses apply only if a station is within its coverage radius of the
   * fire (spatial, review F15); in v1 they apply tower-wide if one exists at all.
   */
  controlChance(floor: number): number {
    const v2 = this.sim.simModel === "v2";
    const sec = v2
      ? this.serviceWithin("security", floor, EventSystem.SECURITY_RADIUS)
      : this.sim.hasAny("security");
    const med = v2
      ? this.serviceWithin("medical", floor, EventSystem.MEDICAL_RADIUS)
      : this.sim.hasAny("medical");
    return 0.35 + (sec ? 0.2 : 0) + (med ? 0.3 : 0);
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
    for (const id of [...this.active]) {
      const u = this.sim.tower.units.find((x) => x.id === id);
      if (!u || u.state !== "fire") {
        this.active.delete(id);
        continue;
      }
      // Response speed depends on whether a station covers THIS fire's floor (v2).
      const control = this.controlChance(u.floor);
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

  /**
   * Santa visits a respectable tower (3★+) once a year over the holidays,
   * leaving a cash gift — the original's seasonal cameo.
   */
  private maybeSanta(): void {
    const year = Math.floor(this.sim.clock.day / 360);
    const dayOfYear = ((this.sim.clock.day % 360) + 360) % 360;
    // The last stretch of the year is "the holidays".
    if (dayOfYear < 340 || this.sim.star < 3 || year === this.lastSantaYear) return;
    if (!this.extra.chance(0.4)) return; // not every holiday day
    this.lastSantaYear = year;
    const gift = 50_000 + this.extra.int(0, 100_000);
    this.sim.money += gift;
    this.sim.emit(`🎅 Santa visited your tower for the holidays and left a $${gift.toLocaleString()} gift!`, "money");
  }

  /**
   * A thief occasionally slips into the tower. Security catches them; without
   * a guard on duty they make off with some cash — another reason to staff up.
   */
  private maybeThief(): void {
    if (this.sim.star < 2) return;
    if (!this.extra.chance(0.05)) return;
    if (this.sim.hasAny("security")) {
      this.sim.emit("🕵️ Security caught a thief prowling the tower — nothing was taken.", "good");
      return;
    }
    const loss = 5_000 + this.extra.int(0, 20_000);
    this.sim.money -= loss;
    this.sim.emit(`🕵️ A thief slipped through the tower and made off with $${loss.toLocaleString()} — build Security.`, "bad");
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
