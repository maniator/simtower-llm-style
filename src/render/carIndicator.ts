/**
 * Pure presentation logic for an elevator car's on-cab indicators, split out
 * from the canvas drawing so the *policy* (how a car's live state maps to what
 * the player sees) is unit-tested independently of any rendering.
 */

export type CarArrow = "up" | "down" | null;

export interface CarIndicator {
  /** Riders to draw, bucketed 0..4 and scaled to the car's capacity so a big
   *  express cab doesn't look full at a fraction of its load. */
  riders: number;
  /** Direction lantern: which way the car is moving, or null when idle. */
  arrow: CarArrow;
  /** True once the car is at (or over) capacity — drives the FULL sign. */
  full: boolean;
}

/**
 * Map an elevator car's live state to its cab indicators.
 * @param dir  −1 descending, 0 idle, +1 ascending
 * @param load passengers currently aboard
 * @param cap  car capacity
 */
export function carIndicator(dir: number, load: number, cap: number): CarIndicator {
  const safeCap = cap > 0 ? cap : 1;
  const clampedLoad = Math.max(0, load);
  const riders = Math.max(0, Math.min(4, Math.round((clampedLoad / safeCap) * 4)));
  const arrow: CarArrow = dir > 0 ? "up" : dir < 0 ? "down" : null;
  const full = cap > 0 && load >= cap;
  return { riders, arrow, full };
}
