---
game: Verticopolis (browser SimTower clone)
doc: Accessibility Architecture (tech plan)
date: 2026-07-01
resolves: PRD §8 Open Question 6
author: Cloud Dragonborn (Game Architect) — facilitated convergence
status: Agreed for build (v1 scope frozen)
companion: gdd-accessibility-2026-07-01.md
---

# Accessibility Tech Plan — Verticopolis

Grounding: engine motion is canvas-rendered off `TowerEngine.d.anim`; DOM owns chrome
(diegesis, PR #45); sim outputs (`congestion()`, `Crowd.stress`, `Person.wait`,
`Walker.impatient`) are already deterministic and headless. This plan **reads** those and
never mutates them. All three sub-features are IN for v1 — each is low-risk, faithful,
restrained, and touches no simulation state.

## 0. Cross-cutting: the preferences seam (do this first)

Today the only motion switch is a CSS `@media (prefers-reduced-motion: reduce)` block in
`styles.css` that can only reach DOM/CSS animation. Canvas ambient motion is ungated — that is
the core reduced-motion bug.

Introduce one source of truth:

- **New file `src/storage/Prefs.ts`** — `loadPrefs()` / `savePrefs()` over a dedicated
  localStorage key **`vc.prefs`**, shape `{ reducedMotion?: boolean; colorblindCue?: boolean }`.
  Deliberately kept out of `SaveGame.ts`: prefs are per-device, must not travel with a shared
  save, must not perturb save schema/determinism. Tolerate corrupt JSON (fall back to defaults).
- **Effective reduced-motion** =
  `matchMedia("(prefers-reduced-motion: reduce)").matches || prefs.reducedMotion`. Computed in
  `main.ts` and pushed to two consumers: (1) toggle `<html class="reduce-motion">` so CSS
  applies even when the OS pref is off; (2) `engine.setReducedMotion(bool)` for the canvas.
- Re-evaluate on the `matchMedia` `change` event and on the in-game toggle.

---

## A1 — Color-blind-safe congestion / stress cue

Stress reads *only* as `#C24A3A`: fed-up walkers, routed crowd, and the dead-parking red X.
Fix with redundant shape/text encoding, default-on (accessibility defaults shouldn't hide
behind a mode).

1. **Traffic HUD chip (primary, DOM chrome).** New `#traffic` element in `index.html`, updated
   in `main.ts` `update()` from the same congestion value the engine reads. Extract a **pure
   mapping** — the frozen 4-tier ladder from the UX spec, so it survives grayscale:

   ```ts
   export type TrafficTier = 0 | 1 | 2 | 3;
   // thresholds mirror d.stress = clamp(congestion-1) and the walker-red gate.
   // Tier >= 2 is exactly when walkers turn red (stress > 0.25 ⇒ congestion > 1.25).
   export function trafficTier(c: number): TrafficTier {
     if (c > 1.6)  return 3; // Gridlock
     if (c > 1.25) return 2; // Backed up
     if (c >= 1.0) return 1; // Busy
     return 0;               // Smooth
   }
   export const TRAFFIC_LABELS = ["Smooth", "Busy", "Backed up", "Gridlock"] as const;
   ```

   Render **word + a 4-step bar glyph** (shape-coded fill level, not color-coded), styled in
   `styles.css`. Apply ±0.03 hysteresis at boundaries in the `update()` caller (last-tier
   memory) so it doesn't flicker; the pure fn stays boundary-clean for tests. Carries
   `aria-live="polite"` + `aria-label` "Traffic: <label>".

2. **In-world fed-up marker (engine).** In `pixelSprites.ts`, add a `fedUpMark(ctx,x,y)` helper
   that stamps a 2–3px "!" / spark cluster in `ink` with a `white` halo above the head. Bake a
   `personFedUpGfx` canvas variant in `TowerEngine.bakeSharedGraphics()` (normal-shirt figure +
   marker) and swap to it at the two existing decision points (`positionPerson` `p.wait > 25`;
   `updateMotion` `w.impatient && stress > 0.25`). Keep the red tint too — color **and** shape.

3. **Dead-parking X halo.** At the red-X draw, add a 1px dark (`ink`) under-stroke so shape
   carries meaning independent of hue.

**Determinism/save-safety:** reads only `congestion()`, `p.wait`, `w.impatient` — all existing
deterministic outputs. No RNG, no sim writes, no save-schema change; label fn is pure/headless.
A `colorblindCue` toggle, if exposed, only gates the marker; default on.

