# SimTower Clone — Full BMAD-Way Code Review

**Date:** 2026-06-30
**Scope:** Implementation vs (a) its PRD, (b) the canonical 1994 *SimTower*, plus internal code quality
**Method:** BMAD adversarial multi-layer review with party-mode convergence and adversarial verification

---

## 1. Executive Summary

This review consolidated **212 raw observations into 55 distinct findings**, of which **45 were confirmed** through source-level verification, **13 were refuted** (and are recorded in the appendix so they are not re-raised), and **1 is a confirmed "things done right" affirmation**. Confirmed findings break down as **1 blocker, 11 major, and 33 minor/info**.

**Overall verdict:** The build is a careful, PRD-faithful reproduction of *SimTower*'s **surface** — the catalog, balance numbers, star ladder, event set, and rendering boundary are honest and well-documented — but it is **not currently winnable in organic play** and its **core "elevator-optimization" skill loop has been hollowed out**. A single one-character canon bug (`security.minStar=3`) deadlocks every real playthrough permanently at 2★, and the primary success metric (the E2E "reaches TOWER" test) passes only because it pre-seeds all win preconditions and routes around the very gates it claims to verify. Beneath that, the marquee SimTower depth — positional congestion, spatial service coverage, an early-game cash crunch — is replaced by tower-wide scalars and an income snowball, collapsing the 24-facility palette to roughly four strategically meaningful types.

The good news: the architecture's authoritative state is recomputed deterministically from clock-edge snapshots, the documented divergences are disclosed with rationale, and most defects are **localized and cheaply fixable**. The blocker is one line. The largest design gaps (positional congestion, service coverage radius) are well-understood and bounded.

**Headline issue per dimension:**
- **vs PRD:** `F1` — the game is unwinnable (Security gates 3★ but requires 3★ to build).
- **vs 1994:** `F3` — congestion is one tower-wide scalar, so layout/zoning/shaft placement have no mechanical effect.
- **Code Quality:** `F4` — the single clock is *sampled*, not integrated; the headless engine integrates differently from the browser, which is what let `F1` ship green.

---

## 2. Method (BMAD-Way)

1. **Ground-truth extraction** — read the shipped engine/render/UI source, the PRD (`prd.md` + addendum), and `PARITY.md`; established the canonical 1994 *SimTower* behavior as the third reference.
2. **3 dimensions × 3 adversarial layers** — each of the three review dimensions (Implementation vs PRD, Implementation vs 1994, Code Quality) was attacked by three orthogonal layers:
   - **Blind Hunter** — finds defects with no charity to intent.
   - **Edge Case Hunter** — walks every branch/boundary condition.
   - **Acceptance Auditor** — checks each PRD/PARITY claim against code and tests.
3. **3 party-mode rounds across 6 personas** — PM, Designer, Architect, UX, Dev, Tech-Writer roundtable convergence to de-duplicate, recategorize, and calibrate severity over three rounds.
4. **Adversarial verification** — every surviving finding was re-checked against source with an explicit confirm/refute verdict and, where warranted, a corrected severity. Only verified findings appear in §3–§5.

---

## 3. Findings by Dimension

Severity legend: **🔴 blocker · 🟠 major · 🟡 minor · ⚪ info**

### 3.1 Implementation vs PRD

