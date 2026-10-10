import threading
from csv import reader
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from brainflow.board_shim import BoardShim
from brainflow.exit_codes import BrainFlowError

from mindmeld_api.schemas import BoardKind, BoardStatus, RecordingStartRequest
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


@pytest.fixture
def buffered_board(tmp_path, monkeypatch):
    service = BrainFlowBoardService(tmp_path)
    board = Mock()
    board.is_prepared.return_value = True
    data = np.zeros((BoardShim.get_num_rows(-1), 5))
    data[BoardShim.get_timestamp_channel(-1)] = [1, 2, 3, 4, 5]
    board.get_current_board_data.side_effect = (
        lambda window: data[:, 2:3] if window == 1 else data
    )
    service._board = board
    service._board_kind = BoardKind.synthetic
    service._board_id = -1
    service._status = BoardStatus.streaming
    monkeypatch.setattr(threading.Thread, "start", lambda _thread: None)
    return service, board


def test_start_excludes_preroll_but_preserves_samples_after_boundary_capture(buffered_board):
    service, board = buffered_board
    state = service.start_recording(RecordingStartRequest(label="Synthetic boundary"))
    board.get_current_board_data.assert_called_once_with(1)
    assert service._recording_last_timestamp == 3.0
    with service._lock:
        # These buffered samples include rows acquired after the boundary but before
        # the worker's first poll; initialization must not drain or discard them.
        service._flush_recording_locked()
        service._flush_recording_locked()
    stopped = service.disconnect()
    assert stopped.status == BoardStatus.idle
    with Path(state.file_path).open(newline="") as csv_file:
        rows = list(reader(csv_file))[1:]
    assert [float(row[0]) for row in rows] == [4.0, 5.0]
    assert service.get_recording(state.session_id).sample_count == 2


def test_native_loss_during_boundary_capture_rolls_back_start_and_recovers(buffered_board):
    service, board = buffered_board
    board.get_current_board_data.side_effect = BrainFlowError("lost native session", 15)
    with pytest.raises(BrainFlowError):
        service.start_recording(RecordingStartRequest(label="Synthetic lost boundary"))
    assert service.state().status == BoardStatus.error
    assert service._board is None
    assert not service.recording_state().active
    assert service._recording_thread is None and service._recording_stop_event is None
    assert list(service._recording_dir.iterdir()) == []
    board.release_session.assert_called_once()


def test_nonfinite_boundary_refuses_recording_without_artifacts(buffered_board):
    service, board = buffered_board
    data = np.zeros((BoardShim.get_num_rows(-1), 1))
    data[BoardShim.get_timestamp_channel(-1)] = np.nan
    board.get_current_board_data.side_effect = None
    board.get_current_board_data.return_value = data
    with pytest.raises(RuntimeError, match="timestamp is not finite"):
        service.start_recording(RecordingStartRequest(label="Synthetic invalid timestamp"))
    assert not service.recording_state().active
    assert list(service._recording_dir.iterdir()) == []
    assert service.state().status == BoardStatus.streaming
    service.disconnect()
