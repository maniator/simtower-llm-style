# Second Re-Verification — PR #44 (SimTower clone) — Merge Verdict

**Verdict: SAFE TO MERGE.**

Verified at fix commit HEAD `a6b25fd`. The prior gate's blocker (V1/V3: ESC/backdrop-dismissing the emergency modal froze the sim because `main.ts` `update()` early-returns while `shownChoice` and it was never cleared on dismiss) is genuinely resolved, and the two minors (V2, V4) are present and correct. `134` tests passing. Zero surviving blocker- or minor-severity findings; all five findings below are informational confirmations.

## Confirmed findings (all info — no defects)

1. **V1/V3 modal-deadlock RESOLVED — every close path resolves exactly once and clears `shownChoice`.** `src/ui/UI.ts` `showEventChoice` (lines 492-516) routes all four close paths — accept button (512), decline button (513), backdrop click `dialog.onclick` with `e.target===dialog` (514), and Esc `dialog.oncancel` (515) — through a single idempotent `finish(opt)` guarded by a `done` boolean (505-511) that calls `this.closeModal()` then `onResolve(opt)` exactly once; dismissal counts as decline. `src/main.ts` `onResolve` (309-312) calls `sim.resolveChoice(opt)` then sets `this.shownChoice = false`, lifting the `update()` early-return freeze (273-276) so the sim resumes. Verified: `showEventChoice` calls `openModal` first (493) — which installs bare closeModal-only handlers (381-384, the original bug) — then synchronously OVERRIDES `dialog.onclick`/`dialog.oncancel` with the `finish` variants (514-515), so the dangerous handlers are fully replaced. No double-fire (button click `e.target` is the button, not the dialog), no re-entrancy (`closeModal`'s `dialog.close()` is guarded by `if (dialog.open)` and the `done` guard absorbs any re-fire), and no reachable second-modal path can strand `shownChoice=true` (emergency modal uses `showModal()`; the only keydown handlers change speed / palette and never open a modal). No path leaves the sim frozen or double-resolves.

2. **V2 (`treasuresFound` clamp) confirmed.** `src/engine/Simulation.ts` (1065-1068) sets `treasuresFound = Math.max(0, (typeof data.treasuresFound === "number" && Number.isFinite(data.treasuresFound)) ? data.treasuresFound : 0)`. Negative → 0; NaN/±Infinity → 0; non-number → 0; valid non-negative passes through. Closes the D10 negative-value farm-reopen exploit against the sole gate `treasuresFound < 3` (line 273). No upper clamp needed (a large value only further disables the farm).

3. **V4 (help text) confirmed.** `src/ui/UI.ts` line 480 now reads "2★ at 300, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical, Recycling, suites & a VIP), 5★ at 7,000 (needs a Metro)", matching `STAR_THRESHOLDS` `{2:300,3:1000,4:5000,5:7000}` and the `evaluateStar` gates in `facilities.ts`/`Simulation.ts`.

**SAFE TO MERGE.**
