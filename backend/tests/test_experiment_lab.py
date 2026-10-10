import csv
import json
import time
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient

from mindmeld_api import main
from mindmeld_api.experiment_schemas import (
    EvaluateRequest,
    Experiment,
    ExperimentCreate,
    Trial,
    TrialEdit,
    TrialStart,
)
from mindmeld_api.schemas import BoardKind, RecordingStateResponse
from mindmeld_api.services.brainflow_service import BrainFlowBoardService
from mindmeld_api.services.experiment_service import ExperimentService


@pytest.fixture
def lab(tmp_path):
    return ExperimentService(BrainFlowBoardService(tmp_path), tmp_path)


def recording(lab, name, seed=1, count=6, participant="P01", synthetic=False):
    """Two known covariance patterns; no real participant data."""
    rate = 250
    root = lab.root.parent
    rng = np.random.default_rng(seed)
    base = 1700000000.0 + seed * 1000
    rows, trials = [], []
    labels = ["Left hand imagery", "Right hand imagery"]
    for i in range(count * 2):
        label = labels[i % 2]
        t = np.arange(6 * rate) / rate
        signal = 20 * np.sin(2 * np.pi * 12 * t + rng.uniform(0, 6))
        other = (1 if i % 2 else -1) * signal + rng.normal(0, 3, len(t))
        first = signal + rng.normal(0, 3, len(t))
        stamps = base + i * 8 + t
        rows.extend(zip(stamps, first, other, strict=True))
        trials.append(
            Trial(
                id=f"trial-{i}",
                label=label,
                start_timestamp=float(stamps[0]),
                end_timestamp=float(stamps[-1]),
                duration_seconds=6,
            )
        )
    path = root / f"{name}.csv"
    with path.open("w") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "C3", "C4"])
        writer.writerows(rows)
    metadata = RecordingStateResponse(
        session_id=name,
        active=False,
        sampling_rate=rate,
        eeg_names=["C3", "C4"],
        board=BoardKind.synthetic if synthetic else BoardKind.cyton,
        file_path=str(path),
        sample_count=len(rows),
        stopped_at="2026-09-30T12:00:00Z",
    )
    (root / f"{name}.json").write_text(metadata.model_dump_json())
    experiment = Experiment(
        session_id=name,
        name=name,
        participant=participant,
        labels=labels,
        channels=["C3", "C4"],
        board=metadata.board.value,
        sampling_rate=rate,
        created_at="2026-09-30T12:00:00Z",
        status="saved",
        trials=trials,
    )
    lab._write(lab._path(name), experiment)
    return experiment


def test_classifier_learns_covariance_and_persists_reproducible_report(lab):
    recording(lab, "training", seed=1)
    recording(lab, "testing", seed=2, count=3)
    report = lab.evaluate(
        EvaluateRequest(training_session_id="training", test_session_id="testing")
    )
    assert report.accuracy == 1.0
    assert report.balanced_accuracy == 1.0
    assert report.chance == 0.5
    assert report.confusion_matrix == [[3, 0], [0, 3]]
    assert len(report.predictions) == 6
    assert not report.synthetic
    assert report.provenance["training_csv_sha256"] != report.provenance["test_csv_sha256"]
    assert report.provenance["versions"]["pyriemann"]
    assert ExperimentService(lab.board, lab.root.parent).reports()[0] == report


def test_test_labels_never_affect_fitted_model_or_predictions(lab):
    recording(lab, "train", seed=1)
    test = recording(lab, "test", seed=2, count=3)
    request = EvaluateRequest(training_session_id="train", test_session_id="test")
    before = lab.evaluate(request)
    for trial in test.trials:
        trial.label = test.labels[1] if trial.label == test.labels[0] else test.labels[0]
    lab._write(lab._path("test"), test)
    after = lab.evaluate(request)
    assert after.accuracy == 0
    assert [p.probabilities for p in before.predictions] == [
        p.probabilities for p in after.predictions
    ]


