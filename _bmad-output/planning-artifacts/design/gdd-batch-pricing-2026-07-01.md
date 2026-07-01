# GDD — Batch Rent / Rate Pricing ("Set all offices…")

**Date:** 2026-07-01 · **Facilitator convergence of:** Samus Shepard (UX), Cloud Dragonborn (Architect), Skeptic PM/QA
**Status:** Build-ready v1 · **Feature:** set the price of a whole priced-kind at once instead of nudging every unit by hand.

Grounded in verified source: `ECON.rent` five bands + `rentConfig`/`rentOf` (`src/engine/econConfig.ts`); `adjustRent` sold-condo gate (`src/engine/Simulation.ts:796`, `if (u.kind === "condo" && u.everOccupied) return null`); editor render + gate (`src/main.ts:614` `refreshEditor`, `:625` adjuster gate, `:664` `unitEditorHtml`, `:810` `handleEditAction`, `:141` `announce` → `#a11y-live`); modal infra (`src/ui/UI.ts:450` `openModal` native `<dialog>` w/ Esc + backdrop, `:467` `confirmModal`, `:330` `showStopsDialog` as the checkbox-dialog analog).

---

## 1. The one job

The pain is narrow and real: *"I have 24 offices and I set each rent one ± click at a time."* v1 does exactly one thing well: **set (or reset) the price of every unit of one priced kind at once**, honoring the same clamp and the same sold-condo lock the per-unit ± adjuster already honors. It writes the same field (`Unit.rent`), so it is inherently save-safe (no schema change) and deterministic (pure player input, never RNG).

Design stance: a management convenience layer over the existing per-unit model, not a spreadsheet macro. The dialog can never do anything the ± adjuster couldn't. Restraint is the feature.

---

## 2. v1 scope (agreed)

### Scope selector — **single priced kind, pre-scoped, no picker**
The dialog is always opened **pre-scoped to the selected unit's kind** from the editor card. Because the selection *is* the scope, v1 has **no kind dropdown, no floor range, no occupancy filter**. The five possible scopes are exactly the `ECON.rent` keys: Offices / Condos / Hotel Singles / Hotel Doubles / Hotel Suites. The dialog title states the scope: **"Set all offices"** (label swaps by kind).

### Set mode — **two modes: "Set to $X" (absolute) and "Reset to default"**
- **Set to $X** — a `<number>` input with `min`/`max`/`step` pulled straight from `rentConfig(kind)`, flanked by −/+ stepper buttons (reuses the adjuster idiom, clamps for free). The band is shown inline, e.g. *"$2,000 – $20,000, steps of $1,000"*.
- **Reset to default** — clears `u.rent` (→ `undefined`), the true "undo my pricing experiment" for the kind.

Absolute is safe here precisely *because* scope is a single kind (one band). No mixed-band scope exists in v1, so no meaningless cross-band value can be entered.

### Overwrite behavior — **apply to all, with a "leave my custom prices" toggle (default OFF)**
Checkbox: **`☐ Only units still on the default price`**. Off by default (batch means batch, and the preview shows exactly what moves). Checked → the write is limited to units where `rent === undefined`, protecting hand-tuned VIP rooms. This single toggle covers the real intent behind an occupancy filter ("don't clobber the ones I carefully set"), which is why occupancy is cut.

