# PR #66 review — color-blind cue + keyboard play

Scope: color-blind traffic cue + keyboard-play parts of PR #66 (Verticopolis). Reduced-motion reviewed separately (SAFE), excluded here. Reviewed `git diff origin/main...HEAD` against real source (`src/main.ts`, `src/ui/UI.ts`, `src/engine/traffic.ts`, `src/render/excalibur/TowerEngine.ts`).

## Verdict: NOT SAFE TO MERGE — 1 blocker, 2 majors

The keyboard-play feature ships with a global `window` keydown handler (`bindKeys`, src/main.ts:400-442) whose guard (403-405) only bails for INPUT/TEXTAREA/contentEditable and an open `#modal`. It does not exclude focused interactive controls, and it does not check modifier keys. This produces one blocker and two majors — all in the keyboard path, all fixable with small guard changes. The color-blind cue (traffic.ts tier/glyph/label, hysteresis in `updateTraffic`, personGfxRed "!" marker, dead-parking X under-stroke) is correct and save-safe.

## Confirmed blocker/major (deduplicated) with one-line fix

### BLOCKER — Focused palette item / button: one Enter/Space both selects the tool AND runs a build/bulldoze commit
`src/main.ts:401-405,424,441` + `src/ui/UI.ts:113-125` (F18; same root cause as F1/F4/F7/F11/F15)
Palette items are `role=button` divs whose keydown handler calls `preventDefault()+onActivate()` but **not** `stopPropagation()`, so the keystroke bubbles to the window handler, which runs `commitCursor()`. With a cursor already present, Tabbing to the Bulldoze (or any facility) palette item and pressing Enter selects the tool *and* immediately bulldozes/builds at the cursor — a destructive sim write from merely picking a tool. `preventDefault()` at line 441 also cancels native Enter/Space activation of every real top-bar `<button>` (speed, Help, Save, New, audio), so those controls can no longer be keyboard-activated. This defeats the very keyboard-play path the PR adds.
**Fix:** add `e.stopPropagation()` in `makeActivatable`'s Enter/Space handler, AND early-return in the `bindKeys` guard when `document.activeElement` is an interactive control (`BUTTON`, `[role="button"]`, `SELECT`, `A`, `SUMMARY`, `[tabindex]`).

### MAJOR — Global keydown breaks native Enter/Space activation of all top-bar buttons
`src/main.ts:404,424,441` (F1/F4/F7/F11/F15)
Same guard gap as above, isolated for native `<button>`s: focusing any top-bar button and pressing Enter fires `commitCursor()` and `preventDefault()` suppresses the button's own click; Space additionally double-fires (commit on keydown, click on keyup). Regression vs origin/main (which only handled speed keys 0-3).
**Fix:** covered by the guard exclusion above (bail when `activeElement.tagName === "BUTTON"` / `[role=button]`), or scope the play handler to the canvas rather than `window`.

### MAJOR — No modifier guard: Ctrl/Cmd/Alt chords hijacked, Ctrl/Cmd+X bulldozes
`src/main.ts:407,418-425,441` (F12/F19)
The switch matches bare `e.key` with no modifier check. During normal play (body/canvas focus): Ctrl/Cmd+S → `moveCursor` + preventDefault (breaks Save-page), Ctrl/Cmd+A → cursor jump (breaks select-all), Cmd/Ctrl+C → camera pan on every copy, and most seriously Ctrl/Cmd+X → `bulldozeCursor()` destroys the entity under the cursor. Speed-key block (407) shares the flaw.
**Fix:** `if (e.ctrlKey || e.metaKey || e.altKey) return;` before the speed/movement switch (preserves Shift for the ×10 step).

## Minor (non-blocking, for follow-up)

- **Keyboard transport anchor not snapped** (`src/main.ts:216,222`; F2/F8/F13) — anchor uses raw `kbAnchor.tile`, not `snapX(kind, tile)` like the mouse path. All transports are width 3-4 (GRID.width 340); anchoring in the rightmost columns yields `x+width>GRID.width` and `validateTransport` rejects ("Off the edge of the lot.") where the mouse would snap inward. Clean rejection, no corruption. Fix: apply `snapX` when setting the anchor / building / previewing.
- **Keyboard transport preview hardcoded `valid:true`** (`src/main.ts:176`; F3/F17/F21) — mouse path derives validity from `placeTransportDryRun && isUnlocked`. Sighted keyboard users see a green preview over illegal spans; commit still validates, so cosmetic only. Fix: compute `valid` like the mouse path.
- **Pending transport anchor leaks on tool switch** (`src/main.ts:77-81` onSelectTool, 214-234; F10) — switching tools mid-anchor without Escape leaves `kbAnchor` non-null; re-selecting a transport tool resurrects a stale anchor and the next Enter builds a shaft to an unrelated floor. Fix: clear `kbAnchor` in `onSelectTool`.

## Color-blind cue — SAFE
`traffic.ts` (pure `trafficTier`/`TRAFFIC_LABELS`/`trafficGlyph`), `updateTraffic` hysteresis (boundaries [1.0,1.25,1.6]±0.03 via `lastTrafficTier`), the personGfxRed "!" marker, and the dead-parking X dark under-stroke are correct, deterministic, and touch no sim/save writes. No issues.
