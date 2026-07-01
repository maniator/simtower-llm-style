# PR #46 — Merge-Readiness Review: Canon Numbers (lot→340, 15k/10k, ≤2-ride, blockbuster, strict parking)

- **Repo:** simtower-llm-style (TypeScript + Excalibur.js)
- **Branch under review:** `origin/main...HEAD` (4 commits: `e322e85` lot→340 + canon 15k/10k; `da0efe2` ≤2-ride + blockbuster + strict parking; + docs)
- **Reviewed:** 2026-06-30
- **Test status:** 140 tests pass.

## Verdict

**NOT SAFE TO MERGE AS-IS — 3 confirmed `major` issues (0 blockers).** All three are fixable without touching the diff's core intent; recommend addressing the two performance/logic majors before merge, and either fixing or explicitly deferring the blockbuster-serialization major with a tracked follow-up. Once the majors are resolved the remaining minors/infos are safe as follow-ups.

## Severity roll-up

| Sev | Count (distinct) | Items |
|-----|------------------|-------|
| Blocker | 0 | — |
| Major | 3 | Parking flood-fill perf (F14/F19); parking flood-fill over-count (F15/F18); blockbuster state not serialized (F9, disputed — see note) |
| Minor | 5 | metro.width literal (F1/F5); ≤2-ride crowd suppression (F7/F16); stale blockbuster after fire (F10); blockbuster net-negative EV (F12); blockbuster not serialized (F11/F20, same defect as F9 rated minor) |
| Info | 4 | 5★/TOWER coupled to width (F2); off-center legacy saves (F3/F6); bulldozed-cinema Set leak (F13); routing-cap vs isFloorServed divergence (F8) |

> **Duplicate/severity note:** the "blockbuster Set not serialized" defect appears three times (F9 `major`, F11 `minor`, F20 `minor`). It is one bug. F9's own rationale bounds the impact (one cinema, remainder of one month, mid-month reload only) and self-describes as "major, not blocker"; F11/F20 rate the identical mechanism `minor`. Treated here as the **conservative max = major**, but it is the softest of the three majors and a reasonable candidate to ship-with-follow-up if the team accepts a one-month save/reload income divergence.

---

## MAJOR (fix before merge)

### M1 — `functionalParkingSpots()` runs an uncached O(tiles × units) flood-fill every render frame (F14, F19)
**Location:** `src/engine/Tower.ts:667` (roomAt at `Tower.ts:57-59`); invoked per-frame via `src/render/excalibur/TowerEngine.ts:354`.

`functionalParkingSpots()` flood-fills the parking region and calls `roomAt(f,x)` for every visited tile; `roomAt` is a linear `this.units.find(u => u.id === rid)`, making the routine O(visitedTiles × units) with **no revision cache** (unlike `servedFloors()`/`servedFloorSet()` in the same file, which memoize on `servedRev === revision`). It sits on the per-frame path: `TowerEngine.tick` is bound to `onPostUpdate` (every frame), line 354 unconditionally calls `sim.congestion()`, `simModel` defaults to `"v2"`, and `congestion() → spatialCongestionByFloor() → functionalParkingSpots()`. It also runs while paused (the call precedes the pause guard) and twice more per sim-hour via `officeParkingShort()` and the v1 path. This scales with **exactly** what this PR increases (340-wide lot, ~15k pop, large basement) — ~10^6 comparisons/frame at 60fps on the endgame tower the PR targets, causing frame drops when the tower is largest.

**Fix:** memoize by `tower.revision` following the existing `servedFloors` pattern (guard on a stored `parkingRev`/`parkingCache`), and/or index rooms by tile for O(1) `roomAt`. Note the revision guard must also invalidate on `u.state` transitions (construction/fire) if those don't bump `revision`.

### M2 — Parking flood-fill chains parking→parking vertically with no ramp, over-counting functional spots (F15, F18)
**Location:** `src/engine/Tower.ts:686` (also 667-689).

