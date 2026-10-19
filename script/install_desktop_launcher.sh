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

# Escape the AppleScript string as well as quoting the shell argument at runtime.
APPLE_LAUNCHER_PATH="${LAUNCHER_SCRIPT//\\/\\\\}"
APPLE_LAUNCHER_PATH="${APPLE_LAUNCHER_PATH//\"/\\\"}"

# The window shows the launcher's --app-status and never stops services on launch.
# macOS keeps one applet instance, so opening it again brings this window forward.
cat > "$APPLESCRIPT_SOURCE" <<EOF
on run
  set launcherPath to "$APPLE_LAUNCHER_PATH"
  set installedAppPath to POSIX path of (path to me)
  set launcherCommand to "/bin/bash " & quoted form of launcherPath
  repeat
    set appStatus to my readStatus(launcherCommand)
    if appStatus is missing value then return
    set serverState to item 1 of appStatus
    set statusMessage to item 4 of appStatus
    if serverState is "running" then
      set choice to my askStatus(statusMessage, {"Stop server", "Close", "Open app"}, "Open app")
    else if serverState is "stopped" then
      set choice to my askStatus(statusMessage, {"Close", "Start server"}, "Start server")
    else if serverState is "partial" then
      set choice to my askStatus(statusMessage, {"Stop server", "Close"}, "Close")
    else
      set choice to my askStatus(statusMessage, {"Close", "Check again"}, "Check again")
    end if
    if choice is "Open app" then
      my runAction(launcherCommand & " --open", "Nexus could not open the app.")
      return
    else if choice is "Start server" then
      my notify("Starting Nexus EEG Lab. The app opens when it is ready.")
      my runAction("/usr/bin/env NEXUS_CHECK_UPDATES=1 MINDMELD_DESKTOP_APP=" & quoted form of installedAppPath & " " & launcherCommand & " --start", "Nexus could not start.")
      return
    else if choice is "Stop server" then
      my stopServer(launcherCommand)
    else if choice is not "Check again" then
      return
    end if
  end repeat
end run

on readStatus(launcherCommand)
  try
    set statusLines to paragraphs of (do shell script launcherCommand & " --app-status")
    set AppleScript's text item delimiters to linefeed
    set statusMessage to (items 4 thru -1 of statusLines) as text
    set AppleScript's text item delimiters to ""
    return {item 1 of statusLines, item 2 of statusLines, item 3 of statusLines, statusMessage}
  on error errorText
    set AppleScript's text item delimiters to ""
    my showError("Nexus Server could not check the app status.", errorText)
    return missing value
  end try
end readStatus

on stopServer(launcherCommand)
  -- Check again now: a board session or recording may have started while the window was open.
  set appStatus to my readStatus(launcherCommand)
  if appStatus is missing value then return
  if item 1 of appStatus is not in {"running", "partial"} then return
  if item 2 of appStatus is not in {"none", "idle"} then
    if not (my confirmStop(item 3 of appStatus)) then return
  end if
  my runAction(launcherCommand & " --stop", "Nexus could not stop.")
end stopServer

on runAction(commandText, failureText)
  try
    set resultText to do shell script commandText
  on error errorText
    my showError(failureText, errorText)
    return
  end try
  my notify(resultText)
end runAction

-- Native UI only. The launcher tests replace these four handlers in a child script.
on askStatus(statusMessage, buttonNames, defaultName)
  try
    return button returned of (display dialog statusMessage with title "Nexus Server" buttons buttonNames default button defaultName cancel button "Close" with icon note)
  on error number -128
    return "Close"
  end try
end askStatus

on confirmStop(sessionSummary)
  try
    display dialog sessionSummary & return & return & "Stopping the server ends any board session or recording that has not been saved." with title "Nexus Server" buttons {"Stop anyway", "Cancel"} default button "Cancel" cancel button "Cancel" with icon caution
    return true
  on error number -128
    return false
  end try
end confirmStop

on showError(failureText, errorText)
  display dialog failureText & return & return & errorText with title "Nexus Server" buttons {"OK"} default button "OK" with icon stop
end showError

on notify(messageText)
  display notification messageText with title "Nexus Server"
end notify
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
