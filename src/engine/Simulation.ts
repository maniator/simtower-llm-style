import { Clock } from "./Clock";
import { Tower } from "./Tower";
import { RNG } from "./rng";
import {
  FACILITIES,
  GRID,
  STAR_THRESHOLDS,
  TOWER_POPULATION,
  TRANSPORT_CAPACITY,
  buildMinutes,
  facilityFloors,
  isElevatorKind,
  isFacilityKind,
  isHotelKind,
  isOpenAt,
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

  /**
   * 0..1 frustration reported by the renderer's individually-routed {@link Crowd}
   * — the fraction of real people stuck waiting too long for an elevator. It
   * supplements the aggregate {@link congestion} signal with what's actually
   * happening to the visible commuters. Stays 0 in headless runs (no renderer).
   */
  crowdStress = 0;

  /** Ids of units currently under construction (finalised on the global tick). */
  private constructing = new Set<number>();
  /** Ids of units currently ablaze (a fire emergency in progress). */
  private activeFires = new Set<number>();

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

  /** True for kinds that ride on a floor (and so can auto-lay one). */
  private isRoomKind(kind: FacilityKind): boolean {
    return kind !== "floor" && kind !== "lobby" && !FACILITIES[kind].transport;
  }

  /**
   * Non-mutating feasibility + total cost for placing a facility here. Rooms
   * may auto-lay the floor beneath them, so their cost includes the floor tiles
   * that would be created. Used for build previews and by {@link build}.
   */
  canBuild(kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string; cost: number } {
    if (!isFacilityKind(kind)) return { ok: false, reason: "Unknown facility.", cost: 0 };
    const f = FACILITIES[kind];
    if (!this.isUnlocked(kind)) return { ok: false, reason: `${f.name} unlocks at ${f.minStar}★.`, cost: f.cost };

    if (!this.isRoomKind(kind)) {
      const c = this.tower.canPlace(kind, floor, x);
      if (!c.ok) return { ok: false, reason: c.reason, cost: f.cost };
      const afford = this.money >= f.cost;
      return { ok: afford, reason: afford ? undefined : "Not enough money.", cost: f.cost };
    }

    const pre = this.tower.canPlaceRoomIgnoringFloor(kind, floor, x);
    if (!pre.ok) return { ok: false, reason: pre.reason, cost: f.cost };
    const hgt = facilityFloors(kind);
    const missing = this.tower.missingFloorCount(floor, x, f.width, hgt);
    if (missing > 0 && !this.tower.spanConnects(floor, x, f.width, hgt)) {
      const reason =
        floor >= 2
          ? "Rooms must sit on the floor below — no floating overhangs."
          : "Build next to the tower — you can't build in midair.";
      return { ok: false, reason, cost: f.cost };
    }
    const cost = f.cost + missing * FACILITIES.floor.cost;
    const afford = this.money >= cost;
    return { ok: afford, reason: afford ? undefined : "Not enough money.", cost };
  }

  build(kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string } {
    const can = this.canBuild(kind, floor, x);
    if (!can.ok) return { ok: false, reason: can.reason };
    const f = FACILITIES[kind];
    // A room lays its own floor where missing (so you never pre-build bare
    // floors for an office or condo — just drop it next to the tower).
    if (this.isRoomKind(kind)) {
      const ef = this.tower.ensureFloorUnder(floor, x, f.width, facilityFloors(kind));
      if (!ef.ok) return { ok: false, reason: ef.reason };
    }
    const res = this.tower.place(kind, floor, x);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.money -= can.cost;
    // Rooms spend time under construction before they can be used.
    const dur = buildMinutes(kind);
    if (dur > 0 && res.unitId !== undefined) {
      const u = this.tower.units.find((uu) => uu.id === res.unitId);
      if (u) {
        u.state = "construction";
        u.completeAt = this.clock.minutes + dur;
        this.constructing.add(u.id);
      }
    }
    if (kind === "weddingHall") {
      this.emit("Wedding Hall built! A VIP will inspect your tower soon.", "good");
      this.vipVisitDay = this.clock.day + 3;
    }
    // Excavating the basement occasionally turns up buried treasure, just like
    // digging the foundations in the original. Only real rooms trigger it (not
    // the many single floor tiles), so it stays a rare, delightful windfall.
    if (floor <= 0 && kind !== "floor" && kind !== "lobby" && this.rng.chance(0.18)) {
      const gold = 50_000 + this.rng.int(0, 150_000);
      this.money += gold;
      this.emit(`💰 Excavation crews unearthed buried treasure worth $${gold.toLocaleString()}!`, "money");
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
    this.updateElevators(dtMinutes);
    this.finishConstruction();

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

  /** Finalise any units whose construction period has elapsed. */
  private finishConstruction(): void {
    if (this.constructing.size === 0) return;
    for (const id of [...this.constructing]) {
      const u = this.tower.units.find((uu) => uu.id === id);
      if (!u || u.state !== "construction") {
        this.constructing.delete(id);
        continue;
      }
      if (this.clock.minutes >= (u.completeAt ?? 0)) {
        u.state = "empty";
        u.completeAt = undefined;
        this.constructing.delete(id);
        this.emit(`${FACILITIES[u.kind].name} on ${this.floorLabel(u.floor)} is now open for business.`, "good");
      }
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
      if (u.state === "empty" || u.state === "construction" || u.state === "fire") {
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
    const cong = this.congestion();
    // Warn the player when their elevators can't keep up.
    if (cong > 1.4 && this.clock.hour === 9 && this.rng.chance(0.5)) {
      this.emit("Tenants are complaining of long elevator waits — add cars or shafts.", "bad");
    }
    for (const u of this.tower.units) {
      if (u.state === "empty" || u.state === "construction" || u.state === "fire") continue;
      const served = this.tower.isFloorServed(u.floor);
      if (!served) {
        u.satisfaction = Math.max(0, u.satisfaction - 0.15);
      } else if (cong > 1) {
        // Overcrowded vertical transport stresses everyone, more so the worse it is.
        u.satisfaction = Math.max(0, u.satisfaction - 0.04 * Math.min(3, cong - 1));
      } else {
        u.satisfaction = Math.min(1, u.satisfaction + 0.05);
      }
      // The real, individually-routed crowd shaves a little extra satisfaction
      // when lots of commuters are visibly stuck waiting — but it never alone
      // empties a unit (floored above the churn threshold), so the headless
      // congestion model above stays the authoritative driver tests rely on.
      if (this.crowdStress > 0.5) {
        u.satisfaction = Math.max(0.05, u.satisfaction - 0.01 * Math.min(1, this.crowdStress));
      }
      // Tenants abandon a unit that stays unbearable.
      if (u.satisfaction <= 0 && (u.kind === "office" || u.kind === "condo")) {
        this.vacate(u);
      }
    }
  }

  /**
   * Ratio of moving population to total vertical-transport capacity. Above 1.0
   * the elevators/stairs are overcrowded and tenants get stressed. Capacity is
   * cars × per-car capacity (plus stairs/escalators), times a headroom factor
   * for the many trips made across a rush.
   */
  congestion(): number {
    let capacity = 0;
    for (const t of this.tower.transports) {
      const per = TRANSPORT_CAPACITY[t.kind] ?? 0;
      if (isElevatorKind(t.kind)) capacity += t.cars * per;
      else capacity += per; // stairs / escalator
    }
    // Metro stations and basement parking move commuters in and out without
    // ever touching the passenger elevators, easing the crunch — the very
    // reason you build them in the original.
    for (const u of this.tower.units) {
      if (u.kind === "metro") capacity += 60;
      else if (u.kind === "parking") capacity += 4;
    }
    const pop = this.tower.totalPopulation();
    if (capacity <= 0) return pop > 0 ? 3 : 0;
    // Demand swings with the day: a heavy morning/evening commute can overwhelm
    // shafts that cope fine at midday, and the tower nearly empties overnight —
    // the rush-hour rhythm the original is built around.
    return (pop * this.rushFactor()) / (capacity * 12);
  }

  /** Multiplier on moving demand by time of day (rush hours vs. overnight). */
  private rushFactor(): number {
    const c = this.clock;
    if (c.isMorning() || c.isEvening()) return 1.45; // peak commute
    if (c.isLunch()) return 1.15; // lunch crowd
    if (c.isNight()) return 0.35; // tower mostly asleep
    return 0.8;
  }

  /** Capacity of a single transport (riders served per trip). */
  transportCapacity(t: { kind: FacilityKind; cars: number }): number {
    const per = TRANSPORT_CAPACITY[t.kind] ?? 0;
    return isElevatorKind(t.kind) ? t.cars * per : per;
  }

  private vacate(u: Unit): void {
    u.state = "empty";
    u.occupants = 0;
    u.everOccupied = u.kind === "condo" ? u.everOccupied : false;
    u.label = FACILITIES[u.kind].name;
    this.emit(`A tenant left ${FACILITIES[u.kind].name} on ${this.floorLabel(u.floor)} (poor access).`, "bad");
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
      this.emit(`Condominium on ${this.floorLabel(u.floor)} sold for $${ECON.condoSalePrice.toLocaleString()}.`, "money");
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
      if (u.state === "construction" || u.state === "fire") continue;
      if (!this.tower.isFloorServed(u.floor)) continue;
      if (!isOpenAt(u.kind, this.clock.hour)) {
        // Closed for the night — no patrons.
        if (u.state === "occupied") u.occupants = 0;
        continue;
      }
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


  /** 0..~1.8 multiplier from how busy the tower is. A metro station pulls in
   *  crowds of outside visitors, lifting trade for every shop and eatery —
   *  the classic reason to dig down to the subway in the original. */
  private trafficAppeal(): number {
    const pop = this.tower.totalPopulation();
    const metro = this.hasAny("metro") ? 0.4 : 0;
    return Math.min(1.8, 0.3 + pop / 4000 + metro);
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
      this.tower.builtWeddingHall &&
      this.star >= 5 &&
      pop >= TOWER_POPULATION &&
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

  /** Number of units currently on fire (for the UI / stats). */
  get fires(): number {
    return this.activeFires.size;
  }

  /** Human floor label: "floor 5" above ground, "B1"/"B2"… below (floor 0 = B1). */
  private floorLabel(floor: number): string {
    return floor >= 1 ? `floor ${floor}` : `B${1 - floor}`;
  }

  private maybeRandomEvent(): void {
    // An ongoing fire is fought (or spreads) every day until it's out.
    this.processFires();
    if (this.star < 2) return;

    const roll = this.rng.next();
    // A medical center's fast emergency response makes fires far less likely.
    const fireChance = this.hasAny("medical") ? 0.04 : 0.09;
    if (this.activeFires.size === 0 && roll < fireChance) {
      this.startFire();
      return;
    }
    // Bomb threats target prestigious towers (4★ and up).
    if (this.star >= 4 && roll < fireChance + 0.05) {
      this.bombThreat();
      return;
    }
    // Otherwise the occasional flavorful headline.
    if (this.rng.chance(0.15)) {
      if (this.rng.chance(0.5)) this.emit("A local newspaper praised your tower's design.", "good");
      else this.emit("Tenants are happy with the tower today.", "info");
    }
  }

  /** Rooms that can catch fire (real, finished rooms — not structure). */
  private flammableUnits(): Unit[] {
    return this.tower.units.filter(
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
    const u = this.rng.pick(candidates);
    u.state = "fire";
    u.occupants = 0;
    this.activeFires.add(u.id);
    this.emit(`🔥 Fire broke out in ${FACILITIES[u.kind].name} on ${this.floorLabel(u.floor)}!`, "bad");
  }

  /** The room immediately left or right of a unit on the same floor. */
  private adjacentRoom(u: Unit): Unit | undefined {
    return this.tower.roomAt(u.floor, u.x - 1) ?? this.tower.roomAt(u.floor, u.x + u.width);
  }

  /**
   * Resolve active fires. Security and especially a medical center speed the
   * emergency response; without them a blaze is more likely to spread to the
   * neighboring room before it's contained — the core reason to staff your
   * tower in the original game.
   */
  private processFires(): void {
    if (this.activeFires.size === 0) return;
    const control = 0.35 + (this.hasAny("security") ? 0.2 : 0) + (this.hasAny("medical") ? 0.3 : 0);
    for (const id of [...this.activeFires]) {
      const u = this.tower.units.find((x) => x.id === id);
      if (!u || u.state !== "fire") {
        this.activeFires.delete(id);
        continue;
      }
      if (this.rng.chance(control)) {
        // Contained: pay to repair the gutted unit, then it reopens vacant.
        const repair = Math.floor(FACILITIES[u.kind].cost * 0.3);
        this.money -= repair;
        u.state = "empty";
        u.satisfaction = 1;
        u.everOccupied = false;
        u.label = FACILITIES[u.kind].name;
        this.activeFires.delete(id);
        this.emit(`Firefighters contained the blaze on ${this.floorLabel(u.floor)}. Repairs cost $${repair.toLocaleString()}.`, "money");
      } else {
        const next = this.adjacentRoom(u);
        if (next && next.state !== "fire" && next.kind !== "floor" && next.kind !== "lobby" && next.state !== "construction") {
          next.state = "fire";
          next.occupants = 0;
          this.activeFires.add(next.id);
          this.emit(`The fire spread to ${FACILITIES[next.kind].name} on ${this.floorLabel(next.floor)}!`, "bad");
        }
      }
    }
    // An active emergency rattles everyone still in the building.
    if (this.activeFires.size > 0) {
      for (const u of this.tower.units) {
        if (u.state === "occupied" || u.state === "asleep") {
          u.satisfaction = Math.max(0, u.satisfaction - 0.05);
        }
      }
    }
  }

  /** A bomb scare. Security defuses it; without guards it does real damage. */
  bombThreat(): void {
    if (this.hasAny("security")) {
      const cost = 2_000 + this.rng.int(0, 3_000);
      this.money -= cost;
      this.emit(`💣 A bomb threat was called in — security swept the tower and found nothing. The evacuation cost $${cost.toLocaleString()}.`, "info");
      return;
    }
    const fine = 15_000 + this.rng.int(0, 15_000);
    this.money -= fine;
    const targets = this.flammableUnits();
    if (targets.length > 0) {
      const u = this.rng.pick(targets);
      u.state = "empty";
      u.occupants = 0;
      u.everOccupied = false;
      u.label = FACILITIES[u.kind].name;
    }
    this.emit(`💣 A bomb threat caused chaos! With no security office the panic and damage cost $${fine.toLocaleString()} — build Security.`, "bad");
  }

  // ---- Elevator dispatch -------------------------------------------------

  /** Transient per-car dwell timers (not serialized; rebuilt on demand). */
  private carDwell = new Map<number, number[]>();
  /** Waiting passengers per floor — builds up over time, cleared as cars call. */
  private waiting = new Map<number, number>();

  /**
   * Accumulate waiting passengers per floor: only people who are actually
   * present generate trips, and they trickle in faster during the rush. Calls
   * fade if no car ever comes. Cars therefore sit idle when nobody's about
   * (an empty tower, the dead of night) and bustle when it's busy.
   */
  private accumulateWaiting(dt: number): void {
    const rush = this.rushFactor();
    for (const [fl, n] of this.waiting) {
      const v = n - dt * 0.03;
      if (v <= 0) this.waiting.delete(fl);
      else this.waiting.set(fl, v);
    }
    for (const u of this.tower.units) {
      if (u.occupants <= 0 || !this.tower.isFloorServed(u.floor)) continue;
      this.waiting.set(u.floor, Math.min(25, (this.waiting.get(u.floor) ?? 0) + u.occupants * rush * dt * 0.012));
    }
    const pop = this.tower.totalPopulation();
    if (pop > 0) {
      for (const fl of this.tower.lobbyFloors()) {
        this.waiting.set(fl, Math.min(25, (this.waiting.get(fl) ?? 0) + pop * rush * dt * 0.0015));
      }
    }
  }

  /** Nearest stop strictly ahead (in `dir`) that has a real call waiting. */
  private nextDemandStop(stops: number[], pos: number, dir: number, demand: Map<number, number>): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const fl of stops) {
      if (dir > 0 && fl <= pos + 0.05) continue;
      if (dir < 0 && fl >= pos - 0.05) continue;
      if ((demand.get(fl) ?? 0) < 1) continue;
      const dist = Math.abs(fl - pos);
      if (dist < bestDist) {
        bestDist = dist;
        best = fl;
      }
    }
    return best;
  }

  /**
   * Move each elevator car like a real lift (a simplified SCAN algorithm):
   * it continues in its current direction to the next floor that has waiting
   * passengers, dwells briefly to load, then carries on — reversing when there
   * is nothing more ahead. Cars therefore congregate where demand is, instead
   * of bouncing at random. Stairs/escalators have no cars (their walkers are
   * drawn directly), so they're skipped here.
   */
  private updateElevators(dt: number): void {
    this.accumulateWaiting(dt);
    const demand = this.waiting;
    for (const t of this.tower.transports) {
      if (!isElevatorKind(t.kind)) continue;
      const stops: number[] = [];
      for (let fl = t.bottom; fl <= t.top; fl++) if (this.tower.stopsAt(t, fl)) stops.push(fl);
      if (stops.length === 0) continue;

      let dwell = this.carDwell.get(t.id);
      if (!dwell || dwell.length !== t.cars) {
        dwell = new Array(t.cars).fill(0);
        this.carDwell.set(t.id, dwell);
      }
      if (!t.carLoad || t.carLoad.length !== t.cars) t.carLoad = new Array(t.cars).fill(0);
      const cap = TRANSPORT_CAPACITY[t.kind] ?? 12;

      const v = dt * 0.4; // floors travelled this step
      for (let i = 0; i < t.cars; i++) {
        if (dwell[i] > 0) {
          dwell[i] = Math.max(0, dwell[i] - dt);
          continue;
        }
        let pos = t.carPositions[i];
        let dir = t.carDir[i] || 1;

        let target = this.nextDemandStop(stops, pos, dir, demand);
        if (target === null) {
          dir = -dir; // nothing ahead — turn around
          target = this.nextDemandStop(stops, pos, dir, demand);
        }
        if (target === null) {
          // Nobody waiting: rest at the lowest served floor (the lobby) and
          // stop dead rather than pacing the shaft.
          target = stops[0];
          if (Math.abs(pos - target) < 0.05) {
            t.carDir[i] = 0;
            t.carLoad[i] = 0; // everyone's stepped off
            continue;
          }
        }

        if (Math.abs(target - pos) <= v) {
          pos = target;
          dwell[i] = 1.2; // pause to load / unload
          // Some riders alight, then waiting passengers board up to capacity.
          t.carLoad[i] = Math.max(0, t.carLoad[i] - Math.ceil(t.carLoad[i] * 0.45));
          const w = demand.get(target) ?? 0;
          const board = Math.max(0, Math.min(cap - t.carLoad[i], w));
          if (board > 0) {
            t.carLoad[i] += board;
            demand.set(target, Math.max(0, w - board));
          }
          if (pos >= t.top) dir = -1;
          else if (pos <= t.bottom) dir = 1;
        } else {
          dir = target > pos ? 1 : -1;
          pos += dir * v;
        }
        t.carPositions[i] = Math.max(t.bottom, Math.min(t.top, pos));
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
      fires: this.activeFires.size,
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
      builtWeddingHall: this.tower.builtWeddingHall,
      evaluatedTower: this.evaluatedTower,
    };
  }

  static deserialize(data: SerializedGame): Simulation {
    const sim = new Simulation(data.seed);
    sim.money = data.money;
    sim.star = data.star;
    sim.clock = new Clock(data.minutes);
    sim.evaluatedTower = data.evaluatedTower;
    // Reject any unit/transport with an unrecognized kind from untrusted saves.
    sim.tower.units = (data.units ?? [])
      .filter((u) => isFacilityKind(u.kind))
      .map((u) => ({ ...u }));
    sim.tower.transports = (data.transports ?? [])
      .filter((t) => isFacilityKind(t.kind))
      .map((t) => ({ ...t }));
    sim.tower.setNextId(data.nextId);
    sim.tower.towerName = data.towerName;
    sim.tower.builtWeddingHall = data.builtWeddingHall;
    sim.tower.reindex();
    // Resume any in-progress construction and ongoing fires.
    for (const u of sim.tower.units) {
      if (u.state === "construction") sim.constructing.add(u.id);
      if (u.state === "fire") sim.activeFires.add(u.id);
    }
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
