import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
await p.addInitScript(() => localStorage.clear());
await p.goto("http://localhost:4173/index.html", { waitUntil: "networkidle" });
await p.waitForFunction(() => window.game?.engine?.engine?.currentScene, null, { timeout: 15000 });
await p.evaluate(() => {
  const sim = window.game.sim, left = 80;
  for (let x = left; x < left + 40; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 8; f++) for (let x = left + 4; x < left + 36; x++) sim.tower.place("floor", f, x);
  for (let f = 3; f <= 7; f++) for (let x = left + 8; x + 9 <= left + 35; x += 9) {
    const r = sim.tower.place("office", f, x);
    if (r.ok) { const u = sim.tower.units.find(u => u.id === r.unitId); u.state = "occupied"; u.occupants = 6; }
  }
  sim.tower.placeTransport("elevatorStandard", left + 6, 1, 8);
  const c = sim.clock; c.minutes = c.minutes - c.minuteOfDay + 13 * 60; // 1pm daylight
  sim.weather = "rain";
  window.game.engine.setCamera(left + 20, 4, 1.5);
});
await p.waitForTimeout(1500);
await p.screenshot({ path: "/tmp/claude-0/-home-user-simtower-llm-style/36ca10ff-b405-524b-9bcd-42f0c09be3e6/scratchpad/weather-rain.png" });
console.log("shot rain");
await b.close();