| Sev | Category | Title | Location | Detail |
|-----|----------|-------|----------|--------|
| 🔴 | bug | **F1 — Security gated at 3★ but required to REACH 3★; organic play deadlocks at 2★ (game unwinnable)** | `facilities.ts:223`; `Simulation.ts:506`, `:142` | `evaluateStar` caps rating at 2★ until `hasAny('security')`, but `security.minStar=3` and the build path refuses any facility below its minStar — so reaching 3★ needs Security, and placing Security needs 3★. A 1,000+ pop tower freezes at 2★ forever; all 3★+ content and the TOWER win become unreachable. **Fix first.** Canon fix: `security.minStar=2`. PRD §4.2/FR-17/FR-44 are also internally unsatisfiable and must be reconciled. |
| 🟠 | gap | **F2 — Headline §7 winnability metric is unfalsifiable; the E2E test forces win preconditions and bypasses every system it claims to verify** | `parity.test.ts:50-90`; `Simulation.ts:262-272` | The "automated E2E reaches TOWER" gate hand-sets `money=1e9`, `star=5`, force-occupies offices, builds no elevators, places Security/Medical/Metro via `tower.place()` (skipping `isUnlocked`), and ticks `60*24` so `onHour` fires once and never again. The win comes purely from pre-seeded state + `onDay→checkVip`. It even asserts `star==2` "blocked without Security" then routes around the gate — encoding the F1 deadlock as a passing assertion. No test drives `newGame→≥3★` through `sim.build()`. No traceability matrix maps PARITY ✅ to tests. |
| 🟠 | bug | **F7 — Commercial foot-traffic income balloons to ~20× annual ROI and SCALES UP with population** | `EconomySystem.ts:32-62` | `collectTrafficIncome` accrues `(daily/8)*appeal*…` *every open hour*, but venues open far longer than 8h (fast food 07–22 = 15h). `trafficAppeal = min(1.8, 0.3 + pop/4000 + metro)` rises with population. Fast food realizes ~$5,400/day ≈ $1.97M/yr on a $100k build (~20× annual ROI, ~2.7× its $2,000/day headline). Commercial out-earns everything and cash pressure drops as you scale. Outranks the F21 treasure exploit as the headline economy break (passive, zero-click). |
| 🟡 | risk | **F5 — Economy is an all-source positive-feedback snowball with no scaling sink and no fail state** | `EconomySystem.ts:58-121`; `Simulation.ts:216-218` | Offices/condos/commercial/lobbies pay zero maintenance; money can go negative with no bankruptcy; an office pays its build cost back in one year as pure profit. Past ~3★ difficulty inverts. **Faithful to PRD intent (canonical 1994 balance, no fail state),** so this is flagged as a design risk, not a spec gap. |
| 🟡 | bug | **F10 — The core stress cue is ambiguous; "fed up" red equals a normal shirt color, and two layers assign it different meanings** | `pixelSprites.ts:31`; `TowerEngine.ts:638,342,900` | Stress is signaled only by hue-swap to `#C24A3A`, which is also `SHIRTS[3]` — so ~1-in-8 content commuters are pixel-identical to stressed ones. Routed people redden on individual `wait>25s`; decorative walkers redden on global `stress>0.25`. Color-blind concern is an explicitly deferred PRD open question. |
| 🟡 | risk | **F11 — "Fill once, forever full": near-instant move-ins delete the mid-game loop** | `Simulation.ts:385-457`; `Tower.ts:590-598` | Offices fill at 25%/weekday-hour, condos 18%/hour, so a served floor saturates within ~one in-game day. The satisfaction-driven move-out/return loop *does* exist (unserved floors decay and vacate), so this is a tuning/game-feel concern, not a missing mechanic. |
| 🟡 | undocumented-divergence | **F25 — FR-31 move-out realized only for office/condo; hotels and commercial never churn from stress** | `Simulation.ts:385-387` | `updateSatisfaction` vacates only `office`/`condo`. Hotels reset to 1 nightly via housekeeping; food/retail satisfaction is decremented but never consulted for move-out. Narrows the glossary's "any paying occupant." |
| 🟡 | undocumented-divergence | **F26 — Express elevators do not skip non-lobby floors unless the player manually invokes the editor "express" action** | `Tower.ts:385-411`; `main.ts:414-417` | `placeTransport` never seeds `skipFloors`, so a freshly placed express stops at every floor (a high-cap standard) until the player opens the edit panel. FR-25's defining behavior is opt-in and undiscoverable. |
| 🟡 | undocumented-divergence | **F27 — Idle elevator cars rest at the shaft's lowest served floor, not the ground lobby** | `ElevatorDispatch.ts:37,62-70` | FR-26 says cars idle at the ground lobby; the dispatcher parks at `stops[0]`. A 15–45 sky-lobby shaft idles at floor 15; a basement-spanning shaft idles in a basement. |
| 🟡 | risk | **F28 — First day-boundary off-by-one collects a quarter's rent / a month's maintenance after ~17 h (fresh games only)** | `Simulation.ts:87-88,307-317` | `lastQuarter/lastMonth` init to `-1` while the clock starts at quarter/month 0, so the first midnight fires collections. `deserialize` seeds from the clock, so loaded games are unaffected. Near-zero impact on an empty starter tower. |
| 🟡 | undocumented-divergence | **F37 — Hotel guests check out at midnight, not "in the morning"** | `Simulation.ts:303`; `EconomySystem.ts:65-76` | `hotelCheckout()` runs from `onDay()` at 00:00, so rooms flip asleep→dirty and population/revenue resolve at midnight, hours before FR-13's stated morning. |
| 🟡 | risk | **F40 — Live-play determinism is frame-rate/speed dependent in the visible layer; save reseeds the crowd from gameplay RNG** | `main.ts:240-248`; `Simulation.ts:97,627,651` | Browser chunks wall-clock into ≤20-min steps whose count depends on frame delta and speed; visible integrators are step-size sensitive, so two machines diverge in car positions/crowdStress. `deserialize` reseeds the crowd from the *current* RNG state, so the spawn sequence isn't reproducible across save/load. Authoritative win/economy state stays deterministic; the boundary should be documented. |
| 🟡 | gap | **F48 — No keyboard-only play path; palette/tools are non-focusable, non-semantic divs** | `UI.ts:92-118`; `main.ts:198-210` | Keyboard support is only speed keys 0–3. Build/select/bulldoze items are `<div class="pal-item">` with bare click listeners (no role/tabindex/Enter handler). PRD lists keyboard-only play as a deferred open question, so minor. |
| 🟡 | gap | **F49 — No `prefers-reduced-motion` support despite heavy continuous ambient animation, and no static state readout** | `styles.css`; `TowerEngine.ts` | Always-on clouds, rain, walkers, climbers, riders, metro train, arcing sun/moon, sky transitions, 1.2s crossfades, animated toasts run unconditionally. Already tracked as PRD Open Question 6. |
| 🟡 | gap | **F51 — Mobile feedback degrades: bulletin log & hint hidden, only transient 3.6 s toasts** | `styles.css:716-766`; `UI.ts:135-138` | On phones `#log` is off-screen and `#hint` is hidden, so fire/bomb/VIP/promotion feedback reduces to a 3.6 s toast (cap 5). The primary build controls are actually ~80px on mobile (above the 44px guideline), so the tap-target sub-claim does not hold. |
| 🟡 | gap | **F52 — Star promotion plays no jingle; the CLOSED off-hours label is illegible at normal zoom** | `main.ts:262-266`; `pixelSprites.ts:201-203` | `sfx('promote')` fires only on the final TOWER win; 2★–5★ promotions are silent toasts (FR-58 promises promotion jingles). CLOSED is baked at "bold 7px" into a world-scale sprite, going sub-pixel at any whole-tower view. |
| 🟡 | undocumented-divergence | **F53 — PRD/PARITY internal contradictions (basement count 9 vs 10) undermine "single source of truth"** | `PARITY.md:15,18`; `prd.md` FR-1, §7 | PARITY:15 marks ✅ "B1…B10" (10) while PARITY:18 marks ✅ "9 below"; both can't be true, code is 10. The §7 "100% of PARITY ✅" metric is unsatisfiable when the checklist self-contradicts. (Secondary claims about move-out/idle-at-lobby PARITY marks were refuted — those marks are correct.) |
| 🟡 | gap | **F54 — Brownfield PRD frames already-shipped behavior as "Open Questions" (OQ-5 masks the treasure exploit) and leaves secondary metrics unmeasured** | `prd.md` §7, §8 | OQ-2/4/5 ask about behavior the code has already decided; OQ-5 logs the F21 18%-per-room treasure roll as "undecided" rather than owned. Secondary §7 metrics (cross-device usability, "feel") have no artifacts. |

