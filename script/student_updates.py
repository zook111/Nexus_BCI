#!/usr/bin/env python3
"""Offered source updates. All installation callers must hold the launcher lock."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
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
        if isinstance(previous, dict) and previous.get("id") != journal["id"]:
            # Only prune a validated updater-owned backup directory.
            try:
                old_backup = self.backup(previous)
                if old_backup.is_dir():
                    shutil.rmtree(old_backup)
            except (UpdateError, OSError):
                pass  # Cleanup failure cannot undo a healthy installation.
