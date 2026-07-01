import type { Simulation } from "../engine/Simulation";

/**
 * First-run experience — splash/title screen + a non-blocking "Getting Started"
 * checklist with device-aware hints. Pure DOM chrome: it READS the simulation to
 * detect real progress but never mutates it (no engine coupling, no new save
 * state), preserving the diegesis split. Once-only, skippable, re-openable from
 * Help. See the design docs under _bmad-output/planning-artifacts/design/.
 */

const FLAG = "tt.onboarded";
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}
export function markOnboarded(): void {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    /* private-mode / disabled storage — onboarding just re-shows, harmless */
  }
}
export function clearOnboarded(): void {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}

export interface OnboardStep {
  id: string;
  title: string;
  sub: string;
  hintDesktop: string;
  hintMobile: string;
  /** CSS selector(s) for the control(s) to pulse while this step is active. */
  pulse: string;
  /** True once the player has genuinely done this — read from live sim state. */
  done: (sim: Simulation) => boolean;
}

/** The four steps: empty-ish lot (a ground lobby is pre-seeded) → first office
 *  earning rent. Advance on real game state, not scripted clicks. */
export const ONBOARD_STEPS: OnboardStep[] = [
  {
    id: "floor",
    title: "Add a floor",
    sub: "Every room needs a floor under it. Lay one just above your lobby.",
    hintDesktop: "Pick Floor in the palette, then drag across the row above your lobby. (To pan, use the Inspect tool or hold Space.)",
    hintMobile: "Tap Floor, then tap the row just above your lobby to lay floor tiles.",
    pulse: '.pal-item[data-kind="floor"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "floor" && u.floor >= 2),
  },
  {
    id: "office",
    title: "Lease an office",
    sub: "Offices pay the rent. Drop one on your new floor.",
    hintDesktop: "Pick Office, then click your new floor to place it.",
    hintMobile: "Tap Office, then tap your new floor to place it.",
    pulse: '.pal-item[data-kind="office"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "office"),
  },
  {
    id: "connect",
    title: "Connect it",
    sub: "No one can reach a floor without transport. Run a stairway or elevator down to the ground lobby.",
    hintDesktop: "Pick Standard Elevator (or Stairway), then drag vertically from the lobby up to your office's floor.",
    hintMobile: "Tap Elevator (or Stairway), then touch-and-drag vertically to size the shaft from the lobby to your office.",
    pulse: '.pal-item[data-kind="elevatorStandard"], .pal-item[data-kind="stairs"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "office" && sim.tower.isFloorServed(u.floor)),
  },
  {
    id: "play",
    title: "Press Play & wait",
    sub: "Hit ▶ Play. A tenant moves in within a day or two — rent lands each quarter.",
    hintDesktop: "Press ▶ Play in the top bar and let time run.",
    hintMobile: "Tap ▶ Play in the top bar and let time run.",
    pulse: '#speed button[data-speed="1"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "office" && u.state === "occupied"),
  },
];

/** Index of the first not-yet-satisfied step; === ONBOARD_STEPS.length when all done. */
export function firstIncompleteStep(sim: Simulation): number {
  for (let i = 0; i < ONBOARD_STEPS.length; i++) if (!ONBOARD_STEPS[i].done(sim)) return i;
  return ONBOARD_STEPS.length;
}

/** Whether onboarding should arm now: only when the player explicitly starts a
 *  New Tower on a browser that has never completed it. */
export function shouldArm(pressedNewTower: boolean): boolean {
  return pressedNewTower && !isOnboarded();
}

const DEFAULT_HINT_DESKTOP = "Drag to pan · Scroll to zoom · Click to build · Inspect tool to edit a room";
const DEFAULT_HINT_MOBILE = "Tap to build · Drag to pan · Pinch to zoom · Tap a room to inspect";

export interface OnboardingOpts {
  mq: MediaQueryList;
  showHelp: () => void;
  /** Pause/resume the engine while the splash is up. */
  pauseForSplash: (paused: boolean) => void;
  /** A small chime on step advance (optional flourish). */
  chime: () => void;
}

