#!/bin/bash

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER="$SCRIPT_DIR/build_and_run.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mindmeld-launcher-safety.XXXXXX")"
STATE_DIR="$TEST_ROOT/state"
UNRELATED_PID=""
LOCK_HOLDER_PID=""
STUB_PID=""
FAKE_PIDS=""
TEST_PYTHON="${NEXUS_PYTHON:-$SCRIPT_DIR/../.venv/bin/python}"
if [ ! -x "$TEST_PYTHON" ]; then TEST_PYTHON="$(command -v python3)"; fi

stop_test_process() {
  if [ -n "$1" ] && kill -0 "$1" 2>/dev/null; then
    kill "$1" 2>/dev/null || true
    wait "$1" 2>/dev/null || true
  fi
}

cleanup() {
  local pid
  stop_test_process "$UNRELATED_PID"
  stop_test_process "$LOCK_HOLDER_PID"
  stop_test_process "$STUB_PID"
  for pid in $FAKE_PIDS; do stop_test_process "$pid"; done
  rm -rf "$TEST_ROOT"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
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

# Desktop status window contract. Isolated state and free high ports keep any real
# Nexus session on 8000/5173 untouched; fake services are sleep processes this test owns.
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATUS_STATE="$TEST_ROOT/status state"
API_STATE="$TEST_ROOT/api.json"
mkdir -p "$STATUS_STATE"

free_port() {
  local port="$1"
  while [ -n "$(/usr/sbin/lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)" ]; do
    port=$((port + 1))
  done
  echo "$port"
}
API_PORT="$(free_port 18731)"
UI_PORT="$(free_port $((API_PORT + 1)))"
BACKEND_PID_FILE="$STATUS_STATE/backend.pid"
FRONTEND_PID_FILE="$STATUS_STATE/frontend.pid"

launcher() {
  MINDMELD_LAUNCHER_STATE_DIR="$STATUS_STATE" MINDMELD_BACKEND_PORT="$API_PORT" \
    MINDMELD_FRONTEND_PORT="$UI_PORT" MINDMELD_OPEN_BROWSER=0 "$LAUNCHER" "$@"
}

expect_status() {
  local output
  output="$(launcher --app-status)"
  [ "$(printf '%s\n' "$output" | sed -n 1p)" = "$1" ] || fail "expected state $1, got: $output"
  [ "$(printf '%s\n' "$output" | sed -n 2p)" = "$2" ] || fail "expected session $2, got: $output"
  if [ -n "${3:-}" ]; then
    [[ "$output" == *"$3"* ]] || fail "status did not mention '$3': $output"
  fi
}

start_fake_service() {
  local service="$1"
  local command_text="$2"
  local pid_file="$3"
  local pid
  local count=0
  ( exec -a "$command_text" /bin/sleep 120 ) &
  pid="$!"
  FAKE_PIDS="$FAKE_PIDS $pid"
  while [[ "$(ps -p "$pid" -o command= 2>/dev/null)" != "$command_text"* ]]; do
    count=$((count + 1))
    [ "$count" -lt 50 ] || fail "fake $service did not start"
    sleep 0.05
  done
  printf '%s\n%s\n%s\n%s\n' "$pid" \
    "$(ps -p "$pid" -o lstart= | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')" \
    "$service" "$service|$ROOT_DIR|$API_PORT|$UI_PORT" > "$pid_file"
  eval "FAKE_${service}_PID=$pid"
}
start_fake_backend() {
  start_fake_service backend \
    "python -m uvicorn mindmeld_api.main:app --app-dir $ROOT_DIR/backend/src --host 127.0.0.1 --port $API_PORT" \
    "$BACKEND_PID_FILE"
}
start_fake_frontend() {
  start_fake_service frontend \
    "node $ROOT_DIR/frontend/node_modules/vite/bin/vite.js --host 127.0.0.1 --port $UI_PORT --strictPort" \
    "$FRONTEND_PID_FILE"
}

# The stub stands in for the backend API. Missing paths return 404; strings are raw bodies.
api_state() {
  printf '%s\n' "$1" > "$API_STATE.tmp"
  mv "$API_STATE.tmp" "$API_STATE"
}
cat > "$TEST_ROOT/api_stub.py" <<'PYSTUB'
import http.server
import json
import sys

port, state = int(sys.argv[1]), sys.argv[2]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with open(state) as file:
            body = json.load(file).get(self.path)
        if body is None:
            self.send_error(404)
            return
        payload = (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


http.server.HTTPServer(("127.0.0.1", port), Handler).serve_forever()
PYSTUB
start_api_stub() {
  local count=0
  "$TEST_PYTHON" -I "$TEST_ROOT/api_stub.py" "$API_PORT" "$API_STATE" &
  STUB_PID="$!"
  until /usr/bin/curl --silent --max-time 1 "http://127.0.0.1:$API_PORT/" >/dev/null 2>&1; do
    count=$((count + 1))
    [ "$count" -lt 100 ] || fail "API stub did not start"
    sleep 0.05
  done
}
IDLE='{"/api/board": {"status": "idle", "connection_id": null}, "/api/recordings/current": {"active": false}}'

# The compiled Desktop app runs with its four native UI handlers replaced by a test
# double, so its real control flow is exercised without showing any dialog.
MINDMELD_DESKTOP_APP="$TEST_ROOT/Status Test.app" MINDMELD_TRASH_DIR="$TEST_ROOT/Trash" \
  MINDMELD_REVEAL_LAUNCHER=0 "$SCRIPT_DIR/install_desktop_launcher.sh" >/dev/null 2>&1
cat > "$TEST_ROOT/desktop-app-double.applescript" <<'EOF'
on run argv
  set desktopApp to load script POSIX file (item 1 of argv)
  if item 2 of argv is "--status" then
    set appStatus to desktopApp's readStatus("/bin/bash " & quoted form of (item 3 of argv))
    set AppleScript's text item delimiters to "|"
    set resultText to appStatus as text
  else
    set testApp to makeTestApp(desktopApp, items 2 thru -1 of argv)
    run testApp
    set AppleScript's text item delimiters to linefeed
    set resultText to (testApp's eventLog) as text
  end if
  set AppleScript's text item delimiters to ""
  return resultText
end run

on makeTestApp(desktopApp, scriptedAnswers)
  script DesktopAppDouble
    property parent : desktopApp
    property answers : scriptedAnswers
    property eventLog : {}
    on nextAnswer()
      set answer to item 1 of answers
      set answers to rest of answers
      return answer
    end nextAnswer
    on askStatus(statusMessage, buttonNames, defaultName)
      set AppleScript's text item delimiters to ","
      set end of eventLog to "window " & (paragraph 1 of statusMessage) & " [" & (buttonNames as text) & "] default " & defaultName
      set AppleScript's text item delimiters to ""
      return my nextAnswer()
    end askStatus
    on confirmStop(sessionSummary)
      set answer to my nextAnswer()
      set end of eventLog to "confirm " & sessionSummary & " -> " & answer
      return answer is "Stop anyway"
    end confirmStop
    on showError(failureText, errorText)
      set end of eventLog to "error " & failureText
    end showError
    on notify(messageText)
      set end of eventLog to "notify " & messageText
    end notify
  end script
  return DesktopAppDouble
end makeTestApp
EOF
desktop_app() {
  MINDMELD_LAUNCHER_STATE_DIR="$STATUS_STATE" MINDMELD_BACKEND_PORT="$API_PORT" \
    MINDMELD_FRONTEND_PORT="$UI_PORT" MINDMELD_OPEN_BROWSER=0 "$@"
}
applet_status() {
  desktop_app /usr/bin/osascript "$TEST_ROOT/desktop-app-double.applescript" \
    "$TEST_ROOT/Status Test.app/Contents/Resources/Scripts/main.scpt" --status "$LAUNCHER"
}
# Arguments are the scripted button answers; stdin is the expected event log.
expect_window() {
  local expected
  local actual
  expected="$(cat)"
  actual="$(desktop_app /usr/bin/osascript "$TEST_ROOT/desktop-app-double.applescript" \
    "$TEST_ROOT/Status Test.app/Contents/Resources/Scripts/main.scpt" "$@")" \
    || fail "Desktop app failed for answers: $*"
  [ "$actual" = "$expected" ] || fail "Desktop app events differed.
Expected:
$expected
Actual:
$actual"
}

# Stopped, and a port held by another program is reported without being touched.
expect_status stopped none "Nexus EEG Lab is stopped."
api_state "$IDLE"
start_api_stub
expect_status stopped none "Another program is using port $API_PORT (PID $STUB_PID)"
if launcher --open >/dev/null 2>&1; then fail "--open succeeded while stopped"; fi
# Start server reports a failed start. The update check is skipped here, and the busy
# port stops the launcher before any service could start.
NEXUS_UPDATE_WORKER=1 expect_window "Start server" <<EOF
window Nexus EEG Lab is stopped. [Close,Start server] default Start server
notify Starting Nexus EEG Lab. The app opens when it is ready.
error Nexus could not start.
EOF
[ -z "$(/usr/sbin/lsof -nP -tiTCP:"$UI_PORT" -sTCP:LISTEN 2>/dev/null)" ] || fail "a failed start left a frontend"
expect_status stopped none

# Running: the session line follows the backend's board and recording state.
start_fake_backend
start_fake_frontend
expect_status running idle "No board session or recording is active."
api_state '{"/api/board": {"status": "prepared"}, "/api/recordings/current": {"active": false}}'
expect_status running connected "Press Reset"
api_state '{"/api/board": {"status": "streaming"}, "/api/recordings/current": {"active": false}}'
expect_status running streaming "Press Stop and Reset"
api_state '{"/api/board": {"status": "streaming"}, "/api/recordings/current": {"active": true, "message": "\"active\":false"}}'
expect_status running recording "Finish and save it"
[ "$(applet_status)" = "running|recording|$(launcher --app-status | sed -n 3p)|Nexus EEG Lab is running at http://127.0.0.1:$UI_PORT.

A recording or experiment is in progress. Finish and save it in Nexus EEG Lab before stopping the server.

Closing the browser does not stop the server." ] || fail "Desktop app parsed status incorrectly: $(applet_status)"
# Stop server re-checks the session and asks first; Cancel keeps the recording running.
expect_window "Stop server" Cancel Close <<EOF
window Nexus EEG Lab is running at http://127.0.0.1:$UI_PORT. [Stop server,Close,Open app] default Open app
confirm A recording or experiment is in progress. Finish and save it in Nexus EEG Lab before stopping the server. -> Cancel
window Nexus EEG Lab is running at http://127.0.0.1:$UI_PORT. [Stop server,Close,Open app] default Open app
EOF
kill -0 "$FAKE_backend_PID" && kill -0 "$FAKE_frontend_PID" || fail "cancelled Stop server ended a recording"
api_state "$IDLE"
expect_window "Open app" <<EOF
window Nexus EEG Lab is running at http://127.0.0.1:$UI_PORT. [Stop server,Close,Open app] default Open app
notify Opening Nexus EEG Lab at http://127.0.0.1:$UI_PORT
EOF

api_state '{"/api/board": {"status": "idle"}, "/api/recordings/current": {"message": "missing active"}}'
expect_status running unknown "could not check"
api_state '{"/api/board": "not json", "/api/recordings/current": {"active": false}}'
expect_status running unknown
api_state '{"/api/board": {"status": "idle"}}'
expect_status running unknown

# Repeated launches: --start opens the running app, and --toggle (older shortcuts)
# leaves a live or unconfirmed session running.
api_state '{"/api/board": {"status": "streaming"}, "/api/recordings/current": {"active": true}}'
launcher --start | grep -q "already running" || fail "--start did not report the running app"
launcher --open | grep -q "Opening Nexus EEG Lab" || fail "--open did not open the running app"
if launcher --toggle > "$TEST_ROOT/toggle-output" 2>&1; then fail "--toggle stopped a recording"; fi
grep -q "recording or experiment is in progress" "$TEST_ROOT/toggle-output" || fail "toggle reason missing"
kill -0 "$FAKE_backend_PID" && kill -0 "$FAKE_frontend_PID" || fail "--toggle ended a live recording"
stop_test_process "$STUB_PID"
STUB_PID=""
expect_status running unknown
if launcher --toggle >/dev/null 2>&1; then fail "--toggle stopped an unconfirmed session"; fi
kill -0 "$FAKE_backend_PID" || fail "--toggle stopped with unknown backend status"

# A start, stop or update holding the kernel lock is reported as busy.
/usr/bin/lockf -s -t 0 "$STATUS_STATE/toggle.lock" /bin/bash -c \
  "touch '$TEST_ROOT/status-lock-ready'; sleep 30" &
LOCK_HOLDER_PID="$!"
count=0
until [ -e "$TEST_ROOT/status-lock-ready" ]; do
  count=$((count + 1))
  [ "$count" -lt 50 ] || fail "status lock holder did not start"
  sleep 0.05
done
expect_status busy unknown "Check again"
expect_window Close <<EOF
window Nexus Server is starting, stopping or installing an update. Wait for it to finish, then choose Check again. [Close,Check again] default Check again
EOF
stop_test_process "$LOCK_HOLDER_PID"
LOCK_HOLDER_PID=""

# Partly running: Open app is refused; explicit --stop stops even an active recording.
api_state '{"/api/board": {"status": "streaming"}, "/api/recordings/current": {"active": true}}'
start_api_stub
stop_test_process "$FAKE_frontend_PID"
expect_status partial recording "only partly running (backend running, frontend stopped)"
if launcher --open >/dev/null 2>&1; then fail "--open succeeded without the frontend"; fi
launcher --stop >/dev/null
wait "$FAKE_backend_PID" 2>/dev/null || true
if kill -0 "$FAKE_backend_PID" 2>/dev/null; then fail "--stop left the backend running"; fi
kill -0 "$STUB_PID" || fail "--stop terminated an unowned port listener"
expect_status stopped none

# Confirmed Stop server stops a streaming session, then shows the stopped window.
api_state '{"/api/board": {"status": "streaming"}, "/api/recordings/current": {"active": false}}'
start_fake_backend
start_fake_frontend
expect_window "Stop server" "Stop anyway" Close <<EOF
window Nexus EEG Lab is running at http://127.0.0.1:$UI_PORT. [Stop server,Close,Open app] default Open app
confirm The board is streaming. Press Stop and Reset in Nexus EEG Lab before stopping the server. -> Stop anyway
notify Nexus stopped.
window Nexus EEG Lab is stopped. [Close,Start server] default Start server
EOF
wait "$FAKE_backend_PID" "$FAKE_frontend_PID" 2>/dev/null || true
if kill -0 "$FAKE_backend_PID" 2>/dev/null || kill -0 "$FAKE_frontend_PID" 2>/dev/null; then
  fail "confirmed Stop server left services running"
fi

# --toggle still stops an idle running app for older shortcuts.
api_state "$IDLE"
start_fake_backend
start_fake_frontend
launcher --toggle | grep -q "Nexus stopped." || fail "--toggle did not stop an idle app"
wait "$FAKE_backend_PID" "$FAKE_frontend_PID" 2>/dev/null || true
if kill -0 "$FAKE_backend_PID" 2>/dev/null || kill -0 "$FAKE_frontend_PID" 2>/dev/null; then
  fail "--toggle left idle services running"
fi
stop_test_process "$STUB_PID"
STUB_PID=""
expect_status stopped none
[ "$(applet_status)" = "stopped|none||Nexus EEG Lab is stopped.

Start server checks for an offered update, starts the local services and opens the app." ] \
  || fail "Desktop app parsed stopped status incorrectly: $(applet_status)"

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

echo "Desktop launcher PID, kernel-lock, status-window and updater startup tests passed."
