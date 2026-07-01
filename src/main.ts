import { Simulation } from "./engine/Simulation";
import { FACILITIES, GRID, MAX_CARS, facilityFloors, isElevatorKind, isHotelKind } from "./engine/facilities";
import { ECON, rentConfig, rentOf } from "./engine/econConfig";
import type { FacilityKind } from "./engine/types";
import { TowerEngine, type Picked } from "./render/excalibur/TowerEngine";
import { AudioEngine } from "./audio/Audio";
import { SaveGame } from "./storage/SaveGame";
import { parseTWR } from "./storage/twrImport";
import { UI, type Tool } from "./ui/UI";
import { registerPWA } from "./pwa";

/** Game speeds → in-game minutes advanced per real second. */
const SPEEDS = [0, 10, 30, 120];

/** Tiles laid by a single tap/click of the Floor/Lobby tool (a drag extends). */
const STRUCTURE_BRUSH = 8;

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
  /** Lot geometry, exposed for tooling (e.g. the screenshot harness). */
  readonly grid = GRID;
  speed = 1;
  tool: Tool = { type: "inspect" };

  private canvas: HTMLCanvasElement;
  private accMinutes = 0;
  private lastUiUpdate = 0;
  private shownWin = false;
  /** Whether the emergency-choice modal is currently open. */
  private shownChoice = false;
  /** Last star rating we played a promotion jingle for (so 2★–5★ promotions
   * each get the jingle FR-58 promises, not only the final TOWER win). */
  private lastStar = 1;
  /** In-progress transport drag (anchor tile/floor). */
  private transportStart: { x: number; floor: number } | null = null;
  /** Last cell painted while dragging a floor/lobby, so a fast drag lays one
   *  continuous run instead of scattered slabs. */
  private paint: { tile: number; floor: number } | null = null;
  /** Currently selected facility for the edit panel. */
  private selected: { type: "unit" | "transport"; id: number } | null = null;
  /** World cell the hover inspector tooltip is describing, so it can be
   *  anchored to that spot on screen and ride the tower when the camera moves. */
  private inspectAnchor: { x: number; floor: number } | null = null;
  /** Cached so per-frame anchoring doesn't construct a MediaQueryList each tick. */
  private mobileMq = window.matchMedia("(max-width: 860px)");
  /** Whether the panels currently carry an inline anchor (so the mobile branch
   *  only resets them once, not every frame). */
  private panelsAnchored = false;
  /** High-water mark of a shaft's extent during an extend-arrow drag, so a
   *  back-and-forth wiggle is only charged for floors genuinely added. */
  private extendHwm: { id: number; top: number; bottom: number } | null = null;

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
      onSpeed: (s) => {
        this.speed = s;
        this.engine.paused = SPEEDS[s] === 0;
      },
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

    // A press-without-drag: select (inspect) or, on touch, run the tool. The
    // picked entity comes from Excalibur's collider hit-testing.
    this.engine.onTap = (tile, floor, touch, picked) => {
      this.audio.start();
      if (this.tool.type === "inspect") {
        this.selectPicked(picked);
        return;
      }
      if (!touch) return; // mouse pan-taps with a build/bulldoze tool do nothing
      if (this.tool.type === "bulldoze") this.bulldozePicked(picked);
      else if (this.tool.type === "build" && !this.isTransportTool()) {
        if (this.tool.kind === "floor" || this.tool.kind === "lobby") {
          this.paintBrush(this.tool.kind, tile, floor); // wider strip per tap
        } else {
          this.tryBuild(this.tool.kind, floor, this.snapX(this.tool.kind, tile));
        }
      }
    };

    this.engine.onActionDown = (tile, floor, _touch, picked) => {
      this.audio.start();
      if (this.tool.type === "bulldoze") {
        this.bulldozePicked(picked);
      } else if (this.tool.type === "build") {
        if (this.isTransportTool()) {
          this.transportStart = { x: this.snapX(this.tool.kind, tile), floor };
        } else if (this.tool.kind === "floor" || this.tool.kind === "lobby") {
          // A click lays a wider strip; dragging then extends it.
          this.paintBrush(this.tool.kind, tile, floor);
        } else {
          this.tryBuild(this.tool.kind, floor, this.snapX(this.tool.kind, tile));
        }
      }
    };

    this.engine.onActionMove = (tile, floor, picked) => {
      if (this.tool.type === "bulldoze") {
        this.bulldozePicked(picked);
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
        this.paintFloorRun(kind, tile, floor);
      }
    };

    this.engine.onActionUp = () => {
      this.paint = null;
      if (this.tool.type === "build" && this.isTransportTool()) {
        const tp = this.engine.transportPreview;
        if (tp) {
          if (tp.valid) {
            const res = this.sim.buildTransport(tp.kind, tp.x, tp.bottom, tp.top);
            this.audio.sfx(res.ok ? "build" : "error");
            if (!res.ok && res.reason) this.ui.toast(res.reason, "bad");
          } else {
            // Explain *why* it won't go here instead of failing silently.
            this.audio.sfx("error");
            this.ui.toast(this.transportReason(tp.kind, tp.x, tp.bottom, tp.top), "bad");
          }
          this.engine.transportPreview = null;
        } else if (this.transportStart) {
          // Pressed without dragging — teach the drag-to-size gesture.
          this.ui.toast(`Drag up or down to set the ${FACILITIES[this.tool.kind].name.toLowerCase()}'s height.`, "info");
        }
      }
      this.transportStart = null;
    };

    this.engine.onHover = (tile, floor, picked) => {
      if (this.tool.type === "build") {
        this.updateBuildPreview(tile, floor);
      } else {
        this.engine.preview = null;
        this.engine.transportPreview = null;
        if (this.tool.type === "inspect") this.inspectPicked(picked);
      }
    };

    // Right-click inspects whatever's under the cursor, whatever tool is held.
    this.engine.onSecondary = (picked) => this.selectPicked(picked);
    // In-world extend arrows on the selected elevator: drag an end to grow or
    // shrink the shaft floor-by-floor.
    this.engine.onExtendTo = (end, target) => this.extendSelectedTo(end, target);
    this.engine.onExtendEnd = () => (this.extendHwm = null);
    // Suppress the browser context menu so right-click is ours to use.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Per-frame: advance the sim and (throttled) refresh DOM/audio.
    this.engine.onUpdate = (ms) => this.update(ms);
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (e.key >= "0" && e.key <= "3") {
        this.speed = Number(e.key);
        this.engine.paused = SPEEDS[this.speed] === 0;
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
    } else if (kind === "floor" || kind === "lobby") {
      // These tools lay a centered brush strip, not a single tile — so the
      // shadow must span the same run a click will build.
      const tiles = this.brushTiles(tile);
      const left = tiles[0];
      const span = tiles[tiles.length - 1] - left + 1;
      const valid = this.sim.canBuild(kind, floor, this.snapX(kind, tile)).ok;
      this.engine.preview = { kind, floor, x: left, span, valid };
      this.engine.transportPreview = null;
    } else {
      const x = this.snapX(kind, tile);
      // Rooms auto-lay their own floor, so validity comes from canBuild (which
      // accounts for the floor tiles and their cost), not raw canPlace.
      const valid = this.sim.canBuild(kind, floor, x).ok;
      this.engine.preview = { kind, floor, x, valid };
      this.engine.transportPreview = null;
    }
  }

  // ---- Per-frame simulation + UI -----------------------------------------

  private update(dtMs: number): void {
    // While an emergency choice is open, freeze time (canon: the modal pauses the
    // game) so the engine can't auto-resolve the choice out from under the player.
    if (this.shownChoice) {
      this.accMinutes = 0;
      return;
    }
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
      // Keep the open editor's live stats fresh. Refresh now patches only the
      // volatile cells in place (never the buttons or rename input), so this is
      // safe while renaming; the pointer guard still skips the rare full rebuild
      // during an active press.
      if (this.selected && this.ui.isEditorOpen() && !this.ui.isEditorBusy()) {
        this.refreshEditor();
      }
      // A jingle on every star promotion (2★–5★), not just the TOWER win.
      if (this.sim.star > this.lastStar) {
        this.lastStar = this.sim.star;
        if (this.sim.star < 6) this.audio.sfx("promote");
      }
      // Interactive emergency choice (fire rescue / bomb ransom).
      const pc = this.sim.pendingChoice;
      if (pc && !this.shownChoice) {
        this.shownChoice = true;
        this.audio.sfx("error");
        this.ui.showEventChoice(pc.message, `$${pc.cost.toLocaleString()}`, (opt) => {
          this.sim.resolveChoice(opt);
          this.shownChoice = false;
        });
      } else if (!pc && this.shownChoice) {
        this.shownChoice = false; // engine auto-resolved it (player ignored the modal)
      }
      if (this.sim.evaluatedTower && !this.shownWin) {
        this.shownWin = true;
        this.audio.sfx("promote");
        this.ui.congratsTower();
      }
    }

    // World-anchor the editor card and inspector tooltip every frame (cheap —
    // just writes left/top), so they ride the tower as the camera pans/zooms.
    this.positionPanels();
  }

  /** Keep the world-attached DOM panels (selected-facility editor, hover
   *  inspector) pinned to their facility's on-screen position. On mobile they
   *  keep the docked CSS layout instead, to avoid the bottom palette strip. */
  private positionPanels(): void {
    if (this.mobileMq.matches) {
      if (this.panelsAnchored) {
        this.ui.clearPanelAnchors();
        this.panelsAnchored = false;
      }
      return;
    }
    const vw = this.engine.viewWidth;
    const vh = this.engine.viewHeight;
    if (this.selected && this.ui.isEditorOpen()) {
      const r = this.selectedScreenRect();
      if (r) {
        this.ui.anchorEditor(r, vw, vh);
        this.panelsAnchored = true;
      }
    }
    if (this.inspectAnchor && this.ui.isInspectorOpen()) {
      const sx = this.engine.worldToScreenX(this.inspectAnchor.x);
      const sy = this.engine.worldToScreenY(this.inspectAnchor.floor);
      this.ui.anchorInspector(sx, sy, vw, vh);
      this.panelsAnchored = true;
    }
  }

  /** Screen-space rect (top edge) of the currently selected unit/transport,
   *  for the editor card to anchor beside. */
  private selectedScreenRect(): { x: number; y: number; w: number } | null {
    if (!this.selected) return null;
    let left: number, right: number, topFloor: number;
    if (this.selected.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === this.selected!.id);
      if (!u) return null;
      left = u.x;
      right = u.x + u.width;
      topFloor = u.floor + facilityFloors(u.kind) - 1;
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
      if (!t) return null;
      left = t.x;
      right = t.x + t.width;
      topFloor = t.top;
    }
    const sx = this.engine.worldToScreenX(left);
    return { x: sx, y: this.engine.worldToScreenY(topFloor), w: this.engine.worldToScreenX(right) - sx };
  }

  // ---- Selection & per-facility editing ---------------------------------

  /** Select whatever Excalibur reported under the pointer (rooms/transports). */
  private selectPicked(p: Picked | null): void {
    if (!p || p.kind === "floor" || p.kind === "lobby") {
      this.clearSelection();
      return;
    }
    this.selected = { type: p.type, id: p.id };
    this.refreshEditor();
  }

  private clearSelection(): void {
    this.selected = null;
    this.engine.selectedId = null;
    this.ui.hideEditor();
  }

  private refreshEditor(): void {
    if (!this.selected) return;
    // The render key encodes the editor's SHAPE (not its live values): same key
    // → patch the volatile fields in place; different key → full rebuild. The
    // shape only changes when a control appears/disappears (a condo sells and
    // loses its price adjuster; a car button hits its disabled bound), so
    // rebuilds are rare and the buttons/input survive every stat tick.
    if (this.selected.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === this.selected!.id);
      if (!u) return this.clearSelection();
      this.engine.selectedId = u.id;
      const adjuster = !!rentConfig(u.kind) && !(u.kind === "condo" && u.everOccupied);
      // The Booking button label lives in the built HTML, so fold the policy into
      // the key — cycling it bumps the key and rebuilds the button.
      const film = u.kind === "cinema" ? `:${u.filmPolicy ?? "auto"}` : "";
      this.ui.renderEditor(`unit:${u.id}:${adjuster ? "r" : ""}${film}`, () => this.unitEditorHtml(u), this.unitEditorVolatile(u));
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
      if (!t) return this.clearSelection();
      this.engine.selectedId = t.id; // outlines the shaft + shows extend arrows
      const maxCars = MAX_CARS[t.kind] ?? 1;
      const shape = `${t.cars <= 1 ? "-" : ""}${t.cars >= maxCars ? "+" : ""}`;
      this.ui.renderEditor(`transport:${t.id}:${shape}`, () => this.transportEditorHtml(t), this.transportEditorVolatile(t));
    }
  }

  /** The values in the unit editor that change while it stays open, keyed by the
   *  `data-field` on their cell. These are patched in place each refresh so the
   *  buttons and rename input are never rebuilt out from under a click. */
  private unitEditorVolatile(u: import("./engine/types").Unit): Record<string, string> {
    const f = FACILITIES[u.kind];
    const served = this.sim.tower.isFloorServed(u.floor);
    const evalPct = Math.round(u.satisfaction * 100);
    const vol: Record<string, string> = {
      status: u.state,
      served: `<span style="color:${served ? "var(--good)" : "var(--bad)"}">${served ? "Yes" : "No"}</span>`,
      eval: `<span class="evalbar"><span style="width:${evalPct}%"></span></span> ${evalPct}%`,
    };
    if (f.population) vol.occupants = `${u.occupants}/${f.population}`;
    if (rentConfig(u.kind)) {
      vol.rent = `$${rentOf(u).toLocaleString()}${isHotelKind(u.kind) ? "/night" : ""}`;
    }
    if (u.kind === "cinema") {
      const operational = u.state !== "construction" && u.state !== "fire";
      // A mid-build / burning cinema books no film — show "—", not a fake feature.
      vol.showing = !operational ? "—" : this.sim.isShowingBlockbuster(u.id) ? "Blockbuster" : "Feature";
    }
    return vol;
  }

  private unitEditorHtml(u: import("./engine/types").Unit): string {
    const f = FACILITIES[u.kind];
    const floorLabel = u.floor >= 1 ? `Floor ${u.floor}` : `Basement ${1 - u.floor}`;
    const canRename = u.kind === "office" || u.kind === "condo";
    const rcfg = rentConfig(u.kind);
    const vol = this.unitEditorVolatile(u);
    const rows: string[] = [
      `<span class="k">Location</span><span class="v">${floorLabel}</span>`,
      `<span class="k">Status</span><span class="v" data-field="status">${vol.status}</span>`,
    ];
    if (f.population) rows.push(`<span class="k">Occupants</span><span class="v" data-field="occupants">${vol.occupants}</span>`);
    rows.push(`<span class="k">Elevator access</span><span class="v" data-field="served">${vol.served}</span>`);
    rows.push(`<span class="k">Eval</span><span class="v" data-field="eval">${vol.eval}</span>`);
    if (rcfg) {
      const label = u.kind === "condo" ? "Sale price" : isHotelKind(u.kind) ? "Room rate" : "Quarterly rent";
      rows.push(`<span class="k">${label}</span><span class="v" data-field="rent">${vol.rent}</span>`);
    }
    if (u.kind === "cinema") {
      rows.push(`<span class="k">Now showing</span><span class="v" data-field="showing">${vol.showing}</span>`);
    }
    rows.push(`<span class="k">Resale value</span><span class="v">$${Math.floor(f.cost * 0.5).toLocaleString()}</span>`);

    let actions = "";
    if (canRename) {
      actions += `<div class="ed-row"><input data-edit="noop" id="ed-name" value="${escapeAttr(u.label)}" /><button data-edit="rename">Rename</button></div>`;
    }
    // Price adjuster: offices/hotels any time, condos only while still unsold.
    if (rcfg && !(u.kind === "condo" && u.everOccupied)) {
      const what = u.kind === "condo" ? "price" : "rent";
      actions += `<div class="ed-row"><button data-edit="rentDown">– ${what}</button><button data-edit="rentUp">+ ${what}</button></div>`;
    }
    if (u.kind === "cinema") {
      const pol = { auto: "Auto", feature: "Feature", blockbuster: "Blockbuster" }[u.filmPolicy ?? "auto"];
      actions += `<div class="ed-row"><button data-edit="filmPolicy">Booking: ${pol} ▸</button></div>`;
    }
    actions += `<div class="ed-row"><button class="danger" data-edit="sell">Sell / Bulldoze</button></div>`;

    return (
      `<h4>${f.name}<span class="ed-close">✕</span></h4>` +
      `<div class="ed-stats">${rows.join("")}</div>` +
      actions
    );
  }

  private transportEditorVolatile(t: import("./engine/types").Transport): Record<string, string> {
    const isEl = isElevatorKind(t.kind);
    const maxCars = MAX_CARS[t.kind] ?? 1;
    const skipped = t.skipFloors?.length ?? 0;
    const vol: Record<string, string> = {
      serves: `${floorTag(t.bottom)} – ${floorTag(t.top)}`,
      height: `${t.top - t.bottom + 1} floors`,
    };
    if (isEl) {
      vol.cars = `${t.cars} / ${maxCars} max`;
      vol.capacity = `${this.sim.transportCapacity(t)} riders/trip`;
      vol.stops = skipped ? `express · skips ${skipped}` : "all floors";
    }
    return vol;
  }

  private transportEditorHtml(t: import("./engine/types").Transport): string {
    const f = FACILITIES[t.kind];
    const isEl = isElevatorKind(t.kind);
    const maxCars = MAX_CARS[t.kind] ?? 1;
    const vol = this.transportEditorVolatile(t);
    const rows: string[] = [
      `<span class="k">Serves floors</span><span class="v" data-field="serves">${vol.serves}</span>`,
      `<span class="k">Height</span><span class="v" data-field="height">${vol.height}</span>`,
    ];
    if (isEl) {
      rows.push(`<span class="k">Cars</span><span class="v" data-field="cars">${vol.cars}</span>`);
      rows.push(`<span class="k">Capacity</span><span class="v" data-field="capacity">${vol.capacity}</span>`);
      rows.push(`<span class="k">Stops</span><span class="v" data-field="stops">${vol.stops}</span>`);
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

  /** Drag-extend the selected shaft so `end` reaches `targetFloor`. Charges
   *  $5,000 per floor, but only for floors beyond the drag's high-water mark
   *  (so dragging out and back doesn't bill twice). Shrinking is free. */
  private extendSelectedTo(end: "up" | "down", targetFloor: number): void {
    if (!this.selected || this.selected.type !== "transport") return;
    const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
    if (!t || !isElevatorKind(t.kind)) return; // only lifts have extend handles / billing
    if (!this.extendHwm || this.extendHwm.id !== t.id) {
      this.extendHwm = { id: t.id, top: t.top, bottom: t.bottom };
    }
    let nb = t.bottom;
    let nt = t.top;
    if (end === "up") nt = Math.max(t.bottom + 1, targetFloor);
    else nb = Math.min(t.top - 1, targetFloor);

    // Bill only floors past the gesture's high-water mark, and clamp the growth
    // to what the player can afford — so a fast drag grows the shaft as far as
    // the budget allows (matching a slow drag) instead of being rejected, and a
    // broke drag simply stops growing without spamming a toast every frame.
    const PER_FLOOR = ECON.transportFloorCost;
    const budgetFloors = Math.floor(this.sim.money / PER_FLOOR);
    if (nt > this.extendHwm.top) nt = this.extendHwm.top + Math.min(nt - this.extendHwm.top, budgetFloors);
    if (nb < this.extendHwm.bottom) nb = this.extendHwm.bottom - Math.min(this.extendHwm.bottom - nb, budgetFloors);
    if (nb === t.bottom && nt === t.top) return; // nothing changed this step

    const added = Math.max(0, nt - this.extendHwm.top) + Math.max(0, this.extendHwm.bottom - nb);
    const res = this.sim.tower.resizeTransport(t.id, nb, nt);
    if (res.ok) {
      this.sim.money -= added * PER_FLOOR;
      this.extendHwm.top = Math.max(this.extendHwm.top, nt);
      this.extendHwm.bottom = Math.min(this.extendHwm.bottom, nb);
      this.audio.sfx(added > 0 ? "build" : "click");
      this.refreshEditor();
    }
    // A blocked step (cap reached, no structure, another shaft in the way) is
    // silent so a drag doesn't spam toasts; the shaft simply stops growing.
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
      } else if (action === "rentUp" || action === "rentDown") {
        if (this.sim.adjustRent(u.id, action === "rentUp" ? 1 : -1) !== null) {
          this.audio.sfx("click");
          this.refreshEditor();
        }
      } else if (action === "filmPolicy") {
        const order = ["auto", "feature", "blockbuster"] as const;
        const next = order[(order.indexOf(u.filmPolicy ?? "auto") + 1) % order.length];
        this.sim.setFilmPolicy(u.id, next);
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
        const cost = ECON.transportFloorCost;
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
    // Modal-only diagnostics — a full scan and a flood-fill, computed here at
    // modal-build time so they never run on the ~6 Hz HUD stats() path.
    const ratingPop = this.sim.ratingPopulation();
    const parkingWorking = this.sim.tower.functionalParkingSet().size;
    const stranded = this.sim.strandedFloors().length; // BFS-bearing
    // Only when hotels have dropped out of the rating (3★+) and actually diverge.
    const ratingRow =
      s.star >= 3 && ratingPop < s.population
        ? `<span class="k">Counts toward stars</span><span class="v">${fmt(ratingPop)}</span>`
        : "";
    return `<div class="stats-grid">
      <div class="stats-section">Overview</div>
      <div class="col">
        <span class="k">Tower name</span><span class="v">${escapeAttr(this.sim.tower.towerName)}</span>
        <span class="k">Rating</span><span class="v">${s.star >= 6 ? "TOWER" : s.star + "★"}</span>
        <span class="k">Population</span><span class="v">${fmt(s.population)}</span>
        ${ratingRow}
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
        <span class="k">On fire</span><span class="v" style="color:${s.fires ? "var(--bad)" : "var(--good)"}">${s.fires || "None"}</span>
      </div>
      <div class="stats-section">Transport &amp; access</div>
      <div class="col">
        <span class="k">Stranded floors</span><span class="v" style="color:${stranded ? "var(--bad)" : "var(--good)"}">${stranded || "None"}</span>
        ${
          s.parkingSpaces > 0
            ? `<span class="k">Parking spaces</span><span class="v" style="color:${parkingWorking < s.parkingSpaces ? "var(--bad)" : "var(--good)"}">${parkingWorking} / ${s.parkingSpaces} working</span>`
            : ""
        }
      </div>
      ${
        stranded || ratingRow
          ? `<div class="col">${
              stranded
                ? `<span class="k" style="color:var(--muted);grid-column:1/-1">Stranded = leased floors 3+ rides from the lobby; they earn rating but draw no visitors. Add a sky-lobby transfer.</span>`
                : ""
            }${
              ratingRow
                ? `<span class="k" style="color:var(--muted);grid-column:1/-1">Hotel guests count toward your star rating only until 3★.</span>`
                : ""
            }</div>`
          : ""
      }
      ${this.buildMilestonesHtml()}
    </div>`;
  }

  /** The optional-goals checklist for the stats modal. */
  private buildMilestonesHtml(): string {
    const mp = this.sim.milestoneProgress();
    const half = Math.ceil(mp.list.length / 2);
    const col = (items: typeof mp.list) =>
      `<div class="col">${items
        .map(
          (m) =>
            `<span class="k" style="color:${m.done ? "var(--good)" : "var(--muted)"}">${m.done ? "✓" : "·"} ${escapeAttr(m.label)}</span>` +
            `<span class="v" style="color:var(--muted)">${escapeAttr(m.desc)}</span>`,
        )
        .join("")}</div>`;
    return (
      `<div class="stats-section">🏅 Milestones (${mp.achieved}/${mp.total})</div>` +
      col(mp.list.slice(0, half)) +
      col(mp.list.slice(half))
    );
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

  /** Human-readable reason an elevator/stairs span can't be placed. */
  private transportReason(kind: FacilityKind, x: number, bottom: number, top: number): string {
    if (!this.sim.isUnlocked(kind)) {
      return `${FACILITIES[kind].name} unlocks at ${FACILITIES[kind].minStar}★.`;
    }
    const v = this.sim.tower.validateTransport(kind, x, bottom, top);
    return v.reason ?? "A shaft can't go here — leave a clear column through built floors.";
  }

  /**
   * Paint a continuous floor/lobby run as the pointer drags, filling every cell
   * between the last painted tile and this one — so dragging lays one long floor
   * (as in the original) instead of scattered slabs when the drag moves fast.
   * Cells are built outward from the anchor so each is adjacent to existing
   * structure; midair cells simply fail to place, exactly as you'd expect.
   */
  /** Lay a wider centered run of floor/lobby from a single tap, building in
   *  passes so each tile is reached once it has a supported neighbor. */
  /** The tiles a single floor/lobby tap paints — a strip centered on the
   *  cursor, clamped to the lot. Shared by the placement and its preview so the
   *  shadow always matches what a click lays down. */
  private brushTiles(tile: number): number[] {
    const clampX = (x: number) => Math.max(0, Math.min(GRID.width - 1, x));
    const half = Math.floor(STRUCTURE_BRUSH / 2);
    const tiles: number[] = [];
    for (let d = -half; d < STRUCTURE_BRUSH - half; d++) tiles.push(clampX(tile + d));
    return tiles;
  }

  private paintBrush(kind: FacilityKind, tile: number, floor: number): void {
    const tiles = this.brushTiles(tile);
    let progress = true;
    while (progress) {
      progress = false;
      for (const tx of tiles) {
        if (this.sim.tower.hasStructure(floor, tx)) continue;
        if (this.sim.build(kind, floor, tx).ok) progress = true;
      }
    }
    this.paint = { tile, floor };
  }

  private paintFloorRun(kind: FacilityKind, tile: number, floor: number): void {
    const clampX = (x: number) => Math.max(0, Math.min(GRID.width - 1, x));
    if (!this.paint || this.paint.floor !== floor) {
      this.tryBuild(kind, floor, clampX(tile), true);
      this.paint = { tile, floor };
      return;
    }
    const step = tile >= this.paint.tile ? 1 : -1;
    for (let x = this.paint.tile + step; x !== tile + step; x += step) {
      this.tryBuild(kind, floor, clampX(x), true);
    }
    this.paint = { tile, floor };
  }

  /** Bulldoze whatever Excalibur reported under the pointer, with a refund. */
  private bulldozePicked(p: Picked | null): void {
    if (!p) return;
    if (p.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === p.id);
      if (!u) return;
      this.sim.tower.removeUnit(u.id);
      this.sim.money += Math.floor(FACILITIES[u.kind].cost * 0.5);
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === p.id);
      if (!t) return;
      this.sim.tower.removeTransport(t.id);
      this.sim.money += Math.floor(FACILITIES[t.kind].cost * 0.5);
    }
    this.audio.sfx("sell");
    if (this.selected && this.selected.id === p.id) this.clearSelection();
  }

  private inspectPicked(p: Picked | null): void {
    if (!p || p.kind === "floor" || p.kind === "lobby") {
      this.inspectAnchor = null;
      this.ui.showInspector(null);
      return;
    }
    if (p.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === p.id);
      if (!u) {
        this.inspectAnchor = null;
        return this.ui.showInspector(null);
      }
      this.inspectAnchor = { x: u.x + u.width, floor: u.floor + facilityFloors(u.kind) - 1 };
      const f = FACILITIES[u.kind];
      // Access — the whole truth, not just "served": a floor can be connected yet
      // sit 3+ rides from the lobby, in which case no commuter ever comes. Only
      // shown for units that actually draw commuters/visitors (tenants + venues);
      // parking/service work via ramp-chaining/coverage, not passenger trips, so
      // an access warning on them would be a false alarm.
      const needsAccess = f.population > 0 || ECON.dailyTrafficIncome[u.kind] !== undefined;
      const served = this.sim.tower.isFloorServed(u.floor);
      const access = !needsAccess
        ? ""
        : !served
          ? `<div style="color:var(--bad)">Access: not connected — no elevator or stair reaches this floor.</div>`
          : this.sim.floorReachable(u.floor)
            ? `<div style="color:var(--good)">Access: reachable (≤2 rides from the lobby).</div>`
            : `<div style="color:var(--bad)">Access: too far — 3+ rides from the lobby, so no one travels here. Add a sky-lobby transfer.</div>`;
      // Silent rule: hotel guests stop counting toward the star rating at 3★.
      const hotel = isHotelKind(u.kind)
        ? this.sim.hotelsCountTowardRating()
          ? `<div style="color:var(--good)">Counts toward next star: yes.</div>`
          : `<div style="color:var(--bad)">Counts toward stars: no — hotel guests stop counting at 3★ (they still earn income).</div>`
        : "";
      // Silent rule: a parking space only works when it chains to a ramp. Skip
      // the verdict while it's still building (or on fire) — "Status" covers that.
      const parking =
        u.kind === "parking" && u.state !== "construction" && u.state !== "fire"
          ? this.sim.tower.functionalParkingSet().has(u.id)
            ? `<div style="color:var(--good)">Ramp access: connected.</div>`
            : `<div style="color:var(--bad)">Ramp access: none — this space is dead (no relief). Chain it to a Parking Ramp.</div>`
          : "";
      this.ui.showInspector(
        `<h4>${f.name}</h4>` +
          `<div>${u.label !== f.name ? u.label + "<br>" : ""}${u.floor >= 1 ? "Floor " + u.floor : "B" + (1 - u.floor)}</div>` +
          `<div>Status: ${u.state}</div>` +
          (f.population ? `<div>Occupants: ${u.occupants}/${f.population}</div>` : "") +
          access +
          hotel +
          parking +
          `<div>Satisfaction: ${Math.round(u.satisfaction * 100)}%</div>`,
      );
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === p.id);
      if (!t) {
        this.inspectAnchor = null;
        return this.ui.showInspector(null);
      }
      this.inspectAnchor = { x: t.x + t.width, floor: t.top };
      const f = FACILITIES[t.kind];
      this.ui.showInspector(
        `<h4>${f.name}</h4><div>Serves floors ${floorTag(t.bottom)}–${floorTag(t.top)}</div>` +
          (isElevatorKind(t.kind) ? `<div>Cars: ${t.cars}</div>` : ""),
      );
    }
  }

  // ---- Save / load / new --------------------------------------------------

  /** Swap in a freshly loaded/created simulation and point the engine at it. */
  private adoptSim(sim: Simulation): void {
    this.sim = sim;
    this.clearSelection();
    this.shownWin = false;
    this.lastStar = sim.star;
    this.accMinutes = 0;
    this.engine.setSim(sim);
  }

  private save(silent = false): void {
    SaveGame.save(this.sim);
    if (!silent) this.ui.toast("Tower saved.", "good");
  }

  /**
   * Called by the PWA layer the instant a new version is ready, just before it
   * reloads onto the new assets. Flush the tower to the autosave slot so the
   * imminent reload can't cost the player any progress, and tell them what's
   * happening through the existing toast rail.
   */
  onUpdateReady(): void {
    this.save(true);
    this.ui.toast("New version ready — saved your tower, updating…", "info");
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

/** Short floor tag: "5" above ground, "B1"/"B2"… below (floor 0 = B1). */
function floorTag(floor: number): string {
  return floor >= 1 ? `${floor}` : `B${1 - floor}`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The renderer needs WebGL; some in-app file viewers don't provide it. */
function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function showBootMessage(msg: string): void {
  const stage = document.getElementById("stage");
  if (stage) {
    stage.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:#cdd3da;font:15px/1.5 system-ui,sans-serif">${msg}</div>`;
  }
}

// Bootstrap once the DOM is ready.
if (typeof document !== "undefined") {
  const boot = () => {
    if (!hasWebGL()) {
      showBootMessage(
        "This viewer can't run WebGL, which Tower Tycoon needs to draw the tower.<br><br>Open this page in <b>Safari</b>, <b>Chrome</b>, or another full web browser to play.",
      );
      return;
    }
    try {
      const app = new GameApp();
      // Expose for screenshot tooling / debugging.
      (window as unknown as { game: GameApp }).game = app;
      // Register the service worker so the game is installable and offline-ready.
      // On a new build: quick-save the tower, then swap to the latest assets.
      registerPWA({ onUpdateReady: () => app.onUpdateReady() });
    } catch (err) {
      showBootMessage("Something went wrong starting the game: " + (err as Error).message);
      throw err;
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

export { GameApp };
