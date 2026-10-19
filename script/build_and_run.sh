#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="${MINDMELD_LAUNCHER_STATE_DIR:-$HOME/Library/Application Support/Mindmeld Launcher}"
BACKEND_PORT="${MINDMELD_BACKEND_PORT:-8000}"
FRONTEND_PORT="${MINDMELD_FRONTEND_PORT:-5173}"
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"
BACKEND_PID_FILE="$STATE_DIR/backend.pid"
FRONTEND_PID_FILE="$STATE_DIR/frontend.pid"
BACKEND_LOG="$STATE_DIR/backend.log"
FRONTEND_LOG="$STATE_DIR/frontend.log"
LOCK_FILE="$STATE_DIR/toggle.lock"
OPEN_BROWSER="${MINDMELD_OPEN_BROWSER:-1}"

mkdir -p "$STATE_DIR"

usage() {
  cat <<'EOF'
Usage: script/build_and_run.sh [--start|--stop|--open|--status|--app-status|--verify|--logs|--debug|--toggle]

The Nexus Server Desktop app shows --app-status in a window with Open app,
Start server and Stop server controls. --start opens the app if it is already
running. With no option, --toggle is kept for older Desktop shortcuts: it starts
stopped services, but stops running services only when no board session or
recording is active. --stop always stops this checkout's services.

The launcher stores its PID files and logs in
~/Library/Application Support/Mindmeld Launcher.
EOF
}

read_pid() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    sed -n '1p' "$pid_file" | tr -cd '0-9'
  fi
}

process_start_identity() {
  ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

process_command_identity() {
  ps -p "$1" -o command= 2>/dev/null
}

record_process() {
  local pid="$1"
  local pid_file="$2"
  local service="$3"
  local start_identity
  local command_signature
  local temporary_file="$pid_file.tmp.$$"

  start_identity="$(process_start_identity "$pid")"
  command_signature="$service|$ROOT_DIR|$BACKEND_PORT|$FRONTEND_PORT"
  if [ -z "$start_identity" ]; then
    return 1
  fi
  printf '%s\n%s\n%s\n%s\n' \
    "$pid" "$start_identity" "$service" "$command_signature" > "$temporary_file"
  mv "$temporary_file" "$pid_file"
}

process_is_owned() {
  local pid_file="$1"
  local expected_service="$2"
  local pid
  local saved_start
  local saved_service
  local saved_signature
  local expected_signature
  local live_command

  [ -f "$pid_file" ] || return 1
  pid="$(read_pid "$pid_file")"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  saved_start="$(sed -n '2p' "$pid_file")"
  saved_service="$(sed -n '3p' "$pid_file")"
  saved_signature="$(sed -n '4p' "$pid_file")"
  expected_signature="$expected_service|$ROOT_DIR|$BACKEND_PORT|$FRONTEND_PORT"
  [ -n "$saved_start" ] || return 1
  [ "$saved_service" = "$expected_service" ] || return 1
  [ "$saved_signature" = "$expected_signature" ] || return 1
  [ "$(process_start_identity "$pid")" = "$saved_start" ] || return 1
  live_command="$(process_command_identity "$pid")"
  case "$expected_service" in
    backend)
      case "$live_command" in
        *"-m uvicorn mindmeld_api.main:app"*"--app-dir $ROOT_DIR/backend/src"*"--port $BACKEND_PORT"*) ;;
        *) return 1 ;;
      esac
      ;;
    frontend)
      case "$live_command" in
        *"$ROOT_DIR/frontend/node_modules/vite/bin/vite.js"*"--port $FRONTEND_PORT"*) ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

service_is_running() {
  local pid_file="$1"
  local service="$2"
  process_is_owned "$pid_file" "$service"
}

listener_pid() {
  local port="$1"
  /usr/sbin/lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
}

