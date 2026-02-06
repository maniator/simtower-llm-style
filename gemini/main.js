/**
 * OPENTOWER - Main Simulation Logic
 * A simplified browser-based tower sim.
 */

/* ================= CONFIGURATION ================= */
const CONSTANTS = {
  CELL_SIZE: 16, // Pixels per grid unit (zoomed out style)
  FLOOR_HEIGHT: 3, // Grid units
  ROOM_WIDTH_STD: 4, // Grid units
  TICKS_PER_HOUR: 60, // Game ticks per in-game hour
  STARTING_MONEY: 200000,
  MAX_FLOORS: 100,
  GROUND_FLOOR_Y: 80, // Offset in grid units
  COLORS: {
    SKY_DAY: "#87CEEB",
    SKY_NIGHT: "#0C1445",
    DIRT: "#5D4037",
    LOBBY: "#95a5a6",
    OFFICE: "#3498db",
    CONDO: "#2ecc71",
    HOTEL: "#f1c40f",
    FOOD: "#e67e22",
    ELEVATOR: "#c0392b",
    SHAFT: "#7f8c8d",
    STAIRS: "#bdc3c7",
    AGENT: "#e74c3c",
  },
};

/* ================= ROOM DEFINITIONS ================= */
const ROOM_TYPES = {
  floor: { w: 1, h: 1, cost: 500, name: "Structure", type: "infra" },
  lobby: { w: 4, h: 3, cost: 2000, name: "Lobby", type: "infra" },
  stairs: { w: 2, h: 3, cost: 500, name: "Stairs", type: "transport" },
  elevator: {
    w: 2,
    h: 3,
    cost: 20000,
    name: "Elevator",
    type: "transport_mech",
  },
  office: {
    w: 4,
    h: 1,
    cost: 4000,
    income: 500,
    name: "Office",
    type: "commercial",
    capacity: 6,
  },
  condo: {
    w: 6,
    h: 1,
    cost: 8000,
    income: 200,
    name: "Condo",
    type: "residential",
    capacity: 3,
  },
  hotel: {
    w: 4,
    h: 1,
    cost: 5000,
    income: 300,
    name: "Hotel Room",
    type: "hotel",
    capacity: 2,
  },
  food: {
    w: 6,
    h: 1,
    cost: 10000,
    income: 800,
    name: "Fast Food",
    type: "commercial",
    capacity: 20,
  },
  housekeeping: {
    w: 4,
    h: 1,
    cost: 15000,
    name: "Housekeeping",
    type: "service",
  },
};

/* ================= CORE CLASSES ================= */

