/**
 * Pure congestion → traffic-tier mapping for the color-blind-safe traffic cue.
 * Kept pure and headless so it's unit-testable and shared by the HUD chip and
 * any future overlay. Thresholds mirror the engine's stress gate
 * (`d.stress = clamp(congestion - 1)`); tier ≥ 2 is exactly when frustrated
 * walkers turn red (stress > 0.25 ⇒ congestion > 1.25), so shape and colour agree.
 */
export type TrafficTier = 0 | 1 | 2 | 3;

export function trafficTier(congestion: number): TrafficTier {
  if (congestion > 1.6) return 3; // Gridlock
  if (congestion > 1.25) return 2; // Backed up
  if (congestion >= 1.0) return 1; // Busy
  return 0; // Smooth
}

export const TRAFFIC_LABELS = ["Smooth", "Busy", "Backed up", "Gridlock"] as const;

/** A shape-coded 4-step bar glyph (▁▃▅▇ filled to the tier) — legible in
 *  grayscale, so the cue never depends on colour alone. */
export function trafficGlyph(tier: TrafficTier): string {
  const on = "▮";
  const off = "▯";
  return on.repeat(tier + 1) + off.repeat(3 - tier);
}
