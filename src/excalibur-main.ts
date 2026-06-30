import { Simulation } from "./engine/Simulation";
import { GRID } from "./engine/facilities";
import { TowerEngine } from "./render/excalibur/TowerEngine";

/** Build a representative demo tower so the Excalibur renderer has something to show. */
function buildDemo(): Simulation {
  const s = Simulation.newGame(2024);
  s.money = 50_000_000;
  s.star = 5;
  const W = GRID.width;
  const cx = Math.floor(W / 2);
  const left = cx - 35;
  for (let x = cx - 45; x < cx + 45; x++) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 40; f++) for (let x = left; x < left + 70; x++) s.tower.place("floor", f, x);
  for (const f of [15, 30]) {
    for (let x = left; x < left + 70; x++) {
      const u = s.tower.roomAt(f, x);
      if (u) s.tower.removeUnit(u.id);
      s.tower.place("lobby", f, x);
    }
  }
  s.tower.placeTransport("elevatorStandard", left + 2, 1, 15);
  s.tower.placeTransport("elevatorStandard", left + 8, 15, 30);
  s.tower.placeTransport("elevatorExpress", left + 20, 1, 30);
  s.tower.placeTransport("stairs", left + 60, 1, 2);

  const fill = (f: number, kind: Parameters<typeof s.tower.place>[0]) => {
    const w = { office: 9, condo: 16, hotelDouble: 6, shop: 12, fastFood: 12, restaurant: 16 }[kind as string] ?? 9;
    for (let x = left + 26; x + w <= left + 70; x += w) {
      const r = s.tower.place(kind, f, x);
      if (r.ok) {
        const u = s.tower.units.find((uu) => uu.id === r.unitId)!;
        u.state = String(kind).startsWith("hotel") ? "asleep" : "occupied";
        u.everOccupied = true;
      }
    }
  };
  for (let x = left + 26; x + 12 <= left + 70; x += 12) {
    const r = s.tower.place("fastFood", 1, x);
    if (r.ok) s.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
  }
  for (let f = 2; f <= 14; f++) fill(f, "office");
  for (let f = 16; f <= 22; f++) fill(f, "condo");
  for (let f = 23; f <= 29; f++) fill(f, "office");
  for (let f = 31; f <= 36; f++) fill(f, "hotelDouble");
  fill(37, "shop");
  fill(38, "restaurant");
  const cine = s.tower.place("cinema", 39, left + 26);
  if (cine.ok) s.tower.units.find((u) => u.id === cine.unitId)!.state = "occupied";
  return s;
}

const canvas = document.getElementById("view") as HTMLCanvasElement;
const sim = buildDemo();
const engine = new TowerEngine(canvas, sim);
engine.start().then(() => {
  (window as unknown as { engine: TowerEngine; sim: Simulation }).engine = engine;
  (window as unknown as { excaliburReady: boolean }).excaliburReady = true;
});
