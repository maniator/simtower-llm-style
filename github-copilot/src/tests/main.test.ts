import { describe, it, expect, beforeEach, vi } from "vitest";

const setupDom = (): HTMLCanvasElement => {
  document.body.innerHTML = `
    <div id="money"></div>
    <div id="population"></div>
    <div id="happiness"></div>
    <div id="rating"></div>
    <div id="info-panel"></div>
    <div id="elevator-panel"></div>
    <div id="tool-categories"></div>
    <div id="status-text"></div>
    <div id="time-indicator"></div>
    <button class="time-btn" data-speed="0">Pause</button>
    <button class="time-btn" data-speed="1">Play</button>
    <button class="time-btn" data-speed="3">Fast</button>
    <button id="reset-btn"></button>
    <button id="export-btn"></button>
    <button id="import-btn"></button>
  `;
  const canvas = document.createElement("canvas");
  canvas.id = "tower-canvas";
  document.body.appendChild(canvas);
  return canvas;
};

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
}

describe("main bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    const canvas = setupDom();
    (canvas as any).getContext = vi.fn(() => ({
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      canvas: { width: 800, height: 600 },
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      font: "",
      textAlign: "",
      textBaseline: "",
      lineWidth: 1,
    }));

    (window as any).AudioContext = FakeAudioContext;
    (window as any).webkitAudioContext = undefined;

    (window as any).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };

    (window as any).requestAnimationFrame = vi.fn(() => 1);
    (window as any).cancelAnimationFrame = vi.fn();
  });

  it("should bootstrap without throwing", async () => {
    await import("../app/main.ts");

    expect((window as any).__appState).toBeTruthy();
  });
});