**Deferred to phase-2 (out of v1):** the congested-band shaft hatch overlay + tier badge from
the UX spec, gated behind a "show congestion" view toggle. Not built now.

---

## A2 — Full keyboard play

Have today: palette select via `makeActivatable` and speed `0–3`. Missing: cursor placement,
build/commit, drag-sized rooms & transports, bulldoze, pan, zoom, inspect/cycle.

**Strategy — feed the existing controller hooks, don't fork rendering or input.** All pointer
play routes through `main.ts` hooks into build/bulldoze APIs and camera through
`engine.pan/zoomAt/center`. Keyboard becomes a *second caller* of the **same** code. Excalibur's
pointer system is untouched, so mouse/touch play is fully preserved.

**Step 1 — extract shared commit methods (refactor, no behavior change).** Pull tool bodies out
of the pointer handlers into private methods both callers use:
- `buildAt(tile, floor)` ← `tryBuild`/`paintBrush` in `onActionDown`/`onTap`.
- `bulldozeAt(picked)` ← `bulldozePicked`.
- `beginTransport / updateTransport / finishTransport` ← the `transportStart` + preview +
  `buildTransport` flow.

**Step 2 — logical keyboard build cursor.** Add `cursor: {tile,floor} | null` and
`kbAnchor: {x,floor} | null` (keyboard twin of `transportStart`). The cursor renders through the
existing preview pipeline — set `engine.preview` / `engine.transportPreview` / `engine.selectedId`
exactly as hover/drag do, so there is no new sprite path.

**Step 3 — small testable engine helpers.**
- `zoomBy(factor)` — wraps `zoomAt(factor, viewWidth/2, viewHeight/2)`.
- `ensureVisible(tile, floor)` — if the cursor's `worldToScreen` falls outside the viewport,
  `pan()` just enough to bring it in (edge-scroll; reuses existing clamp). Snaps when
  reduced-motion is on.

