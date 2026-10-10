# Nexus BCI project status

Public repository: [zook111/Nexus_BCI](https://github.com/zook111/Nexus_BCI).

## Initial public release

- Clean source snapshot with no imported development Git history or participant data.
- Nexus console, quality/DSP controls, recording/replay, guided calibration and confidence-gated demos.
- Experiment Lab with labelled trials, separate training/test recordings and local pyRiemann classification.
- Interactive A-level maths lesson and a shareable student starter PDF with clickable public links.
- Three-page eyes-open/eyes-closed experiment PDF in `docs/`, linked from the README's top navigation and school-project section. The published guide includes reviewed local-mains-frequency instructions (50 Hz in the UK or 60 Hz where applicable), kept consistent across training and test.
- MIT-licensed software, project copyright notices, and documented permission to redistribute generated audio.
- Data/secret-safe ignores, contribution/security guidance and credential-scan CI.
- HTTP/WebSocket browser-origin guard preserving configured local clients and native clients without Origin.

## Verification

Clean Python 3.12 / Node 24 setup, backend Ruff and 161 tests, frontend lint and 83 tests, and production build pass in this public checkout. Native macOS launcher and credential-scan checks are recorded in the initial-release PR. The origin tests cover allowed local clients, rejected unrelated browser origins and prevention of board side effects. Review fixes preserve the final recording tail before Reset releases the board, capture per-experiment mains frequency for live/offline quality, and reconnect the live socket with bounded retries and cleanup. Further review fixes require advancing source timestamps throughout baseline capture and flush pending samples before assigning calibration marker indices. Recording initialization also rolls back metadata/worker failures for a safe retry, and custom launcher UI ports are propagated into the HTTP/WebSocket origin policy. The console displays recording failure messages beside its controls. Periodic storage failures stop recordings with an incomplete/error message, and atomic metadata replacement preserves previous valid JSON on write failure. API shutdown flushes/finalizes recordings and releases the native board; recording start excludes previously buffered samples. Experiment-linked recordings are protected from deletion, and experiment Save can recover finalized raw recordings after a transient annotation-write failure. Browser checks verified synthetic streaming and the lesson. All examples and screenshots use synthetic data.

## Intel Ventura compatibility check (10 October 2026)

- Node 24 publishes an Intel macOS 13.5 minimum; Ventura 13.7.8 meets it.
- Binary-only dependency resolution for Intel macOS 13 succeeds for Python 3.12 and 3.13: 86 distributions each, including development/build dependencies.
- BrainFlow 5.23.0 BoardController includes x86_64 with a macOS 10.13 target; the locked Rolldown 1.2.12 Intel binding targets macOS 10.12.
- README gives a Python 3.13 standard installer route, Intel Node selection and explicit interpreter command. This is compatibility evidence, not an Intel/Ventura runtime or headset test.

## Known limits and next steps

- A two-page Intel/Ventura setup PDF and copyable text guide are available in `docs/`. Both pages were rendered and reviewed; six links and the installation command text were checked. The practice flow was followed in a browser: Record, Capture setup, Save and Preview, producing a synthetic session with 11,551 samples and one setup snapshot.
- GitHub `main` protection is active: PRs required for administrators too, Backend/Frontend/Tracked files and Git history checks required, conversations resolved, and force pushes/deletion disabled. No approving reviewer count is added; the existing five-minute review policy remains.

- Experiment-linked recordings are retained until linked experiment deletion is supported.
- Validate installation independently on Intel macOS and the physical Cyton/Cyton Daisy setup.
- Collect separate participant recordings before reporting classifier performance; synthetic results are rehearsal.
- Keep services on loopback. Origin checks are not user authentication or protection against untrusted local processes.
- Maintain a single reviewed source and publish future changes through this repository's PR process.
- Preserve participant-data exclusion, media provenance and copyright notices on future releases.
