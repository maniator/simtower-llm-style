import type { Game } from "./sim";
import type { RoomCategory, Camera, CellPosition, RoomType } from "./types";

const CATEGORY_COLORS: Record<RoomCategory, string> = {
  Infrastructure: "#2d6e6a",
  Residential: "#c4684d",
  Commercial: "#f2b34a",
  Hotel: "#7c89a8",
  Entertainment: "#5f7c5e",
  Services: "#a5724a",
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

    for (const floor of this.game.floors.values()) {
      const y = this.floorBaseY(floor.index);
      if (y < -50 || y > height + 50) continue;
      for (const room of floor.rooms) {
        const category = room.type.category as RoomCategory;
        const color = CATEGORY_COLORS[category] || "#999";
        const roomX = this.padding + room.startX * this.cellSize;
        const roomY = y - this.floorHeight + 4;
        const roomWidth = room.type.width * this.cellSize;
        const roomHeight = this.floorHeight - 8;

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
        const category = ghost.type.category as RoomCategory;
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
    }
  }
}
