# PR #61 — Economy Depth: Merge-Readiness Review

**PR:** #61 — "Economy depth: operating overhead + blockbuster-as-a-choice (designer→architect→build)"
**Branch:** `claude/simtower-prd` @ `0b2bcaa` vs `origin/main`
**Reviewer:** Deep review (source-grounded)
**Date:** 2026-06-30
**Scope:** `git diff origin/main...HEAD` — 12 files, +578/-13. Engine: `EconomySystem.ts`, `Simulation.ts`, `econConfig.ts`, `types.ts`. UI: `main.ts`, `ui/UI.ts`. Tests: `economyDepth.test.ts` (new), `faqComplete.test.ts`, `subsystems.test.ts`. Docs: GDD/arch economy-depth + one help screenshot.
**Grounding:** `_bmad-output/project-context.md`, `gdd-economy-depth-2026-07-01.md`, `arch-economy-depth-2026-07-01.md`.

---

## Verdict

**SAFE TO MERGE.** Zero blocker and zero major findings. Both parts of the feature are implemented faithfully to the GDD/arch spec, the design guardrails hold in real source (no RNG for the overhead line, no new punitive drain on sold condos, no save migration, deterministic per-policy cinema bookings), and the suite is green (172 pass, tsc + lint clean). Two **info**-level items remain as non-blocking follow-ups: a cosmetic "Now showing" contradiction for non-operational cinemas, and one absent arch-spec determinism test whose underlying property nonetheless holds.

---

## What was verified in source

**#4 Operating overhead**
- `ECON.overheadPerLeasableUnitMonthly = 700` (`econConfig.ts:29`) and `isOverheadKind(kind)` = `rentConfig(kind) !== null || ECON.dailyTrafficIncome[kind] !== undefined` (`econConfig.ts:62-64`) — matches the arch "load-bearing predicate".
- `EconomySystem.payMaintenance` (`EconomySystem.ts:201-203`) charges overhead only when `operational && isOverheadKind(u.kind) && !(u.kind === "condo" && u.everOccupied)` — i.e. sold condos exempt, and construction/fire units exempt via the shared `operational` flag (line 191). Pure arithmetic; **no RNG on this line** — confirmed.
- Income path (`collectTrafficIncome` / rent) is untouched, so overhead is a charge on space *held* while income stays keyed to occupancy — the intended "vacant/unserved floor = pure carrying cost" behavior.

**#5 Blockbuster policy**
- `Unit.filmPolicy?: "auto" | "feature" | "blockbuster"` added optional (`types.ts:108-110`); `undefined ⇒ auto` legacy 40% roll.
- Booking branch (`EconomySystem.ts:208-213`): `blockbuster` resolves to `true`/`false` for feature/blockbuster and only `auto` calls `this.sim.rng.chance(0.4)` — RNG consumed in the identical position as before for default cinemas, so legacy games are stream-identical (arch guardrail line 95).
- Serialization via `{...u}` spread; `deserialize` coerces to a valid literal or `undefined` (`Simulation.ts:1192-1196`). `blockbusters` (this-month result) and `filmPolicy` (standing choice) persist orthogonally.
- `Simulation.setFilmPolicy` null-guards non-cinemas; `isShowingBlockbuster` reads `economy.blockbusterIds` (`Simulation.ts:802-814`).
- UI: editor render-key folds in `filmPolicy` so cycling rebuilds the button (`main.ts:422-424`); volatile `showing` field, "Now showing" row, and `filmPolicy` cycle action wired (`main.ts:451, 473-475, 622-627`); one help `<li>` added (`UI.ts:556`).

