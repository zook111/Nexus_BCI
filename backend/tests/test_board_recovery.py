import gc
import time
from pathlib import Path
from unittest.mock import Mock

import pytest
from brainflow.exit_codes import BrainFlowError
from fastapi.testclient import TestClient

from mindmeld_api import main
from mindmeld_api.schemas import (
    BoardConnectionRequest,
    BoardKind,
    BoardStatus,
    CalmCalibrationStatus,
    CalmSignalState,
    RecordingStartRequest,
    RecordingUpdateRequest,
)
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


def test_released_native_board_pauses_stream_and_allows_reset_and_reconnect(tmp_path):
    service = BrainFlowBoardService(tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()
    service._board.release_session()
    try:
        snapshot = service.snapshot(64)
        assert snapshot.status == BoardStatus.error
        assert snapshot.sample_count == 0
        assert service.state().status == BoardStatus.error
        assert service.disconnect().status == BoardStatus.idle
        assert (
            service.connect(BoardConnectionRequest(board=BoardKind.synthetic)).status
            == BoardStatus.prepared
        )
    finally:
        service.disconnect()


@pytest.fixture
def streaming_service(tmp_path):
    # Fault-injection Mock cycles can delay BoardShim finalizers. Drain them before
    # creating a new synthetic session with the same native board/parameter key.
    gc.collect()
    service = BrainFlowBoardService(tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()
    yield service
    service.disconnect()


@pytest.mark.parametrize(
    "method", ["state", "snapshot", "dsp_summary", "signal_quality", "calm_features"]
)
def test_every_live_reader_reconciles_a_released_board(streaming_service, method):
    service = streaming_service
    service._board.release_session()
    result = getattr(service, method)(64) if method == "snapshot" else getattr(service, method)()
    assert result.status == BoardStatus.error
    assert service.state().status == BoardStatus.error
    assert service._board is None
    if method != "state":
        assert result.sample_count == 0
    if method == "calm_features":
        assert result.signal_state == CalmSignalState.unavailable
        assert result.calm_score is None and result.confidence == 0
        assert result.baseline.status == CalmCalibrationStatus.inactive


@pytest.mark.parametrize("method", ["stop_stream", "disconnect"])
def test_stop_and_reset_work_without_a_prior_state_or_data_read(streaming_service, method):
    service = streaming_service
    service._board.release_session()
    result = getattr(service, method)()
    assert result.status in (BoardStatus.error, BoardStatus.idle)
    assert service.disconnect().status == BoardStatus.idle
    assert (
        service.connect(BoardConnectionRequest(board=BoardKind.synthetic)).status
        == BoardStatus.prepared
    )


def test_read_failure_between_readiness_check_and_sample_read_is_recovered(streaming_service):
    service = streaming_service
    service._board.get_current_board_data = Mock(
        side_effect=BrainFlowError("injected lost session", 15)
    )
    result = service.snapshot(64)
    assert result.status == BoardStatus.error
    assert result.timestamps == [] and result.channels == []
    assert "BOARD_NOT_CREATED_ERROR:15" in result.message
    assert service._board is None


def test_failed_stop_does_not_skip_native_release(streaming_service):
    service = streaming_service
    board = service._board
    board.stop_stream = Mock(side_effect=BrainFlowError("injected stopped thread", 11))
    assert service.disconnect().status == BoardStatus.idle
    assert not board.is_prepared()


def test_genuine_release_failure_retains_owner_and_allows_retry(streaming_service):
    service = streaming_service
    board = service._board
    board.release_session = Mock(side_effect=BrainFlowError("injected release failure", 17))
    state = service.disconnect()
    assert state.status == BoardStatus.error
    assert service._board is board and board.is_prepared()
    assert "Could not release" in state.message
    del board.release_session
    assert service.disconnect().status == BoardStatus.idle
    assert service._board is None


def test_recovery_finalises_recording_preserving_data_and_identity(streaming_service):
    service = streaming_service
    started = service.start_recording(RecordingStartRequest(label="Synthetic recovery"))
    deadline = time.monotonic() + 2
    while service.recording_state().sample_count == 0 and time.monotonic() < deadline:
        time.sleep(0.02)
    assert service.recording_state().sample_count > 0
    worker = service._recording_thread
    service._board.release_session()
    assert service.state().status == BoardStatus.error
    worker.join(timeout=2)
    assert not worker.is_alive()
    current = service.recording_state()
    assert not current.active and current.stopped_at
    assert current.board == BoardKind.synthetic and current.sampling_rate == 250
    assert "Signal paused" in current.message
    saved = service.get_recording(started.session_id)
    assert saved == current
    assert (
        saved.sample_count == service.preview_recording(started.session_id, limit=5000).total_rows
    )
    service.disconnect()
    renamed = service.update_recording(started.session_id, RecordingUpdateRequest(label="Reviewed"))
    assert renamed.sampling_rate == 250 and renamed.board_id == -1
    assert service.recording_csv_path(started.session_id).exists()


@pytest.mark.parametrize(
    "endpoint", ["/api/board", "/api/dsp/summary", "/api/signal/quality", "/api/demo/calm"]
)
def test_released_board_endpoints_return_structured_pause_and_reset(
    monkeypatch, streaming_service, endpoint
):
    service = streaming_service
    monkeypatch.setattr(main, "board_service", service)
    service._board.release_session()
    client = TestClient(main.app)
    response = client.get(endpoint)
    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert client.post("/api/board/disconnect").json()["status"] == "idle"
    assert client.post("/api/board/connect", json={"board": "synthetic"}).status_code == 200
    assert client.post("/api/board/start", json={}).json()["status"] == "streaming"


def test_websocket_stays_open_with_a_paused_snapshot_after_native_release(
    monkeypatch, streaming_service
):
    service = streaming_service
    monkeypatch.setattr(main, "board_service", service)
    service._board.release_session()
    client = TestClient(main.app)
    with client.websocket_connect("/ws/stream") as socket:
        first = socket.receive_json()
        assert first["status"] == "error" and first["timestamps"] == []
        assert socket.receive_json()["status"] == "error"
        assert client.post("/api/board/disconnect").json()["status"] == "idle"


def test_native_stop_runs_even_when_the_final_recording_flush_fails(streaming_service, monkeypatch):
    service = streaming_service
    service.start_recording(RecordingStartRequest(label="Synthetic storage failure"))
    with service._lock:
        worker = service._request_recording_stop_locked()
    worker.join(timeout=2)
    board_type = type(service._board)
    original_stop = board_type.stop_stream
    calls = []

    def native_stop(board):
        calls.append(board)
        return original_stop(board)

    monkeypatch.setattr(board_type, "stop_stream", native_stop)
    monkeypatch.setattr(service, "_flush_recording_locked", Mock(side_effect=OSError("disk full")))
    with pytest.raises(OSError, match="disk full"):
        service.stop_stream()
    assert len(calls) == 1
    assert service.state().status == BoardStatus.prepared
    assert not service.recording_state().active
    assert "disk full" in service.recording_state().message


def test_native_loss_and_failed_metadata_write_still_pause_websocket_and_retry_on_reset(
    streaming_service, monkeypatch
):
    service = streaming_service
    started = service.start_recording(RecordingStartRequest(label="Synthetic metadata failure"))
    with service._lock:
        worker = service._request_recording_stop_locked()
    worker.join(timeout=2)
    original_write = Path.write_text
    target = Path(started.metadata_path)

    def unavailable(path, *args, **kwargs):
        if path == target:
            raise OSError("disk full")
        return original_write(path, *args, **kwargs)

    monkeypatch.setattr(main, "board_service", service)
    with monkeypatch.context() as storage:
        storage.setattr(Path, "write_text", unavailable)
        service._board.release_session()
        with TestClient(main.app).websocket_connect("/ws/stream") as socket:
            first = socket.receive_json()
            assert first["status"] == "error" and first["sample_count"] == 0
            assert "disk full" in first["message"]
            assert socket.receive_json()["status"] == "error"
        assert service._board is None
        assert service._recording_thread is None and service._recording_stop_event is None
        assert service._recording_metadata_dirty
        assert not service.recording_state().active
        assert "disk full" in service.recording_state().message
    assert service.disconnect().status == BoardStatus.idle
    assert not service._recording_metadata_dirty
    saved = service.get_recording(started.session_id)
    assert not saved.active and saved.sampling_rate == 250
    assert "disk full" in saved.message
