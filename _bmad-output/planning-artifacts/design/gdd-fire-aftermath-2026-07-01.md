# GDD — Fire Aftermath: Fire Destroys Rooms

**Date:** 2026-07-01
**Party:** SimTower canon historian · Samus Shepard (Game Designer) · Cloud Dragonborn (Architect, cross-ref)
**Targets:** `src/engine/EventSystem.ts`, `src/engine/types.ts`, `src/render/sprites.ts`, `src/main.ts`, `PARITY.md`
**Companion:** `arch-fire-aftermath-2026-07-01.md`

---

## 1. The problem in one line

Fire currently **heals** rooms. Both resolution paths — `processFires` containment
(EventSystem.ts ~L261) and `extinguishAll` paid rescue (~L149) — reset the burned unit to
`state="empty"; satisfaction=1; everOccupied=false`, a fresh vacant room that instantly
re-leases. Containment even *charges a 30% "repair" fee* and then reopens the room like new.
That reads as "fire = a small toll," not "fire = a disaster." It breaks SimTower canon and,
ironically, is *too soft* to teach the player why Security/Medical matter.

## 2. Canon ruling (SimTower 1994)

- Fires ignite at random (biased to the wee hours), reduced by Security/Medical coverage.
  Our `fireChance()` = 0.05 × 0.6 (Security) × 0.5 (Medical) mirrors this. ✅ keep.
- An untended fire **spreads to adjacent rooms over time**. Our `processFires` spreads to
  one `adjacentRoom` per uncontained day — a faithful simplification. ✅ keep.
- Emergency-response coverage determines how far a fire spreads before it is out — the whole
  reason the original rewards Security/Medical. ✅ keep.
- **THE KEY FACT — fire destroys rooms.** Extinguished rooms are **gone**: charred ruins, no
  income, no tenants, and they **must be bulldozed and rebuilt from scratch**. There is **no
  auto-repair and no auto-re-lease.** Fire is a genuine capital loss. This is exactly the
  player's expectation in the bug report; the current code violates it.

Our project has *deliberately diverged* on the firefighting **UI** — rescue is a paid player
choice via a modal that pauses the sim (`resolveChoice`, project-context L42). That divergence
stays. What must be restored is the **outcome**: burned rooms are destroyed, not refreshed.

`PARITY.md` L55 currently says fire "costs repairs" — that wording is what led the
implementation astray. The canon cost is **rebuild**, not repair.

## 3. Decision — gutted shell, NOT removal

| Option | Verdict |
|---|---|
| **New `"gutted"` shell state** (footprint stays, non-functional, must be bulldozed + rebuilt) | ✅ **Chosen** |
| Outright remove the unit (bare floor) | ❌ erases the scar; "it just vanished" in reverse; heavier UX (re-place slab, re-validate geometry); multi-tile save edge cases |
| Keep any auto-repair-to-vacant path | ❌ this **is** the bug |

Rationale: a **visible charred scar** is the emotional payload of the disaster. It is the
minimal, save-safe change (one new `UnitState`, no geometry churn), keeps the structural floor
tile intact (canon: fire burns the room, the storey stays), and reuses existing art
(`drawBurntShell` already exists).

### New unit state: `"gutted"`

Invariants for a gutted unit: `state="gutted"`, `occupants=0`, `everOccupied=false`,
`satisfaction=0`, `pendingIncome=0`. It is inert — never leased, never earns, never counts as
operational, never provides service coverage, never churns, **not flammable** (a ruin can't
re-ignite), and never in `EventSystem.active`. `tryLease` already requires `state==="empty"`,
so a gutted unit can never silently re-lease — this is what kills the bug.

## 4. What each resolution path does now

**`processFires` containment.** Delete the `cost*0.3` repair charge and the reopen-to-empty.
On containment the fire **stops spreading** and the room is left **gutted**:
```
gut(u); this.active.delete(id);
emit(`Firefighters stopped the blaze on ${floor}, but the room is gutted — bulldoze and rebuild it.`, "bad")
```
Containment now means "the fire stopped spreading," not "the room is fixed." The consequence
(a destroyed room to rebuild) *is* the cost. There is no cash fee at containment; the player
pays the real rebuild cost later, by choice.

