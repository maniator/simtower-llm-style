import { Clock } from "./Clock";
import { Tower } from "./Tower";
import { RNG } from "./rng";
import {
  FACILITIES,
  GRID,
  STAR_THRESHOLDS,
  isElevatorKind,
  isHotelKind,
} from "./facilities";
import type { FacilityKind, SerializedGame, Unit } from "./types";

/** Tunable economic constants (dollars). */
export const ECON = {
  startingMoney: 2_000_000,
  officeRentQuarterly: 10_000,
  condoSalePrice: 120_000,
  hotel: { hotelSingle: 90, hotelDouble: 180, hotelSuite: 500 } as Record<string, number>,
  dailyTrafficIncome: {
    fastFood: 2_000,
    restaurant: 4_000,
    shop: 2_500,
    cinema: 8_000,
    partyHall: 3_000,
  } as Record<string, number>,
  maintenancePerCarMonthly: 600,
  serviceMaintenanceMonthly: {
    security: 2_000,
    medical: 5_000,
    housekeeping: 1_000,
    recycling: 4_000,
    metro: 8_000,
  } as Record<string, number>,
} as const;

export interface LogEntry {
  minute: number;
  text: string;
  kind: "info" | "good" | "bad" | "money";
}

/**
 * Simulation drives time, money, population and ratings. The renderer and UI
 * read its state; they never mutate the model directly except via build/sell.
 */
export class Simulation {
  tower = new Tower();
  clock = new Clock();
  rng: RNG;
  money: number = ECON.startingMoney;
  /** 1..5 stars, 6 == TOWER. */
  star = 1;
  evaluatedTower = false;
  log: LogEntry[] = [];

  /** Bookkeeping for period boundaries. */
  private lastDay = 0;
  private lastQuarter = -1;
  private lastMonth = -1;
  private lastHour = -1;
  /** Pending VIP inspection day (for the TOWER rating). */
  private vipVisitDay = -1;

  constructor(seed = 12345) {
    this.rng = new RNG(seed);
  }

  // ---- Logging -----------------------------------------------------------

  emit(text: string, kind: LogEntry["kind"] = "info"): void {
    this.log.push({ minute: this.clock.minutes, text, kind });
    if (this.log.length > 200) this.log.shift();
  }

  // ---- Build / sell ------------------------------------------------------

  /** Whether a facility kind is currently unlocked by star rating. */
  isUnlocked(kind: FacilityKind): boolean {
    return this.star >= FACILITIES[kind].minStar;
  }

  build(kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string } {
    const f = FACILITIES[kind];
    if (!this.isUnlocked(kind)) {
      return { ok: false, reason: `${f.name} unlocks at ${f.minStar}★.` };
    }
    if (this.money < f.cost) {
      return { ok: false, reason: "Not enough money." };
    }
    const res = this.tower.place(kind, floor, x);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.money -= f.cost;
    if (kind === "cathedral") {
      this.emit("Cathedral built! A VIP will inspect your tower soon.", "good");
      this.vipVisitDay = this.clock.day + 3;
    }
    return { ok: true };
  }

  buildTransport(
    kind: FacilityKind,
    x: number,
    bottom: number,
    top: number,
  ): { ok: boolean; reason?: string } {
    const f = FACILITIES[kind];
    if (!this.isUnlocked(kind)) {
      return { ok: false, reason: `${f.name} unlocks at ${f.minStar}★.` };
    }
    // Elevators charge per served floor on top of the base price.
    const span = top - bottom;
    const extra = isElevatorKind(kind) ? span * 5_000 : 0;
    const total = f.cost + extra;
    if (this.money < total) return { ok: false, reason: "Not enough money." };
    const res = this.tower.placeTransport(kind, x, bottom, top);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.money -= total;
    return { ok: true };
  }

