import { FACILITIES, GRID, MAX_CARS, isElevatorKind } from "./facilities";
import type {
  Facility,
  FacilityKind,
  PlaceResult,
  Transport,
  Unit,
} from "./types";

/** Structural kinds form the floor/corridor layer that rooms sit upon. */
function isStructural(kind: FacilityKind): boolean {
  return kind === "floor" || kind === "lobby";
}

/**
 * The Tower owns the spatial model. Cells have two layers: a structural layer
 * (floor / lobby tiles) and a room layer (offices, shops, …). A room is built
 * on top of existing structure, sharing the same cell — exactly like the
 * original game, where rooms line a corridor.
 */
export class Tower {
  units: Unit[] = [];
  transports: Transport[] = [];
  private nextId = 1;
  towerName = "Tower One";
  builtWeddingHall = false;
  /** Bumped whenever units/transports are added or removed (render caching). */
  revision = 0;

  /** "floor:x" -> structural unit id (floor/lobby). */
  private structure = new Map<string, number>();
  /** "floor:x" -> room unit id. */
  private rooms = new Map<string, number>();

  private key(floor: number, x: number): string {
    return `${floor}:${x}`;
  }

  /** Room occupying a tile, else the structural tile, else undefined. */
  unitAt(floor: number, x: number): Unit | undefined {
    const k = this.key(floor, x);
    const rid = this.rooms.get(k);
    if (rid !== undefined) return this.units.find((u) => u.id === rid);
    const sid = this.structure.get(k);
    if (sid !== undefined) return this.units.find((u) => u.id === sid);
    return undefined;
  }

  /** The room (non-structural) at a tile, if any. */
  roomAt(floor: number, x: number): Unit | undefined {
    const rid = this.rooms.get(this.key(floor, x));
    return rid === undefined ? undefined : this.units.find((u) => u.id === rid);
  }

  hasStructure(floor: number, x: number): boolean {
    return this.structure.has(this.key(floor, x));
  }

  occupiedFloors(): number[] {
    const set = new Set<number>();
    for (const u of this.units) set.add(u.floor);
    return [...set].sort((a, b) => a - b);
  }

  get highestFloor(): number {
    let h = 1;
    for (const u of this.units) if (u.floor > h) h = u.floor;
    return h;
  }

  get lowestFloor(): number {
    let l = 1;
    for (const u of this.units) if (u.floor < l) l = u.floor;
    return l;
  }

  /** True if no room occupies any tile of the span. */
  private roomSpanFree(floor: number, x: number, width: number): boolean {
    for (let i = 0; i < width; i++) {
      if (this.rooms.has(this.key(floor, x + i))) return false;
    }
    return true;
  }

  /** True if no structure occupies any tile of the span. */
  private structureSpanFree(floor: number, x: number, width: number): boolean {
    for (let i = 0; i < width; i++) {
      if (this.structure.has(this.key(floor, x + i))) return false;
    }
    return true;
  }

  /** True if structural floor exists across the whole span. */
  spanHasFloor(floor: number, x: number, width: number): boolean {
    for (let i = 0; i < width; i++) {
      if (!this.structure.has(this.key(floor, x + i))) return false;
    }
    return true;
  }

  private register(unit: Unit): void {
    const map = isStructural(unit.kind) ? this.structure : this.rooms;
    for (let i = 0; i < unit.width; i++) {
      map.set(this.key(unit.floor, unit.x + i), unit.id);
    }
  }

  private unregister(unit: Unit): void {
    const map = isStructural(unit.kind) ? this.structure : this.rooms;
    for (let i = 0; i < unit.width; i++) {
      map.delete(this.key(unit.floor, unit.x + i));
    }
  }

  reindex(): void {
    this.structure.clear();
    this.rooms.clear();
    for (const u of this.units) this.register(u);
    this.revision++;
  }

