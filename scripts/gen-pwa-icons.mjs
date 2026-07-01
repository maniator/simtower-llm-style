/**
 * Generates the PWA manifest icons from an in-code SVG — no external art
 * assets, in keeping with the project's "every sprite drawn in code" ethos.
 *
 * A little retro high-rise on the SimTower teal desktop, navy body with lit
 * windows, matching the in-game palette (see src/styles.css tokens).
 *
 * Rasterized with the same headless Chromium the screenshot harness uses, so
 * this needs no new image dependency. Outputs land in src/public/ (Vite's
 * publicDir) and are committed, so `npm run build` needs no browser.
 *
 *   node scripts/gen-pwa-icons.mjs
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../src/public");
const EXECUTABLE = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const TEAL = "#008080"; // desktop
const NAVY = "#000080"; // building / title bar
const LIT = "#ffd23f"; // lit windows
const DARK = "#000040"; // shaded windows / outline

/**
 * @param {number} size    output pixel size
 * @param {boolean} maskable  keep art inside the maskable safe zone (center ~80%)
 */
function svg(size, maskable) {
  // Maskable icons get cropped to arbitrary shapes, so the tower must stay
  // within the safe zone and the teal must bleed to every edge.
  const inset = maskable ? 0.19 : 0.08; // fraction of the canvas as margin
  const m = 512 * inset;
  const bx = m;
  const bw = 512 - m * 2;
  const bodyTop = 512 * (maskable ? 0.24 : 0.14);
  const bodyBottom = 512 - m;
  const bh = bodyBottom - bodyTop;

  // Window grid.
  const cols = 4;
  const rows = 6;
  const gap = bw * 0.06;
  const cw = (bw - gap * (cols + 1)) / cols;
  const ch = (bh - gap * (rows + 1)) / rows;
  let windows = "";
  // Deterministic "lit" pattern so the icon is stable across regenerations.
  const litMask = [0b1011, 0b0110, 0b1101, 0b1110, 0b0111, 0b1011];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bx + gap + c * (cw + gap);
      const y = bodyTop + gap + r * (ch + gap);
      const lit = (litMask[r] >> c) & 1;
      windows += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="2" fill="${lit ? LIT : DARK}"/>`;
    }
  }

  // A little rooftop antenna + entrance for character.
  const doorW = bw * 0.22;
  const doorH = bh * 0.13;
  const doorX = bx + bw / 2 - doorW / 2;
  const doorY = bodyBottom - doorH;
  const mastX = bx + bw / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${TEAL}"/>
    <line x1="${mastX}" y1="${(bodyTop - 44).toFixed(1)}" x2="${mastX}" y2="${bodyTop.toFixed(1)}" stroke="${DARK}" stroke-width="8"/>
    <circle cx="${mastX}" cy="${(bodyTop - 48).toFixed(1)}" r="10" fill="${LIT}"/>
    <rect x="${bx.toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${NAVY}" stroke="${DARK}" stroke-width="6"/>
    ${windows}
    <rect x="${doorX.toFixed(1)}" y="${doorY.toFixed(1)}" width="${doorW.toFixed(1)}" height="${doorH.toFixed(1)}" fill="${LIT}"/>
  </svg>`;
}

const TARGETS = [
  { name: "pwa-192x192.png", size: 192, maskable: false },
  { name: "pwa-512x512.png", size: 512, maskable: false },
  { name: "pwa-maskable-512x512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: false },
  { name: "favicon.png", size: 64, maskable: false },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    for (const t of TARGETS) {
      const page = await browser.newPage({
        viewport: { width: t.size, height: t.size },
        deviceScaleFactor: 1,
      });
      const markup = svg(t.size, t.maskable);
      await page.setContent(
        `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{width:${t.size}px;height:${t.size}px;overflow:hidden}</style></head><body>${markup}</body></html>`,
        { waitUntil: "networkidle" },
      );
      const out = resolve(OUT_DIR, t.name);
      await page.screenshot({ path: out, omitBackground: false });
      await page.close();
      console.log(`wrote ${out} (${t.size}px${t.maskable ? ", maskable" : ""})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
