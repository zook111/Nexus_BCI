"""Updater safety tests use real temporary Git repositories; no real checkout is updated."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

SOURCE = Path(__file__).with_name("student_updates.py")


def module():
    assert SOURCE.exists(), "student updater has not been implemented"
    spec = importlib.util.spec_from_file_location("student_updates_under_test", SOURCE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


@pytest.fixture
def project(tmp_path, monkeypatch):
    m = module()
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "--bare", str(remote))
    root = tmp_path / "student project"
    git(tmp_path, "clone", str(remote), str(root))
    git(root, "config", "user.name", "Fixture")
    git(root, "config", "user.email", "fixture@example.invalid")
    git(root, "checkout", "-b", "main")
    (root / ".gitignore").write_text(
        ".venv/\nfrontend/node_modules/\nrecordings/\ndata/\n.env\n*.csv\n"
    )
    (root / "app.txt").write_text("old")
    git(root, "add", ".")
    git(root, "commit", "-m", "old")
    git(root, "push", "-u", "origin", "main")
    old = git(root, "rev-parse", "HEAD")
    other = tmp_path / "maintainer"
    git(tmp_path, "clone", "--branch", "main", str(remote), str(other))
    git(other, "config", "user.name", "Fixture")
    git(other, "config", "user.email", "fixture@example.invalid")
    (other / "app.txt").write_text("new")
    git(other, "add", ".")
    git(other, "commit", "-m", "new")
    git(other, "push")
    target = git(other, "rev-parse", "HEAD")
    for folder in [".venv", "frontend/node_modules", "recordings", "data"]:
        (root / folder).mkdir(parents=True)
        (root / folder / "sentinel").write_text(
            "private" if folder in ["recordings", "data"] else "old"
        )
    (root / ".env").write_text("PRIVATE_SETTING=local")
    monkeypatch.setattr(m, "EXPECTED_REMOTE", str(remote))
    u = m.Updater(root, tmp_path / "state")
    return m, u, root, other, old, target


def prepare_new(root):
    for p in [root / ".venv", root / "frontend/node_modules"]:
        p.mkdir(parents=True)
        (p / "sentinel").write_text("new")


def assert_private(root):
    assert (root / "recordings/sentinel").read_text() == "private"
    assert (root / "data/sentinel").read_text() == "private"
    assert (root / ".env").read_text() == "PRIVATE_SETTING=local"


def test_fast_forward_preserves_data_and_backups(project):
    _, u, root, _, old, target = project
    started = []
    u.install(
        target,
        prepare=lambda: prepare_new(root),
        start=lambda: started.append("start"),
        stop=lambda: None,
    )
    assert git(root, "rev-parse", "HEAD") == target
    assert started == ["start"]
    assert (root / ".venv/sentinel").read_text() == "new"
    previous = json.loads(u.previous.read_text())
    assert previous["old"] == old
    assert (u.backup(previous) / "venv/sentinel").read_text() == "old"
    assert not u.journal.exists()
    assert_private(root)


@pytest.mark.parametrize(
    "conflict",
    ["tracked", "untracked", "branch", "detached", "diverged", "wrong_remote"],
)
def test_refuses_local_source_conflicts(project, conflict):
    m, u, root, _, old, target = project
    if conflict == "tracked":
        (root / "app.txt").write_text("my edit")
    elif conflict == "untracked":
        (root / "notes.txt").write_text("my work")
    elif conflict == "branch":
        git(root, "checkout", "-b", "my-project")
    elif conflict == "detached":
        git(root, "checkout", "--detach")
    elif conflict == "diverged":
        (root / "app.txt").write_text("local commit")
        git(root, "commit", "-am", "local")
        old = git(root, "rev-parse", "HEAD")
    else:
        git(root, "remote", "set-url", "origin", "https://example.invalid/other.git")
    with pytest.raises(m.UpdateError):
        u.install(
            target,
            prepare=lambda: pytest.fail("must not install"),
            start=lambda: None,
            stop=lambda: None,
        )
    assert git(root, "rev-parse", "HEAD") == old
    assert (root / ".venv/sentinel").read_text() == "old"
    assert_private(root)


def test_refuses_ignored_file_collision(project):
    m, u, root, other, old, _ = project
    (root / "results.csv").write_text("private local data")
    (other / "results.csv").write_text("upstream data")
    git(other, "add", "-f", "results.csv")
    git(other, "commit", "-m", "new ignored path")
    git(other, "push")
    with pytest.raises(m.UpdateError):
        u.install(
            git(other, "rev-parse", "HEAD"),
            prepare=lambda: None,
            start=lambda: None,
            stop=lambda: None,
        )
    assert git(root, "rev-parse", "HEAD") == old
    assert (root / "results.csv").read_text() == "private local data"


def test_refuses_incoming_participant_directory_even_when_absent(project):
    m, u, root, other, old, _ = project
    (other / "recordings").mkdir()
    (other / "recordings/new.txt").write_text("not allowed")
    git(other, "add", "-f", "recordings/new.txt")
    git(other, "commit", "-m", "unsafe incoming path")
    git(other, "push")
    with pytest.raises(m.UpdateError):
        u.install(
            git(other, "rev-parse", "HEAD"),
            prepare=lambda: None,
            start=lambda: None,
            stop=lambda: None,
        )
    assert git(root, "rev-parse", "HEAD") == old
    assert_private(root)


@pytest.mark.parametrize("stage", ["prepare", "start"])
def test_failure_restores_old_code_and_dependencies(project, stage):
    m, u, root, _, old, target = project
    starts = []
    stops = []

    def prep():
        prepare_new(root)
        if stage == "prepare":
            raise RuntimeError("download interrupted")

    def start():
        starts.append(git(root, "rev-parse", "HEAD"))
        if stage == "start" and starts[-1] == target:
            raise RuntimeError("readiness failed")

    with pytest.raises(m.RestoredUpdate):
        u.install(target, prepare=prep, start=start, stop=lambda: stops.append(True))
    assert git(root, "rev-parse", "HEAD") == old
    assert starts[-1] == old
    assert stops == [True]
    assert not u.journal.exists()
    for p in [".venv/sentinel", "frontend/node_modules/sentinel"]:
        assert (root / p).read_text() == "old"
    assert_private(root)


@pytest.mark.parametrize("moved", [0, 1, 2])
def test_recovers_interruption_after_partial_dependency_backup(project, moved):
    _, u, root, _, old, target = project
    j = u.begin(target)
    paths = [
        (root / ".venv", u.backup(j) / "venv"),
        (root / "frontend/node_modules", u.backup(j) / "modules"),
    ]
    for index, (source, destination) in enumerate(paths[:moved]):
        j["phase"] = ["moving_venv", "moving_modules"][index]
        u.write_journal(j)
        source.rename(destination)
    started = []
    u.recover(
        start=lambda: started.append(git(root, "rev-parse", "HEAD")), stop=lambda: None
    )
    assert started == [old]
    for p in [".venv/sentinel", "frontend/node_modules/sentinel"]:
        assert (root / p).read_text() == "old"
    assert_private(root)


def test_invalid_journal_cannot_remove_arbitrary_files(project, tmp_path):
    m, u, root, _, _, target = project
    j = u.begin(target)
    j["id"] = "../outside"
    u.journal.write_text(json.dumps(j))
    with pytest.raises(m.UpdateError):
        u.recover(start=lambda: pytest.fail("not safe"), stop=lambda: None)
    assert (root / ".venv/sentinel").read_text() == "old"
    assert_private(root)


def test_keeps_edit_made_during_failed_install(project):
    m, u, root, _, _, target = project

    def prep():
        prepare_new(root)
        (root / "app.txt").write_text("edit while installing")
        raise RuntimeError("install failed")

    with pytest.raises(m.UpdateError):
        u.install(target, prepare=prep, start=lambda: None, stop=lambda: None)
    assert (root / "app.txt").read_text() == "edit while installing"
    assert u.journal.exists()
    assert_private(root)


def test_missing_backup_is_not_mistaken_for_restored_dependencies(project):
    m, u, root, _, _, target = project
    j = u.begin(target)
    j["phase"] = "installing"
    u.write_journal(j)
    git(root, "merge", "--ff-only", target)
    # A lost backup and an existing dependency directory do not prove it is the original one.
    with pytest.raises(m.UpdateError):
        u.recover(
            start=lambda: pytest.fail("must not claim recovery"), stop=lambda: None
        )
    assert u.journal.exists()
    assert_private(root)
