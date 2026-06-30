import type { Facility, FacilityKind } from "./types";

/**
 * Facility catalog. Costs and sizes are tuned to mirror the scale and balance
 * of the 1994 SimTower (Maxis/OpenBook). Widths are in grid tiles.
 *
 * In the original, a single office is the base unit of "width". We use a tile
 * grid where the smallest commercial unit is a few tiles wide.
 */
export const FACILITIES: Record<FacilityKind, Facility> = {
  lobby: {
    kind: "lobby",
    category: "structure",
    name: "Lobby",
    width: 1,
    cost: 5000,
    minStar: 1,
    population: 0,
    color: "#d8d2b0",
    description:
      "Ground-floor and sky lobbies. People pass through to reach elevators. Build every 15 floors.",
  },
  floor: {
    kind: "floor",
    category: "structure",
    name: "Floor",
    width: 1,
    cost: 500,
    minStar: 1,
    population: 0,
    color: "#9a9486",
    description: "Structural floor space. Must exist before placing rooms.",
  },
  office: {
    kind: "office",
    category: "office",
    name: "Office",
    width: 9,
    cost: 40000,
    minStar: 1,
    population: 6,
    color: "#6fb1d6",
    description: "Rents to a company. Workers arrive mornings, leave evenings. Pays quarterly rent.",
  },
  condo: {
    kind: "condo",
    category: "residential",
    name: "Condominium",
    width: 16,
    cost: 80000,
    minStar: 1,
    population: 3,
    color: "#7ec97e",
    description: "Sold once to a resident family for a large lump sum. Residents live here permanently.",
  },
  hotelSingle: {
    kind: "hotelSingle",
    category: "hotel",
    name: "Single Room",
    width: 4,
    cost: 20000,
    minStar: 2,
    population: 1,
    color: "#e0b15e",
    description: "Hotel single. Guests check in at night, out in the morning. Needs housekeeping.",
  },
  hotelDouble: {
    kind: "hotelDouble",
    category: "hotel",
    name: "Double Room",
    width: 6,
    cost: 40000,
    minStar: 2,
    population: 2,
    color: "#e0a94e",
    description: "Hotel double room. Higher nightly income than a single.",
  },
  hotelSuite: {
    kind: "hotelSuite",
    category: "hotel",
    name: "Suite",
    width: 12,
    cost: 100000,
    minStar: 2,
    population: 2,
    color: "#d99a2e",
    description: "Luxury hotel suite. Best nightly income, demanding guests.",
  },
  fastFood: {
    kind: "fastFood",
    category: "food",
    name: "Fast Food",
    width: 12,
    cost: 100000,
    minStar: 1,
    population: 0,
    color: "#e87b6e",
    description: "Quick dining. Busy at lunch. Income scales with foot traffic.",
  },
  restaurant: {
    kind: "restaurant",
    category: "food",
    name: "Restaurant",
    width: 16,
    cost: 200000,
    minStar: 2,
    population: 0,
    color: "#d4564a",
    description: "Fine dining, busy at lunch and dinner. Needs good elevator access.",
  },
  shop: {
    kind: "shop",
    category: "retail",
    name: "Retail Shop",
    width: 12,
    cost: 100000,
    minStar: 2,
    population: 0,
    color: "#b58ad6",
    description: "Retail. Earns from shoppers passing by. Thrives near lobbies and offices.",
  },
  cinema: {
    kind: "cinema",
    category: "entertainment",
    name: "Cinema",
    width: 24,
    floors: 2,
    cost: 500000,
    minStar: 3,
    population: 0,
    color: "#8a6fd6",
    description: "A two-story movie theater. Draws large evening crowds; demands heavy transport capacity.",
  },
  partyHall: {
    kind: "partyHall",
    category: "entertainment",
    name: "Party Hall",
    width: 24,
    cost: 100000,
    minStar: 3,
    population: 0,
    color: "#cf7fb0",
    description: "Rentable function space for events. Periodic income.",
  },
  stairs: {
    kind: "stairs",
    category: "transport",
    name: "Stairway",
    width: 4,
    cost: 5000,
    minStar: 1,
    population: 0,
    color: "#b0a890",
    transport: true,
    description: "Cheap vertical link spanning a few floors. People will only climb a short distance.",
  },
  escalator: {
    kind: "escalator",
    category: "transport",
    name: "Escalator",
    width: 4,
    cost: 20000,
    minStar: 2,
    population: 0,
    color: "#c8c0a0",
    transport: true,
    description: "Moves crowds between adjacent floors. Great for lobbies, shops and food courts.",
  },
  elevatorStandard: {
    kind: "elevatorStandard",
    category: "transport",
    name: "Standard Elevator",
    width: 4,
    cost: 200000,
    minStar: 1,
    population: 0,
    color: "#5a5a6a",
    transport: true,
    description: "Serves up to 30 floors with several cars. The backbone of any tower.",
  },
  elevatorService: {
    kind: "elevatorService",
    category: "transport",
    name: "Service Elevator",
    width: 4,
    cost: 150000,
    minStar: 2,
    population: 0,
    color: "#4a4a52",
    transport: true,
    description: "Carries staff and freight. Keeps service traffic off passenger elevators.",
  },
  elevatorExpress: {
    kind: "elevatorExpress",
    category: "transport",
    name: "Express Elevator",
    width: 4,
    cost: 400000,
    minStar: 3,
    population: 0,
    color: "#3a3a8a",
    transport: true,
    description: "Stops only at lobbies and sky lobbies. Essential for very tall towers.",
  },
  parking: {
    kind: "parking",
    category: "service",
    name: "Parking Space",
    width: 6,
    cost: 30000,
    minStar: 2,
    population: 0,
    color: "#888888",
    basement: true,
    description: "Basement parking. Reduces tenant stress for those who drive.",
  },
  security: {
    kind: "security",
    category: "service",
    name: "Security",
    width: 8,
    cost: 100000,
    // Buildable at 2★ — it is the facility that GATES 3★, so it must be placeable
    // before the tower is 3★ or the rating deadlocks at 2★ forever.
    minStar: 2,
    population: 0,
    color: "#4f6f9f",
    description: "Security office. Reduces crime/terrorist events and improves evaluation.",
  },
  medical: {
    kind: "medical",
    category: "service",
    name: "Medical Center",
    width: 16,
    cost: 500000,
    minStar: 3,
    population: 0,
    color: "#e0e0e8",
    description: "Handles illness and emergencies. Required for high ratings in large towers.",
  },
  housekeeping: {
    kind: "housekeeping",
    category: "service",
    name: "Housekeeping",
    width: 8,
    cost: 50000,
    minStar: 2,
    population: 0,
    color: "#c0d0c0",
    description: "Cleans hotel rooms each day so they can be rented again. One per ~20 rooms.",
  },
  recycling: {
    kind: "recycling",
    category: "service",
    name: "Recycling Center",
    width: 20,
    floors: 2,
    cost: 500000,
    minStar: 4,
    population: 0,
    color: "#7f9f5f",
    basement: true,
    description: "Basement facility that processes the tower's waste. Improves large-tower rating.",
  },
  metro: {
    kind: "metro",
    category: "special",
    name: "Metro Station",
    // Spans an entire basement floor (full lot width = GRID.width).
    width: 200,
    floors: 1,
    cost: 1000000,
    minStar: 4,
    population: 0,
    color: "#9f7f5f",
    basement: true,
    description: "A whole-floor deep-basement subway station. Brings huge numbers of visitors to your tower.",
  },
  weddingHall: {
    kind: "weddingHall",
    category: "special",
    name: "Wedding Hall",
    width: 16,
    cost: 3000000,
    minStar: 5,
    population: 0,
    color: "#f3ecdc",
    description: "A grand wedding & events hall atop a 5-star tower (floor 100). Triggers the final TOWER evaluation.",
  },
};

