import { Simulation } from "./engine/Simulation";
import { FACILITIES, GRID, MAX_CARS, isElevatorKind } from "./engine/facilities";
import type { FacilityKind } from "./engine/types";
import { TowerEngine } from "./render/excalibur/TowerEngine";
import { AudioEngine } from "./audio/Audio";
import { SaveGame } from "./storage/SaveGame";
import { parseTWR } from "./storage/twrImport";
import { UI, type Tool } from "./ui/UI";

/** Game speeds → in-game minutes advanced per real second. */
const SPEEDS = [0, 30, 120, 480];

/**
 * The game controller. Excalibur (via {@link TowerEngine}) owns the render
 * loop, scene, camera, panning, zooming and pointer input; this class supplies
 * the tool semantics through the engine's controller hooks, ticks the
 * simulation from the engine's per-frame `onUpdate`, and drives the DOM UI.
 */
class GameApp {
  sim: Simulation;
  engine: TowerEngine;
  audio = new AudioEngine();
  ui: UI;
  speed = 1;
  tool: Tool = { type: "inspect" };

  private canvas: HTMLCanvasElement;
  private accMinutes = 0;
  private lastUiUpdate = 0;
  private shownWin = false;
  /** In-progress transport drag (anchor tile/floor). */
  private transportStart: { x: number; floor: number } | null = null;
  /** Currently selected facility for the edit panel. */
  private selected: { type: "unit" | "transport"; id: number } | null = null;

  constructor() {
    this.canvas = document.getElementById("view") as HTMLCanvasElement;
    this.sim = SaveGame.load() ?? Simulation.newGame(Date.parse("2024-01-01"));
    this.engine = new TowerEngine(this.canvas, this.sim);
    this.ui = new UI({
      onSelectTool: (t) => {
        this.tool = t;
        this.engine.preview = null;
        this.engine.transportPreview = null;
      },
      onSpeed: (s) => (this.speed = s),
      onSave: () => this.save(),
      onLoad: () => this.load(),
      onExport: () => this.ui.showExport(SaveGame.export(this.sim)),
      onImport: (json) => this.importGame(json),
      onImportLegacy: (buf, name) => this.importLegacy(buf, name),
      onNew: () => this.newGame(),
      onToggleAudio: () => {
        this.audio.start();
        this.audio.setMuted(!this.audio.muted);
        return this.audio.muted;
      },
      onEditAction: (action, root) => this.handleEditAction(action, root),
      onRenameTower: (name) => (this.sim.tower.towerName = name),
      onShowStats: () => this.ui.showStats(this.buildStatsHtml()),
      onShowSaves: () => this.ui.showSaves(SaveGame.listSlots()),
      onSaveSlot: (n) => {
        SaveGame.saveSlot(n, this.sim);
        this.ui.toast(`Saved to slot ${n}.`, "good");
      },
      onLoadSlot: (slot) => {
        const loaded = slot === "auto" ? SaveGame.load() : SaveGame.loadSlot(slot);
        if (loaded) {
          this.adoptSim(loaded);
          this.ui.toast("Tower loaded.", "good");
        } else {
          this.ui.toast("That slot is empty or corrupt.", "bad");
        }
      },
      onDeleteSlot: (n) => {
        SaveGame.deleteSlot(n);
        this.ui.toast(`Deleted slot ${n}.`, "info");
      },
    });

    this.wireEngine();
    this.bindKeys();
    void this.engine.start();

    // Autosave periodically.
    window.setInterval(() => this.save(true), 30000);
  }

  // ---- Engine wiring (all input/camera goes through Excalibur) ------------

