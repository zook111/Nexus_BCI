import pytest

from mindmeld_api.schemas import BoardConnectionRequest, BoardKind, BoardStateResponse, BoardStatus
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


def assert_shared_state(service):
    frame = service.snapshot(64)
    # Samples and device controls must describe the same backend session.
    metadata = {key: frame.model_dump()[key] for key in BoardStateResponse.model_fields}
    assert metadata == service.state().model_dump()
    return frame


def test_stream_reports_board_metadata_through_every_connection_transition(tmp_path):
    service = BrainFlowBoardService(tmp_path)
    try:
        assert assert_shared_state(service).status == BoardStatus.idle
        service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
        prepared = assert_shared_state(service)
        assert prepared.status == BoardStatus.prepared
        assert prepared.eeg_names and prepared.eeg_channels
        service.start_stream()
        assert assert_shared_state(service).status == BoardStatus.streaming
        service.stop_stream()
        assert assert_shared_state(service).status == BoardStatus.prepared
        service.disconnect()
        assert assert_shared_state(service).eeg_channels == []
    finally:
        service.disconnect()


@pytest.mark.parametrize('streaming', [False, True])
def test_stream_reconciles_a_lost_prepared_or_streaming_session(tmp_path, streaming):
    service = BrainFlowBoardService(tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    try:
        if streaming:
            service.start_stream()
        service._board.release_session()
        frame = assert_shared_state(service)
        assert frame.status == BoardStatus.error
        assert frame.sample_count == 0 and frame.channels == []
        assert 'Signal paused' in frame.message
    finally:
        service.disconnect()
