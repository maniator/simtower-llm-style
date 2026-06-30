/**
 * Core type definitions for the SimTower clone engine.
 *
 * The tower is modelled as a grid of cells. Each floor is a row; columns are
 * "tiles". A facility occupies a contiguous run of tiles on a single floor.
 */

/** Cosmetic sky weather, derived deterministically from the day. */
export type WeatherKind = "clear" | "cloudy" | "rain";

/** Category groups used for the build toolbar and evaluation rules. */
export type FacilityCategory =
  | "structure"
  | "transport"
  | "office"
  | "residential"
  | "hotel"
  | "food"
  | "retail"
  | "entertainment"
  | "service"
  | "special";

/** Every buildable facility kind. */
export type FacilityKind =
  | "lobby"
  | "floor"
  | "office"
  | "condo"
  | "hotelSingle"
  | "hotelDouble"
  | "hotelSuite"
  | "fastFood"
  | "restaurant"
  | "shop"
  | "cinema"
  | "partyHall"
  | "stairs"
  | "escalator"
  | "elevatorStandard"
  | "elevatorService"
  | "elevatorExpress"
  | "parking"
  | "security"
  | "medical"
  | "housekeeping"
  | "recycling"
  | "metro"
  | "weddingHall";

/** Occupancy / activity state of a unit. */
export type UnitState =
  | "construction" // under construction, not yet usable
  | "empty" // built, awaiting a tenant
  | "occupied" // has a tenant / in service
  | "moving_in"
  | "vacating" // tenant leaving due to dissatisfaction
  | "asleep" // hotel room with sleeping guest (night)
  | "dirty" // hotel room awaiting housekeeping after checkout
  | "fire"; // unit ablaze during a fire emergency

export interface Facility {
  kind: FacilityKind;
  category: FacilityCategory;
  name: string;
  /** Width in tiles. */
  width: number;
  /** Height in floors (1 unless the facility spans several stories). */
  floors?: number;
  /** Build cost in dollars. */
  cost: number;
  /** Star rating required to unlock (1..5). */
  minStar: number;
  /** Population this facility contributes when fully occupied. */
  population: number;
  /** Hex color used by the procedural sprite renderer. */
  color: string;
  /** True for vertical transport (occupies multiple floors). */
  transport?: boolean;
  /** True if the facility may only be built underground (basement floors). */
  basement?: boolean;
  description: string;
}

/** A placed facility instance in the tower. */
export interface Unit {
  id: number;
  kind: FacilityKind;
  floor: number;
  /** Left-most tile column. */
  x: number;
  width: number;
  state: UnitState;
  /** 0..1 satisfaction; low values cause tenants to leave. */
  satisfaction: number;
  /** Current number of occupants present right now. */
  occupants: number;
  /** Whether this unit has ever been rented/sold (for one-time income). */
  everOccupied: boolean;
  /** Accumulated income not yet collected (offices/condos). */
  pendingIncome: number;
  /** Name shown when inspected (e.g. tenant company / guest). */
  label: string;
  /** Game-clock minute at which construction finishes (for the build phase). */
  completeAt?: number;
}

/** A vertical transport instance (elevator shaft / stairs / escalator). */
export interface Transport {
  id: number;
  kind: FacilityKind;
  x: number;
  width: number;
  /** Lowest floor served (inclusive). */
  bottom: number;
  /** Highest floor served (inclusive). */
  top: number;
  /** Number of cars (elevators only). */
  cars: number;
  /** Animated car positions (continuous floor value) for rendering. */
  carPositions: number[];
  /** Direction of each car: -1 down, 0 idle, 1 up. */
  carDir: number[];
  /** Passengers currently aboard each car (for rendering riders). */
  carLoad?: number[];
  /** Number of riders currently in transit through this transport. */
  load: number;
  /** Floors this transport is configured NOT to stop at (express service). */
  skipFloors?: number[];
}

export interface SerializedGame {
  version: number;
  seed: number;
  money: number;
  star: number;
  minutes: number;
  units: Unit[];
  transports: Transport[];
  nextId: number;
  towerName: string;
  builtWeddingHall: boolean;
  evaluatedTower: boolean;
  /** Scheduled day of the pending VIP inspection (-1 if none). Optional for
   * backward compatibility with saves written before it was persisted. */
  vipVisitDay?: number;
}

/** Result of attempting to place a facility. */
export interface PlaceResult {
  ok: boolean;
  reason?: string;
  unitId?: number;
  transportId?: number;
}