### 3.2 Implementation vs 1994 SimTower

| Sev | Category | Title | Location | Detail |
|-----|----------|-------|----------|--------|
| 🟠 | undocumented-divergence | **F3 — The elevator-optimization core loop is non-spatial; congestion is one tower-wide scalar** | `Simulation.ts:397-417,365-388` | Stress driver = `(totalPopulation × rushFactor) / (Σ ALL-transport-capacity × 12)`, summing every shaft + metro/parking/stairs/escalator regardless of position, against whole-tower population. Satisfaction keys off that global scalar + a binary `isFloorServed`. Layout/zoning/sky-lobby/shaft placement have no mechanical effect on stress. The individually-routed Crowd penalty is clamped to ≤0.01/hr. This is the single most important true divergence and is **not** among the four declared ones. Reachability is still enforced, so the headline "ZERO effect" is tempered to "no effect on authoritative stress." |
| 🟠 | undocumented-divergence | **F13 — Cumulative effect: the 24-facility catalog collapses to ~4 meaningful types because systems never interact** | `Simulation.ts:357-539`; `EconomySystem.ts:108-121` | Because congestion is global (F3), services are tower-wide booleans (F15), recycling is a no-op (F14), there's no noise/proximity/coverage radius and no fail state, the optimal tower is: a wall of offices + one cheap escalator + one Security + one Medical + metro + wedding hall. Sky-lobby zoning, shaft loadout, housekeeping/parking/recycling placement, and commercial micro-placement are strategically irrelevant. Anchors any redesign scope. |
| 🟠 | undocumented-divergence | **F14 — The Recycling Center is a complete no-op: a $500k + $4k/mo trap with no trash mechanic** | `econConfig.ts:19`; `facilities.ts` | "recycling" appears only as a maintenance line item and a FacilityKind. No garbage state exists; it is never consulted by satisfaction/star/VIP and gates nothing. PRD §4.2 and the in-game description oversell it as functional. |
| 🟠 | undocumented-divergence | **F15 — Service coverage is a tower-wide boolean (`hasAny`), not a spatial coverage radius** | `Simulation.ts:506-507`; `EventSystem.ts:62,114,174` | One Security office in a B10 corner gives the same fire-containment/bomb/thief protection to a floor-100 fire and satisfies the 3★ gate; one Medical satisfies 4★ from anywhere. 1994 caps each at 10 precisely because they have a coverage radius. Spatial service placement is meaningless. |
| 🟠 | undocumented-divergence | **F20 — Stairs/escalators carry no routed passengers and have no flight limit, yet count as "served" and as congestion capacity** | `Crowd.ts:118-134`; `Tower.ts:559-584`; `Simulation.ts:397-417` | The Crowd routing graph is elevators-only, so stairs/escalators move zero routed commuters. But `isFloorServed()` is an unbounded fixed-point over ALL transports, so a stack of single-floor stairways to floor 100 marks every floor served — tenants pay rent, count toward stars, and gain congestion capacity while spawning no commuters. FR-25 service-elevator segregation is nominal. `resizeTransport` also lets a stairway be extended across many floors (span check is elevator-only). |
| 🟡 | gap | **F18 — None of the 1994 hard building caps are enforced** (24 shafts, 64 stairs/escalators, 1 metro, 1 capstone, 10 security/medical, 16 cinema/party) | `Tower.ts:150-411` | Only the per-shaft `MAX_CARS` cap exists. Related bug: building two Wedding Halls and bulldozing one sets `builtWeddingHall=false` (a boolean, not a count), voiding TOWER eligibility while a hall still stands. |
| 🟡 | undocumented-divergence | **F30 — The ground lobby is optional; `isFloorServed(1)` is hardcoded true with no lobby check** | `Tower.ts:560` | A player can drop offices straight onto floor 1 with no lobby and they are served, occupied, and paying rent. Degenerate edge case (the starter state seeds a lobby). |
| 🟡 | undocumented-divergence | **F45 — Facility footprints inconsistently scaled vs canon** | `facilities.ts` | Office (w9) and condo (w16) match canon, but fast food w12 (canon 16), restaurant w16 (canon 24), stairs/escalator w4 (canon 8). Costs mostly match, so cost-per-tile ratios drift and units-per-floor changes vs the original. |
| 🟡 | undocumented-divergence | **F46 — Ten basement levels (B1–B10) vs the original's nine playable basements; minor upkeep/cap deltas** | `facilities.ts:327`; `EconomySystem.ts` | `minFloor=-9` yields 10 levels. Also: service elevators capped at 4 cars vs canon 8; lobbies have no upkeep; maintenance cadence monthly vs canon quarterly (PRD-documented). The depth change is actually noted in the decision log, so partly documented. |
| ⚪ | intended-divergence | **F19 — Star-gate ladder diverges from canon (no Metro 5★ gate; 4★ omits VIP/suite/recycling/parking) — PRD-documented** | `Simulation.ts:505-539`; `prd.md` §4.6 | `evaluateStar` gates only Security→3★ and Medical→4★; Metro folds into the TOWER win. Matches the PRD, so an intended divergence. Secondary unlock-ladder drift (escalator/restaurant/shop/parking/double/suite at 2★, recycling at 4★) is undocumented parity drift. |
| ⚪ | undocumented-divergence | **F36 — Hotel suite population is 2 (= double); 1994 suite holds 3 guests** | `facilities.ts:84` | Flattens the suite's population value (matches the PRD digit). The canon "suite = 3" basis is not firmly established, so info-level. |
| ⚪ | intended-divergence | **F47 — Rain is cosmetic and Santa grants a cash gift — both diverge from canon but are PRD-documented** | `Simulation.ts:106-113`; `EventSystem.ts:155-165` | Weather is a render-only per-day hash never read by income (FR-57). Santa awards $50k–$150k once/year at 3★+ (FR-52), a small feed into the snowball. |
| ⚪ | undocumented-divergence | **F38 — BFS routing allows unlimited transfers and never tie-breaks on load/distance, so no cross-shaft balancing occurs** | `Crowd.ts:136-171` | `route()` is fewest-transfer BFS with no transfer cap and returns the first path in transport-iteration order, so a second parallel shaft sees zero routed rebalancing while `congestion()` credits its capacity. The two models disagree on whether parallel shafts help. |

