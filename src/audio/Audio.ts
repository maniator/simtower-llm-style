import type { FacilityKind } from "../engine/types";
import type { ViewFocus } from "../render/Renderer";

/**
 * Procedural ambient audio. SimTower famously played different background
 * music depending on which part of the tower you were viewing. This engine
 * synthesises short looping MIDI-style themes with WebAudio oscillators and
 * crossfades between them as the camera focus changes — plus a few action
 * jingles (build, sell, promotion, error).
 *
 * Everything is feature-detected and gesture-gated so it is inert under tests
 * and before the first user interaction.
 */

type Scene =
  | "outside"
  | "lobby"
  | "office"
  | "residential"
  | "hotel"
  | "food"
  | "retail"
  | "cinema"
  | "service"
  | "metro"
  | "quiet";

interface SceneDef {
  /** Semitone offsets of the scale, relative to root. */
  scale: number[];
  /** Root MIDI note. */
  root: number;
  /** Beats per minute. */
  bpm: number;
  /** Oscillator timbre for the melody. */
  wave: OscillatorType;
  /** Chord (semitone offsets) for the sustained pad. */
  pad: number[];
  /** 0..1 melody activity. */
  density: number;
  /** Overall loudness 0..1. */
  gain: number;
}

const SCENES: Record<Scene, SceneDef> = {
  outside: { scale: [0, 2, 4, 7, 9], root: 64, bpm: 70, wave: "sine", pad: [0, 7, 16], density: 0.35, gain: 0.5 },
  lobby: { scale: [0, 2, 4, 5, 7, 9, 11], root: 60, bpm: 96, wave: "triangle", pad: [0, 4, 7, 11], density: 0.55, gain: 0.6 },
  office: { scale: [0, 2, 3, 5, 7, 9, 10], root: 57, bpm: 116, wave: "square", pad: [0, 3, 7], density: 0.7, gain: 0.45 },
  residential: { scale: [0, 2, 4, 7, 9], root: 62, bpm: 80, wave: "triangle", pad: [0, 4, 7], density: 0.4, gain: 0.55 },
  hotel: { scale: [0, 2, 3, 5, 7, 8, 10], root: 55, bpm: 60, wave: "sine", pad: [0, 3, 7, 10], density: 0.3, gain: 0.5 },
  food: { scale: [0, 2, 4, 5, 7, 9, 11], root: 65, bpm: 124, wave: "triangle", pad: [0, 4, 7, 9], density: 0.8, gain: 0.55 },
  retail: { scale: [0, 2, 4, 7, 9, 11], root: 67, bpm: 110, wave: "triangle", pad: [0, 4, 7], density: 0.65, gain: 0.55 },
  cinema: { scale: [0, 2, 3, 5, 7, 8, 11], root: 53, bpm: 88, wave: "sawtooth", pad: [0, 3, 7, 10, 14], density: 0.5, gain: 0.5 },
  service: { scale: [0, 2, 4, 5, 7], root: 58, bpm: 90, wave: "sine", pad: [0, 5, 7], density: 0.3, gain: 0.4 },
  metro: { scale: [0, 3, 5, 7, 10], root: 43, bpm: 76, wave: "sawtooth", pad: [0, 7, 12], density: 0.35, gain: 0.5 },
  quiet: { scale: [0, 4, 7], root: 60, bpm: 64, wave: "sine", pad: [0, 7], density: 0.2, gain: 0.35 },
};

function sceneFor(focus: ViewFocus): Scene {
  if (focus.dominant === "outside") return "outside";
  if (focus.centerFloor <= -1) return "metro";
  const k = focus.dominant as FacilityKind;
  switch (k) {
    case "lobby":
      return "lobby";
    case "office":
      return "office";
    case "condo":
      return "residential";
    case "hotelSingle":
    case "hotelDouble":
    case "hotelSuite":
      return "hotel";
    case "fastFood":
    case "restaurant":
      return "food";
    case "shop":
      return "retail";
    case "cinema":
    case "partyHall":
      return "cinema";
    case "security":
    case "medical":
    case "housekeeping":
    case "recycling":
      return "service";
    case "metro":
      return "metro";
    default:
      return focus.centerFloor <= 1 ? "lobby" : "quiet";
  }
}

