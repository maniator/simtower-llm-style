# Tech Plan — Fire Destroys Rooms (gutted shell, no auto-repair)

**Date:** 2026-07-01
**Author:** Cloud Dragonborn (Game Architect)
**Companion:** `gdd-fire-aftermath-2026-07-01.md`
**Files verified (line refs current as of this doc):** `src/engine/EventSystem.ts`,
`src/engine/types.ts`, `src/engine/Simulation.ts`, `src/engine/EconomySystem.ts`,
`src/engine/Tower.ts`, `src/render/sprites.ts`, `src/main.ts`

---

## 1. Decision

New `"gutted"` `UnitState`, **not** unit removal. Faithful to SimTower 1994: a burned-out room
becomes a blackened, non-functional shell the player must **bulldoze + rebuild**. Never
silently restored to a vacant, re-leasable room. Repair path removed entirely.

Why a state, not removal:
- **The scar is the lesson.** Removal (bare floor) erases the consequence.
- **Rendering is already built.** `drawUnit` (sprites.ts L68–70) composes `drawBurntShell` +
  `drawFlames` for `"fire"`. Gutted = shell without flames. `drawBurntShell` exists (L189).
- **Save-safety falls out for free.** Deserialize re-arms `events.active` from
  `units.filter(u => u.state === "fire")`; `"gutted"` ≠ `"fire"` ⇒ a saved gutted room never
  re-ignites. No new save field, no version bump.
- Removal would force re-placing the floor slab + re-validating geometry — heavier UX and
  multi-tile save edge cases.

## 2. State model — `src/engine/types.ts`

Extend `UnitState` (currently at L53) with:
```ts
| "gutted"; // burned-out shell — no income, no tenants; must be bulldozed & rebuilt
```
**Invariant:** `state="gutted"`, `occupants=0`, `everOccupied=false`, `satisfaction=0`,
`pendingIncome=0`. Inert: never leased, earns nothing, never operational, no service coverage,
no churn.

Add one canonical predicate so future states stay honest:
```ts
export function isOperational(u: Unit): boolean {
  return u.state !== "construction" && u.state !== "fire" && u.state !== "gutted";
}
```

## 3. Engine changes — `EventSystem.ts`

### 3a. Extract the destroy transition (single source of truth)

Replace **both** reset-to-empty blocks with one helper:
```ts
/** Reduce a burned unit to a gutted shell. Inert until bulldozed & rebuilt. */
private gut(u: Unit): void {
  u.state = "gutted";
  u.occupants = 0;
  u.everOccupied = false;
  u.satisfaction = 0;
  u.pendingIncome = 0;
  u.label = FACILITIES[u.kind].name;
}
```

### 3b. `processFires` containment (currently ~L258–266)

Remove the 30% "repair" charge and the reopen-to-empty. On containment the fire stops
spreading; the room is left gutted:
```ts
if (this.sim.rng.chance(control)) {
  this.gut(u);
  this.active.delete(id);
  this.sim.emit(
    `🔥 The ${FACILITIES[u.kind].name} on ${this.sim.floorLabel(u.floor)} burned down — only a gutted shell remains. Bulldoze the rubble and rebuild.`,
    "bad",
  );
}
```
The `else` (spread) branch is unchanged except for the safety valve in 3e.

### 3c. `extinguishAll` — paid fire-rescue (currently ~L149–160)

Burning rooms are still destroyed. The fee halts the spread + ends the panic, not un-burns:
```ts
private extinguishAll(): void {
  for (const id of [...this.active]) {
    const u = this.sim.tower.units.find((x) => x.id === id);
    if (u && u.state === "fire") this.gut(u);
  }
  this.active.clear();
}
```
Reword the `resolveChoice` rescue message (currently `🚒 Fire-rescue crews put the blaze out
for $…`) to: `🚒 Fire-rescue crews saved the tower for $…. The rooms that were ablaze are
gutted — rebuild them.` The modal body must state the consequence up front (see GDD §8).

> **Rejected alternative:** "paid rescue saves the currently-burning room too." It collapses
> the tension — players would always pay and lose nothing but cash. The fee's value is
> **containment**, not restoration.

### 3d. `flammableUnits` (currently ~L189) / `serviceWithin` (~L207)

- `flammableUnits`: add `u.state !== "gutted"` so a husk can't re-ignite.
- `serviceWithin`: add `&& u.state !== "gutted"` so a burned-out Security/Medical station
  provides no coverage.

### 3e. Small-tower safety valve (spread guard)

In the spread branch, before igniting `next`, skip if `next` is the **last operational unit of
its kind** in the tower:
```ts
const lastOfKind =
  this.sim.tower.units.filter((x) => x.kind === next.kind && isOperational(x)).length <= 1;
if (next && !lastOfKind && next.state !== "fire" && isOperational(next)) { /* ignite */ }
```
Deterministic, no RNG. Guarantees a starter tower can lose a room but never be wiped to zero in
one blaze.

### 3f. `controlChance` (currently ~L228)

Base `0.45 → 0.50`. Keep the `+0.2` Security / `+0.3` Medical bonuses and the death-spiral
comment.

## 4. Operational-guard audit (the subtle part)

Many systems treat anything not `construction`/`fire` as live. A naive `"gutted"` would be
counted as a working room. Route these sites through `isOperational(u)`:

- `EconomySystem.ts:32` (count of kind), `:191` (`const operational = ...`).
- `Tower.ts:708`, `:711` (parking / ramp functional set).
- `Simulation.ts:623`, `:673` (metro capacity/count), `:956` (`operationalCount`), and the
  `hasOperational` path (~L947).
