import * as ex from "excalibur";
import type { Simulation } from "../../engine/Simulation";
import { GRID, TRANSPORT_CAPACITY, facilityFloors, hasBusinessHours, isElevatorKind, isOpenAt } from "../../engine/facilities";
import type { FacilityKind, Transport, Unit, WeatherKind } from "../../engine/types";
import { drawCar, drawMetroTrain, drawTransport, drawUnit, type DrawCtx } from "../sprites";
import { person, SHIRTS } from "../pixelSprites";
import type { Person } from "../../engine/Crowd";

/** World pixels per tile / per floor. */
export const TILE = 11;
export const FLOOR = 34;

/**
 * The crowd advances on *game* time, not real time, so the speed control only
 * compresses time and never changes gameplay outcomes (tenant stress). One
 * in-game minute is worth this many of the crowd's internal seconds — small
 * enough that a commute spans a few game-minutes, so at fast speed people
 * simply zip through their trips. A single frame's advance is capped so a long
 * stall (or a freshly loaded save) can't teleport the whole crowd at once.
 */

export interface ViewFocus {
  centerFloor: number;
  dominant: FacilityKind | "outside" | "lobby" | "empty";
  night: boolean;
  /**
   * Current camera zoom (world pixels multiplier). ~0.3 is fully zoomed out
   * — the whole tower in frame — and 3 is a tight close-up. Audio uses this to
   * pull back to a wide "tower overview" bed when zoomed out and to fade in
   * area-specific detail (crowd, kitchen clatter, elevator dings) up close.
   */
  zoom: number;
  /** Today's sky weather; drives an outdoor rain layer in the ambient bed. */
  weather: WeatherKind;
}

/** What the pointer is over, resolved by Excalibur's collider hit-testing. */
export interface Picked {
  type: "unit" | "transport";
  id: number;
  kind: FacilityKind;
}

interface Run {
  kind: "floor" | "lobby";
  floor: number;
  x0: number;
  x1: number;
}

/** A single engine-driven walking figure (lobby/corridor walker or climber). */
interface Walker {
  actor: ex.Actor;
  gfx: ex.Canvas;
  x0w: number;
  x1w: number;
  y0w: number;
  y1w: number;
  speed: number;
  dir: number;
  phase: number;
  impatient: boolean;
  red: boolean;
  /** 0..1 position in the crowd; shown only when the tower is busy enough. */
  rank: number;
}

/**
 * The Excalibur-powered tower renderer. Excalibur owns the game loop, scene,
 * camera, off-screen culling, collision/hit-testing and drawing. Every visible
 * piece is a retained `ex.Actor`: structural tiles, rooms and transport shafts
 * are reconciled incrementally (added/removed/refreshed only when the model
 * actually changes — never a full teardown), while everything that *moves*
 * (elevator cars, the metro train, walking people) is its own actor the engine
 * repositions each frame. The controller (main.ts) drives tools, the sim tick
 * and the DOM UI through the hooks below.
 */
export class TowerEngine {
  engine: ex.Engine;
  sim: Simulation;
  private d: DrawCtx;

  // Set by the controller each frame; rendered by the overlay.
  preview: { kind: FacilityKind; floor: number; x: number; valid: boolean; span?: number } | null = null;
  transportPreview: { kind: FacilityKind; x: number; bottom: number; top: number; valid: boolean } | null = null;
  selectedId: number | null = null;

  /** Called every frame with elapsed milliseconds (sim ticking lives here). */
  onUpdate: ((ms: number) => void) | null = null;

  // Controller-supplied input hooks (the controller owns tool semantics). The
  // `picked` argument is the entity Excalibur found under the pointer, or null.
  classifyDown: ((button: number, touch: boolean, space: boolean) => "pan" | "action") | null = null;
  onTap: ((tile: number, floor: number, touch: boolean, picked: Picked | null) => void) | null = null;
  onActionDown: ((tile: number, floor: number, touch: boolean, picked: Picked | null) => void) | null = null;
  onActionMove: ((tile: number, floor: number, picked: Picked | null) => void) | null = null;
  onActionUp: ((tile: number, floor: number, picked: Picked | null) => void) | null = null;
  onHover: ((tile: number, floor: number, picked: Picked | null) => void) | null = null;
  /** Right-click: inspect whatever is under the cursor, regardless of tool. */
  onSecondary: ((picked: Picked | null) => void) | null = null;
  /** Drag/click an in-world extend arrow on the selected elevator (#12).
   *  onExtendTo grows/shrinks the dragged end toward a target floor; onExtendEnd
   *  marks the gesture done so cost accounting can reset. */
  onExtendTo: ((end: "up" | "down", targetFloor: number) => void) | null = null;
  onExtendEnd: (() => void) | null = null;
  /** Screen rects of the selected elevator's extend arrows, for hit-testing. */
  private arrowHit: { up?: ScreenRect; down?: ScreenRect } = {};
  /** Active extend-arrow drag (which end of the shaft is being dragged). */
  private arrowDrag: { end: "up" | "down" } | null = null;

