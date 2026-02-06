# SimTower LLM Style: Newcomer Overview

Welcome! This document gives a high-level tour of the codebase, key concepts to know before making changes, and suggested next areas to explore.

## General Structure

```
src/
├── app/
│   └── main.ts          # Application entry point
├── core/
│   ├── audio/
│   │   └── AudioSynth.ts      # Web Audio API integration
│   ├── game/
│   │   ├── Game.ts            # Game simulation engine and rules
│   │   ├── Room.ts            # Room/building logic
│   │   ├── Person.ts          # NPC simulation model
│   │   └── ElevatorCar.ts     # Elevator movement model
│   └── render/
│       └── Renderer.ts        # Canvas rendering system
├── ui/
│   └── UI.ts            # User interface and controls
├── data/
│   └── roomTypes.ts     # Game data definitions
├── storage/
│   └── storage.ts       # Save/load/export functionality
├── types/
│   └── types.ts         # TypeScript type definitions
└── tests/
    └── *.test.ts        # Unit tests
```

## Important Things to Know

### 1) App entry + main loop (`src/app/main.ts`)
`main.ts` wires together the `Game`, `Renderer`, `UI`, `AudioSynth`, and storage helpers. It runs the requestAnimationFrame loop that advances simulation time, renders the tower, and updates the HUD. It also preserves state across HMR updates and hooks into save/load behavior.

### 2) Core simulation logic (`src/core/game`)
The `Game` class is the backbone: it stores tower floors, money, rating, population, people, elevators, and events. It enforces placement rules (bounds, costs, unlocks, floors) and sets up the initial tower. `Room`, `Person`, and `ElevatorCar` are the core simulation entities.

### 3) Rendering pipeline (`src/core/render/Renderer.ts`)
Rendering is Canvas-based. The renderer handles camera scrolling, drawing floors/rooms/shafts, and translating mouse positions to grid cells so the UI can place rooms accurately.

### 4) UI system (`src/ui/UI.ts`)
`UI.ts` builds the tool palette from `roomTypes`, wires up time controls, and translates user clicks into room placements via the `Game` API. It’s also the integration point for save/export/import UI.

### 5) Data-driven room definitions (`src/data/roomTypes.ts`)
Room configuration (costs, sizes, unlocks, special rules) lives in one data table. Gameplay balance and new room types are largely defined here.

### 6) Persistence (`src/storage/storage.ts`)
Game state is saved to localStorage and can be exported/imported via base64. If you add new game state, keep the save schema in sync.

### 7) Shared types (`src/types/types.ts`)
The game’s core types (room, event, elevator, role, etc.) live here. Update these types first when introducing new systems.

## Practical Pointers

- **Start small:** change a room cost or size in `roomTypes` to see how it affects gameplay.
- **Rendering tweaks:** if you add a new visual element, begin in `Renderer.ts` and follow the existing drawing patterns.
- **Simulation features:** new rules or events should be anchored in `Game.ts` so they can be tested and rendered consistently.
- **UI features:** extend `UI.ts` for new controls, then wire to `Game` APIs.

## Suggested Next Learning Steps

1. **Read the `Game` loop and placement validation** to understand how the game is structured.
2. **Trace UI -> Game interactions** to see how player actions translate into simulation changes.
3. **Review tests in `src/tests/`** to see expected behaviors and learn how to add new tests.
4. **Look at `Renderer` internals** to understand coordinate transformations and drawing order.

## Development Commands

```
npm run dev       # Start dev server with HMR
npm run build     # Build production bundle
npm run preview   # Preview production build
npm run lint      # Run ESLint
npm run typecheck # TypeScript type checking
npm run test      # Run tests
```