export const ALL_KINDS: FacilityKind[] = Object.keys(FACILITIES) as FacilityKind[];

const KIND_SET = new Set<string>(ALL_KINDS);

/**
 * Runtime guard for facility kinds. TypeScript's string-literal union gives us
 * compile-time safety; this closes the runtime hole at trust boundaries (loaded
 * saves, imported JSON) so an invalid kind can never enter the model.
 */
export function isFacilityKind(value: unknown): value is FacilityKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/** Star rating population thresholds, matching the original game. */
export const STAR_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 300,
  3: 1000,
  4: 5000,
  5: 10000,
};

/**
 * Population needed for the final TOWER rating (above 5 stars). Same metric as
 * the 1994 original — a census of OCCUPANTS (office workers + condo residents +
 * hotel guests); commercial/visitor traffic never counts. The original asked for
 * 15,000, but that assumed a denser lot: under the v2 spatial transport model a
 * fully, well-zoned 100×200 tower tops out near ~8,900 occupants once shaft
 * columns are reserved (measured), so the goal is re-derived to 8,000 — reachable
 * with good play, with margin. (Phase 2 / review F2; owner-ratified metric.)
 */
export const TOWER_POPULATION = 8000;

/** Tower geometry constants. */
export const GRID = {
  /** Highest above-ground floor. */
  maxFloor: 100,
  /**
   * Floor numbering is continuous so basements sit directly under the ground
   * floor: floor 1 = ground, floor 0 = B1, -1 = B2 … -9 = B10 (no gap at 0).
   */
  minFloor: -9,
  /** Total buildable width in tiles. */
  width: 200,
  /** Floors between required (sky) lobbies. */
  lobbyInterval: 15,
} as const;