**Step 4 — bindings (expanded `bindKeys`, documented in Help).** Guard every handler: ignore
when focus is in `input`/`textarea`/`[contenteditable]` or a modal is open (so name-typing and
dialogs aren't hijacked); palette/buttons keep their Enter/Space. Key map per the UX spec
(arrows/WASD move, Shift=×10 / fast pan, `-`/`=` zoom, `C`/`Home` center, Enter/Space commit or
select, Enter twice for span with `kbAnchor`, Esc cascade, Delete/Backspace/`X` bulldoze,
`[`/`]` cycle → `selectPicked`). `pickAtCursor` = `engine.pickEntityAt(worldPos(cursor))`,
reusing the existing collider hit-test.

**Shaft extend:** add "Extend up"/"Extend down" buttons to the elevator editor card
(`UI.showEditor` `[data-edit]`, already Enter/Space-activatable) calling the same
`onExtendTo(end, targetFloor±1)` as the drag. No keyboard rebuild of in-world drag arrows.

**Dialogs:** focus-trap all modals; emergency modal (sim-pausing canon) refuses `Esc`.

**aria-live announcer (minimal):** one visually-hidden `aria-live="polite"` region; cursor
readout on move + route existing `good`/`bad` toasts + Gridlock crossing into it.

**Determinism/save-safety:** keyboard is purely an input path into the same deterministic
`buildAt/bulldozeAt/finishTransport` APIs — same seed ⇒ same tower whether built by mouse or
keys. `cursor`/`kbAnchor` are transient UI, never serialized.

**DOM a11y polish:** `:focus-visible` outlines for palette/buttons; confirm `#speed`,
save/load/help buttons have `aria-label`s.

---

## A3 — Global reduced-motion signal

Consume the §0 seam. `TowerEngine` gets `private reducedMotion = false` + `setReducedMotion(b)`.
Gate **decorative** motion; keep **functional/intermittent** motion.

- **Freeze (decorative):**
  - Ambient pacing walkers (`updateMotion`) — compute ping-pong `t` with the `anim` term
    dropped so figures stand still but stay visible (visibility is population-driven). Extract
    `walkerT(w, anim, reduced)` as a pure fn for testability.
  - Street train — pin `offset = 0` at platform.
  - Clouds (`drawClouds`) — render one static frame (`t = 0`).
  - Rain (`drawRain`) — keep the overcast tint, skip the falling-streak loop so weather stays legible.
- **Keep (functional):** elevator cars (real dispatch state), routed crowd (sim positions),
  sky color-by-hour crossfade (slow, hourly — not a trigger), fire/construction redraws.

Simplest fallback if ever needed: freeze `animClock` advance at `tick` when `reducedMotion` —
stills walkers/train/clouds/rain at once (all read `d.anim`) while cars/crowd keep working. The
surgical route above is preferred because it lets weather stay readable.

**CSS:** mirror the `@media (prefers-reduced-motion: reduce)` block with a parallel
`html.reduce-motion *, html.reduce-motion *::before, html.reduce-motion *::after { … }` selector
so the in-game toggle works without the OS setting.

**Toggle UI:** add "Reduce motion" (and optionally "High-contrast congestion cue") to the
Help/settings modal (`UI.showHelp`, `btn-help`); persist via `Prefs.ts`. DOM chrome per diegesis.

**Determinism/save-safety:** motion is cosmetic; `d.anim` never feeds the sim. Freezing it
changes nothing in `sim.clock`/economy/crowd. Not saved.

---

## Files touched

- **`src/storage/Prefs.ts`** *(new)* — load/save `vc.prefs`; separate from `SaveGame.ts`.
- **`src/render/excalibur/TowerEngine.ts`** — `reducedMotion` field + `setReducedMotion()`;
  gate walkers/train/clouds/rain; `personFedUpGfx` + swap; dead-parking X halo; `zoomBy()`,
  `ensureVisible()`; `walkerT()` extract.
- **`src/render/pixelSprites.ts`** — `fedUpMark()` overhead marker.
- **`src/main.ts`** — expand `bindKeys` (cursor/pan/zoom/commit/bulldoze/cycle/esc/center +
  focus guard); extract `buildAt/bulldozeAt/beginTransport/updateTransport/finishTransport`;
  reduced-motion wiring (matchMedia + toggle → `<html>` class + engine); `#traffic` update +
  `trafficTier()` in `update()`.
- **`src/ui/UI.ts`** — build/patch `#traffic` chip; Extend up/down editor buttons; reduced-motion
  (+ colorblind) toggles in Help persisted via Prefs; keyboard-shortcut help; `:focus-visible`;
  aria-live announcer region + toast routing.
- **`src/index.html`** — `#traffic` chip element; keyboard shortcuts in Help/`#hint`.
- **`src/styles.css`** — `html.reduce-motion` mirror block; `#traffic` chip states (shape/icon,
  not color-only); `.sr-only`; `:focus-visible` outlines.

## Test plan

**Vitest (headless, deterministic):**
- `trafficTier()` boundaries: 0.9→0, 1.0→1, 1.25→1, 1.26→2, 1.6→2, 1.61→3.
- `Prefs` round-trip; default when unset; tolerate corrupt JSON.
- `walkerT(w, anim, reduced)`: `reduced=true` ⇒ constant across advancing `anim`; `false` ⇒
  ping-pong varies. Proves the reduced-motion gate without a canvas.
- Keyboard/pointer parity: seeded sim, assert `buildAt()`/`finishTransport()` produce identical
  tower state to the pointer path; assert `moveCursor` clamps to `GRID` bounds.

**Playwright e2e (`e2e/`, `window.game` hook at `main.ts`):**
- Keyboard-only build: focus canvas → Arrows → Enter places a lobby/floor; assert via
  `window.game.sim`.
- Keyboard pan/zoom changes camera.
- `page.emulateMedia({ reducedMotion: 'reduce' })`: assert `<html>.reduce-motion` set and two
  sampled frames of a sky region are pixel-identical (ambient frozen).
- Congestion cue: drive a congested seeded scenario; assert `#traffic` = "Gridlock" and the
  fed-up marker present (screenshot diff).
- axe-core scan of DOM chrome (roles/labels/contrast) + Tab focus-ring check.
- Regenerate screenshots via `npm run screenshots:docker` (host Chromium is broken).

## Sequencing (3 reviewable PRs, adversarial review before each merge)

1. **Reduced-motion** — Prefs seam + engine gating + CSS mirror + toggle. *(establishes the
   Prefs seam that 2 & 3 reuse.)*
2. **Colorblind cue** — Traffic HUD chip + fed-up marker + X halo.
3. **Keyboard play** — shared-commit refactor + cursor + bindings + focus-visible + announcer.

Each independently mergeable.
