import type { Tower } from "./Tower";

/**
 * A cheap fingerprint of everything a *player action* can change (structure,
 * transport config, labels, rents, cinema booking policy, money) — but NOT
 * time, so a press where only the clock ticked doesn't register as a change.
 * Used by {@link UndoHistory} to drop no-op gestures.
 */
export function towerStateSig(tower: Tower, money: number): string {
  const u = tower.units
    .map((x) => `${x.kind}@${x.floor},${x.x}:${x.label ?? ""}:${x.rent ?? ""}:${x.filmPolicy ?? ""}`)
    .join(";");
  const r = tower.transports
    .map((x) => `${x.kind}@${x.x}:${x.bottom}-${x.top}:${x.cars}:${(x.skipFloors ?? []).join(".")}`)
    .join(";");
  return `${money}|${u}|${r}`;
}

/**
 * Ports that connect the (otherwise domain-agnostic) history to the game:
 * how to take/restore an opaque snapshot, how to fingerprint the current
 * player-mutable state, and where to send the "Undid: …" messages.
 */
export interface UndoPorts {
  /** Serialize the current state to an opaque string (e.g. the saved game). */
  snapshot(): string;
  /** Restore a snapshot previously returned by {@link snapshot}. */
  restore(snap: string): void;
  /** Fingerprint the current player-mutable state (see {@link towerStateSig}). */
  signature(): string;
  /** Surface a short user-facing message ("Undid: Bulldoze", "Nothing to undo."). */
  notify(message: string): void;
}

interface Entry {
  snap: string;
  label: string;
}

/** Most snapshots we keep on each stack before the oldest is dropped. */
const UNDO_CAP = 40;

/**
 * Snapshot-based undo/redo with per-gesture coalescing. A gesture calls
 * {@link capture} on its first mutation and {@link commit} on its end; the
 * snapshot is only kept if the {@link UndoPorts.signature} actually changed, so
 * a misfired or empty gesture leaves no step. Restores go through the ports, so
 * this class knows nothing about the simulation itself.
 */
export class UndoHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private pending: { snap: string; sig: string; label: string } | null = null;

  constructor(private readonly ports: UndoPorts) {}

  /** Capture the pre-action snapshot at the start of a gesture. */
  capture(label: string): void {
    this.pending = { snap: this.ports.snapshot(), sig: this.ports.signature(), label };
  }

  /** Finalize the captured snapshot — but only if something actually changed. */
  commit(): void {
    const p = this.pending;
    this.pending = null;
    if (!p || this.ports.signature() === p.sig) return;
    this.undoStack.push({ snap: p.snap, label: p.label });
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack.length = 0; // a fresh action invalidates the redo trail
  }

  undo(): void {
    this.commit(); // finalize any in-flight gesture first
    const entry = this.undoStack.pop();
    if (!entry) return this.ports.notify("Nothing to undo.");
    this.redoStack.push({ snap: this.ports.snapshot(), label: entry.label });
    this.ports.restore(entry.snap);
    this.ports.notify(`Undid: ${entry.label}`);
  }

  redo(): void {
    this.commit(); // finalize any in-flight gesture first (matches undo)
    const entry = this.redoStack.pop();
    if (!entry) return this.ports.notify("Nothing to redo.");
    this.undoStack.push({ snap: this.ports.snapshot(), label: entry.label });
    this.ports.restore(entry.snap);
    this.ports.notify(`Redid: ${entry.label}`);
  }

  /** Drop the whole trail — e.g. when a *different* tower is adopted. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }
}
