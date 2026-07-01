---
title: "UX Spec — The Legibility Pass (surface three silent rules)"
game: Tower Tycoon (browser SimTower clone)
author: Samus Shepard (Game Designer — BMAD gds agent)
date: 2026-07-01
status: Ready for dev
scope: UX/UI spec for GDD §5 recommendations #2 and #3 — make three
  correct-but-invisible rules legible. Surface truth only; no new mechanics,
  no penalties, no HUD churn.
grounds:
  - _bmad-output/planning-artifacts/design/gdd-core-loop-2026-07-01.md (§4, §5)
  - src/main.ts inspectPicked (~L806), buildStatsHtml (~L659)
  - src/ui/UI.ts showInspector (~L422), showStats (~L269), toast (~L432)
  - src/engine/Crowd.ts route() MAX_RIDES=2 (~L143)
  - src/engine/Tower.ts isFloorServed (~L656), functionalParkingSpots (~L675)
  - src/engine/Simulation.ts ratingPopulation (~L854), readonly crowd (~L107)
---

# UX Spec — The Legibility Pass

> **The rule of this pass:** we are drawing back a curtain, not adding a room.
> Every string below reports a truth the simulation *already computes*. If a line
> would require a new mechanic, a new penalty, or a per-tick recompute painted on
> the live canvas, it is out of scope. The bar is: a player who reads the tooltip
> understands why a floor is dead — and nothing on screen moves that didn't move
> before.

## 0. Design principles (the guardrails)

1. **One authoritative home per fact.** The **click-inspector** is the per-object
   truth ("*this* floor / *this* space"). The **Tower Statistics modal** is the
   tower-wide roll-up ("how many, tower-wide"). No fact lives in two always-visible
   places; that is how you get nagging.
2. **Pull, not push.** These are diagnostics the player *seeks* when something is
   wrong (a floor won't fill, a star won't tick). They belong behind a click
   (inspector) or a button (stats), **not** in an always-on HUD band and **not**
   in recurring toasts.
3. **Silence when correct.** A warning only renders when the condition is truly
   bad *and actionable*. A well-built tower shows zero warnings — the absence of
   a warning is itself information.
4. **No false alarms.** Never warn about a floor with no tenants, parking the
   player hasn't built, or the hotel rule before it is active (below 3★). See §5.
5. **Screenshot stability is a feature.** The demo/camera screenshots
   (`npm run screenshots:docker`) must stay stable. Nothing here animates, blinks,
   or recomputes on the tick loop. The only new persistent world-anchored mark is
   a **static** red X on dead parking (canon), which changes only on build/bulldoze.

---

## 1. Signal A — the ≤2-ride reachability truth (GDD #2 / §4)

### The rule being surfaced
A trip takes **at most two transport rides** (`Crowd.route`, `MAX_RIDES = 2`).
A floor can be **structurally served** — `isFloorServed(floor)` true, a chain of
elevators/stairs reaches it — yet still sit **3+ rides from the ground lobby**, in
which case `route(1, floor)` returns `null` and **no commuter ever spawns for it**
(`Crowd.add` bails on a null route). Today the inspector shows only
`Served by elevator: Yes` — which is *true and misleading*: the floor is served,
but nobody comes. This is the single most confusing invisible rule in the build.

### The core fix: make the inspector tell the whole truth (three states, not two)

Replace the current single `Served by elevator: Yes/No` line with one **Access**
line that distinguishes the three states the engine already knows:

| Engine state | Player-facing line |
|---|---|
| `!isFloorServed(floor)` | **Access: not connected** — no elevator or stair reaches this floor. |
| served **but** `route(1, floor) === null` | **Access: too far** — connected, but 3+ rides from the lobby, so no one travels here. Add a sky-lobby transfer. |
| served **and** `route(1, floor) !== null` | **Access: reachable** (≤2 rides from the lobby). |

Rendering notes:
- Compute once, at inspect time (a click), from `this.sim`:
  `served = tower.isFloorServed(u.floor)`, and only if served,
  `reachable = this.sim.crowd.route(tower, 1, u.floor) !== null`. `route()`
  runs a bounded (≤2-ride) BFS per call — only Crowd's ADJACENCY is cached by
  `tower.revision`, not the route result — cheap for an inspect-time call but must never run on the
  tick loop.
