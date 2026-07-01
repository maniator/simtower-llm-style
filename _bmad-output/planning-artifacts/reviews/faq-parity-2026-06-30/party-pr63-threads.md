# Party-mode roundtable — PR #63 (Tower Tycoon first-run splash + onboarding)

Date: 2026-06-30 · Worktree: faq-firstrun · Grounded in `_bmad-output/project-context.md`,
`_bmad-output/planning-artifacts/design/gdd-first-run-2026-07-01.md`, and
`firstrun-review.md`. Each Copilot thread was re-verified against live source.

## Verdict summary

| Thread | Concern | Consensus | State in current source |
|--------|---------|-----------|-------------------------|
| T1 | `arm()` re-entrancy (MAJOR) | fix (valid) | **Already fixed** — verify only |
| T2 | Device-aware default hint on mobile | fix (valid) | **Already fixed** — verify only |
| T3 | Splash attribution copy parity | fix (valid) | **Already fixed** — verify only |
| T4 | Screenshot HUD speed mismatch | fix (valid) | **Still open** — one-liner |

---

## T1 — `arm()` re-entrancy / orphaned `#onboard` + leaked mq listener (MAJOR)

**Consensus: fix (concern valid) — already resolved in current source; no further code change.**

Deep-review M1 and two panelists correctly flagged a real MAJOR: an old `arm()` that
mounted a panel and added a per-session mq listener unconditionally would, on a re-arm
mid-onboarding (Help→Replay `main.ts:91-94`, or top-bar New `main.ts:1017`), stack a
second `#onboard` node and leak the previous change-listener.

Verified in current `src/ui/Onboarding.ts` the fix is already in place:
- `arm()` (line 217): after the `isOnboarded()` guard (218) it calls
  `clearSession()` first (line 219, "re-entrancy guard: never leave a second panel
  behind") — tears down panel + pulse + `sendOff` timer before re-mounting.
- The mq `change` handler is now a single controller-lifetime listener `onMq`
  (declared line 125, added once in the constructor line 133) — structurally cannot leak.
- `finish()` clears any prior `sendOff` before arming a new one (line ~293); the
  send-off click handler is `{ once: true }` (line 291).

The two "FIX blocker" panelists cite pre-fix line numbers (arm at 185/186); those do
not match current source. Action: **CONFIRM the fix holds; add a regression test**
asserting a single `#onboard` node and no mq-listener growth after Replay-while-active.

## T2 — Device-aware default hint when onboarding never arms (minor)

**Consensus: fix (concern valid) — already resolved; no further code change.**

Valid gap (not in deep review): a returning/onboarded mobile player would otherwise see
`index.html`'s hard-coded desktop hint. Current source makes the controller the single
owner of `#hint`: constructor calls `setDefaultHint()` immediately (line 132) and the
persistent `onMq` listener keeps it device-correct across rotate/resize even when
onboarding never arms (`setDefaultHint()` picks `DEFAULT_HINT_MOBILE`/`_DESKTOP` from
`opts.mq.matches`, lines 136-137). `index.html` still ships a desktop string but the
constructor overwrites it device-aware on load.

Correction to the thread text: the "storage unavailable" framing is inaccurate —
`isOnboarded()` catch returns `false`, so that path arms normally. The only real bug
was the already-onboarded path, and it is now covered. Action: **verify only.**

## T3 — Splash attribution copy parity (trivial copy)

**Consensus: fix (concern valid) — already resolved; no further code change.**

GDD canonical copy (`gdd-first-run-2026-07-01.md:32`) requires "Not affiliated with or
endorsed by Maxis / OPeNBooK / Vivarium." Verified `Onboarding.ts:169` already reads
exactly that (includes "or endorsed by"). Panelists cited line 157 needing the two
words; current source already matches the GDD. Action: **verify only.**

## T4 — Screenshot HUD speed mismatch (minor, tooling-only) — STILL OPEN

**Consensus: fix. Screenshot tooling only — not a shipped-game defect, not a merge blocker.**

Confirmed open in `scripts/screenshots.mjs`. `dismissFirstRun` sets `g.speed = 2`
(line 134) and `g.engine.paused = false` (line 135) but never syncs the `#speed`
HUD. In the app, `.active` is toggled only inside the click/keydown handlers
(`main.ts:129-130`, `263-264`); the field assignment bypasses them, so `index.html`'s
default-active ▶ stays highlighted while the clock runs at ▶▶ — an inconsistent HUD in
generated marketing/doc shots (00b/01).

Action: in `dismissFirstRun`, after setting `g.speed = 2`, add
`document.querySelectorAll('#speed button[data-speed]').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === 2));`
(mirrors `main.ts:129-130`). Same latent field-only assignment exists at lines 206/237
(`g.speed = 0`) and 261 — apply the same one-liner there only if those frames show the
speed HUD; the visible regression is the dismiss path.
