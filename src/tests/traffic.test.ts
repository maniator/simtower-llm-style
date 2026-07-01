import { describe, it, expect } from "vitest";
import { trafficTier, TRAFFIC_LABELS, trafficGlyph } from "../engine/traffic";

describe("Traffic tier (color-blind cue)", () => {
  it("maps congestion to the 4-tier ladder at the right boundaries", () => {
    expect(trafficTier(0)).toBe(0); // Smooth
    expect(trafficTier(0.9)).toBe(0);
    expect(trafficTier(1.0)).toBe(1); // Busy at exactly 1.0
    expect(trafficTier(1.25)).toBe(1); // still Busy AT the boundary
    expect(trafficTier(1.26)).toBe(2); // Backed up
    expect(trafficTier(1.6)).toBe(2); // Backed up AT the boundary
    expect(trafficTier(1.61)).toBe(3); // Gridlock
  });
  it("tier ≥ 2 aligns with the walker-red gate (stress > 0.25 ⇒ congestion > 1.25)", () => {
    expect(trafficTier(1.25)).toBeLessThan(2);
    expect(trafficTier(1.26)).toBeGreaterThanOrEqual(2);
  });
  it("glyph is shape-coded (fills to the tier) and grayscale-legible", () => {
    expect(trafficGlyph(0)).toBe("▮▯▯▯");
    expect(trafficGlyph(3)).toBe("▮▮▮▮");
    expect(TRAFFIC_LABELS[trafficTier(2.0)]).toBe("Gridlock");
  });
});
