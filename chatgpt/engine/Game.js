import { mulberry32, clamp } from "./Util.js";
import { Sim } from "./Sim.js";
import { Renderer } from "./Renderer.js";
import { BuildMenu, RoomTypes, ROOM } from "./RoomTypes.js";

export class Game {
  constructor(canvas){
    this.canvas = canvas;
    this.rng = mulberry32(1337);

    this.logEl = document.getElementById("log");
    this.moneyEl = document.getElementById("money");
    this.popEl = document.getElementById("pop");
    this.happyEl = document.getElementById("happy");
    this.starsEl = document.getElementById("stars");
    this.timeEl = document.getElementById("time");
    this.infoEl = document.getElementById("info");
    this.elevPanelEl = document.getElementById("elevPanel");
    this.buildListEl = document.getElementById("buildList");

    this.sim = new Sim({ rng: this.rng, logFn: (m, cls)=>this.log(m, cls) });
    this.renderer = new Renderer(canvas, this.sim);

    this.activeTool = null;
    this.selection = null;
    this.selectedShaftId = null;

    this.mouse = { x:0, y:0, down:false, btn:0, lastX:0, lastY:0, dragging:false };
    this.buildPreview = null;

    this.lastT = performance.now();

    this.setupUI();
    this.setupInput();
    this.refreshBuildMenu();
    this.updateHud();
  }

  start(){
    requestAnimationFrame((t)=>this.loop(t));
  }

  loop(t){
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;

    this.sim.tick(dt);

    this.updateBuildPreview();
    this.renderer.draw(this.buildPreview);
    this.updateHud();

    requestAnimationFrame((tt)=>this.loop(tt));
  }

  log(msg, cls=""){
    const div = document.createElement("div");
    div.className = "msg " + (cls||"");
    div.textContent = msg;
    this.logEl.prepend(div);
    while(this.logEl.children.length > 80){
      this.logEl.removeChild(this.logEl.lastChild);
    }
  }

  setupUI(){
    document.getElementById("pauseBtn").addEventListener("click", ()=>this.sim.setSpeed(0));
    document.getElementById("playBtn").addEventListener("click", ()=>this.sim.setSpeed(1));
    document.getElementById("fastBtn").addEventListener("click", ()=>this.sim.setSpeed(3));
  }

  refreshBuildMenu(){
    this.buildListEl.innerHTML = "";
    for(const key of BuildMenu){
      const def = RoomTypes[key];
      const btn = document.createElement("button");
      btn.className = "buildBtn";
      btn.dataset.key = key;

      const locked = this.sim.stars < def.unlockStars;
      if(locked) btn.classList.add("locked");

      btn.innerHTML = `
        <div class="name">${def.key}</div>
        <div class="meta">${def.size.w}w · ${def.unlockStars}★ · $${def.buildCost}</div>
      `;

      btn.addEventListener("click", ()=>{
        if(this.sim.stars < def.unlockStars) return;
        this.setTool(key);
      });

      this.buildListEl.appendChild(btn);
    }
    this.syncBuildButtonActive();
  }

  syncBuildButtonActive(){
    for(const btn of this.buildListEl.querySelectorAll(".buildBtn")){
      btn.classList.toggle("active", btn.dataset.key === this.activeTool);
    }
  }

  setTool(key){
    this.activeTool = key;
    this.selection = null;
    this.selectedShaftId = null;
    this.infoEl.textContent = `Placing: ${key}\nClick to place.`;
    this.elevPanelEl.textContent = `No shaft selected.`;
    this.syncBuildButtonActive();
  }

  clearTool(){
    this.activeTool = null;
    this.buildPreview = null;
    this.syncBuildButtonActive();
  }

  setupInput(){
    const canvas = this.canvas;

    canvas.addEventListener("contextmenu", e => e.preventDefault());

    canvas.addEventListener("mousemove", (e)=>{
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;

      if(this.mouse.down){
        const dx = this.mouse.x - this.mouse.lastX;
        const dy = this.mouse.y - this.mouse.lastY;
        if(Math.abs(dx) + Math.abs(dy) > 2) this.mouse.dragging = true;

        this.renderer.cam.x -= dx / this.renderer.cam.zoom;
        this.renderer.cam.y -= dy / this.renderer.cam.zoom;

        this.mouse.lastX = this.mouse.x;
        this.mouse.lastY = this.mouse.y;
      }
    });

    canvas.addEventListener("mousedown", (e)=>{
      const rect = canvas.getBoundingClientRect();
      this.mouse.down = true;
      this.mouse.btn = e.button;
      this.mouse.dragging = false;
      this.mouse.lastX = e.clientX - rect.left;
      this.mouse.lastY = e.clientY - rect.top;
    });

    canvas.addEventListener("mouseup", (e)=>{
      this.mouse.down = false;
      const wasDrag = this.mouse.dragging;
      this.mouse.dragging = false;

      if(e.button === 2){
        this.clearTool();
        this.infoEl.textContent = `Tool cancelled.\nClick a room to inspect.`;
        return;
      }

      if(wasDrag) return;

      if(e.button === 0){
        if(this.activeTool){
          this.tryPlaceAtMouse();
        } else {
          this.trySelectAtMouse();
        }
      }
    });

    canvas.addEventListener("wheel", (e)=>{
      e.preventDefault();
      const dir = Math.sign(e.deltaY);
      const z = this.renderer.cam.targetZoom;
      this.renderer.cam.targetZoom = clamp(z * (dir > 0 ? 0.92 : 1.08), 0.55, 2.2);
    }, { passive:false });

    window.addEventListener("keydown", (e)=>{
      if(e.key === "Escape"){
        this.clearTool();
        this.activeTool = null;
        this.infoEl.textContent = `Tool cancelled.\nClick a room to inspect.`;
      }
    });
  }

