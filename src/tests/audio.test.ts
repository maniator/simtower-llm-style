import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioSynth } from "../core/audio/AudioSynth.ts";

let lastContext: any = null;

class FakeAudioContext {
  public destination = {};
  public currentTime = 0;
  public createGain = vi.fn(() => ({
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }));
  public createOscillator = vi.fn(() => ({
    type: "sine",
    frequency: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));

  constructor() {
    lastContext = this;
  }
}

describe("AudioSynth", () => {
  beforeEach(() => {
    (window as any).AudioContext = FakeAudioContext;
    (window as any).webkitAudioContext = undefined;
    lastContext = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should play a UI click sound", () => {
    const synth = new AudioSynth();

    synth.uiClick();

    expect(lastContext.createOscillator).toHaveBeenCalledTimes(1);
  });

  it("should schedule a build complete chord", () => {
    vi.useFakeTimers();
    const synth = new AudioSynth();

    synth.buildComplete();
    vi.runAllTimers();

    expect(lastContext.createOscillator).toHaveBeenCalledTimes(3);
  });

  it("should play a build fail sound", () => {
    const synth = new AudioSynth();

    synth.buildFail();

    expect(lastContext.createOscillator).toHaveBeenCalledTimes(1);
  });

  it("should play a coin gain sound with two notes", () => {
    vi.useFakeTimers();
    const synth = new AudioSynth();

    synth.coinGain();
    vi.runAllTimers();

    expect(lastContext.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("should play an elevator ding sound", () => {
    const synth = new AudioSynth();

    synth.elevatorDing();

    expect(lastContext.createOscillator).toHaveBeenCalledTimes(1);
  });

  it("should schedule a population gain chord", () => {
    vi.useFakeTimers();
    const synth = new AudioSynth();

    synth.populationGain();
    vi.runAllTimers();

    expect(lastContext.createOscillator).toHaveBeenCalledTimes(3);
  });

  it("should schedule a VIP arrival fanfare", () => {
    vi.useFakeTimers();
    const synth = new AudioSynth();

    synth.vipArrival();
    vi.runAllTimers();

    // 6 notes but one is 0 (rest), so 5 oscillators
    expect(lastContext.createOscillator).toHaveBeenCalledTimes(5);
  });

  it("should throw error if AudioContext is not supported", () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;

    expect(() => new AudioSynth()).toThrow(
      "AudioContext not supported in this browser",
    );
  });

  it("should use webkitAudioContext as fallback", () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = FakeAudioContext;

    const synth = new AudioSynth();
    expect(synth).toBeDefined();
    expect(lastContext).toBeDefined();
  });
});