  private wireEngine(): void {
    // Decide whether a press pans the camera or performs the active tool.
    this.engine.classifyDown = (button, touch, space) => {
      if (button > 0 || space) return "pan"; // middle/right button or held space
      if (this.tool.type === "inspect") return "pan"; // inspect: drag pans, tap selects
      if (touch && !this.isTransportTool()) return "pan"; // one finger pans; tap acts
      return "action";
    };

    // A press-without-drag: select (inspect) or, on touch, run the tool.
    this.engine.onTap = (tile, floor, touch) => {
      this.audio.start();
      if (this.tool.type === "inspect") {
        this.selectAt(floor, tile);
        return;
      }
      if (!touch) return; // mouse pan-taps with a build/bulldoze tool do nothing
      if (this.tool.type === "bulldoze") this.doBulldoze(floor, tile);
      else if (this.tool.type === "build" && !this.isTransportTool()) {
        this.tryBuild(this.tool.kind, floor, this.snapX(this.tool.kind, tile));
      }
    };

    this.engine.onActionDown = (tile, floor) => {
      this.audio.start();
      if (this.tool.type === "bulldoze") {
        this.doBulldoze(floor, tile);
      } else if (this.tool.type === "build") {
        if (this.isTransportTool()) {
          this.transportStart = { x: this.snapX(this.tool.kind, tile), floor };
        } else {
          // Structure paints as you drag; rooms place once here.
          this.tryBuild(this.tool.kind, floor, this.snapX(this.tool.kind, tile));
        }
      }
    };

    this.engine.onActionMove = (tile, floor) => {
      if (this.tool.type === "bulldoze") {
        this.doBulldoze(floor, tile);
        return;
      }
      if (this.tool.type !== "build") return;
      const kind = this.tool.kind;
      if (this.isTransportTool() && this.transportStart) {
        const bottom = Math.min(this.transportStart.floor, floor);
        const top = Math.max(this.transportStart.floor, floor);
        const x = this.transportStart.x;
        const valid = this.sim.tower.placeTransportDryRun(kind, x, bottom, top) && this.sim.isUnlocked(kind);
        this.engine.transportPreview = { kind, x, bottom, top, valid };
        this.engine.preview = null;
      } else if (kind === "floor" || kind === "lobby") {
        this.tryBuild(kind, floor, this.snapX(kind, tile), true);
      }
    };

    this.engine.onActionUp = () => {
      if (this.tool.type === "build" && this.isTransportTool() && this.engine.transportPreview) {
        const tp = this.engine.transportPreview;
        if (tp.valid) {
          const res = this.sim.buildTransport(tp.kind, tp.x, tp.bottom, tp.top);
          this.audio.sfx(res.ok ? "build" : "error");
          if (!res.ok && res.reason) this.ui.toast(res.reason, "bad");
        }
        this.engine.transportPreview = null;
      }
      this.transportStart = null;
    };

    this.engine.onHover = (tile, floor) => {
      if (this.tool.type === "build") {
        this.updateBuildPreview(tile, floor);
      } else {
        this.engine.preview = null;
        this.engine.transportPreview = null;
        if (this.tool.type === "inspect") this.updateInspector(floor, tile);
      }
    };

    // Per-frame: advance the sim and (throttled) refresh DOM/audio.
    this.engine.onUpdate = (ms) => this.update(ms);
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (e.key >= "0" && e.key <= "3") {
        this.speed = Number(e.key);
        document.querySelectorAll("#speed button[data-speed]").forEach((b) =>
          b.classList.toggle("active", (b as HTMLElement).dataset.speed === e.key),
        );
      }
    });
    // First interaction starts audio (browser autoplay policy).
    const kick = () => this.audio.start();
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
  }

  private isTransportTool(): boolean {
    return this.tool.type === "build" && !!FACILITIES[this.tool.kind].transport;
  }

  private updateBuildPreview(tile: number, floor: number): void {
    if (this.tool.type !== "build") {
      this.engine.preview = null;
      this.engine.transportPreview = null;
      return;
    }
    const kind = this.tool.kind;
    if (this.isTransportTool()) {
      const x = this.snapX(kind, tile);
      this.engine.transportPreview = null;
      this.engine.preview = { kind, floor, x, valid: this.sim.isUnlocked(kind) };
    } else {
      const x = this.snapX(kind, tile);
      const valid =
        this.sim.isUnlocked(kind) &&
        this.sim.tower.canPlace(kind, floor, x).ok &&
        this.sim.money >= FACILITIES[kind].cost;
      this.engine.preview = { kind, floor, x, valid };
      this.engine.transportPreview = null;
    }
  }

  // ---- Per-frame simulation + UI -----------------------------------------

  private update(dtMs: number): void {
    const minutesPerSecond = SPEEDS[this.speed] ?? 0;
    this.accMinutes += (dtMs / 1000) * minutesPerSecond;
    // Step the simulation in small chunks so hourly/daily boundaries fire.
    let guard = 0;
    while (this.accMinutes >= 1 && guard++ < 2000) {
      const step = Math.min(20, this.accMinutes);
      this.sim.tick(step);
      this.accMinutes -= step;
    }

    // Throttle the comparatively expensive DOM/audio updates (~6Hz) so a busy
    // tower never makes panning feel sluggish.
    const now = globalThis.performance ? performance.now() : 0;
    if (now - this.lastUiUpdate > 160) {
      this.lastUiUpdate = now;
      this.audio.update(this.engine.focus());
      this.ui.update(this.sim);
      // Keep the open editor's live stats fresh (unless the user is typing).
      if (this.selected && this.ui.isEditorOpen()) {
        const editing = document.activeElement?.id === "ed-name";
        if (!editing) this.refreshEditor();
      }
      if (this.sim.evaluatedTower && !this.shownWin) {
        this.shownWin = true;
        this.audio.sfx("promote");
        this.ui.congratsTower();
      }
    }
  }

  // ---- Selection & per-facility editing ---------------------------------

  private selectAt(floor: number, tile: number): void {
    const room = this.sim.tower.roomAt(floor, tile);
    const transport = this.sim.tower.transportAt(floor, tile);
    if (room && room.kind !== "floor" && room.kind !== "lobby") {
      this.selected = { type: "unit", id: room.id };
    } else if (transport) {
      this.selected = { type: "transport", id: transport.id };
    } else {
      this.clearSelection();
      return;
    }
    this.refreshEditor();
  }

  private clearSelection(): void {
    this.selected = null;
    this.engine.selectedId = null;
    this.ui.hideEditor();
  }

  private refreshEditor(): void {
    if (!this.selected) return;
    if (this.selected.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === this.selected!.id);
      if (!u) return this.clearSelection();
      this.engine.selectedId = u.id;
      this.ui.showEditor(this.unitEditorHtml(u));
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
      if (!t) return this.clearSelection();
      this.engine.selectedId = null;
      this.ui.showEditor(this.transportEditorHtml(t));
    }
  }

  private unitEditorHtml(u: import("./engine/types").Unit): string {
    const f = FACILITIES[u.kind];
    const served = this.sim.tower.isFloorServed(u.floor);
    const floorLabel = u.floor >= 1 ? `Floor ${u.floor}` : `Basement ${1 - u.floor}`;
    const canRename = u.kind === "office" || u.kind === "condo";
    const rows: string[] = [
      `<span class="k">Location</span><span class="v">${floorLabel}</span>`,
      `<span class="k">Status</span><span class="v">${u.state}</span>`,
    ];
    if (f.population) rows.push(`<span class="k">Occupants</span><span class="v">${u.occupants}/${f.population}</span>`);
    rows.push(`<span class="k">Elevator access</span><span class="v" style="color:${served ? "var(--good)" : "var(--bad)"}">${served ? "Yes" : "No"}</span>`);
    rows.push(`<span class="k">Satisfaction</span><span class="v">${Math.round(u.satisfaction * 100)}%</span>`);
    rows.push(`<span class="k">Resale value</span><span class="v">$${Math.floor(f.cost * 0.5).toLocaleString()}</span>`);

    let actions = "";
    if (canRename) {
      actions += `<div class="ed-row"><input data-edit="noop" id="ed-name" value="${escapeAttr(u.label)}" /><button data-edit="rename">Rename</button></div>`;
    }
    actions += `<div class="ed-row"><button class="danger" data-edit="sell">Sell / Bulldoze</button></div>`;

    return (
      `<h4>${f.name}<span class="ed-close">✕</span></h4>` +
      `<div class="ed-stats">${rows.join("")}</div>` +
      actions
    );
  }

  private transportEditorHtml(t: import("./engine/types").Transport): string {
    const f = FACILITIES[t.kind];
    const isEl = isElevatorKind(t.kind);
    const maxCars = MAX_CARS[t.kind] ?? 1;
    const skipped = t.skipFloors?.length ?? 0;
    const rows: string[] = [
      `<span class="k">Serves floors</span><span class="v">${t.bottom} – ${t.top}</span>`,
      `<span class="k">Height</span><span class="v">${t.top - t.bottom + 1} floors</span>`,
    ];
    if (isEl) {
      rows.push(`<span class="k">Cars</span><span class="v">${t.cars} / ${maxCars} max</span>`);
      rows.push(`<span class="k">Capacity</span><span class="v">${this.sim.transportCapacity(t)} riders/trip</span>`);
      rows.push(`<span class="k">Stops</span><span class="v">${skipped ? `express · skips ${skipped}` : "all floors"}</span>`);
    }
    rows.push(`<span class="k">Resale value</span><span class="v">$${Math.floor(f.cost * 0.5).toLocaleString()}</span>`);

    let actions = "";
    if (isEl) {
      actions += `<div class="ed-row"><button data-edit="removecar"${t.cars <= 1 ? " disabled" : ""}>– Car</button><button data-edit="addcar"${t.cars >= maxCars ? " disabled" : ""}>+ Car</button></div>`;
      actions += `<div class="ed-row"><button data-edit="stops">Configure stops…</button></div>`;
      actions += `<div class="ed-row"><button data-edit="express">Express (lobbies)</button><button data-edit="allstops">All stops</button></div>`;
    }
    actions += `<div class="ed-row"><button data-edit="extendDown">▼ Extend down</button><button data-edit="extendUp">▲ Extend up</button></div>`;
    actions += `<div class="ed-row"><button class="danger" data-edit="sell">Sell / Bulldoze</button></div>`;

    return (
      `<h4>${f.name}<span class="ed-close">✕</span></h4>` +
      `<div class="ed-stats">${rows.join("")}</div>` +
      actions
    );
  }

  /** Open the per-floor stop-configuration dialog for the selected elevator. */
  private openStopsDialog(): void {
    if (!this.selected || this.selected.type !== "transport") return;
    const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
    if (!t) return;
    const lobbies = new Set(this.sim.tower.lobbyFloors());
    const floors: { floor: number; stop: boolean; lobby: boolean }[] = [];
    for (let fl = t.top; fl >= t.bottom; fl--) {
      floors.push({ floor: fl, stop: this.sim.tower.stopsAt(t, fl), lobby: lobbies.has(fl) });
    }
    this.ui.showStopsDialog(FACILITIES[t.kind].name, floors, (floor, stop) => {
      this.sim.tower.setStop(t.id, floor, stop);
      this.refreshEditor();
    });
  }

  private handleEditAction(action: string, root: HTMLElement): void {
    if (!this.selected) return;
    if (this.selected.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === this.selected!.id);
      if (!u) return this.clearSelection();
      if (action === "sell") {
        this.sim.tower.removeUnit(u.id);
        this.sim.money += Math.floor(FACILITIES[u.kind].cost * 0.5);
        this.audio.sfx("sell");
        return this.clearSelection();
      }
      if (action === "rename") {
        const input = root.querySelector<HTMLInputElement>("#ed-name");
        if (input) u.label = input.value.trim() || FACILITIES[u.kind].name;
        this.audio.sfx("click");
        this.refreshEditor();
      }
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
      if (!t) return this.clearSelection();
      if (action === "sell") {
        this.sim.tower.removeTransport(t.id);
        this.sim.money += Math.floor(FACILITIES[t.kind].cost * 0.5);
        this.audio.sfx("sell");
        return this.clearSelection();
      }
      if (action === "addcar") {
        if (this.sim.tower.setCars(t.id, t.cars + 1)) this.sim.money -= 40000;
        this.audio.sfx("build");
        this.refreshEditor();
      } else if (action === "removecar") {
        this.sim.tower.setCars(t.id, t.cars - 1);
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "stops") {
        this.openStopsDialog();
      } else if (action === "express") {
        this.sim.tower.setExpressStops(t.id);
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "allstops") {
        this.sim.tower.clearStops(t.id);
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "extendUp" || action === "extendDown") {
        const nb = action === "extendDown" ? t.bottom - 1 : t.bottom;
        const nt = action === "extendUp" ? t.top + 1 : t.top;
        const cost = 5000;
        if (this.sim.money < cost) {
          this.ui.toast("Not enough money.", "bad");
          return;
        }
        const res = this.sim.tower.resizeTransport(t.id, nb, nt);
        if (res.ok) {
          this.sim.money -= cost;
          this.audio.sfx("build");
        } else if (res.reason) {
          this.audio.sfx("error");
          this.ui.toast(res.reason, "bad");
        }
        this.refreshEditor();
      }
    }
  }

  private buildStatsHtml(): string {
    const s = this.sim.stats();
    const c = this.sim.clock;
    const next = this.sim.nextStarThreshold;
    const fmt = (n: number) => n.toLocaleString();
    return `<div class="stats-grid">
      <div class="stats-section">Overview</div>
      <div class="col">
        <span class="k">Tower name</span><span class="v">${escapeAttr(this.sim.tower.towerName)}</span>
        <span class="k">Rating</span><span class="v">${s.star >= 6 ? "TOWER" : s.star + "★"}</span>
        <span class="k">Population</span><span class="v">${fmt(s.population)}</span>
        <span class="k">Next star at</span><span class="v">${next ? fmt(next) : "—"}</span>
        <span class="k">Funds</span><span class="v">$${fmt(Math.round(this.sim.money))}</span>
        <span class="k">Date</span><span class="v">${c.dayName}, day ${c.day + 1}</span>
      </div>
      <div class="col">
        <span class="k">Floors above</span><span class="v">${s.floors}</span>
        <span class="k">Basements</span><span class="v">${s.basements}</span>
        <span class="k">Elevators</span><span class="v">${s.elevators}</span>
        <span class="k">All transports</span><span class="v">${s.transports}</span>
      </div>
      <div class="stats-section">Tenancy</div>
      <div class="col">
        <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
        <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
        <span class="k">Vacancies</span><span class="v">${s.vacant}</span>
      </div>
      <div class="col">
        <span class="k">Hotel rooms in use</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
        <span class="k">Rooms to clean</span><span class="v">${s.dirty}</span>
        <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
      </div>
    </div>`;
  }

  private snapX(kind: FacilityKind, tile: number): number {
    const w = FACILITIES[kind].width;
    return Math.max(0, Math.min(GRID.width - w, tile));
  }

  // ---- Actions -----------------------------------------------------------

  private tryBuild(kind: FacilityKind, floor: number, x: number, quiet = false): void {
    const res = this.sim.build(kind, floor, x);
    if (res.ok) {
      if (!quiet) this.audio.sfx("build");
    } else if (!quiet && res.reason) {
      this.audio.sfx("error");
      this.ui.toast(res.reason, "bad");
    }
  }

  private doBulldoze(floor: number, tile: number): void {
    if (this.sim.sellAt(floor, tile)) this.audio.sfx("sell");
  }

  private updateInspector(floor: number, tile: number): void {
    const u = this.sim.tower.unitAt(floor, tile);
    const t = this.sim.tower.transportAt(floor, tile);
    if (u && u.kind !== "floor") {
      const f = FACILITIES[u.kind];
      const served = this.sim.tower.isFloorServed(u.floor) ? "Yes" : "No";
      this.ui.showInspector(
        `<h4>${f.name}</h4>` +
          `<div>${u.label !== f.name ? u.label + "<br>" : ""}${floor >= 1 ? "Floor " + floor : "B" + (1 - floor)}</div>` +
          `<div>Status: ${u.state}</div>` +
          (f.population ? `<div>Occupants: ${u.occupants}/${f.population}</div>` : "") +
          `<div>Served by elevator: ${served}</div>` +
          `<div>Satisfaction: ${Math.round(u.satisfaction * 100)}%</div>`,
      );
    } else if (t) {
      const f = FACILITIES[t.kind];
      this.ui.showInspector(
        `<h4>${f.name}</h4><div>Serves floors ${t.bottom}–${t.top}</div>` +
          (isElevatorKind(t.kind) ? `<div>Cars: ${t.cars}</div>` : ""),
      );
    } else {
      this.ui.showInspector(null);
    }
  }

  // ---- Save / load / new --------------------------------------------------

  /** Swap in a freshly loaded/created simulation and point the engine at it. */
  private adoptSim(sim: Simulation): void {
    this.sim = sim;
    this.clearSelection();
    this.shownWin = false;
    this.accMinutes = 0;
    this.engine.setSim(sim);
  }

  private save(silent = false): void {
    SaveGame.save(this.sim);
    if (!silent) this.ui.toast("Tower saved.", "good");
  }
  private load(): void {
    const loaded = SaveGame.load();
    if (loaded) {
      this.adoptSim(loaded);
      this.ui.toast("Tower loaded.", "good");
    } else {
      this.ui.toast("No saved tower found.", "bad");
    }
  }
  private importGame(json: string): void {
    try {
      this.adoptSim(SaveGame.import(json));
      this.ui.toast("Tower imported.", "good");
    } catch (err) {
      this.ui.toast("Import failed: " + (err as Error).message, "bad");
    }
  }

  private importLegacy(buffer: ArrayBuffer, filename: string): void {
    try {
      const data = parseTWR(buffer);
      this.adoptSim(Simulation.deserialize(data));
      this.ui.toast("Imported original SimTower save.", "good");
    } catch (err) {
      // Expected today: the .TWR decoder is a planned v2 feature.
      this.ui.toast((err as Error).message, "info");
      void filename;
    }
  }
  private newGame(): void {
    this.adoptSim(Simulation.newGame(Date.now() & 0x7fffffff));
    this.ui.toast("New tower founded. Good luck!", "good");
  }
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Bootstrap once the DOM is ready.
if (typeof document !== "undefined") {
  const boot = () => {
    const app = new GameApp();
    // Expose for screenshot tooling / debugging.
    (window as unknown as { game: GameApp }).game = app;
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

export { GameApp };
