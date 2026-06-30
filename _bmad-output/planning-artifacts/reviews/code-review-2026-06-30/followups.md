# SimTower Clone — Review Follow-ups (Phase 2)

PR #35 (`claude/simtower-fixes`, merged) resolved the blocker and the
cleanly-fixable majority of the [BMAD review](./review.md). This file tracks what
was **deliberately deferred**, with rationale, so nothing is silently dropped.

## Phase 2 — ratified plan (2026-06-30)

A BMAD party-mode roundtable (PM, Game Designer, Game Architect, 1994 Purist,
Dev/QA) + the owner ratified the direction:

- **Winnability is restored by making congestion SPATIAL** (per-shaft /
  per-served-region throughput) — the "12k can't fit" paradox is an artifact of
  the single tower-wide scalar, not real geometry. Service coverage (F15) gets a
  radius (the original's 10-cap); the dead palette (F13) re-expands.
- **TOWER stays a population census** (residents + office workers + hotel guests),
  exactly as the 1994 original — **owner decision**, overriding the party's
  "count commercial traffic" idea, which would have diverged from canon. Only the
  *number* (12,000 vs 15,000) is scaled; a Phase-2 tolerance band may re-derive
  it from the spatial model, but commercial/visitor traffic is never counted.
- **Delivery: several small PRs behind a `simModel: 'v1' | 'v2'` flag** (default
  v1) so the existing tests stay green until a deliberate flip. Ordered steps:
  **0** quarantine the balance-coupled TOWER assertion → **1** real hourly clock
  (F4) → **2** spatial transport graph → **3** service coverage radius (F15/F13)
  → **4** re-derive the goal + flip default to v2 → **5** honest organic-TOWER E2E
  (closes the rest of F2).
- **Rejected:** enlarging the lot (papers over the bug, kills the F8 perf work);
  lowering the target as a first move (kept only as a tolerance-band fallback).

## Fixed in this PR (21 findings)

**Blocker** — F1 (security gate deadlock).
**Major** — F7 (commercial income snowball), F8 (served-floor perf wall),
F14 (recycling no-op), F21 (treasure exploit), plus the F2 *test-integrity*
gap is partially closed (see below).
**Minor** — F10, F18, F23, F24, F26, F29, F31, F32, F33/F37, F41, F48, F49,
F50, F52, and the PRD/PARITY basement contradiction (F53).

All covered by `src/tests/reviewFixes.test.ts`; full suite 95 passing.

## Deferred — "Simulation depth & winnability" (one coupled epic)

These four are a single design effort, not isolated bugs. They must land
together with re-tuning and new tests:

- **F3 — non-spatial congestion.** Stress is one tower-wide scalar, so layout,
  sky-lobby zoning and shaft placement have no mechanical effect. Fix =
  per-served-region / per-shaft throughput.
- **F15 — boolean service coverage.** Security/Medical work tower-wide from any
  corner. Fix = a coverage radius (the original caps each at 10 for this reason).
- **F13 — palette collapses to ~4 meaningful types.** A *consequence* of F3+F15
  (+F14); resolved by fixing them.
- **F4 — the clock is sampled, not integrated** (`tick()` fires `onHour`/`onDay`
  at most once per call). The correct fix (push ≤20-min sub-stepping into
  `tick()`) makes headless == browser, but under proper hourly simulation the
  existing pre-seeded TOWER test (no transport) mass-vacates — so F4 can only
  land *with* F3 and a winnable-tower rebuild.

**Why coupled / why deferred:** a fully-organic 12,000-pop TOWER win (the rest of
**F2**) is blocked on this epic. The lot is 100 floors × 200 tiles; with enough
elevator capacity to avoid mass move-outs under hourly simulation, that lot
cannot even *hold* 12,000 population. So either the congestion model must become
spatial (F3) or the TOWER target/lot must change — a balance decision, not a bug
fix. Shipping a half-done clock-integration + congestion rewrite untested would
regress the game. This PR instead adds an honest organic E2E to **3★** (proves
F1 + the build→occupy→rent→star loop end-to-end) and leaves the TOWER endgame
test as-is, clearly flagged.

## Deferred — smaller, low-risk-but-out-of-scope

- **F17** anti-bunching multi-car dispatch (cosmetic; cars still help gameplay).
- **F20** stairs/escalators serve floors but route no passengers (entangled with
  the F3 routing rework).
- **F25** hotels/commercial don't churn from stress (depends on F3 stress model).
- **F27** idle cars rest at the shaft's lowest stop, not the ground lobby
  (already the lobby for ground shafts; a minor enhancement for sky shafts).
- **F28** first day-boundary collects a period early (near-zero impact; the early
  income reads as intended starter cash — changing it removes early income and
  destabilises a test for marginal benefit).
- **F30** ground lobby is optional (`isFloorServed(1)` hardcoded true) — arguably
  correct (the ground floor is walk-in accessible); degenerate edge case.
- **F36/F45/F46** facility population/footprint/cap deltas vs canon (cosmetic;
  PRD-documented widths) — candidates for a PARITY "known deltas" note.
- **F38** BFS routing has no load tie-break across parallel shafts (depends on F3).
- **F39** crowd spawn rate is flat, not population-scaled (visual-only).
- **F40** visible-crowd determinism boundary — document in the addendum.
- **F9 / F51** elevator-cab load saturation in the renderer / mobile bulletin
  visibility (render/CSS polish).

## Suggested sequencing for Phase 2

1. F3 + F15 (spatial congestion + coverage radius) with re-tuning.
2. F4 (clock sub-stepping) once a served tower can stay satisfied.
3. Rebuild the TOWER E2E to win organically (completes F2); decide the
   12k-vs-lot-size balance question.
4. Sweep up F17/F20/F25/F38/F39 (all ride on the new routing/stress model).
5. F9/F40/F51 render & docs polish.

## Phase 2 — DONE (2026-06-30)

All Phase-2 steps implemented behind `simModel`, with v2 now the **default**:

- **Step 1 (F4)** — real hourly clock: `tick()` sub-steps to hour boundaries.
- **Step 2 (F3)** — spatial congestion: per-floor, load split across the shafts
  that serve a floor; parallel shafts relieve, separate clusters don't pool.
- **Step 3 (F15/F13)** — service coverage radius (Security ±8, Medical ±12);
  fire containment is spatial; tall towers must distribute stations (10-cap bites).
- **Step 4** — flipped default to v2; **re-derived the TOWER target to 8,000**
  (measured lot ceiling ~8,900 under good zoning); pinned the constructed
  TOWER/rating tests to v1; PRD/PARITY updated.
- **Step 5 (F2)** — honest endgame test: a served, well-zoned tower reaches TOWER
  under the real hourly clock and does NOT mass-vacate.

Suite: 106 passing. Remaining smaller review items (F17/F20/F25/F27/etc.) are
swept in the follow-up commit; see the review report for the originals.

## Smaller findings — final disposition (2026-06-30)

Every remaining review finding is now accounted for:

- **F9** — FIXED: elevator-cab fill is scaled to the cab's capacity (a big express
  no longer reads "full" at a fraction of its load).
