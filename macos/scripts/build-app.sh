#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESTINATION="${1:-$PROJECT_DIR/dist}"
APP_PATH="$DESTINATION/Karate Match Timer.app"
cd "$PROJECT_DIR"
swift build -c release --arch arm64 --scratch-path .build-arm64
swift build -c release --arch x86_64 --scratch-path .build-x86_64
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"
ARM_BIN="$(swift build -c release --arch arm64 --scratch-path .build-arm64 --show-bin-path)"
INTEL_BIN="$(swift build -c release --arch x86_64 --scratch-path .build-x86_64 --show-bin-path)"
lipo -create "$ARM_BIN/KarateTimer" "$INTEL_BIN/KarateTimer" -output "$APP_PATH/Contents/MacOS/KarateTimer"
python3 scripts/make-bell.py "$APP_PATH/Contents/Resources/finish-bell.wav"
mkdir -p .build
ICON_ARCH="$(uname -m)"
swiftc -target "$ICON_ARCH-apple-macosx13.0" scripts/make-icon.swift -o .build/make-icon
.build/make-icon .build/TimerIcon.iconset
iconutil -c icns .build/TimerIcon.iconset -o "$APP_PATH/Contents/Resources/TimerIcon.icns"
cat > "$APP_PATH/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>KarateTimer</string>
<key>CFBundleIdentifier</key><string>nz.karate.matchtimer</string>
<key>CFBundleName</key><string>Karate Match Timer</string>
<key>CFBundleDisplayName</key><string>Karate Match Timer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>TimerIcon</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleLocalizations</key><array><string>en</string></array>
<key>NSHumanReadableCopyright</key><string>Local competition timer, 2026.</string>
</dict></plist>
PLIST
printf 'APPL????' > "$APP_PATH/Contents/PkgInfo"
codesign --force --sign - "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
plutil -lint "$APP_PATH/Contents/Info.plist"
printf '\nBuilt: %s\n' "$APP_PATH"