class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.width = this.canvas.width = this.canvas.offsetWidth;
    this.height = this.canvas.height = this.canvas.offsetHeight;

    this.funds = CONSTANTS.STARTING_MONEY;
    this.population = 0;
    this.rating = 1;

    // Time System
    this.ticks = 0;
    this.hour = 8;
    this.minute = 0;
    this.day = 1;
    this.speed = 1; // 0=pause, 1=normal, 5=fast
    this.isNight = false;

    // Game Objects
    this.grid = new Map(); // Key: "x,y", Value: RoomObject
    this.agents = [];
    this.elevators = [];
    this.rooms = []; // Linear list for update loops

    // Viewport (Camera)
    this.camera = {
      x: 0,
      y: -(CONSTANTS.GROUND_FLOOR_Y * CONSTANTS.CELL_SIZE) + this.height / 2,
    };
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };

    // Tools
    this.selectedTool = "lobby";

    this.initInput();
    this.initUI();

    // Initial Ground
    this.buildInitialGround();

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  buildInitialGround() {
    // Build a lobby at 0,0 (Logical Ground Floor)
    this.buildRoom("lobby", 0, 0);
  }

  // --- LOGIC LOOP ---
  update() {
    if (this.speed === 0) return;

    // Time logic
    for (let s = 0; s < this.speed; s++) {
      this.ticks++;
      if (this.ticks >= 60 / this.speed) {
        this.ticks = 0;
        this.minute += 1;
        if (this.minute >= 60) {
          this.minute = 0;
          this.hour++;
          this.hourlyUpdates();
        }
        if (this.hour >= 24) {
          this.hour = 0;
          this.day++;
          this.dailyUpdates();
        }
      }

      // Update Agents
      this.agents.forEach((agent) => agent.update(this));

      // Update Elevators
      this.elevators.forEach((elev) => elev.update(this));
    }

    // Lighting
    this.isNight = this.hour >= 20 || this.hour < 6;
    this.updateUI();
  }

  hourlyUpdates() {
    // Spawn agents based on rooms
    if (this.hour === 8 || this.hour === 9) this.commuteIn();
    if (this.hour === 17 || this.hour === 18) this.commuteOut();
  }

  dailyUpdates() {
    // Collect Rent / Pay Maintenance
    let dailyIncome = 0;
    this.rooms.forEach((room) => {
      if (room.def.income) dailyIncome += room.def.income;
    });
    this.funds += dailyIncome;

    // Check Rating
    this.checkRating();
  }

  commuteIn() {
    // Create workers for offices
    this.rooms.forEach((room) => {
      if (room.def.type === "commercial" && Math.random() > 0.5) {
        // Spawn agent at lobby, target this room
        let agent = new Agent(0, 0, room);
        this.agents.push(agent);
      }
    });
  }

  commuteOut() {
    // Workers go home (despawn at lobby)
    this.agents.forEach((agent) => {
      if (agent.state === "working") {
        agent.goHome();
      }
    });
  }

  checkRating() {
    // Simplified Logic
    if (this.population > 20) this.rating = 2;
    if (this.population > 50 && this.elevators.length > 1) this.rating = 3;
    if (this.population > 100) this.rating = 4;
    if (this.population > 200 && this.funds > 1000000) this.rating = 5;
  }

  // --- CONSTRUCTION ---
  buildRoom(type, gridX, gridY) {
    const def = ROOM_TYPES[type];

    // Check funds
    if (this.funds < def.cost) return;

    // Collision Check (Simplified)
    let collision = false;
    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        if (this.grid.has(`${gridX + x},${gridY + y}`)) collision = true;
      }
    }
    if (collision) return;

    // Deduct Funds
    this.funds -= def.cost;

    // Create Room Object
    const room = {
      type: type,
      def: def,
      x: gridX,
      y: gridY,
      id: Math.random().toString(36).substr(2, 9),
    };

    // Add to Grid
    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        this.grid.set(`${gridX + x},${gridY + y}`, room);
      }
    }

    this.rooms.push(room);

    // Special Logic
    if (type === "elevator") {
      const el = new Elevator(gridX, gridY, def.h, room);
      this.elevators.push(el);
    }

    // Add Capacity to Pop (just a stat here)
    if (def.capacity) this.population += def.capacity;
  }

  // --- RENDERING ---
  draw() {
    // Clear Background
    this.ctx.fillStyle = this.isNight
      ? CONSTANTS.COLORS.SKY_NIGHT
      : CONSTANTS.COLORS.SKY_DAY;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.save();
    // Apply Camera
    this.ctx.translate(
      this.camera.x + this.width / 2,
      this.camera.y + this.height / 2,
    );

    // Draw Ground Line
    this.ctx.fillStyle = CONSTANTS.COLORS.DIRT;
    const groundY = CONSTANTS.GROUND_FLOOR_Y * CONSTANTS.CELL_SIZE;
    this.ctx.fillRect(
      -5000,
      groundY + CONSTANTS.FLOOR_HEIGHT * CONSTANTS.CELL_SIZE,
      10000,
      500,
    );

    // Draw Rooms
    this.rooms.forEach((room) => {
      const px = room.x * CONSTANTS.CELL_SIZE;
      const py = (CONSTANTS.GROUND_FLOOR_Y - room.y) * CONSTANTS.CELL_SIZE; // Invert Y for visual up

      // Color Mapping
      let color = "#ccc";
      if (CONSTANTS.COLORS[room.def.type.toUpperCase()])
        color = CONSTANTS.COLORS[room.def.type.toUpperCase()];
      if (room.type === "elevator") color = CONSTANTS.COLORS.SHAFT;
      if (room.type === "office") color = CONSTANTS.COLORS.OFFICE;
      if (room.type === "condo") color = CONSTANTS.COLORS.CONDO;
      if (room.type === "lobby") color = CONSTANTS.COLORS.LOBBY;

      this.ctx.fillStyle = color;
      this.ctx.fillRect(
        px,
        py - room.def.h * CONSTANTS.CELL_SIZE,
        room.def.w * CONSTANTS.CELL_SIZE,
        room.def.h * CONSTANTS.CELL_SIZE,
      );

      // Border
      this.ctx.strokeStyle = "rgba(0,0,0,0.2)";
      this.ctx.strokeRect(
        px,
        py - room.def.h * CONSTANTS.CELL_SIZE,
        room.def.w * CONSTANTS.CELL_SIZE,
        room.def.h * CONSTANTS.CELL_SIZE,
      );
    });

    // Draw Agents
    this.ctx.fillStyle = CONSTANTS.COLORS.AGENT;
    this.agents.forEach((agent) => {
      const px = agent.x * CONSTANTS.CELL_SIZE;
      const py = (CONSTANTS.GROUND_FLOOR_Y - agent.y) * CONSTANTS.CELL_SIZE;
      this.ctx.fillRect(px + 4, py - 12, 8, 12); // Simple sprite
    });

    // Draw Elevator Cars
    this.elevators.forEach((el) => {
      const px = el.x * CONSTANTS.CELL_SIZE;
      const py = (CONSTANTS.GROUND_FLOOR_Y - el.y) * CONSTANTS.CELL_SIZE;
      this.ctx.fillStyle = CONSTANTS.COLORS.ELEVATOR;
      this.ctx.fillRect(
        px + 2,
        py - CONSTANTS.FLOOR_HEIGHT * CONSTANTS.CELL_SIZE + 2,
        el.roomRef.def.w * CONSTANTS.CELL_SIZE - 4,
        CONSTANTS.FLOOR_HEIGHT * CONSTANTS.CELL_SIZE - 4,
      );
    });

    this.ctx.restore();
  }

  loop() {
    this.update();
    this.draw();
    requestAnimationFrame(this.loop);
  }

  // --- INPUT & UI ---
  initInput() {
    // Mouse Drag (Pan)
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1 || e.shiftKey) {
        // Middle click or Shift+Click to Pan
        this.isDragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      } else {
        // Click to Build
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left - this.width / 2 - this.camera.x;
        const my = e.clientY - rect.top - this.height / 2 - this.camera.y;

        // Convert to Grid
        const gx = Math.floor(mx / CONSTANTS.CELL_SIZE);
        // Inverse logic for Y to make 0 ground and + goes up
        const base = CONSTANTS.GROUND_FLOOR_Y * CONSTANTS.CELL_SIZE;
        const gy = Math.floor((base - my) / CONSTANTS.CELL_SIZE);

        // Snap to floor height
        const floorIdx = Math.floor(gy / CONSTANTS.FLOOR_HEIGHT);
        const snappedY = floorIdx * CONSTANTS.FLOOR_HEIGHT;

        this.buildRoom(this.selectedTool, gx, snappedY);
      }
    });

    window.addEventListener("mouseup", () => (this.isDragging = false));
    window.addEventListener("mousemove", (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.camera.x += dx;
        this.camera.y += dy;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });
  }

  initUI() {
    const tools = document.querySelectorAll(".tool-btn");
    tools.forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelector(".tool-btn.selected")
          .classList.remove("selected");
        btn.classList.add("selected");
        this.selectedTool = btn.dataset.type;
        document.getElementById("status-bar").innerText =
          `Tool: ${btn.dataset.type} ($${btn.dataset.cost})`;
      });
    });

    document.getElementById("btn-pause").onclick = () => (this.speed = 0);
    document.getElementById("btn-play").onclick = () => (this.speed = 1);
    document.getElementById("btn-fast").onclick = () => (this.speed = 5);
  }

  updateUI() {
    document.getElementById("ui-funds").innerText =
      `$${this.funds.toLocaleString()}`;
    document.getElementById("ui-pop").innerText = this.population;
    let stars = "★".repeat(this.rating) + "☆".repeat(5 - this.rating);
    document.getElementById("ui-stars").innerText = stars;

    const ampm = this.hour >= 12 ? "PM" : "AM";
    const dispH = this.hour % 12 || 12;
    const dispM = this.minute < 10 ? "0" + this.minute : this.minute;
    document.getElementById("ui-time").innerText =
      `Day ${this.day} - ${dispH}:${dispM} ${ampm}`;
  }
}

