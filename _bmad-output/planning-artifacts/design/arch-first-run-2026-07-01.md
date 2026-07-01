---
title: "Technical Design — First-Run Experience"
author: Cloud Dragonborn (Game Architect — BMAD gds agent)
date: 2026-07-01
status: Design — awaiting owner sign-off
---

# First-Run Experience — Technical Plan (Cloud Dragonborn, Game Architect)

Grounded in shipped source. Key anchors verified: boot in `src/main.ts` (`boot()` ~L1017 → `new GameApp()`; sim load at **L64** `SaveGame.load() ?? Simulation.newGame(...)`); update throttle at **L301** (`now - lastUiUpdate > 160`); `mobileMq` cached at **L54**; `adoptSim` L931, `newGame` L984. `SaveGame` exposes `load()`, `hasSave()` (SaveGame.ts:63), `listSlots()`. Modal is the shared `<dialog id="modal">` via `UI.openModal/closeModal` (UI.ts:448). `#hint` exists as static text (index.html:60). `Simulation.newGame` (Simulation.ts:1256) seeds a 40-tile floor-1 lobby.

## 1. File map (concrete names)

- **New `src/ui/Onboarding.ts`** — `OnboardingController` class. Owns splash + checklist + `#hint` driving + pulse. **Pure DOM chrome; imports nothing from the engine except the `Simulation` *type*** (read-only predicate access). This preserves the diegesis split — the engine is never touched.
- **`src/ui/UI.ts`** — one-line addition to `showHelp()`: a `Replay Getting Started` button (`data-act="replay-onboard"`), wired to a new `UICallbacks.onReplayOnboarding` callback.
- **`src/main.ts`** — instantiate the controller in the `GameApp` constructor after `this.ui`; add ~3 lines in `update()`'s throttle block; add `onReplayOnboarding` to the callbacks object; arm onboarding inside `newGame()`.
- **`src/styles.css`** — `#splash` (+`.splash--mobile`), `.onboard-*` checklist, `.tt-pulse` keyframe, device-aware `#hint`.
- **`src/index.html`** — no structural change required (splash + checklist are created by the controller and appended to `document.body`/`#app`). Optionally pre-declare empty `<div id="splash" hidden>` for CSP/no-FOUC; not required.
- **`vite.config.ts`** — add a build-time `define` for the version (see Risks).

No new runtime deps.

## 2. First-run detection + persistence

- **Flag:** `localStorage["tt.onboarded"]` = `"1"`. Read/write helpers live in `Onboarding.ts` (`isOnboarded()`, `markOnboarded()`, `clearOnboarded()`), *not* in `SaveGame` — the flag must never enter the serialized game object (save-safety).
- **Continue vs New:** at splash build time call `SaveGame.hasSave()` (cheap, no deserialize) for the CTA decision; the actual tower is already in `app.sim` from the L64 load. If `hasSave()` → **Continue** primary, **New Tower** secondary. Else → **New Tower** primary, **Continue** hidden.
- **Returning-player guard (belt + suspenders):** onboarding is armed **only** when the player presses **New Tower** on a browser where `isOnboarded()` is false. Additionally, if `SaveGame.hasSave()` is true at boot, never auto-arm even if the flag is missing — an existing tower means they've played. So the arm predicate is: `pressedNewTower && !isOnboarded()`. Continue never arms onboarding.

## 3. Splash — mount & lifecycle

