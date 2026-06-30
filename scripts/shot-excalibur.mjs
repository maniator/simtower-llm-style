import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
p.on("console", (m) => { if (m.type()==="error") console.error("CONSOLE:", m.text()); });
await p.goto("http://localhost:4173/excalibur.html", { waitUntil: "networkidle" });
try { await p.waitForFunction(() => window.excaliburReady === true, null, { timeout: 12000 }); }
catch { console.error("excaliburReady never set"); }
await p.waitForTimeout(1500);
await p.screenshot({ path: "docs/screenshots/excalibur-preview.png" });
console.log("captured excalibur-preview");
await b.close();
