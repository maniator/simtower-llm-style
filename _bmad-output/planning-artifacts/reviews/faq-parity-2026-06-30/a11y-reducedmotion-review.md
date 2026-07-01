# PR #66 — Reduced-Motion Accessibility: Merge-Readiness Review

**Verdict: SAFE TO MERGE.** Zero blocker/major findings. The core correctness claim (the decorative anim clock freezes cleanly and functional motion is untouched) holds under source inspection. Remaining items are two clusters of *minor* UX/documentation nits and a handful of *info* notes — none block merge.

- **Feature:** OS/user reduced-motion → freeze decorative anim clock; per-device prefs in `localStorage` (`vc.prefs`), corrupt-tolerant, off the save.
- **Reviewed:** `git diff origin/main...HEAD` (9 files, +554/-2) plus real source in `src/render/excalibur/TowerEngine.ts`, `src/storage/Prefs.ts`, `src/main.ts`, `src/ui/UI.ts`, `src/styles.css`, `src/render/sprites.ts`, `src/render/pixelSprites.ts`, `src/excalibur-main.ts`.
- **Tests:** suite passes; `src/tests/prefs.test.ts` adds **5** `it()` cases (the PR description says "+6" — an off-by-one in the description, not a code issue).

---

## Merge blockers / majors

**None.**

---

## Summary of findings by severity

| # | Sev | Title |
|---|-----|-------|
| F1 | info | Freeze/resume clock logic is correct — no jump, no NaN |
| F4 / F7 / F8 | minor | Help toggle is a silent no-op while OS `prefers-reduced-motion` is ON |
| F2 / F6 / F10 | minor | PR claim "d.anim drives ONLY ambient layers" is incomplete (crane, flames, cinema) |
| F3 | info | (Same OS-wins root cause as F4/F7/F8) toggle is a no-op with OS pref on — correct semantics |
| F5 | info | Prefs seam, wiring, and save-safety are clean |
| F11 | info | `colorblindCue` pref is defined/persisted/tested but read nowhere (dead scaffolding) |
| F12 | info | `excalibur-main.ts` debug entrypoint never applies reduced motion (pre-existing gap) |
| F13 | info | No CSS/type/test regression from the `html.reduce-motion` blanket or the new callback |

---

## Confirmed correctness (core claim holds)

### F1 — Freeze/resume clock logic is correct (info)
`src/render/excalibur/TowerEngine.ts:376-378`. Accumulation into `animClock` is gated by `if (!this.paused && !this.reducedMotion)`, while `this.lastAnimWall = nowWall` runs **unconditionally** every tick and `this.d.anim = this.animClock` is assigned each frame. `tick()` is registered as `onPostUpdate`, so Excalibur invokes it every rendered frame regardless of pause/reduced-motion, keeping `lastAnimWall` fresh throughout the freeze. Consequences, all verified:
- **No jump on resume:** the delta re-added is only the single last-frame gap (`nowWall - lastAnimWall`), never the accumulated frozen span.
- **No NaN:** `performance.now()` always returns a number, `animClock` initializes to 0, and the `lastAnimWall === 0` guard seeds the first frame.
- **No functional path affected:** every read of `d.anim` is render-only; nothing feeds sim/clock/save logic.

### F5 — Prefs seam, wiring, save-safety clean (info)
- **Corrupt-tolerant:** `loadPrefs`/`savePrefs` wrap `getItem`/`setItem`/`JSON.parse` in try/catch, fall back to `{}` / no-op, and whitelist boolean fields only (`Prefs.ts:14-31`). Covered by `prefs.test.ts`.
- **OS-wins effective logic:** `reducedMotionActive = mqMatches || prefs.reducedMotion === true` (`Prefs.ts:41`).
- **Determinism / save-safety:** dedicated key `vc.prefs`, never read/written by `SaveGame`; only `reducedMotion` mutates at runtime; `d.anim` is render-only with no feedback into sim/save.
- **No listener leak:** `reduceMq.addEventListener("change", …)` registered once on the app-lifetime singleton (`main.ts:126`), plus a boot-time `applyReducedMotion()`.
- **No XSS:** button label set via `textContent` with a hardcoded string (`UI.ts:564`).
- **No `start()` race:** `setReducedMotion` is a synchronous field set read fresh each tick; `applyReducedMotion()` runs after `engine.start()`.

### F13 — No CSS/type/test regression (info)
`src/styles.css:1049-1056`. The new `html.reduce-motion *` block is a byte-for-byte mirror of the existing `@media (prefers-reduced-motion)` rule (`styles.css:1035-1044`) — same four `!important` declarations — so it introduces no new breakage class. The Excalibur canvas is 2D/WebGL (not CSS-animation driven), so `animation-duration: 0.001ms` cannot affect it, and neutralised transitions do not change final computed layout. The only DOM keyframe (`slidein`) has no fill-mode and animates to the natural visible state, so instant completion leaves toasts visible. `onToggleReducedMotion` is a required `UICallbacks` field but its sole construction site is the object literal in `main.ts`; no test mocks `UICallbacks`, so `tsc` is satisfied and nothing breaks.