export function isHotelKind(kind: FacilityKind): boolean {
  return kind === "hotelSingle" || kind === "hotelDouble" || kind === "hotelSuite";
}

/** Height of a facility in floors (1 for ordinary single-story rooms). */
export function facilityFloors(kind: FacilityKind): number {
  return FACILITIES[kind].floors ?? 1;
}

/**
 * How long a facility takes to build, in in-game minutes. Structure goes up
 * instantly; rooms take a while (bigger/pricier → longer), like the original's
 * construction phase. Driven entirely by the global clock — no per-room timers.
 */
export function buildMinutes(kind: FacilityKind): number {
  const f = FACILITIES[kind];
  if (kind === "floor" || kind === "lobby") return 0;
  return Math.min(8 * 60, Math.round(60 + f.width * 8 + f.cost / 5000));
}

/** Opening hours by facility, shared by the economy and the renderer. */
export function isOpenAt(kind: FacilityKind, hour: number): boolean {
  switch (kind) {
    case "fastFood":
      return hour >= 7 && hour < 22;
    case "restaurant":
      return (hour >= 11 && hour < 14) || (hour >= 17 && hour < 23);
    case "shop":
      return hour >= 10 && hour < 21;
    case "cinema":
      return hour >= 12 && hour < 24;
    case "partyHall":
      return hour >= 17 && hour < 24;
    default:
      return true;
  }
}

/** Number of hours per day a venue is open (used to spread its daily take so
 * total income over a day ≈ the headline daily figure, not a per-open-hour
 * multiple of it). */
export function openHoursPerDay(kind: FacilityKind): number {
  let h = 0;
  for (let hr = 0; hr < 24; hr++) if (isOpenAt(kind, hr)) h++;
  return h || 1;
}

/** True for facilities that keep posted business hours (can be "closed"). */
export function hasBusinessHours(kind: FacilityKind): boolean {
  return (
    kind === "fastFood" ||
    kind === "restaurant" ||
    kind === "shop" ||
    kind === "cinema" ||
    kind === "partyHall"
  );
}

export function isElevatorKind(kind: FacilityKind): boolean {
  return (
    kind === "elevatorStandard" ||
    kind === "elevatorService" ||
    kind === "elevatorExpress"
  );
}

/** Passengers a single car of each transport type holds per trip. */
export const TRANSPORT_CAPACITY: Record<string, number> = {
  elevatorStandard: 21,
  elevatorService: 16,
  elevatorExpress: 33,
  escalator: 30, // continuous flow, treated as per-shaft
  stairs: 8,
};

/** Maximum cars allowed per shaft, by elevator type. */
export const MAX_CARS: Record<string, number> = {
  elevatorStandard: 8,
  elevatorService: 4,
  elevatorExpress: 8,
};

/**
 * Hard per-tower build limits, mirroring the 1994 original's caps. A kind absent
 * here is uncapped. Elevator shafts (all three kinds) share a single 24-shaft
 * pool; stairs and escalators share a 64-link pool — see {@link POOLED_CAPS}.
 */
export const BUILD_CAPS: Partial<Record<FacilityKind, number>> = {
  metro: 1,
  weddingHall: 1,
  security: 10,
  medical: 10,
  cinema: 16,
  partyHall: 16,
};

/** Pooled caps shared across several kinds (elevators, walkways). */
export const POOLED_CAPS: { kinds: FacilityKind[]; cap: number; label: string }[] = [
  { kinds: ["elevatorStandard", "elevatorService", "elevatorExpress"], cap: 24, label: "elevator shafts" },
  { kinds: ["stairs", "escalator"], cap: 64, label: "stairs/escalators" },
];

/** Maximum floors a transport may span. */
export function maxSpanFor(kind: FacilityKind): number {
  if (kind === "stairs" || kind === "escalator") return 1;
  if (kind === "elevatorExpress") return 60;
  return 30;
}
