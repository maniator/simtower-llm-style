# SimTower - GitHub Copilot Build

A browser-playable tower simulation inspired by the public mechanics of the 1994 classic, implemented with TypeScript for type safety and maintainability.

## Architecture Outline

- **index.html**
  - UI shell with stats, build toolbar, canvas viewport, and status panels.
- **style.css**
  - Visual language, responsive layout, and UI styling.
- **main.ts**
  - App bootstrap, ties together simulation, renderer, and UI.
- **data.ts**
  - Room definitions, costs, stats, unlocks, and categories with strict typing.
- **sim.ts**
  - Core simulation: time, economy, people, elevators, events, rating.
- **render.ts**
  - Canvas renderer with floor grid, room blocks, elevators, and day/night lighting.
- **ui.ts**
  - DOM controls, tool selection, panels, and input handling.
- **audio.ts**
  - Procedural sound synthesis using Web Audio API.
- **types.ts**
  - Shared type definitions and interfaces for the entire application.

## TypeScript Build Setup

This project uses TypeScript with strict type checking enabled. All source files are in TypeScript (`.ts`) and compile to JavaScript in the `dist/` folder.

### Prerequisites

- Node.js (for npm)

### Build Commands

```bash
# Install dependencies
npm install

# Build once
npm run build

# Watch mode (rebuild on changes)
npm run watch

# Type check only (no build)
npm run typecheck
```

### Compiler Options

- **Target**: ES2020
- **Module**: ES2020
- **Strict mode**: Enabled with all strict flags
- **Output**: `dist/` folder with source maps and declaration files

## Design Decisions

- **Canvas rendering** for a dense grid of rooms, moving elevators, and smooth scrolling without DOM overhead.
- **Hour-based economy** to keep the simulation readable while still reacting to traffic and events.
- **Simplified population simulation** that still models distinct roles, routines, and elevator usage.
- **Event system** that interacts with services and influences happiness/rating, including VIP evaluations.

## Systems Implemented

- **Tower growth and rating**: 1-5 star system driven by population, wait times, happiness, and VIP success.
- **Construction rules**: grid placement, costs, build time, ground/basement rules, and unlock gating.
- **Room categories**: residential, commercial, hotel, entertainment, services, infrastructure.
- **People simulation**: residents, workers, shoppers, hotel guests, and staff with daily timing.
- **Elevator system**: standard, express, and service cars with queues and capacity.
- **Traffic and happiness**: wait times, events, cleanliness, noise, and congestion.
- **Events and disasters**: VIP visits, fires, breakdowns, crime, medical events, and complaints.
- **Day/night cycle**: 24-hour loop with lighting changes.
- **Audio feedback**: Procedurally generated retro-style sounds using Web Audio API:
  - Build sounds for construction starts and completions
  - Population gain chimes
  - VIP arrival fanfares
  - Error buzzes

## How To Run

1. **Build the project**:
   ```bash
   npm install
   npm run build
   ```
2. Open `github-copilot/index.html` in a modern browser (or use a local web server).
3. Select a room from the Construction panel.
4. **Left-click** the tower grid to place rooms and build upward/downward.
5. **Right-click** construction sites to cancel and get a partial refund.
6. Residences require support (a building below them).
7. Use time controls to pause or speed up the simulation.

## How To Extend

- Add room types in **data.js** with costs and stats.
- Extend behaviors in **sim.js** (new roles, events, schedules).
- Tweak visuals in **render.js** (colors, overlays, labels).
- Add UI panels or tools in **ui.js** and **index.html**.

## Future Expansion Ideas

- Dedicated elevator shafts spanning multiple floors.
- Room upgrades, renovations, and tenant requests.
- Emergency services and multi-floor incidents.
- More granular noise propagation and zoning.
- Expanded finance: loans, taxes, marketing.
