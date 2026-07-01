# Fix Re-Verification — PR #44 (SimTower complete-parity)

**Date:** 2026-06-30
**Fix commit:** `1acb3f0` — "Fix the deep-review blockers on the complete-parity work (pre-merge)"
**Baseline review:** `deep-review.md` (6 blockers + D6/D7/D26)
**Tests:** `src/tests/faqComplete.test.ts` — 134 passing (headless).

---

## Verdict: NOT SAFE TO MERGE

The 6 original blockers are functionally addressed, but the **D13 fix introduces a NEW blocker-grade regression**: dismissing the emergency modal via Escape or a backdrop click permanently freezes the game clock with no in-session recovery. This is a strictly worse failure mode than the bug D13 set out to fix.

---

## Original 6 blockers

| ID  | Blocker | Status | Evidence |
|-----|---------|--------|----------|
| D1  | Cockroaches spread with zero housekeeping | RESOLVED | Spread relocated after `runHousekeeping` in hotel-checkout path; both-neighbour gate present (`EconomySystem.ts`). |
| D14 | 5★ threshold 10000→7000 (winnable endgame) | RESOLVED (code) | `STAR_THRESHOLDS[5] = 7000` with rationale comment `facilities.ts:331-337`; 5★(7000) < TOWER(8000) < ~8900 ceiling. **See V4 — help copy not updated.** |
| D10 | Buried treasure uncapped / farmable | RESOLVED (runtime) | Per-tower cap `this.treasuresFound < 3` at `Simulation.ts:273`, persisted via `treasuresFound`. **See V2 — restore path not clamped.** |
| D13 | Emergency modal doesn't pause sim | RESOLVED for the buttons, **BUT introduces a new deadlock** | `main.ts:273-276` early-returns `update()` while `shownChoice`. **Regressed via ESC/backdrop — see V1/V3.** |
| D25 | Office noise drains satisfaction to 0 | RESOLVED | `updateSatisfaction` now caps (floors) at 0.6 instead of draining. |
| D24 | Pending choice lost on save/load | RESOLVED | `EventSystem.saveState/loadState` + `types.ts` serialize/restore pending. |
| D6  | `checkVip` re-checks operational metro | RESOLVED | Present in event/VIP path. |
| D26 | VIP nag throttle | RESOLVED | Throttle added. |
| D7  | Both-neighbour cockroach check | RESOLVED | Included in D1 fix. |

**Net: 6/6 addressed in the happy path, but D13's mechanism creates a new blocker (below).**

---

## New findings introduced by the fixes

### V1 / V3 — [BLOCKER] D13 sim-freeze + ESC/backdrop dismissal = permanent, unrecoverable softlock
`src/main.ts:273-276` + `src/ui/UI.ts:381-384, 492-503`

The D13 fix makes `update()` early-return (`this.accMinutes = 0; return;`) whenever `shownChoice` is true, so the sim only advances again once `shownChoice` is reset. `shownChoice` is reset in exactly two places, **both after the line-273 early-return and both unreachable while it is true**:
- `main.ts:311` — the `onResolve` callback, wired by `UI.ts:501-502` **only** to the accept/decline button clicks.
- `main.ts:314` — the `!pc && shownChoice` self-heal branch; unreachable because it sits below the early-return and `pc` can never clear (the sim never ticks).

The emergency modal is created via `openModal`, which also wires `dialog.oncancel` (Escape, `UI.ts:384`) and `dialog.onclick` backdrop-close (`UI.ts:381-383`). **Both call `closeModal()` directly and never invoke `onResolve`.** So if the player presses Escape or clicks the backdrop — the reflexive way to dismiss any `<dialog>` — the modal closes visually, `onResolve` is never called, `shownChoice` stays true, `events.pending` stays non-null, and `update()` early-returns every frame forever. No visible modal, no in-session recovery; only page reload / load-game recovers (losing progress since the last 30s autosave).

Pre-D13 this was benign: the loop kept running and the engine auto-declined the stale pending at the next daily roll. **The fix converts a harmless dismissal into a fatal deadlock.**

Confirmed against source. Verified: `openModal` (`UI.ts:375-385`) wires cancel/backdrop to `closeModal` only; `showEventChoice` (`UI.ts:492-504`) is the sole path to `onResolve`; `closeModal` (`UI.ts:386-390`) only does `dialog.close()` + clear innerHTML and never touches `shownChoice` or `resolveChoice`.

**Fix:** route the emergency modal's `oncancel`/backdrop-close through `onResolve('decline')`, or reset `shownChoice` whenever the modal closes, or disable ESC/backdrop dismissal for `showEventChoice`.

*(V1 and V3 are the same defect filed at blocker and major severity respectively; treated here as one blocker.)*

### V2 — [MINOR] `treasuresFound` restored without a lower clamp, re-opening D10 via hand-edited save
`src/engine/Simulation.ts:1063`

`sim.treasuresFound = typeof data.treasuresFound === "number" ? data.treasuresFound : 0;` has no lower clamp, unlike the adjacent `num()` clamps (1072+) that exist explicitly because saves are untrusted. A hand-edited save with `treasuresFound: -1000000` passes the `typeof` guard, and the cap check `this.treasuresFound < 3` (`Simulation.ts:273`) then stays true for ~a million more finds, reopening the D10 money farm. (NaN is safe: `NaN < 3` is false; the vector is specifically a negative number.) Requires deliberate save-editing, but inconsistent with the file's stated threat model. **Fix:** `Math.max(0, num(data.treasuresFound, 0))`.

### V4 — [MINOR] Help text still advertises the old 5★ = 10,000 threshold
`src/ui/UI.ts:480`

D14 lowered `STAR_THRESHOLDS[5]` to 7,000 but the in-game How-to-play modal still reads "...5★ at 10,000." Cosmetic documentation regression introduced alongside the threshold change; no functional impact. **Fix:** update help copy to "5★ at 7,000."

---

## Summary

- **All 6 original blockers** are resolved in behavior for the intended (button-click) path.
- **1 NEW blocker** (V1/V3) introduced by the D13 fix: ESC/backdrop dismissal of the emergency modal permanently freezes the sim.
- **2 minor** follow-ups (V2 untrusted-save clamp; V4 stale help copy).

Merge is blocked on V1/V3. The one-line fix (resolve as `decline` on cancel/backdrop) is small and self-contained; ship it plus the two minors, then re-verify.

---

**VERDICT: NOT SAFE TO MERGE — D13 fix introduces a new blocker: ESC/backdrop-dismissing the emergency modal permanently freezes the sim with no in-session recovery (main.ts:273-276 + UI.ts:381-384).**
