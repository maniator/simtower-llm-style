import type { Clock } from "./Clock";
import type { Tower } from "./Tower";
import type { FacilityKind, Transport } from "./types";
import { isElevatorKind, isHotelKind } from "./facilities";
import { RNG } from "./rng";

/**
 * Individual people who actually route through the tower — SimTower's signature.
 * Each person has an origin and destination floor, a transport route worked out
 * by breadth-first search over the elevator/stair network, and a little state
 * machine: walk to the shaft, wait, ride a real car, transfer at lobbies, walk
 * to the destination. Their waiting time is the true source of tenant stress.
 *
 * This module is deliberately DOM-free so it can be unit-tested; the renderer
 * reads {@link Crowd.people} each frame and draws them. It advances on real
 * seconds (passed in by the renderer) so people move at a steady, watchable
 * pace regardless of the game-speed time compression.
 */

export type PersonState = "toShaft" | "waiting" | "riding" | "toDest" | "done";

export interface Person {
  id: number;
  seed: number;
  state: PersonState;
  /** Discrete current floor (where they're standing / boarding). */
  floor: number;
  /** Continuous floor for rendering while riding a car. */
  fy: number;
  /** Continuous tile x. */
  x: number;
  /** Per-leg transport route: floors[0]=origin … floors[n]=destination. */
  floors: number[];
  /** shaft id used for leg i (floors[i] → floors[i+1]); -1 if unreachable. */
  shafts: number[];
  leg: number;
  shaftId: number | null;
  carIndex: number | null;
  /** Tile x to stroll to on the destination floor (within built structure). */
  destX: number;
  /** Seconds spent waiting on the current call (drives stress). */
  wait: number;
  /** Total seconds in transit (origin → destination), for the give-up valve. */
  age: number;
  /** Idle timer once arrived, before despawning. */
  linger: number;
}

/** A transport route as a list of floors and the shaft used between each. */
interface Route {
  floors: number[];
  shafts: number[];
}

const WALK_SPEED = 6; // tiles per second
const CAR_CAPACITY = 6; // visible riders per car
const MAX_PEOPLE = 140;
const STRESS_WAIT = 25; // seconds of waiting that counts as "fed up"
/**
 * A commuter who hasn't reached their floor within this many real seconds gives
 * up and leaves — a safety valve so nobody is ever stranded forever (a car the
 * aggregate scheduler never sends to their floor, an elevator removed from
 * under them) silently consuming the on-screen population cap.
 */
const GIVE_UP = 90;

export class Crowd {
  people: Person[] = [];
  private rng: RNG;
  private nextId = 1;
  private spawnAcc = 0;
  /** Riders currently aboard each car, keyed "shaftId:carIndex". */
  private carRiders = new Map<string, number>();
  /** Rolling fraction of recent travellers who waited too long (0..1). */
  private frustration = 0;

  constructor(seed = 1) {
    this.rng = new RNG(seed);
  }

  reset(): void {
    this.people = [];
    this.carRiders.clear();
    this.frustration = 0;
    // Drop the partial spawn accumulator and id counter too, so a fresh sim
    // doesn't immediately spawn a backlog or grow ids without bound.
    this.spawnAcc = 0;
    this.nextId = 1;
  }

  /** 0..1 — how stressed the current crowd is by elevator waits. */
  get stress(): number {
    return this.frustration;
  }

  // ---- Routing ------------------------------------------------------------

  /** Floors a transport actually stops at. */
  private stopsOf(tower: Tower, t: Transport): number[] {
    const s: number[] = [];
    for (let f = t.bottom; f <= t.top; f++) if (tower.stopsAt(t, f)) s.push(f);
    return s;
  }

