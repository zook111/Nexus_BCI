import threading
from csv import reader
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from brainflow.board_shim import BoardShim
from brainflow.exit_codes import BrainFlowError

from mindmeld_api.schemas import (
    BoardKind,
    BoardStatus,
    CalmCalibrationStartRequest,
    CalmCalibrationStatus,
    CalmSignalState,
    RecordingCalibrationMarkerRequest,
    RecordingStartRequest,
)
from mindmeld_api.services import brainflow_service
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


@pytest.fixture
def baseline_service(tmp_path, monkeypatch):
    service = BrainFlowBoardService(tmp_path)
    now = [0.0]
    feature = SimpleNamespace(
        source_timestamp=100.0,
        features={"raw_calm_index": 0.7},
        signal_state=CalmSignalState.usable,
    )
    monkeypatch.setattr(brainflow_service, "monotonic", lambda: now[0])
    monkeypatch.setattr(service, "_calm_feature_locked", Mock(return_value=feature))
    return service, now, feature


def test_frozen_usable_buffer_cannot_complete_baseline(baseline_service):
    service, now, _feature = baseline_service
    started = service.start_calm_baseline(CalmCalibrationStartRequest(duration_seconds=10))
    assert started.accepted_windows == 1
    for second in range(1, 11):
        now[0] = float(second)
        state = service.calm_baseline_state()
    assert state.status == CalmCalibrationStatus.failed
    assert state.accepted_windows == 1 and state.baseline_median is None


def test_baseline_cannot_finish_on_frozen_buffer_after_three_fresh_windows(baseline_service):
    service, now, feature = baseline_service
    service.start_calm_baseline(CalmCalibrationStartRequest(duration_seconds=10))
    for second in (1, 2):
        now[0] = float(second)
        feature.source_timestamp += 1.0
        assert service.calm_baseline_state().status == CalmCalibrationStatus.running
    assert service.calm_baseline_state().accepted_windows == 3
    now[0] = 10.0
    state = service.calm_baseline_state()
    assert state.status == CalmCalibrationStatus.failed
    assert state.accepted_windows == 3 and state.baseline_median is None
    assert "timestamps stopped advancing" in state.message


@pytest.mark.parametrize("timestamp", [None, float("nan"), float("inf"), 100.0, 99.0])
def test_baseline_rejects_missing_nonfinite_or_nonadvancing_timestamp(
    baseline_service, timestamp
):
    service, now, feature = baseline_service
    service.start_calm_baseline(CalmCalibrationStartRequest(duration_seconds=10))
    feature.source_timestamp = timestamp
    now[0] = 1.0
    assert service.calm_baseline_state().accepted_windows == 1


def test_advancing_windows_complete_baseline_and_tracking_resets(baseline_service):
    service, now, feature = baseline_service
    service.start_calm_baseline(CalmCalibrationStartRequest(duration_seconds=10))
    for second in (1, 2, 10):
        now[0] = float(second)
        feature.source_timestamp += 1.0
        state = service.calm_baseline_state()
    assert state.status == CalmCalibrationStatus.complete and state.accepted_windows == 4
    # Starting anew accepts a new stream whose timestamps restarted at a lower value.
    feature.source_timestamp = 1.0
    restarted = service.start_calm_baseline(CalmCalibrationStartRequest(duration_seconds=10))
    assert restarted.accepted_windows == 1
    service.reset_calm_baseline()
    assert service._calm_calibration_last_source_timestamp is None
    service.start_calm_baseline(CalmCalibrationStartRequest(duration_seconds=10))
    service.disconnect()
    assert service._calm_calibration_last_source_timestamp is None


@pytest.fixture
def marker_service(tmp_path, monkeypatch):
    service = BrainFlowBoardService(tmp_path)
    board = Mock()
    board.is_prepared.return_value = True
    data = np.zeros((BoardShim.get_num_rows(-1), 3))
    data[BoardShim.get_timestamp_channel(-1)] = [1.0, 2.0, 3.0]
    board.get_current_board_data.side_effect = (
        lambda window: np.empty((0, 0)) if window == 1 else data
    )
    service._board = board
    service._board_kind = BoardKind.synthetic
    service._board_id = -1
    service._status = BoardStatus.streaming
    monkeypatch.setattr(threading.Thread, "start", lambda _thread: None)
    service.start_recording(RecordingStartRequest(label="Synthetic marker timing"))
    board.get_current_board_data.reset_mock()
    request = RecordingCalibrationMarkerRequest(
        step_id="eyes-closed", label="Eyes closed", cue="Close eyes"
    )
    return service, board, request


def test_marker_index_includes_pending_acquired_rows(marker_service):
    service, _board, request = marker_service
    assert service._recording_sample_count == 0
    state = service.capture_recording_calibration_marker(request)
    with Path(state.file_path).open(newline="") as csv_file:
        rows = list(reader(csv_file))[1:]
    assert len(rows) == 3
    assert state.calibration_markers[-1].recording_sample_index == len(rows)
    saved = service.get_recording(state.session_id)
    assert saved.sample_count == 3 and saved.calibration_markers == state.calibration_markers


def test_marker_is_not_attached_after_flush_recovers_native_loss(marker_service):
    service, board, request = marker_service
    board.get_current_board_data.side_effect = BrainFlowError("lost native session", 15)
    with pytest.raises(RuntimeError, match="active recording"):
        service.capture_recording_calibration_marker(request)
    assert service._recording_calibration_markers == []
    assert not service.recording_state().active
    assert service.state().status == BoardStatus.error
    board.release_session.assert_called_once()


def test_marker_storage_failure_does_not_append_marker(marker_service, monkeypatch):
    service, board, request = marker_service
    original_open = Path.open

    def fail_append(path, mode="r", *args, **kwargs):
        if path == service._recording_file_path and mode == "a":
            raise OSError("disk full")
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", fail_append)
    with pytest.raises(OSError, match="disk full"):
        service.capture_recording_calibration_marker(request)
    assert service._recording_calibration_markers == []
    assert service.recording_state().active
    board.release_session.assert_not_called()
