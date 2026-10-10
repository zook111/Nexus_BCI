import threading
from csv import reader
from json import loads
from unittest.mock import Mock

import numpy as np
from brainflow.board_shim import BoardShim
from fastapi.testclient import TestClient

from mindmeld_api import main
from mindmeld_api.schemas import BoardKind, BoardStatus, RecordingStartRequest
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


def test_api_shutdown_flushes_pending_recording_and_releases_board(tmp_path, monkeypatch):
    service = BrainFlowBoardService(tmp_path)
    board = Mock()
    board.is_prepared.return_value = True
    board.get_current_board_data.return_value = np.empty((BoardShim.get_num_rows(-1), 0))
    service._board = board
    service._board_kind = BoardKind.synthetic
    service._board_id = -1
    service._status = BoardStatus.streaming
    real_thread_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, 'start', lambda _thread: None)
    monkeypatch.setattr(main, 'board_service', service)
    started = service.start_recording(RecordingStartRequest(label='Synthetic shutdown'))
    monkeypatch.setattr(threading.Thread, 'start', real_thread_start)
    data = np.zeros((BoardShim.get_num_rows(-1), 3))
    data[BoardShim.get_timestamp_channel(-1)] = [10.0, 11.0, 12.0]
    board.get_current_board_data.return_value = data
    # Lifespan cleanup must run on server shutdown, even without an explicit Save.
    with TestClient(main.app):
        assert service.recording_state().active
    final = service.recording_state()
    assert not final.active and final.stopped_at is not None
    assert final.sample_count == 3
    with open(started.file_path, newline='') as csv_file:
        assert len(list(reader(csv_file))) == 4
    metadata = loads(tmp_path.joinpath(f'{started.session_id}.json').read_text())
    assert metadata['active'] is False and metadata['stopped_at'] is not None
    board.stop_stream.assert_called_once()
    board.release_session.assert_called_once()
    assert service.state().status == BoardStatus.idle
