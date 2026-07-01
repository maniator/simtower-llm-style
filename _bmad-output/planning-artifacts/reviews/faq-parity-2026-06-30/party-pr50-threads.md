# Party Mode Roundtable — PR #50 Open Review Threads

> _Historical record. The project was later renamed to **Verticopolis**; "Tower Tycoon" below is the name that was in use at the time of this review._

Date: 2026-06-30
Feature: Tower Tycoon milestones (RECOGNITION-ONLY by design — no cash payout)
Facilitator convergence over 9 open threads, each verified against current source.

## Ground truth confirmed by reading source

- `src/engine/milestones.ts:17` header: "milestones are goals/acknowledgement, NOT cash."
- `checkMilestones` / milestone path only emits/announces — there is **no** money side-effect anywhere.
- Every "re-pay" / "paid once" / "pays its reward" phrase is therefore factually wrong and reintroduces the exact reward framing the design forbids.

## Decisions

| Thread | Location (verified) | Consensus | Action |
|--------|---------------------|-----------|--------|
| T1 | `src/tests/milestones.test.ts:32` | fix | Rename `it("fires once, pays its reward once, and shows in progress")` → `it("fires once, is announced once, and shows in progress")`. Test asserts only `done()` + non-growing `achieved` set (lines 44-51); no money assertion. |
| T2 | `src/tests/milestones.test.ts:54` | fix | `"(no re-announce, no re-pay)"` → `"(no re-announce)"`. No payout exists to re-pay. |
| T3 | `src/tests/milestones.test.ts:69` | fix | Comment `already achieved → must not re-announce or re-pay` → `already achieved → must not re-announce`. |
| T4 | `src/engine/types.ts:168-169` (`milestones?` field at 170) | fix | JSDoc `so reload doesn't re-announce / or re-pay them.` → `so reload doesn't re-announce them.` |
| T5 | `src/engine/Simulation.ts:135` | fix | Field comment `(announced + paid once)` → `(announced once)`. **Highest priority** — this is on the authoritative state field `achievedMilestones`. Bot said 136; actual line is 135. |
| T6 | `src/engine/Simulation.ts:1091` | fix | Deserialize comment `so reload doesn't re-announce or re-pay them.` → `so reload doesn't re-announce them.` Anchor is 1091, not 1094 (loop line). |
| T7 | `src/engine/milestones.ts:17` | fix | `acknowledgement` → `acknowledgment` (US spelling). |
| T8 | `src/engine/milestones.ts:50` | fix | Delete whitespace-only line 50 (inside well-served milestone object). Bot said 51; grep confirms 50 — line 51 is `test:`. |
| T9 | `src/engine/milestones.ts:57` | fix | Delete whitespace-only line 57 (inside full-house milestone object). Bot said 58; grep confirms 57 — line 58 is `test:`. |

## Dissent recorded

- **T7 (spelling):** One panelist voted *reject* as cosmetic churn, noting the codebase mixes dialects — British `finalised` at `Simulation.ts:129` (verified present) alongside American `trivializes` at `milestones.ts:18`, and no linter enforces a standard. Majority (3/4) carried *fix*: the project skews American and `acknowledgement` sits one line above the design-critical header, so aligning it is low-cost. Filed as a trivial, low-priority fix — fold in with the substantive edits, not worth a standalone round.

## Notes on bot anchor accuracy

The bot's substance was correct on all 9 threads. Line anchors were off-by-one/few on T5 (135 not 136), T6 (1091 not 1094), T8 (50 not 51), and T9 (57 not 58). Corrected above via direct `sed`/`grep -nP ' +$'` verification.

## Net

9/9 fix. T1 and T5 are the design-critical ones (test name lies about a payout; authoritative state-field comment claims "paid once"). The rest are wording/consistency/whitespace cleanups that keep the recognition-only contract honest across serialize / deserialize / type-doc / test surfaces.