  // Excalibur pointer gesture state.
  private pointers = new Map<number, { sx: number; sy: number }>();
  private gesture: "pan" | "action" | null = null;
  private pinch: { dist: number } | null = null;
  private moved = 0;
  private downTouch = false;
  private lastSx = 0;
  private lastSy = 0;

  // Retained scene graph, reconciled by stable id.
  private structActors = new Map<number, ex.Actor>();
  private roomActors = new Map<number, ex.Actor>();
  private roomSig = new Map<number, string>();
  private transportActors = new Map<number, ex.Actor>();
  private transportSig = new Map<number, string>();
  // Engine-animated actors, regenerated when the layout changes.
  private carActors: { actor: ex.Actor; t: Transport; i: number; gfx: ex.Canvas[]; shown: number }[] = [];
  private trainActors: { actor: ex.Actor; u: Unit; w: number }[] = [];
  private walkers: Walker[] = [];
  private builtRev = -1;
  private litState = false;
  private lastSyncHour = -1;
  /** Set by the controller from the game speed: when paused, the decorative
   *  animation clock stops so on-screen people freeze with everything else. */
  paused = false;
  /** Wall-clock-derived animation time that only advances while unpaused. */
  private animClock = 0;
  private lastAnimWall = 0;

  // Individually-routed commuters (SimTower's signature) are owned and advanced
  // by the engine; the renderer only draws each person and removes them as they
  // despawn — it never mutates the simulation.
  private crowdActors = new Map<number, { actor: ex.Actor; gfx: ex.Canvas; red: boolean }>();

  // Shared graphics so thousands of tiles/people cost almost nothing.
  private floorGfx!: ex.Canvas;
  private lobbyGfx!: ex.Canvas;
  private personGfx: ex.Canvas[] = [];
  private personGfxRed!: ex.Canvas;

