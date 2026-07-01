# PR #63 Merge-Readiness Review — First-Run Splash + Onboarding

- **Feature:** First-run splash + 4-step onboarding checklist (pure DOM chrome).
- **Scope reviewed:** `git diff origin/main...HEAD` — `src/ui/Onboarding.ts`, `src/main.ts`, `src/ui/UI.ts`, `vite.config.ts`, `src/vite-env.d.ts`, `styles.css`, `scripts/screenshots.mjs`, `src/tests/onboarding.test.ts`.
- **Grounding:** `_bmad-output/project-context.md`; `_bmad-output/planning-artifacts/design/gdd-first-run-2026-07-01.md`; `_bmad-output/planning-artifacts/design/arch-first-run-2026-07-01.md`.
- **Build/test state as submitted:** 177 tests pass, `tsc` + lint clean.

---

## Verdict

**NOT SAFE TO MERGE — 3 major defects must be fixed first.**

Highest-severity item: **`OnboardingController.arm()` is not re-entrant** — replaying or restarting onboarding while it is already active mounts a duplicate `#onboard` panel (duplicate DOM id, orphaned node) and permanently leaks a `MediaQueryList` `change` listener. Reachable via shipped top-bar buttons (`New`, Help → "Replay Getting Started"). No crash or data loss, but broken, ghost-panel UI plus an accumulating listener leak. Fix: make `arm()` tear down any existing panel/listener/timer (or early-return on `this.active`) before mounting.

The three majors share two root causes (non-idempotent `arm()`; replay/splash lifecycle not coordinated). Both are small, localized fixes in `Onboarding.ts` / `main.ts`. Once landed, the remaining items are safe as follow-ups.

---

## BLOCKER (0)

None. No crash, data-corruption, or determinism defect. Save/localStorage safety, `__APP_VERSION__` injection, and `vite-env.d.ts` tracking were explicitly verified clean (see Info / F19).

---

## MAJOR (3) — fix before merge

### M1. `arm()` is not re-entrant: re-arming while active duplicates the panel and leaks the mq listener
*(consolidates confirmed findings F2, F5, F8, F11, F13, F14, F20 — all the same root cause)*

**Where:** `src/ui/Onboarding.ts:185-200` (`arm`), `:217-226` (`mountPanel`), `:281-284` (`detachMq`); reached from `src/main.ts:1017` (`newGame`) and `src/main.ts:91-95` (`onReplayOnboarding`).

**Defect:** `arm()` guards only on `isOnboarded()` (line 186). The `tt.onboarded` flag is set only in `finish()` (252) and `dismiss()` (266), so during an in-progress checklist `isOnboarded()` is `false` and the guard is bypassed. `arm()` then unconditionally:
- calls `mountPanel()`, which `createElement('div')#onboard` + `appendChild` and overwrites `this.panelEl` — the previous panel is orphaned forever (`teardownPanel()` only removes the *current* `this.panelEl`), producing two stacked `#onboard` nodes sharing one DOM id; and
- reassigns `this.mqListener` and re-adds a `change` listener without first `detachMq()` — the prior listener leaks permanently and keeps firing `applyHintAndPulse()` on every breakpoint change (rewriting `#hint`, re-applying `.tt-pulse`), accumulating one leak per re-arm.

**Reachable via ordinary chrome (flag still false throughout):**
1. Top-bar **New** during onboarding: `UI.ts:177` btn-new → `confirmModal` → `onNew` (`UI.ts:84`) → `newGame()` (`main.ts:1014-1018`) → `arm()`. `adoptSim()` resets the sim so `firstIncompleteStep === 0` and the all-done early-return does not fire.
2. Help → **"Replay Getting Started"** during onboarding: btn-help is always live in the top bar (`UI.ts:184`); `showHelp()` renders the button (`UI.ts:560-563`) → `onReplayOnboarding` (`main.ts:91-95`) does `clearOnboarded()` (guaranteeing bypass) + `closeModal()` + `arm(sim)`. No confirmation gate.

**Edge sub-case:** `arm()` never clears a pending `this.sendOff` timer from a prior `finish()` (set at `:261`, `setTimeout(teardownPanel, 6000)`). Replaying within that 6s window lets the stale timer tear down the freshly-armed panel. Contrived (requires demolishing structure to un-satisfy a step, then replaying inside 6s) but eliminated by the same fix.

**Fix:** At the top of `arm()`, before mounting, tear down any live session — call `teardownPanel()` + `detachMq()` and `clearTimeout(this.sendOff)` (or early-return when `this.active`). This makes `arm()` idempotent and closes every path above.

---

