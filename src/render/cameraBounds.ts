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
 * @param desiredY   the camera-centre Y the player is trying to move to
 * @param viewHeight viewport height in screen pixels
 * @param zoom       camera zoom (screen pixels per world pixel)
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
  const halfH = viewHeight / 2 / zoom;
  const topY = -(maxFloor + 2) * floorPx; // a little sky above the top floor
  const bottomY = -(minFloor - 2) * floorPx; // ~2 floors of dirt below the basement

  // If the whole world is shorter than the viewport (very zoomed out), pin the
  // ground to the bottom of the screen and let sky fill the rest, rather than
  // letting the tower float over empty void.
  if (bottomY - topY <= 2 * halfH) return bottomY - halfH;

  // Otherwise keep the visible window inside [topY, bottomY].
  return Math.max(topY + halfH, Math.min(bottomY - halfH, desiredY));
}
