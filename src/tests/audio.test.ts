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
});