### M2. "Replay Getting Started" from the splash's Help freezes the game
*(confirmed F4; overlaps F9)*

**Where:** `src/main.ts:91-95` (`onReplayOnboarding`) + `src/ui/Onboarding.ts:134-174` (`showSplash`) / `:176-180` (`teardownSplash`); z-index in `styles.css` (splash 40, onboard 25).

**Defect:** On a fresh first run (`hasSave === false`), `showSplash()` calls `pauseForSplash(true)` (`speed=0`, `engine.paused=true`, `main.ts:126-132`) and mounts `#splash` as an opaque full-screen overlay at z-index 40. The engine is resumed **only** by `teardownSplash()`, which fires **only** from the splash Continue/New click handlers. The splash's "？ How to Play" opens the shared Help modal (`opts.showHelp()`), which now hosts "Replay Getting Started". Clicking it runs `clearOnboarded(); ui.closeModal(); onboarding.arm(this.sim)` — it never tears down the splash and never calls `pauseForSplash(false)`.

**Result:** Help closes, `#onboard` (z-index 25) mounts *behind* the still-present opaque `#splash` (z-index 40), and the engine stays paused. The player stares at a frozen splash with the freshly-armed checklist buried. Recoverable only because `hasSave===false` still shows "＋ New Tower" (which resumes via `teardownSplash()` then `newGame()`), but that path itself triggers the M1 double-mount. Violates arch §3 ("don't advance the clock before the player commits" — here the inverse: the player cannot un-freeze via the intended button).

**Fix:** Make `onReplayOnboarding` (and/or `arm()`) a no-op while `#splash` is present, or tear the splash down (`teardownSplash()` → `pauseForSplash(false)`) before arming. Cleanest: guard replay to `if (document.getElementById('splash')) return;` and/or hide the "Replay Getting Started" button while the splash is up.

---

### M3. Splash "How to Play" → Replay arms onboarding on the throwaway boot sim, behind the splash
*(confirmed F9; shares the M1/M2 mechanics)*

**Where:** `src/main.ts:91` (`onReplayOnboarding`) + `src/ui/Onboarding.ts:173` (splash How-to-Play → `showHelp`).

**Defect:** A first-ever visitor on the splash can click How to Play → "Replay Getting Started". `onReplayOnboarding` arms onboarding against the boot-constructed sim (`main.ts:67`, the fixed `Date.parse("2024-01-01")` fallback) — **not** a New Tower sim — with no check that the splash was dismissed. `#onboard` (z-25) mounts invisibly behind `#splash` (z-40) and is bound to the wrong sim. If the player then clicks "＋ New Tower", `newGame()` `adoptSim()`s a *different* sim and calls `arm()` again, compounding into the M1 duplicate-panel/leaked-listener state.

**Fix:** Same guard as M2 — replay must no-op (or defer) while the splash is up, so onboarding is only ever armed against the committed New Tower sim after `teardownSplash()`.

---

## MINOR (8) — acceptable as post-merge follow-ups

### m1. Splash "New Tower" abandons an existing save with no confirmation *(F3)*
`src/main.ts` (splash `onNewTower` → `newGame`) vs `UI.ts:177-181`. With `hasSave()` true, the splash shows Continue **and** "＋ New Tower"; New Tower calls `newGame()` with no confirm, and the 30s autosave then overwrites the single `AUTO_KEY` slot. The toolbar New button guards the identical op with `confirmModal("Start a new tower? …abandons your current tower…")`. **Fix:** Route splash New Tower through the same `confirmModal` when `hasSave()`.

### m2. "Replay Getting Started" is a silent no-op on any already-progressed tower (the common case) *(F6, F15)*
`Onboarding.ts:188-193`. For an established tower all four `ONBOARD_STEPS.done()` predicates pass, so `firstIncompleteStep === length`; `arm()` calls `markOnboarded()` and returns with no panel, hint, pulse, chime, or toast. With Help already closed by `onReplayOnboarding`, the button does visibly nothing — contradicts arch §6 / gdd §3.4 ("re-arms the checklist on the current tower"). **Fix:** On the all-complete path, emit an acknowledgement (toast: "You've already completed Getting Started") instead of a dead close.

### m3. Autosave persists the throwaway boot sim while the splash is displayed *(F10, F12)*
`main.ts:144`. The 30s `window.setInterval` → `save(true)` runs unconditionally; `pauseForSplash` only touches speed/pause, not the timer. A first visitor idling ≥30s on the splash writes the boot sim to `AUTO_KEY`, flipping `hasSave()` true for a tower never started. Worse follow-on: next visit shows Continue as primary, and since onboarding only arms in `newGame()`, a Continue-clicker silently skips the entire first-run checklist while `tt.onboarded` stays unset. **Fix:** Suppress autosave (or skip the save call) while `#splash` is present / before first commit.

