from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from mindmeld_api import main


@pytest.mark.parametrize(
    "origin", [None, "http://localhost:5173", "http://127.0.0.1:5179"]
)
def test_local_http_clients_are_allowed(origin):
    headers = {} if origin is None else {"Origin": origin}
    response = TestClient(main.app).get("/health", headers=headers)
    assert response.status_code == 200


@pytest.mark.parametrize(
    "origin", ["https://unrelated.example", "http://localhost.evil.example:5173", "null"]
)
def test_unrelated_http_origin_cannot_trigger_board_actions(monkeypatch, origin):
    stop = Mock()
    monkeypatch.setattr(main.board_service, "stop_stream", stop)
    response = TestClient(main.app).post("/api/board/stop", headers={"Origin": origin})
    assert response.status_code == 403
    stop.assert_not_called()


def test_same_origin_api_docs_can_call_actions_at_custom_local_port(monkeypatch):
    stop = Mock(return_value=main.board_service.state())
    monkeypatch.setattr(main.board_service, "stop_stream", stop)
    client = TestClient(main.app, base_url="http://127.0.0.1:8123")
    response = client.post("/api/board/stop", headers={"Origin": "http://127.0.0.1:8123"})
    assert response.status_code == 200
    stop.assert_called_once()


@pytest.mark.parametrize("origin", ["http://127.0.0.1:8124", "https://127.0.0.1:8123"])
def test_api_origin_requires_matching_scheme_and_port(monkeypatch, origin):
    stop = Mock()
    monkeypatch.setattr(main.board_service, "stop_stream", stop)
    client = TestClient(main.app, base_url="http://127.0.0.1:8123")
    assert client.post("/api/board/stop", headers={"Origin": origin}).status_code == 403
    stop.assert_not_called()


@pytest.mark.parametrize(
    "origin", [None, "http://localhost:5173", "http://127.0.0.1:5179"]
)
def test_local_websocket_clients_can_receive_snapshots(origin):
    headers = {} if origin is None else {"Origin": origin}
    with TestClient(main.app).websocket_connect("/ws/stream", headers=headers) as ws:
        assert "status" in ws.receive_json()


@pytest.mark.parametrize("origin", ["https://unrelated.example", "null"])
def test_unrelated_websocket_origins_are_rejected_before_streaming(origin):
    with pytest.raises(WebSocketDisconnect) as caught:
        with TestClient(main.app).websocket_connect("/ws/stream", headers={"Origin": origin}):
            pytest.fail("An unrelated browser origin reached the stream")
    assert caught.value.code == 1008