@pytest.mark.parametrize(
    "kind", ["same", "participant", "channels", "labels", "board", "identical", "line_frequency_hz"]
)
def test_incompatible_or_leaking_splits_rejected(lab, kind):
    recording(lab, "train")
    test = recording(lab, "test", seed=2)
    if kind in ("participant", "board"):
        setattr(test, kind, "different")
    elif kind == "line_frequency_hz":
        test.line_frequency_hz = 60
    elif kind == "channels":
        test.channels.reverse()
    elif kind == "labels":
        test.labels = ["Other", "Labels"]
    elif kind == "identical":
        (lab.root.parent / "test.csv").write_bytes((lab.root.parent / "train.csv").read_bytes())
        # Copy the markers too: this is a duplicated recording with a different ID.
        test.trials = lab.get("train").trials
    lab._write(lab._path("test"), test)
    with pytest.raises(ValueError):
        lab.evaluate(
            EvaluateRequest(
                training_session_id="train", test_session_id="train" if kind == "same" else "test"
            )
        )


def test_exclusions_missing_samples_and_noise_are_removed_before_training(lab):
    train = recording(lab, "train", count=8)
    recording(lab, "test", seed=2, count=3)
    train.trials[0].included = False
    train.trials[1].issues = ["operator_aborted"]
    lab._write(lab._path("train"), train)
    path = lab.root.parent / "train.csv"
    data = np.loadtxt(path, delimiter=",", skiprows=1)
    data[2 * 1500 : 3 * 1500, 1] = 187500  # A railed electrode in trial 2.
    data = np.delete(data, np.arange(3 * 1500 + 100, 3 * 1500 + 120), axis=0)
    np.savetxt(path, data, delimiter=",", header="timestamp,C3,C4", comments="")
    report = lab.evaluate(EvaluateRequest(training_session_id="train", test_session_id="test"))
    assert len(report.rejected_trials) == 4
    assert sum(report.training_counts.values()) == 12
    assert "train/trial-2" in report.rejected_trials
    assert "train/trial-3" in report.rejected_trials


def test_minimum_trials_and_synthetic_rehearsal_label(lab):
    recording(lab, "train", count=4, synthetic=True)
    recording(lab, "test", seed=2, count=2, synthetic=True)
    request = EvaluateRequest(training_session_id="train", test_session_id="test")
    with pytest.raises(ValueError, match="at least 5 training"):
        lab.evaluate(request)
    recording(lab, "train", count=5, synthetic=True)
    assert lab.evaluate(request).synthetic


@pytest.fixture
def live_lab(tmp_path, monkeypatch):
    clock = {"wall": time.time(), "mono": 10.0}
    monkeypatch.setattr("mindmeld_api.services.experiment_service.time.time", lambda: clock["wall"])
    monkeypatch.setattr(
        "mindmeld_api.services.experiment_service.time.monotonic", lambda: clock["mono"]
    )
    board = Mock()
    board.state.return_value = SimpleNamespace(
        status="streaming",
        board=BoardKind.synthetic,
        eeg_names=["C3", "C4"],
        sampling_rate=250,
    )
    current = RecordingStateResponse()
    board.recording_state.side_effect = lambda: current

    def start(_, **kwargs):
        nonlocal current
        current = RecordingStateResponse(active=True, session_id="capture", sampling_rate=250)
        return current

    board.start_recording.side_effect = start

    def stop(**kwargs):
        nonlocal current
        current = current.model_copy(update={"active": False})
        return current

    board.stop_recording.side_effect = stop
    board.snapshot.side_effect = lambda **_: SimpleNamespace(
        status="streaming", timestamps=[clock["wall"]]
    )
    board.signal_quality.return_value = SimpleNamespace(
        channels=[SimpleNamespace(label=c, status="good", sample_count=500) for c in ["C3", "C4"]]
    )
    lab = ExperimentService(board, tmp_path)
    session = lab.create(
        ExperimentCreate(
            name="Capture", participant="P01", labels=["A", "B"], channels=["C3", "C4"]
        )
    )
    return lab, session, clock


def make_ready(lab, session, clock):
    for _ in range(3):
        clock["mono"] += 1.1
        clock["wall"] += 1.1
        result = lab.readiness(session.session_id)
    assert result.ready