**Tests:** `economyDepth.test.ts` covers `isOverheadKind`, vacant-space overhead, construction exemption, feature/blockbuster policy, `setFilmPolicy` null-guard, and save/load + garbage coercion. `subsystems.test.ts` verifies the sold-condo exemption (arch item #4). `faqComplete.test.ts` two-tier booking assertion updated to include the overhead term.

---

## Findings by severity

### Blocker
None.

### Major
None.

### Minor
None.

### Info (non-blocking follow-ups)

**[F2] "Now showing" claims a film for a cinema booking none (construction/fire)** — `src/main.ts:451`, `src/main.ts:473`
`unitEditorVolatile` computes `vol.showing = this.sim.isShowingBlockbuster(u.id) ? "Blockbuster" : "Feature"` — a binary with no "not showing" state — and `unitEditorHtml` unconditionally renders the "Now showing" row for any cinema, with no state/operational guard. `isShowingBlockbuster` → `economy.blockbusterIds`, a set cleared monthly (`EconomySystem.ts:184`) and populated only for `operational` cinemas (`EconomySystem.ts:208-213`). A cinema under construction or on fire is never in the set, so it renders "Feature" despite booking no film at all.
- *Repro:* place a cinema, select it while still building → card shows `Status: construction` next to `Now showing: Feature`.
- *Impact:* purely cosmetic — the field feeds display only; economy/appeal reads `this.blockbusters.has(u.id)` directly (`EconomySystem.ts:76`), correctly excluding non-operational cinemas. No state, economy, or save-load effect.
- *Fix:* in `unitEditorVolatile`, guard the field on operational state, e.g. `const op = u.state !== "construction" && u.state !== "fire"; vol.showing = !op ? "—" : this.sim.isShowingBlockbuster(u.id) ? "Blockbuster" : "Feature";` (dash reads correctly for both construction and fire). No HTML-row change needed.

**[F3] Arch-specified determinism test (#6 "No RNG consumed") is absent** — `src/tests/economyDepth.test.ts`
Arch test-plan item #6 (`arch-economy-depth-2026-07-01.md:156`) calls for two identical-seed sims — one with extra overhead-only units — asserting an independent RNG-driven outcome (company names / weather) is unchanged, proving overhead touches no stream. The new suite does not include this test.
- *Impact:* coverage gap against the design spec, **not** a behavioral defect. The property holds in source: the overhead line is pure arithmetic (no `rng`), and the cinema `rng.chance(0.4)` is consumed in identical iteration order only for default `auto` policy.
- *Note:* the arch test plan is only partially implemented overall (items #3, #6, #7, #10, #11, #14 not present; #4 sold-condo exemption lives in `subsystems.test.ts` rather than the new file). #6 is the specifically flagged gap.
- *Fix:* add a test building two seed-identical `Simulation`s, run N months, and assert an independent RNG-driven output (e.g. generated company/tenant names or a weather sequence) is byte-identical between the two — one sim with 3-4 extra overhead-only offices, the other without. Closes the arch determinism claim explicitly.

---

## Guardrail scorecard (design intent vs. source)

| Guardrail (GDD/arch) | Status |
|---|---|
| Overhead: no RNG | Pass — pure arithmetic (`EconomySystem.ts:201-203`) |
| Overhead: no new save field | Pass — derived from tower state |
| Overhead: non-punitive, self-scaling | Pass — flat per-unit, income unchanged |
| Sold condos exempt from overhead | Pass — `!(kind==="condo" && everOccupied)`; test in `subsystems.test.ts` |
| Construction/fire units exempt | Pass — shared `operational` flag; test in `economyDepth.test.ts` |
| Default cinema = legacy 40% roll, stream-identical | Pass — `auto` consumes `rng.chance(0.4)` in original position |
| `filmPolicy` serialized + coerced on load | Pass — spread serialize + literal-guard deserialize; test present |
| UI render-key rebuild on policy change | Pass — policy folded into editor key |
| tsc + lint + suite (172) green | Pass (per PR) |

---

## Recommendation

Merge. File F2 and F3 as low-priority follow-ups (a one-line UI guard and one determinism test respectively); neither affects economy state, save compatibility, or determinism.

**One-line verdict:** SAFE TO MERGE — zero blocker/major; highest-severity item is INFO F2 (cosmetic "Now showing: Feature" shown for a construction/fire cinema that is booking no film; display-only, no economy or save effect).
