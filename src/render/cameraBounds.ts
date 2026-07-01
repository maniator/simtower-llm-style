/**
 * Pure camera-bounds math, split out from the Excalibur-bound {@link TowerEngine}
 * so it can be unit-tested without a canvas/WebGL context.
 */

/**
 * Clamp the camera's vertical *center* so the visible window stays within the
 * meaningful world — from a little sky above the top floor down to just past the
 * deepest buildable basement. Crucially it accounts for zoom: it bounds the
 * visible top/bottom *edges*, not the center, so zooming or panning out can
 * never reveal empty void below the ground (you can't build below the basement
 * limit, so there is nothing down there to show).
 *
 * World Y grows downward and floor `f` sits at `y = -f * floorPx`, so the top of
 * the world (highest floor) is the most-negative Y and basements are positive Y.
 *
 * @param desiredY   the camera-center Y the player is trying to move to; a
 *                   non-finite value falls back to the world midpoint
 * @param viewHeight viewport height in screen pixels
 * @param zoom       camera zoom (screen pixels per world pixel); non-positive or
 *                   non-finite values fall back to 1 so the result stays finite
 * @param floorPx    height of one floor in world pixels
 * @param minFloor   deepest buildable floor (e.g. -9 for B10)
 * @param maxFloor   highest buildable floor
 */
export function clampCameraY(
  desiredY: number,
  viewHeight: number,
  zoom: number,
  floorPx: number,
  minFloor: number,
  maxFloor: number,
): number {
  // Guard against a zero/negative/NaN zoom so half-height (and the result) can
  // never become Infinity/NaN, regardless of what a caller passes.
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const halfH = viewHeight / 2 / safeZoom;
  const topY = -(maxFloor + 2) * floorPx; // a little sky above the top floor
  const bottomY = -(minFloor - 2) * floorPx; // ~2 floors of dirt below the basement

  // If the whole world is shorter than the viewport (very zoomed out), pin the
  // ground to the bottom of the screen and let sky fill the rest, rather than
  // letting the tower float over empty void.
  if (bottomY - topY <= 2 * halfH) return bottomY - halfH;

  // Normalize a non-finite target (NaN/Infinity) to the world midpoint so the
  // Math.min/Math.max below can't propagate NaN — the result is always finite.
  const target = Number.isFinite(desiredY) ? desiredY : (topY + bottomY) / 2;
  // Keep the visible window inside [topY, bottomY].
  return Math.max(topY + halfH, Math.min(bottomY - halfH, target));
}