### 3.3 Code Quality

| Sev | Category | Title | Location | Detail |
|-----|----------|-------|----------|--------|
| 🟠 | bug | **F4 — Single clock is SAMPLED, not integrated; `tick()` fires `onHour`/`onDay` at most once per call and hands full `dt` to every integrator** | `Simulation.ts:252-272`; `ElevatorDispatch.ts:48`; `main.ts:243-247` | Root cause behind the catch-up cluster. `tick(1440)` lands on the same hour → `onHour` effectively never fires (no satisfaction/move-ins/income/star eval); a multi-day tick runs `onDay` once. Looping handlers is insufficient: `elevators.update` integrates `v=dt*0.4` in one Euler step and crowd is capped at 60 crowd-sec. Correctness depends on `main.ts` pre-chunking to ≤20 min; tests bypass it. Real damage is test integrity — the headless engine behaves differently from the browser, which is what let F1/F6 ship green. **Fix: push ≤20-min sub-stepping down into `tick()`.** |
| 🟠 | risk | **F8 — Scalability wall: `isFloorServed` is an uncached whole-tower fixed point called per-unit every tick** | `Tower.ts:559-584,50-59`; `ElevatorDispatch.ts:108-111`; `Crowd.ts:170-181` | Recomputes the same reachability answer thousands of times per tick despite `tower.revision` existing. Compounded by `units.find` id lookups (despite floor→id Maps) and uncached crowd scans. The only real blocker to the PRD's ~12,000-pop goal. Fix: one revision-keyed `Set<servedFloor>` + `Map<id,Unit>`, mirroring the existing adjacency cache. |
| 🟠 | bug | **F21 — Buried-treasure roll is per-room-build with no excavation guard → positive-EV build/sell grind** | `Simulation.ts:194-201,231-235` | 18% chance of $50k–$200k on every room at floor ≤ 0, no tile tracking. `hotelSingle` build/bulldoze nets ≈ +$12.5k/cycle; floor tiles persist so re-builds are near-free. Strictly positive EV, repeatable. Ranks below F7 (passive vs manual). |
| 🟡 | bug | **F9 — Dual transport model never reconciles its two demand ledgers; FR-27 "displayed load = real passengers" is contestable** | `ElevatorDispatch.ts:108-126`; `TowerEngine.ts:871-872` | Dispatch builds demand from `u.occupants` + a lobby term, never `Crowd.people`; `carLoad` is a synthetic board/alight estimate that the renderer draws, while real routed riders (`carRiders`, cap 6) are a separate set. Cab graphic saturates at load 13, so an express (cap 33) reads "full" from 39–100%, blunting feedback. (FR citation corrected to FR-27; the "provably false" framing is interpretive.) |
| 🟡 | bug | **F17 — Multi-car shafts bunch: all cars run identical SCAN off one shared demand map and idle at `stops[0]`** | `ElevatorDispatch.ts:51-99` | Idle cars collect at the lobby together, pick the identical nearest stop, ascend in lockstep; the first car drains shared demand, trailing cars carry nothing. A 4-car shaft behaves close to a 1-car shaft for *visible* movement. The authoritative congestion model still credits cars linearly, so gameplay-wise adding cars works — hence cosmetic/minor. |
| 🟡 | risk | **F23 — `crowdStress` write-back leaks a frame-cadence-dependent EMA into persisted satisfaction** | `Simulation.ts:380-388` | The one determinism-boundary leak in the authoritative path. Penalty ≤0.01/hr, floored at 0.05 (can never vacate), dominated 4–12× by congestion, and gated `crowdStress>0.5`. Fix: remove the write-back, expose `crowdStress` as a read-only HUD signal. |
| 🟡 | gap | **F24 — `deserialize` hardens units but not transports; a hand-edited save with a bad car count crashes the tick loop** | `Simulation.ts:662-673`; `ElevatorDispatch.ts:45` | Transports pass through with only a kind filter and shallow spread — `cars=NaN/negative/huge` reaches `new Array(t.cars).fill(0)` (RangeError/OOM). Contradicts the code's own untrusted-save hardening intent. |
| 🟡 | bug | **F29 — Zero-transport tower applies a phantom `congestion=3` penalty to floor-1 tenants who need no elevator** | `Simulation.ts:412,365-387` | `congestion()` returns a hard 3 when capacity is 0 and pop>0, applied uniformly even to floor-1 units (unconditionally served). A minimal elevator-less tower self-destructs; any single staircase removes it. |
| 🟡 | bug | **F31 — VIP inspection reschedules forever after the Wedding Hall is sold, spamming failure notices every 5 days** | `Simulation.ts:521-538`; `Tower.ts:423` | `removeUnit` clears `builtWeddingHall` but leaves `vipVisitDay ≥ 0`, so `checkVip` permanently re-fails and reschedules +5 days, emitting an "unimpressed" headline forever. Recoverable by rebuilding a hall. |
| 🟡 | bug | **F32 — Star gates and TOWER win accept facilities under construction, on fire, or on an unserved floor** | `Simulation.ts:515-517`; `Tower.ts:332` | `hasAny(kind)` checks only `u.kind`, ignoring `u.state`/reachability — a Security office still in construction satisfies 3★; a metro under construction counts for TOWER. Contrast `collectRent`, which requires `occupied && isFloorServed`. (The half-built wedding-hall sub-case is unreachable: hall build ≤480 min < the 3-day VIP window.) |
| 🟡 | bug | **F33 — Hotel population is never counted toward the TOWER 12,000 check; `hotelCheckout` runs before `checkVip` in `onDay`** | `Simulation.ts:303-321`; `EconomySystem.ts:65-76` | By VIP-eval time all hotel guests have departed (occupants zeroed), so the TOWER target is effectively office/condo-only — an undocumented handler-ordering coupling. |
| 🟡 | risk | **F39 — Crowd spawn rate is a flat time-of-day constant independent of population; accumulator can grow unbounded** | `Crowd.ts:266-297` | `rate` is global (0.3/1.2/2.2) with no dependence on population/units; a 6-office tower and a 12,000-pop tower spawn identically (both capped at 140). The give-up "double-count" claim was found to be correct ratio accounting, not a bug. The frustration ratio is governed by spawn tuning, not load — the structural reason `crowdStress` had to be non-authoritative. |
| 🟡 | risk | **F41 — `ElevatorDispatch` transient maps (`carDwell`, `waiting`) are never pruned on removal and not serialized** | `ElevatorDispatch.ts:13-16,103-107` | Bulldozed shafts leave dead `carDwell` entries (id-keyed leak); demolished floors leave stale `waiting` that can briefly mis-dispatch a car. Neither map is serialized, so reload resumes from a different dwell/waiting state. Self-healing, bounded per session. |
| 🟡 | gap | **F50 — Toasts and the bulletin log have no `aria-live` region; events are never announced to assistive tech** | `index.html:51,64`; `UI.ts:339-350` | Promotions, fire/bomb/thief headlines, VIP outcomes, and build errors are surfaced only visually. Combined with the non-semantic palette (F48), the title has effectively no non-visual feedback channel. Low-cost fix: `aria-live` on `#toast-wrap` and `#log`. |

