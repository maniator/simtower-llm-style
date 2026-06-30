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
