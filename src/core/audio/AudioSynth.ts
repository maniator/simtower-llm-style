/**
 * Audio synthesis using Web Audio API
 * Generates retro-style sounds procedurally
 */

type OscillatorType = "sine" | "square" | "sawtooth" | "triangle";

interface EnvelopeParams {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

export class AudioSynth {
  private audioContext: AudioContext;
  private masterGain: GainNode;

  constructor() {
    const windowContext = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextClass =
      windowContext.AudioContext || windowContext.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AudioContext not supported in this browser");
    }
    this.audioContext = new AudioContextClass();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.audioContext.destination);
  }

  private playTone(
    frequency: number,
    duration: number,
    type: OscillatorType = "sine",
    envelope: EnvelopeParams = {},
  ): void {
    const {
      attack = 0.01,
      decay = 0.1,
      sustain = 0.5,
      release = 0.1,
    } = envelope;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = type;
    osc.frequency.value = frequency;
    osc.connect(gain);
    gain.connect(this.masterGain);

    const now = this.audioContext.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + attack);
    gain.gain.linearRampToValueAtTime(sustain, now + attack + decay);
    gain.gain.setValueAtTime(sustain, now + duration - release);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  public buildComplete(): void {
    const notes = [523, 659, 784]; // C5, E5, G5 (major chord)
    notes.forEach((freq, i) => {
      setTimeout(
        () =>
          this.playTone(freq, 0.3, "sine", {
            attack: 0.02,
            decay: 0.15,
            sustain: 0.2,
            release: 0.1,
          }),
        i * 80,
      );
    });
  }

  public coinGain(): void {
    this.playTone(880, 0.08, "square", {
      attack: 0.01,
      decay: 0.05,
      sustain: 0.3,
      release: 0.02,
    });
    setTimeout(
      () =>
        this.playTone(1760, 0.08, "square", {
          attack: 0.01,
          decay: 0.05,
          sustain: 0.3,
          release: 0.02,
        }),
      80,
    );
  }

  public buildFail(): void {
    const now = this.audioContext.currentTime;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.linearRampToValueAtTime(200, now + 0.15);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public elevatorDing(): void {
    this.playTone(1046, 0.15, "sine", {
      attack: 0.02,
      decay: 0.08,
      sustain: 0.5,
      release: 0.05,
    });
  }

  public populationGain(): void {
    const notes = [392, 494, 587]; // G4, B4, D5
    notes.forEach((freq, i) => {
      setTimeout(
        () =>
          this.playTone(freq, 0.25, "sine", {
            attack: 0.01,
            decay: 0.1,
            sustain: 0.3,
            release: 0.08,
          }),
        i * 60,
      );
    });
  }

  public vipArrival(): void {
    const notes = [659, 659, 784, 659, 0, 523]; // G5, G5, G5, E5, C5 (fanfare)
    notes.forEach((freq, i) => {
      if (freq === 0) return;
      setTimeout(
        () =>
          this.playTone(freq, 0.2, "sine", {
            attack: 0.02,
            decay: 0.08,
            sustain: 0.4,
            release: 0.08,
          }),
        i * 100,
      );
    });
  }

  public uiClick(): void {
    this.playTone(800, 0.05, "sine", {
      attack: 0.01,
      decay: 0.02,
      sustain: 0.2,
      release: 0.02,
    });
  }
}

