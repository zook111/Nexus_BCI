# Student updates implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer safe student updates through the Mac Desktop launcher without Terminal or Git commands.

**Architecture:** A standard-library Python updater checks the protected public main branch before launcher startup. Installation runs from a stable temporary copy under the existing launcher lock, with a journal and dependency backups; no HTTP installation route is added.

**Tech Stack:** Python 3.12+, Git, Bash, AppleScript, existing FastAPI/Vite launcher.

**Spec:** `docs/superpowers/specs/2026-10-19-student-updates-design.md`

## Global constraints

- Source is https://github.com/zook111/Nexus_BCI and protected main; install the offered commit by fast-forward only.
- Updates require services stopped, configured ports free and no conflicting source changes. Recordings/settings remain untouched.
- Offline checks do not prevent ordinary startup. Installation is offered, never silent.
- Preserve existing launcher stop semantics and PID/kernel-lock safeguards. No new network service or credential requirement.
- Use existing compatible Python/Node tools; keep native verification on the Mac. Submit a reviewed PR with attribution in commit history to zook111.

## Review focus

- Local edits/untracked/ignored collisions must never be discarded, including changes between offer and installation.
- Failures after only one dependency directory moved must restore exactly the original paths.
- Crash journals and backup paths must be validated before any filesystem deletion or recovery.
- GUI launches have a minimal PATH; find the supported installed Python/Node and retain custom ports.
- A second launch or unmanaged service must not start halfway through replacement.

### Task 1: Source validation and transaction core

**Files:** create `script/student_updates.py`, `script/test_student_updates.py`.

**Interfaces:** `Updater(root: Path, state: Path)` validates the repository; `install(target: str, prepare: Callable, start: Callable, stop: Callable)` owns backups/journal/rollback; `recover(start: Callable, stop: Callable)` reconciles an unfinished journal. CLI uses only the fixed public source; tests use isolated real Git remotes by patching the fixed remote constant.

- [ ] Write tests using temporary repositories for clean fast-forward, local edits, divergence, wrong remote, ignored/untracked collision, sentinel data preservation, ordinary rollback and interruption after each directory move.
- [ ] Run `pytest script/test_student_updates.py`; expect missing updater implementation to fail the behavioural assertions.
- [ ] Implement the validation and transaction core. Atomic journal replacement records original/target commits and dependency existence; derive backup locations from a validated transaction ID. Never hard-reset/clean/stash.
- [ ] Run the tests and Ruff on the new Python files; expect passing results.
- [ ] Commit the tested core.

### Task 2: Native offer and launcher integration

**Files:** modify `script/student_updates.py`, `script/build_and_run.sh`, `script/install_desktop_launcher.sh`, `script/test_desktop_launcher.sh`, `script/test_launcher_install.sh`; extend `script/test_student_updates.py`.

**Interfaces:** GUI launcher sets `NEXUS_CHECK_UPDATES=1`; locked startup calls the updater using the existing environment's base Python. Exit 0 continues normal startup, exit 20 means the updater already started and verified the app, any other result stops startup. Worker start/stop callbacks invoke existing locked actions with update checks disabled.

- [ ] Add failing tests for offline/declined offers, latest-commit validation, GUI argument escaping, base-interpreter/Node discovery, live PID/occupied-port refusal and child-worker exit handling.
- [ ] Implement the short-timeout update check, native offer, stable copied worker and subprocess log routing. Journal recovery precedes any offer. Validate Python/Node and disk capacity before mutation; preserve configured ports and environment.
- [ ] Integrate the offer only in GUI startup, never the running-app stop path. Keep startup and update under the same kernel lock. Escape launcher paths in AppleScript.
- [ ] Run Python tests and native launcher/install tests, including paths with spaces/quotes; expect passing results. Commit.

### Task 3: Student instructions and release verification

**Files:** modify README, student starting page, Intel setup Markdown/PDF, Help text, project_status and CI to run updater tests.

- [ ] Document Update and restart, Not now, offline use, save/stop/open sequence, progress/error logs and the one-time bootstrap for pre-updater installations. Distinguish the source updater from a standalone DMG.
- [ ] Regenerate and render the setup PDF; verify links, commands, page count and matching production asset.
- [ ] Run updater suite, backend Ruff/full tests, frontend lint/full tests/build and native packaging/launcher checks. Run an isolated fake-remote update/rollback through the GUI-control boundary without touching participant data or the real checkout.
- [ ] Obtain one fresh whole-branch review as required by executing-plans; address findings and GitHub review comments. Update project status and open the implementation PR ready for review.
- [ ] Require passing current-head checks, resolved comments and at least five minutes from the latest revision; recheck and merge under the existing authorization. Do not claim independent Intel or real EEG verification.
