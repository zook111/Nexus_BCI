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

echo "Desktop launcher PID and kernel-lock safety tests passed."
