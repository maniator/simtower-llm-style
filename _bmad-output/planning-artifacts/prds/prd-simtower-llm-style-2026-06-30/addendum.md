# Addendum — Tower Tycoon PRD

Depth that does not fit the PRD's capability-focused shape: technical realization,
aesthetic/tone direction, the relationship to the source of truth, and rejected
alternatives. The PRD (`prd.md`) is authoritative for requirements; this file is
supporting context for downstream architecture/UX work.

---

## A. Source-of-Truth Mapping (SimTower 1994 → Tower Tycoon)

| SimTower (1994) mechanic | Tower Tycoon realization | Divergence |
| --- | --- | --- |
| Build floors, then rooms; ground + sky lobbies every 15 floors | Two-layer grid; rooms auto-create floor beneath; lobbies at ground + every 15th | Faithful |
| ~100 floors up, basements below | 100 up, 10 basement levels below (B1…B10, floor 0 = B1 down to floor −9), 200 tiles wide | Faithful (basement depth tuned) |
| Offices, condos, hotel (single/double/suite), food, retail, cinema, party hall | All present with original cadences | Faithful |
| Services: security, medical, housekeeping, recycling, parking | All present | Faithful |
| Metro/subway brings visitors | Whole-basement Metro Station | Faithful |
| **Cathedral** on floor 100 for TOWER | **Wedding Hall** on floor 100 | **Renamed** — religion-agnostic |
| Stairs, escalators, standard/service/express elevators with cars + stops | All present; SCAN dispatch; editable cars & per-floor stops | Faithful |
| Star ratings 2★/3★/4★/5★ at 300/1k/5k/10k; TOWER at **15,000** | Same star thresholds; TOWER at **12,000** | **TOWER pop reduced** |
| Fire, terrorist/bomb, VIP inspection, treasure | All present, plus thief + seasonal Santa cameo | Faithful + flavor additions |
| Aggregate congestion/stress model | **Individually-routed** crowd (BFS) + aggregate backstop | **Enhanced** + backstop |
| `.TWR` save format | JSON saves; `.TWR` import = documented stub | Modernized; `.TWR` import partial |

### Deliberate divergences (rationale)

1. **Cathedral → Wedding Hall.** A religion-agnostic events hall avoids
   reproducing the original's specific religious building while preserving the
   "grand capstone on floor 100 that triggers the win" role.
2. **TOWER population 12,000 vs. 15,000.** This build's population model is
   smaller-scale (retail/food/entertainment add visitors but no resident
   population). 12,000 keeps the win reachable while preserving the "fill a tall
   tower" intent. Revisit if a larger-scale model lands (Open Question 4).
3. **Individually-routed crowd + aggregate backstop.** The original used an
   aggregate stress model. This build pathfinds real commuters (walk → wait →
   ride a real car → transfer → arrive) so stress is *visible* and causal, but
   keeps a deterministic, DOM-free aggregate model underneath as the testable
   backbone and the on-screen crowd is capped (~140) for performance.

## B. Technical Realization (informs architecture, not a requirement)

- **Language/stack:** TypeScript on the **Excalibur.js** game engine (camera,
  scene, culling, collision, render loop). Build tooling: Vite (`build`,
  `preview`, `build:single` for a one-file inlined bundle).
- **Audio:** procedural **WebAudio** synth — no audio files. Location-aware
  scene crossfading driven by camera focus.
- **Rendering:** all sprites drawn in code (`src/render/pixelSprites.ts`,
  `sprites.ts`); no external art assets.
- **Simulation core (`src/engine/`):** single global `Clock`; `Simulation`,
  `Tower`, `EconomySystem`, `EventSystem`, `ElevatorDispatch`, `Crowd`,
  `SimContext`. Config centralized in `econConfig.ts` and `facilities.ts`. Seeded
  `rng.ts` so the simulation is deterministic and headless-testable.
- **Elevator dispatch (FR-26):** demand-driven **SCAN** (elevator/disk-scan
  algorithm) — a car continues in its current direction serving requests, then
  reverses; idles at the ground lobby when there is no demand (`ElevatorDispatch`).
- **Commuter routing (FR-30):** each person's path is computed by **BFS** over
  the connected transport graph (shafts + lobby transfers), in `Crowd`.
- **Determinism boundary:** gameplay events use the seeded RNG; cosmetic weather
  uses a separate RNG so visuals never perturb gameplay (supports FR-54/FR-57).
- **Persistence:** `localStorage` autosave + slots; JSON export/import
  (`SaveGame.ts`); best-effort `.TWR` decoder stub (`twrImport.ts`).
- **Testing:** Vitest suite (84 tests, all passing) covering placement rules,
  economy, ratings gates, events (housekeeping/fire/bomb/weather), elevator
  dispatch, crowd BFS routing/movement, save/load, the `.TWR` parser, and an
  end-to-end run to the TOWER victory (`parity.test.ts`). `npm run typecheck`,
  `npm run lint`, `npm run screenshots`.

## C. Aesthetic & Tone

- **Visual reference:** the 1994 original's flat, readable, pixel cross-section
  of a tower — each floor a horizontal band, rooms as colored cells, tiny
  walking people. Code-drawn sprites in a restrained, period-appropriate palette
  (see `FACILITIES[*].color`).
- **Anti-references:** no glossy 3D, no skeuomorphic chrome, no asset-store look.
  Nothing that reads as a generic mobile "tycoon" cash-shop game.
- **Atmosphere:** calm and absorbing. Day/night arc with sun and moon, lit
  windows at night, shops closing, a metro train arriving — the building should
  feel *alive* and *quiet*.
- **Audio tone:** unobtrusive, location-aware muzak/ambience; jingles for
  build/sell/promotion are short and satisfying, never intrusive.

## D. Cross-Cutting Non-Functional Notes (for architecture/UX)

- **Performance:** must stay responsive on a tall, fully-populated tower on a
  mid-range laptop and phone; the ~140 visible-crowd cap and culling are the
  primary levers.
- **Determinism/testability:** the aggregate model + seeded RNG must keep the
  headless suite green; rendering must be separable from simulation.
- **No network dependency:** everything runs offline, including the single-file
  build.
- **Accessibility (open):** color-blind-safe congestion cue, keyboard play, and
  reduced-motion are unresolved (Open Question 6) — flagged for UX.

## E. Rejected / Deferred Alternatives

- **Reproduce the Cathedral verbatim** — rejected (clean-room + neutrality).
- **Match 15,000 TOWER population now** — deferred until a larger-scale
  population model exists; would otherwise make the win grindy/unreachable.
- **Full `.TWR` import** — deferred; the format is under-documented and the
  effort outweighs MVP value. Stub documents the v2 decode path.
- **Single aggregate stress model (original-style only)** — superseded by the
  individually-routed crowd; the aggregate model was retained, not removed, as a
  deterministic backstop rather than the primary mechanic.
- **Native/desktop app packaging** — rejected; zero-install browser + single-file
  HTML covers the sharing/play goals without a distribution pipeline.
