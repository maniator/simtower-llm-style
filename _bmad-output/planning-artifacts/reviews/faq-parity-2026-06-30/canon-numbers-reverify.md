# Canon Numbers Re-verify — PR #46 (second re-verification)

**Commit:** 2b7afa3 ("Fix deep-review findings on PR #46 (M1/M2/M3 + minors)")
**Scope:** re-verify the three majors from `canon-numbers-review.md` after fixes.
**Gates reproduced independently:** 143/143 tests pass across 13 files (`vitest run`), `tsc --noEmit` clean, `eslint .` clean.

## Merge verdict: SAFE TO MERGE

All three majors are genuinely resolved in real source; no blocker or major survives. Each fix was verified against the actual file state, not just the changelog, and every refutation attempt failed.

### M1 — parking flood-fill quadratic blowup — RESOLVED
`Tower` now holds a private `byId = new Map<number, Unit>()` (Tower.ts:44), mutated only by `register()` (`byId.set`, :112), `unregister()` (`byId.delete`, :127), and `reindex()` (`byId.clear()` + re-register all, :140-147). Every path that touches `tower.units` keeps the index in lockstep: `place()` does `units.push` then `register()` (:367-368); `removeUnit()` does `units.splice` then `unregister()` (:473-474); `deserialize` reassigns `sim.tower.units` wholesale (Simulation.ts:1071) then calls `tower.reindex()` (:1114) with no intervening `byId` read. A grep across non-test src confirms these are the only mutations of `tower.units`, so no stale/missing/duplicate index entry arises in normal flows. `roomAt`/`unitAt` (:51-64) resolve tile→id via the rooms/structure maps and id→unit via `byId.get` (O(1)); `functionalParkingSpots` calls `roomAt` per tile (:691), so the flood-fill is O(region), not O(tiles×units). The one-time ramp-seed loop over `this.units` is O(units), consistent with surrounding congestion code — not the quadratic path M1 flagged.

### M2 — stacked parking without a ramp wrongly counted — RESOLVED
`functionalParkingSpots` (Tower.ts:675-702) seeds every operational `parkingRamp` tile (:679-683). On pop it always pushes horizontal neighbours `[f,x-1],[f,x+1]` (:695) but pushes vertical neighbours `[f-1,x],[f+1,x]` only when `u!.kind === "parkingRamp"` (:699). A parking tile never enqueues a vertical step, so two stacked parking spaces with no ramp between them stay disconnected (canon "dead X"). Because a ramp pushes both up and down, parking directly above OR below a ramp column is still reached regardless of direction convention, then chains horizontally along its floor. No legitimately-connected space is missed: `reached` is keyed by unit id (:693) and `visited` per tile (:684,688-690), so multi-tile units are counted exactly once and over-connection can never convert into a miss. Pinned by the "strict parking alignment" test and the new M2 regression test (faqComplete.test.ts:376-389, `functionalParkingSpots() === 1`).

### M3 — blockbuster bookings lost across save/load — RESOLVED
`EconomySystem` exposes `blockbusterIds` getter (:21-23) and `restoreBlockbusters` (:24-26, filtering to finite numbers). `Simulation.serialize` emits `blockbusters: this.economy.blockbusterIds` (:1038); `deserialize` restores via `restoreBlockbusters` behind an `Array.isArray` guard (:1066); `types.ts` declares `SerializedGame.blockbusters?: number[]` (:167, optional for legacy saves). `payMaintenance` clears the set unconditionally at the top each month (:184) before re-rolling, so a burning/removed cinema cannot keep a stale boost and ids don't leak. `filmMult` raised 1.7→2.2 (:76). The clear-each-month + restore-on-load interaction is sound: `deserialize` sets `lastMonth = Math.floor(clock.day/30)` (:1128) matching `onDay`'s month gate, so the restored set is preserved until the next genuine month boundary; money is restored as-is and the booking fee was already deducted pre-save, so no re-charge; restore is RNG-free, so save-scumming reproduces the identical set. Round-trip pinned by faqComplete.test.ts:391.

## Follow-ups (non-blocking, minor)
- **Pre-existing corrupt-save edge:** `deserialize` does not dedupe unit ids and trusts `nextId`. A hand-edited/foreign save with duplicate ids would collapse to one `byId` entry (last-wins) instead of the old `units.find` first-wins. Not a regression — the rooms/structure tile maps were already id-keyed with the same ambiguity, and real `serialize()` output has unique ids, so `byId` is exact there. Track as a save-hardening item, not a merge blocker.

---
**One-line verdict:** SAFE TO MERGE — M1/M2/M3 all confirmed resolved at 2b7afa3 (143/143 tests, tsc + lint clean); highest surviving item is a pre-existing [info] corrupt-save duplicate-id edge (non-regression, follow-up).
