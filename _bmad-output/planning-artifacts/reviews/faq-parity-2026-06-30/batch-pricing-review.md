# PR #72 — Batch rent/price editing — Merge-Readiness Review

**Branch:** `claude/verticopolis-batch-pricing` → `main`
**Scope:** `git diff origin/main...origin/claude/verticopolis-batch-pricing` — 6 files, +303/-4
(`Simulation.ts` +92, `econConfig.ts` +3, `main.ts` +24, `styles.css` +10, `UI.ts` +71, `batchPricing.test.ts` +107)
**Reviewer:** deep-review pass, verified against real source on the PR branch.
**Date:** 2026-06-30

---

## Verdict

**SAFE TO MERGE.** Zero blocker/major findings. Four info-level notes, all confirmed
against real source; none block merge.

## Blockers / Majors

None.

---

## Focus-dimension results (all verified clean)

1. **`computeBatch` correctness** — `matched / eligible / changed / skippedSold /
   skippedCustom / clampedLow / clampedHigh` are each exact across every combo:
   all-default set, mixed-custom set, `onlyDefaultPriced` true/false, sold condos
   present, target below min / above max / exactly at edge / equal-to-current, and
   `"default"` reset with mixed default+custom units. Empty-of-kind tower returns a
   zeroed non-null result. `clamped` and `changed` are independent counts from one
   single pass — no double-count, no off-by-one (clamp uses strict `<`/`>`, so
   edge values do not increment).

2. **`preview === apply` is GUARANTEED** — `computeBatch` is the single shared core;
   the `mutate` flag gates *only* the `u.rent` writes (`Simulation.ts:882-887`), the
   counting branches are byte-identical regardless of `mutate`, and preview performs
   no mutation so apply reads identical state.

3. **`priceUnit` refactor** — preserves `adjustRent` behavior exactly: same band clamp
   `Math.max(cfg.min, Math.min(cfg.max, target))`, same condo-sold gate
   (`u.kind === "condo" && u.everOccupied → null`), same step direction
   (`rentOf(u) + dir * cfg.step`). `priceUnit` is `private` with `adjustRent` as its
   sole caller.

4. **Determinism / save-safety** — no RNG, no clock; only `Unit.rent` is written;
   `"default"` sets `u.rent = undefined` so `rentOf` falls back to `cfg.default`.
   Repricing an unsold condo legitimately changes its future sale price and monthly
   tax (intended). No interaction with income/demandFactor beyond the rent value.

5. **UI** — Apply disabled at 0 changes (`applyBtn.disabled = r.changed === 0`,
   `UI.ts:503`), including the correct disabled-on-open state when default == current;
   sold-condo entry suppression via the rent-block guard; native `<dialog>` Esc via
   `oncancel` + backdrop-click close; injected kind label is a static `FACILITIES`
   name (no XSS); `target()` coerces via `Math.round(Number(priceEl.value) || 0)`
   (`UI.ts:489`) so empty/garbage/negative input becomes 0 → band-clamped, never NaN;
   preview text uses the same clamped `priceText` and the same result path as apply —
   it never lies vs. what apply commits.

6. **Tests** — 10 tests, non-vacuous: assert exact count fields and effective
   `rentOf` values, verify preview does not mutate and `preview.toEqual(apply)`, cover
   exact-price / clamp-high / clamp-low / default-clear / `onlyDefaultPriced` /
   sold-condo-skip / null-for-non-priced / empty-tower / adjustRent parity.

---

## Info-level notes (non-blocking)

- **F1 — Engine `priceUnit`/`computeBatch` would write NaN if a NaN target were passed
  (NOT reachable via current UI).** `Simulation.ts:814, 882-887` clamp with
  `Math.max(cfg.min, Math.min(cfg.max, target))` and no `Number.isFinite` guard, so a
  NaN target would propagate to `u.rent = NaN` and (in `computeBatch`) inflate `changed`
  while leaving clamped counts at 0. The shipped dialog never produces NaN
  (`Math.round(Number(...) || 0)`; `"1e999"` → `Infinity` → clamps to `cfg.max`), and
  `priceUnit` is private with a finite-only caller. Only the public `previewRentBatch`/
  `applyRentBatch` are exposed to a hypothetical future non-UI caller, whose contract
  says "save-safe." *Optional hardening:* `if (!Number.isFinite(target)) return null;`
  in `priceUnit` and the numeric branch of `computeBatch`.

- **F3 — Live preview can go stale while the dialog is open (sim not paused).**
  `openModal` does not set `engine.paused`; a condo can sell (`everOccupied` flips)
  mid-tick, and `refresh()` only re-runs on user input. The "Set N of M …" string can
  momentarily lie for condos. NOT an engine/preview-vs-apply defect: Apply recomputes
  fresh via `computeBatch(mutate=true)` and reports that fresh count; offices/hotels are
  unaffected. *Optional:* pause on open, or refresh on a tick.

- **F4 — Apply disabled on open when target == current default (correct, mild UX
  smell).** Dialog opens in "set" mode pre-filled to `band.default`; a tower already all
  on default yields `changed=0` and greyed Apply. Honest and deterministic; not a bug.

- **F5 — Test-coverage gaps at boundaries (existing tests are non-vacuous).** Missing:
  target exactly at band min/max (strict-comparison edge, correct but untested),
  all-custom tower under `onlyDefaultPriced` (expect `eligible=0`), and negative target.
  Empty-of-kind and null-for-non-priced ARE covered. *Optional:* add these three cases.

---

## Recommendation

Merge. If picking up follow-ups, F1 (one-line `Number.isFinite` guard on the two public
batch entry points) is the highest-value hardening, followed by the F5 boundary tests.