  updateBuildPreview(){
    if(!this.activeTool){
      this.buildPreview = null;
      return;
    }
    const cell = this.renderer.getCellFromScreen(this.mouse.x, this.mouse.y);
    const can = this.sim.tower.canPlace(this.activeTool, cell.floor, cell.xCell, this.sim.stars);
    this.buildPreview = {
      typeKey: this.activeTool,
      floor: cell.floor,
      x: cell.xCell,
      ok: can.ok && this.sim.money >= RoomTypes[this.activeTool].buildCost
    };
  }

  tryPlaceAtMouse(){
    const cell = this.renderer.getCellFromScreen(this.mouse.x, this.mouse.y);
    const res = this.sim.tryBuild(this.activeTool, cell.floor, cell.xCell);
    if(!res.ok){
      this.log(res.reason, "bad");
      return;
    }
    this.refreshBuildMenu();
  }

  trySelectAtMouse(){
    const cell = this.renderer.getCellFromScreen(this.mouse.x, this.mouse.y);
    const room = this.sim.tower.roomAtCell(cell.floor, cell.xCell);
    if(room){
      this.selection = room;
      this.selectedShaftId = null;
      this.renderRoomInfo(room);
      return;
    }

    const shaft = this.sim.elevators.shaftAtX(cell.xCell);
    if(shaft){
      this.selection = shaft;
      this.selectedShaftId = shaft.id;
      this.renderShaftInfo(shaft);
      return;
    }

    this.selection = null;
    this.selectedShaftId = null;
    this.infoEl.textContent = "Nothing selected.";
    this.elevPanelEl.textContent = "No shaft selected.";
  }

  renderRoomInfo(room){
    const def = RoomTypes[room.type];
    const fm = this.sim.tower.floorMetrics.get(room.floor);
    const lines = [];
    lines.push(`${def.key}`);
    lines.push(`Floor ${room.floor} · x=${room.x}..${room.x+room.w-1}`);
    lines.push(`State: ${room.state}`);
    lines.push(`Build: $${def.buildCost} · Maint/day: $${def.maintPerDay}`);
    lines.push(`Noise: ${def.noise} · Traffic: ${def.traffic} · Happy: ${def.happiness >= 0 ? "+" : ""}${def.happiness}`);
    if(def.capacity) lines.push(`Capacity: ${def.capacity}`);
    if(def.workers) lines.push(`Workers: ${def.workers}`);
    if(room.type === ROOM.HOTEL || room.type === ROOM.SUITE) lines.push(`Dirty: ${Math.round((room.dirty||0)*100)}%`);
    if(fm){
      lines.push(`Floor metrics: noise=${fm.noise}, congestion=${fm.congestion}, clean=${Math.round(fm.cleanliness*100)}%`);
    }
    this.infoEl.textContent = lines.join("\n");
    this.elevPanelEl.textContent = "No shaft selected.";
  }

  renderShaftInfo(shaft){
    const car = shaft.car;
    const lines = [];
    lines.push(`Shaft at x=${shaft.x}`);
    lines.push(`Type: ${shaft.type}${car.broken ? " (broken)" : ""}`);
    lines.push(`Car floor: ${car.y.toFixed(2)} (${car.state})`);
    lines.push(`Riders: ${car.riders.length}/${car.capacity}`);
    lines.push(`Stops: ${car.stops.join(", ") || "(none)"}`);
    if(shaft.servedFloors){
      lines.push(`Serves: ${[...shaft.servedFloors].slice(0,18).join(", ")}${shaft.servedFloors.size>18?"…":""}`);
    } else {
      lines.push(`Serves: all floors`);
    }
    this.elevPanelEl.textContent = lines.join("\n");
    this.infoEl.textContent = "Shaft selected.\nClick rooms for details.";
  }

  updateHud(){
    const hud = this.sim.getHud();
    this.moneyEl.textContent = hud.money;
    this.popEl.textContent = hud.pop;
    this.happyEl.textContent = hud.happy;
    this.starsEl.textContent = hud.stars;
    this.timeEl.textContent = hud.time;

    if(!this._menuTick) this._menuTick = 0;
    this._menuTick++;
    if(this._menuTick % 120 === 0){
      this.refreshBuildMenu();
    }

    if(this.selectedShaftId){
      const s = this.sim.elevators.getShaftById(this.selectedShaftId);
      if(s) this.renderShaftInfo(s);
    }
  }
}
