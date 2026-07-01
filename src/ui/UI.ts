import { ALL_KINDS, FACILITIES } from "../engine/facilities";
import type { Simulation, LogEntry } from "../engine/Simulation";
import type { SlotInfo } from "../storage/SaveGame";
import type { FacilityCategory, FacilityKind } from "../engine/types";

export type Tool = { type: "build"; kind: FacilityKind } | { type: "bulldoze" } | { type: "inspect" };

const GROUPS: { title: string; cats: FacilityCategory[] }[] = [
  { title: "Structure", cats: ["structure"] },
  { title: "Transport", cats: ["transport"] },
  { title: "Commercial", cats: ["office", "retail", "food"] },
  { title: "Living", cats: ["residential", "hotel"] },
  { title: "Leisure", cats: ["entertainment"] },
  { title: "Services", cats: ["service"] },
  { title: "Special", cats: ["special"] },
];

export interface UICallbacks {
  onSelectTool(tool: Tool): void;
  onSpeed(speed: number): void;
  onSave(): void;
  onLoad(): void;
  onExport(): void;
  onImport(json: string): void;
  onImportLegacy(buffer: ArrayBuffer, filename: string): void;
  onNew(): void;
  onToggleAudio(): boolean; // returns new muted state
  onEditAction(action: string, root: HTMLElement): void;
  onRenameTower(name: string): void;
  onShowStats(): void;
  onShowSaves(): void;
  onSaveSlot(slot: number): void;
  onLoadSlot(slot: number | "auto"): void;
  onDeleteSlot(slot: number): void;
}

/** Owns all DOM controls outside the canvas and keeps them in sync. */
export class UI {
  tool: Tool = { type: "inspect" };
  private cb: UICallbacks;
  private lastLogLen = 0;
  private toastTimers: number[] = [];

  private el = {
    money: document.getElementById("stat-money")!,
    pop: document.getElementById("stat-pop")!,
    star: document.getElementById("stat-star")!,
    time: document.getElementById("stat-time")!,
    date: document.getElementById("stat-date")!,
    palette: document.getElementById("palette-scroll")!,
    toolInfo: document.getElementById("tool-info")!,
    towerStats: document.getElementById("tower-stats")!,
    log: document.getElementById("log")!,
    toast: document.getElementById("toast-wrap")!,
    inspector: document.getElementById("inspector")!,
    editor: document.getElementById("editor")!,
    modal: document.getElementById("modal")!,
    audioToggle: document.getElementById("audio-toggle")!,
    towerName: document.getElementById("tower-name") as HTMLInputElement,
  };

  constructor(cb: UICallbacks) {
    this.cb = cb;
    this.buildPalette();
    this.wireControls();
    this.selectTool({ type: "inspect" });
  }

  private buildPalette(): void {
    const frag = document.createDocumentFragment();

    // Tools row (inspect + bulldoze).
    const toolsTitle = document.createElement("div");
    toolsTitle.className = "pal-group-title";
    toolsTitle.textContent = "Tools";
    frag.appendChild(toolsTitle);
    frag.appendChild(this.toolButton("inspect", "🔍 Inspect", "#9aa6bd"));
    frag.appendChild(this.toolButton("bulldoze", "🧨 Bulldoze", "#ff6b6b"));

    for (const group of GROUPS) {
      const title = document.createElement("div");
      title.className = "pal-group-title";
      title.textContent = group.title;
      frag.appendChild(title);
      for (const kind of ALL_KINDS) {
        const f = FACILITIES[kind];
        if (!group.cats.includes(f.category)) continue;
        frag.appendChild(this.facilityButton(kind));
      }
    }
    this.el.palette.appendChild(frag);
  }

