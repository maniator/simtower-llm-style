# PR #52 — Legibility Pass — Merge-Readiness Review

> **RESOLVED (post-review):** every finding below was fixed on this branch — parking cache dropped (fresh flood-fill), construction/fire gating added, the stranded nudge made log-only, `stats()` kept cheap, and the docs corrected. The "NOT SAFE TO MERGE" verdict was the point-in-time finding; the PR is now clean (157 tests, 0 unresolved threads). Kept as the review record.

**Verdict:** NOT SAFE TO MERGE as committed — one confirmed **blocker** (revision-keyed parking cache goes stale on construction/fire state transitions, silently regressing parking economy + the very legibility signal this PR ships). A complete fix already exists **uncommitted in the working tree**; commit it, update the arch doc, and this becomes mergeable pending two minor/info follow-ups.

- **Highest-severity item:** `Tower.functionalParkingSet()` memoised by `this.revision`, but its flood-fill depends on `unit.state` (`construction`/`fire`) — transitions that never bump `revision` — so freshly-completed (and burning) parking reads stale.
- Branch: `claude/simtower-prd` · single PR commit `6a4c01c` · diff base `origin/main...HEAD`.
- Build state (working tree): `tsc --noEmit` clean, `eslint` clean, **157/157 tests pass**.

---

## Scope of the feature (as designed)