---

## Minor findings (non-blocking; recommend follow-up, not required for merge)

### M1 — Help "Reduced motion" toggle is a silent no-op when OS `prefers-reduced-motion` is ON (minor)
*Consolidates F4, F7, F8 (and info F3), which all report the same root cause.*

**Location:** `src/ui/UI.ts:564-566`, `src/main.ts:95-99` (`onToggleReducedMotion` returning `reducedMotionActive`).

The Help button toggles the **user** pref but its label reflects the **effective** state (`OS || user`). When the OS query is ON, `reduceMq.matches` short-circuits `reducedMotionActive` to `true` regardless of the pref, so:
- The button reads "Reduced motion: On" and repeated clicks produce **zero visible change** — the control appears broken/unresponsive.
- Each odd click still silently persists `reducedMotion:true` to `vc.prefs`. If the user later disables the OS setting expecting ambient motion back, the **sticky stored pref keeps motion suppressed** with no UI explaining why.

This is the **intended "OS wins" spec** (asserted in `prefs.test.ts:28`), so it is *not* a correctness bug and produces no wrong data — the pref does take effect once the OS pref is off. But it is a real usability gap.

**Recommendation:** disable or annotate the button (e.g. "On (system)" / "forced by system setting") when `this.reduceMq.matches` is true; consider not toggling the user pref while the OS forces it. Secondary nit (F7): the toggle exposes state only via `textContent` with no `aria-pressed` — announced by screen readers but not ideal for an accessibility control.

### M2 — PR claim "d.anim drives ONLY ambient layers" is incomplete (minor)
*Consolidates F2, F6, F10 (same documentation-inventory issue).*

**Location:** design note `TowerEngine.ts:143-146` and PR description vs. `src/render/sprites.ts:177,204`, `src/render/pixelSprites.ts:418,425`.

The PR enumerates only clouds (`TowerEngine.ts:599`), rain (`:624`), train, and pacing walkers (`:1073`). A full grep of `.anim` reads shows **three additional consumers** that also freeze under reduced motion:
- Construction crane hook — `sprites.ts:177` (`Math.sin(d.anim)`)
- Burning-unit flame flicker — `sprites.ts:204` (`d.anim * 6`)
- Cinema marquee chase lights + screen frames — `pixelSprites.ts:418,425`

The PR's **core thesis still holds**: these are all purely decorative; functional motion is genuinely preserved (elevator cars read `c.t.carPositions` at `:1054`; the routed crowd is placed from sim `p.x/p.fy` in `positionPerson`; none read `d.anim`). Caveats worth noting:
- Flames/crane render inside room `Canvas`es marked `cache:false` (`TowerEngine.ts:896`) and redraw every frame — so a burning unit's flames **do** collapse to a static shape under reduced motion. Not a functional break (fire state + static flame shape still render; arguably *desirable* for photosensitive users), but it may read as a render glitch and is not called out.
- Cinema is a normal-state room (`cache:true`, baked once), so it snapshots `d.anim` at bake time and never visibly freezes — a code-level reference, not a live-motion regression.

**Recommendation:** correct the enumeration in the doc comment at `TowerEngine.ts:143-146` and the PR description; optionally note the intentional frozen-flame behavior.

---

## Info notes (no action required)

- **F11 — `colorblindCue` is dead scaffolding.** Declared, round-tripped, and tested in `Prefs.ts`, but `grep -rn colorblindCue src/` finds no reader outside `Prefs.ts`/its test. Harmless, unused, unrelated to this feature.
- **F12 — `excalibur-main.ts` debug entrypoint ignores reduced motion.** `src/excalibur-main.ts:55` constructs `new TowerEngine(...)` with no UI and never calls `setReducedMotion` nor toggles `html.reduce-motion` (confirmed by grep — all wiring lives in `main.ts`). This is a dev/debug harness and canvas motion was never frozen on any entrypoint before this PR, so it is a **pre-existing gap, not a regression**. `preview.ts`/`gallery.ts` don't use `TowerEngine`.
- **Minor stale-label edge case (from F5):** if the OS pref flips while the Help modal is open, the button label is stale until reopened. Cosmetic.

---

## Bottom line

The feature does what it claims where it matters: the freeze/resume math is correct, no NaN/jump, functional (sim-driven) motion is fully preserved, prefs are corrupt-tolerant and isolated from the save, and there is no CSS/type/test regression. The only substantive gaps are UX polish (M1: guard/annotate the toggle under OS-forced reduced motion; add `aria-pressed`) and documentation accuracy (M2: the `d.anim` consumer list omits crane/flames/cinema). Both are **minor** and suitable as fast-follow.

**Certification: SAFE TO MERGE.**
