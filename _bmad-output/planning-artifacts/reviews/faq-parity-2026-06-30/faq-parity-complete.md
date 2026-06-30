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

## Deliberately retained / deferred divergences (with rationale)

These are the only places the clone still differs from the FAQ, each for a stated
reason rather than an oversight:

| FAQ detail | Decision | Why |
|---|---|---|
| Cathedral on floor 100 | Kept as **Wedding Hall** | Clean-room / religion-neutral — a deliberate project value, not a fidelity gap; mechanics (floor 100, wedding→TOWER) match. |
| TOWER at 15,000 pop | **8,000** | Re-derived from the lot's measured capacity under the spatial model; the metric (occupant census) is faithful, only the number is scaled. |
| Fire rescue **$500k** choice | **Deferred** | An interactive player decision; needs a UI event-choice layer. Today fire response is automatic via Security/Medical coverage. |
| Terrorist **$300k ransom** choice | **Deferred** | Same — the *ransom-vs-search* decision needs the UI choice layer. The **damage** is now canon-accurate (≈5 floors) and Security still defuses it. |
| Metro spans **3 floors** (B8–B10) | **Deferred** | Cosmetic footprint only (it's a whole-floor station either way); changing it cascades basement placement conflicts (metro vs recycling) for ~zero gameplay value. |
| Parking **ramp + spots** chain | **Deferred** | A large model refactor; the gameplay intent (offices demand parking) is captured by the new 3★ parking-demand rule above. |
| Several items **non-removable** (Security/Metro/Cathedral/Housekeeping…) | **Kept removable** | The partial-refund bulldoze is a deliberate QoL improvement, and the F31 review fix (cancelling a pending VIP when the hall is sold) depends on removability. |
| Escalator **commercial-only** | **Deferred** | "Commercial space" has no crisp definition in this engine; low value, high ambiguity. |
| **Cockroach** infestation in unclean hotels | **Deferred** | Pure flavor; adds per-unit dirty-day state for little gameplay gain. Dirty rooms already can't re-let until cleaned. |

These remaining items are tracked here so nothing is silently dropped; the first
three (fire/terrorist choices) are the natural next step once a UI event-choice
component exists.