Surface three already-computed truths — **no mechanics/balance change** (GDD restraint + arch acceptance #5, `arch-legibility-2026-07-01.md:149`):

1. `Tower.functionalParkingSet()` (parking flood-fill) + `functionalParkingSpots()` delegating to `.size`.
2. `Simulation.floorReachable()`, `strandedFloors()`, `hotelsCountTowardRating()`; `stats()` gains `parkingSpaces/parkingWorking/ratingPopulation/hotelsCount`; edge-triggered stranded log nudge (`strandedNudged` latch, not persisted).
3. `milestones.ts` shared `isTenantFloorUnit()`; `main.ts` inspector + stats HTML lines; `TowerEngine` static red X on dead parking.

**Architect's hard rule** (`arch...:16,147`): *no BFS/route on the tick or the ~6 Hz `stats()`/HUD path.* This review confirms that hard rule is **not violated** — the parking flood-fill is O(units) with O(1) `roomAt`, not a `Crowd.route` call, and all route-bearing queries (`strandedFloors`, `floorReachable`) are correctly kept off the tick/HUD path.

---

## CRITICAL CONTEXT — the fix is already staged in the working tree (uncommitted)

The committed PR (`origin/main...HEAD`) ships the **buggy memoised** version:

```
git diff origin/main...HEAD -- src/engine/Tower.ts
+  private parkingSet?: Set<number>;
+  private parkingRev = -1;
+    if (this.parkingSet && this.parkingRev === this.revision) return this.parkingSet;
+    this.parkingSet = reached;
+    this.parkingRev = this.revision;
```

But the **working tree has uncommitted modifications** (`git status`: `M src/engine/Tower.ts`, `M src/render/excalibur/TowerEngine.ts`, `M src/tests/legibility.test.ts`) that **remove the memoisation entirely** and document why:

```
git diff -- src/engine/Tower.ts   (working tree vs HEAD)
-   * Memoised by {@link revision} like {@link servedFloorSet} ...
+   * NOT memoised: it depends on unit STATE (construction/fire), and
+   * those transitions don't bump {@link revision} ... so a revision cache
+   * would go stale. The flood-fill is bounded by the parking region with
+   * O(1) `roomAt`, so it's cheap enough for the callers ...
-    if (this.parkingSet && this.parkingRev === this.revision) return this.parkingSet;
-    this.parkingSet = reached; this.parkingRev = this.revision;
```

This uncommitted change is the correct fix (revert to always-fresh flood-fill), plus two consistent companions (see F-render and test note below). **It is not part of PR #52 until committed.** The merge-readiness verdict below judges the PR *as committed*; the required action is to commit this fix.

---

## Findings by severity

### BLOCKER — Stale revision-keyed parking cache (reported 6× as F1, F2, F3, F6, F7, F9; also as major in F5, F8 — all one root cause)

**Location:** `src/engine/Tower.ts:689-718` (cache); staleness sources `src/engine/Simulation.ts:400` (`finishConstruction` → `state="empty"`, no `revision++`) and `src/engine/EventSystem.ts:146,171,229,238,310` (fire ignite/spread/extinguish flip `state`, no `revision++`); stale reads at `src/engine/Simulation.ts:619,674,748,1071` and `src/render/excalibur/TowerEngine.ts:773,788,869`.

**Confirmed root cause.** `functionalParkingSet()` is newly memoised keyed on `this.revision` (the pre-PR `functionalParkingSpots()` recomputed the flood-fill fresh every call — diff shows `return reached.size`). But the flood-fill's `usable()` predicate and the ramp-seed loop (`Tower.ts:690,695`) exclude `state === "construction"` and `state === "fire"`. `revision` is bumped **only** by structural mutators in `Tower.ts` (verified: `grep` finds **zero** `revision++` in `Simulation.ts` or `EventSystem.ts`). The state transitions the flood-fill depends on therefore never invalidate the cache.

This breaks the invariant the design leaned on: `servedFloorSet` is safely revision-keyed because its inputs (transports/`stopsAt`) *only* change via revision-bumping ops. Parking's `state` dependency has no such guarantee, so the copied pattern is unsound here.

**Guaranteed failure (every parking build).** Parking always transits construction: `Simulation.build()` calls `tower.place()` (bumps `revision`→R, `state="empty"`) then immediately sets `state="construction"` (`Simulation.ts:253`); `buildMinutes("parking")≈109`, `parkingRamp≈118` game-minutes (`facilities.ts:376-380`), a ~2 h window. During that window the ~6 Hz HUD path (`stats()`→`Simulation.ts:1071`), the every-frame `syncScene` (`TowerEngine.ts:773`), and the economy readers all call `functionalParkingSet()` at revision R, **warming the cache with the garage excluded**. `finishConstruction` then flips `state="empty"` with **no** `revision++` (`Simulation.ts:400`), so `parkingRev === revision === R` still holds and the stale set is returned **indefinitely**, until the next unrelated build/bulldoze/transport edit.

**Impact — this is a silent mechanics/balance change (the PR's explicit non-goal):** `functionalParkingSpots()` → `functionalParkingSet().size` feeds economy relief at `Simulation.ts:619` (elevator/transport capacity), `:674` (office demand relief), `:748` (`officeParkingShort` → office move-in penalty). A fully-built, correctly-chained garage provides **zero** relief until self-heal. Plus it defeats the feature being shipped: a static red **X** is baked onto working parking (`TowerEngine.ts:788` sig dead-bit, `:869` stroke), the inspector reports "dead", and `stats().parkingWorking` under-reports.

**Fire variant (symmetric).** A burning ramp/space (`state="fire"`, no bump) stays in the cached working set → relief continues from a burned garage and no X appears; extinguishing (`fire→empty`, also no bump) is likewise not reflected.

**Why tests miss it.** `legibility.test.ts` uses `tower.place()` directly (unit born `state="empty"` at the create-revision, each `place` bumping `revision`), never routing through `Simulation.build()`'s construction state or the fire path. The committed test even asserted cache identity (`expect(functionalParkingSet()).toBe(set)`), which only passes *because* of the bug.

**Fix (already applied uncommitted — commit it):** Drop the memoisation and recompute the flood-fill on every call (the working-tree change). It is O(units) with O(1) `roomAt` — cheap enough for the 6 Hz path and does **not** violate the architect's hard rule (that rule is about `Crowd.route`, not this flood-fill). Alternative fixes (bump `revision` on construction-complete + fire transitions, or key the cache on a state-inclusive signature) are viable but strictly more code and more failure surface than reverting to fresh compute.

> **Arch-doc defect (must also be corrected).** This blocker originates in the architecture, not just the implementation: `arch-legibility-2026-07-01.md:25,28,75,148` explicitly prescribe memoise-by-revision "exactly like `servedFloors()`" and assert (line 148) it is "safe even inside the 6 Hz `stats()` call." That assertion is false for a `state`-dependent set. Update those lines to record that `functionalParkingSet()` must recompute fresh (or carry a state-generation key), so the next implementer doesn't reintroduce the bug.

---

### MINOR — Parking shows red X + "dead" text during its normal construction window (F4)

**Location:** `src/render/excalibur/TowerEngine.ts:869`; `src/main.ts:867`.

`usable()` (`Tower.ts:692`) excludes `state === "construction"`, so a space that is *legitimately mid-build* is absent from `functionalParkingSet` and therefore draws the canon dead red X and reports "Ramp access: none — this space is dead" in the inspector — a misleading connectivity-fault signal when the player merely needs to wait. **Independent of the caching blocker**; it persists even with the fresh-compute fix (the working-tree change does not address it). Transient, cosmetic/text only, no mechanics/balance impact — hence minor. Only mitigating cue is the separate inspector "Status: construction" line (`main.ts:874`).

**Fix (follow-up):** Suppress the dead marker and the "dead" inspector line while `state === "construction"` (treat under-construction parking as neutral/pending, not dead).

---

### INFO — `stats().hotelsCount` holds a boolean, not a count (F10)

**Location:** `src/engine/Simulation.ts` — `stats()`: `hotelsCount: this.hotelsCountTowardRating()`.

`hotelsCountTowardRating()` returns `boolean` (`this.star < 3`), so the `*Count`-named field is a flag. Not a live bug (no consumer reads the `stats` field; `main.ts:860` calls the method directly; `tsc`'s inferred `boolean` type would catch arithmetic misuse), but the name will mislead future consumers of the `stats()` shape.

**Fix (follow-up):** Rename the field to `hotelsCountTowardRating`.

---

## Companion working-tree changes (part of the fix, reviewed and sound)

- **`TowerEngine.ts` (render):** the committed version called `this.sim.tower.functionalParkingSet()` **inside the per-unit `addRoom` draw closure** (`:869`), i.e. once per parking actor re-bake. The working-tree fix computes `isDead` **once per `syncScene`** from the caller's single `functionalParkingSet()` read and passes it into `addRoom(u, isDead)`. Correct and strictly cheaper — with the memo removed, the old per-unit call would have been N fresh flood-fills per re-bake; this hoist restores one-read-per-sync as the arch doc intended (`arch...:124`).
- **`legibility.test.ts`:** removes the cache-identity assertions (`toBe(set)` / "same instance until a build bumps revision") that only held because of the bug, and replaces them with fresh-computation assertions. Appropriate. (Follow-up worth adding: a test that drives `Simulation.build()` → construction → `finishConstruction`, and a fire ignite/extinguish, asserting `functionalParkingSet()` reflects the new state immediately — the exact path current tests skip.)

---

## Merge-readiness decision

| Item | Severity | Status |
|---|---|---|
| Stale revision-keyed parking cache (F1/F2/F3/F5/F6/F7/F8/F9) | **BLOCKER** | Fix staged in working tree, **NOT committed** |
| Construction-window red X / "dead" text (F4) | Minor | Open — not addressed by the fix |
| `hotelsCount` boolean-named-as-count (F10) | Info | Open |

**Not safe to merge as committed.** Required before merge:

1. **Commit** the working-tree fix (`Tower.ts` fresh-compute, `TowerEngine.ts` hoisted read, `legibility.test.ts` update). This clears the blocker.
2. **Update** `arch-legibility-2026-07-01.md:25,28,75,148` to drop the "memoise the parking set by revision" instruction and record the state-dependency rationale.
3. Add a construction/fire-transition regression test (see above) so the bug cannot silently return.

After (1)–(2), with green `tsc`/lint/157 tests, the PR is mergeable. F4 (minor) and F10 (info) are acceptable **follow-ups**, not merge blockers, provided they are tracked.
