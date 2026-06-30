import * as ex from "excalibur";
import type { Simulation } from "../../engine/Simulation";
import { GRID, facilityFloors } from "../../engine/facilities";
import type { FacilityKind, Transport, Unit } from "../../engine/types";
import { drawTransport, drawUnit, type DrawCtx } from "../sprites";
import { person } from "../pixelSprites";

/** World pixels per tile / per floor. */
export const TILE = 11;
export const FLOOR = 34;

export interface ViewFocus {
  centerFloor: number;
  dominant: FacilityKind | "outside" | "lobby" | "empty";
  night: boolean;
}

interface Run {
  kind: "floor" | "lobby";
  floor: number;
  x0: number;
  x1: number;
}

/**
 * The Excalibur-powered tower renderer. Excalibur owns the game loop, scene,
 * camera, off-screen culling and rendering; each facility / transport / merged
 * structural run is an Actor whose graphic is an `ex.Canvas` reusing our
 * pixel-art drawing. The controller (main.ts) drives input, tools, the sim
 * tick and the DOM UI, using this class for coordinate math and camera control.
 */
export class TowerEngine {
  engine: ex.Engine;
  sim: Simulation;
  private d: DrawCtx;
  private cacheRev = -1;
  private actors: ex.Actor[] = [];

  // Set by the controller each frame; rendered by the overlay.
  preview: { kind: FacilityKind; floor: number; x: number; valid: boolean } | null = null;
  transportPreview: { kind: FacilityKind; x: number; bottom: number; top: number; valid: boolean } | null = null;
  selectedId: number | null = null;

  /** Called every frame with elapsed milliseconds (sim ticking lives here). */
  onUpdate: ((ms: number) => void) | null = null;

  // Controller-supplied input hooks (the controller owns tool semantics).
  classifyDown: ((button: number, touch: boolean, space: boolean) => "pan" | "action") | null = null;
  onTap: ((tile: number, floor: number, touch: boolean) => void) | null = null;
  onActionDown: ((tile: number, floor: number, touch: boolean) => void) | null = null;
  onActionMove: ((tile: number, floor: number) => void) | null = null;
  onActionUp: ((tile: number, floor: number) => void) | null = null;
  onHover: ((tile: number, floor: number) => void) | null = null;

  // Excalibur pointer gesture state.
  private pointers = new Map<number, { sx: number; sy: number }>();
  private gesture: "pan" | "action" | null = null;
  private pinch: { dist: number } | null = null;
  private moved = 0;
  private lastSx = 0;
  private lastSy = 0;

  private overlay!: ex.ScreenElement;
  private overlayCanvas!: ex.Canvas;
  private ground!: ex.Actor;

  constructor(canvas: HTMLCanvasElement, sim: Simulation) {
    this.sim = sim;
    this.engine = new ex.Engine({
      canvasElement: canvas,
      displayMode: ex.DisplayMode.FillContainer,
      pixelArt: true,
      antialiasing: false,
      suppressPlayButton: true,
      suppressConsoleBootMessage: true,
      backgroundColor: ex.Color.fromHex("#7fb0e0"),
    });
    this.d = { ctx: null as unknown as CanvasRenderingContext2D, lit: false, anim: 0, hour: 9 };
    this.engine.currentScene.onPostUpdate = (_e: ex.Engine, elapsed: number) => this.tick(elapsed);
  }

  async start(): Promise<void> {
    await this.engine.start();
    this.engine.currentScene.camera.zoom = 0.9;
    this.makeGround();
    this.makeOverlay();
    this.center();
    this.rebuild();
    this.bindInput();
  }

  // ---- Input (Excalibur pointer system) ----------------------------------

  private tf(ev: ex.PointerEvent): { tile: number; floor: number } {
    return { tile: Math.floor(ev.worldPos.x / TILE), floor: Math.ceil(-ev.worldPos.y / FLOOR) };
  }

