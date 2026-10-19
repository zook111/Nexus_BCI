"""Updater safety tests use real temporary Git repositories; no real checkout is updated."""

from __future__ import annotations

import importlib.util
import json
import shlex
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


def test_offline_offer_keeps_existing_app_usable(project, monkeypatch):
    m, u, root, _, old, _ = project
    monkeypatch.setenv("NEXUS_CHECK_UPDATES", "1")
    monkeypatch.setattr(
        m, "latest_commit", lambda: (_ for _ in ()).throw(OSError("offline"))
    )
    assert (
        m.startup(
            u,
            root / "script/build_and_run.sh",
            offer=lambda *_: pytest.fail("no offer offline"),
        )
        == 0
    )
    assert git(root, "rev-parse", "HEAD") == old
    assert_private(root)


def test_declining_offer_does_not_install(project, monkeypatch):
    m, u, root, _, old, target = project
    monkeypatch.setenv("NEXUS_CHECK_UPDATES", "1")
    monkeypatch.setattr(m, "latest_commit", lambda: target)
    monkeypatch.setattr(m, "ensure_stopped", lambda *_: None)
    offers = []
    assert (
        m.startup(u, root / "launcher", offer=lambda *a: offers.append(a) or False) == 0
    )
    assert offers == [(old, target)]
    assert git(root, "rev-parse", "HEAD") == old
    assert_private(root)


def test_non_gui_start_does_not_check_network(project, monkeypatch):
    m, u, root, _, _, _ = project
    monkeypatch.delenv("NEXUS_CHECK_UPDATES", raising=False)
    monkeypatch.setattr(
        m, "latest_commit", lambda: pytest.fail("CLI start should not check")
    )
    assert m.startup(u, root / "launcher") == 0


def test_offer_runs_stable_worker_and_forwards_started_exit(project, monkeypatch):
    m, u, root, _, _, target = project
    monkeypatch.setenv("NEXUS_CHECK_UPDATES", "1")
    monkeypatch.setattr(m, "latest_commit", lambda: target)
    monkeypatch.setattr(m, "ensure_stopped", lambda *_: None)
    calls = []
    monkeypatch.setattr(m, "run_worker", lambda *a: calls.append(a) or 20)
    assert m.startup(u, root / "launcher", offer=lambda *_: True) == 20
    assert calls[0][2] == target


def test_interrupted_update_recovery_precedes_network_even_in_cli(project, monkeypatch):
    m, u, root, _, _, _ = project
    u.state.mkdir(parents=True)
    u.journal.write_text("{}")
    monkeypatch.delenv("NEXUS_CHECK_UPDATES", raising=False)
    monkeypatch.setattr(m, "ensure_stopped", lambda *_: None)
    calls = []
    monkeypatch.setattr(m, "run_worker", lambda *a: calls.append(a) or 20)
    monkeypatch.setattr(
        m, "latest_commit", lambda: pytest.fail("recover before network")
    )
    assert m.startup(u, root / "launcher") == 20
    assert calls[0][2] == "recover"


def test_live_pid_blocks_update_without_killing_it(project):
    import os

    m, _, root, _, _, _ = project
    state = root.parent / "launcher-state"
    state.mkdir()
    (state / "backend.pid").write_text(str(os.getpid()))
    with pytest.raises(m.UpdateError):
        m.ensure_stopped(root, state)
    os.kill(os.getpid(), 0)


def test_occupied_port_blocks_update(project, monkeypatch):
    import socket

    m, _, root, _, _, _ = project
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        monkeypatch.setenv("MINDMELD_BACKEND_PORT", str(server.getsockname()[1]))
        with pytest.raises(m.UpdateError):
            m.ensure_stopped(root, root.parent / "launcher-state")


@pytest.mark.parametrize("value", ["bad", "a" * 39, "a" * 41, "../main"])
def test_network_commit_is_validated(project, monkeypatch, value):
    from types import SimpleNamespace

    m, *_ = project
    monkeypatch.setattr(
        m.subprocess,
        "run",
        lambda *_a, **_kw: SimpleNamespace(
            stdout=json.dumps({"object": {"sha": value}})
        ),
    )
    with pytest.raises(m.UpdateError):
        m.latest_commit()