def test_readiness_requires_three_advancing_windows_not_repeated_poll(live_lab):
    lab, session, clock = live_lab
    assert lab.readiness(session.session_id).clean_windows == 1
    assert lab.readiness(session.session_id).clean_windows == 1
    with pytest.raises(ValueError, match="three fresh"):
        lab.start_trial(session.session_id, TrialStart(id="t1", label="A"))
    make_ready(lab, session, clock)
    stamp = clock["wall"]
    lab.board.snapshot.side_effect = lambda **_: SimpleNamespace(
        status="streaming", timestamps=[stamp]
    )
    clock["wall"] += 4
    assert not lab.readiness(session.session_id).ready


def test_trial_boundaries_retry_abort_and_quality_changes(live_lab):
    lab, session, clock = live_lab
    make_ready(lab, session, clock)
    request = TrialStart(id="t1", label="A")
    started = lab.start_trial(session.session_id, request)
    assert len(lab.start_trial(session.session_id, request).trials) == 1
    assert started.trials[0].start_timestamp == clock["wall"]
    with pytest.raises(ValueError, match="Finish"):
        lab.start_trial(session.session_id, TrialStart(id="t2", label="B"))
    lab.board.signal_quality.return_value.channels[0].status = "bad"
    lab.readiness(session.session_id)
    clock["wall"] += 6
    finished = lab.finish_trial(session.session_id, "t1")
    assert not finished.trials[0].included
    assert "signal_quality_changed" in finished.trials[0].issues
    with pytest.raises(ValueError, match="cannot be included"):
        lab.edit_trial(session.session_id, "t1", TrialEdit(label="A", included=True))


def test_stop_and_restart_keep_incomplete_trials_excluded(live_lab):
    lab, session, clock = live_lab
    make_ready(lab, session, clock)
    lab.start_trial(session.session_id, TrialStart(id="t1", label="A"))
    lab.board.recording_state.side_effect = lambda: RecordingStateResponse()
    recovered = ExperimentService(lab.board, lab.root.parent).get(session.session_id)
    assert recovered.status == "interrupted"
    assert not recovered.trials[0].included
    assert "recording_interrupted" in recovered.trials[0].issues
    lab.stop(session.session_id)
    lab.board.stop_recording.assert_not_called()


def test_api_persistence_validation_and_path_traversal(lab, monkeypatch):
    recording(lab, "train")
    monkeypatch.setattr(main, "experiment_service", lab)
    client = TestClient(main.app)
    assert len(client.get("/api/experiments").json()) == 1
    response = client.patch(
        "/api/experiments/train/trials/trial-0",
        json={"label": "Right hand imagery", "included": False, "note": "Moved"},
    )
    assert response.status_code == 200
    changed = lab.get("train").trials[0]
    assert changed.label == "Right hand imagery" and not changed.included
    assert changed.note == "Moved"
    assert (
        client.post(
            "/api/experiments/evaluate",
            json={"training_session_id": "train", "test_session_id": "train"},
        ).status_code
        == 422
    )
    assert client.get("/api/experiments/missing").status_code == 404
    with pytest.raises(FileNotFoundError):
        lab.get("../outside")


def test_late_abort_still_excludes_an_already_finished_trial(live_lab):
    lab, session, clock = live_lab
    make_ready(lab, session, clock)
    lab.start_trial(session.session_id, TrialStart(id="t1", label="A"))
    clock["wall"] += 6
    assert lab.finish_trial(session.session_id, "t1").trials[0].included
    assert not lab.finish_trial(session.session_id, "t1", aborted=True).trials[0].included


def test_recorder_flushes_tail_and_refuses_to_stop_another_session(tmp_path):
    from mindmeld_api.schemas import BoardConnectionRequest, RecordingStartRequest

    board = BrainFlowBoardService(tmp_path)
    board.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    board.start_stream()
    try:
        recording = board.start_recording(RecordingStartRequest(label="Synthetic tail test"))
        # Park the background writer. stop_recording must perform the final write itself.
        with board._lock:
            thread = board._request_recording_stop_locked()
        thread.join(timeout=2)
        before = board.recording_state().sample_count
        time.sleep(0.08)
        with pytest.raises(RuntimeError, match="active recording has changed"):
            board.stop_recording(expected_session_id="another-session")
        with pytest.raises(RuntimeError, match="Save the current"):
            board.start_recording(RecordingStartRequest(label="Do not attach"), require_new=True)
        stopped = board.stop_recording(expected_session_id=recording.session_id)
        assert stopped.sample_count > before
        assert not stopped.active
        rows = board.preview_recording(recording.session_id, limit=5000).rows
        assert len(rows) == stopped.sample_count
        assert len(set(row[0] for row in rows)) == len(rows)
    finally:
        board.disconnect()


