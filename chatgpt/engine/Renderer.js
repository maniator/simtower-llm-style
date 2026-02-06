import { clamp } from "./Util.js";
import { RoomTypes, ROOM } from "./RoomTypes.js";

export class Renderer {
  constructor(canvas, sim){
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sim = sim;

    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.resize();

    this.cam = {
      x: 0,
      y: 0,
      zoom: 1.2,
      targetZoom: 1.2,
    };

    this.cellW = 22;
    this.floorH = 18;

    window.addEventListener("resize", () => this.resize());
  }

  resize(){
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
  }

  worldToScreen(wx, wy){
    return {
      x: (wx - this.cam.x) * this.cam.zoom,
      y: (wy - this.cam.y) * this.cam.zoom,
    };
  }

  screenToWorld(sx, sy){
    return {
      x: sx / this.cam.zoom + this.cam.x,
      y: sy / this.cam.zoom + this.cam.y,
    };
  }

  cellToWorld(xCell, floor){
    const originY = 500;
    const wx = 100 + xCell * this.cellW;
    const wy = originY - floor * this.floorH;
    return { wx, wy };
  }

  getCellFromScreen(sx, sy){
    const w = this.screenToWorld(sx, sy);
    const originY = 500;
    const xCell = Math.floor((w.x - 100) / this.cellW);
    const floor = Math.round((originY - w.y) / this.floorH);
    return { xCell, floor };
  }

  draw(buildPreview){
    const ctx = this.ctx;
    const { width, height } = this.canvas.getBoundingClientRect();

    this.cam.zoom += (this.cam.targetZoom - this.cam.zoom) * 0.15;

    ctx.clearRect(0,0,width,height);
    this.drawSky(ctx, width, height);

    const sim = this.sim;
    const tower = sim.tower;

    const topWorld = this.screenToWorld(0, 0).y;
    const bottomWorld = this.screenToWorld(0, height).y;
    const originY = 500;
    const floorTop = Math.floor((originY - topWorld) / this.floorH) + 2;
    const floorBottom = Math.floor((originY - bottomWorld) / this.floorH) - 2;

    const fMin = clamp(floorBottom, tower.floorsMin, tower.floorsMax);
    const fMax = clamp(floorTop, tower.floorsMin, tower.floorsMax);

    for(let f=fMin; f<=fMax; f++){
      this.drawFloorLine(ctx, f, tower.width);
      const arr = tower.rooms.get(f) || [];
      for(const r of arr){
        this.drawRoom(ctx, r);
      }
    }

    this.drawElevators(ctx);
    this.drawPeople(ctx);

    if(buildPreview){
      this.drawPreview(ctx, buildPreview);
    }

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.fillRect(0,0,width,10);
    ctx.restore();
  }

