#!/bin/bash

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCHER_SCRIPT="$ROOT_DIR/script/build_and_run.sh"
ICON_SOURCE="$ROOT_DIR/assets/macos/eeg-lab-icon.png"
DESKTOP_DIR="${MINDMELD_DESKTOP_DIR:-$HOME/Desktop}"
TRASH_DIR="${MINDMELD_TRASH_DIR:-$HOME/.Trash}"
APP_PATH="${MINDMELD_DESKTOP_APP:-$DESKTOP_DIR/Nexus Server.app}"
LEGACY_APP="$DESKTOP_DIR/Mindmeld Server.app"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mindmeld-launcher.XXXXXX")"
TEMP_APP="$TEMP_DIR/Nexus Server.app"
APPLESCRIPT_SOURCE="$TEMP_DIR/launcher.applescript"
ICONSET="$TEMP_DIR/Nexus.iconset"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

if [ ! -x "$LAUNCHER_SCRIPT" ]; then
  echo "Launcher script is missing or not executable: $LAUNCHER_SCRIPT" >&2
  exit 1
fi
if [ ! -f "$ICON_SOURCE" ]; then
  echo "Launcher icon is missing: $ICON_SOURCE" >&2
  exit 1
fi

mkdir -p "$(dirname "$APP_PATH")" "$ICONSET"

cat > "$APPLESCRIPT_SOURCE" <<EOF
on run
  set launcherPath to "$LAUNCHER_SCRIPT"
  try
    set resultText to do shell script "/bin/bash " & quoted form of launcherPath & " --toggle"
    display notification resultText with title "Nexus Server"
  on error errorText number errorNumber
    display dialog "Nexus could not start or stop." & return & return & errorText with title "Nexus Server" buttons {"OK"} default button "OK" with icon stop
  end try
end run
EOF

/usr/bin/osacompile -o "$TEMP_APP" "$APPLESCRIPT_SOURCE"

make_icon() {
  local size="$1"
  local output="$2"
  /usr/bin/sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/$output" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
make_icon 1024 icon_512x512@2x.png
/usr/bin/iconutil -c icns "$ICONSET" -o "$TEMP_DIR/Nexus.icns"
cp "$TEMP_DIR/Nexus.icns" "$TEMP_APP/Contents/Resources/applet.icns"
/usr/bin/codesign --force --deep --sign - "$TEMP_APP" >/dev/null

archive_launcher() {
  local previous_app="$1"
  local backup_dir
  mkdir -p "$TRASH_DIR"
  backup_dir="$(mktemp -d "$TRASH_DIR/Nexus launcher backup.XXXXXX")"
  mv "$previous_app" "$backup_dir/"
  echo "Previous launcher moved to $backup_dir/$(basename "$previous_app")"
}

# Retire only this checkout's legacy default launcher after the replacement is built.
# A custom destination or another checkout's launcher is deliberately left alone.
if [ -z "${MINDMELD_DESKTOP_APP:-}" ] && [ -e "$LEGACY_APP" ]; then
  LEGACY_SOURCE="$(/usr/bin/osadecompile "$LEGACY_APP/Contents/Resources/Scripts/main.scpt" 2>/dev/null || true)"
  if [[ "$LEGACY_SOURCE" == *"set launcherPath to \"$LAUNCHER_SCRIPT\""* ]]; then
    archive_launcher "$LEGACY_APP"
  else
    echo "Legacy launcher belongs to another checkout or could not be identified: $LEGACY_APP"
  fi
fi

if [ -e "$APP_PATH" ]; then
  archive_launcher "$APP_PATH"
fi

mv "$TEMP_APP" "$APP_PATH"
/usr/bin/touch "$APP_PATH"

if [ "${MINDMELD_REVEAL_LAUNCHER:-1}" = "1" ]; then
  /usr/bin/open -R "$APP_PATH" >/dev/null 2>&1 || true
fi

echo "Installed Nexus Server at $APP_PATH"