- Colour: use the existing status vocabulary — `not connected` and `too far` in
  `var(--bad)`, `reachable` in `var(--good)`. Do **not** invent new colours.
- The **"too far"** row is the whole point of the pass — it is the only line that
  turns an invisible dead floor into a diagnosable one. It must name the fix
  ("Add a sky-lobby transfer") in one short clause, no paragraph.

### The tower-wide roll-up: one line in the Stats modal

In `buildStatsHtml`, add a **Transport** section (or a row to the existing
Overview) that counts occupied, tenant-bearing above-ground floors that are
served but *not* 2-ride-reachable — the same predicate `milestones.ts`
already uses for `everyOccupiedFloorServed`, tightened to the route check:

```
Stranded floors        3          <- var(--bad) when > 0, var(--good)/"None" when 0
```
with a single muted sub-line only when the count is > 0:
> Leased floors that are 3+ rides from the lobby — they earn rating credit but
> draw no visitors. Add a sky-lobby transfer.

Restraint: count **only** floors that (a) carry an occupied/asleep,
population-bearing tenant unit and (b) are above ground (`floor >= 2`). An empty
or purely-structural floor is not "stranded" — it has no one to strand. When the
count is 0, show **"None"** in green; never show the sub-line.

### Optional, throttled log nudge (recommended, low-churn)

At most one **log entry** (never a toast) when the stranded count crosses from 0
to >0, de-duplicated so it cannot repeat while the condition persists:
> A leased floor is 3+ elevator rides from the lobby — no visitors will come.
> Check it in the inspector.