function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private scene: Scene = "lobby";
  private targetScene: Scene = "lobby";
  muted = false;
  started = false;

  /** Lazily create the audio graph. Must be called from a user gesture. */
  start(): void {
    if (this.started) return;
    const Ctor =
      (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ||
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no WebAudio (tests / unsupported)
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.35;
      this.master.connect(this.ctx.destination);

      this.padGain = this.ctx.createGain();
      this.padGain.gain.value = 0.0;
      this.padGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0;
      this.musicGain.connect(this.master);

      this.startPad();
      this.nextNoteTime = this.ctx.currentTime;
      this.timer = setInterval(() => this.scheduler(), 60);
      this.started = true;
      this.applyScene(this.scene, 0.01);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.35, this.ctx.currentTime, 0.1);
    }
  }

  /** Called every frame with the renderer's focus; switches scenes smoothly. */
  update(focus: ViewFocus): void {
    if (!this.started || !this.ctx) return;
    const s = sceneFor(focus);
    if (s !== this.targetScene) {
      this.targetScene = s;
      this.crossfadeTo(s);
    }
  }

  private crossfadeTo(s: Scene): void {
    if (!this.ctx) return;
    this.scene = s;
    this.applyScene(s, 1.2);
  }

  private applyScene(s: Scene, time: number): void {
    if (!this.ctx || !this.padGain || !this.musicGain) return;
    const def = SCENES[s];
    const now = this.ctx.currentTime;
    this.padGain.gain.setTargetAtTime(def.gain * 0.18, now, time);
    this.musicGain.gain.setTargetAtTime(def.gain * 0.22, now, time);
    // Retune the pad oscillators to the new chord.
    def.pad.forEach((semi, i) => {
      const osc = this.padOscs[i];
      if (osc) osc.frequency.setTargetAtTime(midiToFreq(def.root + semi - 12), now, time);
    });
  }

  private startPad(): void {
    if (!this.ctx || !this.padGain) return;
    const def = SCENES[this.scene];
    this.padOscs = def.pad.map((semi, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = "sine";
      osc.frequency.value = midiToFreq(def.root + semi - 12);
      const g = this.ctx!.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.3;
      osc.connect(g);
      g.connect(this.padGain!);
      osc.start();
      return osc;
    });
  }

  /** Lookahead note scheduler for the melodic arpeggio. */
  private scheduler(): void {
    if (!this.ctx || this.muted) return;
    const def = SCENES[this.scene];
    const secondsPerStep = 60 / def.bpm / 2; // eighth notes
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      this.scheduleStep(def, this.nextNoteTime);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 16;
    }
  }

  private scheduleStep(def: SceneDef, time: number): void {
    if (!this.ctx || !this.musicGain) return;
    // Seeded-but-varied note choice without Math.random dependency on engine.
    const r = pseudo(this.step * 2654435761);
    if (r > def.density) return;
    const degree = Math.floor(pseudo(this.step * 40503 + 7) * def.scale.length);
    const octave = pseudo(this.step * 19349663) > 0.7 ? 12 : 0;
    const note = def.root + def.scale[degree] + octave;
    this.blip(midiToFreq(note), time, def.wave, this.musicGain, 0.22, 0.32);
    // Occasional sparkle on the off-beats for "outside"/"retail".
    if (this.step % 4 === 2 && def.density > 0.5) {
      this.blip(midiToFreq(note + 12), time + 0.04, "sine", this.musicGain, 0.08, 0.18);
    }
  }

  private blip(
    freq: number,
    time: number,
    wave: OscillatorType,
    dest: AudioNode,
    peak: number,
    dur: number,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  // ---- One-shot action jingles ------------------------------------------

  sfx(name: "build" | "sell" | "error" | "promote" | "money" | "click"): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case "build":
        this.blip(midiToFreq(72), t, "square", this.master, 0.18, 0.08);
        this.blip(midiToFreq(79), t + 0.07, "square", this.master, 0.18, 0.1);
        break;
      case "sell":
        this.blip(midiToFreq(67), t, "sawtooth", this.master, 0.16, 0.1);
        this.blip(midiToFreq(60), t + 0.08, "sawtooth", this.master, 0.16, 0.12);
        break;
      case "error":
        this.blip(midiToFreq(48), t, "square", this.master, 0.2, 0.18);
        break;
      case "money":
        [76, 80, 83, 88].forEach((n, i) =>
          this.blip(midiToFreq(n), t + i * 0.06, "triangle", this.master!, 0.16, 0.14),
        );
        break;
      case "promote":
        [60, 64, 67, 72, 76].forEach((n, i) =>
          this.blip(midiToFreq(n), t + i * 0.1, "triangle", this.master!, 0.22, 0.3),
        );
        break;
      case "click":
        this.blip(midiToFreq(84), t, "sine", this.master, 0.08, 0.04);
        break;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.padOscs.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    this.padOscs = [];
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.started = false;
  }
}

/** Deterministic 0..1 hash so the melody varies without Math.random. */
function pseudo(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10000) / 10000;
}
