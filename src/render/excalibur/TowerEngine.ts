import * as ex from "excalibur";
import type { Simulation } from "../../engine/Simulation";
import { facilityFloors } from "../../engine/facilities";
import type { Transport, Unit } from "../../engine/types";
import { drawTransport, drawUnit, type DrawCtx } from "../sprites";
import { person } from "../pixelSprites";

/** World pixels per tile / per floor (matches the legacy renderer's scale). */
export const TILE = 11;
export const FLOOR = 34;

interface Run {
  kind: "floor" | "lobby";
  floor: number;
  x0: number;
  x1: number;
}

/**
 * Renders the tower with the **Excalibur** game engine: Excalibur owns the
 * loop, scene, camera and input + off-screen culling, while each facility,
 * transport and structural run is an Actor whose graphic is an `ex.Canvas`
 * that reuses our existing pixel-art drawing routines. The simulation stays
 * untouched — this is purely a presentation layer on top of it.
 */
export class TowerEngine {
  engine: ex.Engine;
  private sim: Simulation;
  private d: DrawCtx;
  private cacheRev = -1;
  private actors: ex.Actor[] = [];
  private camCtl = { panning: false, lastX: 0, lastY: 0 };

  constructor(canvas: HTMLCanvasElement, sim: Simulation) {
    this.sim = sim;
    this.engine = new ex.Engine({
      canvasElement: canvas,
      displayMode: ex.DisplayMode.FillContainer,
      pixelArt: true,
      antialiasing: false,
      suppressPlayButton: true,
      backgroundColor: ex.Color.fromHex("#0d1018"),
    });
    this.d = { ctx: null as unknown as CanvasRenderingContext2D, lit: false, anim: 0, hour: 9 };

    this.engine.currentScene.onPostUpdate = () => this.onUpdate();
    this.bindInput();
  }

  async start(): Promise<void> {
    await this.engine.start();
    this.centerCamera();
    this.rebuild();
  }

  /** Per-frame: refresh shared draw state and rebuild actors when the tower changes. */
  private onUpdate(): void {
    const c = this.sim.clock;
    this.d.anim = (globalThis.performance ? performance.now() : 0) / 1000;
    this.d.hour = c.hour;
    this.d.lit = c.isNight() || c.isEvening();
    this.engine.backgroundColor = ex.Color.fromHex(c.isNight() ? "#10131f" : "#7fb0e0");
    if (this.sim.tower.revision !== this.cacheRev) this.rebuild();
  }

  // ---- World <-> screen ---------------------------------------------------

  private worldX(tile: number): number {
    return tile * TILE;
  }
  /** Top edge (in world space) of a unit whose bottom floor is `floor`, height `h`. */
  private worldYTop(floor: number, h = 1): number {
    return -(floor + h - 1) * FLOOR;
  }

  // ---- Actor construction -------------------------------------------------

  private clearActors(): void {
    for (const a of this.actors) a.kill();
    this.actors = [];
  }

  private addCanvasActor(px: number, py: number, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, z = 0): void {
    const canvas = new ex.Canvas({
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
      cache: false,
      draw: (ctx) => {
        this.d.ctx = ctx;
        draw(ctx);
      },
    });
    const actor = new ex.Actor({ pos: ex.vec(px, py), width: w, height: h, anchor: ex.vec(0, 0), z });
    actor.graphics.use(canvas);
    this.engine.add(actor);
    this.actors.push(actor);
  }

  /** Recreate all actors from the current simulation state. */
  private rebuild(): void {
    this.clearActors();
    const tower = this.sim.tower;

    // Merge structural tiles into runs.
    const structTiles = new Map<number, Map<number, "floor" | "lobby">>();
    for (const u of tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") {
        let row = structTiles.get(u.floor);
        if (!row) structTiles.set(u.floor, (row = new Map()));
        for (let i = 0; i < u.width; i++) row.set(u.x + i, u.kind);
      }
    }
    for (const [floor, row] of structTiles) {
      for (const run of mergeRuns(floor, row)) this.addRun(run);
    }

    // Rooms / facilities.
    for (const u of tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") continue;
      this.addUnit(u);
    }
    // Transports.
    for (const t of tower.transports) this.addTransport(t);

    this.cacheRev = tower.revision;
  }

  private addRun(r: Run): void {
    const w = (r.x1 - r.x0 + 1) * TILE;
    const fake: Unit = {
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
    this.addCanvasActor(this.worldX(r.x0), this.worldYTop(r.floor), w, FLOOR, (ctx) => {
      drawUnit(this.d, fake, 0, 0, w, FLOOR);
      this.drawRunWalkers(ctx, r, w);
    }, -1);
  }

  private drawRunWalkers(ctx: CanvasRenderingContext2D, r: Run, w: number): void {
    const busy = this.sim.clock.isMorning() || this.sim.clock.isEvening() || this.sim.clock.isLunch();
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
    this.addCanvasActor(this.worldX(u.x), this.worldYTop(u.floor, hgt), w, h, () => {
      drawUnit(this.d, u, 0, 0, w, h);
    });
  }

  private addTransport(t: Transport): void {
    const w = t.width * TILE;
    const h = (t.top - t.bottom + 1) * FLOOR;
    this.addCanvasActor(this.worldX(t.x), this.worldYTop(t.top), w, h, (ctx) => {
      drawTransport(ctx, t, 0, 0, w, FLOOR, this.d.anim);
    }, 1);
  }

  // ---- Camera + input -----------------------------------------------------

  private centerCamera(): void {
    const cam = this.engine.currentScene.camera;
    const hi = this.sim.tower.highestFloor;
    cam.pos = ex.vec(100 * TILE, -(hi / 2) * FLOOR);
    cam.zoom = 0.9;
  }

  private bindInput(): void {
    const p = this.engine.input.pointers.primary;
    p.on("down", (ev) => {
      this.camCtl.panning = true;
      this.camCtl.lastX = ev.screenPos.x;
      this.camCtl.lastY = ev.screenPos.y;
    });
    p.on("move", (ev) => {
      if (!this.camCtl.panning) return;
      const cam = this.engine.currentScene.camera;
      const dx = ev.screenPos.x - this.camCtl.lastX;
      const dy = ev.screenPos.y - this.camCtl.lastY;
      cam.pos = ex.vec(cam.pos.x - dx / cam.zoom, cam.pos.y - dy / cam.zoom);
      this.camCtl.lastX = ev.screenPos.x;
      this.camCtl.lastY = ev.screenPos.y;
    });
    p.on("up", () => (this.camCtl.panning = false));
    p.on("wheel", (ev) => {
      const cam = this.engine.currentScene.camera;
      cam.zoom = Math.max(0.3, Math.min(3, cam.zoom * (ev.deltaY < 0 ? 1.1 : 0.9)));
    });
  }

  dispose(): void {
    this.engine.stop();
  }
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
