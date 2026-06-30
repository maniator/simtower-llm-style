import { FACILITIES, isElevatorKind } from "../engine/facilities";
import type { FacilityKind, Transport, Unit } from "../engine/types";
import { drawRoom } from "./pixelSprites";

/** Facility kinds rendered by the faithful pixel-art room module. */
const ROOM_KINDS = new Set<FacilityKind>([
  "office",
  "condo",
  "hotelSingle",
  "hotelDouble",
  "hotelSuite",
  "fastFood",
  "restaurant",
  "shop",
  "cinema",
]);

/**
 * Procedural sprite drawing. Rather than ship external image assets, every
 * facility is drawn from layered shapes — walls, floors, furniture, windows
 * and signage — to evoke the chunky, detailed pixel look of the 1994 original.
 * Per-unit colour variation (seeded by the unit id) keeps rows of identical
 * facilities from reading as one flat colour block. All drawing is in screen
 * space.
 */

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
/** Deterministic 0..1 from an integer seed — for stable per-unit variety. */
function rand(seed: number): number {
  let x = (seed * 2654435761) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const ACCENTS = ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a", "#b07fe0", "#e88f4a", "#4ad0c0"];

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  /** Whether the tower interior should look "lit" (evening/night). */
  lit: boolean;
  /** Continuous animation time in seconds (for flicker / motion). */
  anim: number;
  /** In-game hour 0..23, for time-of-day behaviour. */
  hour: number;
}

/** Draw a placed room/structure unit into the given screen rectangle. */
export function drawUnit(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;

  if (u.kind === "floor") return drawFloor(ctx, x, y, w, h);
  if (u.kind === "lobby") return drawLobby(d, x, y, w, h);
  if (u.state === "construction") return drawConstruction(d, x, y, w, h);

  // Faithful pixel-art rooms own all of their states (empty / closed / asleep…).
  if (ROOM_KINDS.has(u.kind)) return drawRoom(d, u, x, y, w, h);

  // Service / special facilities.
  if (u.state === "empty") return drawVacancy(ctx, u, x, y, w, h);
  drawInterior(d, u, x, y, w, h);
}

/** Dispatch to the per-facility interior drawing (services & special only). */
function drawInterior(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  switch (u.kind) {
    case "partyHall":
      return drawPartyHall(ctx, x, y, w, h);
    case "parking":
      return drawParking(ctx, u, x, y, w, h);
    case "security":
      return drawSecurity(ctx, x, y, w, h);
    case "medical":
      return drawMedical(ctx, x, y, w, h);
    case "housekeeping":
      return drawHousekeeping(ctx, x, y, w, h);
    case "recycling":
      return drawRecycling(ctx, x, y, w, h);
    case "metro":
      return drawMetro(d, x, y, w, h);
    case "weddingHall":
      return drawWeddingHall(ctx, x, y, w, h);
    default:
      ctx.fillStyle = FACILITIES[u.kind].color;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
}

// ---- Structure ----------------------------------------------------------

function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#8c8676";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#9b9685";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = "#6f6a5c";
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let gx = x; gx < x + w; gx += 9) ctx.fillRect(gx, y + 2, 1, h - 5);
}

function drawLobby(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const { ctx } = d;
  // Marble gradient.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#f3eed6");
  g.addColorStop(1, "#ddd4b2");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Polished floor.
  ctx.fillStyle = "#cfc59c";
  ctx.fillRect(x, y + h - 4, w, 4);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x, y + h - 4, w, 1);
  // Columns and gold trim.
  ctx.fillStyle = "rgba(150,135,95,0.55)";
  for (let cx = x + 7; cx < x + w - 3; cx += 16) ctx.fillRect(cx, y + 2, 2, h - 6);
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(x, y + 1, w, 1);
  // Suggested patrons milling about.
  ctx.fillStyle = "rgba(40,40,60,0.7)";
  for (let px = x + 5; px < x + w - 3; px += 13) {
    const r = rand(px | 0);
    if (r > 0.45) ctx.fillRect(px + Math.floor(r * 5), y + h - 9, 2, 5);
  }
}

