import csv
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
    "kind", ["same", "participant", "channels", "labels", "board", "identical"]
)
def test_incompatible_or_leaking_splits_rejected(lab, kind):
    recording(lab, "train")
    test = recording(lab, "test", seed=2)
    if kind in ("participant", "board"):
        setattr(test, kind, "different")
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
