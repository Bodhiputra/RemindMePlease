#!/bin/bash
# Dev mode: live renderer/ + auto-rebuild on Swift changes.
# Usage: ./dev.sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SWIFT_DIR="$ROOT/RemindMePlease-Swift"
APP="$SWIFT_DIR/RemindMePlease.app"
EXE="$APP/Contents/MacOS/RemindMePlease"

export RMP_DEV=1
export RMP_RENDERER_DIR="$ROOT/renderer"

echo "Stopping old instances…"
pkill -f "electron.*remindmeplease" 2>/dev/null || true
pkill -f "Electron /Users/fantech/remindmeplease" 2>/dev/null || true
pkill -x "RemindMePlease" 2>/dev/null || true
sleep 0.3

if [ ! -f "$EXE" ]; then
  echo "First build…"
  "$SWIFT_DIR/build.sh"
fi

echo "Launching dev app (renderer → $RMP_RENDERER_DIR)…"
"$EXE" &
APP_PID=$!

if [ -f "$ROOT/node_modules/chokidar/package.json" ]; then
  echo ""
  node "$ROOT/dev-watch.js"
else
  echo ""
  echo "Renderer hot-reload is active — edit renderer/ and the UI reloads automatically."
  echo "For Swift auto-rebuild: npm install && ./dev.sh"
  echo ""
  wait "$APP_PID"
fi
