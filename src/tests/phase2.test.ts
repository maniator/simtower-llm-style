import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";

/**
 * Phase 2 (BMAD review F4 + spatial model) tests. Behavior changes land behind
 * `simModel: "v1" | "v2"`; v1 is the shipped, suite-pinned model and v2 is built
 * up step by step. Step 1 here: the real hourly clock.
 */

describe("F4 / Step 1 — v2 integrates per hour; v1 keeps the sampled behavior", () => {
  it("v1 fires onHour at most once for a multi-hour tick (the documented sampling)", () => {
    const sim = Simulation.newGame(1); // starts Mon 07:00, simModel defaults to v1
    sim.tick(60 * 5); // 07:00 -> 12:00
    expect(sim.hourTicks).toBe(1); // sampled: one onHour despite 5 hours elapsing
    expect(sim.clock.day).toBe(0);
  });

  it("v2 fires onHour once per elapsed hour and onDay per elapsed day", () => {
    const sim = Simulation.newGame(1);
    sim.simModel = "v2";
    sim.tick(60); // warm-up so lastHour settles on the current hour boundary
    const base = sim.hourTicks;
    const day0 = sim.clock.day;

    sim.tick(60 * 5); // 5 more hours
    expect(sim.hourTicks - base).toBe(5);

    sim.tick(60 * 24); // a full further day
    expect(sim.hourTicks - base).toBe(5 + 24);
    expect(sim.clock.day).toBe(day0 + 1);
  });

  it("v2 advances the same total game time as v1 (sub-stepping is exact)", () => {
    const a = Simulation.newGame(2);
    const b = Simulation.newGame(2);
    b.simModel = "v2";
    a.tick(247); // arbitrary, not hour-aligned
    b.tick(247);
    expect(b.clock.minutes).toBe(a.clock.minutes);
  });
});
