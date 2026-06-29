/**
 * Starts `vite preview`, waits for it to come up, runs the screenshot capture,
 * then shuts the server down. Used by `npm run screenshots`.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

const server = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
  stdio: "inherit",
});

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

let code = 1;
try {
  if (!(await waitForServer())) throw new Error("preview server did not start");
  await new Promise((resolve, reject) => {
    const shot = spawn("node", ["scripts/screenshots.mjs"], {
      stdio: "inherit",
      env: { ...process.env, BASE_URL: BASE },
    });
    shot.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("screenshots failed: " + c))));
  });
  code = 0;
} catch (e) {
  console.error(e.message);
} finally {
  server.kill("SIGTERM");
}
process.exit(code);
