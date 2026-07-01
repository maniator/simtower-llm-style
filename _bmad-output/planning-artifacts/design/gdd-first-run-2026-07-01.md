# First-Run Experience — Design & Content Spec
**Tower Tycoon** · Game Design (Samus Shepard, GDS) · grounded in shipped source (`src/main.ts`, `src/ui/UI.ts`, `src/index.html`, `src/engine/Simulation.ts`)

> **Source-truth callouts (verified, not assumed):**
> - Boot goes straight to play: `main.ts:64` does `SaveGame.load() ?? Simulation.newGame(...)`. No splash, no onboarding today.
> - `Simulation.newGame` (`Simulation.ts:1256`) **already seeds a 40-tile ground lobby at floor 1** — the player is *not* on a bare lot. Onboarding must teach from "you have a lobby" forward, not "lay your first tile."
> - Help exists (`UI.ts:544 showHelp`), opened from `#btn-help`. Modals are the shared DOM `<dialog id="modal">` via `openModal/closeModal`.
> - There is already a **static, non-device-aware** hint bar in `index.html:60` (`#hint`): *"Drag to pan · Scroll to zoom · Click to build · Inspect tool to edit a room."* It is never updated by code. We will repurpose it as the contextual-hint surface and make it device-aware.
> - Mobile is `window.matchMedia("(max-width: 860px)")` (`main.ts:54`). Palette groups are **Structure / Transport / Commercial / Living / Leisure / Services / Special** (`UI.ts:8`).
> - **Control asymmetry that onboarding MUST get right** (from `wireEngine` / `classifyDown`):
>   - *Desktop:* with a **build tool active**, left-drag **builds/paints** — it does **not** pan. Panning needs the **Inspect tool** (drag pans, tap selects), or **hold Space / right-drag**. Scroll = zoom. Right-click = inspect.
>   - *Mobile:* one finger **pans**; a **tap** runs the active build tool (`onTap`). **Exception:** transport tools (elevator/stairs) are *action* on touch — you **touch-and-drag vertically to size the shaft**. Pinch = zoom.

---

## 1. Splash / Title Screen

### Purpose & placement
A restrained, code-drawn title card shown **before** the game controller wires up input — it is **chrome**, so it is its own full-screen DOM overlay (`#splash`), **not** the shared `#modal` (which is reserved for emergency choices / stats and must stay free). It is the natural home for New/Continue/Help and for the clean-room attribution the project requires.

**Continue logic:** call `SaveGame.load()` (and/or `SaveGame.listSlots()`) at splash-build time. If it returns a tower → show **Continue** as the primary CTA and **New Tower** as secondary. If null → **New Tower** is primary and **Continue** is hidden (not greyed — hidden, to avoid teasing a dead button on a first-ever visit).

### Content (exact copy)
- **Title:** `TOWER TYCOON`
- **Tagline (one line):** `Build up. The elevators are the game.`
- **Premise (1–2 sentences):** `Raise a living high-rise floor by floor — lease offices, open shops, run hotels, and thread the elevators that keep the whole city moving. Grow your star rating from 1★ to the legendary TOWER.`
- **Primary CTAs:**
  - `▶ Continue` — *(only when a save exists)* resumes the loaded tower.
  - `＋ New Tower` — starts `Simulation.newGame(...)`; triggers first-run onboarding (see §2).
  - `？ How to Play` — opens the existing Help modal (`showHelp`).
- **Attribution line (clean-room, required):**
  `An unofficial, from-scratch homage to SimTower (1994). Original code and art — no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.`
- **Version:** `v1.0.0` *(read from `package.json`; shown small, bottom corner)*

### Desktop layout (wide, centred card)
```
┌────────────────────────────────────────────────────────────┐
│                                                            ▓ │  <- code-drawn skyline
│              ████    TOWER  TYCOON    ████                 ▓▓ │     silhouette (canvas
│                                                          ▓▓▓▓ │     or CSS gradient),
│            Build up. The elevators are the game.       ▓▓▓▓▓▓ │     lit windows, no
│                                                      ▓▓░▓▓░▓▓ │     imported art
│     Raise a living high-rise floor by floor — lease   ▓▓▓▓▓▓ │
│     offices, open shops, run hotels, and thread the ▓▓░▓░▓▓▓ │
│     elevators that keep the city moving. Climb from  ▓▓▓▓▓▓▓ │
│     1★ to the legendary TOWER.                       ▓▓▓▓▓▓▓ │
│                                                                │
│        ┌───────────────┐   ┌───────────────┐                  │
│        │  ▶  Continue   │   │  ＋ New Tower  │                  │  (Continue only if save;
│        └───────────────┘   └───────────────┘                  │   whichever is primary is
│              ┌──────────────────────┐                          │   filled/accent-coloured)
│              │   ？  How to Play      │                         │
│              └──────────────────────┘                          │
│                                                                │
│  Unofficial homage to SimTower (1994). Original code & art —   │
│  not affiliated with Maxis / OPeNBooK / Vivarium.        v1.0.0│
└────────────────────────────────────────────────────────────┘
```

