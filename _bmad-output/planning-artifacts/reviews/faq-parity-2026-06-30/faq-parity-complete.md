# FAQ Parity — Completion Report

Closes out the [FAQ-grounded parity audit](./faq-parity-audit.md) against the
canonical [`faq-canon.md`](./faq-canon.md). Tier-1 landed earlier (PR #41,
merged). This report covers the complete-parity follow-up (PR for branch
`claude/simtower-faq-parity-complete`), scoped per the owner to *everything
mechanical + revisit divergences*.

## Now at parity (implemented)

**Star ladder (canon)**
- 4★ gate: pop 5,000 **+ Medical + Recycling + >1 Hotel Suite + a favorable VIP**.
- 5★ gate: pop 10,000 **+ Metro** (metro moved out of the TOWER check).
- Hotel guests count toward the rating **only while climbing to 3★**; excluded at 3★+.
- VIP stays **only in a suite**; a well-run served suite earns the favorable review.

**Mechanics**
- **Office noise** — a hotel/condo with an office immediately beside it loses
  satisfaction ("Office neighbor is too noisy").
- **Rain** depresses commercial foot traffic (hardest on fast food; a metro softens it).
- **Cinema** carries a monthly film-booking cost (no longer free money).
- **Unguarded bomb** levels ~5 floors of rooms (was a single unit).
- **Buried treasure** ≈ half a million.
- **Santa** is a cameo only — no cash gift ("No presents, sorry").
- **Office parking demand** — from 3★, a parking shortfall slows new office move-ins.

**(Tier-1, already merged):** unlock ladder (escalator/double/suite/restaurant/
shop/parking → 3★, recycling at 3★), double-hotel 50k, service-elevator shaft
100k, express "no length limit" (full tower height).

Every item above is covered by `src/tests/faqComplete.test.ts` (+ the earlier
`reviewFixes`/`phase2` suites). Full suite green.

## Also now implemented (the previously-deferred set)

Per the owner's "complete parity" directive, the Tier-3 items first scoped as
deferred have all been built:

- **Fire rescue ($500k) and terrorist ransom ($300k) — interactive choices.** A
  pending-choice engine (`Simulation.pendingChoice` / `resolveChoice`) with an
  in-game modal: accept to pay, or decline (fire burns on / Security searches).
  Unanswered choices auto-decline at the next daily roll. An undetected bomb
  levels ~5 floors (canon).
- **Metro spans 3 deep-basement floors** (B8–B10), per canon.
- **Parking ramp + spots** — a new `parkingRamp` facility (50k); spaces (3k) only
  count when chained to a ramp; offices demand parking from 3★.
- **Escalators are commercial-only** — rejected on floors that hold an office.
- **Cockroaches** spread from unserviced dirty rooms into adjacent hotel rooms.

## Follow-up round (canon numbers + fine mechanics) — 2026-06-30

The owner ratified closing the remaining scale/mechanic gaps:

- **TOWER 15,000 / 5★ 10,000 restored.** The buildable lot was widened to 340
  tiles so the canonical population is genuinely reachable (measured ~15,066
  non-hotel occupants at congestion 0.82). No longer a divergence.
- **≤2-ride trips.** A commute routes over at most two transport rides (one
  sky-lobby transfer), per "Sims will only take two methods of transportation."
- **Blockbuster vs average film.** Each cinema books a blockbuster (~300k, bigger
  crowd) or an average film (~150k) monthly, replacing the flat booking cost.
- **Strict parking chains.** A parking space only functions when it chains back
  to a ramp through contiguous tiles; the demand check and both congestion-relief
  models now agree on that count.

## The only remaining divergences (deliberate, not gaps)

| FAQ detail | Decision | Why |
|---|---|---|
| Cathedral on floor 100 | Kept as **Wedding Hall** | Clean-room / religion-neutral — a ratified project value; mechanics (floor 100, wedding→TOWER) match exactly. |
| Some items **non-removable** in canon | **Kept removable** (partial-refund bulldoze) | A ratified QoL improvement, and the F31 review fix (cancelling a pending VIP when the hall is sold) depends on removability. |

These two are intentional design/clean-room choices, not fidelity oversights.
Every mechanic and every headline number in the FAQ is now modelled.
