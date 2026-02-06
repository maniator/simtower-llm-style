import type { Game } from "@core/game/Game.ts";
import type {
  RoomCategory,
  Camera,
  CellPosition,
  RoomType,
} from "@appTypes/types.ts";

const CATEGORY_COLORS: Record<RoomCategory, string> = {
  Infrastructure: "#2d6e6a",
  Residential: "#c4684d",
  Commercial: "#f2b34a",
  Hotel: "#7c89a8",
  Entertainment: "#5f7c5e",
  Services: "#a5724a",
};

const PERSON_COLORS: Record<string, string> = {
  worker: "#2d6e6a",
  shopper: "#f2b34a",
  guest: "#7c89a8",
  hotel: "#7c89a8",
  resident: "#c4684d",
  staff: "#a5724a",
  vip: "#b3261e",
};

export class Renderer {
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private game: Game;
  private cellSize: number;
  private floorHeight: number;
  private padding: number;
  private viewWidth: number;
  private viewHeight: number;
  public camera: Camera;
  private ghost: {
    type: RoomType;
    floorIndex: number;
    startX: number;
    valid: boolean;
  } | null;

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D rendering context");
    this.ctx = ctx;
    this.game = game;
    this.cellSize = 18;
    this.floorHeight = 26;
    this.padding = 40;
    this.viewWidth = 0;
    this.viewHeight = 0;
    this.camera = { y: 0 };
    this.ghost = null;
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    const rect = parent
      ? parent.getBoundingClientRect()
      : this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.viewWidth = rect.width;
    this.viewHeight = rect.height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public scroll(deltaY: number): void {
    this.camera.y = this.camera.y + deltaY;
    this.camera.y = Math.max(
      this.game.minFloor - 2,
      Math.min(this.camera.y, this.game.maxFloor + 2),
    );
  }

  public screenToCell(x: number, y: number): CellPosition {
    const canvasRect = this.canvas.getBoundingClientRect();
    const localX = x - canvasRect.left;
    const localY = y - canvasRect.top;
    const viewHeight = this.viewHeight || canvasRect.height;
    const cellX = Math.floor((localX - this.padding) / this.cellSize);
    const floorIndex = Math.floor(
      (viewHeight - localY - this.padding) / this.floorHeight + this.camera.y,
    );
    return { cellX, floorIndex };
  }

  public setGhost(
    ghost: {
      type: RoomType;
      floorIndex: number;
      startX: number;
      valid: boolean;
    } | null,
  ): void {
    this.ghost = ghost;
  }

  private floorBaseY(floorIndex: number): number {
    return (
      this.viewHeight -
      this.padding -
      (floorIndex - this.camera.y) * this.floorHeight
    );
  }