function drawConstruction(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  // Bare concrete shell.
  ctx.fillStyle = "#6f6a5e";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#5c574c";
  ctx.fillRect(x, y, w, 2);
  // Yellow/black hazard band along the floor.
  for (let hx = x; hx < x + w; hx += 8) {
    ctx.fillStyle = (Math.floor(hx / 8) % 2) === 0 ? "#e8c14a" : "#2a2a2a";
    ctx.fillRect(hx, y + h - 4, 4, 4);
  }
  // Scaffolding poles and cross-braces.
  ctx.strokeStyle = "rgba(220,220,230,0.55)";
  ctx.lineWidth = 1;
  for (let sx = x + 6; sx < x + w - 2; sx += 14) {
    ctx.beginPath();
    ctx.moveTo(sx, y + 2);
    ctx.lineTo(sx, y + h - 4);
    ctx.moveTo(sx, y + h - 4);
    ctx.lineTo(sx + 14, y + 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(220,220,230,0.4)";
  ctx.beginPath();
  ctx.moveTo(x + 2, y + h / 2);
  ctx.lineTo(x + w - 2, y + h / 2);
  ctx.stroke();
  // A little crane hook swinging on the global clock.
  const hookX = x + 8 + (Math.sin(d.anim) * 0.5 + 0.5) * Math.max(0, w - 16);
  ctx.strokeStyle = "#caa84a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hookX, y - 2);
  ctx.lineTo(hookX, y + h * 0.4);
  ctx.stroke();
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(hookX - 2, y + h * 0.4, 4, 3);
}

function drawVacancy(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, w: number, h: number) {
  // "For lease" hatch and a tiny sign.
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 7) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  if (w > 26) {
    ctx.fillStyle = "#d9d2b0";
    ctx.fillRect(x + w / 2 - 9, y + h / 2 - 4, 18, 8);
    ctx.fillStyle = "#7a6b3a";
    ctx.font = "6px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("LEASE", x + w / 2, y + h / 2 + 2);
    ctx.textAlign = "left";
  }
  void u;
}


// ---- Entertainment ------------------------------------------------------

function drawPartyHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#2a1f3a";
  ctx.fillRect(x, y + 2, w, h - 5);
  // Disco/spotlights.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = ACCENTS[i % ACCENTS.length];
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x + 6 + i * (w / 6), y + 4, 2, h - 8);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffd24a";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 7, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ---- Services -----------------------------------------------------------

function serviceBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = shade(color, -45);
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 4, w - 4, h - 9);
}

function drawSecurity(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#3f5f8f");
  // Guard desk + monitors + a badge star.
  const fy = y + h - 8;
  ctx.fillStyle = "#2a3a55";
  ctx.fillRect(x + 4, fy + 2, w - 8, 4);
  for (let mx = x + 6; mx + 4 < x + w - 4; mx += 8) {
    ctx.fillStyle = "#6bd47a";
    ctx.fillRect(mx, fy - 2, 4, 3);
  }
  // Badge.
  star(ctx, x + 10, y + 9, 4, "#ffd24a");
  ctx.fillStyle = "#dfe6f2";
  ctx.font = "7px sans-serif";
  if (w > 40) ctx.fillText("SECURITY", x + 18, y + 11);
}

function drawMedical(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#e6eaf2");
  // Red cross.
  ctx.fillStyle = "#d6342f";
  const cx = x + 11,
    cy = y + h / 2;
  ctx.fillRect(cx - 5, cy - 2, 10, 4);
  ctx.fillRect(cx - 2, cy - 5, 4, 10);
  // Beds.
  for (let bx = x + 22; bx + 8 < x + w - 3; bx += 12) {
    ctx.fillStyle = "#cfd6e0";
    ctx.fillRect(bx, y + h - 8, 9, 5);
    ctx.fillStyle = "#9fb0c4";
    ctx.fillRect(bx, y + h - 8, 3, 5);
  }
  ctx.fillStyle = "#2a3550";
  ctx.font = "7px sans-serif";
  if (w > 60) ctx.fillText("CLINIC", x + 22, y + 11);
}

function drawHousekeeping(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#bcd2bc");
  // Cleaning cart with towels + a mop.
  const fy = y + h - 9;
  ctx.fillStyle = "#7a8f7a";
  ctx.fillRect(x + 5, fy + 2, 12, 5);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 6, fy, 4, 3);
  ctx.fillStyle = "#cfe0ff";
  ctx.fillRect(x + 11, fy, 4, 3);
  // Mop handle.
  ctx.fillStyle = "#8a5a30";
  ctx.fillRect(x + 20, fy - 3, 1, 9);
  ctx.fillStyle = "#e8e0b0";
  ctx.fillRect(x + 18, fy + 5, 5, 2);
  ctx.fillStyle = "#2a3a2a";
  ctx.font = "7px sans-serif";
  if (w > 50) ctx.fillText("HOUSEKEEPING", x + 26, y + 11);
}

