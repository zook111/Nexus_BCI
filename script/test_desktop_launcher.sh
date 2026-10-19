#!/bin/bash

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER="$SCRIPT_DIR/build_and_run.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mindmeld-launcher-safety.XXXXXX")"
STATE_DIR="$TEST_ROOT/state"
UNRELATED_PID=""
LOCK_HOLDER_PID=""

cleanup() {
  if [ -n "$UNRELATED_PID" ] && kill -0 "$UNRELATED_PID" 2>/dev/null; then
    kill "$UNRELATED_PID" 2>/dev/null || true
    wait "$UNRELATED_PID" 2>/dev/null || true
  fi
  if [ -n "$LOCK_HOLDER_PID" ] && kill -0 "$LOCK_HOLDER_PID" 2>/dev/null; then
    kill "$LOCK_HOLDER_PID" 2>/dev/null || true
    wait "$LOCK_HOLDER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$STATE_DIR"

sleep 30 &
UNRELATED_PID="$!"
printf '%s\n%s\n%s\n%s\n' \
  "$UNRELATED_PID" "stale process start identity" backend \
  "backend|$(cd "$SCRIPT_DIR/.." && pwd)|8000|5173" \
  > "$STATE_DIR/backend.pid"

MINDMELD_LAUNCHER_STATE_DIR="$STATE_DIR" "$LAUNCHER" --stop >/dev/null
if ! kill -0 "$UNRELATED_PID" 2>/dev/null; then
  echo "FAIL: a PID-reused unrelated process was terminated." >&2
  exit 1
fi

: > "$STATE_DIR/toggle.lock"
MINDMELD_LAUNCHER_STATE_DIR="$STATE_DIR" "$LAUNCHER" --stop >/dev/null

/usr/bin/lockf -s -t 0 "$STATE_DIR/toggle.lock" /bin/bash -c \
  "touch '$TEST_ROOT/lock-ready'; sleep 30" &
LOCK_HOLDER_PID="$!"
count=0
while [ ! -e "$TEST_ROOT/lock-ready" ] && [ "$count" -lt 50 ]; do
  count=$((count + 1))
  sleep 0.05
done
if [ ! -e "$TEST_ROOT/lock-ready" ]; then
  echo "FAIL: test lock holder did not become ready." >&2
  exit 1
fi
if MINDMELD_LAUNCHER_STATE_DIR="$STATE_DIR" "$LAUNCHER" --stop >/dev/null 2>&1; then
  echo "FAIL: a live kernel lock was not preserved." >&2
  exit 1
fi
kill "$LOCK_HOLDER_PID"
wait "$LOCK_HOLDER_PID" 2>/dev/null || true
LOCK_HOLDER_PID=""
MINDMELD_LAUNCHER_STATE_DIR="$STATE_DIR" "$LAUNCHER" --stop >/dev/null

# A copied fixture exercises the updater/startup contract without launching services.
FIXTURE="$TEST_ROOT/student project"
mkdir -p "$FIXTURE/script"
cp "$LAUNCHER" "$FIXTURE/script/build_and_run.sh"
cat > "$FIXTURE/script/student_updates.py" <<'PYFAKE'
import os
from pathlib import Path
Path(os.environ['UPDATE_TEST_MARK']).write_text('called')
raise SystemExit(int(os.environ['UPDATE_TEST_RESULT']))
PYFAKE
TEST_PYTHON="${NEXUS_PYTHON:-$SCRIPT_DIR/../.venv/bin/python}"
if [ ! -x "$TEST_PYTHON" ]; then TEST_PYTHON="$(command -v python3)"; fi
for update_result in 20 1 0; do
  rm -f "$TEST_ROOT/worker-called"
  result=0
  UPDATE_TEST_MARK="$TEST_ROOT/worker-called" UPDATE_TEST_RESULT="$update_result" \
    NEXUS_PYTHON="$TEST_PYTHON" MINDMELD_OPEN_BROWSER=0 \
    MINDMELD_LAUNCHER_STATE_DIR="$TEST_ROOT/fixture-state" \
    "$FIXTURE/script/build_and_run.sh" --start > "$TEST_ROOT/fixture-output" 2>&1 || result=$?
  [ -e "$TEST_ROOT/worker-called" ]
  if [ "$update_result" = 20 ]; then
    [ "$result" = 0 ]
    ! grep -q "environment is missing" "$TEST_ROOT/fixture-output"
  elif [ "$update_result" = 1 ]; then
    [ "$result" != 0 ]
    ! grep -q "environment is missing" "$TEST_ROOT/fixture-output"
  else
    [ "$result" != 0 ]
    grep -q "environment is missing" "$TEST_ROOT/fixture-output"
  fi
done

echo "Desktop launcher PID, kernel-lock and updater startup tests passed."
