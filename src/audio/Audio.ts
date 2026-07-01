import type { FacilityKind } from "../engine/types";
import type { ViewFocus } from "../render/excalibur/TowerEngine";

/**
 * Procedural ambient audio. SimTower famously played different background
 * music depending on which part of the tower you were viewing. This engine
 * synthesises short looping MIDI-style themes with WebAudio oscillators and
 * crossfades between them as the camera focus changes — plus a few action
 * jingles (build, sell, promotion, error).
 *
 * On top of the melodic layer it renders a per-scene ambient "room tone"
 * (filtered noise — crowd murmur, kitchen bustle, tunnel rumble, HVAC hum), a
 * low bass voice, and a light reverb so the whole thing feels like a place
 * rather than a chiptune. The mix is *zoom-reactive*: pulled all the way out
 * you hear a warm, distant "whole tower" overview theme; as you zoom into a
 * floor the distance filter opens up and area-specific detail fades in —
 * elevator dings in a lobby, dish clatter in a food court, a train whoosh
 * down in the metro. Rainy days add an outdoor rain layer.
 *
 * Everything is feature-detected and gesture-gated so it is inert under tests
 * and before the first user interaction.
 */

type Scene =
  | "overview"
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

/** Close-up flavor scheduled only when the camera is zoomed in on a scene. */
type Accent =
  | "none"
  | "ding"
  | "clatter"
  | "keys"
  | "rumble"
  | "boom"
  | "register"
  | "chatter";

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
  /** Low bass voice presence 0..1 (0 = silent). */
  bass: number;
  /** Ambient room-tone bed, shaped by a bandpass/lowpass on looping noise. */
  amb: { type: BiquadFilterType; freq: number; q: number; gain: number };
  /** Detail sound heard up close (see {@link Accent}). */
  accent: Accent;
}

const SCENES: Record<Scene, SceneDef> = {
  // A warm, slow, wide "whole tower" theme heard when fully zoomed out.
  overview: {
    scale: [0, 2, 4, 7, 9],
    root: 48,
    bpm: 58,
    wave: "triangle",
    pad: [0, 7, 12, 16, 19],
    density: 0.3,
    gain: 0.6,
    bass: 0.5,
    amb: { type: "lowpass", freq: 240, q: 0.7, gain: 0.22 },
    accent: "none",
  },
  outside: {
    scale: [0, 2, 4, 7, 9],
    root: 64,
    bpm: 70,
    wave: "sine",
    pad: [0, 7, 16],
    density: 0.35,
    gain: 0.5,
    bass: 0.3,
    amb: { type: "bandpass", freq: 320, q: 0.5, gain: 0.26 },
    accent: "none",
  },
  lobby: {
    scale: [0, 2, 4, 5, 7, 9, 11],
    root: 60,
    bpm: 96,
    wave: "triangle",
    pad: [0, 4, 7, 11],
    density: 0.55,
    gain: 0.6,
    bass: 0.35,
    amb: { type: "bandpass", freq: 520, q: 0.8, gain: 0.24 },
    accent: "ding",
  },
  office: {
    scale: [0, 2, 3, 5, 7, 9, 10],
    root: 57,
    bpm: 116,
    wave: "square",
    pad: [0, 3, 7],
    density: 0.7,
    gain: 0.45,
    bass: 0.4,
    amb: { type: "bandpass", freq: 220, q: 1.2, gain: 0.2 },
    accent: "keys",
  },
  residential: {
    scale: [0, 2, 4, 7, 9],
    root: 62,
    bpm: 80,
    wave: "triangle",
    pad: [0, 4, 7],
    density: 0.4,
    gain: 0.55,
    bass: 0.3,
    amb: { type: "bandpass", freq: 360, q: 0.7, gain: 0.14 },
    accent: "chatter",
  },
  hotel: {
    scale: [0, 2, 3, 5, 7, 8, 10],
    root: 55,
    bpm: 60,
    wave: "sine",
    pad: [0, 3, 7, 10],
    density: 0.3,
    gain: 0.5,
    bass: 0.35,
    amb: { type: "bandpass", freq: 260, q: 0.9, gain: 0.12 },
    accent: "ding",
  },
  food: {
    scale: [0, 2, 4, 5, 7, 9, 11],
    root: 65,
    bpm: 124,
    wave: "triangle",
    pad: [0, 4, 7, 9],
    density: 0.8,
    gain: 0.55,
    bass: 0.4,
    amb: { type: "bandpass", freq: 900, q: 0.6, gain: 0.26 },
    accent: "clatter",
  },
  retail: {
    scale: [0, 2, 4, 7, 9, 11],
    root: 67,
    bpm: 110,
    wave: "triangle",
    pad: [0, 4, 7],
    density: 0.65,
    gain: 0.55,
    bass: 0.35,
    amb: { type: "bandpass", freq: 700, q: 0.7, gain: 0.24 },
    accent: "register",
  },
  cinema: {
    scale: [0, 2, 3, 5, 7, 8, 11],
    root: 53,
    bpm: 88,
    wave: "sawtooth",
    pad: [0, 3, 7, 10, 14],
    density: 0.5,
    gain: 0.5,
    bass: 0.5,
    amb: { type: "lowpass", freq: 110, q: 0.8, gain: 0.28 },
    accent: "boom",
  },
  service: {
    scale: [0, 2, 4, 5, 7],
    root: 58,
    bpm: 90,
    wave: "sine",
    pad: [0, 5, 7],
    density: 0.3,
    gain: 0.4,
    bass: 0.3,
    amb: { type: "bandpass", freq: 180, q: 1.5, gain: 0.18 },
    accent: "none",
  },
  metro: {
    scale: [0, 3, 5, 7, 10],
    root: 43,
    bpm: 76,
    wave: "sawtooth",
    pad: [0, 7, 12],
    density: 0.35,
    gain: 0.5,
    bass: 0.55,
    amb: { type: "lowpass", freq: 90, q: 0.8, gain: 0.32 },
    accent: "rumble",
  },
  quiet: {
    scale: [0, 4, 7],
    root: 60,
    bpm: 64,
    wave: "sine",
    pad: [0, 7],
    density: 0.2,
    gain: 0.35,
    bass: 0.2,
    amb: { type: "bandpass", freq: 400, q: 0.6, gain: 0.09 },
    accent: "none",
  },
};

