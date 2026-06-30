import type { SimContext } from "./SimContext";
import { ECON } from "./econConfig";
import { isElevatorKind, isHotelKind, isOpenAt } from "./facilities";

/**
 * The money loop — rent, foot-traffic income, hotel revenue, housekeeping and
 * maintenance — pulled out of {@link Simulation} so the economy can be reasoned
 * about and tested on its own against a {@link SimContext}. The Simulation still
 * decides *when* each runs (hourly / daily / monthly / quarterly); this just
 * holds the *what*.
 */
export class EconomySystem {
  constructor(private readonly sim: SimContext) {}

  /** Quarterly office rent from occupied, reachable offices. */
  collectRent(): void {
    let total = 0;
    let count = 0;
    for (const u of this.sim.tower.units) {
      if (u.kind === "office" && u.state === "occupied" && this.sim.tower.isFloorServed(u.floor)) {
        total += ECON.officeRentQuarterly;
        count++;
      }
    }
    if (total > 0) {
      this.sim.money += total;
      this.sim.emit(`Quarterly office rent collected: $${total.toLocaleString()} (${count} offices).`, "money");
    }
  }

  /** Hourly food/retail/entertainment takings, scaled by foot traffic. */
  collectTrafficIncome(): void {
    const appeal = this.trafficAppeal();
    for (const u of this.sim.tower.units) {
      const daily = ECON.dailyTrafficIncome[u.kind];
      if (daily === undefined) continue;
      if (u.state === "construction" || u.state === "fire") continue;
      if (!this.sim.tower.isFloorServed(u.floor)) continue;
      if (!isOpenAt(u.kind, this.sim.clock.hour)) {
        // Closed for the night — no patrons.
        if (u.state === "occupied") u.occupants = 0;
        continue;
      }
      u.state = "occupied";
      const hourly = (daily / 8) * appeal * (0.6 + this.sim.rng.next() * 0.4);
      u.pendingIncome += hourly;
      if (u.pendingIncome >= 1) {
        const earned = Math.floor(u.pendingIncome);
        u.pendingIncome -= earned;
        this.sim.money += earned;
      }
    }
  }

  /** 0..~1.8 multiplier from how busy the tower is. A metro station pulls in
   *  crowds of outside visitors, lifting trade for every shop and eatery —
   *  the classic reason to dig down to the subway in the original. */
  private trafficAppeal(): number {
    const pop = this.sim.tower.totalPopulation();
    const metro = this.sim.hasAny("metro") ? 0.4 : 0;
    return Math.min(1.8, 0.3 + pop / 4000 + metro);
  }

  /** Nightly hotel checkout: collect revenue, mark rooms dirty, then clean. */
  hotelCheckout(): void {
    let revenue = 0;
    for (const u of this.sim.tower.units) {
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
      this.sim.money += revenue;
      this.sim.emit(`Hotel guests checked out: $${revenue.toLocaleString()} earned overnight.`, "money");
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
      this.sim.tower.units.filter((u) => u.kind === "housekeeping").length * capacityPerUnit;
    if (capacity <= 0) return;
    let cleaned = 0;
    for (const u of this.sim.tower.units) {
      if (capacity <= 0) break;
      if (isHotelKind(u.kind) && u.state === "dirty" && this.sim.tower.isFloorServed(u.floor)) {
        u.state = "empty";
        u.satisfaction = 1;
        capacity--;
        cleaned++;
      }
    }
    if (cleaned > 0) this.sim.emit(`Housekeeping cleaned ${cleaned} hotel room(s).`, "info");
  }

  /** Monthly upkeep for elevator cars and staffed service facilities. */
  payMaintenance(): void {
    let cost = 0;
    for (const t of this.sim.tower.transports) {
      if (isElevatorKind(t.kind)) cost += t.cars * ECON.maintenancePerCarMonthly;
    }
    for (const u of this.sim.tower.units) {
      const m = ECON.serviceMaintenanceMonthly[u.kind];
      if (m) cost += m;
    }
    if (cost > 0) {
      this.sim.money -= cost;
      this.sim.emit(`Monthly maintenance paid: $${cost.toLocaleString()}.`, "money");
    }
  }
}