### m4. Splash does not trap keyboard: pressing 0-3 resumes the paused engine behind the splash *(F21)*
`main.ts:259` `bindKeys()` installs a global window keydown handler (keys 0-3 set `speed`/`paused`), bound at `main.ts:119` before `showSplash()`. The splash is a plain `<div>` with no `<dialog>`/`inert`/trap, so pressing 1/2/3 unpauses and advances the loaded tower's clock behind the menu (violates arch §3 determinism-before-commit); a subsequent autosave can persist it. **Fix:** Ignore speed keys while the splash is up (guard in the handler) or use `inert`/a `<dialog>`.

### m5. Splash Esc/backdrop dismissal specified but not implemented *(F7)*
`Onboarding.ts:134-174`. gdd §3.3 (line 147) and arch §3 (line 36) require Esc/backdrop to resolve to the safe default (Continue if a save exists). `showSplash()` wires only the three CTA buttons; `#splash` is a `<div>` (no native Esc) with no keydown/backdrop handler. For a returning player, Esc/backdrop do nothing. **Fix:** Add an Esc + backdrop-click handler that invokes Continue when `hasSave()`, else no-op; or make `#splash` a `<dialog>`.

### m6. `shouldArm()` is dead code; the "arm gating" test validates an unused function *(F16, F22)*
`Onboarding.ts:97` is referenced only by `onboarding.test.ts:26-32`; zero production callers. Real gating is open-coded at `main.ts:1017` plus `arm()`'s own `isOnboarded()` guard, neither tested. Gives false coverage confidence. **Fix:** Either wire `shouldArm(pressedNewTower)` into `newGame()`/`onReplayOnboarding()` (its stated purpose) or delete it and test the real gate.

### m7. Once-only guarantee (skip/finish → `markOnboarded`) has no test coverage *(F17)*
The core "once-only" property lives only in `dismiss()` (`Onboarding.ts:264-268`) and `finish()` (`:251-252`); neither is tested. A future reorder/removal (e.g. `active=false` before persisting) would re-nag on every New Tower with a green suite. **Fix:** Add a controller-level test that drives skip and finish and asserts `isOnboarded()` becomes true.

### m8. Splash New Tower / replay share the un-gated data-loss and re-entry surfaces
Rolled into m1 + M1 fixes above; listed for tracking completeness. No separate action needed once M1 and m1 land.

---

## INFO (2)

### i1. Controller-level `arm()` resume-at-step and completed-tower short-circuit are untested *(F18)*
`Onboarding.ts:186-192`. `firstIncompleteStep` is unit-tested, but the consuming controller behavior (resume at step; silent `markOnboarded()`+return on a finished tower) has zero coverage. Chrome-only, acknowledged in a comment. Pairs naturally with the m2 fix and the m7 test additions.

### i2. Determinism / save-safety / build-plumbing verified clean *(F19)*
Confirmed no defects: (1) Onboarding never mutates the sim (all `done` predicates and `tick/arm` only read `sim.tower`) and never touches `SaveGame`; its only persistence is `localStorage "tt.onboarded"`, which does not collide with save keys and there is no `localStorage.clear()`. (2) `__APP_VERSION__` is injected via `vite.config.ts` define; the `typeof __APP_VERSION__ !== "undefined"` guard (`Onboarding.ts:12`) is safe under vitest. (3) `src/vite-env.d.ts` is tracked despite `*.d.ts` via `!vite-env.d.ts` (`git ls-files --error-unmatch` confirms). (4) `dismissFirstRun` in `scripts/screenshots.mjs` is correct — desktop and mobile each use isolated `browser.newPage()` contexts, so both render `#splash` before dismissal.

---

## Recommended path to merge

1. **M1** — make `arm()` idempotent (teardown panel/listener/timer or early-return on `this.active`). Single fix; also neutralizes the M2/M3 compounding leak.
2. **M2 + M3** — guard `onReplayOnboarding`/`arm()` to no-op (or defer + `teardownSplash`) while `#splash` exists.
3. Re-run `tsc` + lint + the 177-test suite; add a regression test that replays onboarding while active and asserts a single `#onboard` node + no listener growth.
4. File m1-m8 + i1 as follow-up tickets (recommend doing **m1** — splash New Tower confirm — in the same PR since it is a one-line reuse of the existing `confirmModal` and closes a real data-loss surface).

Once M1-M3 (and ideally m1) land, this PR is **SAFE TO MERGE** with the remaining minors tracked as follow-ups.