  private bindInput(): void {
    const ptr = this.engine.input.pointers;
    ptr.on("down", (ev) => this.pointerDown(ev as ex.PointerEvent));
    ptr.on("move", (ev) => this.pointerMove(ev as ex.PointerEvent));
    ptr.on("up", (ev) => this.pointerUp(ev as ex.PointerEvent));
    ptr.on("cancel", (ev) => this.pointerUp(ev as ex.PointerEvent));
    ptr.on("wheel", (ev) => {
      const w = ev as ex.WheelEvent;
      this.zoomAt(w.deltaY < 0 ? 1.12 : 0.89, w.x, w.y);
    });
  }

  private pointerDown(ev: ex.PointerEvent): void {
    this.pointers.set(ev.pointerId, { sx: ev.screenPos.x, sy: ev.screenPos.y });
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy) };
      this.gesture = null;
      this.preview = null;
      this.transportPreview = null;
      return;
    }
    if (this.pointers.size > 2) return;
    this.lastSx = ev.screenPos.x;
    this.lastSy = ev.screenPos.y;
    this.moved = 0;
    const touch = ev.pointerType === "Touch";
    const space = this.engine.input.keyboard.isHeld(ex.Keys.Space);
    this.gesture = this.classifyDown ? this.classifyDown(buttonNum(ev), touch, space) : "pan";
    if (this.gesture === "action") {
      const { tile, floor } = this.tf(ev);
      this.onActionDown?.(tile, floor, touch);
    }
  }

  private pointerMove(ev: ex.PointerEvent): void {
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { sx: ev.screenPos.x, sy: ev.screenPos.y });
    if (this.pinch) {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy);
      const mx = (pts[0].sx + pts[1].sx) / 2;
      const my = (pts[0].sy + pts[1].sy) / 2;
      if (this.pinch.dist > 0) this.zoomAt(dist / this.pinch.dist, mx, my);
      this.pinch.dist = dist;
      return;
    }
    const { tile, floor } = this.tf(ev);
    if (this.gesture === "pan") {
      const dx = ev.screenPos.x - this.lastSx;
      const dy = ev.screenPos.y - this.lastSy;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.pan(dx, dy);
      this.lastSx = ev.screenPos.x;
      this.lastSy = ev.screenPos.y;
    } else if (this.gesture === "action") {
      this.onActionMove?.(tile, floor);
    } else {
      this.onHover?.(tile, floor);
    }
  }

  private pointerUp(ev: ex.PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.gesture = null;
      return;
    }
    const { tile, floor } = this.tf(ev);
    if (this.gesture === "pan") {
      if (this.moved < 5) this.onTap?.(tile, floor, ev.pointerType === "Touch");
    } else if (this.gesture === "action") {
      this.onActionUp?.(tile, floor);
    }
    this.gesture = null;
  }

  setSim(sim: Simulation): void {
    this.sim = sim;
    this.cacheRev = -1;
    this.center();
    this.rebuild();
  }

  private tick(elapsed: number): void {
    const c = this.sim.clock;
    this.d.anim = (globalThis.performance ? performance.now() : 0) / 1000;
    this.d.hour = c.hour;
    this.d.lit = c.isNight() || c.isEvening();
    this.engine.backgroundColor = ex.Color.fromHex(skyColor(c.hour));
    if (this.onUpdate) this.onUpdate(elapsed);
    if (this.sim.tower.revision !== this.cacheRev) this.rebuild();
  }

  // ---- Coordinate math ----------------------------------------------------

  get viewWidth(): number {
    return this.engine.screen.resolution.width;
  }
  get viewHeight(): number {
    return this.engine.screen.resolution.height;
  }
  private get cam(): ex.Camera {
    return this.engine.currentScene.camera;
  }

  worldX(tile: number): number {
    return tile * TILE;
  }
  worldYTop(floor: number, h = 1): number {
    return -(floor + h - 1) * FLOOR;
  }
  /** Screen (CSS px) → world, using Excalibur's own camera transform. */
  private screenToWorld(sx: number, sy: number): ex.Vector {
    return this.engine.screenToWorldCoordinates(ex.vec(sx, sy));
  }
  worldToScreenX(tile: number): number {
    return this.engine.worldToScreenCoordinates(ex.vec(tile * TILE, 0)).x;
  }
  worldToScreenY(floor: number): number {
    return this.engine.worldToScreenCoordinates(ex.vec(0, -floor * FLOOR)).y;
  }
  screenToTile(sx: number): number {
    return Math.floor(this.screenToWorld(sx, this.viewHeight / 2).x / TILE);
  }
  screenToFloor(sy: number): number {
    return Math.ceil(-this.screenToWorld(this.viewWidth / 2, sy).y / FLOOR);
  }

  // ---- Camera control (Excalibur camera) ----------------------------------

  /** Pan the Excalibur camera by a screen-space delta. */
  pan(dxScreen: number, dyScreen: number): void {
    this.cam.pos = ex.vec(this.cam.pos.x - dxScreen / this.cam.zoom, this.cam.pos.y - dyScreen / this.cam.zoom);
    this.clamp();
  }
  /** Zoom the Excalibur camera, keeping the screen point fixed in world space. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = Math.max(0.3, Math.min(3, this.cam.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.cam.pos = ex.vec(this.cam.pos.x + (before.x - after.x), this.cam.pos.y + (before.y - after.y));
    this.clamp();
  }
  private clamp(): void {
    const x = Math.max(0, Math.min(GRID.width * TILE, this.cam.pos.x));
    const y = Math.max(-(GRID.maxFloor + 2) * FLOOR, Math.min((2 - GRID.minFloor) * FLOOR, this.cam.pos.y));
    this.cam.pos = ex.vec(x, y);
  }
  center(): void {
    const hi = this.sim.tower.highestFloor;
    this.cam.pos = ex.vec((GRID.width / 2) * TILE, -(Math.max(6, hi) / 2) * FLOOR);
  }
  setCamera(tileX: number, floor: number, zoom: number): void {
    this.cam.pos = ex.vec(tileX * TILE, -floor * FLOOR);
    this.cam.zoom = zoom;
  }

  // ---- Scene construction -------------------------------------------------

  private makeGround(): void {
    // Dirt below street level (world y >= 0); rooms in the basement draw over it.
    this.ground = new ex.Actor({
      pos: ex.vec((GRID.width / 2) * TILE, ((GRID.maxFloor) * FLOOR) / 2),
      width: GRID.width * TILE * 3,
      height: (GRID.maxFloor + 12) * FLOOR,
      anchor: ex.vec(0.5, 0),
      z: -50,
      color: ex.Color.fromHex("#3a3326"),
    });
    this.engine.add(this.ground);
  }

  private makeOverlay(): void {
    this.overlayCanvas = new ex.Canvas({
      width: this.viewWidth,
      height: this.viewHeight,
      cache: false,
      draw: (ctx) => this.drawOverlay(ctx),
    });
    this.overlay = new ex.ScreenElement({ x: 0, y: 0, z: 100 });
    this.overlay.graphics.use(this.overlayCanvas);
    this.engine.add(this.overlay);
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    // Keep the overlay canvas matched to the viewport.
    if (this.overlayCanvas.width !== this.viewWidth || this.overlayCanvas.height !== this.viewHeight) {
      this.overlayCanvas.width = this.viewWidth;
      this.overlayCanvas.height = this.viewHeight;
    }
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.drawSun(ctx);
    this.drawPreview(ctx);
    this.drawSelection(ctx);
    this.drawRuler(ctx);
  }

  private drawSun(ctx: CanvasRenderingContext2D): void {
    const hour = this.sim.clock.hour + this.sim.clock.minute / 60;
    const night = this.sim.clock.isNight();
    if (night) {
      ctx.fillStyle = "#eef";
      ctx.beginPath();
      ctx.arc(this.viewWidth * 0.82, this.viewHeight * 0.16, 10, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const arc = ((hour - 6) / 12) * Math.PI;
      ctx.fillStyle = "#fff7c0";
      ctx.beginPath();
      ctx.arc((arc / Math.PI) * this.viewWidth, this.viewHeight * 0.62 - Math.sin(arc) * this.viewHeight * 0.5, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.preview) {
      const p = this.preview;
      const hgt = facilityFloors(p.kind);
      const w = this.sim.tower.facilityOf({ kind: p.kind } as Unit).width;
      const sx = this.worldToScreenX(p.x);
      const sy = this.worldToScreenY(p.floor + hgt - 1) - FLOOR * this.cam.zoom * 0; // top
      const sw = w * TILE * this.cam.zoom;
      const sh = hgt * FLOOR * this.cam.zoom;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = p.valid ? "#ffd24a" : "#cc3333";
      ctx.fillRect(sx, sy, sw, sh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.valid ? "#fff" : "#ff5555";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    }
    if (this.transportPreview) {
      const p = this.transportPreview;
      const w = this.sim.tower.facilityOf({ kind: p.kind } as Unit).width;
      const sx = this.worldToScreenX(p.x);
      const sy = this.worldToScreenY(p.top);
      const sw = w * TILE * this.cam.zoom;
      const sh = (p.top - p.bottom + 1) * FLOOR * this.cam.zoom;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = p.valid ? "#ffd24a" : "#cc3333";
      ctx.fillRect(sx, sy, sw, sh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.valid ? "#fff" : "#ff5555";
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    if (this.selectedId == null) return;
    const u = this.sim.tower.units.find((x) => x.id === this.selectedId);
    if (!u) return;
    const hgt = facilityFloors(u.kind);
    const sx = this.worldToScreenX(u.x);
    const sy = this.worldToScreenY(u.floor + hgt - 1);
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 1, sy - 1, u.width * TILE * this.cam.zoom + 2, hgt * FLOOR * this.cam.zoom + 2);
  }

  private drawRuler(ctx: CanvasRenderingContext2D): void {
    ctx.font = "10px monospace";
    ctx.textBaseline = "middle";
    const top = this.screenToFloor(0) + 1;
    const bot = this.screenToFloor(this.viewHeight) - 1;
    for (let f = bot; f <= top; f++) {
      const sy = this.worldToScreenY(f) - (FLOOR * this.cam.zoom) / 2;
      if (sy < 12 || sy > this.viewHeight - 2) continue;
      const label = f >= 1 ? `${f}` : `B${1 - f}`;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, sy - 7, 22, 14);
      ctx.fillStyle = f % 15 === 1 ? "#ffd24a" : "#cfcfcf";
      ctx.fillText(label, 3, sy);
    }
    ctx.textBaseline = "alphabetic";
  }

  // ---- Actor sync ---------------------------------------------------------

  private clearActors(): void {
    for (const a of this.actors) a.kill();
    this.actors = [];
  }

  private addCanvasActor(px: number, py: number, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, z = 0): void {
    const cv = new ex.Canvas({
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
      cache: false,
      draw: (ctx) => {
        this.d.ctx = ctx;
        draw(ctx);
      },
    });
    const actor = new ex.Actor({ pos: ex.vec(px, py), width: w, height: h, anchor: ex.vec(0, 0), z });
    actor.graphics.use(cv);
    this.engine.add(actor);
    this.actors.push(actor);
  }

  private rebuild(): void {
    this.clearActors();
    const tower = this.sim.tower;
    const structTiles = new Map<number, Map<number, "floor" | "lobby">>();
    for (const u of tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") {
        let row = structTiles.get(u.floor);
        if (!row) structTiles.set(u.floor, (row = new Map()));
        for (let i = 0; i < u.width; i++) row.set(u.x + i, u.kind);
      }
    }
    for (const [floor, row] of structTiles) for (const run of mergeRuns(floor, row)) this.addRun(run);
    for (const u of tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") continue;
      this.addUnit(u);
    }
    for (const t of tower.transports) this.addTransport(t);
    this.cacheRev = tower.revision;
  }

  private addRun(r: Run): void {
    const w = (r.x1 - r.x0 + 1) * TILE;
    const fake = fakeUnit(r);
    this.addCanvasActor(this.worldX(r.x0), this.worldYTop(r.floor), w, FLOOR, (ctx) => {
      drawUnit(this.d, fake, 0, 0, w, FLOOR);
      this.drawRunWalkers(ctx, r, w);
    }, -1);
  }

  private drawRunWalkers(ctx: CanvasRenderingContext2D, r: Run, w: number): void {
    const c = this.sim.clock;
    const busy = c.isMorning() || c.isEvening() || c.isLunch();
    if (r.kind !== "lobby" && !busy) return;
    const footY = FLOOR - 3;
    const density = r.kind === "lobby" ? (busy ? 0.5 : 0.28) : 0.16;
    const count = Math.min(40, Math.floor((w / 10) * density));
    for (let i = 0; i < count; i++) {
      const seed = (r.floor * 131 + r.x0 * 7 + i * 53) | 0;
      const dir = seed % 2 === 0 ? 1 : -1;
      const speed = 8 + (seed % 7);
      let px = ((i / count) * w + dir * this.d.anim * speed) % w;
      if (px < 0) px += w;
      person(ctx, px, footY, 1.1, seed);
    }
  }

  private addUnit(u: Unit): void {
    const hgt = facilityFloors(u.kind);
    const w = u.width * TILE;
    const h = hgt * FLOOR;
    this.addCanvasActor(this.worldX(u.x), this.worldYTop(u.floor, hgt), w, h, () => drawUnit(this.d, u, 0, 0, w, h));
  }

  private addTransport(t: Transport): void {
    const w = t.width * TILE;
    const h = (t.top - t.bottom + 1) * FLOOR;
    this.addCanvasActor(this.worldX(t.x), this.worldYTop(t.top), w, h, (ctx) => drawTransport(ctx, t, 0, 0, w, FLOOR, this.d.anim), 1);
  }

  // ---- Audio focus --------------------------------------------------------

  focus(): ViewFocus {
    const centerFloor = this.screenToFloor(this.viewHeight / 2);
    const night = this.sim.clock.isNight();
    const t0 = this.screenToTile(this.viewWidth * 0.3);
    const t1 = this.screenToTile(this.viewWidth * 0.7);
    const f0 = this.screenToFloor(this.viewHeight * 0.7);
    const f1 = this.screenToFloor(this.viewHeight * 0.3);
    const tally = new Map<FacilityKind, number>();
    for (const u of this.sim.tower.units) {
      if (u.floor < f0 || u.floor > f1) continue;
      if (u.x + u.width < t0 || u.x > t1) continue;
      tally.set(u.kind, (tally.get(u.kind) ?? 0) + u.width);
    }
    let dominant: ViewFocus["dominant"] = "empty";
    let best = 0;
    for (const [k, v] of tally) {
      if (k === "floor") continue;
      if (v > best) {
        best = v;
        dominant = k === "lobby" ? "lobby" : k;
      }
    }
    if (dominant === "empty" && centerFloor <= 0) dominant = "outside";
    return { centerFloor, dominant, night };
  }

  dispose(): void {
    this.engine.stop();
  }
}

function buttonNum(ev: ex.PointerEvent): number {
  if (ev.button === ex.PointerButton.Middle) return 1;
  if (ev.button === ex.PointerButton.Right) return 2;
  return 0;
}

function fakeUnit(r: Run): Unit {
  return {
    id: r.floor * 10000 + r.x0,
    kind: r.kind,
    floor: r.floor,
    x: r.x0,
    width: r.x1 - r.x0 + 1,
    state: "occupied",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
    label: "",
  };
}

function mergeRuns(floor: number, row: Map<number, "floor" | "lobby">): Run[] {
  const xs = [...row.keys()].sort((a, b) => a - b);
  const runs: Run[] = [];
  if (xs.length === 0) return runs;
  let start = xs[0];
  let prev = xs[0];
  let kind = row.get(xs[0])!;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const k = row.get(x)!;
    if (x === prev + 1 && k === kind) {
      prev = x;
    } else {
      runs.push({ kind, floor, x0: start, x1: prev });
      start = prev = x;
      kind = k;
    }
  }
  runs.push({ kind, floor, x0: start, x1: prev });
  return runs;
}

function skyColor(hour: number): string {
  const t = Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5 + 0.5; // 1 at midday
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const r = mix(28, 130);
  const g = mix(34, 175);
  const b = mix(70, 224);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
