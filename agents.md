# Nexus Agent Notes

## Project Shape

Nexus is an OpenBCI acquisition and visualization app for local development on macOS.

- Backend: Python, FastAPI, BrainFlow, NumPy/SciPy.
- Frontend: React, Vite, TypeScript.
- Realtime transport: FastAPI WebSocket at `/ws/stream`.
- Live DSP summary endpoint: FastAPI REST at `/api/dsp/summary`.
- Live signal quality endpoint: FastAPI REST at `/api/signal/quality`.
- Calm demo feature endpoints: FastAPI REST under `/api/demo/calm`.
- Guided calibration cue speech endpoint: FastAPI REST at `/api/calibration/cue-speech`.
- Guided calibration marker endpoint: FastAPI REST at `/api/recordings/current/calibration-markers`.
- Saved recording calibration report endpoint: FastAPI REST at `/api/recordings/{session_id}/calibration-report`.
- Hardware target: OpenBCI Cyton or Cyton Daisy via the OpenBCI USB dongle serial port.
- Development fallback: BrainFlow synthetic board.

## Local Setup

Use the repo-local virtual environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip setuptools wheel
.venv/bin/python -m pip install -e 'backend[dev]'
```

Install frontend dependencies:

```bash
npm install --prefix frontend
```

Use Node 24, or an even-numbered supported line listed in `frontend/package.json`. The current local Node 23 line produces npm engine warnings from the generated frontend toolchain.

Optional Cartesia voice prompts for guided calibration:

```bash
cp backend/.env.example .env
# Set CARTESIA_API_KEY or MINDMELD_CARTESIA_API_KEY in .env.
```

When no Cartesia key is configured, `/api/calibration/cue-speech` returns no content and the frontend falls back to browser speech synthesis after the local cue beep.

## Common Commands

Run backend:

```bash
.venv/bin/fastapi dev backend/src/mindmeld_api/main.py
```

Run frontend:

```bash
npm run dev --prefix frontend
```

Backend checks:

```bash
.venv/bin/ruff check backend
.venv/bin/pytest backend
```

Frontend checks:

```bash
npm run lint --prefix frontend
npm run build --prefix frontend
```

## Branch And PR Policy

- Create a feature branch for each new work item.
- Every code change must be submitted as a pull request ready for review.
- Merge is authorised only after relevant checks pass, all review comments are addressed, and the latest PR revision has had at least five minutes for review. Recheck the current head and comments immediately before merging.
- Keep branches reviewable: one coherent feature or fix per branch.
- Before handoff, update `project_status.md` with completed work, verification, known risks, and next steps.
- A branch is PR-ready only after relevant backend/frontend checks pass or any skipped check is documented.
- Do not commit `.venv`, `node_modules`, recordings, raw EEG exports, `.env`, or machine-local files.

## Hardware Notes

- On macOS, prefer `/dev/cu.*` serial paths for the Cyton dongle.
- `/api/ports` ranks serial ports and marks likely OpenBCI USB candidates; avoid auto-selecting non-recommended system or Bluetooth ports.
- Use `cyton` for 8-channel boards and `cyton_daisy` for 16-channel boards.
- Use `synthetic` when developing without the headset attached.
- Raw recordings should stay under ignored `recordings/`, `data/`, or `exports/` paths unless a sanitized fixture is intentionally added.

### Live Cyton debugging runbook

Use evidence from multiple fresh windows before changing filters or starting calibration:

1. Confirm `/api/board` reports the expected board and port, but do not treat `status: streaming` as proof that samples are live.
2. Read `/api/demo/calm?line_frequency_hz=50` at least twice, two seconds apart. `source_timestamp` must advance. If it does not, all quality and DSP values are a stale buffer.
3. Read `/api/signal/quality?window_size=500&line_frequency_hz=50` for per-channel `status`, `filtered_rms`, `line_noise_ratio`, and `issues`.
4. Require at least three consecutive usable windows before calibration or Doctor Demo scoring. The demo confidence gate is 55%; one transient high-confidence window is not enough.

Interpret the diagnostics as follows:

- UK mains defaults are already correct: the live DSP notch is enabled at 50 Hz and the bandpass defaults to 1–45 Hz.
- `line_noise_ratio` intentionally measures how much of the acquired raw-band power is near 50 Hz even when the DSP output notch is enabled. A `line_noise` flag therefore does not mean that the notch is off; it identifies acquisition quality that filtering would otherwise conceal.
- The current quality thresholds flag line-noise ratios at 0.25 or above and filtered EEG-band RMS at 150 uV or above.
- Flatline plus railing, often pinned near the Cyton limits of +/-187500 uV, indicates a disconnected, shorted, or otherwise railed electrode path. Reseat that channel and its connector.
- Similar 50 Hz dominance across most active channels points first to the shared reference/bias contacts, mains coupling, or cable routing rather than independent failure of every sensor. Secure the common contacts, run the Mac on battery, keep leads away from power supplies, and remain still before rechecking.
- A reference-contact adjustment that produces only one clean window and then regresses is not a calibration success; mechanically secure the contact and verify stability.

Known recovery signatures:

- `BOARD_NOT_READY_ERROR:7`: the FTDI dongle can be present while the headset does not answer BrainFlow's prepare command. Check PC mode/power and solid radio lights, release the serial port, wait about five seconds, then make one clean connect attempt.
- Frozen `source_timestamp` with apparently `streaming` state: the transport has stopped advancing. Reset/reconnect before interpreting signal quality.
- A released native session (`BOARD_NOT_CREATED_ERROR:15`) now pauses live snapshots/analysis, finalises an active recording, and reconciles `/api/board` to `error`. Press Reset, let the serial port settle, then Connect and Start again. Genuine native release failures keep the owner and report an error so Reset can retry safely. On older builds or if Reset continues to fail, stop the launcher, open the installed `Nexus Server.app` and choose Start server, wait for ports 8000/5173, and reconnect after the serial port has settled.
- For user-facing live sessions, prefer starting through `~/Desktop/Nexus Server.app` (Start server). Opening it shows a status window and never stops services; its Stop server asks first while `--app-status` reports a board session, recording or unknown status. Legacy `--toggle` refuses to stop in those states; `--stop` is the explicit command. A direct `script/build_and_run.sh --start` from a short-lived agent shell can report healthy and then lose its child processes when that shell exits.

Do not start baseline capture or call a setup calibrated while timestamps are stale, posterior signal is noisy, confidence is below the gate, or the required clean windows have not accumulated.

## UI Notes

- The frontend should remain a dense operational console, not a marketing page.
- Use code-native controls for connection, recording, traces, and analysis state.
- Keep live trace rendering efficient; move to `uPlot` or canvas/WebGL when sample volume requires it.
- Wearer/electrode validation should keep quality status adjacent to the affected live trace so setup can be adjusted without looking away from waveform shape.
- Display filtered EEG-band RMS for wearer quality; keep raw RMS as a backend diagnostic so slow baseline drift does not dominate setup scoring.
- Calm demo work is explicitly non-medical. Use language such as calm trend, settling signal, confidence, and signal paused; do not present stress detection or clinical interpretation.
- Calm demo state should pause interpretation when posterior signal quality is poor. Keep raw traces, DSP, signal quality, and tunables available for operator review.
- Keep the Calm Mirror demo in a separate UI view from the acquisition console. The console remains the hard-data/operator view; the demo view should stay signal-first and confidence-gated.
- Feedback Lab audio may use bundled local Lyria loops, but they must remain optional, muted behind the confidence gate, and secondary to the existing Web Audio pad fallback.
- Doctor Demo proof cues and Reactor music are bundled local MP3s. Keep the eye-state instructions unmistakable, retain an explicit mute control, and mute Reactor feedback whenever the confidence gate closes.
- Keep guided calibration cues in the operator console. Use task-based wording such as eyes open, eyes closed, blink check, and stillness; marker export remains available even when markers are also persisted to active recording metadata.
- Cartesia cue audio is optional. Preserve local beep and browser speech fallbacks so calibration remains usable offline or without API credentials.

## Public repository conventions

- Repository: `https://github.com/zook111/Nexus_BCI`. Keep individual contributor credit in Git commit authorship.
- Preserve MIT notices and the separate generated-media notice.
- Keep browser Origin checks on HTTP and WebSocket requests; Origin validation does not replace authentication.
- Add only reviewed, non-participant documents under `docs/`; generated scratch files belong in ignored `output/`, `tmp/`, `data/` or `exports/`.
