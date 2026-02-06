# SimTower - GitHub Copilot Build

A browser-playable tower simulation inspired by the public mechanics of the 1994 classic, implemented with original code and assets.

## Architecture Outline

- **index.html**
  - UI shell with stats, build toolbar, canvas viewport, and status panels.
- **style.css**
  - Visual language, responsive layout, and UI styling.
- **main.js**
  - App bootstrap, ties together simulation, renderer, and UI.
- **data.js**
  - Room definitions, costs, stats, unlocks, and categories.
- **sim.js**
  - Core simulation: time, economy, people, elevators, events, rating.
- **render.js**
  - Canvas renderer with floor grid, room blocks, elevators, and day/night lighting.
- **ui.js**
  - DOM controls, tool selection, panels, and input handling.

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

1. Open `github-copilot/index.html` in a modern browser.
2. Select a room from the Construction panel.
3. **Left-click** the tower grid to place rooms and build upward/downward.
4. **Right-click** construction sites to cancel and get a partial refund.
5. Residences require support (a building below them).
6. Use time controls to pause or speed up the simulation.

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