export class OnboardingController {
  static isOnboarded = isOnboarded;
  static markOnboarded = markOnboarded;
  static clearOnboarded = clearOnboarded;

  private sim: Simulation | null = null;
  private active = false;
  private step = 0;
  private splashEl: HTMLElement | null = null;
  private splashKey: ((e: KeyboardEvent) => void) | null = null;
  private panelEl: HTMLElement | null = null;
  private sendOff: ReturnType<typeof setTimeout> | null = null;
  private readonly onMq = () => (this.active ? this.applyHintAndPulse() : this.setDefaultHint());

  constructor(private opts: OnboardingOpts) {
    // The controller is the single owner of the #hint bar: seed a device-aware
    // default immediately (so mobile never shows the hard-coded desktop line) and
    // keep it correct across rotate/resize. ONE listener for the controller's
    // life — no per-session add/remove to leak.
    this.setDefaultHint();
    this.opts.mq.addEventListener("change", this.onMq);
  }

  private setDefaultHint(): void {
    if (this.hintEl) this.hintEl.textContent = this.opts.mq.matches ? DEFAULT_HINT_MOBILE : DEFAULT_HINT_DESKTOP;
  }

  private get hintEl(): HTMLElement | null {
    return document.getElementById("hint");
  }

  // ---- Splash -------------------------------------------------------------

