/** Tunable economic constants (dollars), tuned to the 1994 SimTower balance. */
export const ECON = {
  startingMoney: 2_000_000,
  dailyTrafficIncome: {
    fastFood: 2_000,
    restaurant: 4_000,
    shop: 2_500,
    cinema: 8_000,
    partyHall: 3_000,
  } as Record<string, number>,
  maintenancePerCarMonthly: 600,
  /** Cost to extend an elevator shaft by one floor (click or drag handle). */
  transportFloorCost: 5_000,
  /** Player-adjustable price ranges (per the original's rent dropdown). The
   *  `default` is what an un-set unit charges; income, move-in odds and tenant
   *  satisfaction all key off how far the chosen price sits from it. */
  rent: {
    office: { default: 10_000, min: 2_000, max: 20_000, step: 1_000 },
    condo: { default: 120_000, min: 60_000, max: 240_000, step: 10_000 },
    hotelSingle: { default: 90, min: 40, max: 200, step: 10 },
    hotelDouble: { default: 180, min: 80, max: 400, step: 20 },
    hotelSuite: { default: 500, min: 200, max: 1_000, step: 50 },
  } as Record<string, { default: number; min: number; max: number; step: number }>,
  serviceMaintenanceMonthly: {
    security: 2_000,
    medical: 5_000,
    housekeeping: 1_000,
    recycling: 4_000,
    metro: 8_000,
  } as Record<string, number>,
} as const;

/** The price band for a unit kind, or null if its price isn't player-set. */
export function rentConfig(kind: string): { default: number; min: number; max: number; step: number } | null {
  return ECON.rent[kind] ?? null;
}

/** The effective price for a unit — the player's choice, or the kind default. */
export function rentOf(u: { kind: string; rent?: number }): number {
  return u.rent ?? ECON.rent[u.kind]?.default ?? 0;
}