---

## 4. Confirmed Matches / Things Done Right (F55)

Hold the line on what the build got right so a redesign does not over-correct:

1. **Balance numbers match config exactly** — `startingMoney`, office/condo/hotel economics, traffic income, maintenance, `STAR_THRESHOLDS` 300/1000/5000/10000, `TOWER_POPULATION` 12000, transport caps 21/16/33 all match the PRD's quoted tuning.
2. **Declared divergences are honestly disclosed** — the four deliberate divergences (Wedding Hall stand-in, 12k target, individually-routed crowd + aggregate backstop + ~140 cap, code-drawn assets / JSON saves) are stated consistently across §4.10/§5/addendum/PARITY with rationale; the §7 counter-metrics are a genuine scope guardrail.
3. **Lobby-is-convention is faithfully implemented** — FR-6's "lobby every-15-floors is a transit convention, NOT a rating/win gate" is a contested decision both documented and matched by code (`evaluateStar`/`checkVip` contain no lobby check). Do **not** file unenforced lobby spacing as a defect.
4. **The sim/render snapshot boundary is sound** — authoritative state is recomputed from instantaneous tower snapshots at integer clock edges, keeping the headless path deterministic. This is the load-bearing invariant to **preserve** during any fix; the only leak is F23.

---

## 5. Notable Divergences from the 1994 Original

