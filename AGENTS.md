# Agent & contributor guide

Conventions for anyone (human or AI agent) working in this repository.

## Language & style

- **Use American English everywhere** — code comments, identifiers, strings,
  commit messages, UI copy, and documentation. For example: `color` (not
  `colour`), `center` (not `centre`), `behavior` (not `behaviour`), `recognize`
  (not `recognise`), `story`/`stories` for floors (not `storey`/`storeys`).
- Match the surrounding code's formatting, naming, and comment density.
- Keep the simulation engine (`src/engine/`) free of DOM/rendering concerns so it
  stays deterministic and unit-testable.

## Architecture

- `src/engine/` — pure game simulation (no DOM). Deterministic; covered by tests.
- `src/render/` — canvas rendering and pixel-art sprites. Reads engine state,
  never mutates it.
- `src/ui/` — DOM controls (palette, status bar, dialogs). Uses native
  `<dialog>` for modals.
- `src/audio/`, `src/storage/` — sound and save/load, independent of rendering.
- `src/main.ts` — wires everything together (input, game loop).

## Quality gates (run before pushing)

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run build       # production build must succeed
```

CI (`.github/workflows/test.yml`) runs all of the above on every PR.

## Gameplay model notes

- Facilities are defined in `src/engine/facilities.ts`. Each has a `width` (in
  tiles) and optional `floors` (height in storeys; e.g. the cinema is 2).
- `basement: true` facilities (parking, recycling, metro) may only be built
  underground; the metro spans a whole basement floor.
- The tower grid is two-layered: a structural layer (floor/lobby) and a room
  layer that sits on top, exactly like the original SimTower corridor model.
