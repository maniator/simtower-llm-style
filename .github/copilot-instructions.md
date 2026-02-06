# Copilot Instructions

## Project Context

This is **SimTower LLM Style** - a collection of tower building simulation games created with AI-assisted development. The project contains three independent implementations showcasing different LLM approaches.

## Code Organization

### Core Structure (all implementations)
- **HTML files** - Game UI, controls, canvas/DOM for rendering
- **main.js** - Game simulation engine with:
  - Game state management (money, population, rating, time)
  - Room and building logic
  - Person/population simulation
  - Event handling and user interactions
  - Rendering and animation
- **style.css** - Visual styling, layout, and responsive design

### Key Game Objects
- `Room` - Represents a buildable room with type, cost, income, and population metrics
- `Person` - Represents inhabitants moving through the tower
- `Floor` - Array-based representation of tower structure
- Game state variables: `money`, `population`, `rating`, `day`, `hour`

## Development Guidelines

### When Adding Features

1. **Game Mechanics**: Modify core logic in `main.js`
   - Update ROOM_TYPES for new room configurations
   - Extend Room/Person classes for new behaviors
   - Add simulation logic to game tick/update functions

2. **UI Updates**: Modify `index.html` and `style.css`
   - Keep controls intuitive and visible
   - Update stat displays when game state changes
   - Maintain responsive design

3. **Consistency**: Maintain similar structure across all three implementations if making cross-implementation updates

### Best Practices

- **Game Balance**: Consider click cost vs. daily income ratio when adjusting room values
- **Performance**: Keep tick timing (~200ms base) for smooth simulation
- **User Feedback**: Provide visual feedback for building placement and monetary transactions
- **Accessibility**: Include meaningful labels for buttons and game elements

## Common Tasks

### Adding a New Room Type
1. Add entry to `ROOM_TYPES` object with: `name`, `cost`, `incomePerDay`, `pop`
2. Add corresponding build button in HTML
3. Add CSS styling if needed
4. Update room handling logic in main.js

### Adjusting Game Speed
- Modify `TICK_MS` constant (base tick interval)
- Adjust `FAST_MULTIPLIER` for fast-forward speed

### Modifying Game Economy
- Edit ROOM_TYPES values for cost/income balance
- Adjust starting money if needed
- Modify rating calculation thresholds

### Improving Graphics/UI
- Edit CSS in style.css (avoid hardcoded values when possible)
- Update HTML structure if adding new UI elements
- Ensure changes maintain mobile responsiveness

## Testing Checklist

- [ ] All buttons are clickable and functional
- [ ] Game state updates correctly (money, population, time)
- [ ] No console errors during gameplay
- [ ] Buildings can be placed and generate income
- [ ] Time controls (pause, play, fast) work as expected
- [ ] UI is readable on different screen sizes
- [ ] Population increases/decreases appropriately
- [ ] Rating system reflects tower status

## Resources & Context

- Original SimTower (1994) inspired this project
- Three implementations use different AI assistants - check each folder for variations
- Consult the main README.md for project overview
- Game tick: ~200ms per in-game update cycle

## Asking for Help

When requesting assistance:
- Specify which implementation (copilot, gemini, github-copilot) you're working on
- Include the specific behavior or feature you're implementing
- Reference the game's economic balance if economy-related
- Describe the user experience you're targeting

---

*These instructions optimize AI-assisted development for maintaining and extending SimTower implementations.*
