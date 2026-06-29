import { ALL_KINDS, FACILITIES } from "../engine/facilities";
import type { Simulation, LogEntry } from "../engine/Simulation";
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
  onNew(): void;
  onToggleAudio(): boolean; // returns new muted state
  onEditAction(action: string, root: HTMLElement): void;
  onRenameTower(name: string): void;
  onShowStats(): void;
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

  private toolButton(type: "inspect" | "bulldoze", label: string, color: string): HTMLElement {
    const item = document.createElement("div");
    item.className = "pal-item";
    item.dataset.tool = type;
    item.innerHTML = `<span class="pal-swatch" style="background:${color}"></span><span class="pal-name">${label}</span>`;
    item.addEventListener("click", () => this.selectTool({ type } as Tool));
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
    item.addEventListener("click", () => {
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

    document.getElementById("btn-save")!.addEventListener("click", () => this.cb.onSave());
    document.getElementById("btn-load")!.addEventListener("click", () => this.cb.onLoad());
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

  setTowerName(name: string): void {
    if (document.activeElement !== this.el.towerName) this.el.towerName.value = name;
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

    // Palette unlock state.
    document.querySelectorAll<HTMLElement>(".pal-item[data-kind]").forEach((item) => {
      const kind = item.dataset.kind as FacilityKind;
      const locked = !sim.isUnlocked(kind);
      item.classList.toggle("locked", locked);
      const affordable = sim.money >= FACILITIES[kind].cost;
      item.style.opacity = locked ? "0.4" : affordable ? "1" : "0.7";
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
    this.el.modal.innerHTML = `<div class="modal-box">${html}</div>`;
    this.el.modal.classList.remove("hidden");
    return this.el.modal.querySelector(".modal-box")!;
  }
  closeModal(): void {
    this.el.modal.classList.add("hidden");
    this.el.modal.innerHTML = "";
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
      `<h2>Import tower</h2><p>Paste exported JSON, or choose a file.</p>
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
        const reader = new FileReader();
        reader.onload = () => {
          this.closeModal();
          this.cb.onImport(String(reader.result));
        };
        reader.readAsText(file);
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
        <li><b>Grow your rating.</b> 2★ at 300 pop, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical), 5★ at 10,000.</li>
        <li><b>Win.</b> At 5★ with a Metro station, build the <b>Cathedral</b> on floor 100 and pass the VIP inspection.</li>
        <li><b>Sky lobbies</b> every 15 floors keep tall towers moving.</li>
      </ul>
      <p style="color:var(--muted)">Controls: drag to pan, scroll to zoom. Music changes with whatever part of the tower you're viewing — try scrolling around!</p>
      <div class="modal-actions"><button class="primary" data-act="close">Got it</button></div>
    `);
    box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
  }

  congratsTower(): void {
    const box = this.openModal(`
      <h2>🏆 TOWER achieved!</h2>
      <p>Your skyscraper has earned the legendary <b>TOWER</b> rating. The cathedral bells ring out over the city. Congratulations, master builder!</p>
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
