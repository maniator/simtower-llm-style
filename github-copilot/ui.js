const formatPercent = (value) => `${Math.round(value)}%`;

export class UI {
  constructor(game, renderer, roomTypes, categoryOrder, audio) {
    this.game = game;
    this.renderer = renderer;
    this.roomTypes = roomTypes;
    this.categoryOrder = categoryOrder;
    this.audio = audio;
    this.selectedRoomId = "lobby";
    this.hoverRoom = null;
    this.lastPopulation = 0;

    this.moneyEl = document.getElementById("money");
    this.populationEl = document.getElementById("population");
    this.happinessEl = document.getElementById("happiness");
    this.ratingEl = document.getElementById("rating");
    this.infoPanel = document.getElementById("info-panel");
    this.elevatorPanel = document.getElementById("elevator-panel");
    this.toolCategories = document.getElementById("tool-categories");
    this.statusText = document.getElementById("status-text");
    this.timeIndicator = document.getElementById("time-indicator");
  }

  init() {
    this.buildToolbar();
    this.bindTimeControls();
    this.bindCanvasControls();
    this.setSelectedTool(this.selectedRoomId);
    this.updatePanels();
  }

  buildToolbar() {
    this.toolCategories.innerHTML = "";
    for (const category of this.categoryOrder) {
      const categoryRooms = Object.values(this.roomTypes).filter(
        (room) => room.category === category,
      );
      if (categoryRooms.length === 0) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "tool-category";
      const heading = document.createElement("h3");
      heading.textContent = category;
      wrapper.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "tool-grid";
      for (const room of categoryRooms) {
        const button = document.createElement("button");
        button.className = "tool-btn";
        button.dataset.room = room.id;
        button.innerHTML = `${room.name}<small>$${room.cost.toLocaleString("en-US")}</small>`;
        button.addEventListener("click", () => this.setSelectedTool(room.id));
        grid.appendChild(button);
      }
      wrapper.appendChild(grid);
      this.toolCategories.appendChild(wrapper);
    }
  }

  bindTimeControls() {
    const buttons = document.querySelectorAll(".time-btn");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        buttons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        const speed = Number(button.dataset.speed);
        this.game.speed = speed;
        this.game.paused = speed === 0;
      });
    });
  }

  bindCanvasControls() {
    const canvas = this.renderer.canvas;
    canvas.addEventListener("click", (event) => {
      const { cellX, floorIndex } = this.renderer.screenToCell(
        event.clientX,
        event.clientY,
      );
      const room = this.roomTypes[this.selectedRoomId];
      if (!room) return;
      if (cellX < 0) return;

      const result = this.game.placeRoom(
        this.selectedRoomId,
        floorIndex,
        cellX,
        false,
      );
      if (result.ok) {
        this.audio.uiClick();
        this.statusText.textContent = `${room.name} construction started.`;
      } else {
        this.audio.buildFail();
        this.statusText.textContent = result.reason;
      }
    });

    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const { cellX, floorIndex } = this.renderer.screenToCell(
        event.clientX,
        event.clientY,
      );
      const result = this.game.removeRoom(floorIndex, cellX);
      if (result.ok) {
        this.audio.buildFail();
        this.statusText.textContent = `Room removed. Refund: ${result.refund || 0}`;
      } else {
        this.statusText.textContent = result.reason;
      }
    });

    canvas.addEventListener("mousemove", (event) => {
      const { cellX, floorIndex } = this.renderer.screenToCell(
        event.clientX,
        event.clientY,
      );
      const floor = this.game.floors.get(floorIndex);
      if (!floor || cellX < 0 || cellX >= this.game.width) {
        this.hoverRoom = null;
        return;
      }
      this.hoverRoom = floor.cells[cellX] || null;
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const delta = Math.sign(event.deltaY) * 0.6;
        this.renderer.scroll(delta);
      },
      { passive: false },
    );
  }

  setSelectedTool(roomId) {
    const room = this.roomTypes[roomId];
    if (!room) return;
    if (room.unlock > this.game.rating) {
      this.statusText.textContent = `Unlock ${room.name} at ${room.unlock}-star rating.`;
      return;
    }
    this.selectedRoomId = roomId;
    const buttons = document.querySelectorAll(".tool-btn");
    buttons.forEach((button) => {
      button.classList.toggle("active", button.dataset.room === roomId);
    });
    this.updatePanels();
  }

  updateHUD() {
    const prevPopulation = this.lastPopulation;
    this.lastPopulation = this.game.population;

    this.moneyEl.textContent = this.game.formatMoney();
    this.populationEl.textContent =
      this.game.population.toLocaleString("en-US");
    this.happinessEl.textContent = formatPercent(this.game.happiness);
    this.ratingEl.textContent = `${this.game.rating} Star${this.game.rating > 1 ? "s" : ""}`;
    this.timeIndicator.textContent = this.game.getTimeLabel();

    if (this.game.population > prevPopulation && prevPopulation > 0) {
      this.audio.populationGain();
    }

    if (this.game.statusMessage) {
      this.statusText.textContent = this.game.statusMessage;
      if (this.game.statusMessage.includes("construction started")) {
        this.audio.buildComplete();
      }
      if (this.game.statusMessage.includes("VIP")) {
        this.audio.vipArrival();
      }
      this.game.statusMessage = "";
    }

    this.updateToolLocks();
    this.updatePanels();
  }

  updateToolLocks() {
    const buttons = document.querySelectorAll(".tool-btn");
    buttons.forEach((button) => {
      const room = this.roomTypes[button.dataset.room];
      if (!room) return;
      const locked = room.unlock > this.game.rating;
      button.disabled = locked;
      button.title = locked ? `Unlock at ${room.unlock}-star rating.` : "";
    });
  }

  updatePanels() {
    const selected = this.roomTypes[this.selectedRoomId];
    const infoRoom = this.hoverRoom?.type || selected;

    if (infoRoom) {
      this.infoPanel.innerHTML = `
        <h3>${infoRoom.name}</h3>
        <p>Category: ${infoRoom.category}</p>
        <p>Cost: $${infoRoom.cost.toLocaleString("en-US")}</p>
        <p>Maintenance: $${infoRoom.maintenance}/hr</p>
        <p>Revenue: $${infoRoom.revenue}/hr</p>
        <p>Noise: ${infoRoom.noise} | Traffic: ${infoRoom.traffic}</p>
      `;
    }

    const elevatorRows = this.game.elevators
      .map((car, index) => {
        const direction = car.direction > 0 ? "Up" : "Down";
        return `<p>#${index + 1} ${car.type} | Floor ${car.position.toFixed(1)} | ${direction} | ${car.passengers.length}/${car.capacity}</p>`;
      })
      .join("");

    this.elevatorPanel.innerHTML = `
      <h3>Elevators</h3>
      ${elevatorRows || "<p>No elevators yet.</p>"}
      <p>Avg wait: ${this.game.averageWait()} min</p>
      <p>Events: ${this.game.events.length}</p>
    `;
  }
}