  public render(): void {
    const ctx = this.ctx;
    const width = this.viewWidth;
    const height = this.viewHeight;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#f9f0dd";
    ctx.fillRect(0, 0, width, height);

    const dayPhase = (this.game.time / 1440) * Math.PI * 2;
    const darkness = 0.45 - 0.45 * Math.cos(dayPhase);
    if (darkness > 0.05) {
      ctx.fillStyle = `rgba(27, 33, 48, ${darkness.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }

    const buildLeft = this.padding;
    const buildRight = this.padding + this.game.width * this.cellSize;

    ctx.fillStyle = "rgba(28, 26, 23, 0.04)";
    ctx.fillRect(0, 0, buildLeft, height);
    ctx.fillRect(buildRight, 0, width - buildRight, height);

    ctx.strokeStyle = "rgba(28, 26, 23, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(buildLeft, 0);
    ctx.lineTo(buildLeft, height);
    ctx.moveTo(buildRight, 0);
    ctx.lineTo(buildRight, height);
    ctx.stroke();

    const floorStart = Math.floor(this.camera.y - 2);
    const floorEnd = Math.floor(this.camera.y + height / this.floorHeight) + 2;

    ctx.strokeStyle = "rgba(28, 26, 23, 0.15)";
    ctx.lineWidth = 1;

    for (let floorIndex = floorStart; floorIndex <= floorEnd; floorIndex += 1) {
      const y = this.floorBaseY(floorIndex);
      ctx.beginPath();
      ctx.moveTo(this.padding, y);
      ctx.lineTo(width - this.padding, y);
      ctx.stroke();
    }

    // Draw shaft extensions (vertical lines connecting multiple floors)
    const shaftPositions = new Map<number, number>(); // startX -> minFloor
    for (const floor of this.game.floors.values()) {
      for (const room of floor.rooms) {
        if (room.type.shaft && room.active) {
          if (
            !shaftPositions.has(room.startX) ||
            shaftPositions.get(room.startX)! > floor.index
          ) {
            shaftPositions.set(room.startX, floor.index);
          }
        }
      }
    }

    ctx.save();
    ctx.strokeStyle = "rgba(28, 26, 23, 0.15)";
    ctx.lineWidth = this.cellSize * 0.5;
    for (const [startX, minFloor] of shaftPositions.entries()) {
      const shaftX =
        this.padding + startX * this.cellSize + this.cellSize * 0.5;
      const topY = this.floorBaseY(
        Math.min(...Array.from(this.game.floors.keys())),
      );
      const bottomY = this.floorBaseY(minFloor) - this.floorHeight;
      ctx.beginPath();
      ctx.moveTo(shaftX, topY);
      ctx.lineTo(shaftX, bottomY);
      ctx.stroke();
    }
    ctx.restore();

    for (const floor of this.game.floors.values()) {
      const y = this.floorBaseY(floor.index);
      if (y < -50 || y > height + 50) continue;
      for (const room of floor.rooms) {
        const category = room.type.category;
        const color = CATEGORY_COLORS[category] || "#999";
        const roomX = this.padding + room.startX * this.cellSize;
        const roomY = y - this.floorHeight + 4;
        const roomWidth = room.type.width * this.cellSize;
        const roomHeight = this.floorHeight - 8;

        if (room.type.shaft) {
          const shaftX = roomX + this.cellSize * 0.2;
          const shaftWidth = this.cellSize * 0.6;
          ctx.save();
          ctx.globalAlpha = room.active ? 0.45 : 0.3;
          ctx.fillStyle = "rgba(28, 26, 23, 0.25)";
          ctx.fillRect(shaftX, roomY, shaftWidth, roomHeight);
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = "rgba(28, 26, 23, 0.6)";
          ctx.strokeRect(shaftX, roomY, shaftWidth, roomHeight);
          ctx.restore();
          continue;
        }

        ctx.fillStyle = color;
        ctx.globalAlpha = room.active ? 0.95 : 0.55;
        ctx.fillRect(roomX, roomY, roomWidth, roomHeight);

        if (!room.active) {
          const constructionPercent =
            1 - room.buildRemaining / room.type.buildTime;
          const progressWidth = roomWidth * constructionPercent;
          ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
          ctx.fillRect(roomX, roomY, progressWidth, roomHeight);
        }

        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(28, 26, 23, 0.3)";
        ctx.strokeRect(roomX, roomY, roomWidth, roomHeight);

        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = "11px 'Space Grotesk', sans-serif";
        ctx.fillText(room.type.name, roomX + 4, roomY + roomHeight / 1.6);
      }
    }

    if (this.ghost) {
      const ghost = this.ghost;
      const y = this.floorBaseY(ghost.floorIndex);
      if (!(y < -60 || y > height + 60)) {
        const roomX = this.padding + ghost.startX * this.cellSize;
        const roomY = y - this.floorHeight + 4;
        const roomWidth = ghost.type.width * this.cellSize;
        const roomHeight = this.floorHeight - 8;
        const category = ghost.type.category;
        const color = CATEGORY_COLORS[category] || "#999";

        ctx.save();
        ctx.globalAlpha = ghost.valid ? 0.35 : 0.2;
        ctx.fillStyle = ghost.valid ? color : "#b3261e";
        ctx.fillRect(roomX, roomY, roomWidth, roomHeight);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = ghost.valid
          ? "rgba(28, 26, 23, 0.55)"
          : "rgba(179, 38, 30, 0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(roomX, roomY, roomWidth, roomHeight);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    const waitingPeople = this.game.people.filter(
      (person) => person.state === "waiting",
    );
    if (waitingPeople.length > 0) {
      ctx.save();
      for (let i = 0; i < waitingPeople.length; i += 1) {
        const person = waitingPeople[i];
        const y = this.floorBaseY(person.origin);
        if (y < -40 || y > height + 40) continue;
        const floor = this.game.floors.get(person.origin);
        const baseY = y - this.floorHeight + 12;
        const color = PERSON_COLORS[person.role] || "#2d6e6a";
        ctx.fillStyle = color;
        ctx.beginPath();

        // Distribute people across the actual room widths on the floor
        let baseX: number;
        if (floor && floor.rooms.length > 0) {
          // Get total width of all rooms on this floor
          let totalWidth = 0;
          const roomWidths: number[] = [];
          for (const room of floor.rooms) {
            if (!room.type.shaft) {
              roomWidths.push(room.type.width * this.cellSize);
              totalWidth += room.type.width * this.cellSize;
            }
          }

          // Position person within rooms based on their index
          if (totalWidth > 0) {
            const positionRatio =
              (i % waitingPeople.length) / Math.max(1, waitingPeople.length);
            let accum = 0;
            let personX = this.padding + 8;
            for (let j = 0; j < floor.rooms.length; j += 1) {
              const room = floor.rooms[j];
              if (!room.type.shaft) {
                const roomStart = this.padding + room.startX * this.cellSize;
                const roomWidth = room.type.width * this.cellSize;
                accum += roomWidth;
                if (positionRatio * totalWidth < accum) {
                  personX =
                    roomStart + roomWidth * 0.1 + (i % 4) * (roomWidth * 0.2);
                  break;
                }
              }
            }
            baseX = personX;
          } else {
            baseX = this.padding + 8 + (i % 8) * 5;
          }
        } else {
          baseX = this.padding + 8 + (i % 8) * 5;
        }

        ctx.arc(baseX, baseY, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      const lobbyY = this.floorBaseY(0);
      if (!(lobbyY < -40 || lobbyY > height + 40)) {
        ctx.save();
        for (let i = 0; i < 4; i += 1) {
          const offset = this.game.time / 6 + i;
          const baseX = this.padding + 10 + i * 8 + Math.sin(offset) * 2.5;
          const baseY = lobbyY - this.floorHeight + 12 + Math.cos(offset) * 1.5;
          ctx.fillStyle = "#2d6e6a";
          ctx.beginPath();
          ctx.arc(baseX, baseY, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    for (const car of this.game.elevators) {
      const shaftX = this.padding + car.shaftX * this.cellSize;
      const y = this.floorBaseY(car.position);
      const carY = y - this.floorHeight + 6;
      const carWidth = this.cellSize - 4;
      const carHeight = this.floorHeight - 12;
      const color =
        car.type === "express"
          ? "#264653"
          : car.type === "service"
            ? "#7b4f2f"
            : "#2d6e6a";

      ctx.fillStyle = color;
      ctx.fillRect(shaftX + 2, carY, carWidth, carHeight);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.strokeRect(shaftX + 2, carY, carWidth, carHeight);

      if (car.passengers.length > 0) {
        ctx.save();
        for (let i = 0; i < car.passengers.length; i += 1) {
          const passenger = car.passengers[i];
          const dotX = shaftX + 6 + (i % 2) * 6;
          const dotY = carY + 6 + Math.floor(i / 2) * 6;
          const color = PERSON_COLORS[passenger.role] || "#2d6e6a";
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }
}

