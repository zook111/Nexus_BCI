#!/bin/bash
# Native packaging/migration checks. All apps and backups stay in an isolated directory.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nexus-installer-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT INT TERM
export MINDMELD_DESKTOP_DIR="$TEST_ROOT/Desktop"
export MINDMELD_TRASH_DIR="$TEST_ROOT/Trash"
export MINDMELD_REVEAL_LAUNCHER=0
unset MINDMELD_DESKTOP_APP
mkdir -p "$MINDMELD_DESKTOP_DIR"
LEGACY_APP="$MINDMELD_DESKTOP_DIR/Mindmeld Server.app"
NEXUS_APP="$MINDMELD_DESKTOP_DIR/Nexus Server.app"

make_legacy() {
  local script_path="$1"
  cat > "$TEST_ROOT/legacy.applescript" <<EOF
on run
  set launcherPath to "$script_path"
end run
EOF
  /usr/bin/osacompile -o "$LEGACY_APP" "$TEST_ROOT/legacy.applescript"
}

make_legacy "$SCRIPT_DIR/build_and_run.sh"
"$SCRIPT_DIR/install_desktop_launcher.sh" >/dev/null
[ -d "$NEXUS_APP" ]
[ ! -e "$LEGACY_APP" ]
[ "$(find "$MINDMELD_TRASH_DIR" -name 'Mindmeld Server.app' -type d | wc -l | tr -d ' ')" = 1 ]
/usr/bin/codesign --verify --deep --strict "$NEXUS_APP"

# A reinstall makes a unique recoverable backup of the existing Nexus app.
"$SCRIPT_DIR/install_desktop_launcher.sh" >/dev/null
[ "$(find "$MINDMELD_TRASH_DIR" -name 'Nexus Server.app' -type d | wc -l | tr -d ' ')" = 1 ]

# A similarly named launcher for another checkout is not removed.
make_legacy "$TEST_ROOT/another-checkout/script/build_and_run.sh"
"$SCRIPT_DIR/install_desktop_launcher.sh" >/dev/null
[ -d "$LEGACY_APP" ]
[ "$(find "$MINDMELD_TRASH_DIR" -name 'Nexus Server.app' -type d | wc -l | tr -d ' ')" = 2 ]

# Explicit custom installs do not migrate the default Desktop launcher.
rm -rf "$LEGACY_APP"
make_legacy "$SCRIPT_DIR/build_and_run.sh"
MINDMELD_DESKTOP_APP="$TEST_ROOT/Custom Nexus.app" "$SCRIPT_DIR/install_desktop_launcher.sh" >/dev/null
[ -d "$LEGACY_APP" ]
[ -d "$TEST_ROOT/Custom Nexus.app" ]

echo "Nexus launcher migration, reinstall and custom-destination tests passed."
