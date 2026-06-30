# FAQ-Grounded Parity Audit — SimTower clone vs the canonical FAQ

**Date:** 2026-06-30
**Baseline:** branch `claude/simtower-phase2` (all review + Phase-2 work merged in).
**Canon source:** [`faq-canon.md`](./faq-canon.md) (Kiwizoid SimTower FAQ v2.02).
**Method:** every FAQ number/rule checked against the current engine (`facilities.ts`,
`Simulation.ts`, `EventSystem.ts`, `ElevatorDispatch.ts`, `Tower.ts`, `main.ts`).

> ⚠️ This pass also **corrects the original review**: its appendix refuted F16
> ("no noise/proximity mechanic") as *not in the original* — the FAQ proves that
> wrong. Office noise IS canonical. Lesson: the first review's "canon" was partly
> from memory; this pass is FAQ-grounded.

Legend: 🔴 fix (clear fidelity gap) · 🟡 consider (divergence, decide) · 🟢 intended/documented divergence · ✅ faithful.

---

## 1. Star-gate ladder

| # | FAQ | Clone now | Verdict |
|---|---|---|---|
| Q1 | **4★** = pop 5,000 + **>1 Hotel Suite** + **Recycling** + **Medical** + **favorable VIP** | `evaluateStar`: 4★ needs **Medical only** | 🔴 missing suite-count, recycling, and VIP gates |
| Q2 | **5★** = pop 10,000 + **Metro** | Metro is folded into the **TOWER** check, not 5★ | 🟡 restore Metro as the 5★ gate (canon) |
| Q3 | Hotel guests count toward pop **only until 3★** | hotels always count | 🟡 nuance not modelled |
| Q4 | **TOWER** pop **15,000** | **8,000** (re-derived from lot capacity) | 🟢 documented owner decision (metric kept, number scaled) |
| ✅ | 2★=300, 3★=1,000+Security, thresholds 5,000/10,000 | identical | ✅ faithful (incl. the F1 "Security at 2★, gates 3★" fix — matches canon exactly) |

## 2. Unlock ladder (minStar) — FAQ "Available" column

The FAQ confirms the original review's F19 "parity drift": several facilities
unlock a tier too early (or, for recycling, too late).

| Facility | FAQ | Clone `minStar` | Verdict |
|---|---|---|---|
| Escalator | 3★ | **2** | 🔴 → 3 |
| Twin/Double hotel | 3★ | **2** | 🔴 → 3 |
| Hotel Suite | 3★ | **2** | 🔴 → 3 |
| Restaurant | 3★ | **2** | 🔴 → 3 |
| Retail Shop | 3★ | **2** | 🔴 → 3 |
| Parking | 3★ | **2** | 🔴 → 3 |
| Recycle Center | 3★ (available; required for 4★) | **4** | 🔴 → 3 |
| Single hotel 2★, Security 2★, Service-elev 2★, Medical/Cinema/Party 3★, Metro 4★, Cathedral 5★, Office/Condo/FastFood/Stairs/Std-elev 1★ | — | match | ✅ |

## 3. Building costs

| Item | FAQ | Clone | Verdict |
|---|---|---|---|
| Twin/Double hotel | 50,000 | 40,000 | 🔴 → 50,000 |
| Service elevator shaft | 100,000 | 150,000 | 🔴 → 100,000 |
| Per-car cost | std **80,000** / service **50,000** / express **150,000** | flat **$40,000/car** (`main.ts` add-car) + shaft `span×5,000` | 🟡 per-car pricing model differs (no per-type car price) |
| Parking | ramp **50,000** + spot **3,000** | single "parking" **30,000** | 🟡 no ramp/spot split |
| Lobby 5,000/tile, Floor 500, Stairs 5,000, Office 40k, Condo 80k, FastFood 100k, Single 20k, Security 100k, Express shaft 400k, Restaurant 200k, Shop 100k, Cinema 500k, Party 100k, Medical 500k, Metro 1M, Cathedral 3M | — | match | ✅ |

## 4. Geometry & transport

