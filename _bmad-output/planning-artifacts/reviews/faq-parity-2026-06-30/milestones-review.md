# PR #50 — Milestones / Optional-Goals System — Merge-Readiness Review

**Date:** 2026-07-01
**Branch:** `claude/simtower-prd`
**Reviewer:** deep-review (source-verified)
**Verdict:** ✅ **SAFE TO MERGE** — zero blocker/major findings; all issues are minor/info follow-ups.

---

## Scope

Data-driven milestone/optional-goals system: 11 pure `{id, label, desc, test(sim)}`
milestones (`src/engine/milestones.ts`), evaluated once per in-game day in
`Simulation.onDay → checkMilestones()` via a fire-once `Set`. Emits a bulletin
line, **no cash reward by design**. `milestoneProgress()` feeds the checklist in
the Full-Statistics modal (`main.ts buildMilestonesHtml`). `achievedMilestones`
is persisted through `serialize`/`deserialize` (`SerializedGame.milestones?: string[]`).

**Diff:** +400 lines across `Simulation.ts` (+26), `milestones.ts` (+60),
`types.ts` (+3), `main.ts` (+20), `milestones.test.ts` (+89), plus two design docs.
**Gate status (as reported):** 146 tests pass, `tsc` + lint clean. Confirmed the
feature is genuinely recognition-only — `checkMilestones` only calls `emit()` and
mutates the `Set`; no `money` mutation exists anywhere on the milestone path.

---

## Findings by severity

### 🔴 Blocker — none
### 🟠 Major — none

### 🟡 Minor

#### M1 — "No Vacancy" (`full-house`) checks only empty offices, not real vacancies
*(consolidates F1, F4, F6, F8, F12; F11 is the same defect rated info)*

- **Location:** `src/engine/milestones.ts:58` — `s.population >= 2000 && s.stats().vacant === 0`
  with `src/engine/Simulation.ts:996–1010`.
- **Confirmed by source:** in `stats()`, `vacant` is incremented **only** inside the
  `u.kind === "office"` branch (line 1000: `if (u.state === "empty") vacant++`).
  Condos are tracked via `everOccupied`/`soldCondos`, hotel rooms via
  `asleep`/`dirty`, shops/restaurants not at all — none ever touch `vacant`.
- **Effect:** the milestone described as "Reach 2,000 population with zero vacancies"
  actually means "zero *empty offices*." Two concrete false positives:
  1. An office-less tower (condo/hotel-driven, which can pass 2,000 pop since condos
     carry population 6) has `vacant === 0` trivially and unlocks immediately despite
     unsold condos, empty hotel rooms, and vacant shops.
  2. A mixed tower with all offices leased but many unsold condos / empty rooms still
     fires. Offices still under construction (not yet `empty`) also don't count.
- **Impact:** low — recognition-only, no cash/economy/state effect; it's an
  incorrectly-granted one-time badge + bulletin line. It is internally consistent with
  the modal's own office-only "Vacancies" row (`main.ts:643`), which is why F11 rates it info.
- **Fix (pick one):**
  - Preferred: compute true vacancy in a dedicated helper counting *all* rentable
    kinds in `state === "empty"` — offices + condos + hotel rooms (and shops/restaurants
    if they should count) — and test that instead of reusing `stats().vacant`.
  - Or, if the office-only meaning is intended, rename the label/desc to reflect it
    (e.g. "Every office leased at 2,000 population").

#### M2 — "Smooth Operator" (`well-served`) desc broader than implementation
*(consolidates F2, F5)*

- **Location:** `src/engine/milestones.ts:22–34` (`everyOccupiedFloorServed`), desc at line 49.
- **Confirmed by source:** the predicate audits only floors that are (a) `floor >= 2`
  (skips floor 0 / B1 and all basements) and (b) contain an occupied/asleep unit with
  `FACILITIES[u.kind].population > 0` (line 29 skips `population <= 0`). Per
  `facilities.ts`, shop/restaurant/fastFood/cinema/partyHall all have `population: 0`,
  so a floor whose only occupied units are commercial is not required to be served.
