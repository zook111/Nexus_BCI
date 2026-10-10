<div align="center">

<img src="frontend/public/nexus-symbol.svg" width="76" alt="Nexus signal logo" />

# Nexus

### Your local workspace for EEG, experiments and discovery.

**Acquire signals · Label trials · Test a classifier · Learn the maths**

Created by **[zook111](https://github.com/zook111)**

[Get started](#get-started-on-macos) · [Experiment Lab](docs/experiment-lab.md) · [Student starter guide](docs/student-starter-guide.pdf) · [Contribute](CONTRIBUTING.md) · [Security & privacy](SECURITY.md)

</div>

![Nexus acquisition console showing synthetic EEG](docs/images/nexus-console.jpg)

Nexus connects an OpenBCI Cyton or Cyton Daisy to a readable, hands-on EEG workspace. Watch waveforms and electrode quality together, record locally, run guided trials, and evaluate a small classifier on a separate test recording. An interactive lesson explains the journey from filtered signals to covariance matrices, Riemannian tangent-space features and logistic regression.

**No headset yet? Start with the built-in synthetic board. No API key, GPU or cloud inference is needed.**

> Nexus is an experimental education and signal-exploration tool. It is not a medical device, a mind reader, or a validated measure of stress, attention or relaxation. Task labels describe instructions, not proven mental states. Screenshots use synthetic signals.

## Four workspaces, one signal

| Workspace | What you can do |
| --- | --- |
| **Console** | Connect a board, inspect live traces and per-electrode quality, adjust DSP, record CSVs, replay sessions and export calibration markers. |
| **Experiment Lab** | Follow visual and spoken task cues, automatically label trials, review or exclude artefacts, and train/evaluate locally with pyRiemann. |
| **Interactive maths lesson** | Explore frequencies, covariance, tangent coordinates and the sigmoid with linked sliders, worked examples and a knowledge check. Open it from Experiment Lab. |
| **Feedback Lab / Doctor Demo** | Explore optional visual and audio feedback. Signal-quality gates pause interpretation when the data is unreliable. |

## Get started on macOS

You need **Git**, **Python 3.12+**, and a supported even-numbered **Node.js** version. The recommended **Node 24** setup requires **macOS 13.5 or later** on Intel or Apple Silicon, as documented in [Node's platform requirements](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list). Older macOS versions need a different compatibility plan. Install Python from [python.org](https://www.python.org/downloads/macos/) and Node from [nodejs.org](https://nodejs.org/en/download); if you use nvm, run `nvm install && nvm use` after cloning.

```bash
git clone https://github.com/zook111/Nexus_BCI.git nexus
cd nexus
./script/setup.sh
./script/install_desktop_launcher.sh
```

Open **Nexus Server** from your Desktop. It starts the local API and web interface, then opens [localhost:5173](http://localhost:5173). Open the app again to stop its processes. Keep the checkout in place: the launcher points to it. Reinstalling archives this checkout's old **Mindmeld Server** launcher in the Trash so only the Nexus app remains on the Desktop.

This public repository starts from a clean source snapshot. Internal Python package names and existing `MINDMELD_*` settings remain compatible with earlier Nexus installations.

### Your first stream — no hardware required

1. Choose **Console**, leave **Board → Synthetic**, and click **Connect**, then **Start**.
2. Watch live traces, channel quality and the DSP summary. Synthetic signals test the software, not a participant or a classifier's brain-decoding accuracy.
3. Enter a session label, click **Record**, then **Save**. Preview or download the recording in **Telemetry**.
4. Open **Experiment Lab → How the classifier works** for the interactive lesson. To collect labelled trials, follow the [Experiment Lab guide](docs/experiment-lab.md).
5. Use **Stop** to stop the stream and **Reset** to release the board.

<details>
<summary><strong>Manual setup and developer commands</strong></summary>

From the repository root:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip setuptools wheel
.venv/bin/python -m pip install -e 'backend[dev]'
npm ci --prefix frontend
```

Run these in two terminals:

```bash
# Terminal 1: API at http://127.0.0.1:8000
.venv/bin/python -m uvicorn mindmeld_api.main:app \
  --app-dir backend/src --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2: UI at http://127.0.0.1:5173
npm run dev --prefix frontend -- --host 127.0.0.1 --port 5173
```

Interactive API documentation: [127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

The macOS launcher also supports `./script/build_and_run.sh --status`, `--verify`, `--logs`, `--start` and `--stop`. Existing installations retain their state and logs in `~/Library/Application Support/Mindmeld Launcher`.

The Python/React services are portable; CI runs on Linux. The desktop launcher is macOS-specific. Windows and Intel Mac end-to-end installs still need separate validation.

</details>

## Connect an OpenBCI headset

Use a **Cyton (8 channels)** or **Cyton Daisy (16 channels)** with the OpenBCI USB dongle. A USB-C adapter may be needed on newer laptops. Follow OpenBCI's own hardware setup and electrical-safety instructions before using the headset.

Select the board and its recommended USB serial port, then **Connect → Start**. On macOS, prefer `/dev/cu.*` ports. Nexus ranks likely OpenBCI candidates; generic FTDI and Bluetooth ports are not proof of a supported board. Hardware connection is manual by default. For an explicitly trusted dongle, see [configuration](#configuration).

Check that timestamps advance and that the selected electrodes have several consecutive usable quality windows before recording experimental trials. Fix reference/bias contact and electrode seating before relying on filtered traces. The default mains notch is **50 Hz**; change it to **60 Hz** in a 60 Hz region.

## Experiments you can reproduce

![Nexus interactive classifier lesson](docs/images/nexus-lesson.jpg)

Start with an eyes-open/eyes-closed protocol, or investigate left/right hand imagery with appropriately placed electrodes. Nexus supports two to four task labels, balanced guided trials, editable annotations and explicit exclusions.

The fixed classification pipeline is:

```text
Filtered EEG → OAS channel covariance → Riemannian tangent space → logistic regression
```

Train on one recording and evaluate on another, with matching participant code, channels, sample rate and task labels. Feature fitting uses training data only. Reports include balanced accuracy, chance level, a confusion matrix, per-trial probabilities, rejected-trial reasons, file hashes and package versions.

Accuracy depends on the participant, electrode placement, artefacts, timing and the protocol. Motor imagery is an investigation, not a promised capability. The app evaluates saved trials; it does not yet provide a persistent live classifier. Read the [method and limitations](docs/experiment-lab.md) before designing a school study.

## Your data stays with you

Raw EEG, metadata, annotations and reports are saved locally under `recordings/`; demo-room data lives under `data/`. Both are ignored by Git. Nothing in the classification pipeline uploads recordings. Unrelated browser origins are rejected by the local HTTP API and EEG WebSocket. This is not authentication against software running on your computer. Use anonymous participant codes, obtain appropriate permission, and keep exports out of public issues and commits.

Browser speech is available for task cues. Optional Cartesia speech sends cue text to that provider and requires a local API key. No key is needed for normal acquisition, classification or the lesson. See [Security & privacy](SECURITY.md) for the API's local-only trust boundary.

## Configuration

Defaults work without an environment file. For optional backend settings:

```bash
cp backend/.env.example .env
```

Set `CARTESIA_API_KEY` locally only if you want optional hosted cue speech. Never commit `.env` or place secrets in `VITE_*` frontend settings.

| Setting | Purpose |
| --- | --- |
| `MINDMELD_RECORDING_DIR` | Local recording storage; default `recordings`. |
| `MINDMELD_DEMO_DB_PATH` | Local demo database; default `data/mindmeld_demo.sqlite3`. |
| `CARTESIA_API_KEY` / `MINDMELD_CARTESIA_API_KEY` | Optional hosted calibration voice; blank uses the browser fallback. |
| `VITE_API_BASE_URL` | Frontend API URL; default `http://localhost:8000`. |
| `VITE_OPENBCI_AUTOCONNECT_BOARD` | Required alongside the serial for auto-connect: `cyton` or `cyton_daisy`. Blank or invalid keeps setup manual. |
| `VITE_OPENBCI_AUTOCONNECT_SERIAL` | Optional known dongle serial in `frontend/.env.local`; requires the board setting below. |

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Installer reports an unsupported Python or Node | Check `python3.12 --version` and `node --version`. Use `NEXUS_PYTHON=/path/to/python ./script/setup.sh` for a specific interpreter; `nvm use` selects the repo's Node line. |
| Port 8000 or 5173 is occupied | Stop the application that owns it or use different development ports. Nexus does not terminate unrelated listeners. |
| No USB port | Check the dongle, adapter and operating-system permissions. Refresh ports; use Synthetic to verify the app independently. |
| `BOARD_NOT_READY_ERROR:7` | Check board power/radio mode, release the serial port, wait a few seconds, then Reset and reconnect. |
| Stream appears frozen or the board session is lost | Check advancing timestamps. Reset, let the dongle settle, then Connect and Start. |
| High noise or many bad channels | Secure reference/bias and electrode contacts, run the laptop on battery and move leads away from power supplies. Filtering cannot repair a disconnected electrode. |
| No spoken cues | Browser speech availability varies. Visual cues remain available; audio starts after a user interaction. |

## Built for inspection

React + TypeScript + Vite on the frontend; Python + FastAPI + BrainFlow + NumPy/SciPy on the backend; pyRiemann + scikit-learn for local classification. Live samples use WebSockets. The console exposes DSP and quality measurements alongside the waveforms.

[Contributing](CONTRIBUTING.md) explains checks and development conventions. [Project status](project_status.md) records what is verified and what remains. [Public-release checklist](docs/public-release.md) distinguishes code hygiene from publication readiness.

**Licence and attribution:** Nexus software and original brand assets are released under the [MIT licence](LICENSE), copyright 2026 [zook111](https://github.com/zook111). Bundled generated audio has separate [media notices](MEDIA.md); the maintainer has confirmed redistribution rights. Third-party dependencies retain their own licences.