  /** Make a palette div behave like a button for mouse AND keyboard users:
   * focusable, role=button, and activatable with Enter/Space (F48 — a
   * keyboard-only play path). */
  private makeActivatable(item: HTMLElement, label: string, onActivate: () => void): void {
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", label);
    item.addEventListener("click", onActivate);
    item.addEventListener("keydown", (e) => {
      if (e.repeat) return; // a held key must not fire repeatedly (native button semantics)
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        onActivate();
      }
    });
  }

  private toolButton(type: "inspect" | "bulldoze", label: string, color: string): HTMLElement {
    const item = document.createElement("div");
    item.className = "pal-item";
    item.dataset.tool = type;
    item.innerHTML = `<span class="pal-swatch" style="background:${color}"></span><span class="pal-name">${label}</span>`;
    this.makeActivatable(item, label, () => this.selectTool({ type } as Tool));
    return item;
  }

  private facilityButton(kind: FacilityKind): HTMLElement {
    const f = FACILITIES[kind];
    const item = document.createElement("div");
    item.className = "pal-item";
    item.dataset.kind = kind;
    item.innerHTML =
      `<span class="pal-swatch" style="background:${f.color}"></span>` +
      `<span class="pal-name">${f.name}</span>` +
      `<span class="pal-cost">$${shortMoney(f.cost)}</span>`;
    this.makeActivatable(item, `${f.name}, $${shortMoney(f.cost)}`, () => {
      if (item.classList.contains("locked")) {
        this.toast(`${f.name} unlocks at ${f.minStar}★.`, "bad");
        return;
      }
      this.selectTool({ type: "build", kind });
    });
    return item;
  }

  private wireControls(): void {
    document.querySelectorAll<HTMLButtonElement>("#speed button[data-speed]").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#speed button[data-speed]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.cb.onSpeed(Number(b.dataset.speed));
      });
    });

    this.el.audioToggle.addEventListener("click", () => {
      const muted = this.cb.onToggleAudio();
      this.el.audioToggle.textContent = muted ? "🔇" : "🔊";
    });

    document.getElementById("panel-toggle")?.addEventListener("click", () => {
      document.body.classList.toggle("panels-open");
    });
    const closePanels = () => document.body.classList.remove("panels-open");
    document.getElementById("panel-close")?.addEventListener("click", closePanels);
    document.getElementById("scrim")?.addEventListener("click", closePanels);

    document.getElementById("btn-save")!.addEventListener("click", () => this.cb.onSave());
    document.getElementById("btn-load")!.addEventListener("click", () => this.cb.onShowSaves());
    document.getElementById("btn-new")!.addEventListener("click", () => {
      this.confirmModal("Start a new tower?", "This abandons your current tower (it is not auto-saved).", () =>
        this.cb.onNew(),
      );
    });
    document.getElementById("btn-export")!.addEventListener("click", () => this.cb.onExport());
    document.getElementById("btn-import")!.addEventListener("click", () => this.openImport());
    document.getElementById("btn-help")!.addEventListener("click", () => this.showHelp());
    document.getElementById("btn-stats")!.addEventListener("click", () => this.cb.onShowStats());

    this.el.towerName.addEventListener("change", () => {
      this.cb.onRenameTower(this.el.towerName.value.trim() || "Tower One");
    });
  }

  // ---- Selected-facility editor -----------------------------------------

  /** Show the editor card for a selected facility with type-specific actions. */
  showEditor(html: string): void {
    this.el.editor.innerHTML = html;
    this.el.editor.classList.remove("hidden");
    this.el.editor.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) => {
      b.addEventListener("click", () => this.cb.onEditAction(b.dataset.edit!, this.el.editor));
    });
    this.el.editor.querySelector(".ed-close")?.addEventListener("click", () => this.hideEditor());
  }

  hideEditor(): void {
    this.el.editor.classList.add("hidden");
    this.el.editor.innerHTML = "";
  }

  isEditorOpen(): boolean {
    return !this.el.editor.classList.contains("hidden");
  }

  showStats(html: string): void {
    const box = this.openModal(`<h2>Tower Statistics</h2>${html}
      <div class="modal-actions"><button class="primary" data-act="close">Close</button></div>`);
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
  }

  /** Saves manager: auto-save + numbered slots, plus export/import. */
  showSaves(slots: SlotInfo[]): void {
    const fmtWhen = (ms?: number) =>
      ms ? new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
    const row = (s: SlotInfo): string => {
      const name = s.slot === "auto" ? "Auto-save" : `Slot ${s.slot}`;
      const detail = s.exists
        ? `<div class="slot-detail">${escapeHtml(s.towerName ?? "Tower")} · ${s.star === 6 ? "TOWER" : (s.star ?? 1) + "★"} · pop ${(s.population ?? 0).toLocaleString()} · $${Math.round(s.funds ?? 0).toLocaleString()}<br><span class="slot-when">${fmtWhen(s.savedAt)}</span></div>`
        : `<div class="slot-detail slot-empty">empty</div>`;
      const saveBtn =
        s.slot === "auto" ? "" : `<button data-save="${s.slot}">Save</button>`;
      const loadBtn = s.exists ? `<button data-load="${s.slot}">Load</button>` : "";
      const delBtn =
        s.exists && s.slot !== "auto" ? `<button class="danger" data-del="${s.slot}">✕</button>` : "";
      return `<div class="slot"><div class="slot-head"><b>${name}</b>${detail}</div><div class="slot-actions">${saveBtn}${loadBtn}${delBtn}</div></div>`;
    };
    const box = this.openModal(`
      <h2>Saved Towers</h2>
      <div class="slots">${slots.map(row).join("")}</div>
      <div class="modal-actions">
        <button data-act="export">Export JSON</button>
        <button data-act="import">Import JSON</button>
        <button class="primary" data-act="close">Close</button>
      </div>`);
    box.querySelectorAll<HTMLElement>("[data-save]").forEach((b) =>
      b.addEventListener("click", () => {
        this.cb.onSaveSlot(Number(b.dataset.save));
        this.cb.onShowSaves();
      }),
    );
    box.querySelectorAll<HTMLElement>("[data-load]").forEach((b) =>
      b.addEventListener("click", () => {
        const v = b.dataset.load!;
        this.cb.onLoadSlot(v === "auto" ? "auto" : Number(v));
        this.closeModal();
      }),
    );
    box.querySelectorAll<HTMLElement>("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        this.cb.onDeleteSlot(Number(b.dataset.del));
        this.cb.onShowSaves();
      }),
    );
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
    box.querySelector('[data-act="export"]')!.addEventListener("click", () => this.cb.onExport());
    box.querySelector('[data-act="import"]')!.addEventListener("click", () => this.openImport());
  }

  setTowerName(name: string): void {
    if (document.activeElement !== this.el.towerName) this.el.towerName.value = name;
  }

  /** Per-floor stop configuration for an elevator (express service). */
  showStopsDialog(
    title: string,
    floors: { floor: number; stop: boolean; lobby: boolean }[],
    onToggle: (floor: number, stop: boolean) => void,
  ): void {
    const rowsHtml = floors
      .map((fl) => {
        const label = fl.floor > 0 ? `Floor ${fl.floor}` : `B${-fl.floor}`;
        const tag = fl.lobby ? ' <span class="stop-lobby">lobby</span>' : "";
        return `<label class="stop-row"><input type="checkbox" data-floor="${fl.floor}" ${fl.stop ? "checked" : ""}/> <span>${label}${tag}</span></label>`;
      })
      .join("");
    const box = this.openModal(`
      <h2>${escapeHtml(title)} — Stops</h2>
      <p style="color:var(--muted);font-size:12px">Untick a floor to make the car skip it (express service). The top and bottom stay connected.</p>
      <div class="stop-list">${rowsHtml}</div>
      <div class="modal-actions"><button class="primary" data-act="close">Done</button></div>`);
    box.querySelectorAll<HTMLInputElement>("input[data-floor]").forEach((cb) => {
      cb.addEventListener("change", () => onToggle(Number(cb.dataset.floor), cb.checked));
    });
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
  }

  selectTool(tool: Tool): void {
    this.tool = tool;
    this.cb.onSelectTool(tool);
    document.querySelectorAll(".pal-item").forEach((x) => x.classList.remove("active"));
    if (tool.type === "build") {
      document.querySelector(`.pal-item[data-kind="${tool.kind}"]`)?.classList.add("active");
      const f = FACILITIES[tool.kind];
      this.el.toolInfo.innerHTML =
        `<div class="ti-name">${f.name}</div>` +
        `<div>Cost: $${f.cost.toLocaleString()}</div>` +
        (f.population ? `<div>Capacity: ${f.population}</div>` : "") +
        `<p style="margin-top:6px;color:var(--muted)">${f.description}</p>`;
    } else {
      document.querySelector(`.pal-item[data-tool="${tool.type}"]`)?.classList.add("active");
      this.el.toolInfo.innerHTML =
        tool.type === "bulldoze"
          ? "<div class='ti-name'>Bulldoze</div><p style='color:var(--muted)'>Click a room or shaft to sell it for half its cost.</p>"
          : "<div class='ti-name'>Inspect</div><p style='color:var(--muted)'>Hover the tower to read a facility's status.</p>";
    }
  }

  /** Refresh status bar, palette locks, tower stats and the bulletin log. */
  update(sim: Simulation): void {
    this.el.money.textContent = `$${Math.round(sim.money).toLocaleString()}`;
    this.el.money.style.color = sim.money < 0 ? "var(--bad)" : "var(--money)";
    this.el.pop.textContent = sim.population.toLocaleString();
    this.el.star.textContent = sim.star >= 6 ? "TOWER" : "★".repeat(sim.star) + "☆".repeat(5 - sim.star);
    this.el.time.textContent = sim.clock.format();
    this.el.date.textContent = sim.clock.formatRetroDate();

    // Palette unlock state.
    document.querySelectorAll<HTMLElement>(".pal-item[data-kind]").forEach((item) => {
      const kind = item.dataset.kind as FacilityKind;
      const locked = !sim.isUnlocked(kind);
      const affordable = sim.money >= FACILITIES[kind].cost;
      // Dimming lives entirely in CSS (.locked / .unaffordable) so there's a
      // single source of truth for the styling.
      item.classList.toggle("locked", locked);
      item.classList.toggle("unaffordable", !locked && !affordable);
    });

    this.setTowerName(sim.tower.towerName);

    const s = sim.stats();
    this.el.towerStats.innerHTML = `
      <span class="k">Floors</span><span class="v">${s.floors} / B${s.basements}</span>
      <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
      <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
      <span class="k">Hotel (in use)</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
      <span class="k">Rooms to clean</span><span class="v" style="color:${s.dirty ? "var(--bad)" : "inherit"}">${s.dirty}</span>
      <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
      <span class="k">Transports</span><span class="v">${s.transports}</span>
      <span class="k">Vacancies</span><span class="v">${s.vacant}</span>`;

    this.renderLog(sim.log);
  }

  private renderLog(log: LogEntry[]): void {
    if (log.length === this.lastLogLen) return;
    // Newly added entries (and surface important ones as toasts).
    const fresh = log.slice(this.lastLogLen);
    for (const e of fresh) {
      if (e.kind === "good" || e.kind === "bad") this.toast(e.text, e.kind);
    }
    this.lastLogLen = log.length;
    this.el.log.innerHTML = log
      .slice(-40)
      .map((e) => `<div class="log-line ${e.kind}">${escapeHtml(e.text)}</div>`)
      .join("");
  }

  showInspector(html: string | null): void {
    if (!html) {
      this.el.inspector.classList.add("hidden");
      return;
    }
    this.el.inspector.classList.remove("hidden");
    this.el.inspector.innerHTML = html;
  }

  toast(text: string, kind: LogEntry["kind"] = "info"): void {
    const t = document.createElement("div");
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toast.appendChild(t);
    const timer = window.setTimeout(() => {
      t.style.transition = "opacity .3s";
      t.style.opacity = "0";
      window.setTimeout(() => t.remove(), 300);
    }, 3600);
    this.toastTimers.push(timer);
    while (this.el.toast.children.length > 5) this.el.toast.firstElementChild?.remove();
  }

  // ---- Modals ------------------------------------------------------------

  private openModal(html: string): HTMLElement {
    const dialog = this.el.modal as HTMLDialogElement;
    dialog.innerHTML = `<div class="modal-box">${html}</div>`;
    if (!dialog.open) dialog.showModal();
    // Click outside the box (on the backdrop) closes the dialog.
    dialog.onclick = (e) => {
      if (e.target === dialog) this.closeModal();
    };
    dialog.oncancel = () => this.closeModal(); // Esc key
    return dialog.querySelector(".modal-box")!;
  }
  closeModal(): void {
    const dialog = this.el.modal as HTMLDialogElement;
    if (dialog.open) dialog.close();
    dialog.innerHTML = "";
  }

  private confirmModal(title: string, body: string, onYes: () => void): void {
    const box = this.openModal(
      `<h2>${title}</h2><p>${body}</p>
       <div class="modal-actions"><button data-act="no">Cancel</button><button class="primary" data-act="yes">Confirm</button></div>`,
    );
    box.querySelector('[data-act="no"]')!.addEventListener("click", () => this.closeModal());
    box.querySelector('[data-act="yes"]')!.addEventListener("click", () => {
      this.closeModal();
      onYes();
    });
  }

  showExport(json: string): void {
    const box = this.openModal(
      `<h2>Export tower</h2><p>Copy this JSON or download it as a file.</p>
       <textarea readonly>${escapeHtml(json)}</textarea>
       <div class="modal-actions">
         <button data-act="download" class="primary">Download .json</button>
         <button data-act="close">Close</button>
       </div>`,
    );
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
    box.querySelector('[data-act="download"]')!.addEventListener("click", () => {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tower.json";
      a.click();
      URL.revokeObjectURL(url);
    });
    box.querySelector("textarea")?.addEventListener("focus", (e) => (e.target as HTMLTextAreaElement).select());
  }

  private openImport(): void {
    const box = this.openModal(
      `<h2>Import tower</h2>
       <p>Paste a Tower Tycoon JSON export, or choose a file. Original SimTower
       <code>.TWR</code> saves are recognized (full conversion is planned for a future update).</p>
       <textarea placeholder="Paste save JSON here…"></textarea>
       <div class="modal-actions">
         <button data-act="file">Choose file…</button>
         <button data-act="close">Cancel</button>
         <button class="primary" data-act="load">Load</button>
       </div>`,
    );
    const ta = box.querySelector("textarea")!;
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
    box.querySelector('[data-act="load"]')!.addEventListener("click", () => {
      this.closeModal();
      this.cb.onImport(ta.value);
    });
    box.querySelector('[data-act="file"]')!.addEventListener("click", () => {
      const input = document.getElementById("import-file") as HTMLInputElement;
      input.value = "";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        // Binary .TWR legacy saves are read as bytes; JSON exports as text.
        if (/\.twr$/i.test(file.name)) {
          const reader = new FileReader();
          reader.onload = () => {
            this.closeModal();
            this.cb.onImportLegacy(reader.result as ArrayBuffer, file.name);
          };
          reader.readAsArrayBuffer(file);
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            this.closeModal();
            this.cb.onImport(String(reader.result));
          };
          reader.readAsText(file);
        }
      };
      input.click();
    });
  }

  private showHelp(): void {
    const box = this.openModal(`
      <h2>How to play</h2>
      <p>Build a thriving high-rise and earn your way to a coveted <b>TOWER</b> rating.</p>
      <ul>
        <li><b>Floors first.</b> Lay <b>Floor</b> tiles, then place rooms on them.</li>
        <li><b>Move people.</b> Every floor needs an <b>elevator</b> or <b>stairs</b> chain back to the ground lobby, or tenants leave.</li>
        <li><b>Make money.</b> Offices pay quarterly rent, condos sell once, hotels earn nightly, shops &amp; restaurants earn from foot traffic.</li>
        <li><b>Grow your rating.</b> 2★ at 300 pop, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical, Recycling, suites &amp; a VIP), 5★ at 7,000 (needs a Metro).</li>
        <li><b>Win.</b> At 5★ with a Metro station, build the <b>Wedding Hall</b> on floor 100 and pass the VIP inspection.</li>
        <li><b>Sky lobbies</b> every 15 floors keep tall towers moving.</li>
      </ul>
      <p style="color:var(--muted)">Controls: drag to pan, scroll to zoom. Music changes with whatever part of the tower you're viewing — try scrolling around!</p>
      <div class="modal-actions"><button class="primary" data-act="close">Got it</button></div>
    `);
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
  }

  /** A two-choice emergency modal (fire rescue / bomb ransom). Calls `onResolve`
   * with the player's pick. */
  showEventChoice(message: string, costLabel: string, onResolve: (opt: "accept" | "decline") => void): void {
    const box = this.openModal(`
      <h2>⚠️ Emergency</h2>
      <p>${message}</p>
      <div class="modal-actions">
        <button class="primary" data-act="accept">Pay ${costLabel}</button>
        <button data-act="decline">Decline</button>
      </div>
    `);
    const dialog = this.el.modal as HTMLDialogElement;
    // The choice MUST resolve exactly once, no matter how the modal closes —
    // buttons, Esc, or a backdrop click — or the sim (frozen while a choice is
    // open) would deadlock. Dismissing counts as declining.
    let done = false;
    const finish = (opt: "accept" | "decline") => {
      if (done) return;
      done = true;
      this.closeModal();
      onResolve(opt);
    };
    box.querySelector('[data-act="accept"]')!.addEventListener("click", () => finish("accept"));
    box.querySelector('[data-act="decline"]')!.addEventListener("click", () => finish("decline"));
    dialog.onclick = (e) => { if (e.target === dialog) finish("decline"); }; // backdrop
    dialog.oncancel = () => finish("decline"); // Esc
  }

  congratsTower(): void {
    const box = this.openModal(`
      <h2>🏆 TOWER achieved!</h2>
      <p>Your skyscraper has earned the legendary <b>TOWER</b> rating. Wedding bells ring out over the city from the hall on the 100th floor. Congratulations, master builder!</p>
      <div class="modal-actions"><button class="primary" data-act="close">Continue</button></div>
    `);
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
  }
}

function shortMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
