#!/usr/bin/env bash
#
# Capture the game screenshots using the official Playwright Docker image.
#
# Use this when the host's Chromium can't run (e.g. a sandbox missing system
# libraries like libnspr4, and no sudo to `apt install` them). The container
# ships a working Chromium plus every dependency, so it "just works".
#
#   bash scripts/shoot-docker.sh      # or: npm run screenshots:docker
#
# Build + a self-contained vite preview + the capture all run INSIDE the
# container, so it needs no host networking (handy under WSL2/Docker Desktop).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${PW_IMAGE:-mcr.microsoft.com/playwright:v1.61.0-jammy}"

# node_modules may live in the main checkout when ROOT is a git worktree, so
# mount the main working tree (which contains both node_modules and ROOT) at an
# identical path and run with ROOT as the working directory.
MAINROOT="$(cd "$(dirname "$(git -C "$ROOT" rev-parse --git-common-dir)")" && pwd)"

echo "Building app…"
npm --prefix "$ROOT" run build >/dev/null

echo "Capturing screenshots in $IMAGE …"
docker run --rm --ipc=host \
  -v "$MAINROOT:$MAINROOT" -w "$ROOT" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  "$IMAGE" bash -lc '
    export PW_CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux64/chrome | head -1)"
    npx vite preview --port 4173 --host 127.0.0.1 >/tmp/preview.log 2>&1 &
    for i in $(seq 1 50); do curl -sf http://127.0.0.1:4173/ >/dev/null && break; sleep 0.4; done
    BASE_URL=http://127.0.0.1:4173 node scripts/screenshots.mjs
  '
echo "Done — see docs/screenshots/"