  /** BFS over the transport network for the fewest-transfer route. */
  route(tower: Tower, from: number, to: number): Route | null {
    if (from === to) return { floors: [from], shafts: [] };
    // floor -> list of {floor, shaftId} reachable in one ride.
    const adj = new Map<number, { f: number; shaft: number }[]>();
    for (const t of tower.transports) {
      // Only elevators carry our riders — they board real cars. Stairs and
      // escalators have no cars, so routing through them would strand a
      // commuter waiting forever for a car that never comes; their decorative
      // climbers cover that movement instead.
      if (!isElevatorKind(t.kind)) continue;
      const stops = this.stopsOf(tower, t);
      for (const a of stops) {
        let list = adj.get(a);
        if (!list) adj.set(a, (list = []));
        for (const b of stops) if (b !== a) list.push({ f: b, shaft: t.id });
      }
    }
    const prev = new Map<number, { f: number; shaft: number }>();
    const seen = new Set<number>([from]);
    let frontier = [from];
    while (frontier.length) {
      const next: number[] = [];
      for (const f of frontier) {
        for (const edge of adj.get(f) ?? []) {
          if (seen.has(edge.f)) continue;
          seen.add(edge.f);
          prev.set(edge.f, { f, shaft: edge.shaft });
          if (edge.f === to) {
            // Reconstruct.
            const floors = [to];
            const shafts: number[] = [];
            let cur = to;
            while (cur !== from) {
              const p = prev.get(cur)!;
              floors.push(p.f);
              shafts.push(p.shaft);
              cur = p.f;
            }
            floors.reverse();
            shafts.reverse();
            return { floors, shafts };
          }
          next.push(edge.f);
        }
      }
      frontier = next;
    }
    return null;
  }

  // ---- Spawning -----------------------------------------------------------

  private occupiedFloors(tower: Tower, pred: (kind: FacilityKind) => boolean): number[] {
    const set = new Set<number>();
    for (const u of tower.units) {
      if ((u.state === "occupied" || u.state === "asleep") && pred(u.kind)) set.add(u.floor);
    }
    return [...set];
  }

  /** Decide who travels right now, based on the time of day. */
  private spawnTrips(tower: Tower, clock: Clock): void {
    if (this.people.length >= MAX_PEOPLE) return;
    const hour = clock.hour;
    const morning = hour >= 7 && hour < 10;
    const evening = hour >= 17 && hour < 20;
    const day = hour >= 10 && hour < 17;
    const offices = this.occupiedFloors(tower, (k) => k === "office");
    const homes = this.occupiedFloors(tower, (k) => k === "condo" || isHotelKind(k));
    const venues = this.occupiedFloors(tower, (k) => k === "shop" || k === "restaurant" || k === "fastFood" || k === "cinema");

    const trip = (from: number, to: number) => this.add(tower, from, to);
    // Workers commute in and out; visitors come during the day; everyone heads
    // home in the evening. Origins/destinations are real occupied floors.
    if (morning && offices.length) trip(1, this.rng.pick(offices));
    else if (evening && offices.length) trip(this.rng.pick(offices), 1);
    else if (evening && homes.length) trip(1, this.rng.pick(homes));
    else if (day && venues.length && this.rng.chance(0.7)) trip(1, this.rng.pick(venues));
    else if (venues.length && this.rng.chance(0.3)) trip(this.rng.pick(venues), 1);
  }

  private add(tower: Tower, from: number, to: number): void {
    const r = this.route(tower, from, to);
    if (!r || r.shafts.length === 0) return; // unreachable — no point spawning
    const seed = (this.nextId * 2654435761) | 0;
    this.people.push({
      id: this.nextId++,
      seed,
      state: "toShaft",
      floor: from,
      fy: from,
      x: this.pickX(tower, from, seed),
      floors: r.floors,
      shafts: r.shafts,
      leg: 0,
      shaftId: r.shafts[0],
      carIndex: null,
      wait: 0,
      age: 0,
      linger: 0,
      destX: this.pickX(tower, to, seed),
    });
  }

  /** A tile within the built structure of a floor (so people stand on solid
   * ground, not in midair). Falls back to a sensible spot if the floor is bare. */
  private pickX(tower: Tower, floor: number, seed: number): number {
    let min = Infinity;
    let max = -Infinity;
    for (const u of tower.units) {
      if ((u.kind === "floor" || u.kind === "lobby") && u.floor === floor) {
        if (u.x < min) min = u.x;
        if (u.x + u.width - 1 > max) max = u.x + u.width - 1;
      }
    }
    if (min === Infinity) return 2 + (Math.abs(seed) % 40);
    return min + (Math.abs(seed) % (max - min + 1));
  }

  // ---- Per-frame update ---------------------------------------------------