  canPlace(kind: FacilityKind, floor: number, x: number): PlaceResult {
    const f = FACILITIES[kind];
    if (floor < GRID.minFloor || floor > GRID.maxFloor) {
      return { ok: false, reason: "Outside the buildable range." };
    }
    if (x < 0 || x + f.width > GRID.width) {
      return { ok: false, reason: "Off the edge of the lot." };
    }
    if (f.transport) {
      return { ok: false, reason: "Use placeTransport for vertical transport." };
    }

    if (isStructural(kind)) {
      if (!this.structureSpanFree(floor, x, f.width)) {
        return { ok: false, reason: "Structure already here." };
      }
      if (!this.isSupported(floor, x, f.width)) {
        return { ok: false, reason: "Floors must connect to the existing tower." };
      }
      return { ok: true };
    }

    if (kind === "weddingHall" && floor !== GRID.maxFloor) {
      return { ok: false, reason: "The wedding hall can only crown floor 100." };
    }

    if (!this.roomSpanFree(floor, x, f.width)) {
      return { ok: false, reason: "Something is already here." };
    }
    if (!this.spanHasFloor(floor, x, f.width)) {
      return { ok: false, reason: "Build a floor here first." };
    }
    return { ok: true };
  }

  /** Floors connect if adjacent to existing structure, above/below it, or first. */
  private isSupported(floor: number, x: number, width: number): boolean {
    if (this.units.length === 0) {
      return floor === 1; // the founding strip must be the ground floor
    }
    for (let i = -1; i <= width; i++) {
      if (this.structure.has(this.key(floor, x + i))) return true;
    }
    for (let i = 0; i < width; i++) {
      if (
        this.structure.has(this.key(floor - 1, x + i)) ||
        this.structure.has(this.key(floor + 1, x + i))
      ) {
        return true;
      }
    }
    return false;
  }

  place(kind: FacilityKind, floor: number, x: number): PlaceResult {
    const check = this.canPlace(kind, floor, x);
    if (!check.ok) return check;
    const f = FACILITIES[kind];
    const unit: Unit = {
      id: this.nextId++,
      kind,
      floor,
      x,
      width: f.width,
      state: "empty",
      satisfaction: 1,
      occupants: 0,
      everOccupied: false,
      pendingIncome: 0,
      label: f.name,
    };
    this.units.push(unit);
    this.register(unit);
    if (kind === "weddingHall") this.builtWeddingHall = true;
    this.revision++;
    return { ok: true, unitId: unit.id };
  }

  /** Validate a transport placement without mutating anything. */
  validateTransport(kind: FacilityKind, x: number, bottom: number, top: number): PlaceResult {
    const f = FACILITIES[kind];
    if (!f.transport) return { ok: false, reason: "Not a transport." };
    if (top <= bottom) return { ok: false, reason: "Transport needs height." };
    if (x < 0 || x + f.width > GRID.width) {
      return { ok: false, reason: "Off the edge of the lot." };
    }
    const span = top - bottom;
    if ((kind === "stairs" || kind === "escalator") && span > 1) {
      return { ok: false, reason: `${f.name} spans exactly one floor.` };
    }
    const maxSpan = kind === "elevatorExpress" ? 60 : 30;
    if (isElevatorKind(kind) && span > maxSpan) {
      return { ok: false, reason: `This elevator serves at most ${maxSpan} floors.` };
    }

    // Transports share the structural column but cannot collide with rooms or
    // other shafts — and every floor they serve must actually exist as built
    // structure at the shaft, so elevators can never float outside the tower.
    for (let fl = bottom; fl <= top; fl++) {
      let hasStructure = false;
      for (let i = 0; i < f.width; i++) {
        if (this.rooms.has(this.key(fl, x + i))) {
          return { ok: false, reason: "Transport would collide with a room." };
        }
        if (this.structure.has(this.key(fl, x + i))) hasStructure = true;
      }
      if (!hasStructure) {
        return {
          ok: false,
          reason: "Transport must run through built floors — lay floors first.",
        };
      }
      for (const t of this.transports) {
        if (this.transportOverlaps(t, x, f.width, fl)) {
          return { ok: false, reason: "Transport shafts cannot overlap." };
        }
      }
    }
    return { ok: true };
  }