**`extinguishAll` paid rescue.** The fee buys *stop-the-spread + save-lives + end-the-panic*,
**not** free real estate. Every unit already `"fire"` becomes **gutted**; the spread halts
instantly and the tower-wide satisfaction drain ends that instant:
```
for burning u: gut(u); this.active.clear();
```
So whether you pay or decline, **you rebuild** (canon). Paying just caps the crater.

## 5. What the paid rescue is worth now (honest repricing)

`fireRescueCost` stays scaled ($150k @2★ → $500k @5★). Its value:
- **Instantly halts the spread** — caps losses at the currently-burning room(s).
- **Ends the tower-wide satisfaction drain** the moment it lands (declining keeps bleeding
  −0.05/day to every occupant until contained).
- **"Saves lives"** — the emergency-response fantasy.

It is **damage control, not an undo button.** Early game, **declining is a legitimate
strategy** (base containment ~0.50 contains most fires next day); the fee is *insurance for
dense towers* where one un-contained day could gut three neighbors and torch satisfaction
floor-wide. The fee scales with what's at stake.

## 6. Recovery loop (what the player must do)

1. Fire ends → one or more **charred shells** sit in the tower.
2. Player **bulldozes** the shell — clears to bare floor, **$0 refund**, no bulldoze charge
   (sweeping ash, not demolishing an asset).
3. Player **rebuilds** the facility at **full build cost** from `facilities.ts`.

**Bulldoze refund on a gutted shell = $0.** Today `bulldozePicked` (main.ts ~L1065) and the
sell paths refund `cost*0.5`. Rubble has no resale value. Inspector "Resale value" row →
"Scrap value: $0" for gutted units (main.ts ~L684/738). Keep the guard that you cannot bulldoze
a *burning* (`state==="fire"`) unit; allow bulldozing a gutted one freely.

**Optional QoL (balance-neutral, ship later):** an inspector "Rebuild in place — $<full cost>"
button on a gutted unit that bulldozes-and-rebuilds the same kind in one click. Full price, so
it changes ergonomics, not economics.

## 7. Balance — a real setback, not a death spiral

The old model charged 30% and reopened instantly. The new model costs **100% rebuild + lost
income during downtime + fresh-tenant delay** — strictly harsher, so protect the early game
with existing levers:

- **One ignition per event** (`startFire` picks a single room); `maybeRandomEvent` won't start
  a new fire while `active.size > 0`. The crater grows slowly, laterally, one floor.
- **Containment base 0.45 → 0.50.** Now that every failed containment = a *permanently
  destroyed* room (not a 30% fee), nudge the free front-line up so a player who can afford
  neither Security nor the rescue fee still contains most fires quickly. Security (+0.20) and
  Medical (+0.30) remain the meaningful, visible payoff for staffing.
- **Small-tower safety valve:** a fire may **not** spread into a tower's **last operational
  room of its kind**. A 3-room starter can lose a room, but never be wiped to zero in one
  blaze. Deterministic, cheap (guard in the spread branch of `processFires`).
- **Gutted rooms are inert** — no ongoing satisfaction bleed (the −0.05/day loop only runs
  while `active.size > 0`), no income drain, not flammable. A struggling player loses one room
  and rebuilds when cash allows; no compounding collapse.
- **Prevention still pays:** `fireChance` unchanged — building Security + Medical makes fires
  rare. That story gets *stronger* now that fires actually hurt.

**Cost feel, concrete** (`facilities.ts`): rebuild Office ≈ $40k, Condo ≈ $80k, Hotel Single
≈ $20k, Shop/Fast Food ≈ $100k, Restaurant ≈ $200k — plus a few days of zero income. Painful,
survivable, scales naturally with tower size. **No new tuning constants** — we *delete* the
`0.3` repair magic number and set the gutted refund to `0`.

## 8. Aftermath feel + messaging (`#a11y-live` + toasts)

`emit(text,"bad")` auto-surfaces as toasts via `UI.renderLog`; `#toast-wrap` is
`aria-live="assertive"`, `#log` is `aria-live="polite"`. Route urgency by kind:

