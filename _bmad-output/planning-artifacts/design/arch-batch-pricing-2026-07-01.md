# ARCH — Batch Rent / Rate Pricing (tech plan + test plan)

**Date:** 2026-07-01 · **Feature:** set the price of one priced kind at once.
**Facilitator convergence:** engine core from Cloud Dragonborn (preview/apply share one path, `priceUnit` refactor), scope/mode/undo cuts from Skeptic PM/QA, a11y + preview-honesty from Samus Shepard.

Grounded in verified source: `adjustRent` (`src/engine/Simulation.ts:796`); `rentConfig`/`rentOf`/`ECON.rent` (`src/engine/econConfig.ts`); `Unit.rent?`/`everOccupied` (`src/engine/types.ts:100,105`); editor + dispatch (`src/main.ts:614` `refreshEditor`, `:625` adjuster gate, `:664` `unitEditorHtml`, `:810` `handleEditAction`, `:141` `announce`); modal infra (`src/ui/UI.ts:18` `UICallbacks`, `:330` `showStopsDialog`, `:450` `openModal`, `:467` `confirmModal`, `:186` `btn-stats` wiring).

---

## 1. Design resolutions (no hand-waving)

- **Scope:** single priced kind only, always pre-scoped from the editor. Signature takes `kind: FacilityKind`. No category, no floor range, no occupancy in v1.
- **Set mode:** `absolute` (exact price) or `reset` (clear `u.rent` → default). No step/percent in v1.
- **Overwrite:** `onlyDefaultPriced?: boolean` — when true, only touch units where `rent === undefined`; counted as `skippedCustom` otherwise. Default false.
- **Sold-condo exclusion:** enforced in the engine (same gate as `adjustRent`), counted as `skippedSold`, never dropped from `matched`.
- **Clamp:** every numeric write clamped to `[cfg.min, cfg.max]`; out-of-band targets counted (`clampedLow`/`clampedHigh`) so the preview can warn.
- **Determinism / save-safety:** writes only the existing `Unit.rent` (or clears it). Zero RNG, zero clock reads, no schema change. Preview and apply run the same core → what you preview is what commits.
- **Undo:** cut from v1 (preview + reset confirm-modal are the safety). The result shape is returned by apply so a one-level undo can be added later without an API change.

---

## 2. Engine API (`src/engine/Simulation.ts`)

No schema change. One result shape, a pure preview, a mutating apply, and a shared clamp helper that `adjustRent` is refactored onto (DRY + guards the gate in one place).

```ts
// src/engine/econConfig.ts — export for scope/tests
export const PRICED_KINDS = ["office","condo","hotelSingle","hotelDouble","hotelSuite"] as const;

// src/engine/Simulation.ts
export type BatchTarget = number | "default";
export interface BatchRentOptions { onlyDefaultPriced?: boolean; }
export interface BatchRentResult {
  matched: number;       // priced units of this kind in the tower (incl. sold condos)
  eligible: number;      // matched − skippedSold − skippedCustom
  changed: number;       // rent actually differs after the write
  skippedSold: number;   // condo && everOccupied
  skippedCustom: number; // had custom rent and onlyDefaultPriced=true
  clampedLow: number;    // numeric target below cfg.min
  clampedHigh: number;   // numeric target above cfg.max
}
```

**Shared clamp helper — refactor `adjustRent` onto it.** Extract the eligibility + clamp core so single-nudge and batch share one code path (the sold-condo gate then lives in exactly one place):

```ts
/** Set one unit's price to a clamped target, honoring the condo-sold gate.
 *  Returns the new price, or null if the unit isn't repriceable. */
private priceUnit(u: Unit, target: number): number | null {
  const cfg = rentConfig(u.kind);
  if (!cfg) return null;
  if (u.kind === "condo" && u.everOccupied) return null; // already sold
  u.rent = Math.max(cfg.min, Math.min(cfg.max, target));
  return u.rent;
}

// adjustRent (:796) becomes a thin caller — behavior identical, guarded by a parity test:
adjustRent(id: number, dir: 1 | -1): number | null {
  const u = this.tower.units.find((x) => x.id === id);
  if (!u) return null;
  const cfg = rentConfig(u.kind);
  if (!cfg) return null;
  return this.priceUnit(u, rentOf(u) + dir * cfg.step);
}
```

**Preview (pure) + Apply (mutating) share one core** so they can never disagree:

```ts
previewRentBatch(kind: FacilityKind, target: BatchTarget, opts?: BatchRentOptions): BatchRentResult | null; // no mutation
applyRentBatch(kind: FacilityKind, target: BatchTarget, opts?: BatchRentOptions): BatchRentResult | null;   // writes u.rent
```

Both return `null` when `rentConfig(kind)` is null (non-priced kind). Core algorithm, per matched unit `u` (`tower.units.filter(u => u.kind === kind)`):

1. If `u.kind === "condo" && u.everOccupied` → `skippedSold++`; continue (never touched).
2. If `opts.onlyDefaultPriced && u.rent !== undefined` → `skippedCustom++`; continue.
3. `eligible++`.
4. **Reset:** if `u.rent !== undefined` → would clear to `undefined` (`changed++`). If already `undefined` → no change. (No clamp counting; reset has no numeric target.)
5. **Absolute:** raw target = `target as number`. Count `clampedLow`/`clampedHigh` by comparing raw to `[cfg.min,cfg.max]`. Clamped value = `Math.max(min, Math.min(max, raw))`. If clamped value `!== rentOf(u)` → `changed++`.
6. In `applyRentBatch` only, perform the write (`priceUnit(u, clamped)` for absolute, or `u.rent = undefined` for reset). `previewRentBatch` runs steps 1–5 with **no writes**.

