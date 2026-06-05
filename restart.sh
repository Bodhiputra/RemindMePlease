#!/bin/bash
# Restart the Swift native app only (not Electron).
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SWIFT_DIR="$ROOT/RemindMePlease-Swift"
APP="$SWIFT_DIR/RemindMePlease.app"

echo "Stopping old instances…"
pkill -f "electron.*remindmeplease" 2>/dev/null || true
pkill -f "Electron /Users/fantech/remindmeplease" 2>/dev/null || true
pkill -x "RemindMePlease" 2>/dev/null || true
sleep 0.5

echo "Building Swift app…"
"$SWIFT_DIR/build.sh"

echo "Launching…"
open "$APP"
echo ""
echo "Dock: drag $APP to the Dock, or open once and right-click its icon → Options → Keep in Dock"
echo "      Remove ~/Desktop/RemindMePlease.app if that old applet is still in the Dock."
