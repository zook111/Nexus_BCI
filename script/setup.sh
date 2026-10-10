#!/bin/bash
# Install Nexus dependencies into this checkout; no global Python packages or API keys.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PYTHON="${NEXUS_PYTHON:-python3.12}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  PYTHON="${NEXUS_PYTHON:-python3}"
fi
if ! command -v "$PYTHON" >/dev/null 2>&1 || ! "$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
  echo "Python 3.12+ is required. Install it from python.org or set NEXUS_PYTHON to its executable." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(Number(!((major===20&&minor>=19)||(major===22&&minor>=13)||(major>=24&&major%2===0))))'; then
  echo "A supported even-numbered Node.js version is required. Use Node 24, then run this script again." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required; it is included with Node.js." >&2
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  "$PYTHON" -m venv .venv
elif ! .venv/bin/python -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
  echo "The existing .venv uses an older Python. Move it aside and rerun setup with Python 3.12+." >&2
  exit 1
fi
.venv/bin/python -m pip install --upgrade pip setuptools wheel
.venv/bin/python -m pip install -e 'backend[dev]'
npm ci --prefix frontend

echo "Nexus is installed. On macOS, run ./script/install_desktop_launcher.sh and open Nexus Server from your Desktop."
echo "For development commands and a first synthetic stream, see README.md."