  showSplash(o: { hasSave: boolean; onContinue: () => void; onNewTower: () => void }): void {
    this.opts.pauseForSplash(true);
    const mobile = this.opts.mq.matches;
    const el = document.createElement("div");
    el.id = "splash";
    el.className = mobile ? "splash--mobile" : "";
    const premise = mobile
      ? "Raise a high-rise floor by floor and climb to the TOWER."
      : "Raise a living high-rise floor by floor — lease offices, open shops, run hotels, and thread the elevators that keep the city moving. Climb from 1★ to the legendary TOWER.";
    const continueBtn = o.hasSave
      ? `<button class="splash-btn primary" data-splash="continue">▶ Continue</button>`
      : "";
    el.innerHTML =
      `<div class="splash-card">` +
      `<div class="splash-sky" aria-hidden="true"></div>` +
      `<h1 class="splash-title">TOWER TYCOON</h1>` +
      `<p class="splash-tagline">Build up. The elevators are the game.</p>` +
      `<p class="splash-premise">${premise}</p>` +
      `<div class="splash-actions">` +
      continueBtn +
      `<button class="splash-btn ${o.hasSave ? "" : "primary"}" data-splash="new">＋ New Tower</button>` +
      `<button class="splash-btn ghost" data-splash="help">？ How to Play</button>` +
      `</div>` +
      `<p class="splash-attrib">An unofficial, from-scratch homage to SimTower (1994). Original code and art — no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.</p>` +
      `<p class="splash-version">v${APP_VERSION}</p>` +
      `</div>`;
    document.body.appendChild(el);
    this.splashEl = el;

    const q = (sel: string) => el.querySelector<HTMLElement>(sel);
    q('[data-splash="continue"]')?.addEventListener("click", () => {
      this.teardownSplash();
      o.onContinue();
    });
    q('[data-splash="new"]')?.addEventListener("click", () => {
      this.teardownSplash();
      o.onNewTower();
    });
    // Help stacks over the splash (its own modal); the splash stays behind it.
    q('[data-splash="help"]')?.addEventListener("click", () => this.opts.showHelp());

    // Esc / backdrop resolve to the SAFE default: Continue if a save exists,
    // otherwise no-op (New Tower must be an explicit press so intent is never
    // wiped). Backdrop = a click on the overlay outside the card.
    const safeDismiss = () => {
      if (!o.hasSave) return;
      this.teardownSplash();
      o.onContinue();
    };
    el.addEventListener("click", (e) => {
      if (e.target === el) safeDismiss();
    });
    this.splashKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") safeDismiss();
    };
    document.addEventListener("keydown", this.splashKey);
  }

  private teardownSplash(): void {
    if (this.splashKey) document.removeEventListener("keydown", this.splashKey);
    this.splashKey = null;
    this.splashEl?.remove();
    this.splashEl = null;
    this.opts.pauseForSplash(false);
  }

  // ---- Checklist / onboarding --------------------------------------------

  /** Begin (or resume) onboarding on `sim`. Idempotent — tears down any live
   *  session first so a re-arm (e.g. Replay) can't stack panels. No-ops (returns
   *  false) if already onboarded or if there's nothing left to teach. */
  arm(sim: Simulation): boolean {
    if (isOnboarded()) return false;
    this.clearSession(); // re-entrancy guard: never leave a second panel behind
    this.sim = sim;
    this.step = firstIncompleteStep(sim);
    if (this.step >= ONBOARD_STEPS.length) {
      // Nothing left to teach (e.g. replay on an already-built tower).
      markOnboarded();
      this.setDefaultHint();
      return false;
    }
    this.active = true;
    this.mountPanel();
    this.render();
    this.applyHintAndPulse();
    return true;
  }

  /** Called from the host's throttled update loop (~6 Hz). Advances on real progress. */
  tick(): void {
    if (!this.active || !this.sim) return;
    const s = firstIncompleteStep(this.sim);
    if (s === this.step) return;
    this.step = s;
    this.opts.chime();
    if (s >= ONBOARD_STEPS.length) {
      this.finish();
      return;
    }
    this.render();
    this.applyHintAndPulse();
  }

  private mountPanel(): void {
    const el = document.createElement("div");
    el.id = "onboard";
    el.className = this.opts.mq.matches ? "onboard--mobile" : "";
    document.body.appendChild(el);
    this.panelEl = el;
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).dataset.onboard === "skip") this.dismiss();
    });
  }

  private render(): void {
    if (!this.panelEl) return;
    const items = ONBOARD_STEPS.map((st, i) => {
      const state = i < this.step ? "done" : i === this.step ? "cur" : "todo";
      const mark = state === "done" ? "✓" : i === this.step ? "▸" : "·";
      return (
        `<li class="ob-step ob-${state}"><span class="ob-mark">${mark}</span>` +
        `<span class="ob-text"><b>${st.title}</b>${i === this.step ? `<span class="ob-sub">${st.sub}</span>` : ""}</span></li>`
      );
    }).join("");
    this.panelEl.innerHTML =
      `<div class="ob-head">Getting Started<button class="ob-skip" data-onboard="skip">Skip</button></div>` +
      `<ol class="ob-list">${items}</ol>`;
  }

  private applyHintAndPulse(): void {
    const st = ONBOARD_STEPS[this.step];
    if (!st) return;
    if (this.hintEl) this.hintEl.textContent = this.opts.mq.matches ? st.hintMobile : st.hintDesktop;
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
    document.querySelectorAll(st.pulse).forEach((n) => n.classList.add("tt-pulse"));
  }

  private finish(): void {
    markOnboarded();
    this.active = false;
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
    this.setDefaultHint();
    if (this.panelEl) {
      this.panelEl.innerHTML = `<div class="ob-head">Nice — you're a landlord!</div><p class="ob-sendoff">The rest is in Help (？). Build up! 🏙️</p>`;
      this.panelEl.addEventListener("click", () => this.clearSession(), { once: true });
    }
    if (this.sendOff) clearTimeout(this.sendOff);
    this.sendOff = setTimeout(() => this.clearSession(), 6000);
  }

  /** Skip / early-dismiss — marks done so it never nags again. */
  private dismiss(): void {
    markOnboarded();
    this.clearSession();
  }

  /** Tear down a live onboarding session (panel + pulse + timer), leaving the
   *  persistent hint listener in place. Safe to call when nothing is mounted. */
  private clearSession(): void {
    if (this.sendOff) clearTimeout(this.sendOff);
    this.sendOff = null;
    this.active = false;
    this.panelEl?.remove();
    this.panelEl = null;
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
    this.setDefaultHint();
  }
}
