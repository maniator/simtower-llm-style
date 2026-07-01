import { test, expect } from "@playwright/test";

/**
 * Tier-2 end-to-end smoke: prove the TOWER win actually SURFACES to a real
 * player in the browser — the congratulations modal — which the headless
 * playthrough cannot check (it has no DOM). It reproduces a minimal winning
 * state through the app's public sim API and runs the REAL win logic
 * (`sim.checkVip`), then asserts the game's own update loop opens the modal.
 *
 * The canonical, richly-asserted build lives in the Tier-1 fixture
 * `src/tests/fixtures/winningTower.ts`; Playwright can't import it into the page
 * at runtime, so the essential steps are inlined here (kept intentionally thin).
 */
test("winning the TOWER shows the congratulations modal", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game));

  const star = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).game;
    const s = g.sim;
    const t = s.tower;
    const W = g.grid.width;

    g.speed = 0; // stop time so the crowd sim can't churn the setup out from under us
    s.money = 1e9;

    // Full-width ground lobby so basements can hang off it for the full-lot
    // Metro. newGame() seeds a 40-tile lobby at centre and ground floors must
    // connect to existing structure, so extend OUTWARD from centre (a left-to-
    // right build from x=0 would strand the disconnected left half).
    const c = Math.floor(W / 2);
    for (let x = c; x < W; x++) t.place("lobby", 1, x);
    for (let x = c - 1; x >= 0; x--) t.place("lobby", 1, x);
    for (let f = 2; f <= 100; f++) for (let x = 4; x < W - 4; x++) t.place("floor", f, x);
    for (let f = 0; f >= -9; f--) for (let x = 0; x < W; x++) t.place("floor", f, x);

    // Overlapping standard elevators chain service the whole height.
    ([[0, 1], [1, 30], [30, 60], [60, 90], [90, 100]] as [number, number][]).forEach(([b, tp], i) =>
      t.placeTransport("elevatorStandard", 4 + i * 3, b, tp),
    );

    // Every rating gate.
    t.place("metro", -9, 0); // full-lot deep-basement station
    t.place("security", 2, 24);
    t.place("medical", 2, 44);
    t.place("recycling", -1, 64);
    t.place("hotelSuite", 2, 84);
    t.place("hotelSuite", 2, 100);

    // Offices for population margin (>15k), leaving floor 100 for the hall.
    for (let f = 3; f <= 85; f++) for (let x = 34; x + 9 <= W - 4; x += 9) t.place("office", f, x);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of t.units as any[]) {
      if (u.kind === "office" || u.kind === "condo") {
        u.state = "occupied";
        u.everOccupied = true;
        u.satisfaction = 1;
      } else if (u.kind === "hotelSuite") {
        u.state = "asleep";
        u.everOccupied = true;
        u.satisfaction = 1;
      }
    }
    s.vipFavorable = true;

    s.evaluateStar(); // → 5★
    s.build("weddingHall", 100, Math.floor(W / 2)); // schedules the VIP inspection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wh = (t.units as any[]).find((u) => u.kind === "weddingHall");
    if (wh && wh.state === "construction") wh.state = "empty"; // done building
    s.clock.advance(4 * 24 * 60);
    s.checkVip(); // real win logic → star 6, evaluatedTower = true

    return s.star;
  });

  expect(star).toBe(6); // the real win logic reached TOWER

  // The game's own update loop must now surface it to the player.
  const modal = page.locator("#modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("TOWER achieved");
});
