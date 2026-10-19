#!/usr/bin/env python3
"""Offered source updates. All installation callers must hold the launcher lock."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path

EXPECTED_REMOTE = "https://github.com/zook111/Nexus_BCI.git"
SHA = re.compile(r"[0-9a-f]{40}")
IDENTIFIER = re.compile(r"[0-9a-f]{32}")
PHASES = {
    "prepared",
    "moving_venv",
    "moving_modules",
    "checkout",
    "installing",
    "starting",
    "healthy",
}
PROTECTED = {".git", ".venv", ".env", "recordings", "data", "exports", "node_modules"}


class UpdateError(RuntimeError):
    """Cannot update safely. Keep the installation stopped if recovery is pending."""


class RestoredUpdate(UpdateError):
    """An update failed, but the previous installation was restored and started."""


class Updater:
    def __init__(self, root: Path, state: Path):
        self.root = root.resolve()
        self.state = (
            state / "updates" / hashlib.sha256(os.fsencode(self.root)).hexdigest()[:20]
        )
        self.journal = self.state / "transaction.json"
        self.previous = self.state / "previous.json"

    def git(self, *args: str) -> str:
        try:
            result = subprocess.run(
                ["git", "-c", "core.hooksPath=/dev/null", "-C", str(self.root), *args],
                text=True,
                capture_output=True,
                timeout=90,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                check=True,
            )
            return result.stdout.strip()
        except (subprocess.SubprocessError, OSError) as exc:
            # Do not put arbitrary Git stderr/credential-helper output into GUI messages.
            raise UpdateError(
                "Git could not complete the update check. No source changes were discarded."
            ) from exc

    def validate(self) -> str:
        if self.git("rev-parse", "--show-toplevel") != str(self.root):
            raise UpdateError(
                "This is not the original project folder. Ask your helper."
            )
        if self.git("symbolic-ref", "--quiet", "--short", "HEAD") != "main":
            raise UpdateError(
                "Updates require the main branch. Your code was left unchanged; ask your helper."
            )
        if self.git("remote", "get-url", "origin").rstrip("/") != EXPECTED_REMOTE:
            raise UpdateError(
                "This folder uses a different download source. Ask your helper."
            )
        if self.git("status", "--porcelain=v1", "--untracked-files=all"):
            raise UpdateError(
                "This folder contains local code edits or extra files. They were preserved; ask your helper before updating."
            )
        return self.git("rev-parse", "HEAD")

    def fetch_target(self, target: str) -> str:
        if not SHA.fullmatch(target):
            raise UpdateError("The offered version is invalid.")
        old = self.validate()
        self.git("fetch", "--no-tags", "--no-recurse-submodules", "origin", target)
        if self.git("rev-parse", "FETCH_HEAD") != target:
            raise UpdateError("The downloaded version does not match the update offer.")
        self.git("merge-base", "--is-ancestor", old, target)
        self.validate()  # Recheck after network activity, before any dependency move.
        for name in self.git("ls-tree", "-r", "--name-only", target).splitlines():
            parts = Path(name).parts
            if any(p in PROTECTED or p.startswith(".env.") for p in parts):
                raise UpdateError(
                    "The update contains a protected local-data path. Nothing was installed."
                )
            candidate = self.root / name
            for parent in [candidate, *candidate.parents]:
                if parent == self.root:
                    break
                if parent.is_symlink():
                    raise UpdateError(
                        "A local symbolic link conflicts with the update. Ask your helper."
                    )
            if candidate.exists():
                check = subprocess.run(
                    [
                        "git",
                        "-C",
                        str(self.root),
                        "check-ignore",
                        "--quiet",
                        "--",
                        name,
                    ],
                    check=False,
                )
                if check.returncode == 0:
                    raise UpdateError(
                        "The update would replace a local ignored file. Your files were preserved."
                    )
                if check.returncode != 1:
                    raise UpdateError("Could not check local file conflicts.")
        return old

    def backup(self, journal: dict) -> Path:
        if not IDENTIFIER.fullmatch(str(journal.get("id", ""))):
            raise UpdateError(
                "Update recovery information is invalid. Ask your helper; backups were retained."
            )
        path = self.state / journal["id"]
        if path.is_symlink():
            raise UpdateError("Update backup path is not safe. Ask your helper.")
        return path

    def write_json(self, path: Path, data: dict) -> None:
        temporary = path.with_suffix(".tmp")
        with temporary.open("w") as file:
            json.dump(data, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)

    def write_journal(self, journal: dict) -> None:
        self.write_json(self.journal, journal)

    def read_journal(self) -> dict:
        try:
            journal = json.loads(self.journal.read_text())
            valid = (
                isinstance(journal, dict)
                and journal.get("root") == str(self.root)
                and SHA.fullmatch(str(journal.get("old", "")))
                and SHA.fullmatch(str(journal.get("target", "")))
                and journal.get("phase") in PHASES
                and type(journal.get("had_venv")) is bool
                and type(journal.get("had_modules")) is bool
            )
            if not valid:
                raise ValueError("invalid journal")
            self.backup(journal)
            return journal
        except (ValueError, OSError, TypeError) as exc:
            raise UpdateError(
                "Update recovery information could not be verified. Ask your helper; backups were retained."
            ) from exc

    def begin(self, target: str) -> dict:
        if self.journal.exists():
            raise UpdateError("An interrupted update must be recovered first.")
        old = self.fetch_target(target)
        for path in [self.root / ".venv", self.root / "frontend/node_modules"]:
            if path.is_symlink() or (path.exists() and not path.is_dir()):
                raise UpdateError(
                    "A dependency folder uses an unsupported layout. Ask your helper."
                )
        self.state.mkdir(parents=True, exist_ok=True)
        if self.root.stat().st_dev != self.state.stat().st_dev:
            raise UpdateError(
                "The project and update backups must be on the same disk. Ask your helper."
            )
        size = sum(
            p.stat().st_size
            for folder in [".venv", "frontend/node_modules"]
            for p in (self.root / folder).rglob("*")
            if p.is_file() and not p.is_symlink()
        )
        if shutil.disk_usage(self.root).free < max(512 * 1024**2, size * 2):
            raise UpdateError(
                "There is not enough free disk space to keep a recovery copy. Free some space and try later."
            )
        journal = {
            "id": uuid.uuid4().hex,
            "root": str(self.root),
            "old": old,
            "target": target,
            "had_venv": (self.root / ".venv").exists(),
            "had_modules": (self.root / "frontend/node_modules").exists(),
            "phase": "prepared",
        }
        self.backup(journal).mkdir()
        self.git("update-ref", f"refs/nexus/update-backups/{journal['id']}", old)
        self.write_journal(journal)
        return journal

    @staticmethod
    def remove_generated(path: Path) -> None:
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise UpdateError(
                "A dependency folder changed unexpectedly. It was not removed; ask your helper."
            )
        if path.exists():
            shutil.rmtree(path)

    def restore(self, journal: dict) -> None:
        if self.git("symbolic-ref", "--quiet", "--short", "HEAD") != "main":
            raise UpdateError(
                "The project branch changed during the update. Backups were retained."
            )
        if self.git("rev-parse", "HEAD") not in {journal["old"], journal["target"]}:
            raise UpdateError(
                "The project revision changed unexpectedly. Backups were retained."
            )
        if self.git("diff", "--name-only") or self.git(
            "diff", "--cached", "--name-only"
        ):
            raise UpdateError(
                "Code was edited during installation. Those edits and backups were retained; ask your helper."
            )
        self.git("reset", "--keep", journal["old"])
        pairs = [
            ("venv", self.root / ".venv", "had_venv"),
            ("modules", self.root / "frontend/node_modules", "had_modules"),
        ]
        for name, destination, had_key in pairs:
            if journal.get("restored_" + name) is True:
                if destination.is_symlink() or (
                    journal[had_key] and not destination.is_dir()
                ):
                    raise UpdateError(
                        "A restored dependency path changed. Ask your helper."
                    )
                continue
            saved = self.backup(journal) / name
            if saved.is_symlink():
                raise UpdateError(
                    "A saved dependency path is not safe. Backups were retained."
                )
            if saved.exists():
                self.remove_generated(destination)
                destination.parent.mkdir(parents=True, exist_ok=True)
                saved.rename(destination)
            elif not journal[had_key] and journal["phase"] in {
                "installing",
                "starting",
                "healthy",
            }:
                self.remove_generated(destination)
            elif journal[had_key]:
                before_move = (
                    {"prepared", "moving_venv"}
                    if name == "venv"
                    else {"prepared", "moving_venv", "moving_modules"}
                )
                if (
                    journal["phase"] not in before_move
                    or not destination.is_dir()
                    or destination.is_symlink()
                ):
                    raise UpdateError(
                        "A dependency backup is missing. Ask your helper; recovery information was retained."
                    )
            journal["restored_" + name] = True
            self.write_journal(journal)
        self.journal.unlink()

    def recover(self, *, start: Callable, stop: Callable) -> None:
        if not self.journal.exists():
            return
        journal = self.read_journal()
        stop()
        self.restore(journal)
        start()

    def install(
        self, target: str, *, prepare: Callable, start: Callable, stop: Callable
    ) -> None:
        journal = self.begin(target)
        try:
            for name, source, phase in [
                ("venv", self.root / ".venv", "moving_venv"),
                ("modules", self.root / "frontend/node_modules", "moving_modules"),
            ]:
                journal["phase"] = phase
                self.write_journal(journal)
                if source.exists():
                    source.rename(self.backup(journal) / name)
            journal["phase"] = "checkout"
            self.write_journal(journal)
            self.validate()
            self.git("merge", "--ff-only", "--no-overwrite-ignore", target)
            journal["phase"] = "installing"
            self.write_journal(journal)
            prepare()
            self.validate()
            journal["phase"] = "starting"
            self.write_journal(journal)
            start()
            journal["phase"] = "healthy"
            self.write_journal(journal)
            previous = None
            if self.previous.exists():
                try:
                    previous = json.loads(self.previous.read_text())
                except (ValueError, OSError):
                    pass
            self.write_json(self.previous, journal)
            self.journal.unlink()
        except Exception as exc:
            try:
                stop()
                self.restore(journal)
                start()
            except Exception as recovery_exc:
                raise UpdateError(
                    "Update could not finish or safely restore the previous version. The app is stopped; ask your helper. Local backups and recordings were retained."
                ) from recovery_exc
            raise RestoredUpdate(
                "The update could not finish. The previous version was restored and opened; try again later."
            ) from exc
        if isinstance(previous, dict) and previous.get("id") != journal["id"]:
            # Only prune a validated updater-owned backup directory.
            try:
                old_backup = self.backup(previous)
                if old_backup.is_dir():
                    shutil.rmtree(old_backup)
            except (UpdateError, OSError):
                pass  # Cleanup failure cannot undo a healthy installation.


def latest_commit() -> str:
    """Use macOS TLS trust, without Python certificate setup or GitHub credentials."""
    result = subprocess.run(
        [
            "/usr/bin/curl",
            "-q",
            "--fail",
            "--silent",
            "--connect-timeout",
            "2",
            "--max-time",
            "3",
            "--max-filesize",
            "65536",
            "https://api.github.com/repos/zook111/Nexus_BCI/git/ref/heads/main",
        ],
        text=True,
        capture_output=True,
        timeout=5,
        check=True,
    )
    data = json.loads(result.stdout)
    obj = data.get("object") if isinstance(data, dict) else None
    target = obj.get("sha") if isinstance(obj, dict) else None
    if not isinstance(target, str) or not SHA.fullmatch(target):
        raise UpdateError("The update service returned an invalid version.")
    return target


def ensure_stopped(root: Path, state: Path) -> None:
    """Fail closed for live PID records, occupied ports and manual project servers."""
    for name in ["backend.pid", "frontend.pid"]:
        path = state / name
        if path.exists():
            try:
                pid = int(path.read_text().splitlines()[0])
                if pid <= 0:
                    raise ValueError("invalid PID")
                os.kill(pid, 0)
            except ProcessLookupError:
                continue
            except (ValueError, OSError, IndexError) as exc:
                raise UpdateError(
                    "The app process state is unclear. Stop Nexus Server and ask your helper."
                ) from exc
            raise UpdateError(
                "Nexus is still running. Save your work and stop it before updating."
            )
    for key, default in [
        ("MINDMELD_BACKEND_PORT", "8000"),
        ("MINDMELD_FRONTEND_PORT", "5173"),
    ]:
        try:
            port = int(os.environ.get(key, default))
            if not 1 <= port <= 65535:
                raise ValueError("invalid port")
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                raise UpdateError(
                    "An app is using a required port. Stop it before updating; no process was terminated."
                )
        except (ConnectionRefusedError, TimeoutError):
            pass
        except ValueError as exc:
            raise UpdateError("The configured app port is invalid.") from exc
    try:
        processes = subprocess.run(
            ["ps", "-axo", "command="],
            text=True,
            capture_output=True,
            check=True,
            timeout=5,
        ).stdout
    except (subprocess.SubprocessError, OSError) as exc:
        raise UpdateError(
            "Could not verify that project services are stopped."
        ) from exc
    for command in processes.splitlines():
        if str(root) in command and any(
            name in command for name in ["uvicorn", "fastapi", "/vite/bin/vite"]
        ):
            raise UpdateError(
                "A manually started project service is running. Ask your helper to stop it before updating."
            )


def offer_version(current: str, target: str) -> bool:
    message = (
        f"A newer version of Dr K’s EEG Lab is available.\n\n"
        f"Installed: {current[:8]}\nUpdate: {target[:8]}\n\n"
        "Update and restart installs the app and guides, then opens the workspace. "
        "This can take several minutes. Keep the Mac awake and connected to the internet. "
        "Your recordings and local settings stay in place. Not now opens your current version."
    )
    script = """on run argv