assert_port_available() {
  local port="$1"
  local label="$2"
  local pid
  pid="$(listener_pid "$port")"
  if [ -n "$pid" ]; then
    echo "$label cannot start: port $port is already in use by PID $pid." >&2
    return 1
  fi
}

find_node() {
  local candidate

  if [ -n "${MINDMELD_NODE:-}" ]; then
    if [ -x "$MINDMELD_NODE" ] && node_is_supported "$MINDMELD_NODE"; then
      printf '%s\n' "$MINDMELD_NODE"
      return 0
    fi
    return 1
  fi

  candidate="$(command -v node 2>/dev/null || true)"
  if [ -n "$candidate" ] && [ -x "$candidate" ] && node_is_supported "$candidate"; then
    printf '%s\n' "$candidate"
    return 0
  fi

  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ] && node_is_supported "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  while IFS= read -r candidate; do
    if [ -x "$candidate" ] && node_is_supported "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done <<EOF
$(find "$HOME/.nvm/versions/node" -type f -path '*/bin/node' 2>/dev/null | sort -r)
EOF

  return 1
}

node_is_supported() {
  local version
  local major
  local remainder
  local minor

  version="$("$1" --version 2>/dev/null || true)"
  version="${version#v}"
  major="${version%%.*}"
  remainder="${version#*.}"
  minor="${remainder%%.*}"
  case "$major:$minor" in
    20:*) [ "$minor" -ge 19 ] 2>/dev/null ;;
    22:*) [ "$minor" -ge 13 ] 2>/dev/null ;;
    *) [ "$major" -ge 24 ] 2>/dev/null ;;
  esac
}

wait_for_url() {
  local url="$1"
  local attempts="${2:-60}"
  local count=0

  while [ "$count" -lt "$attempts" ]; do
    if /usr/bin/curl --fail --silent --max-time 1 "$url" >/dev/null 2>&1; then
      return 0
    fi
    count=$((count + 1))
    sleep 0.25
  done
  return 1
}

stop_pid_file() {
  local pid_file="$1"
  local service="$2"
  local pid
  local count=0

  pid="$(read_pid "$pid_file")"
  if process_is_owned "$pid_file" "$service"; then
    process_is_owned "$pid_file" "$service" && kill "$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null && [ "$count" -lt 50 ]; do
      count=$((count + 1))
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null && process_is_owned "$pid_file" "$service"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$pid_file"
}

stop_services() {
  stop_pid_file "$FRONTEND_PID_FILE" frontend
  stop_pid_file "$BACKEND_PID_FILE" backend
  echo "Nexus stopped."
}

open_site() {
  [ "$OPEN_BROWSER" = "1" ] || return 0
  if [ -d "/Applications/Google Chrome.app" ]; then
    /usr/bin/open -a "Google Chrome" "$FRONTEND_URL" >/dev/null 2>&1 || true
  else
    /usr/bin/open "$FRONTEND_URL" >/dev/null 2>&1 || true
  fi
}

find_update_python() {
  local candidate
  local resolved
  local base
  for candidate in "${NEXUS_PYTHON:-}" "$ROOT_DIR/.venv/bin/python" \
    /usr/local/bin/python3.13 /usr/local/bin/python3.12 \
    /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 python3; do
    [ -n "$candidate" ] || continue
    resolved="$(command -v "$candidate" 2>/dev/null || true)"
    [ -n "$resolved" ] && [ -x "$resolved" ] || continue
    base="$("$resolved" -c 'import sys; sys.exit(1) if sys.version_info < (3, 12) else print(sys._base_executable)' 2>/dev/null)" || continue
    if [ -x "$base" ]; then printf '%s\n' "$base"; return 0; fi
  done
  return 1
}

