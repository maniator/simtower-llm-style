/**
 * MIDI-style music player for background music
 * Uses Web Audio API to synthesize melodic patterns
 */

interface Note {
  note: number; // MIDI note number (0-127)
  duration: number; // in beats
  velocity?: number; // 0-1
}

interface MusicPattern {
  tempo: number; // BPM
  timeSignature: [number, number];
  notes: Note[];
  name: string;
}

export class MidiPlayer {
  private audioContext: AudioContext;
  private masterGain: GainNode;
  private musicGain: GainNode; // Dedicated gain for music control
  private isPlaying: boolean = false;
  private currentPattern: MusicPattern | null = null;
  private nextNoteTime: number = 0;
  private currentNoteIndex: number = 0;
  private scheduleInterval: number | null = null;
  private volume: number = 0.3;

  // Day music - upbeat, energetic (C major, bright)
  private readonly dayMusic: MusicPattern = {
    name: "Daytime Business",
    tempo: 120,
    timeSignature: [4, 4],
    notes: [
      // Main melody - cheerful progression
      { note: 72, duration: 0.5 }, // C5
      { note: 74, duration: 0.5 }, // D5
      { note: 76, duration: 0.5 }, // E5
      { note: 74, duration: 0.5 }, // D5
      { note: 72, duration: 1 }, // C5
      { note: 69, duration: 0.5 }, // A4
      { note: 71, duration: 0.5 }, // B4
      { note: 72, duration: 1 }, // C5
      
      { note: 76, duration: 0.5 }, // E5
      { note: 77, duration: 0.5 }, // F5
      { note: 79, duration: 0.5 }, // G5
      { note: 77, duration: 0.5 }, // F5
      { note: 76, duration: 1 }, // E5
      { note: 74, duration: 0.5 }, // D5
      { note: 72, duration: 0.5 }, // C5
      { note: 69, duration: 1 }, // A4
      
      { note: 72, duration: 0.5 }, // C5
      { note: 76, duration: 0.5 }, // E5
      { note: 79, duration: 0.5 }, // G5
      { note: 76, duration: 0.5 }, // E5
      { note: 77, duration: 1 }, // F5
      { note: 74, duration: 0.5 }, // D5
      { note: 76, duration: 0.5 }, // E5
      { note: 72, duration: 2 }, // C5 (held)
    ],
  };

  // Night music - calm, mellow (A minor, peaceful)
  private readonly nightMusic: MusicPattern = {
    name: "Evening Serenity",
    tempo: 80,
    timeSignature: [4, 4],
    notes: [
      // Gentle melody - relaxing progression
      { note: 69, duration: 1 }, // A4
      { note: 72, duration: 1 }, // C5
      { note: 76, duration: 1 }, // E5
      { note: 72, duration: 1 }, // C5
      
      { note: 71, duration: 1 }, // B4
      { note: 69, duration: 1 }, // A4
      { note: 67, duration: 2 }, // G4 (held)
      
      { note: 69, duration: 1 }, // A4
      { note: 71, duration: 1 }, // B4
      { note: 72, duration: 1 }, // C5
      { note: 74, duration: 1 }, // D5
      
      { note: 76, duration: 1 }, // E5
      { note: 74, duration: 1 }, // D5
      { note: 72, duration: 1 }, // C5
      { note: 69, duration: 1 }, // A4
      
      { note: 67, duration: 1 }, // G4
      { note: 69, duration: 1 }, // A4
      { note: 72, duration: 1 }, // C5
      { note: 69, duration: 1 }, // A4
      
      { note: 65, duration: 2 }, // F4 (held)
      { note: 69, duration: 2 }, // A4 (held)
    ],
  };

  constructor(audioContext: AudioContext, masterGain: GainNode) {
    this.audioContext = audioContext;
    this.masterGain = masterGain;
    
    // Create dedicated gain node for music
    this.musicGain = this.audioContext.createGain();
    this.musicGain.gain.value = 1.0;
    this.musicGain.connect(this.masterGain);
  }

  private midiToFrequency(midiNote: number): number {
    // Convert MIDI note number to frequency
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  private playNote(note: Note, startTime: number): void {
    const frequency = this.midiToFrequency(note.note);
    const velocity = note.velocity ?? 0.7;
    const tempo = this.currentPattern?.tempo ?? 120;
    const beatDuration = 60 / tempo; // Duration of one beat in seconds
    const noteDuration = note.duration * beatDuration;

    // Create oscillator for the note
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    
    // ADSR envelope
    const attack = 0.02;
    const decay = 0.1;
    const sustain = velocity * 0.5 * this.volume;
    const release = 0.2;
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(velocity * this.volume, startTime + attack);
    gainNode.gain.linearRampToValueAtTime(sustain, startTime + attack + decay);
    gainNode.gain.setValueAtTime(sustain, startTime + noteDuration - release);
    gainNode.gain.linearRampToValueAtTime(0, startTime + noteDuration);
    
    oscillator.connect(gainNode);
    gainNode.connect(this.musicGain);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + noteDuration);
  }

  private scheduleNextNotes(): void {
    if (!this.currentPattern || !this.isPlaying) return;

    const currentTime = this.audioContext.currentTime;
    const scheduleAheadTime = 0.5; // Schedule 0.5 seconds ahead

    while (this.nextNoteTime < currentTime + scheduleAheadTime) {
      if (this.currentNoteIndex >= this.currentPattern.notes.length) {
        // Loop back to the beginning
        this.currentNoteIndex = 0;
      }

      const note = this.currentPattern.notes[this.currentNoteIndex];
      this.playNote(note, this.nextNoteTime);

      const tempo = this.currentPattern.tempo;
      const beatDuration = 60 / tempo;
      this.nextNoteTime += note.duration * beatDuration;
      this.currentNoteIndex++;
    }
  }

  public play(isDaytime: boolean): void {
    if (this.isPlaying && this.currentPattern === (isDaytime ? this.dayMusic : this.nightMusic)) {
      return; // Already playing the correct pattern
    }

    this.stop();
    this.currentPattern = isDaytime ? this.dayMusic : this.nightMusic;
    this.isPlaying = true;
    this.nextNoteTime = this.audioContext.currentTime;
    this.currentNoteIndex = 0;

    // Schedule notes regularly
    this.scheduleInterval = window.setInterval(() => {
      this.scheduleNextNotes();
    }, 100); // Check every 100ms

    this.scheduleNextNotes();
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.scheduleInterval !== null) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
    }
    
    // Fade out music gain to prevent abrupt stops
    const now = this.audioContext.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(0, now + 0.1);
    
    // Reset gain after fade out
    setTimeout(() => {
      if (!this.isPlaying) {
        this.musicGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
      }
    }, 150);
    
    this.currentPattern = null;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  public getVolume(): number {
    return this.volume;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentTrackName(): string {
    return this.currentPattern?.name ?? "None";
  }
}