function drawRecycling(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#7f9f5f");
  // Three recycling bins.
  const colors = ["#3a7f3a", "#3a6faf", "#caa42e"];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(x + 6 + i * 9, y + h - 9, 7, 6);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(x + 6 + i * 9, y + h - 9, 7, 1);
  }
  // Recycling arrows (simple triangle loop).
  ctx.strokeStyle = "#1b2a14";
  ctx.lineWidth = 1.5;
  const cx = x + Math.min(w - 12, 40),
    cy = y + h / 2 - 1,
    r = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 1.4);
  ctx.stroke();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawMetro(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  ctx.fillStyle = "#23303a";
  ctx.fillRect(x, y + 2, w, h - 5);
  // Platform edge.
  ctx.fillStyle = "#3a4a55";
  ctx.fillRect(x, y + h - 5, w, 3);
  // The subway train slides in, waits, then leaves — a ~12s cycle.
  const cycle = (d.anim % 12) / 12;
  let offset: number;
  if (cycle < 0.25) offset = (1 - cycle / 0.25) * -(w + 10); // arriving from left
  else if (cycle < 0.75) offset = 0; // stopped at platform
  else offset = ((cycle - 0.75) / 0.25) * (w + 10); // departing to the right
  const tx = x + 3 + offset;
  ctx.fillStyle = "#c0c8d0";
  ctx.fillRect(tx, y + h - 13, w - 6, 7);
  ctx.fillStyle = "#8893a0";
  ctx.fillRect(tx, y + h - 13, w - 6, 1);
  ctx.fillStyle = d.anim % 1 < 0.5 ? "#ffe27a" : "#7fb0ff";
  ctx.fillRect(tx + 1, y + h - 12, 2, 2); // headlight
  ctx.fillStyle = "#7fa9ff";
  for (let wx = tx + 5; wx + 4 < tx + w - 6; wx += 8) ctx.fillRect(wx, y + h - 12, 4, 3);
  // Waiting commuters appear when the train is gone.
  if (offset !== 0) {
    ctx.fillStyle = "#2a2f3e";
    for (let px = x + 8; px < x + w - 6; px += 10) {
      if (rand((px + Math.floor(d.anim)) | 0) > 0.5) ctx.fillRect(px, y + h - 9, 2, 4);
    }
  }
  // Roundel "M" sign.
  ctx.fillStyle = "#d6342f";
  ctx.beginPath();
  ctx.arc(x + 10, y + 9, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 8px sans-serif";
  ctx.fillText("M", x + 7, y + 12);
  ctx.fillStyle = "#ffd24a";
  ctx.font = "8px sans-serif";
  ctx.fillText("METRO", x + 18, y + 11);
}

function drawParking(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#454a52";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  for (let lx = x + 8; lx < x + w; lx += 12) {
    ctx.beginPath();
    ctx.moveTo(lx, y + 4);
    ctx.lineTo(lx, y + h - 4);
    ctx.stroke();
  }
  // A couple of parked cars in varied colours.
  for (let cx = x + 2; cx + 9 < x + w; cx += 12) {
    if (rand((u.id + cx) | 0) > 0.5) continue;
    ctx.fillStyle = ACCENTS[(u.id + cx) % ACCENTS.length];
    ctx.fillRect(cx, y + h - 8, 9, 4);
    ctx.fillStyle = "#1b1f2a";
    ctx.fillRect(cx + 1, y + h - 4, 2, 2);
    ctx.fillRect(cx + 6, y + h - 4, 2, 2);
  }
}

function drawWeddingHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Elegant pale hall.
  ctx.fillStyle = "#f5efe0";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#e7dcc2";
  ctx.fillRect(x, y + h - 5, w, 5); // carpet runner base
  // Rooftop pennant banners.
  for (let i = 0, bx = x + 6; bx < x + w - 4; bx += 12, i++) {
    ctx.fillStyle = ["#e07a9a", "#7fb0e8", "#e8c14a"][i % 3];
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.lineTo(bx + 5, y);
    ctx.lineTo(bx + 2.5, y + 5);
    ctx.closePath();
    ctx.fill();
  }
  // Grand arched doorway with a red carpet.
  const cx = x + w / 2;
  const archW = Math.min(w * 0.4, 30);
  ctx.fillStyle = "#cdb98a";
  ctx.beginPath();
  ctx.moveTo(cx - archW / 2, y + h - 5);
  ctx.lineTo(cx - archW / 2, y + h * 0.45);
  ctx.arc(cx, y + h * 0.45, archW / 2, Math.PI, 0);
  ctx.lineTo(cx + archW / 2, y + h - 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#caa84a"; // gilded doors
  ctx.fillRect(cx - archW / 2 + 2, y + h * 0.5, archW - 4, h * 0.5 - 7);
  ctx.fillStyle = "#b8243f"; // red carpet
  ctx.fillRect(cx - 4, y + h - 5, 8, 5);
  // Interlocking wedding rings above the arch.
  ctx.strokeStyle = "#e8c14a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx - 4, y + h * 0.28, 4, 0, Math.PI * 2);
  ctx.arc(cx + 4, y + h * 0.28, 4, 0, Math.PI * 2);
  ctx.stroke();
  // Topiary by the doors.
  ctx.fillStyle = "#5a8a4a";
  ctx.beginPath();
  ctx.arc(cx - archW / 2 - 5, y + h - 8, 4, 0, Math.PI * 2);
  ctx.arc(cx + archW / 2 + 5, y + h - 8, 4, 0, Math.PI * 2);
  ctx.fill();
}

