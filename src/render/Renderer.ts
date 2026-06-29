import { GRID } from "../engine/facilities";
import type { Simulation } from "../engine/Simulation";
import type { FacilityKind, Unit } from "../engine/types";
import { drawTransport, drawUnit, type DrawCtx } from "./sprites";

export const TILE_W = 9;
export const FLOOR_H = 26;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewFocus {
  centerFloor: number;
  dominant: FacilityKind | "outside" | "lobby" | "empty";
  night: boolean;
}

interface Run {
  kind: "floor" | "lobby";
  x0: number;
  x1: number;
}

/**
 * Canvas renderer. Owns the camera and converts world (tile, floor) ↔ screen.
 * Pure presentation. For speed it buckets units by floor and caches merged
 * structural runs, rebuilding only when the tower changes (tower.revision).
 */
export class Renderer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 40, y: 0, zoom: 1 };
  preview: { kind: FacilityKind; floor: number; x: number; valid: boolean } | null = null;
  transportPreview: { kind: FacilityKind; x: number; bottom: number; top: number; valid: boolean } | null = null;
  /** Unit currently selected for the edit panel (drawn with a highlight). */
  selectedId: number | null = null;

  // Render caches keyed by tower.revision.
  private cacheRev = -1;
  private roomsByFloor = new Map<number, Unit[]>();
  private structByFloor = new Map<number, Run[]>();
  private minF = 1;
  private maxF = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable.");
    this.ctx = ctx;
    this.resize();
    this.cam.x = -(GRID.width * TILE_W) / 2 + (canvas.clientWidth || 960) / 2;
    this.cam.y = (canvas.clientHeight || 600) * 0.78;
  }

  resize(): void {
    const dpr = Math.min(2, (globalThis.devicePixelRatio as number) || 1);
    const w = this.canvas.clientWidth || 960;
    const h = this.canvas.clientHeight || 600;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get viewWidth(): number {
    return this.canvas.clientWidth || 960;
  }
  get viewHeight(): number {
    return this.canvas.clientHeight || 600;
  }

  worldToScreenX(tile: number): number {
    return tile * TILE_W * this.cam.zoom + this.cam.x;
  }
  worldToScreenY(floor: number): number {
    return this.cam.y - floor * FLOOR_H * this.cam.zoom;
  }
  screenToTile(px: number): number {
    return Math.floor((px - this.cam.x) / (TILE_W * this.cam.zoom));
  }
  screenToFloor(py: number): number {
    return Math.floor((this.cam.y - py) / (FLOOR_H * this.cam.zoom)) + 1;
  }

  pan(dx: number, dy: number): void {
    this.cam.x += dx;
    this.cam.y += dy;
    this.clampCamera();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const tile = (sx - this.cam.x) / (TILE_W * this.cam.zoom);
    const floor = (this.cam.y - sy) / (FLOOR_H * this.cam.zoom);
    this.cam.zoom = Math.max(0.35, Math.min(3, this.cam.zoom * factor));
    this.cam.x = sx - tile * TILE_W * this.cam.zoom;
    this.cam.y = sy + floor * FLOOR_H * this.cam.zoom;
    this.clampCamera();
  }

  private clampCamera(): void {
    const minY = this.viewHeight * 0.2;
    this.cam.y = Math.max(minY, Math.min(this.viewHeight + 60, this.cam.y));
    const halfW = (GRID.width * TILE_W * this.cam.zoom);
    this.cam.x = Math.max(-halfW + 80, Math.min(this.viewWidth - 80, this.cam.x));
  }

  private rebuildCache(sim: Simulation): void {
    this.roomsByFloor.clear();
    this.structByFloor.clear();
    this.minF = 1;
    this.maxF = 1;
    // Bucket structural tiles per floor to merge into runs; rooms per floor.
    const structTiles = new Map<number, Map<number, "floor" | "lobby">>();
    for (const u of sim.tower.units) {
      this.minF = Math.min(this.minF, u.floor);
      this.maxF = Math.max(this.maxF, u.floor);
      if (u.kind === "floor" || u.kind === "lobby") {
        let row = structTiles.get(u.floor);
        if (!row) structTiles.set(u.floor, (row = new Map()));
        for (let i = 0; i < u.width; i++) row.set(u.x + i, u.kind);
      } else {
        let arr = this.roomsByFloor.get(u.floor);
        if (!arr) this.roomsByFloor.set(u.floor, (arr = []));
        arr.push(u);
      }
    }
    for (const [floor, row] of structTiles) {
      const xs = [...row.keys()].sort((a, b) => a - b);
      const runs: Run[] = [];
      let start = xs[0];
      let prev = xs[0];
      let kind = row.get(xs[0])!;
      for (let i = 1; i < xs.length; i++) {
        const x = xs[i];
        const k = row.get(x)!;
        if (x === prev + 1 && k === kind) {
          prev = x;
        } else {
          runs.push({ kind, x0: start, x1: prev });
          start = prev = x;
          kind = k;
        }
      }
      runs.push({ kind, x0: start, x1: prev });
      this.structByFloor.set(floor, runs);
    }
    this.cacheRev = sim.tower.revision;
  }

  render(sim: Simulation): void {
    if (sim.tower.revision !== this.cacheRev) this.rebuildCache(sim);
    const ctx = this.ctx;
    const W = this.viewWidth;
    const H = this.viewHeight;
    const night = sim.clock.isNight();
    const lit = night || sim.clock.isEvening();
    const anim = (globalThis.performance ? performance.now() : 0) / 1000;
    const d: DrawCtx = { ctx, lit, anim, hour: sim.clock.hour };

    this.drawSky(sim, W, H, night);
    this.drawGround(sim);

    // Visible floor range (plus a margin).
    const topF = Math.min(this.maxF + 1, this.screenToFloor(0) + 1);
    const botF = Math.max(this.minF - 1, this.screenToFloor(H) - 1);

    // Structural runs (corridors / lobbies) — cheap merged draws.
    for (let f = botF; f <= topF; f++) {
      const runs = this.structByFloor.get(f);
      if (!runs) continue;
      for (const r of runs) this.drawRun(d, f, r);
    }
    // Rooms.
    for (let f = botF; f <= topF; f++) {
      const arr = this.roomsByFloor.get(f);
      if (!arr) continue;
      for (const u of arr) this.drawUnitWorld(d, u);
    }

    this.drawTransports(sim);
    this.drawWalkers(sim, botF, topF, anim);
    this.drawSelection(sim);
    this.drawPreview(sim);
    this.drawFloorRuler();
  }

  private drawRun(d: DrawCtx, floor: number, r: Run): void {
    const sx = this.worldToScreenX(r.x0);
    const w = (r.x1 - r.x0 + 1) * TILE_W * this.cam.zoom;
    if (sx + w < 0 || sx > this.viewWidth) return;
    const sy = this.worldToScreenY(floor);
    const h = FLOOR_H * this.cam.zoom;
    const fake: Unit = {
      id: floor * 1000 + r.x0,
      kind: r.kind,
      floor,
      x: r.x0,
      width: r.x1 - r.x0 + 1,
      state: "occupied",
      satisfaction: 1,
      occupants: 0,
      everOccupied: false,
      pendingIncome: 0,
      label: "",
    };
    drawUnit(d, fake, sx, sy, w, h);
  }

  private drawUnitWorld(d: DrawCtx, u: Unit): void {
    const sx = this.worldToScreenX(u.x);
    const w = u.width * TILE_W * this.cam.zoom;
    if (sx + w < 0 || sx > this.viewWidth) return;
    const sy = this.worldToScreenY(u.floor);
    drawUnit(d, u, sx, sy, w, FLOOR_H * this.cam.zoom);
  }

  private drawSky(sim: Simulation, W: number, H: number, night: boolean): void {
    const ctx = this.ctx;
    const hour = sim.clock.hour + sim.clock.minute / 60;
    const t = Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5 + 0.5;
    const top = mix([20, 24, 48], [90, 150, 220], t);
    const bot = mix([40, 44, 80], [180, 215, 245], t);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
    grad.addColorStop(1, `rgb(${bot[0]},${bot[1]},${bot[2]})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const arc = ((hour - 6) / 12) * Math.PI;
    if (night) {
      ctx.fillStyle = "#eef";
      ctx.beginPath();
      ctx.arc(W * 0.82, H * 0.18, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      for (let i = 0; i < 40; i++) {
        ctx.fillRect((i * 9301 + 49297) % W, (i * 233280) % Math.floor(H * 0.5), 1, 1);
      }
    } else {
      ctx.fillStyle = "#fff7c0";
      ctx.beginPath();
      ctx.arc((arc / Math.PI) * W, H * 0.7 - Math.sin(arc) * H * 0.55, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGround(sim: Simulation): void {
    const ctx = this.ctx;
    const groundY = this.worldToScreenY(0);
    ctx.fillStyle = "#3a3326";
    ctx.fillRect(0, groundY, this.viewWidth, this.viewHeight - groundY);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, groundY, this.viewWidth, this.viewHeight - groundY);
    ctx.fillStyle = "#5a7a3a";
    ctx.fillRect(0, groundY, this.viewWidth, Math.max(2, 3 * this.cam.zoom));
    void sim;
  }

  private drawTransports(sim: Simulation): void {
    for (const t of sim.tower.transports) {
      const sx = this.worldToScreenX(t.x);
      const w = t.width * TILE_W * this.cam.zoom;
      if (sx + w < 0 || sx > this.viewWidth) continue;
      drawTransport(this.ctx, t, sx, this.worldToScreenY(t.top), w, FLOOR_H * this.cam.zoom);
    }
  }

  /** People walking along lobbies and busy corridors. */
  private drawWalkers(sim: Simulation, botF: number, topF: number, anim: number): void {
    if (this.cam.zoom < 0.55) return; // skip when zoomed far out
    const ctx = this.ctx;
    const h = FLOOR_H * this.cam.zoom;
    const busy = sim.clock.isMorning() || sim.clock.isEvening() || sim.clock.isLunch();
    const colors = ["#2a2f3e", "#5a3a3a", "#3a4a5a", "#4a3a52", "#3a4a3a"];
    for (let f = botF; f <= topF; f++) {
      const runs = this.structByFloor.get(f);
      if (!runs) continue;
      const sy = this.worldToScreenY(f) + h - 5 * this.cam.zoom;
      for (const r of runs) {
        const isLobby = r.kind === "lobby";
        if (!isLobby && !busy) continue;
        const x0 = this.worldToScreenX(r.x0);
        const widthPx = (r.x1 - r.x0 + 1) * TILE_W * this.cam.zoom;
        if (x0 + widthPx < 0 || x0 > this.viewWidth) continue;
        const density = isLobby ? (busy ? 0.5 : 0.28) : 0.16;
        const count = Math.min(40, Math.floor((widthPx / 10) * density));
        for (let i = 0; i < count; i++) {
          const seed = (f * 131 + r.x0 * 7 + i * 53) | 0;
          const speed = 8 + (seed % 7);
          const dir = seed % 2 === 0 ? 1 : -1;
          let px = ((i / count) * widthPx + dir * anim * speed) % widthPx;
          if (px < 0) px += widthPx;
          const sx = x0 + px;
          ctx.fillStyle = colors[seed % colors.length];
          ctx.fillRect(sx, sy - 4, 2, 4);
          ctx.fillStyle = "#e8c9a0";
          ctx.fillRect(sx, sy - 5, 2, 1);
        }
      }
    }
  }

  private drawSelection(sim: Simulation): void {
    if (this.selectedId == null) return;
    const u = sim.tower.units.find((x) => x.id === this.selectedId);
    if (!u) return;
    const sx = this.worldToScreenX(u.x);
    const sy = this.worldToScreenY(u.floor);
    const w = u.width * TILE_W * this.cam.zoom;
    const h = FLOOR_H * this.cam.zoom;
    this.ctx.strokeStyle = "#ffd24a";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(sx - 1, sy - 1, w + 2, h + 2);
  }

  private drawPreview(sim: Simulation): void {
    const ctx = this.ctx;
    if (this.preview) {
      const p = this.preview;
      const fac = sim.tower.facilityOf({ kind: p.kind } as never);
      const sx = this.worldToScreenX(p.x);
      const sy = this.worldToScreenY(p.floor);
      const w = fac.width * TILE_W * this.cam.zoom;
      const h = FLOOR_H * this.cam.zoom;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = p.valid ? fac.color : "#cc3333";
      ctx.fillRect(sx, sy, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.valid ? "#ffffff" : "#ff5555";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);
    }
    if (this.transportPreview) {
      const p = this.transportPreview;
      const fac = sim.tower.facilityOf({ kind: p.kind } as never);
      const sx = this.worldToScreenX(p.x);
      const topY = this.worldToScreenY(p.top);
      const w = fac.width * TILE_W * this.cam.zoom;
      const h = (p.top - p.bottom + 1) * FLOOR_H * this.cam.zoom;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = p.valid ? fac.color : "#cc3333";
      ctx.fillRect(sx, topY, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.valid ? "#ffffff" : "#ff5555";
      ctx.strokeRect(sx + 0.5, topY + 0.5, w - 1, h - 1);
    }
  }

  private drawFloorRuler(): void {
    const ctx = this.ctx;
    ctx.font = "10px monospace";
    ctx.textBaseline = "middle";
    const topFloor = this.screenToFloor(0) + 1;
    const botFloor = this.screenToFloor(this.viewHeight) - 1;
    for (let f = botFloor; f <= topFloor; f++) {
      if (f === 0) continue;
      const sy = this.worldToScreenY(f) + (FLOOR_H * this.cam.zoom) / 2;
      if (sy < 12 || sy > this.viewHeight - 2) continue;
      const label = f > 0 ? `${f}` : `B${-f}`;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, sy - 7, 22, 14);
      ctx.fillStyle = f % 15 === 1 ? "#ffd24a" : "#cfcfcf";
      ctx.fillText(label, 3, sy);
    }
    ctx.textBaseline = "alphabetic";
  }

  focus(sim: Simulation): ViewFocus {
    if (sim.tower.revision !== this.cacheRev) this.rebuildCache(sim);
    const centerFloor = this.screenToFloor(this.viewHeight / 2);
    const night = sim.clock.isNight();
    const t0 = this.screenToTile(this.viewWidth * 0.3);
    const t1 = this.screenToTile(this.viewWidth * 0.7);
    const f0 = this.screenToFloor(this.viewHeight * 0.7);
    const f1 = this.screenToFloor(this.viewHeight * 0.3);
    const tally = new Map<FacilityKind, number>();
    for (let f = f0; f <= f1; f++) {
      const arr = this.roomsByFloor.get(f);
      if (!arr) continue;
      for (const u of arr) {
        if (u.x + u.width < t0 || u.x > t1) continue;
        tally.set(u.kind, (tally.get(u.kind) ?? 0) + u.width);
      }
    }
    let dominant: ViewFocus["dominant"] = "empty";
    let best = 0;
    for (const [k, v] of tally) {
      if (v > best) {
        best = v;
        dominant = k;
      }
    }
    if (dominant === "empty") {
      // Fall back to structure: lobby if a lobby run is centred.
      for (let f = f0; f <= f1; f++) {
        const runs = this.structByFloor.get(f);
        if (runs?.some((r) => r.kind === "lobby" && r.x1 >= t0 && r.x0 <= t1)) {
          dominant = "lobby";
          break;
        }
      }
    }
    if (centerFloor <= 0 && dominant === "empty") dominant = "outside";
    return { centerFloor, dominant, night };
  }
}

function mix(a: number[], b: number[], t: number): number[] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