/* ================= AGENT SYSTEM ================= */
class Agent {
  constructor(startX, startY, targetRoom) {
    this.x = startX;
    this.y = startY;
    this.targetRoom = targetRoom;
    this.state = "commuting"; // commuting, waiting_elevator, in_elevator, working, going_home
    this.targetFloor = targetRoom.y;
    this.elevator = null;
    this.color = CONSTANTS.COLORS.AGENT;
  }

  update(game) {
    const speed = 0.2; // Walking speed

    // 1. Commuting to Work logic
    if (this.state === "commuting") {
      // If on same floor as target
      if (Math.abs(this.y - this.targetFloor) < 0.1) {
        // Walk to room
        if (this.x < this.targetRoom.x) this.x += speed;
        else if (this.x > this.targetRoom.x) this.x -= speed;

        // Arrived?
        if (Math.abs(this.x - this.targetRoom.x) < 1) {
          this.state = "working";
        }
      } else {
        // Need Elevator? Find nearest shaft
        // Simplified: walk to X=0 (lobby/shaft center)
        // In full version: scan game.rooms for type 'elevator' on this floor
        if (Math.abs(this.x - 0) > 1) {
          if (this.x < 0) this.x += speed;
          else this.x -= speed;
        } else {
          this.state = "waiting_elevator";
          // Signal elevator system
          this.callElevator(game);
        }
      }
    }

    // 2. Waiting
    if (this.state === "waiting_elevator") {
      // Wait for elevator instance to pick up
    }

    // 3. In Elevator (position controlled by elevator)
    if (this.state === "in_elevator") {
      this.x = this.elevator.x;
      this.y = this.elevator.y;
      if (Math.abs(this.y - this.targetFloor) < 0.1) {
        this.state = "commuting"; // Step out and walk to room
        this.elevator = null;
      }
    }

    // 4. Going Home
    if (this.state === "going_home") {
      this.targetFloor = 0; // Ground
      this.state = "commuting";
      if (this.y === 0 && Math.abs(this.x) < 2) {
        // Despawn
        game.agents = game.agents.filter((a) => a !== this);
      }
    }
  }

