#!/bin/sh
# Renders build/icon/icon.html to build/icon.icns (macOS: sips + iconutil).
set -e
cd "$(dirname "$0")/.."
ELECTRON=$(node -p "require('electron')")
"$ELECTRON" build/icon/render.cjs
SET=build/icon/Codesigner.iconset
rm -rf "$SET" && mkdir -p "$SET"
for size in 16 32 128 256 512; do
	sips -z $size $size build/icon/icon.png --out "$SET/icon_${size}x${size}.png" >/dev/null
	sips -z $((size * 2)) $((size * 2)) build/icon/icon.png --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o build/icon.icns
rm -rf "$SET"
echo build/icon.icns