def test_mains_capture_roundtrip_and_legacy_default(live_lab):
    lab, session, _ = live_lab
    assert session.line_frequency_hz == 50
    lab.stop(session.session_id)
    captured = lab.create(
        ExperimentCreate(
            name="60 Hz capture",
            participant="P01",
            labels=["A", "B"],
            channels=["C3", "C4"],
            line_frequency_hz=60,
        )
    )
    restarted = ExperimentService(lab.board, lab.root.parent)
    assert restarted.get(captured.session_id).line_frequency_hz == 60
    payload = json.loads(lab._path(captured.session_id).read_text())
    assert payload["line_frequency_hz"] == 60
    del payload["line_frequency_hz"]
    lab._path(captured.session_id).write_text(json.dumps(payload))
    assert restarted.get(captured.session_id).line_frequency_hz == 50


@pytest.mark.parametrize("frequency", [0, -50, 121, float("nan"), float("inf")])
def test_invalid_mains_values_rejected(frequency):
    with pytest.raises(ValueError):
        ExperimentCreate(
            name="Test",
            participant="P01",
            labels=["A", "B"],
            channels=["C3", "C4"],
            line_frequency_hz=frequency,
        )


def test_live_readiness_rejects_noise_at_captured_60_hz(live_lab):
    lab, session, _ = live_lab
    session.line_frequency_hz = 60
    lab._write(lab._path(session.session_id), session)
    t = np.arange(500) / 250
    samples = 20 * np.sin(2 * np.pi * 12 * t) + 80 * np.sin(2 * np.pi * 60 * t)

    def quality(*, window_size, line_frequency_hz):
        return SimpleNamespace(
            channels=[
                BrainFlowBoardService._summarize_signal_quality_channel(
                    index=index,
                    label=channel,
                    samples=samples,
                    sampling_rate=250,
                    line_frequency_hz=line_frequency_hz,
                    flatline_threshold=1,
                    rail_threshold=150000,
                    noise_rms_threshold=150,
                )
                for index, channel in enumerate(session.channels)
            ]
        )

    lab.board.signal_quality.side_effect = quality
    result = lab.readiness(session.session_id)
    assert not result.ready and result.clean_windows == 0
    assert "Adjust selected electrodes" in result.reason
    lab.board.signal_quality.assert_called_once_with(window_size=500, line_frequency_hz=60)
    assert all(c.status == "good" for c in quality(window_size=500, line_frequency_hz=50).channels)


def test_offline_epochs_reject_captured_60_hz_noise(lab):
    experiment = recording(lab, "mains", count=1, synthetic=True)
    experiment.line_frequency_hz = 60
    path = lab.root.parent / "mains.csv"
    data = np.loadtxt(path, delimiter=",", skiprows=1)
    data[:, 1:] += (80 * np.sin(2 * np.pi * 60 * np.arange(len(data)) / 250))[:, None]
    np.savetxt(path, data, delimiter=",", header="timestamp,C3,C4", comments="")
    epochs, _, _, rejected, _ = lab._epochs(experiment)
    assert len(epochs) == 0
    assert len(rejected) == 2
    assert all(any("line_noise" in reason for reason in reasons) for reasons in rejected.values())
    # This same signal evades a 50 Hz-only check, which is the regression being fixed.
    epochs, _, _, rejected, _ = lab._epochs(experiment.model_copy(update={"line_frequency_hz": 50}))
    assert len(epochs) == 2 and not rejected