prepare_student_update() {
  [ "${NEXUS_UPDATE_WORKER:-0}" != 1 ] || return 0
  [ -f "$SCRIPT_DIR/student_updates.py" ] || return 0
  local python
  local node
  python="$(find_update_python)" || {
    echo "A compatible Python is needed to check update recovery. Ask your helper." >&2
    return 1
  }
  node="$(find_node 2>/dev/null || true)"
  if [ -n "$node" ]; then
    PATH="$(dirname "$node"):$PATH" "$python" "$SCRIPT_DIR/student_updates.py" \
      --root "$ROOT_DIR" --launcher "$LAUNCHER_SCRIPT_FOR_UPDATE"
  else
    "$python" "$SCRIPT_DIR/student_updates.py" --root "$ROOT_DIR" --launcher "$LAUNCHER_SCRIPT_FOR_UPDATE"
  fi
}

start_services() {
  local update_status
  # A repeated launch opens the running app; it never starts a second copy or offers
  # an update to an app in use. The update worker keeps its stopped-services contract.
  if [ "${NEXUS_UPDATE_WORKER:-0}" != 1 ] \
    && service_is_running "$BACKEND_PID_FILE" backend \
    && service_is_running "$FRONTEND_PID_FILE" frontend; then
    open_site
    echo "Nexus is already running at $FRONTEND_URL"
    return 0
  fi
  LAUNCHER_SCRIPT_FOR_UPDATE="$SCRIPT_DIR/build_and_run.sh"
  prepare_student_update
  update_status=$?
  if [ "$update_status" -eq 20 ]; then
    open_site
    echo "Nexus is ready at $FRONTEND_URL"
    return 0
  fi
  [ "$update_status" -eq 0 ] || return "$update_status"
  local python="$ROOT_DIR/.venv/bin/python"
  local vite="$ROOT_DIR/frontend/node_modules/vite/bin/vite.js"
  local node

  if [ ! -x "$python" ]; then
    echo "Nexus Python environment is missing. Run the Setup commands in README.md first." >&2
    return 1
  fi
  if ! "$python" -c 'import uvicorn' >/dev/null 2>&1; then
    echo "Nexus backend dependencies are missing. Run: .venv/bin/python -m pip install -e 'backend[dev]'" >&2
    return 1
  fi
  if [ ! -f "$vite" ]; then
    echo "Nexus frontend dependencies are missing. Run: npm install --prefix frontend" >&2
    return 1
  fi
  node="$(find_node)" || {
    echo "A compatible Node.js was not found. Nexus requires Node 20.19+, 22.13+, or 24+." >&2
    return 1
  }

  assert_port_available "$BACKEND_PORT" "Nexus backend" || return 1
  assert_port_available "$FRONTEND_PORT" "Nexus frontend" || return 1

  : > "$BACKEND_LOG"
  : > "$FRONTEND_LOG"

  (
    cd "$ROOT_DIR" || exit 1
    MINDMELD_FRONTEND_PORT="$FRONTEND_PORT" nohup "$python" -m uvicorn mindmeld_api.main:app \
      --app-dir "$ROOT_DIR/backend/src" \
      --host 127.0.0.1 \
      --port "$BACKEND_PORT" >>"$BACKEND_LOG" 2>&1 9>&- &
    record_process "$!" "$BACKEND_PID_FILE" backend
  )

  if ! wait_for_url "$BACKEND_URL/health"; then
    echo "Nexus backend did not become ready. See $BACKEND_LOG" >&2
    stop_pid_file "$BACKEND_PID_FILE" backend
    return 1
  fi

  (
    cd "$ROOT_DIR/frontend" || exit 1
    VITE_API_BASE_URL="$BACKEND_URL" nohup "$node" "$vite" \
      --host 127.0.0.1 \
      --port "$FRONTEND_PORT" \
      --strictPort >>"$FRONTEND_LOG" 2>&1 9>&- &
    record_process "$!" "$FRONTEND_PID_FILE" frontend
  )

  if ! wait_for_url "$FRONTEND_URL"; then
    echo "Nexus frontend did not become ready. See $FRONTEND_LOG" >&2
    stop_pid_file "$FRONTEND_PID_FILE" frontend
    stop_pid_file "$BACKEND_PID_FILE" backend
    return 1
  fi

  open_site
  echo "Nexus started at $FRONTEND_URL"
}