### Mobile layout (`≤860px` — single column, thumb-reachable CTAs)
```
┌──────────────────────┐
│      ▓▓░▓▓░▓▓▓        │  skyline banner (shorter)
│    ▓▓▓▓▓▓▓▓▓▓▓        │
│                      │
│    TOWER TYCOON      │
│                      │
│  Build up. The       │
│  elevators are       │
│  the game.           │
│                      │
│  Raise a high-rise   │
│  floor by floor and  │
│  climb to the TOWER. │  (premise trimmed a touch for height)
│                      │
│ ┌──────────────────┐ │
│ │  ▶  Continue      │ │  full-width, stacked,
│ └──────────────────┘ │  primary on top, ~48px tall
│ ┌──────────────────┐ │  (touch targets)
│ │  ＋ New Tower     │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │  ？ How to Play   │ │
│ └──────────────────┘ │
│                      │
│ Unofficial homage to │
│ SimTower (1994).     │
│ Original code & art. │
│              v1.0.0  │
└──────────────────────┘
```
**Desktop vs mobile differences:** desktop is a two-column card (skyline art beside text, CTAs in a centred row); mobile is a single centred column with **full-width stacked CTAs (~48px min height)** for thumbs, a shorter skyline banner, and a slightly trimmed premise so the buttons stay above the fold. Both are dismissed by any CTA; **Esc / backdrop tap = same as the primary CTA** (Continue if present, else it just stays — New Tower requires an explicit press so we never wipe intent).

---

## 2. First-Run Instructions + Contextual Helpers

### Mechanism decision: a non-blocking **Getting-Started checklist** + **state-driven contextual coachmarks**, NOT a modal wizard

**Chosen design (hybrid, lightweight):**
1. **A small dismissible "Getting Started" panel** (the checklist) — 4 steps, docked bottom-left on desktop / above the palette strip on mobile. It is the persistent backbone.
2. **One live contextual hint at a time**, rendered in the repurposed `#hint` bar, that (a) names the exact gesture for the *current* device and (b) **pulses the relevant palette group** so the eye goes to the right button.
3. Steps **advance on the real game action**, detected by polling `sim` state in the existing `update()` throttle (~6 Hz) — not by a scripted "click here now" trap.

**Why this and not the alternatives:**
- **Not a blocking coachmark tour / modal wizard.** SimTower is a sandbox; a step-gated overlay that eats clicks fights the core fantasy and infuriates anyone who already knows the genre. A modal also collides with the shared `#modal` used for emergencies.
- **Not a single quickstart card.** One card can't teach the device-specific gestures *at the moment of use*, and it's forgotten instantly.
- **A checklist wins because it is:** non-blocking (play continues), **skippable** (one "Skip" button), **save-safe/deterministic** (it reads `sim` truth — units/transports/served/money — so it survives reload and never desyncs; it writes nothing to the save), advances on genuine progress (satisfying, not patronising), respects **diegesis** (pure DOM chrome; the engine stays untouched), and adds **no new deps**.

### The four steps — exact copy (teaches empty-ish lot → first office earning money)
> Player starts with a ground-floor **Lobby** already placed (see source callout). So step 1 is the first floor *above* it.

**Checklist header:** `Getting Started  ·  build your first tenant`  ` [Skip]`

| # | Step title | Checklist sub-copy | Advance condition (from `sim`) |
|---|---|---|---|
| 1 | **Add a floor** | "Every room needs a floor under it. Pick **Floor** and lay one just above your lobby." | a `floor`/structure tile exists on floor ≥ 2 |
| 2 | **Lease an office** | "Offices pay the rent. Pick **Office** and drop it on your new floor." | ≥ 1 `office` unit placed |
| 3 | **Connect it** | "No one can reach a floor without transport. Run a **Stairway** or **Elevator** from the office down to the ground lobby." | that office's floor returns true from `isFloorServed` / `floorReachable` |
| 4 | **Press Play & wait** | "Hit **▶ Play**. A tenant moves in within a day or two — rent lands each quarter." | first office reaches `occupied` (a tenant moved in) |