- `EventSystem` `serviceWithin` (from 3d).

Leasing / presence / satisfaction — add gutted to the early-skip guards:
- `Simulation.ts:500` (`updatePresence`) — add `|| u.state === "gutted"` to the
  `occupants=0; continue` guard.
- `Simulation.ts:541` (`updateSatisfaction`) — add `|| u.state === "gutted"` to the `continue`
  guard (no churn on a husk).
- `Simulation.ts:764` (`tryLease`) already requires `state === "empty"`, so gutted never
  leases — **this is what kills the "silent re-lease" bug.** No change; assert in tests.

## 5. Rendering — `src/render/sprites.ts`

Add above the room dispatch in `drawUnit`:
```ts
if (u.state === "gutted") return drawBurntShell(ctx, x, y, w, h);
```
Reuse `drawBurntShell` (L189) as-is — dark husk, no flames. Pixel-sprite path needs no change:
`drawUnit` intercepts `"gutted"` before dispatching per-kind.

## 6. Bulldoze / rebuild — `src/main.ts`

- **6a.** `bulldozePicked` (~L1059) only blocks `state === "fire"`, so gutted already passes —
  correct, gutted must be bulldozeable.
- **6b.** Refund on gutted = 0 (currently flat 50% at L1065; also the sell path ~L822 and
  L848):
  ```ts
  const refund = u.state === "gutted" ? 0 : Math.floor(FACILITIES[u.kind].cost * 0.5);
  this.sim.money += refund;
  ```
  No salvage value; rebuild costs full price. No punitive extra charge (avoids deepening a
  death spiral).
- **6c.** Inspector "Resale value" rows (~L684, L738) → "Scrap value: $0" for gutted. Add hint
  "Gutted by fire — bulldoze and rebuild." Skip parking/access verdicts for gutted (they
  already skip on `fire`; add `"gutted"`). HUD "On fire" stat (driven by `events.count`)
  needs no change — gutted rooms aren't active.

## 7. Save / serialization / determinism

- `serialize()` spreads `{...u}`; `state` (incl. `"gutted"`) persists automatically. No schema
  bump.
- `deserialize()` passes `state` through the spread; `occupants`/`satisfaction`/`pendingIncome`
  already coerced to safe values — consistent with the gutted invariant.
- **Re-arm:** `events.restore(units.filter(u => u.state === "fire"))` — gutted excluded ⇒ a
  saved gutted room never re-ignites. Key save-safety property; round-trip test in §8.9.
- **Determinism:** destroy transition is pure state assignment, no RNG. Containment consumes
  exactly one `rng.chance(control)` roll per active fire per day (unchanged). Fee removal
  changes only money, not RNG position.

## 8. Vitest test plan (`src/tests/fire.test.ts`, fixed seed, injected fires)

1. **Contained → gutted, not empty.** Ignite, force containment, step one day. Assert
   `state==="gutted"`, `occupants===0`, `everOccupied===false`, `satisfaction===0`,
   `events.count===0`, and `state!=="empty"` (exact-bug regression guard).
2. **No repair charge.** Record `sim.money` before containment; assert unchanged by the
   containment step (no 30% deduction).
3. **No re-lease.** Advance many days after gutting; assert never transitions to
   `occupied`/`asleep`/`moving_in`, `pendingIncome===0`, money delta from this unit == 0.
4. **Paid rescue gutts, not restores.** `fireRescue` pending, `resolveChoice("accept")` with
   funds; assert all previously-burning units `"gutted"` (not `"empty"`), `active` empty, fee
   charged once.
5. **Spread still works.** Ignite, force non-containment, adjacent flammable room, step a day;
   assert neighbor `"fire"` and in `active`. Contain both; assert both end `"gutted"`.
6. **Safety valve.** Two rooms, one kind; make one the only operational unit of a kind; force
   non-containment; assert the fire does NOT spread into the last operational room of that kind.
7. **Bulldoze refund = 0 on gutted; full rebuild.** Gutted removal adds 0; a normal empty unit
   still refunds 50%; rebuilding the same kind charges full cost.
8. **Not flammable / no coverage.** `flammableUnits()` excludes gutted; `serviceWithin` false
   for a gutted security/medical office.
9. **Operational counts exclude gutted.** After gutting, `operationalCount(kind)` /
   `hasOperational(kind)` / metro capacity / parking functional set no longer count it (via
   `isOperational`).
10. **Save round-trip.** Gut a room, `serialize()`→`deserialize()`; reloaded unit still
    `"gutted"`, `events.count===0` (not re-armed as fire), further days don't re-ignite/re-lease.

## 9. Change checklist

- `types.ts`: add `"gutted"` to `UnitState`; add `isOperational(u)`.
- `EventSystem.ts`: add `gut()`; rewrite `processFires` containment + `extinguishAll`; exclude
  gutted in `flammableUnits`/`serviceWithin`; last-operational-of-kind spread guard; base
  `0.45→0.50`; reword rescue message.
- `Simulation.ts`: gutted skip guards (L500, L541); route L623/673/956/947 through
  `isOperational`.
- `EconomySystem.ts` (L32, L191) + `Tower.ts` (L708/711): route through `isOperational`.
- `sprites.ts`: `drawUnit` gutted branch → `drawBurntShell`.
- `main.ts`: refund 0 for gutted (L1065, + sell paths L822/L848); inspector scrap-value +
  hint + skip verdicts + gutted announce; rescue modal copy.
- `resolveChoice`: reworded rescue message + modal consequence copy.
- Tests: the 10 cases above.
- `PARITY.md` L55 update. No save-format version bump required.
