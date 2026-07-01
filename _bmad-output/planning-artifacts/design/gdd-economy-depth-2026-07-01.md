---
title: "GDD Slice — Economy Depth (Late-Game Money Lever + Blockbuster-as-Choice)"
game: Tower Tycoon (browser SimTower clone)
author: Samus Shepard (Game Designer — BMAD gds agent)
date: 2026-07-01
status: Design spec — ready for dev
scope: Design decisions + implementable rules for GDD §7 recommendations #4 (late-game
  money lever) and #5 (blockbuster as a player choice). Grounded in the shipped engine
  (`src/engine/EconomySystem.ts`, `src/engine/econConfig.ts`, `src/main.ts`) and the
  Core-Loop GDD slice (`gdd-core-loop-2026-07-01.md`).
---

# Economy Depth — Design Spec

> Framing carried from the Core-Loop GDD: **"the elevators are the game; money is the
> scoreboard."** Both changes below are subordinate to that. Neither may turn money into
> a boss, and neither may compete with transport as the late-game puzzle — they either
> *feed* it (#4) or add *flavor agency* on top of it (#5). Every number is quoted from the
> live engine so the intent is falsifiable.

---

## #4 — The late-game money lever

### The decision

**Do NOT retire money. Add a light, self-scaling operating overhead — charged on *space
you hold*, not on *income you earn* — and route its teeth into the transport puzzle.**

I considered all three GDD §7 options and rejected two:

- **Retire money entirely (lean only on transport).** Legitimate and faithful — SimTower's
  money genuinely trivialized late. But retiring removes a *decision* the player could still
  be making, and the GDD itself notes a light non-punitive sink can *restore* one. Retiring
  is the fallback if the sink can't be kept non-punitive; it can, so I keep it.
- **Escalate disaster stakes with tower value.** Rejected as the primary lever: it violates
  "never punitive / no bankruptcy spiral" (a value-scaled bomb ransom is exactly the fat-tail
  cash cliff we're told to avoid), and it makes the late game *lumpier* and more random, not
  more *decision-rich*. Money-at-risk moments are a spice, not a system.

The chosen approach — **scale upkeep with size** — is the one the GDD flagged as having
precedent (`condoMonthlyTaxRate = 1.5%` already gives held inventory a carrying cost). But a
naive flat "tax on everything" is a trap: if the sink scales *identically* to income, it's
just a percentage haircut — the number shrinks, the triviality doesn't. To **restore a
decision**, the sink must attach to something the player can *act on*.

### The rule

**Overhead is charged on the SPACE (every operational leasable income unit, occupancy
irrelevant); income stays charged on OCCUPANCY (unchanged).** The asymmetry is the whole
design:

- A **well-run tower** — floors filled, every floor served within the two-ride rule — pays
  overhead but stays massively profitable. Money is a *dial you watch*, never a wall.
- A tower that **over-builds ahead of demand** (vacant leased offices) or **fails the
  transport puzzle** (leased-but-unserved floors — the GDD §4 "leased, counts for rating,
  but the crowd never comes" case) pays full overhead on that space while it earns **nothing**.
  Margins visibly erode until the player fills the vacancy or connects the floor.

This marries money to the real fantasy. The GDD §4 asked for "a soft economic penalty for
chronically starved floors so the transport puzzle has teeth." **This is that penalty** — not
a bespoke new rule, just the natural consequence of overhead-on-space: an unserved floor is
pure carrying cost. Money stops being a second, fake economy and becomes the *readout* of how
well you're solving the transport puzzle.

**Implementation shape** (`EconomySystem.payMaintenance()`, the existing per-unit loop):

```
// new ECON constant, folded into the existing unit loop in payMaintenance()
overheadPerLeasableUnitMonthly ≈ $700   // rough; dev tunes to the target band below
// charged on offices, held condos, shops/food/entertainment, hotel rooms —
// any operational (state !== construction/fire) income-bearing unit,
// REGARDLESS of occupancy or served-status.
cost += overheadPerLeasableUnitMonthly;
```

No new failure state, no new tick, no new HUD element — it rides the existing monthly
maintenance booking and its existing toast (`"Monthly maintenance paid: $X"`).

### Tuning intent (rough — numbers are a starting band, not law)

Anchor to the GDD's TOWER-scale figures: **~2,500 offices, ~$100M/yr gross rent.**

- Target **total upkeep ≈ 10–20% of gross at all scales** when the tower is well-run.
  At $700/unit/month × ~2,500 units ≈ **$21M/yr overhead** on ~$100M gross → ~21% haircut,
  net ~$79M/yr. Still absurdly profitable — money never becomes scary — but an office's fat
  margin *thins* with scale, so late decisions (premium pricing, culling dead floors,
  building to demand) matter again.
- It **self-scales**: because it's per-unit like income is per-unit, it can never outrun the
  economy into a spiral — a bigger tower has proportionally bigger overhead *and* bigger income.
- The **bite is local**: every vacant or unserved unit is a clean ~$8k/yr drag (≈20% of an
  office's $40k/yr rent) with zero offsetting income. That's the number that makes "connect
  this floor / don't over-build" a live question, without ever threatening the bank.

### Guardrails (hard requirements)

1. **Never punitive, no bankruptcy spiral.** Overhead is a fraction of gross by construction;
   it cannot exceed income for a functioning tower and cannot itself drive money negative into
   a death loop. Existing build-affordability checks already gate spending at low cash — we add
   no new "you lose" state.
2. **Money stays retired as a *win/lose condition*.** This is a dial, not a boss. There is no
   game-over-by-bankruptcy and none is introduced. The win is still the TOWER star.
3. **Readable.** It's a line inside the existing monthly maintenance total — one number, one
   toast the player already sees. No new panel. (Optional, low-churn: a one-line breakdown in
   the stats panel — "Upkeep: $X/mo" — if playtesting shows the erosion feels invisible.)
4. **Determinism / save-safety preserved.** Pure function of current tower state each month;
   no RNG, no new serialized field. Old saves behave identically the first month they tick.
5. **Screenshot churn: none.** No new HUD chrome; existing demo towers just show a slightly
   larger maintenance number.

---

## #5 — Blockbuster as a player choice

### The decision

**Turn the auto-roll into a per-cinema booking policy the player sets in the editor card —
but keep today's 40% roll as the DEFAULT, so nothing changes for existing saves/screenshots
and agency is purely opt-in.**

Today (`payMaintenance()`, ~L200): every operational cinema independently rolls
`rng.chance(0.4)` → blockbuster ($300k booking, `filmMult = 2.2` bigger crowd in
`collectTrafficIncome`) vs average film ($150k). The outcome isn't actually random *payoff* —
the blockbuster's 2.2× crowd is deterministic; the **real gamble is whether your tower's foot
traffic is high enough to earn back the doubled fee** (`trafficAppeal()` is capped at 1, so a
quiet tower can't cover it). That is already a clean, skill-based bet — it's just a bet the
*game* places, not the player. We hand it to the player.

### The interaction

A **per-cinema booking policy**, set exactly where rent is set — the selected-facility editor
card (same home and pattern as the office/condo rent adjuster in `main.ts unitEditorHtml`,
lines ~475). Select a cinema → the card gains:

- A **status row** (volatile): `Now showing` → `Feature` / `Blockbuster` (reflects what was
  actually booked this month; `—` before the first booking).
- A **policy control** in an `ed-row`, a single cycling button mirroring the `+/- rent`
  buttons: `Booking: Auto ▸` → click cycles **Auto → Feature → Blockbuster → Auto**.

Three policies, stored per-unit:

| Policy | Behavior in `payMaintenance()` | Cost | Crowd |
|---|---|---|---|
| **Auto** *(default)* | today's `rng.chance(0.4)` roll, unchanged | $150k or $300k | 1× or 2.2× |
| **Feature** (play it safe) | never blockbuster | $150k | 1× |
| **Blockbuster** (gamble) | always blockbuster | $300k | 2.2× |

`payMaintenance()` reads the policy instead of always rolling; the `Auto` branch *is* the
existing code path, so determinism and the seeded-RNG stream are untouched for any cinema left
on default.

### What persists

A new optional field on the cinema unit — `filmPolicy?: "auto" | "feature" | "blockbuster"` —
serialized with the unit (save-safe; **`undefined` ⇒ Auto**, so old saves and demo towers load
identically). The already-serialized `blockbusterIds` set (which film is *currently showing*,
so a mid-month reload keeps the boost it paid for) is unchanged and complements this cleanly.

### Wording

- Button (cycles): **`Booking: Auto ▸`** / **`Booking: Feature ▸`** / **`Booking: Blockbuster ▸`**
- Status row: **`Now showing`** → **`Blockbuster`** / **`Feature`** / **`—`**
- One-line explainer (in the existing help/how-to modal, `UI.ts` — no new modal):
  *"Cinemas book a film each month. A **Blockbuster** costs twice as much but pulls a far
  bigger crowd — a strong bet in a busy tower, a money-loser in a quiet one. Leave it on
  **Auto** to let your booker decide, or pick a policy yourself."*

### Relationship to the current 40% auto-roll

**Kept as the default, not replaced.** This is the deliberate restrained choice and it satisfies
the constraints directly: existing saves, existing balance, and existing screenshots are
byte-for-byte unaffected because a cinema with no explicit policy runs the identical
`rng.chance(0.4)` path. Agency is layered *on top* — the player who wants to lean into a busy
tower books Blockbusters; the player husbanding a quiet early tower books Features; everyone
else ignores it and the game behaves exactly as today.

> Considered alternative (documented, not chosen): default new cinemas to **Feature** so they
> never silently spend $300k. Cleaner "no surprise spend" story, but it *changes* current
> balance and every screenshot/demo baseline, and it makes the blockbuster invisible to a
> player who never opens the editor. Rejected for churn; revisit only if playtests show players
> resent Auto's automatic spend.

### Guardrails

1. **Determinism preserved.** Auto keeps the seeded `rng.chance(0.4)` in the same call order;
   Feature/Blockbuster consume no RNG. The per-cinema draw order is already unit-iteration
   order — unchanged.
2. **Save-safe.** New field is optional; absent ⇒ Auto ⇒ legacy behavior.
3. **No new HUD/modal chrome.** One row + one button inside the existing editor card; one line
   in the existing help modal. Screenshot churn only when a cinema is actually selected.
4. **Non-punitive.** No policy can bankrupt — a Blockbuster is at most the existing $300k
   monthly booking the economy already tolerates; the "loss" is opportunity cost in a quiet
   tower, which is the intended *decision*, not a penalty.

---

## Touchpoints (for the dev handoff)

- `src/engine/econConfig.ts` — add `overheadPerLeasableUnitMonthly` (#4). `cinemaBooking*`
  constants unchanged (#5).
- `src/engine/EconomySystem.ts` — `payMaintenance()`: add the per-unit overhead line (#4);
  branch the cinema booking on `filmPolicy` instead of the unconditional 0.4 roll (#5).
- `src/engine/types.ts` (Unit) — add optional `filmPolicy` (#5); ensure it serializes.
- `src/main.ts` — `unitEditorHtml` / `unitEditorVolatile`: cinema "Now showing" row + cycling
  "Booking" button, wired like the existing rent adjuster (#5).
- `src/ui/UI.ts` — one explainer line in the help/how-to modal (#5). No new modal.

Both items are additive, faithful, and restrained: #4 makes money a *readout of the transport
puzzle* rather than a fake second economy; #5 hands the player a bet the game was quietly
making for them. Neither touches parity.

---
*Produced by the BMAD `gds-agent-game-designer` (Samus Shepard), grounded via
`_bmad-output/project-context.md`, `gdd-core-loop-2026-07-01.md`, and the live engine.*