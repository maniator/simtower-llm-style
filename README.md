# SimTower LLM Style

A tower building simulation game built with GitHub Copilot and AI-assisted development. Inspired by the classic SimTower (1994).

## 🎮 Game Overview

SimTower is a business simulation game where you design and manage a high-rise building tower. Balance construction costs, revenue generation, and tenant satisfaction to maximize your tower's star rating.

### Core Features

- **Building Management** - Construct apartments, offices, shops, restaurants, hotels, elevators, and more
- **Economics System** - Manage finances through income from various room types and maintenance costs
- **Population Simulation** - Watch residents and workers move through your tower
- **Rating System** - Achieve higher star ratings by meeting tenant needs
- **Time Controls** - Play, pause, and fast-forward the game simulation
- **Save/Export** - Save your progress and export/import game states

### Room Types

**Residential:**
- Condo - Compact housing
- Apartment - Standard residential
- Hotel Room - Temporary housing

**Commercial:**
- Office - Corporate workspace
- Fast Food - Quick service dining
- Restaurant - Fine dining
- Retail Shop - Shopping space

**Infrastructure:**
- Lobby - Building entrance
- Stairs - Cost-effective vertical access
- Standard/Express/Service Elevators - Premium transportation
- Metro Station - Mass transit access

**Entertainment & Services:**
- Movie Theater - Entertainment and income
- Party Room - Event space
- Security Office - Crime prevention
- Medical Clinic - Emergency services
- Janitorial - Cleanliness maintenance
- Parking - Vehicle storage

## 🚀 Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev      # Start dev server with HMR
npm run build    # Build production bundle
npm run preview  # Preview production build
```

### Testing & Quality

```bash
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix linting issues
npm run typecheck      # TypeScript type checking
npm run test:coverage  # Run tests with coverage report
```

## 📁 Project Structure

```
src/
├── app/
│   └── main.ts          # Application entry point
├── core/
│   ├── audio/
│   │   └── AudioSynth.ts      # Web Audio API integration
│   ├── game/
│   │   ├── Game.ts            # Game simulation engine
│   │   ├── Room.ts            # Room/building logic
│   │   ├── Person.ts          # NPC simulation
│   │   └── ElevatorCar.ts     # Elevator movement
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

## 🛠️ Tech Stack

- **Language**: TypeScript 5.6 (strict mode)
- **Bundler**: Vite 7.3
- **Testing**: Vitest 4.0 with v8 coverage
- **Linting**: ESLint 9.39 with TypeScript/Prettier support
- **Rendering**: HTML5 Canvas 2D
- **Audio**: Web Audio API

## 📝 Development Notes

### Code Quality
- TypeScript strict mode enabled
- ESLint with TypeScript support
- Prettier code formatting
- 70 unit tests with 67% coverage

### Performance Optimization
- Vite with native ES modules
- Minified production build ~34KB gzipped
- Canvas-based rendering for smooth performance
- Path aliases for clean imports (@core, @data, @types, etc.)

### Build Output
- Production bundle: 33.93 kB (gzipped)
- CSS: 5.35 kB
- JavaScript: 33.93 kB

## 🔄 Continuous Integration

GitHub Actions workflow runs on every push and PR:
- Linting (ESLint)
- Type checking (TypeScript)
- Unit tests with coverage
- Production build verification

## 🎯 Game Mechanics

### Simulation Loop
- Time advances in 1-minute intervals (base 220ms)
- Rooms generate income every hour
- NPCs spawn and travel throughout the tower
- Elevators transport people between floors
- Player rating updates based on metrics

### Economic Balance
- Construction costs range from 4K (stairs) to 90K (metro)
- Daily income scales with traffic and room capacity
- Maintenance costs for all active rooms
- Strategic placement affects profitability

### NPC Simulation
- Workers travel to offices during work hours
- Residents move in/out based on capacity
- Hotel guests stay temporarily
- Entertainment seekers during evening hours
- Optional staff service elevator preference

## 📈 Achievements & Ratings

Increase your tower's star rating by:
1. **Star 1** - Base rating
2. **Star 2** - Population ≥ 60
3. **Star 3** - Population ≥ 140, wait time ≤ 18 min
4. **Star 4** - Population ≥ 240, wait time ≤ 14 min, clean
5. **Star 5** - Population ≥ 320, wait time ≤ 10 min, happiness ≥ 80%, successful VIP visit

## 🎨 Visual Design

- Hand-crafted color palette for room categories
- Real-time person movement visualization
- Elevator car capacity indicators
- Construction progress feedback
- Day/night lighting cycle

## 📚 Additional Information

- Installed with clean npm dependencies
- No external game frameworks or engines
- Raw Canvas 2D API for rendering
- Game state managed through TypeScript classes
- Pure functions for game logic testing

---

Built with GitHub Copilot AI-assisted development for learning and demonstration purposes.