set answer to display dialog (item 1 of argv) with title "EEG Lab updates" buttons {"Not now", "Update and restart"} default button "Update and restart" cancel button "Not now"
return button returned of answer
end run"""
    try:
        result = subprocess.run(
            ["/usr/bin/osascript", "-e", script, message],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode == 0 and result.stdout.strip() == "Update and restart"
    except OSError:
        return False


def show_message(message: str, *, error: bool = False) -> None:
    script = """on run argv
 display dialog (item 1 of argv) with title "EEG Lab updates" buttons {"OK"} default button "OK"
end run"""
    if not error:
        script = """on run argv
 display notification (item 1 of argv) with title "EEG Lab updates"
end run"""
    try:
        subprocess.run(
            ["/usr/bin/osascript", "-e", script, message],
            capture_output=True,
            check=False,
            timeout=120 if error else 5,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def startup(updater: Updater, launcher: Path, *, offer: Callable | None = None) -> int:
    if updater.journal.exists():
        ensure_stopped(updater.root, launcher_state())
        return run_worker(updater, launcher, "recover")
    if os.environ.get("NEXUS_CHECK_UPDATES") != "1":
        return 0
    try:
        current = updater.validate()
        target = latest_commit()
        if target == current:
            return 0
        ensure_stopped(updater.root, launcher_state())
    except (UpdateError, OSError, ValueError, subprocess.SubprocessError):
        # A failed automatic check must not prevent an offline/current-version launch.
        return 0
    if not (offer or offer_version)(current, target):
        return 0
    show_message(
        "Installing the update. Please wait; the workspace opens when it is ready."
    )
    return run_worker(updater, launcher, target)


def launcher_state() -> Path:
    return (
        Path(
            os.environ.get(
                "MINDMELD_LAUNCHER_STATE_DIR",
                str(Path.home() / "Library/Application Support/Mindmeld Launcher"),
            )
        )
        .expanduser()
        .absolute()
    )


def run_worker(updater: Updater, launcher: Path, target: str) -> int:
    # The copied worker and base interpreter remain valid when Git and .venv change.
    with tempfile.TemporaryDirectory(prefix="eeg-lab-update-") as temporary:
        worker = Path(temporary) / "student_updates.py"
        shutil.copy2(__file__, worker)
        command = [
            sys._base_executable,
            str(worker),
            "--worker",
            "--root",
            str(updater.root),
            "--launcher",
            str(launcher),
            "--target",
            target,
        ]
        try:
            return subprocess.run(command, cwd=updater.root, check=False).returncode
        except OSError as exc:
            raise UpdateError(
                "Could not start the updater. Nothing was installed."
            ) from exc


def worker_run(updater: Updater, launcher: Path, target: str) -> int:
    ensure_stopped(updater.root, launcher_state())
    updater.state.mkdir(parents=True, exist_ok=True)
    log_path = updater.state / "update.log"
    environment = {
        **os.environ,
        "NEXUS_UPDATE_WORKER": "1",
        "NEXUS_CHECK_UPDATES": "0",
        "MINDMELD_OPEN_BROWSER": "0",
        "NEXUS_PYTHON": sys._base_executable,
    }
    desktop_app = os.environ.get("MINDMELD_DESKTOP_APP")
    if desktop_app:
        app_path = Path(desktop_app).expanduser().absolute()
        if app_path.suffix != ".app" or not app_path.is_dir():
            raise UpdateError(
                "The installed Desktop shortcut could not be identified. Ask your helper."
            )
        environment["MINDMELD_DESKTOP_APP"] = str(app_path)
        environment["MINDMELD_REVEAL_LAUNCHER"] = "0"
    # The launcher exports its selected Node directory before calling the worker.
    node = shutil.which("node", path=environment.get("PATH"))
    if not node:
        raise UpdateError("Node is missing. Ask your helper; nothing was installed.")
    supported = subprocess.run(
        [
            node,
            "-e",
            'const [a,b]=process.versions.node.split(".").map(Number); process.exit(!((a===20&&b>=19)||(a===22&&b>=13)||(a>=24&&a%2===0)))',
        ],
        check=False,
    )
    if supported.returncode or not shutil.which("npm", path=environment.get("PATH")):
        raise UpdateError(
            "A supported Node/npm installation is required. Ask your helper."
        )

    def step(label: str, args: list[str], timeout: int = 900) -> None:
        # Record stages/exit codes only, not command output or environment credentials.
        with log_path.open("a") as log:
            log.write(label + "\n")
        try:
            result = subprocess.run(
                args,
                cwd=updater.root,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=timeout,
            )
            with log_path.open("a") as log:
                log.write(f"{label}: exit {result.returncode}\n")
            if result.returncode:
                raise UpdateError(
                    label
                    + " failed. Ask your helper to check installation prerequisites."
                )
        except (OSError, subprocess.SubprocessError) as exc:
            raise UpdateError(label + " could not finish.") from exc

    def start():
        if desktop_app:
            step(
                "Refreshing the Desktop shortcut",
                ["/bin/bash", str(updater.root / "script/install_desktop_launcher.sh")],
                120,
            )
        step(
            "Starting local services",
            ["/bin/bash", str(launcher), "--locked-start_services"],
            120,
        )
        step("Checking local services", ["/bin/bash", str(launcher), "--verify"], 20)

    def stop():
        step(
            "Stopping this attempt",
            ["/bin/bash", str(launcher), "--locked-stop_services"],
            30,
        )

    try:
        if target == "recover":
            updater.recover(start=start, stop=stop)
            show_message("The previous version was recovered and opened.")
        else:
            updater.install(
                target,
                prepare=lambda: step(
                    "Installing dependencies",
                    ["/bin/bash", str(updater.root / "script/setup.sh")],
                ),
                start=start,
                stop=stop,
            )
            show_message("EEG Lab and its guides are updated. Opening the workspace.")
        return 20
    except RestoredUpdate as exc:
        show_message(str(exc), error=True)
        return 20
    except Exception as exc:  # noqa: BLE001 -- native UI boundary must fail closed.
        if updater.journal.exists():
            try:
                stop()
            except UpdateError:
                pass
            show_message(
                "The update needs help to recover. Keep the app stopped and ask your helper. Recordings and recovery copies were retained.",
                error=True,
            )
            return 1
        show_message(
            str(exc)
            if isinstance(exc, UpdateError)
            else "The update was postponed. Ask your helper.",
            error=True,
        )
        return 0


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--launcher", type=Path, required=True)
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--target")
    arguments = parser.parse_args()
    updater = Updater(arguments.root, launcher_state())
    try:
        if arguments.worker:
            return worker_run(updater, arguments.launcher, arguments.target)
        return startup(updater, arguments.launcher)
    except (UpdateError, OSError, ValueError, subprocess.SubprocessError):
        show_message(
            "EEG Lab could not verify update recovery. Ask your helper before starting the app. No local files were discarded.",
            error=True,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