- **F17** — FIXED: multi-car dispatch claims each call so cars spread to distinct
  floors instead of bunching.
- **F25** — FIXED: hotel guests churn out under sustained stress (poor access),
  like offices/condos. (Commercial isn't separately churned — its income already
  requires a served floor, so poor access starves it directly.)
- **F27** — FIXED: idle cars rest at the lowest lobby the shaft serves.
- **F36** — FIXED: hotel suite houses 3 (canon).
- **F39** — FIXED: crowd spawn rate scales with tower population (still capped at
  MAX_PEOPLE).
- **F40** — DOCUMENTED: the authoritative/visible-crowd determinism boundary is
  now spelled out in the addendum.
- **F20** — RESOLVED by the spatial model: stairs/escalators contribute capacity
  to the floors they serve in v2 congestion; the *visible* crowd routing stays
  elevators-only by design (the aggregate model is authoritative).
- **F38** — RESOLVED by the spatial model: v2 splits floor load across parallel
  shafts (the balancing a BFS load tie-break would provide); the visible BFS still
  returns the fewest-transfer path.
- **F30** — DECISION (won't-fix): the ground floor is walk-in accessible, so
  floor-1 being "served" without a lobby is correct, not a defect.
- **F28** — DECISION (won't-fix): the first-period collection is intended starter
  income; near-zero impact, and changing it removes early cash flow.
- **F45 / F46** — DECISION: facility footprint widths, the 10 basement levels, the
  service-car cap, and the monthly maintenance cadence are PRD-documented model
  choices for the tile grid, not parity defects.
- **F51** — RESOLVED: the bulletin log lives in the mobile drawer panel (reachable
  on phones); transient toasts remain the at-a-glance channel.

**Status: every one of the 45 review findings is implemented or explicitly
decided.** Suite: 109 passing; typecheck/lint/build clean.
