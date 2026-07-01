---
title: "Technical Design — The Legibility Pass"
author: Cloud Dragonborn (Game Architect — BMAD gds agent)
date: 2026-07-01
status: Approved-for-build
implements: GDD recommendations #2 (≤2-ride) and #3 (silent hotel/parking rules)
---


# Technical Design — The Legibility Pass

**Cloud Dragonborn, Game Architect.** Grounded in `_bmad-output/project-context.md`, the GDD, and the current code. This design surfaces three already-computed truths (≤2-ride reachability, hotel-at-3★ rating drop-out, dead parking) through the inspector, the Stats modal, one canvas glyph, and one throttled log line. **No simulated value changes; parity/balance tests must stay green.**

## 0. The load-bearing constraint I verified first

`sim.stats()` is **not** modal-only — it runs on every HUD refresh (`src/ui/UI.ts:394`, inside `update()`), which main.ts drives at ~6 Hz (`src/main.ts:280`, throttled to 160 ms). Therefore **no BFS/route call may live inside `stats()`**. The stranded-floors query (which calls `Crowd.route`) runs only on (a) Stats-modal open and (b) once per in-game day for the log nudge. `stats()` gets only O(units)/cached fields. This is the single most important rule of the implementation and drives every placement below.

---

## 1. Engine signals (new / refactored)

### 1a. `Tower.functionalParkingSet(): ReadonlySet<number>` — expose the SET, not just the count
`Tower.functionalParkingSpots()` (`src/engine/Tower.ts:675`) already builds the `reached` set of ramp-chained parking-unit ids, then throws it away returning `reached.size`. Refactor:

- Extract the flood-fill into `functionalParkingSet(): ReadonlySet<number>`. **CORRECTION (review):** do NOT memoise by `this.revision` — the set depends on `unit.state` (construction/fire), and those transitions (`finishConstruction`, the fire handlers) mutate `state` WITHOUT bumping `revision`, so a revision cache goes stale (dead-X on working parking; economy relief withheld). Recompute fresh each call — the flood-fill is O(region) with O(1) `roomAt`, cheap enough for every caller.
- Keep `functionalParkingSpots()` as a one-liner: `return this.functionalParkingSet().size;` — every existing caller (economy relief, tests) is unchanged.

This one set feeds all three parking consumers: inspector membership (`set.has(u.id)`), the canvas red X, and the stats "working/total" row. It is recomputed fresh (no cache — see correction above); the render path reads it ONCE per sync and threads the result into `addRoom` so a rebake doesn't recompute per unit.

### 1b. `Simulation.floorReachable(floor: number): boolean` — the per-object ≤2-ride truth
Thin, self-documenting wrapper so `main.ts` never reaches into crowd internals and the semantics live next to `Tower.isFloorServed`:
```ts
/** True when a commuter can actually reach `floor` from the ground lobby in
 *  ≤2 transport rides (Crowd.route cap). A floor can be isFloorServed() yet
 *  return false here — connected but 3+ rides out, so no commuter ever spawns. */
floorReachable(floor: number): boolean {
  if (floor === 1) return true;
  return this.crowd.route(this.tower, 1, floor) !== null;
}
```
`this.crowd` is already `readonly` and public (`Simulation.ts:107`); `route()` caches its adjacency by `tower.revision` (`Crowd.ts:114`), so an inspect-time call is effectively free.