def test_native_offer_keeps_version_text_out_of_script_code(project, monkeypatch):
    from types import SimpleNamespace

    m, _, _, _, old, target = project
    calls = []
    monkeypatch.setattr(
        m.subprocess,
        "run",
        lambda args, **kw: (
            calls.append(args)
            or SimpleNamespace(returncode=0, stdout="Update and restart")
        ),
    )
    assert m.offer_version(old, target)
    assert old[:8] in calls[0][-1] and target[:8] in calls[0][-1]
    assert (
        old[:8] not in calls[0][2]
    )  # message is argv, not executable AppleScript source.


def test_latest_commit_uses_small_branch_ref_payload(project, monkeypatch):
    from types import SimpleNamespace

    m, _, _, _, _, target = project
    calls = []
    monkeypatch.setattr(
        m.subprocess,
        "run",
        lambda args, **_kw: (
            calls.append(args)
            or SimpleNamespace(stdout=json.dumps({"object": {"sha": target}}))
        ),
    )
    assert m.latest_commit() == target
    assert calls[0][-1].endswith("/git/ref/heads/main")
    assert calls[0][:2] == ["/usr/bin/curl", "-q"]


def test_bookkeeping_failure_after_start_rolls_back(project, monkeypatch):
    m, u, root, _, old, target = project
    real_write = u.write_json

    def write(path, data):
        if path == u.previous:
            raise OSError("disk full")
        return real_write(path, data)

    monkeypatch.setattr(u, "write_json", write)
    starts = []
    with pytest.raises(m.RestoredUpdate):
        u.install(
            target,
            prepare=lambda: prepare_new(root),
            start=lambda: starts.append(git(root, "rev-parse", "HEAD")),
            stop=lambda: None,
        )
    assert starts[-1] == old
    assert (root / ".venv/sentinel").read_text() == "old"
    assert_private(root)


def test_real_virtualenv_entrypoint_works_after_rollback(project):
    m, u, root, _, _, target = project
    environment = root / ".venv"
    subprocess.run(
        [sys._base_executable, "-m", "venv", "--without-pip", str(environment)],
        check=True,
    )
    entry = environment / "bin/student-tool"
    entry.write_text(
        f"#!/bin/sh\nexec {shlex.quote(str(environment / 'bin/python'))} -c 'import sys; print(sys.prefix)' \"$@\"\n"
    )
    entry.chmod(0o755)

    def prep():
        subprocess.run(
            [sys._base_executable, "-m", "venv", "--without-pip", str(environment)],
            check=True,
        )
        raise RuntimeError("network interrupted")

    with pytest.raises(m.RestoredUpdate):
        u.install(target, prepare=prep, start=lambda: None, stop=lambda: None)
    assert subprocess.check_output([str(entry)], text=True).strip() == str(environment)
    assert_private(root)


