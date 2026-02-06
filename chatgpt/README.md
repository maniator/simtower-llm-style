# TowerSim (SimTower-inspired, browser-only)

This is an original tower simulation game inspired by classic tower sims.
It includes:
- Grid-based construction across floors (including basements)
- Room categories with costs, maintenance, revenue, noise, traffic, happiness impact
- A 1–5 star rating system that unlocks new facilities
- People simulation (residents, workers, shoppers, hotel guests, service staff)
- Elevator system with queues, capacity, multiple elevator types, and AI
- Events and disasters (VIP visits, fires, breakdowns, crime, medical, complaints)
- 24-hour day/night cycle that affects traffic and lighting

All visuals are procedural and original.

## How to run
Because ES modules are used, you need a local web server (not file://).

### Python
```bash
python -m http.server 8080
```
Open: http://localhost:8080

### Node
```bash
npx serve .
```

## Controls
- Left click: place (when a build tool is selected) or select a room/shaft
- Right click or ESC: cancel build tool
- Drag: pan camera
- Mouse wheel: zoom
- Time controls: pause / play / fast

## Extending
- Add new rooms in `engine/RoomTypes.js` and include them in `BuildMenu`
- Add new events in `engine/Events.js`
- Adjust thresholds/scoring in `engine/Sim.js`
- Improve elevator dispatch in `engine/ElevatorSystem.js`