The flood-fill unconditionally pushes vertical neighbours `[f-1,x]` and `[f+1,x]` for **every** usable tile, and `usable()` accepts any `parking` tile — so two parking spaces stacked on adjacent basement floors connect even when **neither** tile is a ramp. This contradicts the function's own docstring ("vertically between stacked ramps") and canon (cars change floors only through a ramp), and defeats the PR's headline "strict parking chains (canon)" / "dead X" anti-cheese. Concrete over-count: ramp on B-3 `x=0..5` + parking B-3 `x=6..11` (legit), plus parking B-2 `x=6..11` with **no** ramp on B-2 — the fill jumps straight up and marks the physically-unreachable B-2 spaces as functional. This inflates capacity in v1 congestion (`Simulation.ts:577`), over-applies v2 relief (`Simulation.ts:632`), and under-reports shortage in `officeParkingShort()` (`Simulation.ts:706`). The lone parking test (`faqComplete.test.ts:354`) only exercises single-floor horizontal chaining, so this is unpinned.

**Fix:** allow a vertical step only when the current **or** target tile is a `parkingRamp` (guard the vertical-neighbour push). Add a regression test for the stacked-parking-no-ramp layout.

### M3 — `blockbusters` Set is not serialized; paid boost lost on mid-month save/reload (F9; dup F11/F20)
**Location:** `src/engine/EconomySystem.ts:17`; serialize/deserialize at `src/engine/Simulation.ts:1012-1128`.

`EconomySystem.blockbusters` is private in-memory state, booked and charged (300k `cinemaBookingBlockbuster`) in `payMaintenance` at the month boundary and read hourly in `collectTrafficIncome` for `filmMult = 1.7`. `serialize()` never writes it and `deserialize()` builds a fresh `Simulation → new EconomySystem` with an empty Set. Worse, `deserialize()` sets `lastMonth = Math.floor(clock.day/30)` (`Simulation.ts:1125`), so `payMaintenance` won't re-derive it until the **next** month boundary. Result: a mid-month reload silently reverts the cinema to `filmMult=1` for the rest of the month even though the 300k was already spent — and breaks the stated save/load reproducibility invariant (RNG stream is preserved; the economy Set diverges). Inconsistent with the deliberately-persisted `excavated`/`treasuresFound`/`vipVisitDay` fields.

**Fix:** in `serialize()` emit `blockbusters: [...this.economy.blockbusters]`; in `deserialize()` restore it coerced to numbers (like other untrusted fields). Fixing M3 also naturally supports a clean fix for the F10 fire-flag bug below.

---

## MINOR (follow-ups)

### m1 — `metro.width` is a hand-duplicated `340`, the only lot-width value not derived from `GRID.width` (F1, F5)
**Location:** `src/engine/facilities.ts:287`.
Bumped 200→340 by hand this diff while `GRID.width=340` lives independently (`facilities.ts:357`); the metro's own comment claims it "Spans the full lot width" but nothing couples them. Placement only checks `x + f.width > GRID.width` (`Tower.ts:181/240/374`), so full-width placement works solely because both equal 340. Currently consistent; a future `GRID.width` change that misses this line silently breaks spanning (increase) or makes the metro unplaceable (decrease).
**Fix:** `width: GRID.width`, or add a test asserting `FACILITIES.metro.width === GRID.width`.

### m2 — ≤2-ride cap suppresses crowd sprites on occupied floors needing 3+ legs (F7, F16)
**Location:** `src/engine/Crowd.ts:142-150` (with `facilities.ts:471-489`).
`route()` caps BFS at `MAX_RIDES=2` and `add()` early-returns on null, so a well-zoned stacked-escalator podium (1↔2↔3↔4↔5, one escalator per gap) or standard-elevator transfer stack (1→30→60→88) spawns **no** pedestrians to floors reachable in 3+ rides — even though `isFloorServed` (unbounded) leases them, collects rent, and counts them toward star/TOWER. Cosmetic only: `crowdStress` is deliberately not fed back into satisfaction/economy (`Simulation.ts:533-538`). The PR rationale ("commuters give up rather than teleporting") misfires on legitimately-zoned towers.
**Fix (optional):** raise `MAX_RIDES` to match a realistic transfer depth, or fall back to a longer route for sprite-spawning while keeping the "give up" semantics for HUD stress. Acceptable to defer as intended cosmetic behavior.

