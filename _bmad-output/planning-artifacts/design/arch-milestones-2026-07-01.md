---
title: "Architecture — Milestone / Optional-Goals System"
game: Tower Tycoon
author: Cloud Dragonborn (Game Architect — BMAD gds agent)
date: 2026-07-01
status: Approved-for-build
implements: GDD recommendation #1 (fill the 5k–15k pacing gap) — see gdd-core-loop-2026-07-01.md
---

# Architecture — Milestone / Optional-Goals System

Small, load-bearing addition that gives the mid-late game texture without touching
parity. Designed to be **data-driven, deterministic, cheap, and save-safe.**

## Design constraints (honor the existing engine)
- **Deterministic & headless-testable** — no wall-clock, no DOM in the engine.
- **Cheap** — evaluated once per in-game day in the existing `onDay()` hook, not per frame.
- **Fire-once & idempotent** — a milestone announces exactly once, ever, and survives save/reload.
- **Diegetic surfacing** — reuse the existing `emit(text, kind)` bulletin for the
  achievement headline; list state lives in the existing Full-Statistics modal, so
  the always-visible HUD (and thus the screenshots) is unchanged.

## Data model
`src/engine/milestones.ts` — a pure, static table (no engine imports except the
Simulation *type*, so no runtime cycle):
```
interface Milestone {
  id: string;            // stable key, persisted
  label: string;         // headline text
  desc: string;          // shown in the stats modal
  test: (sim) => boolean;// pure predicate over public sim state
}
export const MILESTONES: Milestone[]
```
**Recognition-only — deliberately NO cash reward.** The GDD found money already
trivializes the late game; paying out for milestones would worsen that and confound
the economy (it did — it broke a fire test's money-monotonicity assumption). The
reward is the headline + the checklist filling in.
Predicates read only **public** accessors that already exist: `sim.population`,
`sim.star`, `sim.hasOperational(kind)`, `sim.tower.highestFloor`,
`sim.tower.isFloorServed(floor)`, `sim.stats().vacant`.

## Runtime
- `Simulation` gains `private achieved = new Set<string>()`.
- New `checkMilestones()` called at the end of `onDay()`:
  for each `MILESTONE` whose `id ∉ achieved` and `test(sim) === true` →
  add to `achieved` and `emit("🏅 Milestone: …", "good")` (no cash).
- Public `milestoneProgress()` → `{ achieved, total, list: {label, desc, done}[] }`
  for the UI. No new per-frame work.

## Persistence
- `serialize()` emits `milestones: [...this.achieved]`.
- `deserialize()` restores it (coerced to strings; unknown ids ignored) so reload
  neither re-fires nor re-announces. `SerializedGame.milestones?: string[]` (optional → old saves load clean).

## UI
- `UI.showStats()` (the existing "Full Statistics" modal) gains a **🏅 Milestones
  X / N** checklist (done = ✓, locked = ·). No new button, no HUD row → zero
  screenshot churn. Achievement moments already surface via the bulletin.

## The milestone set (spans the arc; dense in the 5k–15k gap)
| id | label | condition |
|---|---|---|
| pop-500 | Getting Started | pop ≥ 500 |
| pop-2500 | Rising | pop ≥ 2,500 |
| pop-7500 | Metropolis | pop ≥ 7,500 |
| pop-12000 | Almost There | pop ≥ 12,000 |
| star-4 | Four Stars | star ≥ 4 |
| star-5 | Five Stars | star ≥ 5 |
| cinema | Showtime | an operational cinema |
| metro | On the Map | an operational metro |
| skyline | Touch the Sky | highest floor ≥ 100 |
| well-served | Smooth Operator | pop ≥ 5,000 AND every occupied above-ground floor is served |
| full-house | No Vacancy | pop ≥ 2,000 AND zero vacancies |

Five of eleven (pop-7500, pop-12000, star-5, skyline, well-served) sit squarely in
the 3★→TOWER plateau — the exact dead zone the GDD flagged.

## Test plan (Vitest)
- A pop milestone fires once (not twice) and appears in `achieved`.
- Fired milestones survive a serialize→deserialize round-trip (no re-fire).
- `well-served` fires for a large, fully-reachable tower (exercises the served-floor branch).

## Non-goals (this slice)
- No achievement art/toasts beyond the bulletin line; no Steam-style popup.
- No branching rewards or milestone chains — flat list is enough for the pacing fix.