`matched` = all priced units of the kind (incl. sold condos). `previewRentBatch` and `applyRentBatch` share a single private `#computeBatch(kind, target, opts, mutate: boolean)` so counts are identical by construction.

Deterministic: output is a pure function of `kind + target + opts + current prices`. No tick coupling.

---

## 3. DOM wiring (`src/ui/UI.ts` + `src/main.ts`)

**UI.ts** — add `showBatchPricingDialog(ctx, cb)` modeled on `showStopsDialog`/`openModal` (native `<dialog>` → focus trap + Esc + backdrop close already handled). `ctx = { kind, kindLabel, band: {min,max,step,default} }`. Contents:
- Title `Set all ${kindLabel}` (scope fixed, no dropdown).
- Set-mode `radiogroup`: `absolute` (reveals a `<number min=band.min max=band.max step=band.step inputmode="numeric">` flanked by `−`/`+` stepper buttons; band caption below) and `reset`.
- Checkbox `Only units still on the default price` (`onlyDefaultPriced`).
- A `<p class="batch-preview" aria-live="polite">` preview line.
- Footer `Cancel` / `Apply` (Apply `disabled` while preview `changed === 0`).

On any control `change`: call `cb.onBatchPreview(kind, target, opts)`, rewrite the preview line (+ tradeoff caveat when absolute target ≠ default), and toggle Apply's disabled state. On `Apply`: if mode is `reset` and `eligible` is large, route through the existing `confirmModal` first; otherwise call `cb.onBatchApply(...)`, then close.

**UICallbacks** (`src/ui/UI.ts:18`) — extend:
```ts
onBatchPreview(kind: string, target: number | "default", opts: { onlyDefaultPriced: boolean }): BatchRentResult;
onBatchApply(kind: string, target: number | "default", opts: { onlyDefaultPriced: boolean }): BatchRentResult;
```

**main.ts** —
- Implement the callbacks against `sim.previewRentBatch` / `sim.applyRentBatch`.
- On apply: `audio.sfx("click")`, `toast(...)`, `announce()` a summary through `#a11y-live` (matching `:141`), and `refreshEditor()` (the open editor may now show a new price).
- Add the entry: in `unitEditorHtml` (`:664`), for priced + repriceable units only, emit one row in the **stable** HTML (never the volatile fields — keep the `unit:${id}:...` render key at `:629` from thrashing): `<button data-edit="batchKind">Set all ${label}…</button>`. Suppress it when `u.kind === "condo" && u.everOccupied` (mirror the `:625` gate).
- In `handleEditAction` (`:810`) add case `"batchKind"` → build `ctx` from `rentConfig(u.kind)` + kind label and call `ui.showBatchPricingDialog(ctx, ...)`.

---

## 4. Accessibility

- Native `<dialog>` (via `openModal`) → modal focus containment + Esc close for free. Focus starts on the Set-mode radiogroup; returns to the invoking editor row on close.
- All inputs keyboard-operable; number input + steppers (no slider). Logical tab order: mode → value → onlyDefaultPriced → Cancel → Apply.
- Live preview count routed through the in-dialog `aria-live="polite"` line; the apply summary routed through global `#a11y-live` via `announce()`.
- Mobile: reuses `.modal-box` responsive styling (full-width, stacked), no floating-panel anchoring.

---

## 5. Determinism & save-safety

- Only field written: existing optional `Unit.rent` (or cleared to `undefined` on reset). No new persisted fields → `SaveGame` and legacy import untouched.
- No RNG, no clock, no tick coupling. Preview and apply run the same core.
- No undo state to serialize in v1.

---

## 6. Vitest plan (`src/tests/simulation.test.ts`, reuse `builtTower`/`place` scaffold)

1. **Boundary clamp** — offices `absolute` above/below band land exactly on `ECON.rent.office.max`/`.min`; `clampedHigh`/`clampedLow` counts match.
2. **Condo-sold exclusion** — two condos, one `everOccupied=true`; batch `kind:"condo"` reprices the unsold one only; `skippedSold===1`; the sold condo's `rent` is unchanged.
3. **Override policy** — one office at default, one with custom `rent`; `onlyDefaultPriced:true` changes only the default one and `skippedCustom===1`; `false`/omitted changes both.
4. **Reset** — set a custom office price then `target:"default"` → `rent===undefined` and `rentOf` returns the kind default; with `onlyDefaultPriced:true`, reset is a no-op on already-default units (`changed===0`).
5. **Preview === apply** — `previewRentBatch` returns counts identical to a following `applyRentBatch` and leaves all prices untouched (assert no mutation after preview).
6. **`changed` accuracy** — setting the same price units already hold reports `changed===0` (Apply-disabled path); one differing unit reports `changed===1`.
7. **Non-priced kind** — `previewRentBatch`/`applyRentBatch` on e.g. `"shop"` return `null`; no unit mutated.
8. **`adjustRent` parity** — after the `priceUnit` refactor, existing `adjustRent` clamp + sold-condo tests still pass (guards the refactor).
9. **Determinism** — apply → identical tower price state regardless of tick timing (batch before vs after several `sim.tick()` calls yields the same `rent` values).

---

## 7. Build order (merge-when-green)

1. `PRICED_KINDS` export + `priceUnit` refactor of `adjustRent` (+ parity test #8) — ship green first, zero behavior change.
2. `#computeBatch` core + `previewRentBatch`/`applyRentBatch` + tests #1–7, #9.
3. `UICallbacks` extension + `showBatchPricingDialog` + `unitEditorHtml` row + `handleEditAction` case + main.ts callbacks.
4. Manual a11y/mobile pass (keyboard-only apply, `#a11y-live` announcement, narrow-screen modal).
