import threading
from json import loads
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from brainflow.board_shim import BoardShim

from mindmeld_api.schemas import (
    BoardKind,
    BoardStatus,
    RecordingStartRequest,
    RecordingUpdateRequest,
)
from mindmeld_api.services import brainflow_service
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


@pytest.fixture
def recorder(tmp_path, monkeypatch):
    service = BrainFlowBoardService(tmp_path)
    board = Mock()
    board.is_prepared.return_value = True
    data = np.zeros((BoardShim.get_num_rows(-1), 3))
    data[BoardShim.get_timestamp_channel(-1)] = [1.0, 2.0, 3.0]
    board.get_current_board_data.return_value = data
    service._board = board
    service._board_kind = BoardKind.synthetic
    service._board_id = -1
    service._status = BoardStatus.streaming
    monkeypatch.setattr(threading.Thread, "start", lambda _thread: None)
    service.start_recording(RecordingStartRequest(label="Synthetic storage regression"))
    return service


@pytest.mark.parametrize("failure", ["append", "metadata"])
def test_periodic_storage_failure_stops_recorder_and_exposes_incomplete_state(
    recorder, monkeypatch, failure
):
    service = recorder
    session_id = service._recording_session_id
    stop_event = service._recording_stop_event
    prior_metadata = service._recording_metadata_path.read_bytes()
    original_open = Path.open
    original_replace = Path.replace

    def fail_append(path, mode="r", *args, **kwargs):
        if path == service._recording_file_path and mode == "a":
            raise OSError("disk full")
        return original_open(path, mode, *args, **kwargs)

    def fail_replace(path, destination):
        if destination == service._recording_metadata_path:
            raise OSError("disk full")
        return original_replace(path, destination)

    with monkeypatch.context() as storage:
        if failure == "append":
            storage.setattr(Path, "open", fail_append)
        else:
            storage.setattr(Path, "replace", fail_replace)
        service._recording_loop(session_id, stop_event)
        state = service.recording_state()
        assert not state.active and state.stopped_at
        assert "stopped incomplete" in state.message and "disk full" in state.message
        assert stop_event.is_set()
        assert service._recording_thread is None and service._recording_stop_event is None
        assert service.state().status == BoardStatus.streaming
        if failure == "metadata":
            assert service._recording_metadata_path.read_bytes() == prior_metadata
            assert service._recording_metadata_dirty
        else:
            assert not service.get_recording(session_id).active
            assert "stopped incomplete" in service.get_recording(session_id).message
    # Reset retries dirty metadata once storage is available and retains the failure evidence.
    service.disconnect()
    saved = service.get_recording(session_id)
    assert not saved.active and "stopped incomplete" in saved.message
    assert not service._recording_metadata_dirty
    assert saved.sample_count == (3 if failure == "metadata" else 0)
    assert not list(service._recording_dir.glob("*.tmp"))


@pytest.mark.parametrize("failure", ["replace", "write"])
def test_atomic_metadata_failure_preserves_valid_prior_json_and_cleans_temp(
    recorder, monkeypatch, failure
):
    service = recorder
    target = service._recording_metadata_path
    prior_metadata = target.read_bytes()
    original_replace = Path.replace
    original_temporary_file = brainflow_service.NamedTemporaryFile

    def fail_replace(path, destination):
        if destination == target:
            assert path.parent == target.parent
            assert loads(path.read_text())["label"] == "Updated"
            raise OSError("replace failed")
        return original_replace(path, destination)

    def fail_write(*args, **kwargs):
        temporary_file = original_temporary_file(*args, **kwargs)
        original_write = temporary_file.write

        def partial_write(content):
            original_write(content[:10])
            raise OSError("temporary write failed")

        temporary_file.write = partial_write
        return temporary_file

    with monkeypatch.context() as storage:
        if failure == "replace":
            storage.setattr(Path, "replace", fail_replace)
        else:
            storage.setattr(brainflow_service, "NamedTemporaryFile", fail_write)
        with pytest.raises(OSError):
            service.update_recording(
                service._recording_session_id, RecordingUpdateRequest(label="Updated")
            )
    assert target.read_bytes() == prior_metadata
    assert loads(target.read_text())["label"] == "Synthetic storage regression"
    assert service._recording_metadata_dirty
    assert not list(target.parent.glob("*.tmp"))
    updated = service.update_recording(
        service._recording_session_id, RecordingUpdateRequest(label="Updated")
    )
    assert loads(target.read_text())["label"] == updated.label == "Updated"
    assert not service._recording_metadata_dirty
    service.disconnect()