@pytest.mark.parametrize("fail_setup", [False, True])
def test_worker_control_boundary_updates_or_restores_real_environment(
    project, monkeypatch, tmp_path, fail_setup
):
    m, _, root, other, _, _ = project
    scripts = other / "script"
    scripts.mkdir()
    helper = scripts / "fixture-launcher.sh"
    helper.write_text("""#!/bin/bash
set -eu
[ "$NEXUS_UPDATE_WORKER" = 1 ]
[ "$MINDMELD_OPEN_BROWSER" = 0 ]
[ "$MINDMELD_BACKEND_PORT" = 18189 ]
[ "$MINDMELD_FRONTEND_PORT" = 15189 ]
case "$1" in
 --locked-start_services) git rev-parse HEAD > "$FIXTURE_START_MARK" ;;
 --verify) [ "$(cat "$FIXTURE_START_MARK")" = "$(git rev-parse HEAD)" ] ;;
 --locked-stop_services) : ;;
 *) exit 4 ;;
esac
""")
    refresh = scripts / "install_desktop_launcher.sh"
    refresh.write_text(
        '#!/bin/bash\nset -eu\nprintf refreshed > "$MINDMELD_DESKTOP_APP/refreshed"\n'
    )
    setup = scripts / "setup.sh"
    setup.write_text("""#!/bin/bash
set -eu
"$NEXUS_PYTHON" -m venv --without-pip .venv
mkdir -p frontend/node_modules
printf new > frontend/node_modules/sentinel
""")
    (other / "app.txt").write_text("old")
    git(other, "add", ".")
    git(other, "commit", "-m", "old fixture helpers")
    git(other, "push")
    git(root, "fetch", "origin")
    git(root, "merge", "--ff-only", git(other, "rev-parse", "HEAD"))
    old = git(root, "rev-parse", "HEAD")
    (other / "app.txt").write_text("new")
    if fail_setup:
        setup.write_text("#!/bin/bash\nexit 7\n")
    git(other, "commit", "-am", "offered fixture update")
    git(other, "push")
    target = git(other, "rev-parse", "HEAD")
    tools = tmp_path / "tools"
    tools.mkdir()
    for tool in ["node", "npm"]:
        path = tools / tool
        path.write_text("#!/bin/bash\nexit 0\n")
        path.chmod(0o755)
    monkeypatch.setenv("PATH", str(tools) + ":" + __import__("os").environ["PATH"])
    monkeypatch.setenv("MINDMELD_LAUNCHER_STATE_DIR", str(tmp_path / "launcher-state"))
    monkeypatch.setenv("MINDMELD_BACKEND_PORT", "18189")
    monkeypatch.setenv("MINDMELD_FRONTEND_PORT", "15189")
    desktop_app = tmp_path / "Custom Lab.app"
    desktop_app.mkdir()
    monkeypatch.setenv("MINDMELD_DESKTOP_APP", str(desktop_app) + "/")
    monkeypatch.setenv("FIXTURE_START_MARK", str(tmp_path / "last-start"))
    monkeypatch.setenv("PRIVATE_TEST_TOKEN", "never-log-this-value")
    monkeypatch.setattr(m, "show_message", lambda *_a, **_kw: None)
    u = m.Updater(root, tmp_path / "launcher-state")
    assert m.worker_run(u, root / "script/fixture-launcher.sh", target) == 20
    expected = old if fail_setup else target
    assert git(root, "rev-parse", "HEAD") == expected
    assert (tmp_path / "last-start").read_text().strip() == expected
    assert (desktop_app / "refreshed").read_text() == "refreshed"
    assert not u.journal.exists()
    assert "never-log-this-value" not in (u.state / "update.log").read_text()
    assert_private(root)


@pytest.mark.skipif(
    sys.platform != "darwin", reason="macOS launcher kernel-lock integration"
)
def test_concurrent_launch_is_blocked_while_updater_is_waiting(tmp_path):
    import os
    import signal
    import time

    root = tmp_path / "student quoted project"
    scripts = root / "script"
    scripts.mkdir(parents=True)
    launcher = scripts / "build_and_run.sh"
    launcher.write_bytes(SOURCE.with_name("build_and_run.sh").read_bytes())
    launcher.chmod(0o755)
    marker = tmp_path / "worker-called"
    (scripts / "student_updates.py").write_text("""import os,time
from pathlib import Path
with Path(os.environ['UPDATE_TEST_MARK']).open('a') as f: f.write('called\\n')
time.sleep(2)
raise SystemExit(20)
""")
    env = {
        **os.environ,
        "NEXUS_PYTHON": sys._base_executable,
        "MINDMELD_LAUNCHER_STATE_DIR": str(tmp_path / "state"),
        "MINDMELD_OPEN_BROWSER": "0",
        "UPDATE_TEST_MARK": str(marker),
    }
    first = subprocess.Popen(
        ["/bin/bash", str(launcher), "--start"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 8
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.03)
        assert marker.exists()
        second = subprocess.run(
            ["/bin/bash", str(launcher), "--start"],
            env=env,
            capture_output=True,
            timeout=5,
            check=False,
        )
        assert second.returncode != 0
        assert first.wait(timeout=8) == 0
        assert marker.read_text() == "called\n"
    finally:
        if first.poll() is None:
            os.killpg(first.pid, signal.SIGTERM)
        first.communicate(timeout=5)
