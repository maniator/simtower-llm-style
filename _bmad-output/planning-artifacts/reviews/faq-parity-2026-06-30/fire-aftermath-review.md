# PR #71 — "Fire destroys rooms" (gutted UnitState) — Merge-Readiness Review

**Date:** 2026-06-30
**Branch:** claude/verticopolis-fire-aftermath (head 7a660a8)
**Verdict:** **NOT SAFE TO MERGE** — 1 confirmed blocker defeats the PR's core invariant for all commercial venues; the test suite masks it.

The PR's intent — a burned room becomes an inert `gutted` shell instead of auto-repairing to a re-leasable vacancy — is correctly implemented for offices/condos/hotels/service kinds and for save/RNG/safety-valve/refund paths. But the `isOperational()` sweep missed the hourly traffic-income loop, so every flammable **commercial** room (the majority of fire victims) silently resurrects itself.

---

## Blockers

### B1 — Gutted commercial venues self-resurrect to "occupied" and keep earning
**Location:** `src/engine/EconomySystem.ts:58` (guard) and `:65` (`u.state = "occupied"`) — `collectTrafficIncome()`
`collectTrafficIncome()` runs every hour (`Simulation.onHour`). Its per-unit guard is still the pre-PR
`if (u.state === "construction" || u.state === "fire") continue;` — it was **not** routed through `isOperational(u)` like every other guard in the PR, so `gutted` falls through. On a served floor during open hours execution reaches `u.state = "occupied";`, un-gutting the shell, then accrues `pendingIncome`/`money`. Every kind in `ECON.dailyTrafficIncome` (fastFood, restaurant, shop, cinema, partyHall) is flammable, so the whole commercial category is affected. Once flipped to `occupied` the room is never re-inerted (`updatePresence` only zeroes empty/construction/fire/gutted), counts toward population/`countOperational`/star gates/coverage, becomes flammable again, and its sell/refund reverts from $0-scrap to the full 50% refund. Reproduced at runtime (gut a shop/restaurant, tick ~24–48h → state returns to `occupied`).
**One-line fix:** change `src/engine/EconomySystem.ts:58` to `if (!isOperational(u)) continue;` (`isOperational` is already imported and used elsewhere in this file).

*(Consolidates duplicate reports F1, F2, F5, F9, F14, F19 — same root defect.)*

### B2 — Regression tests are office-only, so B1 passes CI vacuously
**Location:** `src/tests/fire.test.ts` — `firePrep()` builds only offices; used by every case incl. "never re-leases or earns" and "survives save/load".
Offices have no `dailyTrafficIncome` entry and lease only via `attemptMoveIns` (state==="empty"), so a gutted office is genuinely inert and every assertion holds trivially — while never exercising `collectTrafficIncome`, the exact path that regresses. The suite green-lights the PR with its headline behavior broken for all commercial rooms.
**One-line fix:** add a case that guts a commercial venue (e.g. shop or cinema) on a served, open floor, ticks a full day, and asserts `state` stays `"gutted"` and money does not rise from that unit (fails today; passes once B1 is fixed).

*(Consolidates F3, F6, F10, F15, F20.)*

---

## Majors
None beyond B2 (several reviewers rated the test-coverage gap major; escalated to blocker here because it is what lets B1 ship).

---

## Minors (fix opportunistically; not merge-blocking)

- **M1 — Cinema inspector shows a fake "Now showing" for a gutted cinema.** `src/main.ts:762` uses raw `u.state !== "construction" && u.state !== "fire"` (not `isOperational`), so a burned-out cinema renders "Feature"/"Blockbuster" instead of "—" next to its own "Scrap value $0" row. Fix: `const operational = isOperational(u);` (add the import to main.ts). *(F4, F7, F16, F21)*
- **M2 — Gutted parking prints a bogus ramp-access verdict / dead-marker via the old check.** `src/main.ts:~1247` (legacy inspector) and `src/render/excalibur/TowerEngine.ts:869` gate on construction/fire only; a gutted parking tile shows "Ramp access: none…" advice instead of a bulldoze/rebuild message. Fix: route both through `isOperational(u)`. *(F12, F17)*
- **M3 — Bomb blast un-guts nearby gutted rooms to re-leasable "empty".** `src/engine/EventSystem.ts:~340` rewrites in-range units to `state="empty"` guarding only `!== "construction"`, silently free-rebuilding a gutted shell. Pre-existing bomb mechanic, narrow trigger (4★+, no security, ransom declined, within ±2 floors), but inconsistent with the new destroy→gutted canon. Fix: exclude gutted or gut rather than empty in-range units. *(F11, F18)*

---

## Verified clean (no action)
Save round-trip (gutted persists via spread; re-arm filter keys on `state==="fire"` so no re-ignite after load), RNG determinism (one `rng.chance(control)` per active fire/day unchanged; controlChance 0.45→0.50 changes only the probability arg; safety valve and spread consume no RNG), death-spiral/safety-valve correctness (valve only blocks spread into the last operational room of a kind; ignited room always eventually contained — no soft-lock), and refund/sell paths ($0 for gutted, no negative/NaN money). *(F8, F13 — accurate within their scope, but do not clear the PR because of B1.)*

---

## Merge recommendation
Fix **B1** (one line) and add the **B2** commercial-venue regression test before merge. M1–M3 are cosmetic/edge-case cleanups that can follow.
