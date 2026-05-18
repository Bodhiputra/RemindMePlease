#!/bin/bash
# Build RemindMePlease Swift and produce a runnable .app bundle
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build/release"
APP_NAME="RemindMePlease"
APP_BUNDLE="$SCRIPT_DIR/$APP_NAME.app"

echo "▸ Building Swift package..."
cd "$SCRIPT_DIR"
swift build -c release

echo "▸ Creating app bundle..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Binary
cp "$BUILD_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

# Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>          <string>RemindMePlease</string>
  <key>CFBundleIdentifier</key>    <string>com.remindmeplease.app</string>
  <key>CFBundleVersion</key>       <string>1.0</string>
  <key>CFBundleExecutable</key>    <string>RemindMePlease</string>
  <key>CFBundlePackageType</key>   <string>APPL</string>
  <key>LSUIElement</key>           <true/>
  <key>NSPrincipalClass</key>      <string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
PLIST

# Ad-hoc code sign (required on macOS to run without Gatekeeper prompt)
echo "▸ Signing..."
codesign --force --deep -s - "$APP_BUNDLE"

echo ""
echo "✓ Built: $APP_BUNDLE"
echo ""
echo "Run with:  open '$APP_BUNDLE'"
echo "Or:        '$APP_BUNDLE/Contents/MacOS/$APP_NAME'"