On the 4th completion: swap the panel to a one-line send-off — `Nice — you're a landlord. The rest is in Help (？). Build up!` — then it **auto-dismisses after ~6s or on tap**, and the once-only flag is set. No confetti spam; one `promote`-style chime at most.

### Contextual hints — DESKTOP vs MOBILE (explicit, per step)
The `#hint` bar shows exactly one line, chosen by `mobileMq.matches`. Each also pulses the named palette group.

| Step | **Desktop hint** (`#hint`) | **Mobile hint** (`#hint`) |
|---|---|---|
| 1 Floor | "Pick **Floor** (Structure) → **click-drag** across the row above your lobby to lay a run. *(To move the view: switch to **Inspect** and drag, or hold **Space** / right-drag. **Scroll** = zoom.)*" | "Tap **Floor** (Structure) → **tap** the row above your lobby. *(**One finger drags** to move the view. **Pinch** = zoom.)*" |
| 2 Office | "Pick **Office** (Commercial) → **click** on your new floor to place it." | "Tap **Office** (Commercial) → **tap** your new floor to place it." |
| 3 Connect | "Pick **Stairway** or **Standard Elevator** (Transport) → **click at the bottom and drag up** to the office floor. It must touch the ground lobby." | "Tap **Stairway** or **Standard Elevator** (Transport) → **touch and drag up/down** to size the shaft down to the lobby. *(Transport builds on drag, not tap.)*" |
| 4 Play | "Press **▶** in the top bar (or keys **1–3** for speed). Right-click any room to inspect it." | "Tap **▶** in the top bar. **Tap** a room with the **Inspect** tool to check on it." |

**Why the split matters (load-bearing):** on **desktop** a build tool is active during onboarding, so left-drag *builds* — telling the player to "drag to pan" (the current static hint) is actively wrong mid-build; we must point them to Inspect/Space/right-drag. On **mobile** the reverse trap: a one-finger drag pans and a *tap* builds — except transport, which sizes on drag. Getting either wrong strands a new player.

### Anchoring / rendering notes for the implementer (kept diegesis-safe)
- Checklist + `#hint` are **DOM**; do not route through the engine. Reuse the existing `#hint` element rather than adding chrome.
- "Pulse a palette group" = add a CSS class to the relevant `.pal-group` (Structure/Commercial/Transport). Purely cosmetic; no engine coupling.
- Step detection lives in `GameApp.update()` behind the existing `now - lastUiUpdate > 160` throttle so it costs ~nothing and is inherently save-safe (reads current `sim`).

---

## 3. Restraint Rules (once-only, skippable, re-openable, no nagging)

1. **Once-only.** Gate on a single flag: `localStorage["tt.onboarded"] = "1"`. Set it when the checklist completes **or** is skipped. Also treat **returning players** as onboarded implicitly: if `SaveGame.load()` returns a non-null tower at boot, **do not** start onboarding even if the flag is somehow unset — an existing tower means they've played.
2. **Splash for returning players.** The splash still shows (it's the menu), but with **Continue as primary**; it never forces onboarding. Onboarding is armed **only** by pressing **New Tower** on a browser that has never onboarded.
3. **Fully skippable.** One `[Skip]` on the checklist dismisses it instantly and sets the flag. Splash CTAs are all one-tap; Esc/backdrop resolves to the safe default (Continue if a save exists). Nothing blocks input at any point.
4. **Re-openable from Help.** Add one line to the bottom of `showHelp`'s modal: a `Replay Getting Started` button that clears `tt.onboarded` for the session and re-arms the checklist on the current tower (starting at the first uncompleted step it detects from `sim`). This makes it discoverable without cluttering the main HUD.
5. **No nagging.** The checklist never re-appears on its own, never re-pulses after dismissal, shows **one** hint line at a time (never a stack of toasts), and emits **at most one** completion chime. If the player ignores it and just plays, it quietly self-completes as they hit each condition and then fades — the onboarding *rewards* organic play rather than interrupting it.

---
*Produced by the GDS `gds-agent-game-designer` (Samus Shepard). Design + content only — recommendations grounded in the shipped engine and UI; no committed scope or code.*