### m3 — Stale blockbuster flag survives a fire, granting a free +70% boost after repair (F10)
**Location:** `src/engine/EconomySystem.ts:184-192`.
`this.blockbusters.delete(u.id)` lives inside the guard skipping `state === "fire"`, so a cinema on fire at the month rollover keeps its stale id (pays nothing, doesn't re-roll); once extinguished, `collectTrafficIncome` reads `has(u.id) → true` and applies `filmMult=1.7` free for the rest of the month.
**Fix:** clear the flag unconditionally at the top of `payMaintenance` (or `this.blockbusters.clear()` before re-rolling), independent of unit state.

### m4 — Blockbuster is strictly net-negative EV vs an average film (F12)
**Location:** `src/engine/EconomySystem.ts` (booking roll line 186; income line 64; `econConfig.ts`).
At appeal=1: average film nets +42k/month (after 150k), blockbuster nets +26k (after 300k) — ~16k worse, and appeal is hard-capped at 1 so +70% can never cover the doubled cost in any regime. Since the 40% roll is forced (not a player choice), a blockbuster month is always the worse outcome — inverting "draws bigger crowds."
**Fix (balance):** raise the blockbuster multiplier or lower `cinemaBookingBlockbuster` so blockbuster EV > average-film EV; or make it a player-triggered choice.

---

## INFO (note only)

- **i1 — 5★/TOWER targets coupled to width=340 by comment only (F2):** `STAR_THRESHOLDS[5]=10000`, `TOWER_POPULATION=15000`; only guard is `faqComplete.test.ts` D14 (`<= 15100`, hard-coded). A future `GRID.width` reduction silently soft-locks the endgame. Correct at 340. *Consider a test tying reachable population to `GRID.width`.*
- **i2 — Legacy 200-wide saves render off-center after widening (F3, F6):** `SerializedGame` stores no grid width; loaded 200-era towers render left of the new center (170). Purely cosmetic, recoverable by panning; `.TWR` import is a throwing stub. Note the suggested version-gated migration is unreliable because `SAVE_VERSION` stays 1 (old/new indistinguishable).
- **i3 — Bulldozed-cinema ids never pruned from `blockbusters` Set (F13):** slow unbounded per-session growth; harmless because ids are monotonic (a stale id can never match a future cinema) and the Set resets per session. *Prune on bulldoze / when fixing M3.*
- **i4 — Routing cap (≤2) vs `isFloorServed` (unbounded) divergence (F8, plausible):** a 3+-transfer tower is economically served/rewarded in full but shows no commuters — intentional-looking (crowd is cosmetic). One asserted harm ("HUD congestion understated") is **refuted**: `spatialCongestionByFloor`/v1 `congestion()` derive from `servedFloorSet()`, not `route`, so served-floor congestion computes normally. No action required.

---

## Merge recommendation

1. **Fix M1 and M2** (both `src/engine/Tower.ts`) — small, localized, follow existing patterns; M2 needs a regression test. These directly affect the PR's own target scenario and the canon rule it claims to enforce.
2. **Fix or explicitly defer M3** with a tracked issue (bundle m3/i3 into the same change).
3. Land the minors/infos as follow-ups.

---

## Resolution (2026-06-30)

All three majors fixed, plus the cheap minors/infos folded in:

- **M1 (perf):** `Tower` now keeps an `id→unit` index (`byId`, maintained in
  register/unregister/reindex); `roomAt`/`unitAt` are O(1), so the parking
  flood-fill is bounded by the parking region, not tiles×units — safe on the
  per-frame congestion read even on the 340-wide/15k tower. No revision cache
  (avoids the state-staleness trap the review flagged).
- **M2 (over-count):** vertical steps in the flood-fill are allowed only from a
  ramp tile; stacked parking with no ramp no longer connects. Regression test added.
- **M3 (serialize):** `blockbusters` is now serialized/restored (Simulation
  serialize + deserialize + `SerializedGame.blockbusters`). Round-trip test added.
- **m1:** test asserts `FACILITIES.metro.width === GRID.width`.
- **m3 (fire flag) + i3 (id leak):** `payMaintenance` clears the set
  unconditionally each month, so a burning/removed cinema can't keep a stale boost.
- **m4 (balance):** blockbuster crowd multiplier raised 1.7→2.2 so a blockbuster
  is a genuine upside at healthy traffic, not a strict tax.
- **m2 / i2 / i4:** left as intended/cosmetic (the ≤2-ride sprite behavior is the
  requested canon rule; legacy-save off-center is cosmetic; i4 was refuted).

143 tests pass; typecheck + lint clean.
