// Simple tower sim – version 1

const GRID_WIDTH = 20;
const INITIAL_FLOORS = 10; // includes ground and basements
const TICK_MS = 200; // base tick
const FAST_MULTIPLIER = 4;

const ROOM_TYPES = {
  apartment: { name: "Apartment", cost: 500, incomePerDay: 50, pop: 3 },
  office: { name: "Office", cost: 800, incomePerDay: 90, pop: 4 },
  shop: { name: "Shop", cost: 700, incomePerDay: 80, pop: 0 },
  restaurant: { name: "Restaurant", cost: 1000, incomePerDay: 120, pop: 0 },
  hotel: { name: "Hotel Room", cost: 900, incomePerDay: 110, pop: 2 },
  lobby: { name: "Lobby", cost: 300, incomePerDay: 0, pop: 0 },
  elevator: { name: "Elevator Shaft", cost: 400, incomePerDay: 0, pop: 0 },
};

class Room {
  constructor(type, floorIndex, x) {
    this.type = type;
    this.floorIndex = floorIndex;
    this.x = x;
  }
}

class Person {
  constructor(id, floorIndex, x) {
    this.id = id;
    this.floorIndex = floorIndex;
    this.x = x;
    this.targetFloor = floorIndex;
    this.state = "idle"; // idle, moving, waitingElevator, inElevator
    this.elevator = null;
  }
}

class ElevatorCar {
  constructor(shaftX) {
    this.shaftX = shaftX;
    this.currentFloor = 0;
    this.direction = 0; // -1 up, 1 down, 0 idle
    this.passengers = [];
    this.queueFloors = new Set();
  }
}

class GameState {
  constructor() {
    this.money = 5000;
    this.population = 0;
    this.rating = 1;
    this.day = 1;
    this.minuteOfDay = 6 * 60; // start at 06:00
    this.paused = false;
    this.speedMultiplier = 1;

    this.floors = []; // floorIndex 0 = ground, positive up, negative down
    this.rooms = []; // list of Room
    this.people = [];
    this.elevators = [];

    this.selectedBuildType = null;

    this.initTower();
  }

  initTower() {
    // floors: 0..INITIAL_FLOORS-1 (0 ground, above only for simplicity)
    for (let i = 0; i < INITIAL_FLOORS; i++) {
      this.floors.push({ index: i, tiles: new Array(GRID_WIDTH).fill(null) });
    }
    // Add a ground lobby and elevator shaft
    const mid = Math.floor(GRID_WIDTH / 2);
    this.placeRoom("lobby", 0, mid - 1, false);
    this.placeRoom("elevator", 0, mid, false);
    this.addElevator(mid);
  }

  placeRoom(type, floorIndex, x, pay = true) {
    const floor = this.floors[floorIndex];
    if (!floor || floor.tiles[x]) return false;
    const def = ROOM_TYPES[type];
    if (!def) return false;
    if (pay && this.money < def.cost) return false;

    floor.tiles[x] = new Room(type, floorIndex, x);
    this.rooms.push(floor.tiles[x]);
    if (pay) this.money -= def.cost;
    this.recalculatePopulation();
    return true;
  }

  addElevator(shaftX) {
    this.elevators.push(new ElevatorCar(shaftX));
  }

  recalculatePopulation() {
    let pop = 0;
    for (const r of this.rooms) {
      pop += ROOM_TYPES[r.type].pop || 0;
    }
    this.population = pop;
  }

  tick() {
    if (this.paused) return;

    // advance time
    const minutesPerTick = 10 * this.speedMultiplier;
    this.minuteOfDay += minutesPerTick;
    if (this.minuteOfDay >= 24 * 60) {
      this.minuteOfDay -= 24 * 60;
      this.day++;
      this.dailyIncome();
    }

    // spawn people based on time
    this.spawnPeople();

    // move people
    this.updatePeople();

    // update elevators
    this.updateElevators();

    // update rating
    this.updateRating();

    // update UI
    render();
  }

  dailyIncome() {
    let income = 0;
    for (const r of this.rooms) {
      const def = ROOM_TYPES[r.type];
      if (def.incomePerDay) income += def.incomePerDay;
    }
    this.money += income;
  }

