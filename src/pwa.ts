/// <reference types="vite-plugin-pwa/client" />

/**
 * PWA service-worker registration and the "always run the latest" update flow.
 *
 * This is the ONLY place the service worker is registered (the Vite plugin's
 * auto-injection is turned off), and it's imported solely by the game entry
 * (`main.ts`) — never by the gallery/preview tooling pages, and never by the
 * test graph. Workbox does all the heavy lifting; we only decide *when* to
 * swap in a new version.
 *
 * The rule the user asked for: when a new build ships, force a quick save and
 * then release the new assets so the player is always on the latest code
 * without ever losing their tower. We run in `prompt` mode (the fresh worker
 * waits) so we control that instant: flush the save first, then activate.
 */
import { registerSW } from "virtual:pwa-register";

export interface PwaHandlers {
  /**
   * Fired the moment a new version is waiting. Flush any in-memory state to
   * disk here (a quick save) — a reload follows almost immediately. May be
   * async; the reload waits for it to settle.
   */
  onUpdateReady: () => void | Promise<void>;
  /** Fired once the app is fully cached and usable offline. */
  onOfflineReady?: () => void;
}

/**
 * How long to let the "updating…" toast breathe before the reload. Long enough
 * to be seen, short enough to still feel like "always latest".
 */
const UPDATE_GRACE_MS = 900;

export function registerPWA(handlers: PwaHandlers): void {
  // Service workers only work in a secure context with SW support. Bail cleanly
  // otherwise — a non-browser environment, insecure `http://`, or a page opened
  // straight from `file://` — rather than let registration throw a
  // SecurityError. (localhost counts as secure, so dev/preview still register.)
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // A new worker is waiting. Flush the tower to disk FIRST, then activate it
      // (`updateSW(true)` calls skipWaiting and reloads onto the new assets).
      // The async wrapper also catches a *synchronous* throw from the save.
      //
      // If the save throws or rejects (e.g. localStorage quota), we do NOT
      // reload — that would drop unsaved progress, the one thing this flow
      // exists to prevent. The new worker simply stays waiting and activates on
      // the next natural page load, so the player keeps their tower either way.
      void (async () => {
        try {
          await handlers.onUpdateReady();
        } catch {
          return;
        }
        window.setTimeout(() => void updateSW(true), UPDATE_GRACE_MS);
      })();
    },
    onOfflineReady() {
      handlers.onOfflineReady?.();
    },
  });
}