/** Below this zoom the whole tower is in frame, so we play the overview theme. */
const OVERVIEW_ZOOM = 0.55;
/** Zoom at which area detail is fully faded in. */
const DETAIL_ZOOM = 1.7;
/** Sustained pad voices; enough for the widest chord (5 tones). */
const PAD_VOICES = 5;

function sceneFor(focus: ViewFocus): Scene {
  // Zoomed all the way out — you're looking at the whole building, so play the
  // wide overview theme regardless of what happens to be centered.
  if (focus.zoom < OVERVIEW_ZOOM) return "overview";
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

/** Map camera zoom to a 0..1 "how close are we" detail factor. */
function detailFor(zoom: number): number {
  return clamp((zoom - OVERVIEW_ZOOM) / (DETAIL_ZOOM - OVERVIEW_ZOOM), 0, 1);
}

function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Distance lowpass on the musical/ambient bed; opens up as you zoom in. */
  private bedFilter: BiquadFilterNode | null = null;
  private wetGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private bassGain: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private ambFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private accentGain: GainNode | null = null;
  private padVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private bassOsc: OscillatorNode | null = null;
  private ambSrc: AudioBufferSourceNode | null = null;
  private rainSrc: AudioBufferSourceNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  /** Position within the 16-step bar — drives strong/weak beat placement. */
  private step = 0;
  /** Free-running step counter (never wraps) so the melody and ambient accents
   * evolve across bars instead of repeating a fixed 16-step pattern. */
  private tick = 0;
  private scene: Scene = "lobby";
  private targetScene: Scene = "lobby";
  private ambBase = 0.2;
  private detail = 0.4;
  private rainTarget = 0;
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

      // Musical + ambient content flows through a lowpass whose cutoff tracks
      // zoom: far out it's muffled (you're across the plaza), up close it opens.
      this.bedFilter = this.ctx.createBiquadFilter();
      this.bedFilter.type = "lowpass";
      this.bedFilter.frequency.value = 3000;
      this.bedFilter.Q.value = 0.7;
      this.bedFilter.connect(this.master);

      // A gentle reverb so scenes feel like rooms, not oscillators.
      this.setupReverb();

      this.padGain = this.gainInto(this.bedFilter, 0);
      this.musicGain = this.gainInto(this.bedFilter, 0);
      this.bassGain = this.gainInto(this.bedFilter, 0);
      this.ambGain = this.gainInto(this.bedFilter, 0);
      // Accents and rain stay crisp (routed dry to master), not distance-filtered.
      this.accentGain = this.gainInto(this.master, 0.6);
      this.rainGain = this.gainInto(this.master, 0);

      this.noiseBuf = this.makeNoise(2);
      this.startPad();
      this.startBass();
      this.startAmbience();
      this.startRain();

      this.nextNoteTime = this.ctx.currentTime;
      this.timer = setInterval(() => this.scheduler(), 60);
      this.started = true;
      this.applyScene(this.scene, 0.01);
      this.applyDetail(this.detail, 0.01);
      // Browsers' autoplay policy creates the context "suspended"; resume it
      // (we're inside a user gesture) or no sound is ever produced.
      this.resume();
    } catch {
      this.ctx = null;
    }
  }

  private gainInto(dest: AudioNode, value: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  private setupReverb(): void {
    if (!this.ctx || !this.bedFilter || !this.master) return;
    if (typeof this.ctx.createConvolver !== "function") return;
    try {
      const conv = this.ctx.createConvolver();
      conv.buffer = this.makeImpulse(1.6);
      this.wetGain = this.ctx.createGain();
      this.wetGain.gain.value = 0.16;
      this.bedFilter.connect(conv);
      conv.connect(this.wetGain);
      this.wetGain.connect(this.master);
    } catch {
      this.wetGain = null; // dry-only fallback
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.35, this.ctx.currentTime, 0.1);
    }
    if (!m) this.resume();
  }

  /** Resume a context the autoplay policy left suspended. Safe to call often. */
  private resume(): void {
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  /** Called every frame with the renderer's focus; switches scenes smoothly. */
  update(focus: ViewFocus): void {
    if (!this.started || !this.ctx) return;

    // Zoom detail: opens the distance filter and fades ambient detail in/out.
    const detail = detailFor(focus.zoom);
    if (Math.abs(detail - this.detail) > 0.02) this.applyDetail(detail, 0.3);

    const s = sceneFor(focus);
    if (s !== this.targetScene) {
      this.targetScene = s;
      this.crossfadeTo(s);
    }

    // Outdoor rain layer — only when you can actually see the sky (zoomed out
    // to the overview or looking at the street), so it reads as a real "tell"
    // for the weather rather than an inaudible smear behind indoor scenes.
    const wantRain = focus.weather === "rain" && (s === "outside" || s === "overview") ? 0.13 : 0;
    if (wantRain !== this.rainTarget && this.rainGain) {
      this.rainTarget = wantRain;
      this.rainGain.gain.setTargetAtTime(wantRain, this.ctx.currentTime, 1.5);
    }
  }

  private crossfadeTo(s: Scene): void {
    if (!this.ctx) return;
    this.scene = s;
    this.applyScene(s, 1.2);
  }

  private applyScene(s: Scene, time: number): void {
    if (!this.ctx || !this.padGain || !this.musicGain || !this.bassGain) return;
    const def = SCENES[s];
    const now = this.ctx.currentTime;
    this.padGain.gain.setTargetAtTime(def.gain * 0.16, now, time);
    this.musicGain.gain.setTargetAtTime(def.gain * 0.2, now, time);
    this.bassGain.gain.setTargetAtTime(def.bass * 0.16, now, time);

    // Retune / gate the pad voices to the new chord.
    for (let i = 0; i < PAD_VOICES; i++) {
      const v = this.padVoices[i];
      if (!v) continue;
      if (i < def.pad.length) {
        v.osc.frequency.setTargetAtTime(midiToFreq(def.root + def.pad[i] - 12), now, time);
        v.gain.gain.setTargetAtTime(PAD_VOICE_GAIN[i] ?? 0.2, now, time);
      } else {
        v.gain.gain.setTargetAtTime(0, now, time);
      }
    }
    if (this.bassOsc) this.bassOsc.frequency.setTargetAtTime(midiToFreq(def.root - 12), now, time);

    // Retune the ambient bed to this scene's character.
    if (this.ambFilter) {
      this.ambFilter.type = def.amb.type;
      this.ambFilter.frequency.setTargetAtTime(def.amb.freq, now, time);
      this.ambFilter.Q.setTargetAtTime(def.amb.q, now, time);
    }
    this.ambBase = def.amb.gain;
    this.updateAmbGain(time);
  }

  /** React to zoom: open the distance filter and scale ambient detail. */
  private applyDetail(detail: number, time: number): void {
    if (!this.ctx) return;
    this.detail = detail;
    const now = this.ctx.currentTime;
    if (this.bedFilter) {
      this.bedFilter.frequency.setTargetAtTime(lerp(650, 15000, detail), now, time);
    }
    this.updateAmbGain(time);
  }

  private updateAmbGain(time: number): void {
    if (!this.ctx || !this.ambGain) return;
    // Some room tone is always present; the rest fades in as you zoom in.
    const g = this.ambBase * (0.3 + 0.7 * this.detail);
    this.ambGain.gain.setTargetAtTime(g, this.ctx.currentTime, time);
  }

  private startPad(): void {
    if (!this.ctx || !this.padGain) return;
    this.padVoices = [];
    for (let i = 0; i < PAD_VOICES; i++) {
      const osc = this.ctx.createOscillator();
      // Alternate timbres and a hair of detune give the pad a warmer chorus.
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.detune.value = (i - 2) * 4;
      osc.frequency.value = midiToFreq(60);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.padGain);
      osc.start();
      this.padVoices.push({ osc, gain: g });
    }
  }

  private startBass(): void {
    if (!this.ctx || !this.bassGain) return;
    this.bassOsc = this.ctx.createOscillator();
    this.bassOsc.type = "triangle";
    this.bassOsc.frequency.value = midiToFreq(48);
    this.bassOsc.connect(this.bassGain);
    this.bassOsc.start();
  }

  private startAmbience(): void {
    if (!this.ctx || !this.ambGain || !this.noiseBuf) return;
    this.ambFilter = this.ctx.createBiquadFilter();
    this.ambFilter.type = "bandpass";
    this.ambFilter.frequency.value = 500;
    this.ambFilter.Q.value = 0.7;
    this.ambFilter.connect(this.ambGain);
    this.ambSrc = this.ctx.createBufferSource();
    this.ambSrc.buffer = this.noiseBuf;
    this.ambSrc.loop = true;
    this.ambSrc.connect(this.ambFilter);
    this.ambSrc.start();
  }

  private startRain(): void {
    if (!this.ctx || !this.rainGain || !this.noiseBuf) return;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    hp.Q.value = 0.5;
    hp.connect(this.rainGain);
    this.rainSrc = this.ctx.createBufferSource();
    this.rainSrc.buffer = this.noiseBuf;
    this.rainSrc.loop = true;
    this.rainSrc.playbackRate.value = 1.3;
    this.rainSrc.connect(hp);
    this.rainSrc.start();
  }

  /** Lookahead note scheduler for the melodic arpeggio + close-up accents. */
  private scheduler(): void {
    if (!this.ctx || this.muted) return;
    const def = SCENES[this.scene];
    const secondsPerStep = 60 / def.bpm / 2; // eighth notes
    // If the clock jumped forward (e.g. the context just resumed from suspended),
    // re-anchor so we don't flush a burst of notes scheduled in the past.
    if (this.nextNoteTime < this.ctx.currentTime) this.nextNoteTime = this.ctx.currentTime;
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      this.scheduleStep(def, this.nextNoteTime);
      if (this.detail > 0.5) this.maybeAccent(def, this.nextNoteTime);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 16;
      this.tick++;
    }
  }

  private scheduleStep(def: SceneDef, time: number): void {
    if (!this.ctx || !this.musicGain) return;
    // Seeded-but-varied note choice without Math.random dependency on engine.
    // Seed off the free-running tick so the line evolves bar to bar rather than
    // looping a fixed 16-note pattern; keep step%4 for musical beat placement.
    const r = pseudo(this.tick * 2654435761);
    if (r > def.density) return;
    // Land on chord tones on strong beats so the melody feels grounded.
    const onBeat = this.step % 4 === 0;
    let note: number;
    if (onBeat && def.pad.length) {
      const pi = Math.floor(pseudo(this.tick * 22695477 + 3) * def.pad.length);
      note = def.root + def.pad[pi];
    } else {
      const degree = Math.floor(pseudo(this.tick * 40503 + 7) * def.scale.length);
      const octave = pseudo(this.tick * 19349663) > 0.7 ? 12 : 0;
      note = def.root + def.scale[degree] + octave;
    }
    // Soften the harsher timbres so square/saw leads don't fatigue the ear.
    const peak = def.wave === "square" || def.wave === "sawtooth" ? 0.15 : 0.22;
    this.blip(midiToFreq(note), time, def.wave, this.musicGain, peak, 0.32);
    // A high sparkle on off-beats — but only once you've zoomed in enough to
    // "hear the detail", giving close-ups their own extra shimmer.
    if (this.step % 4 === 2 && def.density > 0.5 && this.detail > 0.45) {
      this.blip(midiToFreq(note + 12), time + 0.04, "sine", this.musicGain, 0.07, 0.18);
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

  /** A pitch-swept tone (used by low rumbles / booms). */
  private sweep(
    f0: number,
    f1: number,
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
    osc.frequency.setValueAtTime(f0, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), time + dur);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  /** A short filtered-noise burst (dish clatter, keystrokes, footfalls). */
  private noiseBurst(
    time: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    peak: number,
    dur: number,
  ): void {
    if (!this.ctx || !this.noiseBuf || !this.accentGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.accentGain);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  /** Occasionally fire a scene-specific close-up accent. */
  private maybeAccent(def: SceneDef, time: number): void {
    if (def.accent === "none" || !this.accentGain) return;
    const g = pseudo(this.tick * 2246822519 + 101);
    if (g > 0.14 * this.detail) return;
    this.accentHit(def.accent, time);
  }

  private accentHit(accent: Accent, time: number): void {
    if (!this.ctx || !this.accentGain) return;
    switch (accent) {
      case "ding": // elevator arrival chime
        this.blip(midiToFreq(84), time, "sine", this.accentGain, 0.11, 0.5);
        this.blip(midiToFreq(79), time + 0.13, "sine", this.accentGain, 0.09, 0.6);
        break;
      case "clatter": // dishes / cutlery
        this.noiseBurst(time, "bandpass", 2600, 6, 0.12, 0.05);
        this.blip(midiToFreq(96), time + 0.02, "sine", this.accentGain, 0.04, 0.03);
        break;
      case "keys": // keyboard typing
        this.noiseBurst(time, "highpass", 3200, 0.7, 0.05, 0.02);
        this.noiseBurst(time + 0.09, "highpass", 3600, 0.7, 0.04, 0.02);
        break;
      case "rumble": // a train passing through the metro
        this.sweep(70, 40, time, "sawtooth", this.accentGain, 0.13, 0.7);
        this.noiseBurst(time, "lowpass", 180, 0.7, 0.1, 0.6);
        break;
      case "boom": // a deep cinema hit
        this.sweep(60, 32, time, "sine", this.accentGain, 0.16, 0.5);
        break;
      case "register": // shop register beep
        this.blip(midiToFreq(88), time, "square", this.accentGain, 0.07, 0.06);
        this.blip(midiToFreq(83), time + 0.08, "square", this.accentGain, 0.07, 0.08);
        break;
      case "chatter": // muffled conversation
        this.noiseBurst(time, "bandpass", 700, 2, 0.06, 0.14);
        break;
    }
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

  /** Generate a mono white-noise buffer used by the ambient/rain layers. */
  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx!.sampleRate * seconds);
    const buf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = pseudo(i * 2654435761 + 1) * 2 - 1;
    return buf;
  }

  /** Generate an exponentially-decaying stereo impulse response for reverb. */
  private makeImpulse(seconds: number): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx!.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.6);
        d[i] = (pseudo(i * 2654435761 + ch * 7 + 3) * 2 - 1) * decay;
      }
    }
    return buf;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    const stop = (n: OscillatorNode | AudioBufferSourceNode | null) => {
      try {
        n?.stop();
      } catch {
        /* already stopped */
      }
    };
    this.padVoices.forEach((v) => stop(v.osc));
    this.padVoices = [];
    stop(this.bassOsc);
    stop(this.ambSrc);
    stop(this.rainSrc);
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.started = false;
  }
}

/** Relative loudness of each sustained pad voice (root loudest). */
const PAD_VOICE_GAIN = [0.5, 0.3, 0.28, 0.22, 0.18];

/** Deterministic 0..1 hash so the melody varies without Math.random. */
function pseudo(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10000) / 10000;
}
