# Nexus BCI project status

Public repository: [zook111/Nexus_BCI](https://github.com/zook111/Nexus_BCI).

## Initial public release

- Clean source snapshot with no imported development Git history or participant data.
- Nexus console, quality/DSP controls, recording/replay, guided calibration and confidence-gated demos.
- Experiment Lab with labelled trials, separate training/test recordings and local pyRiemann classification.
- Interactive A-level maths lesson and a shareable student starter PDF with clickable public links.
- MIT-licensed software, project copyright notices, and documented permission to redistribute generated audio.
- Data/secret-safe ignores, contribution/security guidance and credential-scan CI.
- HTTP/WebSocket browser-origin guard preserving configured local clients and native clients without Origin.

## Verification

Clean Python 3.12 / Node 24 setup, backend Ruff and 161 tests, frontend lint and 83 tests, and production build pass in this public checkout. Native macOS launcher and credential-scan checks are recorded in the initial-release PR. The origin tests cover allowed local clients, rejected unrelated browser origins and prevention of board side effects. Review fixes preserve the final recording tail before Reset releases the board, capture per-experiment mains frequency for live/offline quality, and reconnect the live socket with bounded retries and cleanup. Further review fixes require advancing source timestamps throughout baseline capture and flush pending samples before assigning calibration marker indices. Recording initialization also rolls back metadata/worker failures for a safe retry, and custom launcher UI ports are propagated into the HTTP/WebSocket origin policy. The console displays recording failure messages beside its controls. Periodic storage failures stop recordings with an incomplete/error message, and atomic metadata replacement preserves previous valid JSON on write failure. API shutdown flushes/finalizes recordings and releases the native board; recording start excludes previously buffered samples. Experiment-linked recordings are protected from deletion, and experiment Save can recover finalized raw recordings after a transient annotation-write failure. Browser checks verified synthetic streaming and the lesson. All examples and screenshots use synthetic data.

## Known limits and next steps

- Experiment-linked recordings are retained until linked experiment deletion is supported.
- Validate installation independently on Intel macOS and the physical Cyton/Cyton Daisy setup.
- Collect separate participant recordings before reporting classifier performance; synthetic results are rehearsal.
- Keep services on loopback. Origin checks are not user authentication or protection against untrusted local processes.
- Maintain a single reviewed source and publish future changes through this repository's PR process.
- Preserve participant-data exclusion, media provenance and copyright notices on future releases.