  /** Convenience boolean dry-run for previews. */
  placeTransportDryRun(kind: FacilityKind, x: number, bottom: number, top: number): boolean {
    return this.validateTransport(kind, x, bottom, top).ok;
  }

  placeTransport(
    kind: FacilityKind,
    x: number,
    bottom: number,
    top: number,
  ): PlaceResult {
    const valid = this.validateTransport(kind, x, bottom, top);
    if (!valid.ok) return valid;
    const f = FACILITIES[kind];
    const span = top - bottom;
    const cars = isElevatorKind(kind) ? Math.min(8, Math.max(1, Math.ceil(span / 6))) : 0;
    const t: Transport = {
      id: this.nextId++,
      kind,
      x,
      width: f.width,
      bottom,
      top,
      cars,
      carPositions: Array.from({ length: cars }, (_, i) => bottom + i),
      carDir: Array.from({ length: cars }, () => 0),
      load: 0,
    };
    this.transports.push(t);
    this.revision++;
    return { ok: true, transportId: t.id };
  }

  private transportOverlaps(t: Transport, x: number, width: number, floor: number): boolean {
    if (floor < t.bottom || floor > t.top) return false;
    return x < t.x + t.width && x + width > t.x;
  }

  removeUnit(id: number): Unit | undefined {
    const idx = this.units.findIndex((u) => u.id === id);
    if (idx === -1) return undefined;
    const [u] = this.units.splice(idx, 1);
    this.unregister(u);
    if (u.kind === "weddingHall") this.builtWeddingHall = false;
    this.revision++;
    return u;
  }

  /**
   * Grow or shrink a transport's served range. Returns the number of floors
   * added (negative if removed) on success, or a failure reason. Newly served
   * floors are validated against rooms and other shafts.
   */
  resizeTransport(id: number, newBottom: number, newTop: number): PlaceResult & { added?: number } {
    const t = this.transports.find((x) => x.id === id);
    if (!t) return { ok: false, reason: "No such transport." };
    if (newTop <= newBottom) return { ok: false, reason: "Transport needs height." };
    if (newBottom < GRID.minFloor || newTop > GRID.maxFloor) {
      return { ok: false, reason: "Outside the buildable range." };
    }
    const maxSpan = t.kind === "elevatorExpress" ? 60 : 30;
    if (isElevatorKind(t.kind) && newTop - newBottom > maxSpan) {
      return { ok: false, reason: `This elevator serves at most ${maxSpan} floors.` };
    }
    // Validate only the floors that are being newly added.
    for (let fl = newBottom; fl <= newTop; fl++) {
      if (fl >= t.bottom && fl <= t.top) continue; // already served
      for (let i = 0; i < t.width; i++) {
        if (this.rooms.has(this.key(fl, t.x + i))) {
          return { ok: false, reason: "A room blocks that floor." };
        }
      }
      for (const other of this.transports) {
        if (other.id === t.id) continue;
        if (this.transportOverlaps(other, t.x, t.width, fl)) {
          return { ok: false, reason: "Another shaft is in the way." };
        }
      }
    }
    const before = t.top - t.bottom + 1;
    t.bottom = newBottom;
    t.top = newTop;
    // Keep cars within the new range.
    for (let i = 0; i < t.carPositions.length; i++) {
      t.carPositions[i] = Math.max(newBottom, Math.min(newTop, t.carPositions[i]));
    }
    this.revision++;
    return { ok: true, added: newTop - newBottom + 1 - before };
  }

