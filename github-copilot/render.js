const CATEGORY_COLORS = {
  Infrastructure: "#2d6e6a",
  Residential: "#c4684d",
  Commercial: "#f2b34a",
  Hotel: "#7c89a8",
  Entertainment: "#5f7c5e",
  Services: "#a5724a",
};

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.cellSize = 18;
    this.floorHeight = 26;
    this.padding = 40;
    this.camera = { y: 0 };
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  scroll(deltaY) {
    this.camera.y = this.camera.y + deltaY;
    this.camera.y = Math.max(
      this.game.minFloor - 2,
      Math.min(this.camera.y, this.game.maxFloor + 2),
    );
  }

  screenToCell(x, y) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const localX = x - canvasRect.left;
    const localY = y - canvasRect.top;
    const cellX = Math.floor((localX - this.padding) / this.cellSize);
    const floorIndex = Math.floor(
      (this.canvas.height / (window.devicePixelRatio || 1) -
        localY -
        this.padding) /
        this.floorHeight +
        this.camera.y,
    );
    return { cellX, floorIndex };
  }

  floorBaseY(floorIndex) {
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    return (
      height - this.padding - (floorIndex - this.camera.y) * this.floorHeight
    );
  }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#f9f0dd";
    ctx.fillRect(0, 0, width, height);

    const dayPhase = (this.game.time / 1440) * Math.PI * 2;
    const darkness = 0.45 - 0.45 * Math.cos(dayPhase);
    if (darkness > 0.05) {
      ctx.fillStyle = `rgba(27, 33, 48, ${darkness.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }

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
        const color = CATEGORY_COLORS[room.type.category] || "#999";
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