show_status() {
  local backend="stopped"
  local frontend="stopped"
  service_is_running "$BACKEND_PID_FILE" backend && backend="running"
  service_is_running "$FRONTEND_PID_FILE" frontend && frontend="running"
  echo "Nexus backend: $backend; frontend: $frontend; site: $FRONTEND_URL"
}

# Read-only board/recording check for this checkout's backend. Like other native
# local clients, curl sends no browser Origin. Any failure is reported as unknown.
backend_session_state() {
  local board
  local recording
  local session

  board="$(/usr/bin/curl --fail --silent --max-time 2 --max-filesize 1048576 \
    "$BACKEND_URL/api/board" 2>/dev/null)" || board=""
  recording="$(/usr/bin/curl --fail --silent --max-time 2 --max-filesize 1048576 \
    "$BACKEND_URL/api/recordings/current" 2>/dev/null)" || recording=""
  if [ -z "$board" ] || [ -z "$recording" ]; then
    echo unknown
    return 0
  fi
  session="$(/usr/bin/osascript -l JavaScript - "$board" "$recording" 2>/dev/null <<'JXA'
function run(argv) {
  try {
    const board = JSON.parse(argv[0])
    const recording = JSON.parse(argv[1])
    if (!board || typeof board !== 'object' || !recording || typeof recording !== 'object') return 'unknown'
    if (recording.active === true) return 'recording'
    if (recording.active !== false) return 'unknown'
    if (board.status === 'streaming') return 'streaming'
    if (board.status === 'prepared') return 'connected'
    if (board.status === 'idle' || board.status === 'error') return 'idle'
  } catch (error) {}
  return 'unknown'
}
JXA
)"
  case "$session" in
    idle|connected|streaming|recording) echo "$session" ;;
    *) echo unknown ;;
  esac
}

session_summary() {
  case "$1" in
    none) echo "" ;;
    idle) echo "No board session or recording is active." ;;
    connected) echo "A board is connected. Press Reset in Nexus EEG Lab before stopping the server." ;;
    streaming) echo "The board is streaming. Press Stop and Reset in Nexus EEG Lab before stopping the server." ;;
    recording) echo "A recording or experiment is in progress. Finish and save it in Nexus EEG Lab before stopping the server." ;;
    *) echo "Nexus Server could not check whether a board session or recording is active." ;;
  esac
}

# Machine-readable status for the Desktop window. Line 1 is running, stopped,
# partial or busy; line 2 is none, idle, connected, streaming, recording or unknown;
# line 3 is the session summary (may be empty); the remaining lines are the message.
app_status() {
  local backend=stopped
  local frontend=stopped
  local session=none
  local summary
  local lock_status
  local pid
  local ports=""
  local message

  # The probe holds the kernel lock only for /usr/bin/true. A held lock means a
  # start, stop or update is in progress, so PID files may be about to change.
  /usr/bin/lockf -s -t 0 "$LOCK_FILE" /usr/bin/true 2>/dev/null
  lock_status=$?
  if [ "$lock_status" -eq 75 ]; then
    summary="$(session_summary unknown)"
    printf 'busy\nunknown\n%s\n%s\n' "$summary" \
      "Nexus Server is starting, stopping or installing an update. Wait for it to finish, then choose Check again."
    return 0
  fi

  service_is_running "$BACKEND_PID_FILE" backend && backend=running
  service_is_running "$FRONTEND_PID_FILE" frontend && frontend=running
  [ "$backend" = stopped ] || session="$(backend_session_state)"
  summary="$(session_summary "$session")"

  if [ "$backend" = running ] && [ "$frontend" = running ]; then
    message="Nexus EEG Lab is running at $FRONTEND_URL.

$summary

Closing the browser does not stop the server."
    printf 'running\n%s\n%s\n%s\n' "$session" "$summary" "$message"
  elif [ "$backend" = stopped ] && [ "$frontend" = stopped ]; then
    message="Nexus EEG Lab is stopped.

Start server checks for an offered update, starts the local services and opens the app."
    pid="$(listener_pid "$BACKEND_PORT")"
    [ -z "$pid" ] || ports="$ports port $BACKEND_PORT (PID $pid)"
    pid="$(listener_pid "$FRONTEND_PORT")"
    [ -z "$pid" ] || ports="$ports port $FRONTEND_PORT (PID $pid)"
    if [ -n "$ports" ]; then
      message="$message

Another program is using$ports, so Start server will not work until it is closed. Nexus Server never closes other programs."
    fi
    printf 'stopped\nnone\n\n%s\n' "$message"
  else
    message="Nexus EEG Lab is only partly running (backend $backend, frontend $frontend)."
    [ -z "$summary" ] || message="$message

$summary"
    message="$message

Choose Stop server, then Start server to restart it."
    printf 'partial\n%s\n%s\n%s\n' "$session" "$summary" "$message"
  fi
}

