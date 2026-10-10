import threading
from csv import reader
from json import loads
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from brainflow.board_shim import BoardShim
from brainflow.exit_codes import BrainFlowError

from mindmeld_api.schemas import BoardKind, BoardStatus, RecordingStartRequest
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


@pytest.fixture
def recording_service(tmp_path, monkeypatch):
    service = BrainFlowBoardService(tmp_path)
    events = []
    data = np.zeros((BoardShim.get_num_rows(-1), 3))
    data[BoardShim.get_timestamp_channel(-1)] = [1.0, 2.0, 3.0]
    for channel in BoardShim.get_eeg_channels(-1):
        data[channel] = [channel, channel + 0.1, channel + 0.2]

    board = Mock()
    board.is_prepared.return_value = True

    def read_data(_window):
        if _window == 1:
            return np.empty((0, 0))
        events.append("read")
        assert service._recording_stop_event.is_set()
        return data

    board.get_current_board_data.side_effect = read_data
    board.stop_stream.side_effect = lambda: events.append("stop")
    board.release_session.side_effect = lambda: events.append("release")
    service._board = board
    service._board_kind = BoardKind.synthetic
    service._board_id = -1
    service._status = BoardStatus.streaming
    # Keep the recorder deterministic: the disconnect itself must persist the tail.
    monkeypatch.setattr(threading.Thread, "start", lambda _thread: None)
    service.start_recording(RecordingStartRequest(label="Synthetic reset tail"))
    board.get_current_board_data.reset_mock()
    yield service, board, events, data


def test_disconnect_persists_acquired_tail_before_native_teardown(recording_service):
    service, board, events, data = recording_service
    with service._lock:
        service._request_recording_stop_locked()
        service._flush_recording_locked()
    # The next recording poll has not happened when Reset is pressed.
    data[BoardShim.get_timestamp_channel(-1)] = [3.0, 4.0, 5.0]
    events.clear()

    assert service.disconnect().status == BoardStatus.idle
    assert events == ["read", "stop", "release"]
    with service._recording_file_path.open(newline="") as csv_file:
        rows = list(reader(csv_file))
    assert [float(row[0]) for row in rows[1:]] == [1, 2, 3, 4, 5]
    saved = loads(service._recording_metadata_path.read_text())
    assert saved["sample_count"] == 5
    assert saved["active"] is False and saved["stopped_at"]
    assert service._board is None
    assert service._recording_thread is None
    assert service._recording_stop_event is None
    board.stop_stream.assert_called_once()
    board.release_session.assert_called_once()


@pytest.mark.parametrize("failure_target", ["csv", "metadata"])
def test_disconnect_flush_storage_failure_still_releases_native_owner(
    recording_service, monkeypatch, failure_target
):
    service, board, events, _data = recording_service
    if failure_target == "csv":
        original_open = Path.open

        def fail_append(path, mode="r", *args, **kwargs):
            if path == service._recording_file_path and mode == "a":
                raise OSError("disk full")
            return original_open(path, mode, *args, **kwargs)

        monkeypatch.setattr(Path, "open", fail_append)
    else:
        original_replace = Path.replace

        def fail_metadata(path, target):
            if target == service._recording_metadata_path:
                raise OSError("disk full")
            return original_replace(path, target)

        monkeypatch.setattr(Path, "replace", fail_metadata)

    with pytest.raises(OSError, match="disk full"):
        service.disconnect()
    assert events == ["read", "stop", "release"]
    board.stop_stream.assert_called_once()
    board.release_session.assert_called_once()
    assert service._board is None and service.state().status == BoardStatus.idle
    assert service._recording_thread is None and service._recording_stop_event is None
    assert not service.recording_state().active
    assert "disk full" in service.recording_state().message
    assert service._recording_metadata_dirty == (failure_target == "metadata")


def test_disconnect_read_of_lost_native_session_does_not_reenter_recovery(recording_service):
    service, board, _events, _data = recording_service
    board.get_current_board_data.side_effect = BrainFlowError("lost native session", 15)
    board.stop_stream.side_effect = BrainFlowError("lost native session", 15)
    board.release_session.side_effect = BrainFlowError("lost native session", 15)

    assert service.disconnect().status == BoardStatus.idle
    board.get_current_board_data.assert_called_once()
    board.stop_stream.assert_called_once()
    board.release_session.assert_called_once()
    assert service._board is None and not service.recording_state().active
    assert "Signal paused" in service.recording_state().message


def test_known_native_loss_recovery_skips_final_read(recording_service):
    service, board, _events, _data = recording_service
    with service._lock:
        service._recover_board_locked("native session already lost")
    board.get_current_board_data.assert_not_called()
    board.stop_stream.assert_called_once()
    board.release_session.assert_called_once()
    assert service.state().status == BoardStatus.error
    assert service._board is None and not service.recording_state().active
