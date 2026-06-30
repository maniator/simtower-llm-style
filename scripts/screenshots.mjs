/**
 * Drives the built game in a headless browser and captures screenshots of
 * representative game states into docs/screenshots/.
 *
 * Usage: node scripts/screenshots.mjs
 * Assumes `vite preview` (or any static server) is serving the app at BASE.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../docs/screenshots");
const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXECUTABLE =
  process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

mkdirSync(OUT, { recursive: true });

/** Build a sizeable demo tower entirely through the public sim API. */
function buildDemoScript() {
  // Runs inside the page. `window.game` is the GameApp instance.
  const g = window.game;
  const sim = g.sim;
  // Fresh deterministic game.
  const Sim = sim.constructor;
  g.sim = Sim.newGame(2024);
  const s = g.sim;
  const W = 200;
  const cx = Math.floor(W / 2);
  s.money = 50_000_000;
  s.star = 5; // unlock everything for the showcase

  // Ground lobby already laid by newGame around centre. Extend it wide.
  for (let x = cx - 45; x < cx + 45; x++) s.tower.place("lobby", 1, x);

  // Structural floors 2..40 across a 70-wide footprint.
  const left = cx - 35;
  for (let f = 2; f <= 40; f++) {
    for (let x = left; x < left + 70; x++) s.tower.place("floor", f, x);
  }
  // Sky lobby at 15 and 30.
  for (const f of [15, 30]) for (let x = left; x < left + 70; x++) {
    const u = s.tower.roomAt(f, x);
    if (u) s.tower.removeUnit(u.id);
    s.tower.place("lobby", f, x);
  }

  // Elevators: ground->15, 15->30, 30->40.
  s.tower.placeTransport("elevatorStandard", left + 2, 1, 15);
  s.tower.placeTransport("elevatorStandard", left + 8, 15, 30);
  s.tower.placeTransport("elevatorStandard", left + 14, 30, 40);
  s.tower.placeTransport("elevatorExpress", left + 20, 1, 30);
  s.tower.placeTransport("stairs", left + 60, 1, 2);

  const fill = (f, kind) => {
    const w = { office: 9, condo: 16, hotelDouble: 6, shop: 12, fastFood: 12, restaurant: 16 }[kind];
    let x = left + 26;
    while (x + w <= left + 70) {
      const r = s.tower.place(kind, f, x);
      if (r.ok) {
        const u = s.tower.units.find((uu) => uu.id === r.unitId);
        u.state = kind.startsWith("hotel") ? "asleep" : "occupied";
        u.everOccupied = true;
        if (kind === "office") u.label = "Apex Holdings";
      }
      x += w;
    }
  };
  // Lobby-level commercial.
  for (let x = left + 26; x + 16 <= left + 70; x += 16) {
    const r = s.tower.place("fastFood", 1, x);
    if (r.ok) s.tower.units.find((u) => u.id === r.unitId).state = "occupied";
  }
  for (let f = 2; f <= 14; f++) fill(f, "office");
  for (let f = 16; f <= 22; f++) fill(f, "condo");
  for (let f = 23; f <= 29; f++) fill(f, "office");
  for (let f = 31; f <= 36; f++) fill(f, "hotelDouble");
  fill(37, "shop");
  fill(38, "restaurant");
  // A two-storey cinema spanning floors 39–40.
  s.star = 5;
  const cine = s.tower.place("cinema", 39, left + 26);
  if (cine.ok) s.tower.units.find((u) => u.id === cine.unitId).state = "occupied";
  s.tower.place("security", 1, left + 26);
  s.tower.place("medical", 2, left);
  // Two basement levels (B1 = floor 0, B2 = floor -1) with a whole-floor metro.
  for (let x = 0; x < W; x++) s.tower.place("floor", 0, x);
  for (let x = left; x < left + 70; x++) s.tower.place("floor", -1, x);
  const metro = s.tower.place("metro", 0, 0);
  if (metro.ok) s.tower.units.find((u) => u.id === metro.unitId).state = "occupied";
  for (let x = left; x + 6 <= left + 70; x += 6) s.tower.place("parking", -1, x);

  s.evaluateStar();
  // Point the Excalibur engine at the rebuilt tower and frame it.
  g.engine.setSim(s);
  g.engine.setCamera(cx, 18, 0.55);
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.game, null, { timeout: 10000 });

  // 1) Fresh tower / empty lot.
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/01-start.png` });
  console.log("captured 01-start");

  // 2) Help dialog.
  await page.click("#btn-help");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/02-help.png` });
  await page.click('#modal [data-act="close"]');

  // 3) Build demo tower.
  await page.evaluate(buildDemoScript);
  // Let the clock run a little to animate elevators and set time-of-day.
  await page.evaluate(() => (window.game.speed = 2));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/03-tower-day.png` });
  console.log("captured 03-tower-day");

  // 4) Night view — fast-forward to evening.
  await page.evaluate(() => {
    const c = window.game.sim.clock;
    c.advance((22 - c.hour + 24) * 60); // jump to ~22:00
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-tower-night.png` });
  console.log("captured 04-tower-night");

  // 5) Zoomed-in office detail.
  await page.evaluate(() => {
    window.game.engine.setCamera(100, 8, 1.8);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-detail.png` });
  console.log("captured 05-detail");

  // 5b) People moving — pause at the morning rush and zoom into the lobby so
  // the walking crowds (lobby + busy corridors) and elevator riders are shown.
  await page.evaluate(() => {
    const g = window.game;
    g.speed = 0; // freeze game time; walkers still animate on the render clock
    const c = g.sim.clock;
    const target = 8 * 60 + 30; // 08:30
    let delta = target - c.minuteOfDay;
    if (delta < 0) delta += 1440;
    c.advance(delta);
    g.engine.setCamera(100, 2, 1.7);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/07-people-rush.png` });
  console.log("captured 07-people-rush");

  // 5c) Construction in progress — fresh rooms show scaffolding/cranes.
  await page.evaluate(() => {
    const g = window.game;
    const Sim = g.sim.constructor;
    g.sim = Sim.newGame(99);
    const s = g.sim;
    s.money = 50_000_000;
    s.star = 4;
    const left = 70;
    for (let x = left - 6; x < left + 50; x++) s.tower.place("lobby", 1, x);
    for (let f = 2; f <= 8; f++) for (let x = left; x < left + 44; x++) s.tower.place("floor", f, x);
    s.buildTransport("elevatorStandard", left, 1, 8);
    // Build via the public API so they enter the construction phase.
    for (let f = 2; f <= 8; f++) {
      for (let x = left + 6; x + 9 <= left + 44; x += 9) s.build("office", f, x);
    }
    g.engine.setSim(s);
    g.engine.setCamera(left + 18, 4, 1.4);
    g.speed = 0; // freeze so construction is visible
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/08-construction.png` });
  console.log("captured 08-construction");

  // 5d) Mobile viewport.
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await mobile.goto(BASE, { waitUntil: "networkidle" });
  await mobile.waitForFunction(() => !!window.game, null, { timeout: 10000 });
  await mobile.evaluate(buildDemoScript);
  await mobile.evaluate(() => {
    const g = window.game;
    g.engine.setCamera(100, 16, 0.5);
    g.speed = 2;
  });
  await mobile.waitForTimeout(1000);
  await mobile.screenshot({ path: `${OUT}/09-mobile.png` });
  console.log("captured 09-mobile");
  await mobile.close();

  // 6) Sprite gallery (full screenshot of the catalog).
  const gpage = await browser.newPage({ viewport: { width: 960, height: 1200 } });
  await gpage.goto(`${BASE}/gallery.html`, { waitUntil: "networkidle" });
  await gpage.waitForFunction(() => window.galleryReady === true, null, { timeout: 10000 });
  await gpage.waitForTimeout(800);
  await gpage.screenshot({ path: `${OUT}/06-sprite-gallery.png`, fullPage: true });
  console.log("captured 06-sprite-gallery");
  await gpage.close();

  await browser.close();
  console.log("Done. Screenshots in", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
