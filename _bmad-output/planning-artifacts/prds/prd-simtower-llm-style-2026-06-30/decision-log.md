# Decision Log — Tower Tycoon PRD

Chronological record of decisions, scope calls, and version transitions for the
PRD at `prd.md`. Newest entries at the bottom.

---

## 2026-06-30 — Session 1 (Create intent, Express mode)

- **State:** Draft v0.1 created.
- **Intent:** Create. Brownfield — a working clone (`Tower Tycoon`) already
  exists; the PRD is being written *after* implementation to formalize the
  requirements against the canonical source.
- **Source of truth:** SimTower (1994, Maxis / OPeNBooK). Every requirement
  traces to an original-game mechanic. Grounding inputs: `PARITY.md`,
  `README.md`, `src/engine/econConfig.ts`, `src/engine/facilities.ts`.
- **Mode:** Express — the source of truth and existing implementation are
  unambiguous, so the full PRD was drafted in one pass rather than facilitated
  section-by-section. Inferences tagged `[ASSUMPTION]` inline and indexed.
- **Decision — clone-faithful, not a redesign.** The PRD specifies *parity with
  the 1994 original*, not a reimagining. New ideas are out of scope; the goal is
  a faithful, browser-native homage. Recorded as the central scope guardrail.
- **Decision — document the deliberate divergences as first-class requirements,
  not bugs.** Cathedral → Wedding Hall (religion-agnostic); TOWER population
  target 12,000 vs. the original 15,000 (smaller-scale population model);
  individually-routed crowd with an aggregate congestion backstop. These are
  intentional and specified in §4 and §5.
- **Decision — platform scope is desktop-first browser with a modernized mobile
  layout.** Matches README/PARITY claims. No native app.
- **Decision — numbers come from the live engine config**, treated as the tuned
  realization of the original's balance (`ECON`, `FACILITIES`, `STAR_THRESHOLDS`,
  `GRID`, `TRANSPORT_CAPACITY`, `MAX_CARS`). Where the original's exact value is
  known to differ, both are stated.
- **Open items carried forward:** see §8 Open Questions in `prd.md`.

## 2026-06-30 — Finalize pass

- **Input reconciliation (subagent):** every concrete number in `prd.md`
  cross-checked against `econConfig.ts`, `facilities.ts`, `PARITY.md`,
  `README.md`. **All numbers correct.** No source mechanic omitted.
- **Discipline validation (subagent against `prd-validation-checklist.md`):**
  findings applied —
  1. Added **§4.10 Deliberate Divergences** (FR-66…69) and repointed broken
     "see §5" cross-refs (§0, FR-34, FR-46) to it / Addendum §A.
  2. Reworded implementation-leaking FRs to capabilities, moving algorithm/
     library/binding names (SCAN, BFS, WebAudio, localStorage, build command) to
     Addendum §B: FR-26, FR-30, FR-34, FR-40, FR-54, FR-58, FR-61, FR-63.
  3. Glossary: added **Two-layer grid** and **Aggregate congestion model**.
  4. Fixed FR-6 ground-lobby vs sky-lobby contradiction.
  5. Removed contradictory `[v2]` tag on the permanent "no original assets"
     non-goal (§5).
  6. Operationalized the "faithful feel" success metric into a veteran playtest
     rubric (§7); indexed its new `[ASSUMPTION]`.
- **Reconciler flags applied:** basement count corrected to **10 levels
  (B1…B10)** in §3, FR-1 (the "9 below" wording inherited from PARITY.md was
  off-by-one); FR-17 corrected so **Parking** is no longer claimed to charge
  monthly maintenance (no key in `serviceMaintenanceMonthly`).
- **Numbering verified:** FR-1…FR-69 contiguous and unique; UJ-1…UJ-7.
- **State:** Draft v0.1 → ready for review. Downstream next step per BMAD:
  `gds-check-implementation-readiness` (this is brownfield — the build already
  exists, so readiness is largely a parity/coverage confirmation).
- **Note (resolved):** test counts were stale — README said "33", PARITY.md
  said "82"; the suite actually runs **84 passing tests** (`npx vitest run`).
  Corrected README.md, PARITY.md, and the PRD/addendum to 84.
