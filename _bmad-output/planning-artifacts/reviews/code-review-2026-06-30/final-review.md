# Final Review — SimTower Clone Phase-2 Remediation

Date: 2026-06-30
Scope: Post-remediation verification of the 45-finding code review (PRs #35 merged, #37 on `claude/simtower-phase2`). Suite: 109 passing.

## 1. Verdict

**The remediation is NOT yet sound.** PR #35/#37 closed most of the original 45 findings, but the v2 spatial-congestion model that backs the marquee F3 fix introduced new correctness bugs, and three previously-"FIXED" findings (F20, F24, F32) were only partially remediated. The headline regression is performance: the v2 model is ~57x slower than v1 at 100-floor endgame scale — the exact scale the TOWER win condition targets — and its 100-floor tests intermittently breach the 5s vitest timeout.

A total of **20 confirmed findings** survived verification.

| Severity | Count |
|----------|-------|
| Major    | 7     |
| Minor    | 9     |
| Info     | 4     |
| **Total**| **20**|

Root cause clustering:
- **Capacity-blind v2 load split** (R1, R3) — adding a weaker parallel shaft *increases* congestion, inverting F3's stated goal.
- **v2 on the render hot path, uncached** (R8, R11, R12, R16) — full spatial map rebuilt ~60fps and per sub-step; the F8 scalability wall is reopened.
- **Partial remediations** (R6/F24, R7/F32, R10/F20) marked FIXED but with the named sub-case still open.
- **Doc/code drift** (R4, R14, R19) — "population-weighted average" is an unweighted mean.

## 2. Confirmed Findings (most severe first)

| Sev | Category | Title | Location | Detail |
|-----|----------|-------|----------|--------|
| Major | new-bug | Capacity-blind load split: adding a low-cap shaft (stairs) INCREASES a floor's congestion | Simulation.ts:591, 600, 569 | Floor load split *equally* by shaft count (`pop*relief/shafts.length`), then floor takes MAX shaft congestion; all transports (stairs cap 8) participate. Adding a weak parallel shaft to a 1-car elevator floor raises computed congestion ~31%, flipping satisfaction +0.05→decay and driving vacate(). Contradicts F3 intent. Fix: split proportional to capacity, or compute from summed capacity; exclude/own-model stairs+escalators. |
| Major | new-bug | v2: lower-capacity parallel shaft makes a floor MORE congested (split by count, then max) | Simulation.ts:591, 596-604 | Same root as R1, reproduced end-to-end: floor-8 office on an 8-car elevator goes congestionAt 0.427→2.24 after adding a 1-car service elevator (5.25x worse), 0.913 satisfaction & falling vs 1.000. Reachable in ordinary play (smaller 2nd elevator / service elevator / co-serving stairway). |
| Major | finding-not-resolved | F24 incomplete: deserialize clamps `cars` but NOT `bottom`/`top` — corrupt save hangs the tick loop | Simulation.ts:885-888; ElevatorDispatch.ts:46; Tower.ts:609-616; Simulation.ts:571-576 | validateTransport (span/bounds) bypassed on load. A corrupt `top` (e.g. 1e9) turns every `for (fl=bottom; fl<=top)` walk into a multi-billion-iteration freeze. Probe: top=5,000,000 → one tick(60) = 522ms. Strictly worse than the original catchable RangeError. Fix: clamp bottom/top to GRID + span on load. |
| Major | finding-not-resolved | F20 not resolved: resizeTransport lets stairs/escalators exceed 1-floor span, re-opening the free-capacity exploit | Tower.ts:482; main.ts:373 | placement rejects span>1 for stairs/escalator, but resizeTransport only span-caps when `isElevatorKind`. Editor exposes Extend up/down for all transports. A span-1 stairway grown to span the tower marks every floor "served" (rent, star/TOWER gates) and adds phantom relieving capacity to spatialCongestionByFloor, yet routes 0 passengers. Defeats the v2 model the disposition claimed resolved it. |
| Major | regression | v2 default ~57x slower than v1 on a 100-floor tower; F8 wall unresolved, 100-floor tests intermittently time out | Simulation.ts:299; Crowd.ts:267,185-204; reviewFixes.test.ts:133 | F4 sub-stepping fires onHour for every elapsed hour → O(units) passes ×~48/day; Crowd.update runs spawnTrips ≤8x/sub-step, each ~4 floorsWhere() scans. servedFloors cache doesn't touch these. 20 sim-days on 100×200: v1=54ms vs v2=3083ms (~57x); crowd-stubbed still 841ms. Full-suite run hit "Test timed out in 5000ms" at line 133 (108/109), passes solo. |
| Major | risk | v2 congestion() rebuilds the full spatial map every render frame, uncached | TowerEngine.ts:302; Simulation.ts:486-494,548-606 | tick() (onPostUpdate, ~60fps) calls sim.congestion() for the decorative d.stress only; v2 path runs spatialCongestionByFloor() with 4 fresh Map allocations + O(units + transports*floors), no memoisation (unlike revision-keyed servedFloors). Per-frame GC/CPU churn at endgame scale. (R12/R16 are the same defect.) Fix: cache keyed by tower.revision + clock.hour. |
| Major | risk | (duplicate of above) v2 congestion() rebuilds full spatial map with 4 Map allocations per frame | TowerEngine.ts:302; Simulation.ts:486-494,548 | Same defect as R12; both confirmed. Drives one HUD scalar at ~60fps. |
| Minor | finding-not-resolved | F32 partial: rating/TOWER gates still accept service facilities on an UNSERVED floor | Simulation.ts:700-704 (hasOperational), 685-686, 721-724 | hasOperational excludes construction/fire state but never calls tower.isFloorServed. A Security (3★)/Medical (4★)/metro+weddingHall (TOWER) on a structure-only, elevator-less floor still satisfies the gate — the "unserved floor" sub-case F32 named. Inconsistent with collectRent (EconomySystem.ts:20) which requires isFloorServed. |
| Minor | risk | 0-car elevator from a loaded save pins every served floor to congestion=99 and steals load share | Simulation.ts:600, 884 | deserialize allows 0 cars (`Math.max(0,...)`) where setCars enforces ≥1. 0-cap shaft stays "active" (geometric stopsAt): dilutes working shafts' share and line 600's `:99` branch pins each served floor to 99 → −0.12 satisfaction/hr, mass-vacate after load. Fix: clamp to min 1, or exclude zero-cap shafts. |
| Minor | regression | v2 spatial congestion recomputed uncached every render frame (F8-class cost in draw path) | TowerEngine.ts:302; Simulation.ts:487-494 | Same family as R12/R16: v1 was O(units+transports) single pass; v2 is O(transports*floors + units) with no revision cache, run ~60fps. Correctness unaffected. |
| Minor | quality | congestion() v2 doc says "population-weighted average" but computes an unweighted mean | Simulation.ts:488-494 | `sum += c; n++; return sum/n` over per-floor values — no population term, so one stressed floor among many quiet ones is under-reported in the HUD scalar. (R14, R19 are the same.) |
| Minor | quality | (duplicate) congestion() v2 "population-weighted" comment vs unweighted mean | Simulation.ts:488,492-494 | Same doc/code mismatch as R4. HUD-only. |
| Minor | quality | Doc/code drift: "population-weighted" + metro relief "near lobbies" | Simulation.ts:488,492-494,545,586 | Adds the second drift: relief is a single global scalar applied uniformly (`pop*relief`), not lobby-proximity-weighted as the comment claims. |
| Minor | risk | congestionAt() rebuilds the entire spatial map per call — latent O(F²) trap; new public surface is test-only | Simulation.ts:532-537,757-759,69-71 | congestionAt/fireContainmentChance/hourTicks have no production callers (only phase2.test.ts). A future per-floor inspector loop over congestionAt → O(F²) full rebuilds. Dead-today public surface + perf trap tomorrow. |
| Minor | risk | lobbyFloors() (O(units)) recomputed per-transport every tick in dispatch | ElevatorDispatch.ts:50; Tower.ts:532 | F27 fix put `new Set(tower.lobbyFloors())` inside the per-transport loop; identical loop-invariant set rebuilt once per shaft, ×sub-steps. Hoist above the loop. |
| Minor | regression | v2 stress meter reads 0 (calm) when an occupied tower loses all elevator service (v1 reported max) | Simulation.ts:491,510,590 | v1 returns 3 when capacity≤0 & pop>0; v2 skips unserved floors, returns 0 for empty map. HUD shows calm for a fully stranded tower (gameplay churn still occurs via the separate !served path). |
| Info | finding-not-resolved | F39 second half unaddressed: Crowd spawn accumulator grows unbounded; popFactor amplifies it ≤3x | Crowd.ts:271-278 | spawnAcc adds ≤~396/sub-step, drain capped at `guard<8` and spawnTrips early-returns at MAX_PEOPLE; nothing caps/decays spawnAcc. Backlog masks day/night rhythm (visible crowd pinned to 140). Cosmetic; no overflow. |
| Info | quality | spatialCongestionByFloor counts parking in any state but gates metro on fire/construction (asymmetric relief) | Simulation.ts:556-557 | A burning parking space still grants congestion relief; metro is correctly state-gated. Cosmetic (population-0 facilities). |
| Info | quality | v2 9am elevator-complaint keys off worst-floor congestion vs v1's tower-wide scalar; same 1.4 threshold | Simulation.ts:443-448 | globalCong = max-over-floors in v2 vs tower-wide value in v1, but `>1.4` unchanged → toast fires materially more often. Threshold not re-tuned for changed semantics. |
| Info | risk | Re-derived TOWER_POPULATION=8000 rests on an unverifiable "measured ~8,900" number (margin is sound) | facilities.ts:319-325,87; Tower.ts:651 | "occupants only" claim matches code (totalPopulation sums only office/condo/hotel). Suite pop 2→3 only raises the ceiling, so 8000 keeps margin. No defect — flags an unaudited target rather than a derivable formula. |

## 3. Original 45 Findings — Resolution Status

The bulk of the original review is resolved or correctly decided by PRs #35/#37 (caps, recycling, income cap, anti-bunch dispatch, idle-at-lobby, coverage radius, pop-scaled spawn, security minStar, suite pop, F4 hourly clock, F8 servedFloors cache, etc.). The following dispositions are **NOT fully resolved** and must be reopened:

- **F20** (stairs/escalator span exploit) — marked "RESOLVED by the spatial model"; resizeTransport still permits unbounded stair span. **NOT resolved** (R10).
- **F24** (corrupt save crashes tick loop) — marked FIXED; only `cars` was clamped, `bottom`/`top` remain unclamped → worse-than-original hang. **Partially resolved** (R6).
- **F32** (gates accept non-operational facilities) — marked FIXED; state cases closed but the unserved-floor/reachability sub-case remains. **Partially resolved** (R7).
- **F39** (crowd spawn) — only the rate-scaling half fixed; unbounded accumulator remains (and popFactor amplifies it). **Partially resolved** (R9, info).
- **F8** (scalability) — only servedFloors was memoised; v2 reintroduces an O(units) per-hour and per-frame cost that the cache does not cover. **Regressed at 100-floor scale** (R8, R11, R12, R16).

All other original findings appear resolved or appropriately decided.

## 4. Top Recommendations

1. **Fix the v2 load split (R1/R3) before anything else** — split travelling population proportional to shaft capacity (or compute floor congestion as summed-load / summed-capacity). This single change removes the F3-inverting bug and is prerequisite to F20 mattering.
2. **Memoise spatialCongestionByFloor** keyed by `tower.revision + clock.hour` and stop calling congestion() every render frame (R8/R11/R12/R16). Recompute on the hour, not at 60fps. This also reduces the R11 sub-stepping regression.
3. **Complete the partial remediations**: clamp transport `bottom`/`top` and `cars≥1` in deserialize (R6, R2); add `isFloorServed` to hasOperational (R7); span-cap stairs/escalator in resizeTransport (R10).
4. **Add heterogeneous-shaft and corrupt-save tests** — current tests only pair equal 1-car elevators and only probe NaN car counts, which is why R1/R3/R6 passed at 109/109.
5. **Reconcile docs** (R4/R14/R19): either implement a true population-weighted average or fix the comments; re-tune the 9am 1.4 threshold for v2 max semantics (R15).

---

EXECUTIVE SUMMARY: Remediation NOT sound — 20 confirmed findings (7 major, 9 minor, 4 info). Most original findings are resolved, but F20/F24/F32/F39/F8 are only partially fixed and the new v2 spatial-congestion model is both buggy and a perf regression. Single most important item: the capacity-blind v2 load split (R1/R3) makes adding a weaker parallel shaft INCREASE a floor's congestion, inverting the F3 goal and evicting tenants — fix the split (proportional to capacity) before shipping.