// ---- Transport ----------------------------------------------------------

export function drawTransport(
  ctx: CanvasRenderingContext2D,
  t: Transport,
  sx: number,
  topY: number,
  w: number,
  floorH: number,
  anim = 0,
): void {
  const f = FACILITIES[t.kind];
  const height = (t.top - t.bottom + 1) * floorH;
  ctx.fillStyle = shade(f.color, -20);
  ctx.fillRect(sx, topY, w, height);
  ctx.fillStyle = f.color;
  ctx.fillRect(sx + 1, topY, w - 2, height);

  if (t.kind === "stairs") {
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 1.5;
    for (let fl = 0; fl <= t.top - t.bottom; fl++) {
      const fy = topY + fl * floorH;
      // Draw the steps as a staircase rather than a single diagonal.
      const steps = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      for (let s = 0; s < steps; s++) {
        const sxStep = sx + 2 + (s / steps) * (w - 4);
        const syStep = fy + floorH - 2 - (s / steps) * (floorH - 4);
        ctx.strokeRect(sxStep, syStep, (w - 4) / steps, 2);
      }
      // People walking the stairs, alternating directions, on the global clock.
      for (let p = 0; p < 2; p++) {
        const up = p === 0;
        const prog = (anim * 0.25 + p * 0.5 + fl * 0.3) % 1;
        const along = up ? prog : 1 - prog;
        const px = sx + 2 + along * (w - 6);
        const py = fy + floorH - 3 - along * (floorH - 6);
        ctx.fillStyle = ["#2a2f3e", "#5a3a3a"][p];
        ctx.fillRect(px, py - 4, 2, 4);
        ctx.fillStyle = "#e8c9a0";
        ctx.fillRect(px, py - 5, 2, 1);
      }
    }
    return;
  }
  if (t.kind === "escalator") {
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + 1, topY + floorH);
    ctx.lineTo(sx + w - 1, topY);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    for (let s = 0; s < w; s += 3) {
      ctx.beginPath();
      ctx.moveTo(sx + s, topY + floorH - (s / w) * floorH);
      ctx.lineTo(sx + s + 1, topY + floorH - (s / w) * floorH);
      ctx.stroke();
    }
    // Riders gliding up the moving stair.
    for (let p = 0; p < 3; p++) {
      const prog = (anim * 0.4 + p / 3) % 1;
      const px = sx + 2 + prog * (w - 6);
      const py = topY + floorH - 3 - prog * (floorH - 6);
      ctx.fillStyle = ["#2a2f3e", "#3a4a5a", "#4a3a52"][p];
      ctx.fillRect(px, py - 4, 2, 4);
      ctx.fillStyle = "#e8c9a0";
      ctx.fillRect(px, py - 5, 2, 1);
    }
    return;
  }

  if (isElevatorKind(t.kind)) {
    // Shaft rails + faint floor stops.
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(sx + 1, topY, 1, height);
    ctx.fillRect(sx + w - 2, topY, 1, height);
    for (let fl = 0; fl <= t.top - t.bottom; fl++) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(sx + 1, topY + fl * floorH, w - 2, 1);
    }
    for (let i = 0; i < t.cars; i++) {
      const pos = t.carPositions[i];
      const carY = topY + (t.top - pos) * floorH;
      // Car body with centre doors.
      ctx.fillStyle = "#ffd24a";
      ctx.fillRect(sx + 2, carY + 2, w - 4, floorH - 4);
      ctx.fillStyle = "#caa42e";
      ctx.fillRect(sx + 2, carY + 2, w - 4, 1);
      // Passengers riding the car (more when moving), as little silhouettes.
      const riders = t.carDir[i] !== 0 ? 1 + (i % 2) + (t.load > 0 ? 1 : 0) : i % 2;
      for (let p = 0; p < Math.min(riders, 3); p++) {
        ctx.fillStyle = ["#2a2f3e", "#4a3a4a", "#3a4a3a"][p % 3];
        ctx.fillRect(sx + 3 + p * 3, carY + floorH - 7, 2, 4);
        ctx.fillStyle = "#e8c9a0";
        ctx.fillRect(sx + 3 + p * 3, carY + floorH - 8, 2, 1);
      }
      ctx.fillStyle = "rgba(120,80,0,0.55)";
      ctx.fillRect(sx + w / 2 - 0.5, carY + 3, 1, floorH - 6);
    }
  }
}