### 5.1 Intended (PRD-documented)
- **Wedding Hall stand-in** for the Cathedral as the TOWER trigger (FR-66).
- **12,000 population** TOWER target (FR-46/67; addendum Divergence #2).
- **Individually-routed visible crowd + aggregate congestion backstop + ~140-person cap** (addendum).
- **Code-drawn assets and JSON saves** instead of original art / `.TWR` format.
- **Star ladder** gating only Security→3★ and Medical→4★, Metro folded into TOWER (F19).
- **Cosmetic rain** (FR-57) and **cash-gift Santa** (FR-52) (F47).
- **Thief event** — explicitly documented as a non-canon flavor addition (this was *refuted* as a defect; see appendix F22).

### 5.2 Undocumented (parity drift — should be reconciled in PARITY/addendum)
- **Non-spatial congestion** (F3) — the most consequential.
- **Tower-wide boolean service coverage** instead of a radius (F15).
- **Recycling Center is inert** (F14).
- **Stairs/escalators "serve" floors and add capacity but route no passengers** (F20).
- **No building caps** + wedding-hall boolean bug (F18).
- **Optional ground lobby** (F30).
- **Footprint rescaling** of fast food / restaurant / stairs / escalator (F45).
- **10 basements** vs 9; service-car cap 4 vs 8 (F46, partly noted in the decision log).
- **Unlock-ladder drift** (escalator/restaurant/shop/parking/double/suite at 2★, recycling at 4★) (F19).
- **Unlimited-transfer BFS with no load tie-break** (F38).
- **Hotel suite population 2 vs 3** (F36).

---

## 6. Top 5 Prioritized Recommendations

1. **Fix the unwinnable deadlock first (F1).** Change `security.minStar` from 3 to 2 (canon value) and reconcile PRD §4.2/FR-17/FR-44 so the doc is satisfiable. One-line code change; nothing in the 3★+ half of the game can be exercised until it lands.

2. **Make the winnability metric real (F2, F4).** Push ≤20-min sub-stepping *down* into `tick()` so the headless engine integrates like the browser, then add an E2E fixture that drives `newGame → ≥3★ → TOWER` through `sim.build()` with no pre-seeded money/star/occupancy. This single test catches F1, the catch-up cluster, and dead congestion churn — and gives the PRD §7 metric teeth. Add a PARITY→test traceability matrix.

3. **Re-balance the economy to restore the early-game crunch (F7, F5, F21).** Cap commercial accrual at the true daily figure and make `trafficAppeal` a demand-share rather than a population multiplier (F7, highest-leverage, passive/zero-click). Add a per-tile excavation guard to buried treasure (F21). Optionally add a size-scaling sink / soft-fail (F5) if departing from strict 1994 faithfulness is acceptable.

4. **Restore spatial depth to the core loop (F3, F15, F13).** Make congestion/stress positional (per-served-region throughput) and give Security/Medical a coverage radius. This is the largest design lever — it re-activates sky-lobby zoning, shaft loadout, and service placement, pulling the ~4-meaningful-type palette (F13) back toward 24.

5. **Land the scalability + integrity fixes that gate the 12k endgame (F8, then F14/F20/F23/F24/F33).** Add a revision-keyed `Set<servedFloor>` and `Map<id,Unit>` (F8) so the TOWER goal is reachable without a perf wall; then either implement or honestly mark Recycling (F14), bound stairs/escalator routing & serving (F20), remove the determinism leak (F23), harden transport deserialization (F24), and reorder `onDay` so hotels count toward TOWER (F33).

---

## 7. Enhancement Ideas (Backlog)

- Render CLOSED and the stress cue as **screen-space overlays** with a non-color signal (icon/posture), fixing F10 and F52 legibility together.
- Honor `@media (prefers-reduced-motion: reduce)` and add an in-game motion toggle (F49); add `aria-live` regions and semantic/focusable palette buttons for a keyboard+AT path (F48, F50).
- Add **per-car request assignment / anti-bunching** to the dispatcher (F17) so visible elevator behavior matches the gameplay benefit of adding cars.
- Tie **crowd spawn volume to demand** (population/served units) so the visible crowd and the authoritative model agree, enabling a future move to real wait-driven churn (F39, F3).
- Enforce **1994 building caps** and convert `builtWeddingHall` to a count (F18).
- Document the **visible-crowd determinism boundary** explicitly in the addendum (F40).

---

## 8. Appendix — Refuted / Dismissed Claims

Recorded so they are not re-raised. Each was checked against source and the 1994 original.

| ID | Claim | Why refuted |
|----|-------|-------------|
| **F6** | Congestion-driven churn is "mathematically dead"; satisfaction always trends up | The penalty scales with `cong-1` up to 0.12/hr. For any base ratio `pop/(cap×12) > ~1.5`, daily penalty exceeds the max ~0.70/day heal, so over-congested served units net-decline to 0 and vacate. The "never fires" conclusion is false; the static intra-day population observation is valid but doesn't support it. |
| **F12** | TOWER endgame is a non-canon guaranteed fast-forward; no wedding event | Everything flagged is PRD-documented (FR-66 names the Wedding Hall as a renamed trigger; VIP-as-trigger and 12k are FR-46/47). No undocumented divergence. The "sustained-hold random Cathedral wedding" canon basis is also inaccurate — 1994 gates TOWER via the VIP inspection. |
| **F16** | No noise/proximity penalty for condos/hotels vs the manual's spacing rules | 1994 *SimTower* has no noise/proximity satisfaction mechanic and no spacing rules; stress is wait/reachability-driven — exactly what the code models. The claimed canon baseline is fabricated. |
| **F22** | Thief violates the PRD's "no additional disaster types" non-goal | The thief is explicitly documented as a non-canon flavor *event* (not a disaster) in the addendum divergence table and FR-50; the non-goal forbids disaster *types*, which are unchanged. Consistent spec + code. |
| **F34** | Adding elevator cars is effectively free | The player-facing "addcar" path (`main.ts:405`) deducts **$40,000 per car**; 1→8 cars costs $280k. The "free cars" premise is contradicted by code. (A smaller per-car price divergence exists but is not the filed claim.) |
| **F35** | Metro can be placed on any basement floor (vs lowest only) | Code facts accurate, but the single-full-basement-floor model and below-ground placement are explicitly documented (FR-7/10/18; addendum marks Metro "Faithful"). Intended, not undocumented. |
| **F42** | Disaster mechanics simplified — missing fire-rescue / bomb-ransom choices | The simplified model is documented in PARITY (✅) and README, and the cited 1994 "helicopter rescue (~$500k)" and "bomb ransom (~$300k)" choices do not exist in the original (bomb was a search minigame). Mischaracterized canon. |
| **F43** | Cinema is a flat box vs a 1994 film-booking minigame | 1994 cinema had no film-booking/popularity-decay minigame; it was an attendance-driven venue — what the code models. Also PRD-documented ($8,000/day, "Faithful"). |
| **F44** | Office rent is flat with no rent-class variation vs canon | 1994 offices paid a flat $10,000/quarter; location affected *retention* (badly-placed offices lose tenants), which the code reproduces via served/occupied gating. Also documented (prd.md). Fabricated "rent class" premise. |

*Severity note:* per the verification pass, F7, F8, F13, F14, F15, F20, F21 are **major**; F3 was tempered from blocker to **major**; F1 remains the sole **blocker**. The summary tables above place a finding under its primary dimension and use the verified (corrected) severity.