  callElevator(game) {
    // Find an elevator that serves this floor
    // Simplified: Pick first elevator
    if (game.elevators.length > 0) {
      game.elevators[0].request(this.y, this.targetFloor);
      // In a real system, we would add to a queue on the floor object
    }
  }

  goHome() {
    this.state = "going_home";
    this.targetFloor = 0;
  }
}

/* ================= ELEVATOR SYSTEM ================= */
class Elevator {
  constructor(x, y, height, roomRef) {
    this.x = x;
    this.y = y; // Current Y (floats allowed for smooth movement)
    this.roomRef = roomRef; // The shaft structure
    this.targetY = y;
    this.requests = []; // List of floors to visit
    this.passengers = [];
    this.state = "idle"; // idle, moving, loading
    this.timer = 0;
  }

  request(fromFloor, toFloor) {
    if (!this.requests.includes(fromFloor)) this.requests.push(fromFloor);
    // Note: In a real sim, we wouldn't know 'toFloor' until passenger enters
    if (!this.requests.includes(toFloor)) this.requests.push(toFloor);
    this.requests.sort((a, b) => a - b); // Simple sorting
  }

  update(game) {
    const speed = 0.1;

    if (this.state === "idle") {
      if (this.requests.length > 0) {
        this.targetY = this.requests[0]; // Pick first request
        this.state = "moving";
      }
    }

    if (this.state === "moving") {
      if (this.y < this.targetY) this.y += speed;
      else if (this.y > this.targetY) this.y -= speed;

      // Arrived
      if (Math.abs(this.y - this.targetY) < speed) {
        this.y = this.targetY;
        this.state = "loading";
        this.timer = 60; // Wait 1 second

        // Pickup Agents waiting here
        game.agents.forEach((a) => {
          if (a.state === "waiting_elevator" && Math.abs(a.y - this.y) < 0.5) {
            a.state = "in_elevator";
            a.elevator = this;
            this.passengers.push(a);
          }
        });

        // Remove this floor from requests
        this.requests = this.requests.filter((r) => Math.abs(r - this.y) > 0.5);
      }
    }

    if (this.state === "loading") {
      this.timer--;
      if (this.timer <= 0) {
        this.state = "idle";
      }
    }
  }
}

// Start Game
window.onload = () => {
  const game = new Game();
};
