---
title: "GDD Slice — Core Loop, Progression & Economy Balance"
game: Verticopolis (browser SimTower clone)
author: Samus Shepard (Game Designer — BMAD gds agent)
date: 2026-07-01
status: Review
scope: Design review of a SINGLE slice — the core gameplay loop and its
  progression/economy balance. Not a full GDD. Grounded in the shipped engine
  (`src/engine/facilities.ts`, `econConfig.ts`) and the merged PRD.
---

# GDD Slice — Core Loop, Progression & Economy Balance

> Framing: mechanical **parity** with SimTower 1994 is done. This pass asks the
> next question a designer must ask — *is it a good **game**?* Every number below
> is quoted from the live engine so the critique is falsifiable, not vibes.

## 1. The core fantasy (what the game is actually about)

**"I am the architect of a living vertical city, and the elevators are the game."**
Money is the scoreboard; **vertical transport is the puzzle.** You lay space, then
fight to move people through it — sky lobbies, express banks, the two-ride rule,
per-floor congestion. That is the loop that earns its place, and the build faithfully
preserves it. Everything else (economy, disasters, stars) exists to pressure or
reward that transport puzzle.

**Core loop:** place structure → zone rooms → thread transport → watch the crowd →
relieve congestion / grow population → clear a star gate → repeat → win the TOWER.

Verdict: the loop is intact and faithful. The design risks are all in **pacing** and
**where the tension lives over time** — below.

## 2. Economy balance — the tension inverts (the #1 design risk)

Quantified from the engine:

| Phase | Cash situation | Evidence |
|---|---|---|
| **Early (1–2★)** | Tight, decisions matter | Start $2,000,000; a Standard Elevator is **$200k** (10% of your bank), offices $40k, first lobby/floors on top. You genuinely choose. |
| **Mid (3★)** | Loosening | An office costs **$40k** and pays **$10k/quarter = $40k/yr** rent → ~1-year payback, then pure profit. Every office is a money printer after year one. |
| **Late (4★→TOWER)** | Money is a non-constraint | TOWER needs **15,000** occupants ≈ **~2,500 offices** (pop 6 each). That is ~$100M to build — but also **~$100M/year** in rent. You drown in cash; the only real limits left are **space and congestion.** |

**Design read:** the economic tension is entirely front-loaded. This is *faithful*
to SimTower (money always trivialized late), but faithfulness isn't the same as good
pacing — the late game loses one of its two levers. The transport puzzle carries the
whole back half alone.

**Recommendations (pick 1–2, all optional / post-parity):**
- **Scale upkeep with size** so sprawl keeps costing: e.g. rising per-floor service
  demand, or a small tax on total leased area. (There's precedent: unsold condos
  already pay `condoMonthlyTaxRate = 1.5%`.)
- **Escalate disaster/event stakes** with tower value so the late game still has
  money-at-risk moments.
- Accept it as canon and instead make the **late-game challenge explicitly about
  transport throughput** (see §4) — lean into the real fantasy rather than papering
  a fake economic one.

## 3. Progression pacing — the 5k→10k→15k grind

Star thresholds: **300 · 1,000 · 5,000 · 10,000**, then **TOWER 15,000**.

- **1★→3★ is snappy** (300, then 1,000) — great onboarding cadence; the player earns
  two promotions fast and learns the gates (Security → 3★).
- **3★→TOWER is a long plateau.** 1,000 → 5,000 → 10,000 → 15,000 is a **15×**
  population climb performed with the *same handful of actions* (place office, extend
  elevator, add sky lobby). The gate *variety* (Medical, Recycling, suites, VIP,
  Metro) is good, but they're all satisfied once, early in the band; the rest is grind.

**Recommendation:** add **interstitial goals** in the 5k–15k dead zone — milestone
awards, named/prestige tenants, per-decade "city" events, or optional objectives
(a fully-served 100th floor, a zero-congestion rush hour). Cheap to add, directly
targets the one boredom window. This is the highest-leverage design change.

## 4. Where the late-game challenge should live: transport

The **two-ride rule** (new this cycle) is the best late-game design lever in the
build and it's currently *invisible*. A well-zoned tower must guarantee every floor
is ≤2 rides from the ground via sky-lobby transfers; a mis-zoned floor simply gets
**no visitors** (it's leased and counts for rating, but the crowd never comes).

- **Opportunity:** this is the endgame puzzle — make it explicit. Surface "this floor
  is unreachable in 2 rides" as a first-class warning, and consider a soft economic
  penalty for chronically starved floors so the transport puzzle has teeth, not just
  cosmetics. (The help text now explains the rule — good first step.)

## 5. Legibility traps (player can't see the rule)

Two canon rules are correct but **punish silently** — a designer must surface them:
1. **Hotels stop counting toward rating at 3★+** (`ratingPopulation` excludes them).
   A hotel-heavy player will stall their star climb with no on-screen reason.
   → Show "counts toward rating / doesn't" on hotel rooms and in the stats panel.
2. **Dead parking spaces** (not ramp-chained) provide zero relief. The "red X" cue
   exists in canon — make sure it's rendered and explained.

## 6. Micro: the blockbuster is automatic

Cinemas roll a blockbuster (~$300k, now +2.2× crowd) vs average ($150k) **for** the
player. It's balanced EV now, but it's a **decision the game makes, not the player.**
→ Small, high-flavor win: let the player *book* the film (gamble on a blockbuster).
Turns a passive dice-roll into agency that fits the "you run this place" fantasy.

## 7. Summary — ranked design recommendations

1. **Fill the 5k–15k pacing gap** with milestones/optional goals *(highest leverage)*.
2. **Make the two-ride transport puzzle the explicit late-game challenge** (warnings + teeth).
3. **Surface the silent rules** (hotel-doesn't-count-at-3★, dead parking).
4. **Give money a late-game lever** (scaling upkeep) *or* consciously retire it.
5. **Let the player book the film** (blockbuster as a choice).

None of these touch parity — they're the design layer *on top* of a faithful clone.
The bones are excellent; the work now is pacing and legibility, not mechanics.

---
*Produced by the BMAD `gds-agent-game-designer` (Samus Shepard), grounded via
`_bmad-output/project-context.md`. A design review / GDD slice — recommendations,
not committed scope.*
