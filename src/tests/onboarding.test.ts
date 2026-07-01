import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import {
  ONBOARD_STEPS,
  firstIncompleteStep,
  shouldArm,
  isOnboarded,
  markOnboarded,
  clearOnboarded,
} from "../ui/Onboarding";

const C = Math.floor(GRID.width / 2);

describe("Onboarding — flag persistence", () => {
  beforeEach(() => clearOnboarded());
  it("round-trips the once-only flag", () => {
    expect(isOnboarded()).toBe(false);
    markOnboarded();
    expect(isOnboarded()).toBe(true);
    clearOnboarded();
    expect(isOnboarded()).toBe(false);
  });
});

describe("Onboarding — arm gating", () => {
  beforeEach(() => clearOnboarded());
  it("arms only when the player starts a New Tower and hasn't onboarded", () => {
    expect(shouldArm(true)).toBe(true); // New Tower, first time
    expect(shouldArm(false)).toBe(false); // Continue never arms
    markOnboarded();
    expect(shouldArm(true)).toBe(false); // returning player, even on New Tower
  });
});

describe("Onboarding — steps advance on real progress", () => {
  it("firstIncompleteStep walks floor → office → connect → occupied", () => {
    const sim = Simulation.newGame(1); // seeds a ground lobby on floor 1
    sim.money = 1e9;
    expect(firstIncompleteStep(sim)).toBe(0); // nothing built above the lobby yet

    // Step 1: a floor above the lobby.
    for (let x = C - 10; x < C + 10; x++) sim.tower.place("floor", 2, x);
    expect(firstIncompleteStep(sim)).toBe(1);

    // Step 2: an office on it.
    const r = sim.tower.place("office", 2, C - 4);
    expect(r.ok).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(2);

    // Step 3: connect the floor to the ground lobby.
    expect(sim.tower.placeTransport("elevatorStandard", C + 6, 1, 2).ok).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(3);

    // Step 4: a tenant actually moves in.
    let guard = 0;
    while (!ONBOARD_STEPS[3].done(sim) && guard++ < 400) sim.tick(60);
    expect(ONBOARD_STEPS[3].done(sim)).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(ONBOARD_STEPS.length); // all done
  });

  it("each step has distinct desktop and mobile hint copy and a pulse target", () => {
    for (const s of ONBOARD_STEPS) {
      expect(s.hintDesktop.length).toBeGreaterThan(0);
      expect(s.hintMobile.length).toBeGreaterThan(0);
      expect(s.hintDesktop).not.toBe(s.hintMobile); // device-specific gestures
      expect(s.pulse).toMatch(/pal-item|#speed/);
    }
  });
});