open_app() {
  if ! service_is_running "$FRONTEND_PID_FILE" frontend; then
    echo "Nexus EEG Lab is not running. Choose Start server first." >&2
    return 1
  fi
  open_site
  echo "Opening Nexus EEG Lab at $FRONTEND_URL"
}

verify_services() {
  service_is_running "$BACKEND_PID_FILE" backend || {
    echo "Nexus backend is not running." >&2
    return 1
  }
  service_is_running "$FRONTEND_PID_FILE" frontend || {
    echo "Nexus frontend is not running." >&2
    return 1
  }
  wait_for_url "$BACKEND_URL/health" 4 || {
    echo "Nexus backend is running but its health check failed." >&2
    return 1
  }
  wait_for_url "$FRONTEND_URL" 4 || {
    echo "Nexus frontend is running but is not responding." >&2
    return 1
  }
  echo "Nexus is healthy at $FRONTEND_URL"
}

with_lock() {
  local action="$1"
  local status
  /usr/bin/lockf -s -t 0 "$LOCK_FILE" "$0" "--locked-$action"
  status=$?
  if [ "$status" -eq 75 ]; then
    echo "Nexus is already starting or stopping. Try again in a few seconds." >&2
  fi
  return "$status"
}

toggle_services() {
  local session
  if service_is_running "$BACKEND_PID_FILE" backend || service_is_running "$FRONTEND_PID_FILE" frontend; then
    # Older Desktop shortcuts still call --toggle. A repeated launch must not end a
    # live board session or recording; --stop remains the explicit stop command.
    if service_is_running "$BACKEND_PID_FILE" backend; then
      session="$(backend_session_state)"
      if [ "$session" != idle ]; then
        echo "Nexus was left running. $(session_summary "$session") To stop it anyway, run ./script/build_and_run.sh --stop in the nexus folder." >&2
        return 1
      fi
    fi
    stop_services
  else
    start_services
  fi
}

ACTION="${1:---toggle}"
case "$ACTION" in
  --toggle|toggle|run) with_lock toggle_services ;;
  --start|start) with_lock start_services ;;
  --stop|stop) with_lock stop_services ;;
  --locked-toggle_services) toggle_services ;;
  --locked-start_services) start_services ;;
  --locked-stop_services) stop_services ;;
  --open|open) open_app ;;
  --status|status) show_status ;;
  --app-status|app-status) app_status ;;
  --verify|verify) verify_services ;;
  --logs|logs|--telemetry|telemetry)
    touch "$BACKEND_LOG" "$FRONTEND_LOG"
    tail -n 80 -F "$BACKEND_LOG" "$FRONTEND_LOG"
    ;;
  --debug|debug)
    with_lock start_services || exit $?
    tail -n 80 -F "$BACKEND_LOG" "$FRONTEND_LOG"
    ;;
  --help|-h|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
