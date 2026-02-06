import type { Game } from "@core/game/Game.ts";
import type { Renderer } from "@core/render/Renderer.ts";
import type { AudioSynth } from "@core/audio/AudioSynth.ts";
import type {
  RoomType,
  RoomCategory,
  IRoom,
  CellPosition,
} from "@types/types.ts";
import {
  saveGame,
  clearSave,
  exportGame,
  importGame,
} from "@storage/storage.ts";

const formatPercent = (value: number): string => `${Math.round(value)}%`;

export class UI {
  private game: Game;
  private renderer: Renderer;
  private roomTypes: Readonly<Record<string, RoomType>>;
  private categoryOrder: readonly RoomCategory[];
  private audio: AudioSynth;
  private selectedRoomId: string;
  private hoverRoom: IRoom | null;
  private hoverCell: CellPosition | null;
  private lastPopulation: number;

  private moneyEl: HTMLElement;
  private populationEl: HTMLElement;
  private happinessEl: HTMLElement;
  private ratingEl: HTMLElement;
  private infoPanel: HTMLElement;
  private elevatorPanel: HTMLElement;
  private toolCategories: HTMLElement;
  private statusText: HTMLElement;
  private timeIndicator: HTMLElement;

  constructor(
    game: Game,
    renderer: Renderer,
    roomTypes: Readonly<Record<string, RoomType>>,
    categoryOrder: readonly RoomCategory[],
    audio: AudioSynth,
  ) {
    this.game = game;
    this.renderer = renderer;
    this.roomTypes = roomTypes;
    this.categoryOrder = categoryOrder;
    this.audio = audio;
    this.selectedRoomId = "lobby";
    this.hoverRoom = null;
    this.hoverCell = null;
    this.lastPopulation = 0;

    this.moneyEl = this.getElement("money");
    this.populationEl = this.getElement("population");
    this.happinessEl = this.getElement("happiness");
    this.ratingEl = this.getElement("rating");
    this.infoPanel = this.getElement("info-panel");
    this.elevatorPanel = this.getElement("elevator-panel");
    this.toolCategories = this.getElement("tool-categories");
    this.statusText = this.getElement("status-text");
    this.timeIndicator = this.getElement("time-indicator");
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Element with id '${id}' not found`);
    return element;
  }

  public init(): void {
    this.buildToolbar();
    this.bindTimeControls();
    this.bindCanvasControls();
    this.setSelectedTool(this.selectedRoomId);
    this.updatePanels();
  }

  private buildToolbar(): void {
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

  private bindTimeControls(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>(".time-btn");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        buttons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        const speed = Number(button.dataset.speed);
        this.game.speed = speed;
        this.game.paused = speed === 0;
      });
    });

    const resetBtn = document.getElementById("reset-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (
          confirm(
            "Are you sure you want to start a new game? All progress will be lost.",
          )
        ) {
          clearSave();
          this.game.reset();
          this.renderer.camera.y = 0;
          this.statusText.textContent = "New game started!";
          this.updatePanels();
          saveGame(this.game);
        }
      });
    }

    const exportBtn = document.getElementById("export-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const encoded = exportGame(this.game);
        navigator.clipboard
          .writeText(encoded)
          .then(() => {
            this.statusText.textContent = "Game exported to clipboard!";
            this.audio.uiClick();
          })
          .catch(() => {
            prompt("Copy this save code:", encoded);
          });
      });
    }

    const importBtn = document.getElementById("import-btn");
    if (importBtn) {
      importBtn.addEventListener("click", () => {
        const encoded = prompt("Paste your save code:");
        if (encoded) {
          const success = importGame(this.game, encoded.trim());
          if (success) {
            this.renderer.camera.y = 0;
            this.statusText.textContent = "Game imported successfully!";
            this.updatePanels();
            this.audio.uiClick();
          } else {
            this.statusText.textContent =
              "Failed to import game - invalid code.";
            this.audio.buildFail();
          }
        }
      });
    }
  }

  private bindCanvasControls(): void {
    const canvas = this.renderer.canvas;
    canvas.addEventListener("click", (event: MouseEvent) => {
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
        this.statusText.textContent = result.reason || "Placement failed.";
      }
      this.updateGhostPreview();
    });

    canvas.addEventListener("contextmenu", (event: MouseEvent) => {
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
        this.statusText.textContent = result.reason || "Removal failed.";
      }
      this.updateGhostPreview();
    });

    canvas.addEventListener("mousemove", (event: MouseEvent) => {
      const { cellX, floorIndex } = this.renderer.screenToCell(
        event.clientX,
        event.clientY,
      );
      this.hoverCell = { cellX, floorIndex };
      if (cellX < 0 || cellX >= this.game.width) {
        this.hoverRoom = null;
        this.renderer.setGhost(null);
        return;
      }
      const floor = this.game.floors.get(floorIndex);
      this.hoverRoom = floor ? floor.cells[cellX] : null;
      this.updateGhostPreview();
    });

    canvas.addEventListener("mouseleave", () => {
      this.hoverRoom = null;
      this.hoverCell = null;
      this.renderer.setGhost(null);
    });

    canvas.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        event.preventDefault();
        const delta = Math.sign(event.deltaY) * 0.6;
        this.renderer.scroll(delta);
      },
      { passive: false },
    );
  }

  private setSelectedTool(roomId: string): void {
    const room = this.roomTypes[roomId];
    if (!room) return;
    if (room.unlock > this.game.rating) {
      this.statusText.textContent = `Unlock ${room.name} at ${room.unlock}-star rating.`;
      return;
    }
    this.selectedRoomId = roomId;
    const buttons = document.querySelectorAll<HTMLButtonElement>(".tool-btn");
    buttons.forEach((button) => {
      button.classList.toggle("active", button.dataset.room === roomId);
    });
    this.updateGhostPreview();
    this.updatePanels();
  }

  private updateGhostPreview(): void {
    if (!this.hoverCell) {
      this.renderer.setGhost(null);
      return;
    }
    const room = this.roomTypes[this.selectedRoomId];
    if (!room) {
      this.renderer.setGhost(null);
      return;
    }
    if (this.hoverCell.cellX < 0 || this.hoverCell.cellX >= this.game.width) {
      this.renderer.setGhost(null);
      return;
    }
    const result = this.game.canPlaceRoom(
      room.id,
      this.hoverCell.floorIndex,
      this.hoverCell.cellX,
    );
    this.renderer.setGhost({
      type: room,
      floorIndex: this.hoverCell.floorIndex,
      startX: this.hoverCell.cellX,
      valid: result.ok,
    });
  }

  public updateHUD(): void {
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

  private updateToolLocks(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>(".tool-btn");
    buttons.forEach((button) => {
      const roomId = button.dataset.room;
      if (!roomId) return;
      const room = this.roomTypes[roomId];
      if (!room) return;
      const locked = room.unlock > this.game.rating;
      button.disabled = locked;
      button.title = locked ? `Unlock at ${room.unlock}-star rating.` : "";
    });
  }

  private updatePanels(): void {
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
