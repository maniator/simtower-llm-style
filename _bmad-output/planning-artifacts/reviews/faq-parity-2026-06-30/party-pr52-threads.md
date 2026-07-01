# Party mode — PR #52 (Tower Tycoon legibility pass) open-thread convergence

Date: 2026-07-01 · Worktree: `.claude/worktrees/faq-legib` · HEAD: `3335cb8`

> **UPDATE (post-party):** the T2/T7 (bad→info) and T3 (per-floor dedupe + docstring) fixes are now COMMITTED (64d5334); later Codex/Copilot waves were also addressed (b02b2e4, a7ff3a2). This file is a point-in-time record of the party session — the "uncommitted" note below was true only at that moment.

Verification note: the worktree has **uncommitted local edits** to `src/engine/Simulation.ts`
that already implement the T2/T7 (bad→info) and T3 (per-floor dedupe) fixes. HEAD itself
still ships the old "bad" severity. So those threads are *edited-but-not-committed*, not
closed — the remaining action is to commit (and, for T3, also fix a stale docstring HEAD
still carries).

| T | Consensus | Evidence | Action |
|---|-----------|----------|--------|
| T1 | already-fixed | `Tower.functionalParkingSet()` (Tower.ts:688) is NOT memoised; docstring (682-686) documents that state transitions mutate `state` without bumping `revision`, so a cache would go stale. No parking revision field exists (only `adjRev`/`servedRev`, unrelated). | Close — fixed by d71b6db. |
| T2 | fix-now | `UI.renderLog` (UI.ts:413) toasts every `good`/`bad` entry. HEAD `nudgeStranded` emits `"bad"` → the "log-only (never a toast)" nudge (doc 445-447) DOES toast. Working tree already flips it to `"info"` (uncommitted). | Commit the working-tree edit: `nudgeStranded` emits `"info"` (Simulation.ts:455). `info` is not toasted by renderLog → matches contract. |
| T3 | fix-now | `strandedFloors` per-floor dedupe is applied in the working tree (uncommitted). Independent doc defect REMAINS in HEAD and worktree: `floorReachable` docstring (Simulation.ts:899-900) claims "cached by tower.revision" — false. `Crowd.route` (Crowd.ts:143) caches only the adjacency graph (`adjRev`, 116), never the route BFS. | Commit the dedupe AND correct/delete the false "cached by tower.revision" claim on `floorReachable` so no future caller puts it on a hot path. |
| T4 | already-fixed | Dead sig bit (TowerEngine.ts:791-792) gates on `u.state !== 'construction' && u.state !== 'fire'` before `!parkingOK.has(u.id)`. Mid-build/burning parking never flagged dead. | Close. |
| T5 | already-fixed | `isDead` (TowerEngine.ts:794) derives from the same gated bit; red-X drawn in `addRoom` via `deadParking` (874). Non-operational parking cannot render the X. Same fix as T4. | Close (dup of T4). |
| T6 | already-fixed | `stats()` no longer exposes `hotelsCount`. Replaced by `hotelsCountTowardRating()` (Simulation.ts:891), consumed at main.ts:860, covered by legibility.test.ts:93-106. | Close. |
| T7 | fix-now | Duplicate of T2 (codex vs copilot on same nudge severity). | Resolve with T2's single edit (bad→info); close by reference. |
| T8 | already-fixed | Inspector parking verdict (main.ts:866-870) gated on `u.state !== 'construction' && u.state !== 'fire'`; comment (864-865) documents "Status covers that". Offline parking shows no false ramp-chain-dead line. | Close. |

## Facilitator convergence

- **Already fixed (close):** T1, T4, T5, T6, T8 — verified in worktree HEAD.
- **Fix now (commit / small edit):** T2 + T7 (commit bad→info), T3 (commit dedupe + correct
  the stale `floorReachable` "cached" docstring). The dissenting "already-fixed" votes on
  T2/T3/T7 were reading the dirty worktree; the edits are real but uncommitted, and T3 has
  a genuine still-open doc defect.
