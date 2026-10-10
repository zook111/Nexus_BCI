from pathlib import Path
from unittest.mock import Mock

import pytest

from mindmeld_api.schemas import (
    BoardConnectionRequest,
    BoardKind,
    BoardStatus,
    RecordingStartRequest,
)
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


def test_initial_metadata_failure_rolls_back_recording_and_retry_starts_writer(
    tmp_path, monkeypatch
):
    service = BrainFlowBoardService(tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()
    original_replace = Path.replace
    attempted_metadata = []

    def partial_metadata_failure(path, target):
        if target.parent == tmp_path and target.suffix == ".json":
            attempted_metadata.append(target)
            path.write_text("partial metadata")
            raise OSError("disk full")
        return original_replace(path, target)

    try:
        with monkeypatch.context() as storage:
            storage.setattr(Path, "replace", partial_metadata_failure)
            with pytest.raises(OSError, match="disk full"):
                service.start_recording(RecordingStartRequest(label="Synthetic initialization"))
        assert attempted_metadata
        assert list(tmp_path.iterdir()) == []
        assert not service.recording_state().active
        assert service._recording_session_id is None
        assert service._recording_thread is None and service._recording_stop_event is None
        assert not service._recording_metadata_dirty
        assert service.state().status == BoardStatus.streaming
        restarted = service.start_recording(RecordingStartRequest(label="Synthetic initialization"))
        assert restarted.active
        assert service._recording_thread.is_alive()
        assert Path(restarted.file_path).exists() and Path(restarted.metadata_path).exists()
        assert service.get_recording(restarted.session_id).active
    finally:
        service.disconnect()


def test_thread_start_failure_removes_initialized_recording_artifacts(tmp_path, monkeypatch):
    service = BrainFlowBoardService(tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()
    try:
        with monkeypatch.context() as worker:
            worker.setattr(
                "mindmeld_api.services.brainflow_service.threading.Thread.start",
                Mock(side_effect=RuntimeError("cannot start recorder thread")),
            )
            with pytest.raises(RuntimeError, match="cannot start recorder thread"):
                service.start_recording(RecordingStartRequest(label="Synthetic failed writer"))
        assert list(tmp_path.iterdir()) == []
        assert not service.recording_state().active
        assert service._recording_thread is None and service._recording_stop_event is None
        assert service.start_recording(RecordingStartRequest(label="Synthetic retry")).active
        assert service._recording_thread.is_alive()
    finally:
        service.disconnect()