This lives in the scrolling event log alongside star-up / fire messages, so it
does not churn screenshots or steal focus. **Do not** use a toast (toasts are
reserved for the player's own immediate actions) and **do not** re-emit per floor
or per tick.

---

## 2. Signal B — hotels stop counting toward the rating at 3★+ (GDD #3a / §5)

### The rule being surfaced
`ratingPopulation()` returns the full `totalPopulation()` below 3★, but at **3★
and above it excludes hotel guests** — the displayed `population` still counts
them, so a hotel-heavy tower shows a big population that *doesn't move the star*.
The player sees a healthy number and a stuck star and cannot connect them.

### Fix 1 — inspector line on hotel units
When inspecting any hotel-kind unit, add one line that states the rule in the
present tense of the current game:

| Condition | Line |
|---|---|
| `star < 3` | **Counts toward next star: yes.** |
| `star >= 3` | **Counts toward stars: no** — hotel guests stop counting at 3★ (they still earn income). |

The "(they still earn income)" clause is important restraint: it tells the player
the hotel isn't *worthless*, just rating-neutral — so we surface the trap without
scaring them off a legitimate money-maker.

### Fix 2 — Stats modal makes the two populations visible
In the Overview block, when the two numbers diverge, show the rating population
next to the headline population instead of only the headline:

```
Population        8,400
Counts toward stars   5,900     <- only shown when star >= 3 AND ratingPop < population
Next star at      10,000
```
Muted sub-line, shown only in that divergent case:
> Hotel guests count toward your star rating only until 3★.

Restraint: **below 3★, or when the numbers are equal, show nothing extra** — the
headline population already tells the whole story, and an always-present second
number would be noise (and a screenshot diff) for the majority of towers.

---

## 3. Signal C — dead (un-chained) parking spaces (GDD #3b / §5)

### The rule being surfaced
`functionalParkingSpots()` flood-fills from ramps over contiguous parking/ramp
tiles; a space with no chain back to a ramp is **dead — zero relief** (canon's
"red X"). Today the space looks identical to a working one, so a player who lays a
row of spaces with no ramp gets no benefit and no explanation.

### Fix 1 — render the canon red X (static, world-anchored)
Draw a **red X** over each parking space that is *not* in the ramp-connected set.
This is the one persistent world-space mark the pass adds, and it is legitimate
because it is (a) canon, (b) static — it only changes when the player builds or
bulldozes parking, never on the tick — so it does not churn screenshots of a
settled tower. Reuse `functionalParkingSpots()`'s flood-fill to derive the
connected id-set; a space whose id is absent gets the X. Keep it a flat drawn
glyph in `var(--bad)`, no glow, no animation.

### Fix 2 — inspector line on parking units
When inspecting a parking space:

| Condition | Line |
|---|---|
| in the connected set | **Ramp access: connected.** |
| not connected | **Ramp access: none** — this space is dead (no relief). Chain it to a Parking Ramp. |

When inspecting a Parking Ramp itself, no extra line is needed beyond the normal
transport inspector.

### Fix 3 — Stats modal count
Add one Tenancy/Transport row:
```
Parking spaces      12 / 20 working     <- "working/total"; the shortfall in var(--bad) when any are dead
```
Restraint: **omit this row entirely when the player has built no parking.** Do not
show "0 / 0" — that is a false alarm for the many towers with no garage.

---

## 4. Placement summary (at a glance)

| Signal | Inspector (per-object) | Stats modal (roll-up) | World canvas | Log |
|---|---|---|---|---|
| A · ≤2-ride access | **Access:** 3-state line (primary fix) | "Stranded floors: N" + note when >0 | — | one-time, throttled nudge (optional) |
| B · hotel-at-3★ | "Counts toward stars: yes/no" on hotel units | second pop line when divergent | — | — |
| C · dead parking | "Ramp access: connected/none" on spaces | "Parking: working/total" when parking exists | **static red X** on dead spaces | — |

The inspector carries the *why-is-this-one-thing-dead* load; the stats modal
carries the *how-bad-tower-wide* load; the canvas carries only the canon parking X.

---

## 5. What NOT to do (the restraint contract)

- **No always-on HUD counters.** Do not add a persistent "stranded floors" or
  "dead parking" badge to the top/side chrome. These are pull diagnostics; a
  standing counter would nag every well-built tower and diff every screenshot.
- **No recurring toasts, no per-tick recompute on the canvas.** The only tick-loop
  cost is nil — every line here is computed on click (inspector) or on modal-open
  (stats). The red X derives from the existing per-revision flood-fill.
- **No false alarms.** Never flag: a floor with no tenants (nothing to strand);
  parking before any parking is built; the hotel rule below 3★ (there it is
  *true* that hotels count — say so). Silence on a healthy tower is required.
- **No new penalties or mechanics.** GDD §4's "soft economic penalty for starved
  floors" and §2's scaling upkeep are **separate, later** recommendations. This
  pass surfaces the *existing* truth only — it must not change a single simulated
  number, or the parity tests, or the balance.
- **No jargon and no essays.** Each surfaced line is one clause of state plus, at
  most, one short clause of remedy ("Add a sky-lobby transfer" / "Chain it to a
  Parking Ramp"). No tooltips-within-tooltips, no rules lawyering. If it needs a
  paragraph, it belongs in the help text, not the inspector.
- **Reuse the existing visual vocabulary.** `var(--good)`/`var(--bad)`/`var(--muted)`,
  the `k`/`v` stats-grid rows, the existing inspector `<div>` lines. Introduce no
  new components, panels, or colours.

---

## 6. Acceptance criteria

1. Inspecting a floor that is served but needs 3+ rides shows **Access: too far**
   with the sky-lobby remedy; inspecting the same floor after a valid transfer is
   added shows **Access: reachable**. (Drives directly off `crowd.route(1, floor)`.)
2. A hotel room inspected below 3★ reads "counts: yes"; the same room at 3★+ reads
   "counts: no", and the stats modal's second population line appears only when
   `ratingPopulation() < population`.
3. A parking space not chained to a ramp shows a static red X on the canvas **and**
   "Ramp access: none" in the inspector; chaining it to a ramp removes both.
4. A fully well-built tower (all floors ≤2 rides, no hotels stalling a star, all
   parking chained, or no parking) shows **no** warning lines, **no** red X, **no**
   extra stats rows, and **no** log nudge — and produces a byte-stable screenshot
   versus before the pass.
5. No line in this spec triggers work on the tick loop or alters any simulated
   value; parity and balance tests are unaffected.