- **Mount:** a dedicated full-screen DOM overlay `#splash` created by `OnboardingController.showSplash()` and appended to `document.body` at high `z-index`, covering `#app`. **Not** `UI.openModal` — the shared `#modal` stays reserved for emergency choices / stats, and splash is chrome (New/Continue/Help + clean-room attribution).
- **Engine, non-blocking:** the constructor still runs `void this.engine.start()` so the tower renders behind the splash. To keep the loaded tower deterministic (don't advance its clock before the player commits), the controller calls back into GameApp to **force pause while the splash is up**: set `this.speed = 0` / `this.engine.paused = true` on show, and restore the default (speed 1, matching the `data-speed="1" active` button) on dismiss. This is a UI-only speed change; it writes nothing to the sim.
- **Layout by device:** pick `splash--mobile` vs desktop class from `this.mq.matches` (same `"(max-width: 860px)"` query as `main.ts:54`; the controller either receives `app.mobileMq` or constructs its own with the identical string constant — recommend a shared exported `MOBILE_MQ` string to avoid drift).
- **Skyline art:** code-drawn only — CSS gradients + a generated grid of "lit window" `<div>`s (or a tiny procedural `<canvas>`). **Deterministic:** seed any window-lighting pattern from a fixed constant (or make it pure CSS) so it is stable and screenshot-diffable; no `Math.random()`.
- **Version:** rendered from a build-time constant (`__APP_VERSION__`), small, bottom corner.
- **Dismissal:** any CTA dismisses. `Esc`/backdrop → resolve to the safe default (**Continue** if a save exists; otherwise **do nothing** — New Tower requires an explicit press so intent is never wiped). CTAs: Continue → `dismissSplash()` only; New Tower → `dismissSplash()` + `app.newGame()` (which arms onboarding); How to Play → `app.ui.showHelp()` (splash stays underneath, since Help uses `#modal`).
- **Teardown:** `dismissSplash()` removes the `#splash` node from the DOM entirely (not just `hidden`) and detaches its listeners, so there is zero residual cost during play.

## 4. Onboarding helper mechanism (checklist + contextual hints)

**Structure.** `OnboardingController` holds `active: boolean`, `currentStep: number`, `mq`, and a static `STEPS` array. Each step:

```
interface OnboardStep {
  id: string;
  title: string; sub: string;
  hintDesktop: string; hintMobile: string;
  pulseSelector: string;                 // real DOM element to highlight
  done(sim: Simulation): boolean;        // pure, read-only
}
```

**Advance loop (non-blocking, save-safe).** In `GameApp.update()`, inside the existing `if (now - this.lastUiUpdate > 160)` block, add:

```
this.onboarding.tick(this.sim);   // no-op unless active
```

`tick()`:
1. If `!active` return.
2. If `STEPS[currentStep].done(sim)` → advance `currentStep`, re-render the checklist row (strike-through/checkmark), swap `#hint` to the next step's device line, move the `.tt-pulse` class to the next `pulseSelector`. One `promote`-style chime at most (delegate to `app.audio.sfx("promote")` via a callback, gated so it fires once per advance).
3. If all steps done → render the one-line send-off, `markOnboarded()`, start a ~6s auto-dismiss timer (also dismiss on tap), stop pulsing, restore `#hint` to the device-aware default line.

Because `done()` reads only current `sim` truth, the checklist **self-heals across reload and resume-at-step**: on arm it scans from step 0 and sets `currentStep` to the first step whose `done()` is false — so replaying on an existing tower starts at the right place, and organic play silently completes steps.

**Step predicates & pulse anchors (concrete, verified against `Tower`/`Unit`):**

| # | `done(sim)` predicate | `pulseSelector` |
|---|---|---|
| 1 Add a floor | `sim.tower.units.some(u => u.kind === "floor" && u.floor >= 2)` | `.pal-item[data-kind="floor"]` |
| 2 Lease an office | `sim.tower.units.some(u => u.kind === "office")` | `.pal-item[data-kind="office"]` |
| 3 Connect it | `sim.tower.units.some(u => u.kind === "office" && sim.tower.isFloorServed(u.floor))` | `.pal-item[data-kind="stairs"], .pal-item[data-kind="elevatorStandard"]` |
| 4 Press Play & wait | `sim.tower.units.some(u => u.kind === "office" && u.state === "occupied")` | `#speed button[data-speed="1"]` |

(Step 3 uses `Tower.isFloorServed` — "connected to the lobby chain" — the right teaching bar; `Simulation.floorReachable` is the stricter ≤2-rides check and would gate the player on sky-lobby nuance too early.)

**Anchoring — important correction to the designer spec:** there is **no `.pal-group` wrapper element** in the DOM. `buildPalette()` (UI.ts:82) emits flat `.pal-group-title` divs followed by sibling `.pal-item[data-kind=…]` / `.pal-item[data-tool=…]` nodes inside `#palette-scroll`. So "pulse the palette group" must instead pulse the **specific `.pal-item`(s)** via the selectors above (all real, stable attributes). This is purely cosmetic (a CSS class toggle) — no engine coupling.

**Mobile vs desktop handling via `matchMedia`:**
- The **checklist and `#hint` render on both** platforms (both need teaching). What differs:
  - **Hint copy** is chosen per-tick by `this.mq.matches` → `step.hintMobile` vs `step.hintDesktop`. This is load-bearing: on desktop a build tool active means left-drag *builds* (so we must point panning at Inspect/Space/right-drag, per `classifyDown` L122); on mobile one-finger *pans* and tap builds, except transport sizes on drag (`onActionDown`/`onTap` L131–162).
  - **No world-anchored coachmark bubbles.** We deliberately **no-op the pointer-arrow/coachmark layer on mobile** (and keep it lightweight on desktop) — mirroring `positionPanels()` (L345), which already abandons world-anchoring when `mobileMq.matches` because floating chrome fights the bottom palette strip. We rely on the docked checklist + `#hint` + `.tt-pulse` on both, which sidesteps that whole positioning problem. The checklist docks bottom-left (desktop) / above the palette strip (mobile) by CSS class only.
- Live device flips (rotate/resize) are handled by an `mq.addEventListener("change", …)` that re-renders the current hint line; cheap.

## 5. Boot integration (no engine blocking)

In `GameApp` constructor, after `this.ui = new UI({...})` and after `this.wireEngine(); void this.engine.start();`:

```
this.onboarding = new OnboardingController({
  mq: this.mobileMq,
  showHelp: () => this.ui.showHelp(),
  pauseForSplash: (p) => { this.speed = p ? 0 : 1; this.engine.paused = p; },
  chime: () => this.audio.sfx("promote"),
});
this.onboarding.showSplash({
  hasSave: SaveGame.hasSave(),
  onContinue: () => {/* splash-only teardown; sim already loaded at L64 */},
  onNewTower: () => this.newGame(),   // newGame() arms onboarding (below)
});
```

`newGame()` (L984) gains one line after `adoptSim(...)`:
```
if (!OnboardingController.isOnboarded()) this.onboarding.arm(this.sim);
```
`arm(sim)` sets `active=true`, computes the resume step from `sim`, mounts the checklist, seeds `#hint`, starts pulsing. Nothing blocks the render loop — everything is event/throttle-driven.

## 6. Help re-open

Append to `showHelp()`'s modal HTML one button: `<button data-act="replay-onboard">Replay Getting Started</button>`, wired to `this.cb.onReplayOnboarding`. In `main.ts`, the callback: `onReplayOnboarding: () => { OnboardingController.clearOnboarded(); this.ui.closeModal(); this.onboarding.arm(this.sim); }`. `clearOnboarded()` removes `tt.onboarded` so `arm()` proceeds; it re-arms on the **current** tower and auto-resumes at the first uncompleted step (see §4). Discoverable, no HUD clutter.

## 7. Teardown & determinism/save-safety

- **Teardown:** splash node fully removed on dismiss; checklist node removed on finish/skip; `.tt-pulse` cleared; `#hint` restored to a device-aware default line; the `mq` change listener removed on finish. `tick()` early-returns when `!active`, so the steady-state cost is one boolean check per ~160ms.
- **Determinism:** onboarding reads `sim` but **writes nothing** to it — no new fields in `SerializedGame`, no RNG use, skyline seeded from a constant. Existing saves and demo towers deserialize byte-identically. Screenshot/replay determinism is preserved.
- **Save-safety:** the only persisted state is the single `tt.onboarded` string in localStorage, orthogonal to `simtower-clone-save`. Reload mid-onboarding re-derives `currentStep` from `sim`, so there is no desync and no partial-state corruption.
- **No nagging:** checklist never re-appears on its own (gated on the flag + explicit arm); one hint line at a time via the single `#hint`; at most one chime per advance.

## 8. Test plan

**Unit-testable (pure logic — add `src/tests/onboarding.test.ts`):**
- Flag logic: `isOnboarded/markOnboarded/clearOnboarded` against a mocked/`jsdom` localStorage.
- Arm predicate matrix: `{hasSave, flag}` → armed? (armed only when `pressedNewTower && !onboarded`; Continue never arms; hasSave never auto-arms).
- Step `done(sim)` predicates: construct `Simulation.newGame(seed)`, place a floor≥2 / office / transport, drive to `occupied`, assert each step flips false→true at the right moment and never regresses.
- Resume logic: given a sim already past steps 1–2, `arm()` sets `currentStep` to step 3.
- Hint selection: `mq.matches` true/false → correct `hintMobile`/`hintDesktop` string chosen.
- Splash CTA visibility: `hasSave` → Continue shown/primary vs hidden.

**Manual / screenshot (Docker harness `npm run screenshots:docker`, per project memory):**
- Splash desktop vs mobile (≤860px) layout, code-drawn skyline, attribution + version.
- Pulse lands on the correct `.pal-item`/speed button at each step.
- `#hint` shows the right device gesture line (desktop Space/right-drag panning note; mobile transport-drag exception).
- Full four-step run to send-off + auto-dismiss; Skip path; Help → Replay path; returning-player boot (Continue primary, no onboarding).
- Engine visibly paused behind splash, resumes on dismiss.

## 9. Risks / flags

1. **`.pal-group` does not exist** — spec's "pulse the group" isn't buildable as written; use per-`.pal-item` selectors above (corrected). Low effort, but the spec must be reconciled or a future palette refactor could break selectors — keep the `data-kind` contract stable.
2. **Version at runtime** — `package.json` isn't importable in the browser bundle. Add `define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) }` to `vite.config.ts` (or a generated `src/version.ts`). Small but must be wired or the splash shows `undefined`.
3. **`mobileMq` duplication** — controller must use the exact `"(max-width: 860px)"` string; extract a shared constant to prevent drift from `main.ts:54`.
4. **Speed restore on Continue** — forcing pause during splash must restore to speed 1 and re-sync the `#speed` active button; if the player had a non-default speed it's a non-issue for New Tower, but Continue should land on the normal default (speed 1) exactly as a fresh boot does today.
5. **Transport kind ids** — step-3 pulse assumes `stairs` + `elevatorStandard` (verified in `facilities.ts`); if the "standard" elevator kind is renamed, update the selector. The `done()` predicate is kind-agnostic (floor-served), so gameplay gating is unaffected.
6. **`#hint` repurposing** — it's currently static in `index.html`; onboarding and the default idle state now both write it. Ensure a single owner (the controller sets it while active; restores a device-aware default on finish) so the two don't fight.
7. **Help modal stacks over splash** — How-to-Play opens `#modal` while `#splash` is still mounted; verify z-order (modal above splash) and that closing Help returns to the splash, not the game.