  private overlay!: ex.ScreenElement;
  private overlayCanvas!: ex.Canvas;
  private sky!: ex.ScreenElement;
  private skyCanvas!: ex.Canvas;
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
    this.d = { ctx: null as unknown as CanvasRenderingContext2D, lit: false, anim: 0, hour: 9, stress: 0 };
    this.engine.currentScene.onPostUpdate = (_e: ex.Engine, elapsed: number) => this.tick(elapsed);
  }

  async start(): Promise<void> {
    await this.engine.start();
    this.engine.currentScene.camera.zoom = 0.9;
    this.bakeSharedGraphics();
    this.makeGround();
    this.makeSky();
    this.makeOverlay();
    this.center();
    this.litState = this.d.lit;
    this.syncScene();
    this.syncMotion();
    this.builtRev = this.sim.tower.revision;
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

  /** Top-most unit/transport whose Excalibur collider contains the point. */
  pickEntityAt(world: ex.Vector): Picked | null {
    let best: Picked | null = null;
    let bestZ = -Infinity;
    for (const [id, a] of this.transportActors) {
      if (a.z >= bestZ && a.contains(world.x, world.y)) {
        const t = this.sim.tower.transports.find((x) => x.id === id);
        if (t) {
          best = { type: "transport", id, kind: t.kind };
          bestZ = a.z;
        }
      }
    }
    for (const map of [this.roomActors, this.structActors]) {
      for (const [id, a] of map) {
        if (a.z >= bestZ && a.contains(world.x, world.y)) {
          const u = this.sim.tower.units.find((x) => x.id === id);
          if (u) {
            best = { type: "unit", id, kind: u.kind };
            bestZ = a.z;
          }
        }
      }
    }
    return best;
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
    this.downTouch = touch;
    const space = this.engine.input.keyboard.isHeld(ex.Keys.Space);
    // Left-click on a selected elevator's extend arrow grows the shaft.
    if (buttonNum(ev) === 0 && this.onExtendTo) {
      const ps = ev.screenPos;
      const inRect = (r?: ScreenRect) =>
        !!r && ps.x >= r.x && ps.x <= r.x + r.w && ps.y >= r.y && ps.y <= r.y + r.h;
      const end = inRect(this.arrowHit.up) ? "up" : inRect(this.arrowHit.down) ? "down" : null;
      if (end) {
        // Begin a drag: a plain click extends one floor (on pointer-up), while
        // dragging up/down grows or shrinks the shaft floor-by-floor.
        this.arrowDrag = { end };
        this.gesture = null;
        return;
      }
    }
    // Right-click always inspects what's under the cursor, whatever tool is
    // active — it never pans or builds.
    if (buttonNum(ev) === 2 && this.onSecondary) {
      this.onSecondary(this.pickEntityAt(ev.worldPos));
      this.gesture = null;
      return;
    }
    this.gesture = this.classifyDown ? this.classifyDown(buttonNum(ev), touch, space) : "pan";
    if (this.gesture === "action") {
      const { tile, floor } = this.tf(ev);
      this.onActionDown?.(tile, floor, touch, this.pickEntityAt(ev.worldPos));
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
    if (this.arrowDrag) {
      this.moved += Math.abs(ev.screenPos.y - this.lastSy);
      this.lastSy = ev.screenPos.y;
      this.onExtendTo?.(this.arrowDrag.end, this.screenToFloor(ev.screenPos.y));
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
      this.onActionMove?.(tile, floor, this.pickEntityAt(ev.worldPos));
    } else {
      this.onHover?.(tile, floor, this.pickEntityAt(ev.worldPos));
    }
  }

  private pointerUp(ev: ex.PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.gesture = null;
      return;
    }
    if (this.arrowDrag) {
      // A press without a drag extends a single floor.
      if (this.moved < 5) {
        const t = this.sim.tower.transports.find((x) => x.id === this.selectedId);
        if (t) {
          const target = this.arrowDrag.end === "up" ? t.top + 1 : t.bottom - 1;
          this.onExtendTo?.(this.arrowDrag.end, target);
        }
      }
      this.onExtendEnd?.();
      this.arrowDrag = null;
      this.gesture = null;
      return;
    }
    const { tile, floor } = this.tf(ev);
    if (this.gesture === "pan") {
      // Touch taps jitter more than mouse clicks, so allow a larger slop.
      if (this.moved < (this.downTouch ? 14 : 5)) {
        this.onTap?.(tile, floor, ev.pointerType === "Touch", this.pickEntityAt(ev.worldPos));
      }
    } else if (this.gesture === "action") {
      this.onActionUp?.(tile, floor, this.pickEntityAt(ev.worldPos));
    }
    this.gesture = null;
  }

  setSim(sim: Simulation): void {
    this.disposeScene();
    this.clearCrowd();
    this.sim = sim;
    this.builtRev = -1;
    this.center();
  }

  private tick(elapsed: number): void {
    const c = this.sim.clock;
    // Advance the decorative animation clock by real elapsed time, but only
    // while the game is running — paused (speed 0) freezes the walkers, train
    // and street just like the simulated crowd and elevators.
    const nowWall = (globalThis.performance ? performance.now() : 0) / 1000;
    if (this.lastAnimWall === 0) this.lastAnimWall = nowWall;
    if (!this.paused) this.animClock += nowWall - this.lastAnimWall;
    this.lastAnimWall = nowWall;
    this.d.anim = this.animClock;
    this.d.hour = c.hour;
    this.d.lit = c.isNight() || c.isEvening();
    this.d.stress = Math.max(0, Math.min(1, this.sim.congestion() - 1));
    this.engine.backgroundColor = ex.Color.fromHex(skyColor(c.hour));
    if (this.onUpdate) this.onUpdate(elapsed);

    // Reconcile room/structure actors when the model, lighting, or the hour
    // changes (occupancy shifts on the hour, so sprites must re-bake then).
    const structuralChanged = this.sim.tower.revision !== this.builtRev;
    if (structuralChanged || this.d.lit !== this.litState || this.d.hour !== this.lastSyncHour) {
      this.litState = this.d.lit;
      this.lastSyncHour = this.d.hour;
      this.syncScene();
    }
    // Motion actors only need rebuilding when the layout itself changes.
    if (structuralChanged) {
      this.syncMotion();
      this.builtRev = this.sim.tower.revision;
    }
    this.updateMotion();
    this.reconcileCrowd();
  }

  /** Draw the engine-owned commuters: add/remove/position one actor per live
   * person, by stable id. Read-only — the engine advances the crowd in tick(). */
  private reconcileCrowd(): void {
    const seen = new Set<number>();
    for (const p of this.sim.crowd.people) {
      seen.add(p.id);
      let rec = this.crowdActors.get(p.id);
      if (!rec) {
        const gfx = this.personGfx[Math.abs(p.seed) % this.personGfx.length];
        const a = new ex.Actor({ pos: ex.vec(0, 0), width: 8, height: 14, anchor: ex.vec(0.5, 1), z: 3 });
        a.graphics.use(gfx);
        this.engine.add(a);
        rec = { actor: a, gfx, red: false };
        this.crowdActors.set(p.id, rec);
      }
      this.positionPerson(p, rec);
    }
    for (const [id, rec] of this.crowdActors)
      if (!seen.has(id)) {
        rec.actor.kill();
        this.crowdActors.delete(id);
      }
  }

  private positionPerson(p: Person, rec: { actor: ex.Actor; gfx: ex.Canvas; red: boolean }): void {
    // While riding, the person is inside a car — the cab's own rider count shows
    // them, so we hide the standalone figure to avoid drawing them twice.
    const riding = p.state === "riding";
    if (rec.actor.graphics.visible !== !riding) rec.actor.graphics.visible = !riding;
    if (riding) return;
    // Use the continuous floor (fy) so a stair/escalator climber animates
    // smoothly between floors; for every other state fy equals the floor.
    rec.actor.pos = ex.vec(this.worldX(p.x), this.worldYTop(p.fy) + FLOOR - 3);
    // Long waits redden the figure, the original's "this tenant is fed up" cue.
    const red = p.wait > 25;
    if (red !== rec.red) {
      rec.red = red;
      rec.actor.graphics.use(red ? this.personGfxRed : rec.gfx);
    }
  }

  private clearCrowd(): void {
    // Only the drawn actors are ours; the crowd model belongs to the sim.
    for (const rec of this.crowdActors.values()) rec.actor.kill();
    this.crowdActors.clear();
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

  pan(dxScreen: number, dyScreen: number): void {
    this.cam.pos = ex.vec(this.cam.pos.x - dxScreen / this.cam.zoom, this.cam.pos.y - dyScreen / this.cam.zoom);
    this.clamp();
  }
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

  // ---- Static scene elements ----------------------------------------------

  private makeGround(): void {
    const wide = GRID.width * TILE * 3;
    const cx = (GRID.width / 2) * TILE;
    const depth = (2 - GRID.minFloor + 14) * FLOOR;
    this.ground = new ex.Actor({
      pos: ex.vec(cx, 0),
      width: wide,
      height: depth,
      anchor: ex.vec(0.5, 0),
      z: -50,
      color: ex.Color.fromHex("#3a3326"),
    });
    this.engine.add(this.ground);
    const sidewalk = new ex.Actor({
      pos: ex.vec(cx, 0),
      width: wide,
      height: 6,
      anchor: ex.vec(0.5, 0.5),
      z: -49,
      color: ex.Color.fromHex("#6f6a60"),
    });
    this.engine.add(sidewalk);
  }

  /**
   * Sun/moon on a screen-space layer placed *below* the world ground and tower
   * (a z under the dirt). They hang in the open sky, and as you pan, the dirt
   * and the building slide over them and hide them at the horizon — so it pans
   * correctly with no manual clipping.
   */
  private makeSky(): void {
    this.skyCanvas = new ex.Canvas({
      width: this.viewWidth,
      height: this.viewHeight,
      cache: false,
      draw: (ctx) => this.drawSky(ctx),
    });
    this.sky = new ex.ScreenElement({ x: 0, y: 0, z: -60 });
    this.sky.graphics.use(this.skyCanvas);
    this.engine.add(this.sky);
  }

  private drawSky(ctx: CanvasRenderingContext2D): void {
    if (this.skyCanvas.width !== this.viewWidth || this.skyCanvas.height !== this.viewHeight) {
      this.skyCanvas.width = this.viewWidth;
      this.skyCanvas.height = this.viewHeight;
    }
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.drawSun(ctx);
    this.drawClouds(ctx);
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
    if (this.overlayCanvas.width !== this.viewWidth || this.overlayCanvas.height !== this.viewHeight) {
      this.overlayCanvas.width = this.viewWidth;
      this.overlayCanvas.height = this.viewHeight;
    }
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.drawRain(ctx);
    this.drawPreview(ctx);
    this.drawSelection(ctx);
    this.drawRuler(ctx);
  }

  /** Clouds drift across the sky on overcast and rainy days (sky layer). */
  private drawClouds(ctx: CanvasRenderingContext2D): void {
    const w = this.sim.weather;
    if (w === "clear") return;
    const W = this.viewWidth;
    const H = this.viewHeight;
    const t = this.d.anim;
    ctx.fillStyle = w === "rain" ? "rgba(86,92,108,0.55)" : "rgba(244,247,255,0.72)";
    for (let i = 0; i < 5; i++) {
      const seed = i * 97 + 11;
      const speed = 6 + (seed % 7);
      const y = H * 0.1 + ((seed % 100) / 100) * H * 0.22;
      const x = (((seed * 53) % (W + 240)) + t * speed) % (W + 240) - 120;
      this.drawCloud(ctx, x, y, 56 + (seed % 44));
    }
  }

  private drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.arc(x + r * 0.5, y + 4, r * 0.4, 0, Math.PI * 2);
    ctx.arc(x - r * 0.5, y + 4, r * 0.38, 0, Math.PI * 2);
    ctx.arc(x, y + 9, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Rain falls in front of the tower on rainy days (overlay layer). */
  private drawRain(ctx: CanvasRenderingContext2D): void {
    if (this.sim.weather !== "rain") return;
    const W = this.viewWidth;
    const H = this.viewHeight;
    const t = this.d.anim;
    // A faint overcast tint over the whole scene.
    ctx.fillStyle = "rgba(34,40,56,0.16)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(200,214,236,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 140; i++) {
      const x = ((i * 2654435761) >>> 0) % W;
      const y = (((i * 37) % H) + t * 320) % H;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 9);
    }
    ctx.stroke();
  }

  private drawSun(ctx: CanvasRenderingContext2D): void {
    const hour = this.sim.clock.hour + this.sim.clock.minute / 60;
    // The sun arcs across 06:00→18:00; the moon takes the same arc 18:00→06:00,
    // so both rise in the east, climb, and set in the west.
    const day = hour >= 6 && hour < 18;
    const arc = day ? ((hour - 6) / 12) * Math.PI : (((hour - 18 + 24) % 24) / 12) * Math.PI;
    const cx = (arc / Math.PI) * this.viewWidth;
    const cy = this.viewHeight * 0.62 - Math.sin(arc) * this.viewHeight * 0.5;
    ctx.fillStyle = day ? "#fff7c0" : "#eef";
    ctx.beginPath();
    ctx.arc(cx, cy, day ? 16 : 11, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.preview) {
      const p = this.preview;
      const hgt = facilityFloors(p.kind);
      // Floor/lobby tools lay a multi-tile brush strip; `span` (when set) is the
      // real footprint so the shadow matches what a click actually places.
      const w = p.span ?? this.sim.tower.facilityOf({ kind: p.kind } as Unit).width;
      const sx = this.worldToScreenX(p.x);
      const sy = this.worldToScreenY(p.floor + hgt - 1);
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
    this.arrowHit = {};
    if (this.selectedId == null) return;
    const u = this.sim.tower.units.find((x) => x.id === this.selectedId);
    if (u) {
      const hgt = facilityFloors(u.kind);
      const sx = this.worldToScreenX(u.x);
      const sy = this.worldToScreenY(u.floor + hgt - 1);
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 1, sy - 1, u.width * TILE * this.cam.zoom + 2, hgt * FLOOR * this.cam.zoom + 2);
      return;
    }
    const t = this.sim.tower.transports.find((x) => x.id === this.selectedId);
    if (t) this.drawTransportSelection(ctx, t);
  }

  /** Outline the selected shaft and, for elevators, draw clickable extend
   *  arrows above the top and below the bottom (as in the original). */
  private drawTransportSelection(ctx: CanvasRenderingContext2D, t: Transport): void {
    const z = this.cam.zoom;
    const sx = this.worldToScreenX(t.x);
    const sw = t.width * TILE * z;
    const top = this.worldToScreenY(t.top);
    const bottom = top + (t.top - t.bottom + 1) * FLOOR * z;
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 1, top - 1, sw + 2, bottom - top + 2);
    if (!isElevatorKind(t.kind)) return; // only lifts extend by a tappable arrow

    // Small, subtle tabs centered on the shaft — discoverable without dominating
    // the view. The hit rect is a touch larger than the drawn tab for easy use.
    const cx = sx + sw / 2;
    const tabW = Math.min(sw, 18);
    const tabH = 11;
    const up: ScreenRect = { x: cx - tabW / 2, y: top - tabH - 3, w: tabW, h: tabH };
    const down: ScreenRect = { x: cx - tabW / 2, y: bottom + 3, w: tabW, h: tabH };
    this.arrowHit = {
      up: { x: up.x - 4, y: up.y - 4, w: up.w + 8, h: up.h + 8 },
      down: { x: down.x - 4, y: down.y - 4, w: down.w + 8, h: down.h + 8 },
    };
    const drawArrow = (r: ScreenRect, dir: "up" | "down") => {
      ctx.fillStyle = "rgba(20,24,32,0.6)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#ffd24a";
      const my = r.y + r.h / 2;
      const a = 4;
      ctx.beginPath();
      if (dir === "up") {
        ctx.moveTo(cx, my - a);
        ctx.lineTo(cx - a, my + a - 1);
        ctx.lineTo(cx + a, my + a - 1);
      } else {
        ctx.moveTo(cx, my + a);
        ctx.lineTo(cx - a, my - a + 1);
        ctx.lineTo(cx + a, my - a + 1);
      }
      ctx.closePath();
      ctx.fill();
    };
    drawArrow(up, "up");
    drawArrow(down, "down");
  }

  private drawRuler(ctx: CanvasRenderingContext2D): void {
    ctx.font = "10px monospace";
    ctx.textBaseline = "middle";
    const top = this.screenToFloor(0) + 1;
    const bot = this.screenToFloor(this.viewHeight) - 1;
    for (let f = bot; f <= top; f++) {
      // worldToScreenY(f) is floor f's TOP edge; center the label on the row
      // (+half a floor). Using -half shifted every label up one floor, so the
      // ground lobby (floor 1) showed the "B1" tag and the elevator's own floor
      // numbers didn't line up with the ruler.
      const sy = this.worldToScreenY(f) + (FLOOR * this.cam.zoom) / 2;
      if (sy < 12 || sy > this.viewHeight - 2) continue;
      const label = f >= 1 ? `${f}` : `B${1 - f}`;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, sy - 7, 22, 14);
      ctx.fillStyle = f === 1 || f % 15 === 0 ? "#ffd24a" : "#cfcfcf";
      ctx.fillText(label, 3, sy);
    }
    ctx.textBaseline = "alphabetic";
  }

  // ---- Shared graphics ----------------------------------------------------

  private bakeSharedGraphics(): void {
    const mk = (kind: "floor" | "lobby") =>
      new ex.Canvas({
        width: TILE,
        height: FLOOR,
        cache: true,
        draw: (ctx) => {
          this.d.ctx = ctx;
          drawUnit(this.d, fakeStruct(kind), 0, 0, TILE, FLOOR);
        },
      });
    this.floorGfx = mk("floor");
    this.lobbyGfx = mk("lobby");

    for (const color of SHIRTS) {
      this.personGfx.push(
        new ex.Canvas({ width: 8, height: 14, cache: true, draw: (ctx) => person(ctx, 2.5, 13, 1.1, 7, false, color) }),
      );
    }
    this.personGfxRed = new ex.Canvas({ width: 8, height: 14, cache: true, draw: (ctx) => person(ctx, 2.5, 13, 1.1, 7, false, "#C24A3A") });
  }

  // ---- Retained-scene reconciliation (no full rebuild) --------------------

  private syncScene(): void {
    const tower = this.sim.tower;
    const seenS = new Set<number>();
    const seenR = new Set<number>();
    for (const u of tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") {
        seenS.add(u.id);
        if (!this.structActors.has(u.id)) this.addStruct(u);
      } else {
        seenR.add(u.id);
        // The signature must capture every input the room sprite draws from, so
        // it re-bakes exactly when its look changes. Crucially that includes the
        // hour-dependent bits — a commercial unit's open/closed shutter and a
        // condo's late-night "asleep" look — otherwise a shop baked closed at
        // dawn would wrongly stay shuttered all day until the next lighting flip.
        const open = hasBusinessHours(u.kind) ? (isOpenAt(u.kind, this.d.hour) ? "o" : "c") : "";
        const lateNight = u.kind === "condo" && (this.d.hour >= 23 || this.d.hour < 6) ? "s" : "";
        const sig = `${u.state}:${this.litState ? 1 : 0}:${u.width}:${u.occupants}:${open}${lateNight}`;
        const a = this.roomActors.get(u.id);
        if (!a) {
          this.addRoom(u);
          this.roomSig.set(u.id, sig);
        } else if (this.roomSig.get(u.id) !== sig) {
          a.kill();
          this.roomActors.delete(u.id);
          this.addRoom(u);
          this.roomSig.set(u.id, sig);
        }
      }
    }
    for (const [id, a] of this.structActors)
      if (!seenS.has(id)) {
        a.kill();
        this.structActors.delete(id);
      }
    for (const [id, a] of this.roomActors)
      if (!seenR.has(id)) {
        a.kill();
        this.roomActors.delete(id);
        this.roomSig.delete(id);
      }

    const seenT = new Set<number>();
    for (const t of tower.transports) {
      seenT.add(t.id);
      const sig = `${t.bottom}:${t.top}:${t.cars}:${t.kind}:${(t.skipFloors ?? []).join(",")}`;
      const a = this.transportActors.get(t.id);
      if (!a) {
        this.addTransport(t);
        this.transportSig.set(t.id, sig);
      } else if (this.transportSig.get(t.id) !== sig) {
        a.kill();
        this.transportActors.delete(t.id);
        this.addTransport(t);
        this.transportSig.set(t.id, sig);
      }
    }
    for (const [id, a] of this.transportActors)
      if (!seenT.has(id)) {
        a.kill();
        this.transportActors.delete(id);
        this.transportSig.delete(id);
      }
  }

  private addStruct(u: Unit): void {
    const a = new ex.Actor({
      pos: ex.vec(this.worldX(u.x), this.worldYTop(u.floor)),
      width: TILE,
      height: FLOOR,
      anchor: ex.vec(0, 0),
      z: -1,
    });
    a.graphics.use(u.kind === "lobby" ? this.lobbyGfx : this.floorGfx);
    a.collider.set(ex.Shape.Box(TILE, FLOOR, ex.vec(0, 0)));
    this.engine.add(a);
    this.structActors.set(u.id, a);
  }

  private addRoom(u: Unit): void {
    const hgt = facilityFloors(u.kind);
    const w = u.width * TILE;
    const h = hgt * FLOOR;
    // Burning / under-construction rooms animate, so they redraw; the rest are
    // baked once and only re-baked when their state or the lighting changes.
    const animated = u.state === "fire" || u.state === "construction";
    const cv = new ex.Canvas({
      width: w,
      height: h,
      cache: !animated,
      draw: (ctx) => {
        this.d.ctx = ctx;
        drawUnit(this.d, u, 0, 0, w, h);
      },
    });
    const a = new ex.Actor({ pos: ex.vec(this.worldX(u.x), this.worldYTop(u.floor, hgt)), width: w, height: h, anchor: ex.vec(0, 0), z: 0 });
    a.graphics.use(cv);
    a.collider.set(ex.Shape.Box(w, h, ex.vec(0, 0)));
    this.engine.add(a);
    this.roomActors.set(u.id, a);
  }

  private addTransport(t: Transport): void {
    const w = t.width * TILE;
    const h = (t.top - t.bottom + 1) * FLOOR;
    const cv = new ex.Canvas({
      width: w,
      height: h,
      cache: true,
      draw: (ctx) => {
        this.d.ctx = ctx;
        drawTransport(ctx, t, 0, 0, w, FLOOR);
      },
    });
    const a = new ex.Actor({ pos: ex.vec(this.worldX(t.x), this.worldYTop(t.top)), width: w, height: h, anchor: ex.vec(0, 0), z: 1 });
    a.graphics.use(cv);
    a.collider.set(ex.Shape.Box(w, h, ex.vec(0, 0)));
    this.engine.add(a);
    this.transportActors.set(t.id, a);
  }

  // ---- Engine-driven motion (cars, train, walkers) ------------------------

  private clearMotion(): void {
    for (const c of this.carActors) c.actor.kill();
    for (const t of this.trainActors) t.actor.kill();
    for (const w of this.walkers) w.actor.kill();
    this.carActors = [];
    this.trainActors = [];
    this.walkers = [];
  }

  private syncMotion(): void {
    this.clearMotion();
    for (const t of this.sim.tower.transports) {
      if (!isElevatorKind(t.kind)) continue;
      const w = t.width * TILE;
      for (let i = 0; i < t.cars; i++) {
        const seed = (i * 7 + t.id) | 0;
        // One graphic per rider count 0..4, so the cab fills as it loads up.
        const gfx = Array.from({ length: 5 }, (_, r) =>
          new ex.Canvas({ width: w, height: FLOOR, cache: true, draw: (ctx) => drawCar(ctx, seed, w, FLOOR, r) }),
        );
        const a = new ex.Actor({ pos: ex.vec(this.worldX(t.x), -t.carPositions[i] * FLOOR), width: w, height: FLOOR, anchor: ex.vec(0, 0), z: 2 });
        a.graphics.use(gfx[0]);
        this.engine.add(a);
        this.carActors.push({ actor: a, t, i, gfx, shown: 0 });
      }
    }
    for (const u of this.sim.tower.units) {
      if (u.kind !== "metro") continue;
      const w = u.width * TILE - 6;
      const cv = new ex.Canvas({ width: w, height: 9, cache: true, draw: (ctx) => drawMetroTrain(ctx, w, true) });
      const a = new ex.Actor({ pos: ex.vec(this.worldX(u.x) + 3, this.worldYTop(u.floor) + FLOOR - 15), width: w, height: 9, anchor: ex.vec(0, 0), z: 0.6 });
      a.graphics.use(cv);
      this.engine.add(a);
      this.trainActors.push({ actor: a, u, w });
    }
    this.buildWalkers();
  }

  private buildWalkers(): void {
    const byFloor = new Map<number, Map<number, "floor" | "lobby">>();
    for (const u of this.sim.tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") {
        let row = byFloor.get(u.floor);
        if (!row) byFloor.set(u.floor, (row = new Map()));
        row.set(u.x, u.kind);
      }
    }
    let budget = 400;
    for (const [floor, row] of byFloor) {
      for (const run of mergeRuns(floor, row)) {
        if (budget <= 0) break;
        const wTiles = run.x1 - run.x0 + 1;
        const density = run.kind === "lobby" ? 0.5 : 0.14;
        const count = Math.min(run.kind === "lobby" ? 20 : 8, Math.floor(wTiles * density));
        const foot = this.worldYTop(floor) + FLOOR - 3;
        const x0w = this.worldX(run.x0) + 3;
        const x1w = this.worldX(run.x1 + 1) - 3;
        for (let i = 0; i < count && budget > 0; i++, budget--) {
          const seed = (floor * 131 + run.x0 * 7 + i * 53) | 0;
          // Rank within the run; only the first few show until the tower fills.
          this.spawnWalker(x0w, x1w, foot, foot, seed, 7 + (Math.abs(seed) % 6), (i + 0.5) / count);
        }
      }
    }
    for (const t of this.sim.tower.transports) {
      if (t.kind !== "stairs" && t.kind !== "escalator") continue;
      const x0w = this.worldX(t.x) + 2;
      const x1w = this.worldX(t.x + t.width) - 3;
      const yb = this.worldYTop(t.bottom) + FLOOR - 2;
      const yt = yb - (FLOOR - 4);
      const n = t.kind === "escalator" ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const seed = (t.id * 17 + i * 29) | 0;
        // Low ranks so stairs/escalators show climbers even in a modest tower —
        // otherwise the routed crowd (elevators only) makes stairs look unused.
        this.spawnWalker(x0w, x1w, yb, yt, seed, t.kind === "escalator" ? 12 : 7, 0.04 + i * 0.18);
      }
    }
  }

  private spawnWalker(x0w: number, x1w: number, y0w: number, y1w: number, seed: number, speed: number, rank: number): void {
    const gfx = this.personGfx[Math.abs(seed) % this.personGfx.length];
    const a = new ex.Actor({ pos: ex.vec(x0w, y0w), width: 8, height: 14, anchor: ex.vec(0.5, 1), z: 0.4 });
    a.graphics.use(gfx);
    this.engine.add(a);
    this.walkers.push({
      actor: a,
      gfx,
      x0w,
      x1w,
      y0w,
      y1w,
      speed,
      dir: seed % 2 === 0 ? 1 : -1,
      phase: (Math.abs(seed) % 100) / 100,
      impatient: (((seed >>> 8) & 0xff) / 255) < 0.5,
      red: false,
      rank,
    });
  }

  /** Repositions every moving actor each frame (the engine then draws them). */
  private updateMotion(): void {
    const anim = this.d.anim;
    for (const c of this.carActors) {
      c.actor.pos = ex.vec(this.worldX(c.t.x), -c.t.carPositions[c.i] * FLOOR);
      // Show the actual fill as 0..4 buckets, scaled to THIS cab's capacity, so a
      // big express cab doesn't read "full" at a fraction of its load (review F9).
      const load = c.t.carLoad?.[c.i] ?? 0;
      const cap = TRANSPORT_CAPACITY[c.t.kind] ?? 16;
      const riders = Math.max(0, Math.min(4, Math.round((load / cap) * 4)));
      if (riders !== c.shown) {
        c.shown = riders;
        c.actor.graphics.use(c.gfx[riders]);
      }
    }
    for (const tr of this.trainActors) {
      const cycle = (anim % 12) / 12;
      const span = tr.w + 12;
      let offset: number;
      if (cycle < 0.25) offset = (1 - cycle / 0.25) * -span;
      else if (cycle < 0.75) offset = 0;
      else offset = ((cycle - 0.75) / 0.25) * span;
      tr.actor.pos = ex.vec(this.worldX(tr.u.x) + 3 + offset, this.worldYTop(tr.u.floor) + FLOOR - 15);
    }
    const stress = this.d.stress ?? 0;
    // How busy the building looks right now: scales with population so an empty
    // tower has an empty lobby, and thins out overnight.
    const night = this.sim.clock.isNight();
    const crowd = Math.min(1, this.sim.population / 350) * (night ? 0.35 : 1);
    for (const w of this.walkers) {
      const visible = w.rank <= crowd;
      if (w.actor.graphics.visible !== visible) w.actor.graphics.visible = visible;
      if (!visible) continue;
      let p = w.phase + (w.dir > 0 ? 0 : 0.5) + anim * w.speed * 0.03;
      p -= Math.floor(p);
      // Ping-pong 0→1→0 so figures pace back and forth (and stair climbers go
      // up *and* down) instead of teleporting from the far end back to the
      // start each loop — the old sawtooth made people look like they spawned on
      // one side, ran across, then vanished.
      const tt = 1 - Math.abs(2 * p - 1);
      w.actor.pos = ex.vec(w.x0w + tt * (w.x1w - w.x0w), w.y0w + tt * (w.y1w - w.y0w));
      const red = w.impatient && stress > 0.25;
      if (red !== w.red) {
        w.red = red;
        w.actor.graphics.use(red ? this.personGfxRed : w.gfx);
      }
    }
  }

  private disposeScene(): void {
    for (const a of this.structActors.values()) a.kill();
    for (const a of this.roomActors.values()) a.kill();
    for (const a of this.transportActors.values()) a.kill();
    this.structActors.clear();
    this.roomActors.clear();
    this.roomSig.clear();
    this.transportActors.clear();
    this.transportSig.clear();
    this.clearMotion();
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
    return { centerFloor, dominant, night, zoom: this.cam.zoom, weather: this.sim.weather };
  }

  dispose(): void {
    this.engine.stop();
  }
}

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function buttonNum(ev: ex.PointerEvent): number {
  if (ev.button === ex.PointerButton.Middle) return 1;
  if (ev.button === ex.PointerButton.Right) return 2;
  return 0;
}

function fakeStruct(kind: "floor" | "lobby"): Unit {
  return {
    id: -1,
    kind,
    floor: 1,
    x: 0,
    width: 1,
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