  /** Change the number of elevator cars (1..max for that elevator type). */
  setCars(id: number, cars: number): boolean {
    const t = this.transports.find((x) => x.id === id);
    if (!t || !isElevatorKind(t.kind)) return false;
    cars = Math.max(1, Math.min(MAX_CARS[t.kind] ?? 8, cars));
    if (cars === t.cars) return false;
    if (cars > t.cars) {
      for (let i = t.cars; i < cars; i++) {
        t.carPositions.push(t.bottom);
        t.carDir.push(1);
      }
    } else {
      t.carPositions.length = cars;
      t.carDir.length = cars;
    }
    t.cars = cars;
    this.revision++;
    return true;
  }

  /** Floors that have at least one lobby tile (express stops). */
  lobbyFloors(): number[] {
    const set = new Set<number>();
    for (const u of this.units) if (u.kind === "lobby") set.add(u.floor);
    return [...set].sort((a, b) => a - b);
  }

  /** Toggle whether a transport stops at a floor (express configuration). */
  setStop(id: number, floor: number, stop: boolean): boolean {
    const t = this.transports.find((x) => x.id === id);
    if (!t || floor < t.bottom || floor > t.top) return false;
    const skip = new Set(t.skipFloors ?? []);
    if (stop) skip.delete(floor);
    else skip.add(floor);
    t.skipFloors = [...skip].sort((a, b) => a - b);
    this.revision++;
    return true;
  }

  /** Configure an elevator to stop only at lobby floors (true express). */
  setExpressStops(id: number): boolean {
    const t = this.transports.find((x) => x.id === id);
    if (!t) return false;
    const lobbies = new Set(this.lobbyFloors());
    const skip: number[] = [];
    for (let fl = t.bottom; fl <= t.top; fl++) {
      // Always keep the bottom and top as stops so it stays connected.
      if (fl === t.bottom || fl === t.top) continue;
      if (!lobbies.has(fl)) skip.push(fl);
    }
    t.skipFloors = skip;
    this.revision++;
    return true;
  }

  /** Make a transport stop at every floor again. */
  clearStops(id: number): boolean {
    const t = this.transports.find((x) => x.id === id);
    if (!t) return false;
    t.skipFloors = [];
    this.revision++;
    return true;
  }

  removeTransport(id: number): Transport | undefined {
    const idx = this.transports.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    const [t] = this.transports.splice(idx, 1);
    this.revision++;
    return t;
  }

  transportAt(floor: number, x: number): Transport | undefined {
    return this.transports.find(
      (t) => floor >= t.bottom && floor <= t.top && x >= t.x && x < t.x + t.width,
    );
  }

  /** Does this transport actually stop at the given floor (vs. skip it)? */
  stopsAt(t: Transport, floor: number): boolean {
    if (floor < t.bottom || floor > t.top) return false;
    return !(t.skipFloors && t.skipFloors.includes(floor));
  }

  /**
   * A floor is "served" if a chain of transports connects it to the ground
   * lobby (floor 1). Transports link via the floors they actually STOP at, so
   * an express that skips a floor does not serve it (it only passes through).
   */
  isFloorServed(floor: number): boolean {
    if (floor === 1) return true;
    const reachable = new Set<number>([1]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of this.transports) {
        let connects = false;
        for (let fl = t.bottom; fl <= t.top; fl++) {
          if (this.stopsAt(t, fl) && reachable.has(fl)) {
            connects = true;
            break;
          }
        }
        if (connects) {
          for (let fl = t.bottom; fl <= t.top; fl++) {
            if (this.stopsAt(t, fl) && !reachable.has(fl)) {
              reachable.add(fl);
              changed = true;
            }
          }
        }
      }
    }
    return reachable.has(floor);
  }

  facilityOf(unit: Unit): Facility {
    return FACILITIES[unit.kind];
  }

  totalPopulation(): number {
    let pop = 0;
    for (const u of this.units) {
      if (u.state === "occupied" || u.state === "asleep" || u.state === "moving_in") {
        pop += FACILITIES[u.kind].population;
      }
    }
    return pop;
  }

  allocateId(): number {
    return this.nextId++;
  }

  setNextId(n: number): void {
    this.nextId = n;
  }

  getNextId(): number {
    return this.nextId;
  }
}