  /** Bulldoze a unit/transport for a partial refund. */
  sellAt(floor: number, x: number): boolean {
    const t = this.tower.transportAt(floor, x);
    const u = this.tower.unitAt(floor, x);
    // Prefer removing a room over the transport/floor beneath it.
    if (u && u.kind !== "floor" && u.kind !== "lobby") {
      this.tower.removeUnit(u.id);
      this.money += Math.floor(FACILITIES[u.kind].cost * 0.5);
      return true;
    }
    if (t) {
      this.tower.removeTransport(t.id);
      this.money += Math.floor(FACILITIES[t.kind].cost * 0.5);
      return true;
    }
    if (u) {
      this.tower.removeUnit(u.id);
      this.money += Math.floor(FACILITIES[u.kind].cost * 0.5);
      return true;
    }
    return false;
  }

  // ---- Main tick ---------------------------------------------------------

  /** Advance the world by `dtMinutes` of game time. */
  tick(dtMinutes: number): void {
    this.clock.advance(dtMinutes);
    this.updateTransportAnimation(dtMinutes);

    const hour = this.clock.hour;
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      this.onHour();
    }

    const day = this.clock.day;
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.onDay();
    }
  }

  /** Hourly: presence, move-ins, satisfaction, traffic income. */
  private onHour(): void {
    this.updatePresence();
    this.updateSatisfaction();
    this.attemptMoveIns();
    this.collectTrafficIncome();
    this.evaluateStar();
  }

  /** Daily: hotel checkout, housekeeping, rent, maintenance, events. */
  private onDay(): void {
    this.hotelCheckout();

    const month = Math.floor(this.clock.day / 30);
    if (month !== this.lastMonth) {
      this.lastMonth = month;
      this.payMaintenance();
    }

    const q = this.clock.quarter;
    if (q !== this.lastQuarter) {
      this.lastQuarter = q;
      this.collectRent();
    }

    this.maybeRandomEvent();
    this.checkVip();
  }

  // ---- Presence (who is physically in each unit right now) ---------------

  private updatePresence(): void {
    const weekend = this.clock.isWeekend;
    for (const u of this.tower.units) {
      const f = FACILITIES[u.kind];
      if (u.state === "empty") {
        u.occupants = 0;
        continue;
      }
      switch (u.kind) {
        case "office":
          // Offices staffed on weekday working hours.
          u.occupants =
            !weekend && this.clock.hour >= 8 && this.clock.hour < 18 ? f.population : 0;
          break;
        case "condo":
          // Residents home in evenings/night/weekends.
          u.occupants =
            this.clock.isNight() || this.clock.isEvening() || weekend ? f.population : 1;
          break;
        case "hotelSingle":
        case "hotelDouble":
        case "hotelSuite":
          u.occupants = u.state === "asleep" ? f.population : 0;
          break;
        default:
          u.occupants = u.state === "occupied" ? f.population : 0;
      }
    }
  }

  // ---- Satisfaction & churn ---------------------------------------------

  private updateSatisfaction(): void {
    for (const u of this.tower.units) {
      if (u.state === "empty") continue;
      const served = this.tower.isFloorServed(u.floor);
      if (!served) {
        u.satisfaction = Math.max(0, u.satisfaction - 0.15);
      } else {
        u.satisfaction = Math.min(1, u.satisfaction + 0.05);
      }
      // Tenants abandon a unit that stays unbearable.
      if (u.satisfaction <= 0 && (u.kind === "office" || u.kind === "condo")) {
        this.vacate(u);
      }
    }
  }

  private vacate(u: Unit): void {
    u.state = "empty";
    u.occupants = 0;
    u.everOccupied = u.kind === "condo" ? u.everOccupied : false;
    u.label = FACILITIES[u.kind].name;
    this.emit(`A tenant left ${FACILITIES[u.kind].name} on floor ${u.floor} (poor access).`, "bad");
  }

  // ---- Move-ins ----------------------------------------------------------

  private attemptMoveIns(): void {
    const weekend = this.clock.isWeekend;
    for (const u of this.tower.units) {
      if (u.state !== "empty") continue;
      const f = FACILITIES[u.kind];
      if (f.population === 0 && !isHotelKind(u.kind)) continue; // non-tenant facility
      if (!this.tower.isFloorServed(u.floor)) continue; // nobody moves to an unreachable floor

      if (u.kind === "office") {
        if (!weekend && this.rng.chance(0.25)) this.moveIn(u);
      } else if (u.kind === "condo") {
        if (this.rng.chance(0.18)) this.moveIn(u);
      } else if (isHotelKind(u.kind)) {
        // Hotel rooms fill in the evening only and must be clean.
        if (this.clock.isEvening() && this.rng.chance(0.5)) {
          u.state = "asleep";
          u.everOccupied = true;
        }
      }
    }
  }

  private moveIn(u: Unit): void {
    u.state = "occupied";
    u.satisfaction = 1;
    if (u.kind === "condo" && !u.everOccupied) {
      u.everOccupied = true;
      this.money += ECON.condoSalePrice;
      this.emit(`Condominium on floor ${u.floor} sold for $${ECON.condoSalePrice.toLocaleString()}.`, "money");
    }
    if (u.kind === "office") {
      u.everOccupied = true;
      u.label = this.companyName();
    }
  }

  private companyName(): string {
    const a = ["Apex", "Nimbus", "Vertex", "Cobalt", "Atlas", "Orion", "Pioneer", "Summit", "Delta", "Vista"];
    const b = ["Holdings", "Systems", "Partners", "Industries", "Group", "Labs", "Trading", "Capital"];
    return `${this.rng.pick(a)} ${this.rng.pick(b)}`;
  }

  // ---- Income ------------------------------------------------------------

  private collectRent(): void {
    let total = 0;
    let count = 0;
    for (const u of this.tower.units) {
      if (u.kind === "office" && u.state === "occupied" && this.tower.isFloorServed(u.floor)) {
        total += ECON.officeRentQuarterly;
        count++;
      }
    }
    if (total > 0) {
      this.money += total;
      this.emit(`Quarterly office rent collected: $${total.toLocaleString()} (${count} offices).`, "money");
    }
  }

  private collectTrafficIncome(): void {
    // Food/retail/entertainment earn a slice of their daily potential each
    // hour they're open and reachable, scaled by nearby population.
    const appeal = this.trafficAppeal();
    for (const u of this.tower.units) {
      const daily = ECON.dailyTrafficIncome[u.kind];
      if (daily === undefined) continue;
      if (!this.tower.isFloorServed(u.floor)) continue;
      const open = this.isOpenNow(u.kind);
      if (!open) continue;
      u.state = "occupied";
      const hourly = (daily / 8) * appeal * (0.6 + this.rng.next() * 0.4);
      u.pendingIncome += hourly;
      if (u.pendingIncome >= 1) {
        const earned = Math.floor(u.pendingIncome);
        u.pendingIncome -= earned;
        this.money += earned;
      }
    }
  }

  private isOpenNow(kind: FacilityKind): boolean {
    switch (kind) {
      case "fastFood":
        return this.clock.hour >= 7 && this.clock.hour < 22;
      case "restaurant":
        return this.clock.isLunch() || this.clock.isEvening();
      case "shop":
        return this.clock.hour >= 10 && this.clock.hour < 21;
      case "cinema":
        return this.clock.hour >= 12 && this.clock.hour < 24;
      case "partyHall":
        return this.clock.isEvening();
      default:
        return true;
    }
  }

  /** 0..~1.5 multiplier from how busy the tower is. */
  private trafficAppeal(): number {
    const pop = this.tower.totalPopulation();
    return Math.min(1.5, 0.3 + pop / 4000);
  }

  // ---- Hotels ------------------------------------------------------------

  private hotelCheckout(): void {
    let revenue = 0;
    for (const u of this.tower.units) {
      if (!isHotelKind(u.kind)) continue;
      if (u.state === "asleep") {
        revenue += ECON.hotel[u.kind] ?? 0;
        // Guest leaves; the room is now DIRTY and cannot be re-let until
        // housekeeping services it.
        u.state = "dirty";
        u.occupants = 0;
      }
    }
    if (revenue > 0) {
      this.money += revenue;
      this.emit(`Hotel guests checked out: $${revenue.toLocaleString()} earned overnight.`, "money");
    }
    this.runHousekeeping();
  }

  /**
   * Each housekeeping facility services a fixed number of dirty rooms per day.
   * Without enough housekeeping, dirty rooms pile up and cannot earn — exactly
   * as in the original, where you scale housekeeping with your hotel.
   */
  private runHousekeeping(): void {
    const capacityPerUnit = 20;
    let capacity =
      this.tower.units.filter((u) => u.kind === "housekeeping").length * capacityPerUnit;
    if (capacity <= 0) return;
    let cleaned = 0;
    for (const u of this.tower.units) {
      if (capacity <= 0) break;
      if (isHotelKind(u.kind) && u.state === "dirty" && this.tower.isFloorServed(u.floor)) {
        u.state = "empty";
        u.satisfaction = 1;
        capacity--;
        cleaned++;
      }
    }
    if (cleaned > 0) this.emit(`Housekeeping cleaned ${cleaned} hotel room(s).`, "info");
  }

  /** Count of hotel rooms still awaiting cleaning. */
  dirtyRooms(): number {
    return this.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty").length;
  }

  // ---- Maintenance -------------------------------------------------------

  private payMaintenance(): void {
    let cost = 0;
    for (const t of this.tower.transports) {
      if (isElevatorKind(t.kind)) cost += t.cars * ECON.maintenancePerCarMonthly;
    }
    for (const u of this.tower.units) {
      const m = ECON.serviceMaintenanceMonthly[u.kind];
      if (m) cost += m;
    }
    if (cost > 0) {
      this.money -= cost;
      this.emit(`Monthly maintenance paid: $${cost.toLocaleString()}.`, "money");
    }
  }

  // ---- Star rating -------------------------------------------------------

  evaluateStar(): void {
    if (this.star >= 6) return;
    const pop = this.tower.totalPopulation();
    let target = this.star;
    for (let s = 5; s >= 1; s--) {
      if (pop >= STAR_THRESHOLDS[s]) {
        target = s;
        break;
      }
    }
    // Extra gates beyond raw population, matching the original's spirit.
    if (target >= 3 && !this.hasAny("security")) target = Math.min(target, 2);
    if (target >= 4 && !this.hasAny("medical")) target = Math.min(target, 3);

    if (target > this.star) {
      this.star = target;
      this.emit(`Congratulations! Your tower reached ${this.star} stars.`, "good");
    }
  }

  private hasAny(kind: FacilityKind): boolean {
    return this.tower.units.some((u) => u.kind === kind);
  }

  // ---- VIP / TOWER rating ------------------------------------------------

  private checkVip(): void {
    if (this.evaluatedTower || this.vipVisitDay < 0) return;
    if (this.clock.day < this.vipVisitDay) return;
    this.vipVisitDay = -1;
    const pop = this.tower.totalPopulation();
    const ok =
      this.tower.builtCathedral &&
      this.star >= 5 &&
      pop >= STAR_THRESHOLDS[5] &&
      this.hasAny("metro");
    if (ok) {
      this.star = 6;
      this.evaluatedTower = true;
      this.emit("The VIP was impressed! Your building is now a TOWER. You win!", "good");
    } else {
      this.emit("The VIP was unimpressed. Grow your population and amenities, then rebuild interest.", "bad");
      this.vipVisitDay = this.clock.day + 5;
    }
  }

  // ---- Random events -----------------------------------------------------

  private maybeRandomEvent(): void {
    if (this.star < 2) return;
    if (!this.rng.chance(0.15)) return;
    const hasSecurity = this.hasAny("security");
    const roll = this.rng.next();
    if (roll < 0.4 && !hasSecurity && this.star >= 3) {
      const fine = 5_000 + this.rng.int(0, 5_000);
      this.money -= fine;
      this.emit(`Security incident! Without guards it cost $${fine.toLocaleString()}.`, "bad");
    } else if (roll < 0.7) {
      this.emit("A local newspaper praised your tower's design.", "good");
    } else {
      this.emit("Tenants are happy with the tower today.", "info");
    }
  }

  // ---- Transport animation (cosmetic) -----------------------------------

  private updateTransportAnimation(dt: number): void {
    for (const t of this.tower.transports) {
      if (!isElevatorKind(t.kind)) continue;
      for (let i = 0; i < t.cars; i++) {
        let dir = t.carDir[i];
        if (dir === 0) dir = this.rng.chance(0.5) ? 1 : -1;
        let pos = t.carPositions[i] + dir * dt * 0.4;
        if (pos >= t.top) {
          pos = t.top;
          dir = -1;
        } else if (pos <= t.bottom) {
          pos = t.bottom;
          dir = 1;
        }
        t.carPositions[i] = pos;
        t.carDir[i] = dir;
      }
    }
  }

  // ---- Derived stats for UI ---------------------------------------------

  get population(): number {
    return this.tower.totalPopulation();
  }

  get nextStarThreshold(): number | null {
    if (this.star >= 5) return null;
    return STAR_THRESHOLDS[this.star + 1];
  }

  stats() {
    let offices = 0,
      occupiedOffices = 0,
      condos = 0,
      soldCondos = 0,
      hotelRooms = 0,
      occupiedHotel = 0,
      dirty = 0,
      shops = 0,
      restaurants = 0,
      vacant = 0;
    for (const u of this.tower.units) {
      if (u.kind === "office") {
        offices++;
        if (u.state === "occupied") occupiedOffices++;
        if (u.state === "empty") vacant++;
      } else if (u.kind === "condo") {
        condos++;
        if (u.everOccupied) soldCondos++;
      } else if (isHotelKind(u.kind)) {
        hotelRooms++;
        if (u.state === "asleep") occupiedHotel++;
        if (u.state === "dirty") dirty++;
      } else if (u.kind === "shop") shops++;
      else if (u.kind === "restaurant" || u.kind === "fastFood") restaurants++;
    }
    return {
      population: this.population,
      money: this.money,
      star: this.star,
      offices,
      occupiedOffices,
      condos,
      soldCondos,
      hotelRooms,
      occupiedHotel,
      dirty,
      shops,
      restaurants,
      vacant,
      floors: this.tower.highestFloor,
      basements: Math.max(0, 1 - this.tower.lowestFloor),
      elevators: this.tower.transports.filter((t) => isElevatorKind(t.kind)).length,
      transports: this.tower.transports.length,
    };
  }

  // ---- Serialization -----------------------------------------------------

  serialize(): SerializedGame {
    return {
      version: 1,
      seed: this.rng.seed,
      money: this.money,
      star: this.star,
      minutes: this.clock.minutes,
      units: this.tower.units.map((u) => ({ ...u })),
      transports: this.tower.transports.map((t) => ({
        ...t,
        carPositions: [...t.carPositions],
        carDir: [...t.carDir],
      })),
      nextId: this.tower.getNextId(),
      towerName: this.tower.towerName,
      builtCathedral: this.tower.builtCathedral,
      evaluatedTower: this.evaluatedTower,
    };
  }

  static deserialize(data: SerializedGame): Simulation {
    const sim = new Simulation(data.seed);
    sim.money = data.money;
    sim.star = data.star;
    sim.clock = new Clock(data.minutes);
    sim.evaluatedTower = data.evaluatedTower;
    sim.tower.units = data.units.map((u) => ({ ...u }));
    sim.tower.transports = data.transports.map((t) => ({ ...t }));
    sim.tower.setNextId(data.nextId);
    sim.tower.towerName = data.towerName;
    sim.tower.builtCathedral = data.builtCathedral;
    sim.tower.reindex();
    sim.lastDay = sim.clock.day;
    sim.lastQuarter = sim.clock.quarter;
    sim.lastMonth = Math.floor(sim.clock.day / 30);
    sim.lastHour = sim.clock.hour;
    return sim;
  }

  /** Convenience for the initial empty lot (ground lobby seed). */
  static newGame(seed = 12345): Simulation {
    const sim = new Simulation(seed);
    // Seed a starter ground-floor lobby strip so the player has a base.
    const startX = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) {
      sim.tower.place("lobby", 1, startX + i);
    }
    sim.emit("Welcome! Build floors, add elevators, and attract tenants.", "info");
    return sim;
  }
}
