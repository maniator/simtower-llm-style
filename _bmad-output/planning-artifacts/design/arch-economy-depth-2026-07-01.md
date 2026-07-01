---
title: "Technical Design — Economy Depth"
author: Cloud Dragonborn (Game Architect — BMAD gds agent)
date: 2026-07-01
status: Approved-for-build
implements: GDD §7 #4 (late-game money lever) and #5 (blockbuster as a choice)
---

## Technical Design — Economy Depth (Cloud Dragonborn, Game Architect)

Grounded in the live engine. Both changes ride the existing **monthly** `EconomySystem.payMaintenance()` loop and the **hourly** `collectTrafficIncome()` — no new tick, no new subsystem. Files: `src/engine/econConfig.ts`, `src/engine/EconomySystem.ts`, `src/engine/types.ts`, `src/engine/Simulation.ts`, `src/main.ts`, `src/ui/UI.ts`.

---

### #4 — Operating overhead on space held

**`econConfig.ts`** — one constant, alongside `maintenancePerCarMonthly`:
```ts
/** Monthly operating overhead per leasable/operational income unit, charged on
 *  SPACE HELD regardless of occupancy or served-status (income stays on
 *  occupancy). Makes a vacant or unserved floor pure carrying cost — the soft
 *  transport-puzzle penalty GDD §4 asked for. */
overheadPerLeasableUnitMonthly: 700,
```

**Which units pay it — the load-bearing predicate.** Add a small pure helper next to `rentConfig`/`rentOf` in `econConfig.ts` so the rule lives with the constants and is unit-testable in isolation:
```ts
/** True for a unit kind that holds leasable/operational space and therefore
 *  carries monthly overhead: anything with a rent band (office/hotel*/condo) or
 *  a foot-traffic income line (shop/food/entertainment). */
export function isOverheadKind(kind: string): boolean {
  return rentConfig(kind) !== null || ECON.dailyTrafficIncome[kind] !== undefined;
}
```
This resolves to: `office`, `condo`, `hotelSingle/Double/Suite`, `fastFood`, `restaurant`, `shop`, `cinema`, `partyHall`. It deliberately excludes pure `service` units (security/medical/housekeeping/recycling/metro) — those already pay `serviceMaintenanceMonthly` and are not leasable inventory.

**`EconomySystem.payMaintenance()`** — fold into the *existing* per-unit `for (const u of this.sim.tower.units)` loop (it already skips `construction`/`fire` implicitly via the checks below; make it explicit for overhead):
```ts
const operational = u.state !== "construction" && u.state !== "fire";
if (operational && isOverheadKind(u.kind)) {
  // Sold condos are excluded: their income was a one-time sale already banked,
  // so a permanent per-month drain on them would be punitive, not a decision.
  // Unsold condos keep paying (this + the price-scaled condoMonthlyTaxRate).
  if (!(u.kind === "condo" && u.everOccupied)) {
    cost += ECON.overheadPerLeasableUnitMonthly;
  }
}
```