  spawnPeople() {
    const hour = Math.floor(this.minuteOfDay / 60);
    // simple rule: more people during 8–20
    if (hour >= 8 && hour <= 20) {
      if (Math.random() < 0.3) {
        const id = this.people.length
          ? this.people[this.people.length - 1].id + 1
          : 1;
        const lobbyFloor = 0;
        const lobbyX = this.floors[0].tiles.findIndex(
          (t) => t && t.type === "lobby",
        );
        const p = new Person(id, lobbyFloor, lobbyX >= 0 ? lobbyX : 0);
        // choose random target floor with a room
        const candidateRooms = this.rooms.filter(
          (r) => r.floorIndex !== lobbyFloor,
        );
        if (candidateRooms.length > 0) {
          const target =
            candidateRooms[Math.floor(Math.random() * candidateRooms.length)];
          p.targetFloor = target.floorIndex;
        }
        this.people.push(p);
      }
    }
  }

  updatePeople() {
    for (const p of this.people) {
      if (p.state === "idle") {
        if (p.floorIndex !== p.targetFloor) {
          // go to elevator
          const elevator = this.elevators[0];
          if (!elevator) continue;
          const dx = Math.sign(elevator.shaftX - p.x);
          if (dx !== 0) {
            p.x += dx * 0.2;
          } else {
            p.state = "waitingElevator";
            elevator.queueFloors.add(p.floorIndex);
          }
        } else {
          // maybe leave tower
          if (Math.random() < 0.01) {
            p._remove = true;
          }
        }
      } else if (p.state === "inElevator") {
        // position handled by elevator
      } else if (p.state === "waitingElevator") {
        // just wait
      }
    }
    this.people = this.people.filter((p) => !p._remove);
  }

  updateElevators() {
    for (const e of this.elevators) {
      // simple logic: if idle and queue exists, move toward nearest queued floor
      if (e.direction === 0 && e.queueFloors.size > 0) {
        let nearest = null;
        let bestDist = Infinity;
        for (const f of e.queueFloors) {
          const d = Math.abs(f - e.currentFloor);
          if (d < bestDist) {
            bestDist = d;
            nearest = f;
          }
        }
        if (nearest !== null) {
          e.direction = nearest > e.currentFloor ? 1 : -1;
        }
      }

      // move elevator
      if (e.direction !== 0) {
        e.currentFloor += e.direction * 0.1;
        // snap to floor when close
        const nearestFloor = Math.round(e.currentFloor);
        if (Math.abs(e.currentFloor - nearestFloor) < 0.05) {
          e.currentFloor = nearestFloor;
          // stop if this floor was queued
          if (e.queueFloors.has(nearestFloor)) {
            e.queueFloors.delete(nearestFloor);
            e.direction = 0;
            this.handleElevatorStop(e, nearestFloor);
          }
        }
      }
    }
  }

  handleElevatorStop(elevator, floorIndex) {
    // board waiting people
    for (const p of this.people) {
      if (
        p.state === "waitingElevator" &&
        Math.round(p.floorIndex) === floorIndex
      ) {
        if (elevator.passengers.length < 6) {
          p.state = "inElevator";
          p.elevator = elevator;
          elevator.passengers.push(p);
        }
      }
    }
    // drop off passengers
    elevator.passengers = elevator.passengers.filter((p) => {
      if (p.targetFloor === floorIndex) {
        p.state = "idle";
        p.elevator = null;
        p.floorIndex = floorIndex;
        return false;
      }
      // keep passenger, add target floor to queue
      elevator.queueFloors.add(p.targetFloor);
      return true;
    });
  }

  updateRating() {
    // very simple: based on population and money
    let stars = 1;
    if (this.population > 30) stars = 2;
    if (this.population > 80) stars = 3;
    if (this.population > 150) stars = 4;
    if (this.population > 250) stars = 5;
    this.rating = stars;
  }

  getTimeString() {
    const hour = Math.floor(this.minuteOfDay / 60);
    const min = this.minuteOfDay % 60;
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return `Day ${this.day}, ${pad(hour)}:${pad(min)}`;
  }
}

// --- Global game state and UI wiring ---