def test_matching_60_hz_evaluation_preserves_mains_provenance(lab):
    for name, seed, count in [("train", 1, 5), ("test", 2, 2)]:
        experiment = recording(lab, name, seed=seed, count=count, synthetic=True)
        experiment.line_frequency_hz = 60
        lab._write(lab._path(name), experiment)
    report = lab.evaluate(EvaluateRequest(training_session_id="train", test_session_id="test"))
    assert report.provenance["line_frequency_hz"] == 60
    assert report.provenance["training_annotations"]["line_frequency_hz"] == 60
    assert report.provenance["test_annotations"]["line_frequency_hz"] == 60
    assert lab.reports()[0].provenance == report.provenance


def test_failed_experiment_save_retries_after_raw_recording_finalized(lab, monkeypatch):
    experiment = recording(lab, "recover-save", synthetic=True)
    experiment.status = "recording"
    experiment.trials[-1].end_timestamp = None
    lab._write(lab._path(experiment.session_id), experiment)
    metadata = lab.board.get_recording(experiment.session_id)
    current = metadata.model_copy(update={"active": True, "stopped_at": None})
    monkeypatch.setattr(lab.board, "recording_state", lambda: current)

    def stop(**kwargs):
        nonlocal current
        assert kwargs["expected_session_id"] == experiment.session_id
        current = metadata
        return metadata

    stopper = Mock(side_effect=stop)
    monkeypatch.setattr(lab.board, "stop_recording", stopper)
    write = lab._write
    attempts = 0

    def fail_once(path, value):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("Experiment disk write failed")
        write(path, value)

    monkeypatch.setattr(lab, "_write", fail_once)
    with pytest.raises(OSError, match="disk write failed"):
        lab.stop(experiment.session_id)
    assert not current.active
    assert json.loads(lab._path(experiment.session_id).read_text())["status"] == "recording"
    # A fresh service can reconcile disk evidence after process restart too.
    restarted = ExperimentService(lab.board, lab.root.parent)
    recovered = restarted.stop(experiment.session_id)
    assert recovered.status == "saved"
    assert not recovered.trials[-1].included
    assert "unfinished_trial" in recovered.trials[-1].issues
    assert restarted.get(experiment.session_id).status == "saved"
    stopper.assert_called_once()


@pytest.mark.parametrize(
    "problem",
    [
        "active",
        "unfinished",
        "error",
        "missing_csv",
        "rate",
        "board",
        "channels",
        "session",
        "empty",
    ],
)
def test_incomplete_raw_recording_is_not_reconciled_as_saved(lab, problem):
    experiment = recording(lab, "incomplete", synthetic=True)
    experiment.status = "recording"
    experiment.trials[-1].end_timestamp = None
    lab._write(lab._path(experiment.session_id), experiment)
    path = lab.root.parent / "incomplete.json"
    payload = json.loads(path.read_text())
    if problem == "active":
        payload["active"] = True
    elif problem == "unfinished":
        payload["stopped_at"] = None
    elif problem == "error":
        payload["message"] = "Recording stopped after native session was lost"
    elif problem == "missing_csv":
        (lab.root.parent / "incomplete.csv").unlink()
    elif problem == "rate":
        payload["sampling_rate"] = 200
    elif problem == "board":
        payload["board"] = "cyton"
    elif problem == "channels":
        payload["eeg_names"] = ["O1", "O2"]
    elif problem == "session":
        payload["session_id"] = "another"
    elif problem == "empty":
        payload["sample_count"] = 0
    path.write_text(json.dumps(payload))
    recovered = lab.stop(experiment.session_id)
    assert recovered.status == "interrupted"
    assert not recovered.trials[-1].included
    assert "recording_interrupted" in recovered.trials[-1].issues


def test_linked_recording_deletion_is_blocked_until_experiment_delete_exists(lab, monkeypatch):
    experiment = recording(lab, "linked", synthetic=True)
    csv_path = lab.root.parent / "linked.csv"
    metadata_path = lab.root.parent / "linked.json"
    monkeypatch.setattr(main, "board_service", lab.board)
    response = TestClient(main.app).delete("/api/recordings/linked")
    assert response.status_code == 409
    assert "Experiment Lab" in response.json()["detail"]
    assert csv_path.exists() and metadata_path.exists()
    assert lab.get(experiment.session_id).status == "saved"
    with pytest.raises(RuntimeError, match="Experiment Lab"):
        lab.board.delete_recording(experiment.session_id)