  drawSky(ctx, w, h){
    const t = this.sim.timeOfDay / 1440;
    const noon = Math.cos((t - 0.5) * Math.PI * 2) * -0.5 + 0.5;
    const bright = 0.12 + noon * 0.22;

    ctx.save();
    ctx.fillStyle = `rgb(${Math.floor(10+bright*40)}, ${Math.floor(14+bright*55)}, ${Math.floor(20+bright*75)})`;
    ctx.fillRect(0,0,w,h);

    const night = clamp(1 - noon*1.2, 0, 1);
    if(night > 0.2){
      ctx.globalAlpha = night * 0.5;
      ctx.fillStyle = "#d6f2ff";
      for(let i=0;i<60;i++){
        const x = (i*97)%w;
        const y = (i*53)%Math.floor(h*0.45);
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  drawFloorLine(ctx, floor, widthCells){
    const { wx, wy } = this.cellToWorld(0, floor);
    const s = this.worldToScreen(wx, wy);
    const w = widthCells * this.cellW * this.cam.zoom;

    ctx.save();
    ctx.strokeStyle = "rgba(36,49,73,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + w, s.y);
    ctx.stroke();

    ctx.fillStyle = "rgba(155,176,210,0.75)";
    ctx.font = `${Math.floor(11*this.cam.zoom)}px ui-sans-serif`;
    ctx.fillText(String(floor), s.x - 18, s.y + 4);

    ctx.restore();
  }

  drawRoom(ctx, room){
    const def = RoomTypes[room.type];
    const { wx, wy } = this.cellToWorld(room.x, room.floor);
    const s = this.worldToScreen(wx, wy);

    const w = def.size.w * this.cellW * this.cam.zoom;
    const h = this.floorH * this.cam.zoom;

    let fill = "#1a2333";
    let stroke = "rgba(110,231,255,0.35)";

    if(def.category === "Residential") fill = "#182e2a";
    if(def.category === "Commercial") fill = "#2a2235";
    if(def.category === "Hotel") fill = "#2b2a1a";
    if(def.category === "Entertainment") fill = "#2b1820";
    if(def.category === "Services") fill = "#1c2330";
    if(room.type === ROOM.LOBBY) fill = "#1a2b3a";
    if(room.type === ROOM.ELEVATOR_SHAFT) fill = "#10141a";
    if(room.type === ROOM.STAIRS) fill = "#101a12";

    if(room.state === "building"){
      stroke = "rgba(255,255,255,0.35)";
    } else if(room.state === "broken"){
      stroke = "rgba(255,107,107,0.6)";
    }

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;

    ctx.fillRect(s.x, s.y - h + 1, w, h - 2);
    ctx.strokeRect(s.x + 0.5, s.y - h + 1.5, w - 1, h - 3);

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ffffff";
    for(let i=0;i<Math.floor(w/12);i++){
      const px = s.x + 2 + i*12;
      const py = s.y - h + 3 + ((room.x + room.floor + i) % 3);
      ctx.fillRect(px, py, 2, 2);
    }
    ctx.globalAlpha = 1;

    if(this.cam.zoom > 1.05){
      ctx.fillStyle = "rgba(230,238,252,0.9)";
      ctx.font = `${Math.floor(10*this.cam.zoom)}px ui-sans-serif`;
      ctx.fillText(def.key, s.x + 4, s.y - 5);
    }

    ctx.restore();
  }

  drawElevators(ctx){
    const elev = this.sim.elevators;
    for(const shaft of elev.shafts){
      const x = shaft.x;
      const top = this.sim.tower.floorsMax;
      const bot = this.sim.tower.floorsMin;

      const a = this.worldToScreen(this.cellToWorld(x, top).wx, this.cellToWorld(x, top).wy);
      const b = this.worldToScreen(this.cellToWorld(x, bot).wx, this.cellToWorld(x, bot).wy);

      ctx.save();
      ctx.strokeStyle = "rgba(155,176,210,0.25)";
      ctx.beginPath();
      ctx.moveTo(a.x + this.cam.zoom*10, a.y);
      ctx.lineTo(b.x + this.cam.zoom*10, b.y);
      ctx.stroke();

      const car = shaft.car;
      const { wx, wy } = this.cellToWorld(x, car.y);
      const s = this.worldToScreen(wx, wy);
      const cw = this.cellW * this.cam.zoom;
      const ch = this.floorH * this.cam.zoom;

      let col = "rgba(110,231,255,0.85)";
      if(shaft.type === "express") col = "rgba(125,255,155,0.8)";
      if(shaft.type === "service") col = "rgba(255,224,110,0.8)";
      if(car.broken) col = "rgba(255,107,107,0.9)";

      ctx.fillStyle = col;
      ctx.fillRect(s.x + cw*0.15, s.y - ch + 3, cw*0.7, ch - 6);

      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#000";
      ctx.fillRect(s.x + cw*0.15, s.y - ch + 3, cw*0.7, 3);
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  drawPeople(ctx){
    const people = this.sim.people.allPeople();
    for(const p of people){
      const baseX = 1 + (p.id.charCodeAt(0) % 20);
      const { wx, wy } = this.cellToWorld(baseX, p.floor);
      const s = this.worldToScreen(wx, wy);

      ctx.save();
      let col = "rgba(230,238,252,0.75)";
      if(p.kind.includes("Resident")) col = "rgba(110,231,255,0.8)";
      if(p.kind.includes("Worker")) col = "rgba(155,176,210,0.8)";
      if(p.kind.includes("Shopper")) col = "rgba(255,224,110,0.75)";
      if(p.kind.includes("Guest")) col = "rgba(125,255,155,0.75)";
      if(p.kind.includes("Staff")) col = "rgba(255,160,200,0.75)";
      ctx.fillStyle = col;

      const r = Math.max(1.2, 2.0 * this.cam.zoom * 0.6);
      ctx.beginPath();
      ctx.arc(s.x + 6*this.cam.zoom, s.y - 6*this.cam.zoom, r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawPreview(ctx, prev){
    const { typeKey, floor, x, ok } = prev;
    const def = RoomTypes[typeKey];
    const { wx, wy } = this.cellToWorld(x, floor);
    const s = this.worldToScreen(wx, wy);
    const w = def.size.w * this.cellW * this.cam.zoom;
    const h = this.floorH * this.cam.zoom;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = ok ? "rgba(125,255,155,1)" : "rgba(255,107,107,1)";
    ctx.fillRect(s.x, s.y - h + 1, w, h - 2);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