| # | FAQ | Clone | Verdict |
|---|---|---|---|
| G1 | **Express has no length limit** (1→90 then 90→100) | express span capped at **60** (`maxSpanFor`/`validateTransport`) | 🔴 can't build express 1→90 (span 89); raise express max span to ~99 |
| G2 | Metro spans **3 floors** (B8–B10) | metro is **1** whole-width floor (`facilities.metro.floors = 1`, width 200) | 🟡 1-floor vs 3-floor abstraction |
| G3 | Escalators **commercial-only** (no offices) | escalator is an unrestricted transport | 🟡 no commercial-only restriction |
| ✅ | std/service span ≤30; 21/car; sky lobbies every 15; express stops at sky lobbies; ≤2 rides via transfer | match | ✅ |

## 5. Missing / divergent mechanics

| # | FAQ | Clone | Verdict |
|---|---|---|---|
| M1 | **Office noise** annoys adjacent hotels/condos ("Office neighbor is too noisy") | no proximity/noise penalty | 🔴 missing (and wrongly refuted by the first review) |
| M2 | **VIP stays only in a suite**; favorable VIP gates 4★ | VIP exists for the TOWER win; no suite requirement, not a 4★ gate | 🔴 (ties to Q1) |
| M3 | **Parking demanded by offices at 3★** (a real demand/penalty) | parking only lightly reduces stress; never demanded | 🟡 |
| M4 | **Cockroach infestation** spreads in under-cleaned hotel runs | dirty rooms simply can't re-let until cleaned | 🟡 |
| M5 | **Movie booking cost** (150k avg / 300k blockbuster) | cinema earns flat traffic income, no booking cost | 🟡 |
| M6 | **Fire rescue $500,000** option | fire auto-contained by Security/Medical coverage (no paid rescue) | 🟢 simplified (acceptable) |
| M7 | **Terrorist: $300,000 ransom** OR find-bomb; miss → ~5 floors destroyed | bomb auto-defused by Security, else $15–30k fine | 🟡 amounts + no ransom choice |
| M8 | **Buried treasure ≈ $500,000** | $50,000–$200,000 | 🟡 amount |
| M9 | Lobby/Floor/Security/Metro/Cathedral/Housekeeping are **non-removable** | all are bulldozable (partial refund) | 🟢 deliberate QoL divergence |
| M10 | Rain hurts fast-food business | rain is cosmetic | 🟢 documented (FR-57) |
| M11 | Santa (no gift in original) | Santa gives a cash gift | 🟢 documented (FR-52) |

---

## Recommended remediation (proposed order)

**Tier 1 — cheap, high-fidelity (config/one-liners):**
1. Fix the unlock ladder (§2): escalator/double/suite/restaurant/shop/parking → 3★; recycling → 3★. *(7 `minStar` edits.)*
2. Fix costs (§3): double hotel 40k→50k; service elevator shaft 150k→100k.
3. Raise express max span to reach the top (§G1).

**Tier 2 — gameplay fidelity (logic + tests):**
4. Complete the 4★ gate (§Q1/M2): require >1 operational Hotel Suite + Recycling + a favorable VIP, and make the VIP stay in a suite.
5. Restore Metro as the 5★ gate (§Q2).
6. Office-noise proximity penalty (§M1) — hotels/condos adjacent to offices lose satisfaction; surface "Office neighbor is too noisy" in the inspector. (Naturally fits the v2 spatial model.)
7. Hotel-pop-counts-only-pre-3★ (§Q3).

**Tier 3 — depth / flavor (decide per appetite):**
8. Parking ramp+spot model and office parking demand (§3/M3).
9. Metro 3-floor footprint (§G2); escalator commercial-only (§G3).
10. Buried-treasure amount (§M8); terrorist ransom option + amounts (§M7); cinema booking cost (§M5); cockroaches (§M4).

**Leave as intended (documented):** fire-rescue option (M6), non-removable items
(M9), cosmetic rain (M10), Santa gift (M11), TOWER pop 8,000 vs 15,000 (Q4).

## Headline counts
- 🔴 **9 clear fidelity fixes**, 🟡 **11 divergences to decide**, 🟢 **5 intended/documented**, plus a large faithful core.
- Most impactful: the **unlock ladder** (7 one-line fixes), the **4★/5★ gates**, the **express span limit** (blocks legitimate tall-tower play), and the **office-noise mechanic** (genuinely missing, and a correction to the first review).