| Beat | Message | kind | Channel |
|---|---|---|---|
| Ignition | `🔥 Fire broke out in {room} on {floor}!` | `bad` | assertive toast + log + **modal (pauses sim)** |
| Spread | `The fire spread to {room} on {floor}!` | `bad` | assertive toast + log |
| Room lost (contain) | `🔥 The {room} on {floor} burned down — only a gutted shell remains. Bulldoze the rubble and rebuild.` | `bad` | assertive toast + log |
| Rescue paid | `🚒 Fire-rescue crews saved the tower for ${cost}. The rooms that were ablaze are gutted — rebuild them.` | `money` | log (money tint) |
| All clear | `The fire is out. {n} room{s} destroyed.` | `bad` if n>0 else `info` | toast/log summary |

Extra a11y polish:
- The **fire-rescue modal body must state the consequence up front:** *"Rooms already ablaze
  will be gutted whether you pay or not. Paying stops the fire spreading to neighboring rooms
  and ends the panic."* — so the player isn't tricked into thinking $150k un-burns the room.
  Focus-trap the modal (it already pauses the sim).
- Keep the recovery instruction ("Bulldoze the rubble and rebuild") on the **assertive**
  channel (kind `bad`), not the polite log — it's what a blind player most needs.
- Selecting a gutted unit announces plainly via `#a11y-live`: *"Selected {room} — burned-out
  shell. Bulldoze and rebuild."* (extend the inspect path, main.ts ~L201).

## 9. Rendering (`src/render/sprites.ts`)

`drawUnit` already composes `drawBurntShell` + `drawFlames` for `state==="fire"` (L68–70).
A gutted room is the **shell without the flames** — near-zero new art. Add a gutted branch
above the room dispatch: `if (u.state === "gutted") return drawBurntShell(...)`. It must read
as *damage that persists* — charred black/dark-grey, scorched outline, no signage, no lit
interior, no CLOSED sign — visually distinct from `empty` (clean vacant) and `fire` (animated
flames). Pixel-sprite path needs no change: `drawUnit` intercepts `"gutted"` before dispatching
per-kind, so the husk wins for all kinds.

## 10. Save-safety & determinism

- `gutted` is a plain serialized `UnitState` — no new save field, no version bump.
- `rearm()` re-arms `active` from `units.filter(u => u.state === "fire")`; gutted is excluded,
  so a **saved gutted room never re-ignites on load**. Load → gutted stays gutted.
- Fully deterministic: no new RNG. Containment still consumes exactly one `rng.chance(control)`
  roll per active fire per day; removing the repair charge changes only money, not RNG order.

## 11. Implementation checklist (design surface)

- [ ] `types.ts`: add `"gutted"` to `UnitState`.
- [ ] `EventSystem.processFires`: contained fire → gutted; **delete** the `cost*0.3` repair;
      new "burned down / gutted shell" `bad` message.
- [ ] `EventSystem.extinguishAll`: burning units → gutted (not empty); new "saved the tower /
      rebuild them" message.
- [ ] `EventSystem.flammableUnits`: exclude `state === "gutted"`.
- [ ] `EventSystem` spread guard: don't spread into a tower's last operational room-of-kind.
- [ ] `controlChance`: base `0.45 → 0.50`.
- [ ] `main.ts` bulldoze: gutted refunds `0`, clears free; inspector "Resale value" →
      "Scrap value: $0" for gutted; gutted inspect announcement; skip parking/access verdicts.
- [ ] `src/render/sprites.ts`: gutted branch → `drawBurntShell`.
- [ ] Fire-rescue modal copy: state ablaze rooms are gutted regardless.
- [ ] `PARITY.md` L55: "costs repairs" → "destroys the burned rooms (rebuild required); spread
      contained by Security/Medical or paid rescue." Note under PRD FR-48.

## 12. One-line summary

Fire outcome flips from **"repair back to like-new vacant + re-lease"** to **"leave a gutted
shell (no income, no tenants, not flammable) that the player must bulldoze (≈$0 refund) and
rebuild."** The paid rescue buys *stopping the spread and saving the rest of the tower*, not
restoring the rooms that already burned. Restores canon, makes Security/Medical meaningful,
stays deterministic and save-safe, and — because gutted shells are inert — does not create a
death spiral.
