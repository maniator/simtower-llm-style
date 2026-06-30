/** Tunable economic constants (dollars), tuned to the 1994 SimTower balance. */
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