### Hard exclusion — **sold condos, enforced in the engine**
A condo that `everOccupied` cannot be repriced (same gate as `adjustRent`). Enforced inside the engine method, never relied upon from the UI, and **counted in the preview** (`skippedSold`), never silently dropped. When the scope is Condos the preview reads e.g. *"18 of 20 condos — 2 sold, skipped."* The "Set all condos…" entry link is suppressed on a sold condo (that unit can't be repriced at all).

---

## 3. Entry point (one, canonical)

In `unitEditorHtml` (`src/main.ts:664`), for any priced, repriceable unit, add **one quiet row directly under the ± adjuster block**:

> `Set all offices…`  *(label: "Set all suites…", "Set all condos…", etc.)*

This is where the pain is felt (mid-nudge), so it is the most discoverable spot, and pre-scoping means the player never picks a kind from a list. The row carries `data-edit="batchKind"`, handled in `handleEditAction` (`:810`), which opens the dialog pre-scoped to `u.kind`.

Placement guard (QA watch-item): the editor render key is `unit:${id}:...` (`refreshEditor:629`). The new row must go in the **stable** HTML, not the volatile fields, so it never thrashes the rebuild key. Suppress the row for sold condos (mirror the `:625` gate).

No new HUD chrome, no sidebar button, no global hotkey in v1. A Full Statistics entry point and a free-scope picker are explicitly deferred (see cut list).

---

## 4. The dialog (native `<dialog>`, via `openModal`)

Built through the existing `UI.openModal` path (inherits backdrop-click + Esc-to-close, same as `showStopsDialog`). Top to bottom:

1. **Title** — "Set all offices" (scope stated, not editable).
2. **Set mode** — a real `radiogroup`: `( ) Set to $[ − 12,000 + ]` · `( ) Reset to default`. The value input + steppers show only for the absolute row; the band caption sits beneath it.
3. **Protect toggle** — `☐ Only units still on the default price`.
4. **Live preview line** — see §5.
5. **Footer** — `[ Cancel ]  [ Apply ]`. Apply is disabled while "0 will change."

Applying: engine write in one call → close dialog → SFX `click` → `toast(...)` → push summary to `#a11y-live` → `refreshEditor()` (open editor may show a new price). No confirm modal on a normal Apply — the preview *is* the confirmation. The one exception: a **Reset to default across many units** gets a `confirmModal` gate (*"Reset prices on N rooms?"*), reusing the existing `confirmModal` path.

---

## 5. Live preview (the honest part)

A one-line summary above the footer, `aria-live="polite"`, recomputed on every control change from a **pure dry-run** (no writes), so what you preview is exactly what commits:

> *"Set **22 of 24 offices** to **$12,000**. 2 custom prices will be overwritten."*

Honesty rules:
- **Count** reflects scope after the protect toggle and after band clamping. If clamping means some can't move, say so: *"20 of 24 will change (4 already at the band limit)."*
- **Skips are visible:** sold condos and (when the toggle is on) custom-priced units are named in the line, not dropped silently.
- **Tradeoff caveat (free, static):** because raising price above default lowers move-in odds (`demandFactor`, `2 − ratio`, `Simulation.ts:790`) and unsold condos carry a monthly property tax (`condoMonthlyTaxRate 0.015`), an *increase above default* appends a muted note: *"Higher-than-default rent slows new move-ins and can push tenants out."* A *decrease* appends: *"Below-default rent fills space faster and keeps tenants happy."* We do **not** fake a demand-adjusted income projection — that would drift and mislead.

---

## 6. Accessibility (keyboard play + `#a11y-live` already shipped)

- Native `<dialog>.showModal()` gives the focus trap + Esc-close for free (already relied on by other dialogs). On open, focus lands on the Set-mode radiogroup; on close, focus returns to the invoking editor row.
- Every control is a real focusable form element: Set-mode is a `radiogroup` (arrow-key cycling); the value input is a `<number>` with −/+ stepper buttons (**no slider** — sliders are hostile to SR and precise keyboard entry); the protect option is a labeled checkbox. Tab order top→bottom ending at Apply.
- The preview line is `aria-live="polite"` inside the dialog, so an SR user hears the count/price/overwrite as they adjust — the same info sighted players see.
- On Apply, the outcome is announced through the global `#a11y-live` via `announce()` (matching `src/main.ts:141`) so it is heard after the dialog closes: *"Set 22 offices to $12,000. 2 custom prices overwritten. 0 skipped."*

---

## 7. Mobile

- Reuses `.modal-box` responsive styling (full-width, stacked) exactly like the Saves/Stops dialogs — it is a centered modal, not an anchored floating panel, so it sidesteps the bottom-palette / `clearPanelAnchors` conflict entirely.
- Number entry uses `inputmode="numeric"` with the −/+ steppers, so pricing never forces the OS keyboard. Interactive rows ≥44px. Sticky footer keeps Apply reachable.

---

## Faithfulness check
- Same action as the original's per-unit rent control, batched over one kind. ✔
- Cannot do anything the ± adjuster can't (band clamp, sold-condo lock). ✔
- No RNG, no new persisted state, save format untouched (`Unit.rent?` already exists). ✔
- Preview tells the truth about skips, clamping, and the demand/tax tradeoff instead of promising a rosy number. ✔
- One entry, one dialog, two modes, one toggle. ✔

---

## Cut list (explicitly OUT of v1 — deferrals handled now)

| Cut | Rationale | Revisit |
|---|---|---|
| **±step and ±% batch modes** | Absolute + reset covers ~95% of "stop editing every room"; % adds rounding/clamp corner cases and preview complexity. The engine's shared preview/apply core (see arch doc) makes adding a mode later trivial. | v1.1 on request |
| **Cross-kind scopes ("all hotel rooms", "all priced")** | The three hotel bands differ, so a single absolute value is meaningless and un-previewable across them. Three well-designed clicks is acceptable. | v2 with relative-only modes |
| **Free-scope picker (kind dropdown in the dialog)** | Pre-scoping from the editor means the selection *is* the scope; a picker is only needed once we add a non-editor entry point. | with the Stats entry |
| **Full Statistics / sidebar entry point** | One canonical entry (the editor, where pricing decisions happen) keeps discovery honest and the surface minimal. | v1.1 |
| **Floor-range selector** | No evidence anyone prices by floor band; large UI cost (range pickers, kbd/mobile), tiny payoff. | on request |
| **Occupied-vs-vacant filter** | Changing rent doesn't evict; the "only default-priced" toggle already covers the real "don't clobber my tuned ones" intent. | on request |
| **Undo / "revert last batch"** | Preview + explicit overwrite count + the reset confirm-modal make the action consensual *before* commit; save/reload is the existing safety net. Engine returns the result shape, so a one-level undo drops in cleanly later. | v1.1 if regret shows |
| **Computed income-delta in preview** | Needs coupling to `collectRent`/`hotelCheckout` and drifts with occupancy; the static tradeoff caveat is honest and cheap. | v1.1 |
| **Multi-select individual rooms** | The opposite of "stop editing per-room." | never (out of concept) |