- **Effect:** the desc "every occupied floor reachable" overstates the check. Two
  narrow vectors: (1) a commercially-occupied but unreachable above-ground floor doesn't
  block the milestone; (2) a population-bearing basement floor (office/condo/hotel *can*
  be placed below floor 1) is never audited — mis-fire is transient (move-in requires
  service; the only window is after a player demolishes transport, before satisfaction
  decays and the tenant vacates ~7 days later). The `sawOne` guard's never-fire edge is
  real but unreachable at 5,000 pop.
- **Impact:** low — recognition-only false positive under contrived conditions.
- **Fix:** align the desc wording with the population-bearing semantics
  (e.g. "every populated residential/office/hotel floor reachable"). Optionally drop the
  `floor < 2` guard if basement population floors *should* count. Behavior change is
  optional; the primary fix is wording.

#### M3 — Stale "pay/reward/re-pay" wording contradicts the recognition-only design
*(consolidates F7, F9, F10; documentation/naming defect)*

- **Locations:** `src/engine/Simulation.ts:135` ("announced + paid once"),
  `Simulation.ts:1091` ("re-announce or re-pay them"), `src/engine/types.ts:169`
  ("or re-pay them"), and test names in `src/tests/milestones.test.ts:32`
  ("fires once, pays its reward once…"), `:54` ("no re-announce, no re-pay"),
  `:69` ("must not re-announce or re-pay").
- **Confirmed by source:** no payout code path exists; `milestones.ts:17–20` and the
  `checkMilestones` docstring (`Simulation.ts:441`, "Recognition-only (no cash)")
  explicitly forbid it. There's even an in-file contradiction: line 441 says "no cash"
  six lines after line 135's "paid once."
- **Effect:** a maintainer reading "paid once"/"re-pay" could conclude a reward is
  intended-but-missing and add a phantom payout — exactly what the design comment warns
  against (money already trivializes the late game). The named tests assert only the
  achieved `Set`/checklist flags, nothing about `money`, so such a regression would go
  uncaught.
- **Fix:** delete the "pay"/"reward" language from the four comment/name sites (replace
  with "announced once" / "so reload doesn't re-announce them"). Optionally add one
  assertion that `sim.money` is unchanged across `checkMilestones` to lock the invariant.

### 🔵 Info

#### I1 — Milestone evaluation cost is trivial and correctly gated (no defect) *(F3)*
`checkMilestones` runs once per in-game day at the end of `onDay` (gated by
`day !== lastDay`), iterating 11 pure predicates. The pop-* tests recompute
`s.population` (O(units)) ~6×; `full-house` adds one `stats()` pass and `well-served`
adds `everyOccupiedFloorServed` (O(units), `isFloorServed` memoised per revision).
Negligible at once/day; no per-tick cost. Fire-once semantics are correct: `Set`
serialized via spread, restored in `deserialize` guarded by `Array.isArray` +
`typeof id === "string"` *before* any tick, so reload does not re-announce. Readings
are stable (state, not occupants, drives population; `updatePresence` runs before
`checkMilestones` at the midnight boundary). Included for completeness.

#### I2 — Loading a pre-feature save re-announces all satisfied milestones in one burst *(F13)*
Legacy saves have no `milestones` field (`types.ts:170` optional); `deserialize` only
restores when `Array.isArray(data.milestones)`, so they load with an empty set. On the
first day boundary after load, `checkMilestones` emits a bulletin line for every
currently-true milestone at once — up to 11 "Milestone:" lines for a mature tower.
Functionally harmless and arguably intended (retroactive credit); no cash paid. If
undesirable, seed `achievedMilestones` from current state when loading a save that
lacks the field, instead of announcing.

---

## Certification

**SAFE TO MERGE.** No blocker or major findings. The feature is correct, well-gated,
persisted safely, and honors its recognition-only design. Recommended follow-ups
(non-blocking): **M1** (fix or rename the "No Vacancy" vacancy semantics — highest-value
follow-up as it's a user-visible false positive), **M2** (align "Smooth Operator"
wording), **M3** (scrub stale "pay/reward/re-pay" docs + test names, add a money-unchanged
assertion). All three are safe to land as a fast-follow after merge.