const game = new GameState();
const rootEl = document.getElementById("game-root");
const moneyEl = document.getElementById("money");
const popEl = document.getElementById("population");
const ratingEl = document.getElementById("rating");
const timeEl = document.getElementById("time");
const infoPanel = document.getElementById("info-panel");

let tickHandle = null;

function buildTowerDOM() {
  rootEl.innerHTML = "";
  rootEl.style.width = GRID_WIDTH * 24 + "px";
  rootEl.style.height = game.floors.length * 24 + "px";

  for (let f = game.floors.length - 1; f >= 0; f--) {
    const floor = game.floors[f];
    const row = document.createElement("div");
    row.className = "floor-row";
    row.dataset.floorIndex = f;

    for (let x = 0; x < GRID_WIDTH; x++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.floorIndex = f;
      tile.dataset.x = x;
      const room = floor.tiles[x];
      if (room) {
        tile.classList.add("room-" + room.type);
      }
      tile.addEventListener("click", () => onTileClick(f, x));
      row.appendChild(tile);
    }
    rootEl.appendChild(row);
  }
}

function renderPeople() {
  // remove old
  const old = rootEl.querySelectorAll(".person");
  old.forEach((e) => e.remove());

  for (const p of game.people) {
    const floorIndex = Math.round(p.floorIndex);
    const rowIndexFromTop = game.floors.length - 1 - floorIndex;
    const row = rootEl.children[rowIndexFromTop];
    if (!row) continue;
    const tileIndex = Math.round(p.x);
    const tile = row.children[tileIndex];
    if (!tile) continue;
    const personEl = document.createElement("div");
    personEl.className = "person";
    tile.appendChild(personEl);
  }
}

function renderElevators() {
  const old = rootEl.querySelectorAll(".elevator-car");
  old.forEach((e) => e.remove());

  for (const e of game.elevators) {
    const car = document.createElement("div");
    car.className = "elevator-car";
    const floorIndex = e.currentFloor;
    const rowIndexFromTop = game.floors.length - 1 - floorIndex;
    car.style.left = e.shaftX * 24 + "px";
    car.style.bottom = floorIndex * 24 + "px";
    rootEl.appendChild(car);
  }
}

function render() {
  buildTowerDOM();
  renderPeople();
  renderElevators();

  moneyEl.textContent = Math.floor(game.money);
  popEl.textContent = game.population;
  ratingEl.textContent = `${game.rating}★`;
  timeEl.textContent = game.getTimeString();
}

function onTileClick(floorIndex, x) {
  const floor = game.floors[floorIndex];
  const room = floor.tiles[x];
  if (game.selectedBuildType) {
    const success = game.placeRoom(game.selectedBuildType, floorIndex, x);
    if (!success) {
      infoPanel.innerHTML = `<p>Cannot build here or insufficient funds.</p>`;
    } else {
      infoPanel.innerHTML = `<p>Built ${ROOM_TYPES[game.selectedBuildType].name} on floor ${floorIndex}.</p>`;
    }
    render();
  } else if (room) {
    const def = ROOM_TYPES[room.type];
    infoPanel.innerHTML = `
      <p><strong>${def.name}</strong></p>
      <p>Floor: ${floorIndex}</p>
      <p>Income/day: ${def.incomePerDay}</p>
      <p>Population capacity: ${def.pop}</p>
    `;
  } else {
    infoPanel.innerHTML = `<p>Empty tile on floor ${floorIndex}.</p>`;
  }
}

// Build buttons
document.querySelectorAll(".build-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const type = btn.dataset.room;
    game.selectedBuildType = type;
    infoPanel.innerHTML = `<p>Building: ${ROOM_TYPES[type].name}</p>`;
  });
});

// Time controls
document.getElementById("pause-btn").addEventListener("click", () => {
  game.paused = true;
});

document.getElementById("play-btn").addEventListener("click", () => {
  game.paused = false;
  game.speedMultiplier = 1;
});

document.getElementById("fast-btn").addEventListener("click", () => {
  game.paused = false;
  game.speedMultiplier = FAST_MULTIPLIER;
});

// Main loop
function startLoop() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => game.tick(), TICK_MS);
}

render();
startLoop();