### 1c. `Simulation.strandedFloors(): number[]` — the tower-wide roll-up (NOT in stats())
Mirror `milestones.ts:everyOccupiedFloorServed` (`src/engine/milestones.ts:24`), tightened from "served" to "reachable":
```ts
/** Above-ground floors carrying an occupied/asleep, population-bearing tenant
 *  that are isFloorServed() but NOT ≤2-ride reachable. BFS-bearing — call only
 *  on modal-open or once/day, never on the HUD/tick path. */
strandedFloors(): number[] {
  const out = new Set<number>();
  for (const u of this.tower.units) {
    if (u.floor < 2) continue;                                   // above ground only
    if (u.state !== "occupied" && u.state !== "asleep") continue;
    if (FACILITIES[u.kind].population === 0 && !isHotelKind(u.kind)) continue; // real tenants only
    if (!this.tower.isFloorServed(u.floor)) continue;            // "not connected" is a different state
    if (this.floorReachable(u.floor)) continue;                  // reachable → fine
    out.add(u.floor);
  }
  return [...out].sort((a, b) => a - b);
}
```
Predicate parity note: it uses the *same* tenant/floor filter as the milestone check (which is why "not connected" floors are excluded here — they fail `isFloorServed` and are reported by the inspector's own "not connected" state, not double-counted as "stranded"). Consider extracting the shared `(u) => above-ground && occupied/asleep && population-bearing` predicate into a small exported helper in `milestones.ts` (e.g. `isTenantFloorUnit(u)`) and using it in both places, so the two definitions can never drift.

### 1d. Rating-counts helper — trivial, no BFS
The hotel-at-3★ rule is pure state. Add a one-liner so the inspector reads intention, not a magic `star < 3`:
```ts
/** Whether hotel guests currently count toward the star rating (they stop at 3★). */
hotelsCountTowardRating(): boolean { return this.star < 3; }
```
`ratingPopulation()` (`Simulation.ts:854`) and the `population` getter (`Simulation.ts:976`) already exist for the Stats divergence line.

### 1e. `stats()` additions — cheap fields only
Extend the object returned by `Simulation.stats()` (`Simulation.ts:985`) with **only O(units)/cached** values:
- `parkingSpaces` — count of `u.kind === "parking"` units (add to the existing single loop).
- `parkingWorking` — `this.tower.functionalParkingSet().size` (per-revision cached).
- `ratingPopulation` — `this.ratingPopulation()` (O(units), no BFS).

**Do not** add `strandedFloors` here. The HUD (`UI.ts:394`) ignores the new fields; only `buildStatsHtml` reads them plus a direct `strandedFloors()` call made at modal-build time.

---

## 2. Where they hook

### 2a. Inspector — `main.ts inspectPicked` (~L806), the primary surface
Currently emits `Served by elevator: ${served}` (Yes/No) at `main.ts:820,827`. Replace with a 3-state **Access** line, computed once per click:
```ts
const served = this.sim.tower.isFloorServed(u.floor);
const access = !served
  ? `<div style="color:var(--bad)">Access: not connected — no elevator or stair reaches this floor.</div>`
  : this.sim.floorReachable(u.floor)
  ? `<div style="color:var(--good)">Access: reachable (≤2 rides from the lobby).</div>`
  : `<div style="color:var(--bad)">Access: too far — 3+ rides from the lobby, so no one travels here. Add a sky-lobby transfer.</div>`;
```
Two more conditional lines in the same `unit` branch, reusing existing `isHotelKind`/`FACILITIES` imports (`main.ts:2`):
- **Hotel units** (`isHotelKind(u.kind)`): `this.sim.hotelsCountTowardRating()` → `"Counts toward next star: yes."` (`--good`) else `"Counts toward stars: no — hotel guests stop counting at 3★ (they still earn income)."` (`--bad`).
- **Parking spaces** (`u.kind === "parking"`): `this.sim.tower.functionalParkingSet().has(u.id)` → `"Ramp access: connected."` (`--good`) else `"Ramp access: none — this space is dead (no relief). Chain it to a Parking Ramp."` (`--bad`). Parking **ramps** (`u.kind === "parkingRamp"`) get no extra line (spec §3, Fix 2).

Access line applies to real tenant/venue units; it's harmless on a served utility floor (shows "reachable"). If we want to match spec restraint exactly, gate the "too far/not connected" wording to population-bearing kinds and keep "reachable" otherwise — a one-line `if`. No new colours; only `var(--good)`/`var(--bad)` per the restraint contract.

### 2b. Stats modal — `main.ts buildStatsHtml` (~L659)
`const s = this.sim.stats();` is already fetched at `main.ts:660`. Add:

**Overview — divergent population line** (spec §2 Fix 2), shown only when `s.star >= 3 && s.ratingPopulation < s.population`:
```
Counts toward stars   5,900
```
plus one `var(--muted)` sub-row "Hotel guests count toward your star rating only until 3★." Below 3★ or when equal → render nothing (screenshot-stable).

**Transport section** (spec §1 roll-up) — compute `const stranded = this.sim.strandedFloors().length;` **here, at modal-build time only**:
```
Stranded floors   N        // var(--bad) when N>0; "None" in var(--good) when 0
```
with the muted sub-line only when `N > 0`: "Leased floors that are 3+ rides from the lobby — they earn rating credit but draw no visitors. Add a sky-lobby transfer."

**Parking row** (spec §3 Fix 3) — **omit entirely when `s.parkingSpaces === 0`** (no false alarm for garage-less towers):
```
Parking spaces   12 / 20 working   // shortfall in var(--bad) when parkingWorking < parkingSpaces
```
All rows reuse the existing `stats-grid` / `k`/`v` markup — no new components.

### 2c. Canvas red X — `TowerEngine.syncScene` (`src/render/excalibur/TowerEngine.ts:768`)
The X must be **static** (change only on build/bulldoze) to keep settled-tower screenshots byte-stable. `syncScene` already re-bakes room actors via a per-unit signature (`TowerEngine.ts:785`) and runs on `structuralChanged` (`revision !== builtRev`, L360) plus lighting/hour flips. Hook there:

1. Once per `syncScene` call, grab `const deadParking = this.sim.tower.functionalParkingSet();` (cached; O(1) after first call/revision).
2. Extend the room signature with a dead-parking bit so the sprite re-bakes exactly when connectivity flips:
   `const dead = u.kind === "parking" && !deadParking.has(u.id) ? "x" : "";` appended to the existing `sig`.
3. In `addRoom` (`TowerEngine.ts:849`), after `drawUnit(...)`, if the unit is dead parking draw a flat red X (two strokes, `var(--bad)` `#C24A3A` to match the existing fed-up figure colour at `TowerEngine.ts:763`) in the per-unit `ex.Canvas` draw callback. No glow, no animation, `cache: true` stays true.

Because deadness only changes with `revision`, the X never re-bakes on the tick/lighting loop and never churns a screenshot of a settled tower. This is the *only* new persistent world-space mark (canon).

### 2d. Throttled log nudge — `Simulation.onDay` (`Simulation.ts:417`)
One-time, edge-triggered, log-only (never a toast — toasts are reserved for player actions). Add a private latch `private strandedNudged = false;` and, at the end of `onDay()`:
```ts
const stranded = this.strandedFloors().length > 0;
if (stranded && !this.strandedNudged) {
  this.emit("A leased floor is 3+ elevator rides from the lobby — no visitors will come. Check it in the inspector.", "bad");
}
this.strandedNudged = stranded;   // re-arms only after the condition clears
```
`strandedFloors()` runs once per in-game day here — bounded, off the render path. The latch de-dupes so it can't repeat while the condition persists, and re-fires only after a 0→>0 crossing. `emit` already caps the log at 200 and feeds the existing scrolling bulletin (`Simulation.ts:181`). Persist `strandedNudged`? It's advisory only; leaving it transient (re-nudges once after load if still stranded) is acceptable and simpler — call out in the story so the dev/owner can decide.

---

## 3. Determinism & performance

- **Route is BFS, already bounded and cached.** `MAX_RIDES = 2` (`Crowd.ts:143`) bounds each search to two frontier expansions; adjacency is memoized by `tower.revision` (`Crowd.ts:114-131`). No new caching needed.
- **Nothing BFS-bearing on the 6 Hz / tick path.** `floorReachable` → inspector (per click). `strandedFloors` → modal-open + once/day. `stats()` stays route-free (§1e). This is the design's hard line.
- **Parking set recomputed fresh** (§1a; the revision cache was a review-caught bug) — cheap (O(region), O(1) `roomAt`); `syncScene` reads it once per sync, not per unit.
- **Determinism unchanged.** Every added method is a pure read over existing state; none writes a simulated value, touches `rng.ts`, or runs in `tick()`. Parity (`parity.test.ts`), balance, and the seeded crowd are untouched — satisfies GDD restraint and acceptance criterion #5.
- **Screenshot stability.** No new always-on chrome; the red X is revision-static; Stats/inspector lines are pull-only. A healthy tower renders identically to pre-pass (acceptance #4).

---

## 4. Vitest test plan

New/extended specs alongside the existing suite (`src/tests/`):

**`tower.test.ts` — `functionalParkingSet`**
1. Ramp + contiguous spaces → set contains all chained space ids; `functionalParkingSpots() === set.size` (delegation invariant).
2. Space with no ramp chain → its id absent from the set (the "dead X" case).
3. Two stacked spaces with no ramp between → not connected (vertical step only through a ramp).
4. Memoization: same set instance/contents across calls until a build bumps `revision`.

**`crowd.test.ts` / `simulation.test.ts` — reachability**
5. `floorReachable(1) === true` always.
6. Served-but-3+-rides floor: `isFloorServed(f) === true` **and** `floorReachable(f) === false` (the "too far" state — the pass's core case). Add a sky-lobby transfer → `floorReachable(f)` flips to `true` (acceptance #1).
7. `strandedFloors()` returns exactly that floor; excludes (a) floors with no tenant, (b) not-connected floors, (c) below-ground floors, (d) reachable floors. Empty on a well-built tower.

**`simulation.test.ts` — rating & stats**
8. `hotelsCountTowardRating()` true below 3★, false at ≥3★.
9. At ≥3★ with hotels present, `ratingPopulation() < population`; below 3★ they're equal (guards the divergent-line trigger, acceptance #2).
10. `stats()` exposes `parkingSpaces`, `parkingWorking`, `ratingPopulation` with correct values; `parkingSpaces === 0` for a garage-less tower (drives the omit-row restraint).

**`simulation.test.ts` — log nudge (edge-trigger)**
11. Building a stranded floor then running `onDay` once emits exactly one "3+ elevator rides" log line; a second `onDay` with the condition still true emits **no** duplicate; clearing then re-creating the condition re-fires once.

**Parity guard**
12. Add/confirm a case in `parity.test.ts`/`reviewFixes.test.ts`: a fixed seeded tower run produces identical money/population/star trajectory with the pass applied (asserts §3 "changes no simulated number").

Rendering (red X, divergent-line rendering) is DOM/canvas and out of Vitest scope — cover via the Docker screenshot pass (`npm run screenshots:docker`) and the acceptance-criteria walkthrough, not unit tests.

---

## 5. File-touch summary

| File | Change |
|---|---|
| `src/engine/Tower.ts` (~675) | Extract `functionalParkingSet()` (fresh compute — no revision cache); `functionalParkingSpots()` → `.size`. |
| `src/engine/Simulation.ts` | Add `floorReachable`, `strandedFloors`, `hotelsCountTowardRating`; extend `stats()` (cheap fields); `strandedNudged` latch + nudge in `onDay` (~417). |
| `src/engine/milestones.ts` (opt.) | Extract shared tenant-floor predicate; reuse in `everyOccupiedFloorServed` + `strandedFloors`. |
| `src/main.ts` | `inspectPicked` (~806): 3-state Access + hotel + parking lines. `buildStatsHtml` (~659): divergent-pop line, Transport (stranded) section, Parking row. |
| `src/render/excalibur/TowerEngine.ts` (~768/849) | Dead-parking bit in room sig; draw red X in `addRoom`. |
| `src/tests/*.test.ts` | Cases 1–12 above. |

Every string reports a truth the sim already computes; every BFS call is off the tick/HUD path; no simulated number moves.
