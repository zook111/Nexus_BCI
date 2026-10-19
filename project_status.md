# Nexus BCI project status

Public repository: [zook111/Nexus_BCI](https://github.com/zook111/Nexus_BCI).

## Offered student updates, 19 October 2026

- The user approved offered Update and restart behaviour. Native startup checks the protected public main branch, offers the pinned revision before starting services, and keeps offline/current-version startup usable. There is no HTTP software-install endpoint and no silent installation.
- Git fast-forward/local-edit/ignored-file protections, an atomic transaction journal, recoverable dependency/code backups and ordinary failure rollback preserve recordings and local settings. Existing app processes/ports block installation; the launcher kernel lock covers update and startup. A stable copied worker uses base Python and macOS curl TLS trust.
- The updater refreshes the correct installed shortcut/icon, including a custom app path. Student README/Help/setup instructions cover save/stop/open, Update and restart/Not now, offline behaviour and helper-led bootstrap for pre-feature installs.
- Verification so far: 48 updater tests pass, using real temporary Git repos, real virtual-environment rollback and isolated update/recovery control fixtures. Native launcher/kernel-lock/updater-result tests and native installer/signing/quoted-path tests pass. Backend Ruff and 164 tests, frontend lint/110 tests/production build pass. The three-page setup PDF was rendered and its commands, six links and production asset checked. In-app Help and the PDF opening were verified at 1280×720 without app warnings/errors; the README screenshot is refreshed. Review requirements are current-head review/CI, resolved comments and the five-minute hold before merging. No real checkout was updated by these tests, no participant data was used and independent Intel/Ventura/physical EEG validation remains outstanding.

- Review corrections: allow the tracked `.env.example` templates and validate the actual repository tree; guard reverse checkout collisions and use ignore-preserving checkout with a conditional main-ref update during rollback; gate and record installer process groups before execution, terminate/wait for transient descendants before restoration, and reconcile interrupted activity by PID/start identity and a unique command nonce. New tests cover delayed writers, worker death, unrelated PIDs, source-recovery interruption and private ignored-file/directory collisions.

## EEG Lab Dock icon, 19 October 2026

- Created a mint neural-loop/EEG glyph on a dimensional ink-blue tile with transparent margins. The launcher installer uses the new 1024-pixel source to build native 16–1024-pixel ICNS representations; the existing project mark remains available.
- Student instructions explain pinning Nexus Server in the Dock and distinguish its shortcut from the separate browser window. This does not turn the launcher into a standalone native app or change its start/stop lifecycle.
- Verification: source is 1024×1024 RGBA with transparent corners. Native launcher migration, reinstall/custom destination and code-signature checks pass; PID ownership and kernel-lock safety checks pass. Backend/frontend runtime code is unchanged; required CI applies.

## First-time Terminal instructions, 19 October 2026

- Expanded the Intel/Ventura setup text and PDF for students with no coding experience: what Terminal and commands are, Spotlight and Finder launch routes, copy/paste and Return, the prompt, waiting for completion, handling errors and returning to the project folder another day.
- The setup PDF is now three pages with larger command text. README and Help describe the beginner route; the starting page links directly to the Terminal introduction and includes the project-folder command before later diagnostic/session-sheet commands.
- Verification: all three PDF pages rendered and visually checked; all command lines survive text extraction, six clickable links remain, and the production PDF asset matches its source. README/start-page local links resolve. Node 24 frontend lint, all 23 App tests and production build pass. Backend runtime code is unchanged; required CI still applies. No fresh Intel/Ventura installation or physical EEG test was performed.

## Student guide navigation, 19 October 2026

- Added `docs/student-start-here.md`: one route through Intel/Ventura installation, synthetic practice, first-week research, physical checks and the first experiment, with expected results and common recovery steps. All four student PDFs and both copyable setup/hardware guides are tracked in the public repository.
- README leads with the student starting page. In-app Help now bundles the hardware session packet alongside the other three PDFs, and includes first-session steps and offline troubleshooting. External research links still require internet; no standalone DMG is claimed.
- Review correction: the in-app recovery link uses the current origin, preserving a configured frontend port. Recovery wording distinguishes starting stopped services from reloading an already-running app.
- Verification: Node 24 frontend lint, all 110 tests and production build pass. All four development/production PDF assets match their tracked sources, and README/start-page local links resolve. The idle app Help view, expanding troubleshooting and opening the six-page hardware PDF in a separate tab were checked in the in-app browser at 1280×720; the README Help screenshot is refreshed. Backend runtime code is unchanged; required backend CI still applies. No physical-headset or independent Intel/Ventura test was performed.

## Ambient pad verification, 19 October 2026

- The Brain Pad is the Feedback Lab's **Ambient pad**. Regression tests reproduced stale-source playback, uncancellable pending starts, nonfinite-score gating, and an old sound's failed start disposing a newer engine. The fix requires fresh live source timestamps, a finite score, usable signal and at least 55% confidence. Calm audio checks both stream and calm-feature timestamps; intentionally selected saved replay remains supported and labelled.
- Mute is available while browser playback permission settles. Request ownership prevents late failures from altering a newer sound. Sound changes and view unmount dispose the old engine, and closed gates rapidly fade Web Audio or zero MP3 volume. Audio still starts muted and uses bundled media or local Web Audio only.
- The pad controls use a full-width mute button with separate volume and sound columns, preventing the labels and slider from colliding in a narrow desktop sidebar. The mobile single-column layout remains available.
- Source-level regression coverage includes both audio engines, missing/stale source timestamps, recovery, confidence threshold, noisy/nonfinite input, pending starts, voice changes and unmount cleanup. Browser checks on an isolated synthetic board verified Web Audio and MP3 start, mute and voice selection, then a paused test backend produced **Signal paused** and a closed audio gate despite the retained high-confidence score. No browser warnings/errors appeared. All six bundled feedback MP3s passed macOS decoder inspection. No physical-headset or subjective listening-quality claim is made.
- The default Calm mode was also checked end to end on synthetic data: three advancing usable source windows preceded a six-second baseline; the pad remained gated while a baseline was required and opened after completion. A review concern about nonfinite oscillator frequencies was checked against `clampUnit`'s existing finite guard. The AudioParam mock now rejects nonfinite values, and NaN/positive-infinity/negative-infinity cases pass without throwing.
- PRs #8 and #9 are merged after their findings were addressed, current-head reviews completed, all required checks passed, and the latest revisions had at least five minutes for review. The final #8 source head was `f080d1a`; its merge is `6dacb6e`. The Ambient pad fix is merged through PR #11 at `6fa356b`, also after clean review, passing checks and its five-minute hold. The combined frontend suite passes 110 tests with lint/build; backend CI passes 164 tests.
- The [DMG readiness proposal](https://github.com/zook111/Nexus_BCI/pull/10) records that the current Desktop app is a valid ad-hoc-signed source-checkout launcher, not a standalone installer. A distributable Intel app needs bundled runtime/static assets, writable per-user data paths, a verified x86_64 dependency/build environment, Developer ID signing and notarization. This Mac's current environment is ARM and no Developer ID Application identity is installed. No DMG, account change or public release was produced.

## macOS installer assessment, 19 October 2026

- [Standalone DMG readiness](docs/macos-installer-readiness.md) records the inspected launcher, signing state, native-architecture constraints, proposed bundle/lifecycle and acceptance checks. The existing launcher requires its source checkout, Python environment and Node/Vite dependencies; it is not a standalone installer.
- A distributable Intel bundle needs production UI assets served locally, bundled compatible Python/native dependencies, writable per-user data paths, verified x86_64 packaging, Developer ID signing and notarization. The current Mac/project environment is ARM and no Developer ID Application identity is installed. PyInstaller is not installed in the project environment.
- This is an inspected plan, not a built DMG, signed release, intended-machine test or account change. No distribution upload or security-policy bypass was performed. Continue using the source-install guide for the next physical session.

## Physical-session preparation, 17 October 2026

- Read-only reconciliation of PR #8: open at `831f5b85e0efd176e683c3a19a7c56d6e616a08e`; all three existing head checks pass and no unresolved review threads are present. GitHub's visible Codex summary covers the earlier `e3ba9c8`; the PR description records final-head CodeRabbit review with zero issues. No new review run or merge was performed. Main protection and the existing review/hold rules remain unchanged.
- Prepared a printable physical-session packet, copyable checklist, and blank local record sheet, linked from the README. The packet covers intended-machine setup, electrode/reference/bias fit, freshness and quality gates, separate eye-state training/test recordings, save/replay/persistence, and private outputs.
- Documentation checks passed: six rendered PDF pages inspected, 16 PDF URL links and two internal links checked, 26 relative Markdown links resolved, and ignored participant-output paths verified. Runtime checks were not rerun for documentation-only changes.
- PR #9 review correction: verify the saved rate, board, mains frequency, and channel list in Experiment Lab's visible Review labels metadata. Console replay verifies samples and navigation, but its header does not display sample rate. The source checklist, PDF, and blank record sheet use the observable checks.
- The blank sheet now links to the online packet and names the local offline PDF explicitly, so copying it into ignored session notes does not break its packet reference.
- The [durable readiness checkpoint](docs/checkpoints/2026-10-17-session-readiness.md) separates inspected software evidence from unexecuted physical and classifier checks. No servers, hardware acquisition, heavy test run, or remote-host work was started for this documentation preparation.
- Next dependency: Karl provides the intended Intel MacBook, fitted headset, and a participant/operator for the practical session. Independent Intel installation, stable physical EEG quality, usable independent recording pairs, and wearer-specific classifier performance remain unverified.

## Initial public release

- Visible app, browser and Doctor Demo title: **Dr K’s EEG Lab**, with “Explore signals. Run experiments. Learn the maths.” Nexus remains the project/repository and launcher name. Header and browser title were checked on desktop and a 375-pixel viewport, with no horizontal overflow or browser warnings.
- README leads with **Dr K’s EEG Lab** and refreshed Console, covariance-lesson and Help screenshots captured from the current app using simulated data. Repository/launcher references remain explicitly named Nexus.

- Clean source snapshot with no imported development Git history or participant data.
- Nexus console, quality/DSP controls, recording/replay, guided calibration and confidence-gated demos.
- Experiment Lab with labelled trials, separate training/test recordings and local pyRiemann classification.
- Interactive A-level maths lesson and a shareable student starter PDF with clickable public links.
- Three-page eyes-open/eyes-closed experiment PDF in `docs/`, linked from the README's top navigation and school-project section. The published guide includes reviewed local-mains-frequency instructions (50 Hz in the UK or 60 Hz where applicable), kept consistent across training and test.
- In-app Help tab provides bundled setup, eye-state experiment and first-week research PDFs, plus an online README link. Help works without a connected headset and preserves the existing interruption rules when leaving an active guided trial. Desktop/narrow-screen navigation and a PDF opening in a separate tab were checked; all three development/production PDF assets match their sources, and Vite continues blocking backend-file access.
- MIT-licensed software, project copyright notices, and documented permission to redistribute generated audio.
- Data/secret-safe ignores, contribution/security guidance and credential-scan CI.
- HTTP/WebSocket browser-origin guard preserving configured local clients and native clients without Origin.

## Verification

Clean Python 3.12 / Node 24 setup, backend Ruff and 161 tests, frontend lint and 84 tests, and production build pass in this public checkout. Native macOS launcher and credential-scan checks are recorded in the initial-release PR. The origin tests cover allowed local clients, rejected unrelated browser origins and prevention of board side effects. Review fixes preserve the final recording tail before Reset releases the board, capture per-experiment mains frequency for live/offline quality, and reconnect the live socket with bounded retries and cleanup. Further review fixes require advancing source timestamps throughout baseline capture and flush pending samples before assigning calibration marker indices. Recording initialization also rolls back metadata/worker failures for a safe retry, and custom launcher UI ports are propagated into the HTTP/WebSocket origin policy. The console displays recording failure messages beside its controls. Periodic storage failures stop recordings with an incomplete/error message, and atomic metadata replacement preserves previous valid JSON on write failure. API shutdown flushes/finalizes recordings and releases the native board; recording start excludes previously buffered samples. Experiment-linked recordings are protected from deletion, and experiment Save can recover finalized raw recordings after a transient annotation-write failure. Browser checks verified synthetic streaming and the lesson. All examples and screenshots use synthetic data.

## Intel Ventura compatibility check (10 October 2026)

- Node 24 publishes an Intel macOS 13.5 minimum; Ventura 13.7.8 meets it.
- Binary-only dependency resolution for Intel macOS 13 succeeds for Python 3.12 and 3.13: 86 distributions each, including development/build dependencies.
- BrainFlow 5.23.0 BoardController includes x86_64 with a macOS 10.13 target; the locked Rolldown 1.2.12 Intel binding targets macOS 10.12.
- README gives a Python 3.13 standard installer route, Intel Node selection and explicit interpreter command. This is compatibility evidence, not an Intel/Ventura runtime or headset test.

## Shared device state across browser windows (11 October 2026)

- Stream frames now include the same device status, serial port and EEG channel metadata as `/api/board`. A second window follows Connect, Start, Stop, Reset and native-session recovery without reloading, and idle frames preserve the user's next board selection.
- Released prepared sessions are reconciled before publishing a frame. A failed sample read returns a paused frame with current metadata. Stream recovery clears its own error message without clearing unrelated operation errors.
- CodeRabbit's committed review raised one minor port-selection issue. Successful prepared/streaming frames now synchronize selections, while error frames preserve the operator's selected port for recovery; a regression assertion reproduces and verifies that fix.
- Python 3.12 backend Ruff and 164 tests pass; Node 24 frontend lint, 88 tests and production build pass. Regression tests cover remote device transitions, optional legacy frames, malformed metadata and native loss before/after streaming.
- Two Chrome tabs at an isolated loopback test URL followed simulated Connect → Start → Stop → Reset without refreshing the observer. Device controls, DSP and quality updated together. No app console warnings/errors were observed; one unrelated Chrome extension emitted a search-engine error. Screenshots and test data remain outside the tracked source.
- No additional physical-headset test was performed. Stable electrode contact and a real eyes-open/closed recording still need a later hardware session. The hardware demo launcher was stopped for the night; the review does not certify EEG quality or classifier accuracy.
- PR #8 follow-up review: a shared transition into streaming now clears saved replay and its analysis, matching the local Start action. Repeated streaming frames preserve an intentionally opened replay. The regression test covers both paths.
- An observer now lists a shared session's active serial port even if the dongle appeared after that tab loaded. It is labelled as an active backend port without inventing a hardware recommendation; no extra connect action is issued.
- Session-only port options are removed on reset, error or port changes. Connect requires a currently listed selected port, so a removed fallback cannot silently remain connectable. Discovered ports and the operator's idle board choice remain intact.
- Exiting replay also invalidates pending preview/analysis requests. A late response or error cannot restore saved data or overwrite the live view after a shared start. Requests intentionally begun during a running stream remain supported.
- Shared and local resets now use the same feedback cleanup, clearing prior-session trends, baseline, DSP and quality state. A browser regression verifies the observer history is emptied rather than concatenated across sessions.
- Board snapshots carry a fresh connection identifier for each successful Connect, stable through Stop/Start and cleared on release. An observer detects a replacement even when a socket outage hid Reset/Connect and both visible statuses were streaming. A reconnect to the same connection preserves an intentionally opened replay; replacement resets live feedback and invalidates replay requests.
- First-frame lifecycle comparisons use the loaded REST board context, preserving intentionally opened replay and completed prepared-board baselines. Replacement interrupts active calibration synchronously; retained marker exports carry their original board/recording context and an interruption flag instead of mixing sessions.
- Live DSP, quality and calm readers restart on connection identity changes as well as status changes, cancelling old pending results and immediately requesting the replacement session's analysis.

## Known limits and next steps

- A two-page Intel/Ventura setup PDF and copyable text guide are available in `docs/`. Both pages were rendered and reviewed; six links and the installation command text were checked. The practice flow was followed in a browser: Record, Capture setup, Save and Preview, producing a synthetic session with 11,551 samples and one setup snapshot.
- GitHub `main` protection is active: PRs required for administrators too, Backend/Frontend/Tracked files and Git history checks required, conversations resolved, and force pushes/deletion disabled. No approving reviewer count is added; the existing five-minute review policy remains.

- Experiment-linked recordings are retained until linked experiment deletion is supported.
- Validate installation independently on Intel macOS and the physical Cyton/Cyton Daisy setup.
- Collect separate participant recordings before reporting classifier performance; synthetic results are rehearsal.
- Keep services on loopback. Origin checks are not user authentication or protection against untrusted local processes.
- Maintain a single reviewed source and publish future changes through this repository's PR process.
- Preserve participant-data exclusion, media provenance and copyright notices on future releases.