  update(dtSec: number, tower: Tower, clock: Clock): void {
    // Spawn at a rate that scales with how busy the hour is.
    const rate = clock.isNight() ? 0.3 : clock.isWeekend ? 1.2 : 2.2;
    this.spawnAcc += dtSec * rate;
    let guard = 0;
    while (this.spawnAcc >= 1 && guard++ < 8) {
      this.spawnAcc -= 1;
      this.spawnTrips(tower, clock);
    }

    let frustrated = 0;
    let travelling = 0;
    for (const p of this.people) {
      p.age += dtSec;
      // Give up if the journey drags on too long — a fed-up traveller who
      // leaves rather than riding forever toward a floor no car will serve.
      if (p.age > GIVE_UP && p.state !== "toDest" && p.state !== "done") {
        frustrated++;
        travelling++;
        this.finish(p);
        continue;
      }
      this.step(p, dtSec, tower);
      if (p.state === "waiting" || p.state === "riding" || p.state === "toShaft") {
        travelling++;
        if (p.wait > STRESS_WAIT) frustrated++;
      }
    }
    // Smooth the frustration signal the sim reads for satisfaction.
    const target = travelling > 0 ? frustrated / travelling : 0;
    this.frustration += (target - this.frustration) * Math.min(1, dtSec * 0.5);

    this.people = this.people.filter((p) => p.state !== "done");
  }

  private shaftOf(tower: Tower, id: number | null): Transport | undefined {
    return id == null ? undefined : tower.transports.find((t) => t.id === id);
  }

  private step(p: Person, dt: number, tower: Tower): void {
    switch (p.state) {
      case "toShaft": {
        const shaft = this.shaftOf(tower, p.shaftId);
        if (!shaft) return this.finish(p);
        const targetX = shaft.x + shaft.width / 2;
        if (this.walkTo(p, targetX, dt)) {
          p.state = "waiting";
          p.wait = 0;
        }
        break;
      }
      case "waiting": {
        p.wait += dt;
        const shaft = this.shaftOf(tower, p.shaftId);
        if (!shaft) return this.finish(p);
        // Board a car of this shaft that's stopped at our floor with room.
        for (let i = 0; i < shaft.cars; i++) {
          if (Math.abs(shaft.carPositions[i] - p.floor) > 0.25) continue;
          const key = `${shaft.id}:${i}`;
          const n = this.carRiders.get(key) ?? 0;
          if (n >= CAR_CAPACITY) continue;
          this.carRiders.set(key, n + 1);
          p.carIndex = i;
          p.state = "riding";
          break;
        }
        break;
      }
      case "riding": {
        const shaft = this.shaftOf(tower, p.shaftId);
        // The car can vanish from under a rider — the shaft bulldozed, or the
        // player trimming the car count (Tower.setCars shrinks carPositions).
        // Either way, step off and move on rather than riding a phantom car.
        if (!shaft || p.carIndex == null || p.carIndex >= shaft.carPositions.length) {
          return this.finish(p);
        }
        const pos = shaft.carPositions[p.carIndex];
        p.fy = pos;
        p.x = shaft.x + shaft.width / 2;
        const dest = p.floors[p.leg + 1];
        if (Math.abs(pos - dest) < 0.2) {
          // Arrived at this leg's floor — step off.
          this.releaseSeat(p);
          p.floor = dest;
          p.fy = dest;
          p.leg++;
          if (p.leg >= p.shafts.length) {
            p.state = "toDest";
          } else {
            p.shaftId = p.shafts[p.leg];
            p.state = "toShaft";
          }
        }
        break;
      }
      case "toDest": {
        // Stroll to a spot on the destination floor, linger, then leave.
        if (this.walkTo(p, p.destX, dt)) {
          p.linger += dt;
          if (p.linger > 2) this.finish(p);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Walk toward a tile x on the current floor; returns true once arrived. */
  private walkTo(p: Person, targetX: number, dt: number): boolean {
    const dx = targetX - p.x;
    const step = WALK_SPEED * dt;
    if (Math.abs(dx) <= step) {
      p.x = targetX;
      return true;
    }
    p.x += Math.sign(dx) * step;
    return false;
  }

  /** Free this person's seat in their current car (if aboard), so bulldozing
   * a shaft mid-ride never leaks rider counts and shrinks a car's capacity. */
  private releaseSeat(p: Person): void {
    if (p.carIndex == null || p.shaftId == null) return;
    const key = `${p.shaftId}:${p.carIndex}`;
    this.carRiders.set(key, Math.max(0, (this.carRiders.get(key) ?? 1) - 1));
    p.carIndex = null;
  }

  private finish(p: Person): void {
    this.releaseSeat(p);
    p.state = "done";
  }
}