**Decision I am making explicit (flag for designer sign-off):** the spec says "held condos." I read that as *unsold* condos (matching the existing `condoMonthlyTaxRate` gate `!u.everOccupied`). So an unsold premium condo stacks flat overhead (~$700) + price-scaled tax (~1.5% ≈ $1,800) ≈ $2,500/mo — a real "sell it" nudge, still non-punitive. A **sold** condo pays nothing (one-time income already collected). If the designer instead wants sold condos to carry overhead as residential space, drop the `everOccupied` guard — trivial one-line change, but I recommend against it (permanent drain on a dead-income asset = the punitive spiral we're told to avoid).

**Guardrails satisfied:** pure function of tower state; **no RNG**, **no new serialized field**, **no save migration**. Old saves tick identically the first month (they just see a bigger maintenance number in the existing `"Monthly maintenance paid: $X."` toast). No new HUD → zero screenshot chrome churn.

**Hot-path:** none. `payMaintenance()` fires monthly and already iterates all units; this is one branch per unit, no new allocation.

---

### #5 — Blockbuster as a per-cinema policy

**`types.ts` — new optional Unit field** (place near `rent?`):
```ts
/** Per-cinema film-booking policy. undefined ⇒ "auto" (legacy 40% roll), so
 *  old saves and demo towers behave identically. */
filmPolicy?: "auto" | "feature" | "blockbuster";
```
`serialize()` uses `{ ...u }` and `deserialize()` maps `{ ...u, ... }`, so the field round-trips automatically. **Add a coercion** in `deserialize`'s unit `.map(...)` (next to the `rent` coercion) so a hand-edited save can't inject a garbage policy:
```ts
filmPolicy:
  u.filmPolicy === "feature" || u.filmPolicy === "blockbuster" || u.filmPolicy === "auto"
    ? u.filmPolicy
    : undefined,
```

**`EconomySystem.payMaintenance()`** — branch the cinema block on policy instead of the unconditional roll:
```ts
if (u.kind === "cinema" && u.state !== "construction" && u.state !== "fire") {
  const policy = u.filmPolicy ?? "auto";
  // DETERMINISM: only "auto" consumes rng, in the same call order as today.
  const blockbuster =
    policy === "blockbuster" ? true :
    policy === "feature"     ? false :
    /* auto */                 this.sim.rng.chance(0.4);
  if (blockbuster) {
    this.blockbusters.add(u.id);
    cost += ECON.cinemaBookingBlockbuster;
  } else {
    cost += ECON.cinemaBookingMonthly;
  }
}
```
`filmMult` in `collectTrafficIncome()` (~L76) is **unchanged** — it keys off `this.blockbusters.has(u.id)`, which is now populated deterministically per policy. The already-serialized `blockbusters` set still snapshots *what is showing now* so a mid-month reload keeps the paid-for boost; `filmPolicy` (the standing choice) and `blockbusters` (this month's result) are orthogonal and both persist cleanly.

**Determinism analysis (the crux of the ask).** `sim.rng` is the *single shared stream* consumed within a tick by `collectTrafficIncome` (`rng.next`), `payMaintenance` (`rng.chance`), `companyName` (`rng.pick`), etc.
- A cinema left on **auto** calls `rng.chance(0.4)` in the identical unit-iteration order → the stream is byte-for-byte unchanged. Existing saves, balance, and screenshots are unaffected (this is why auto stays the default).
- A cinema set to **feature/blockbuster** consumes **no** RNG. This *does* shift the shared stream for every RNG consumer later in that same tick and thereafter. That is acceptable and correct: it only happens after the player takes a deliberate, deterministic action (setting a policy), the result is still fully reproducible from `{seed, saved actions}`, and it never affects a default/legacy game. **Flag:** if we ever wanted a policy change to be stream-neutral we'd have to make feature/blockbuster still burn a throwaway `rng.chance()` — I recommend **not** doing that (it's wasteful and the shift is harmless), but it's the lever if a test demands stream-identity across policies.

**Hot-path:** none. Same monthly loop, one extra `??` + ternary per cinema.

---

### UI hook (`main.ts`) — mirrors the rent adjuster, no new modal

Cinemas have no `rentConfig`, so today they get no editor `ed-row`s. Add a cinema-only status row + cycling button.

**`unitEditorVolatile(u)`** — add a volatile "Now showing" reflecting `blockbusters`:
```ts
if (u.kind === "cinema") {
  const showing = this.sim.economy.blockbusterIds.includes(u.id);
  // "—" until the first monthly booking has happened this session.
  vol.showing = u.everBooked ? (showing ? "Blockbuster" : "Feature") : "—";
}
```
Simplest signal for the `—` case: reuse `blockbusters` — before the first `payMaintenance`, the set is empty for a fresh cinema, so show `—` if `minutes < firstMonthTick`. To avoid a new field, I recommend deriving `—` as "set is empty AND policy is auto AND no month has ticked" is fragile; cleaner is a tiny read: if the cinema id is in `blockbusters` → Blockbuster, else if any month has elapsed → Feature, else `—`. Expose a one-liner `economy.hasBookedThisMonth` or just gate on `this.sim.clock.minutes >= MINUTES_PER_MONTH`. **Pick one and keep it read-only** — no new serialized state needed for a purely cosmetic label.

**`unitEditorHtml(u)`** — cinema-only rows/button (after the eval row, before Sell):
```ts
if (u.kind === "cinema") {
  rows.push(`<span class="k">Now showing</span><span class="v" data-field="showing">${vol.showing}</span>`);
  const label = { auto: "Auto", feature: "Feature", blockbuster: "Blockbuster" }[u.filmPolicy ?? "auto"];
  actions += `<div class="ed-row"><button data-edit="filmPolicy">Booking: ${label} ▸</button></div>`;
}
```
Note the editor **render key** at `main.ts:421` is `unit:${id}:${adjuster ? "r" : ""}`. The Booking button label lives in the *built* HTML, not the volatile patch, so cycling it must trigger a **full rebuild**. Two clean options: (a) fold the policy into the key — `unit:${id}:${adjuster?"r":""}:${u.filmPolicy ?? "auto"}` so a policy change bumps the key and rebuilds the button label; or (b) make `showing`+the button label both volatile via `data-field`. I recommend **(a)** — it reuses the existing rebuild seam and keeps the button label authoritative.

**`handleEditAction`** — new case in the unit branch (cycle auto→feature→blockbuster→auto):
```ts
} else if (action === "filmPolicy") {
  const order = ["auto", "feature", "blockbuster"] as const;
  const cur = u.filmPolicy ?? "auto";
  u.filmPolicy = order[(order.indexOf(cur) + 1) % order.length];
  this.audio.sfx("click");
  this.refreshEditor();
}
```
Mutating `u.filmPolicy` directly is consistent with how `rename` mutates `u.label`. Optionally add a thin `Simulation.setFilmPolicy(id, policy)` for symmetry with `adjustRent` and easier unit testing — I recommend it (keeps `main.ts` from reaching into unit internals and gives tests a clean entry point).

**`UI.ts` `showHelp()`** — one `<li>` inside the existing list (no new modal):
```html
<li><b>Book the films.</b> Cinemas book a film monthly — a <b>Blockbuster</b> costs twice as much but pulls a far bigger crowd (great in a busy tower, a money-loser in a quiet one). Leave it on <b>Auto</b> or set a policy on the cinema.</li>
```

**Screenshot churn:** only when a cinema is actually selected — matches the constraint.

---

### Vitest test plan

Extend `src/tests/faqComplete.test.ts` (has the existing cinema/blockbuster suite) and `src/tests/storage.test.ts` (round-trip). Use the seeded `Simulation` + `sim.tick(60*24*31)` month-advance pattern already in those files.

**#4 overhead:**
1. `isOverheadKind` unit test — true for office/condo/hotel*/all dailyTrafficIncome kinds; false for security/medical/housekeeping/recycling/metro/lobby/floor/stairs/elevator*.
2. *Overhead charged on vacant space:* build N empty (unoccupied, unserved) offices, capture money, tick one month, assert delta ≈ `N * overheadPerLeasableUnitMonthly` (plus any elevator/service upkeep) and that a vacant office is a pure drain (no offsetting rent).
3. *Served+occupied stays profitable:* a well-run office tower nets positive across a quarter (overhead < gross rent) — proves non-punitive.
4. *Sold condo exempt:* sell a condo (`everOccupied`), tick a month, assert it contributes **0** overhead; an unsold condo contributes overhead **plus** `condoMonthlyTaxRate`.
5. *construction/fire pay nothing:* a unit mid-construction adds no overhead.
6. *No RNG consumed:* two sims, identical seed, one with extra overhead-only units — assert an independent downstream `rng`-driven outcome (e.g. company names / weather) is unchanged, proving overhead touches no stream. (Confirms determinism claim.)

**#5 policy:**
7. *Default = legacy:* a cinema with `filmPolicy === undefined` reproduces today's behavior — over many months both `cinemaBookingMonthly` and `cinemaBookingBlockbuster` bookings occur (keep the existing "two-tier booking cost" assertion at faqComplete.test.ts:337 green).
8. *Feature never blockbusters:* set `feature`, advance 24 months, assert `blockbusters` never contains the id and every booking cost is `cinemaBookingMonthly`.
9. *Blockbuster always:* set `blockbuster`, assert id is in `blockbusters` every month and cost is `cinemaBookingBlockbuster`, and `collectTrafficIncome` applies the 2.2× `filmMult`.
10. *Stream identity for auto:* two identical sims, one cinema flipped feature→**back to auto**, assert `blockbusters` sequence and money match a never-touched auto sim (auto path consumes rng in original order).
11. *Stream shift for non-auto is deterministic & reproducible:* same seed + same policy set → identical results across two runs (reproducibility, not identity-with-auto).
12. *Save/load round-trips `filmPolicy`:* set each of the three policies, `serialize → deserialize`, assert preserved; assert an **absent** field loads as auto (legacy).
13. *Coercion:* deserialize a save with `filmPolicy: "garbage"` → coerced to `undefined` (auto), no throw. Extend storage.test.ts's "corrupt save doesn't throw" case.
14. *Blockbuster boost survives reload (existing M3 test, faqComplete.test.ts:395) stays green* with a policy set.

---

### Touchpoint summary
- `src/engine/econConfig.ts` — add `overheadPerLeasableUnitMonthly` + `isOverheadKind()`.
- `src/engine/EconomySystem.ts` — `payMaintenance()`: per-unit overhead line; cinema booking branched on `filmPolicy`.
- `src/engine/types.ts` — `Unit.filmPolicy?` (auto-serializes via existing spread).
- `src/engine/Simulation.ts` — coerce `filmPolicy` in `deserialize` unit `.map`; optional `setFilmPolicy(id, policy)`.
- `src/main.ts` — cinema "Now showing" row + cycling "Booking" button in `unitEditorHtml`/`unitEditorVolatile`; `filmPolicy` case in `handleEditAction`; extend editor render key with policy.
- `src/ui/UI.ts` — one `<li>` in `showHelp()`.
- Tests — `src/tests/faqComplete.test.ts`, `src/tests/storage.test.ts`.

No save-version bump required (both fields optional/absent-safe; `migrateSave` is a no-op passthrough today). No new hot-path work.