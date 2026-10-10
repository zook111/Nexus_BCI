import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect

from mindmeld_api.origin_guard import LocalOriginGuard
from mindmeld_api.settings import Settings


def test_launcher_custom_port_reaches_http_and_websocket(monkeypatch):
    monkeypatch.setenv('MINDMELD_FRONTEND_PORT', '5180')
    settings = Settings(_env_file=None)
    app = FastAPI()

    @app.get('/health')
    def health():
        return {'ok': True}

    @app.websocket('/stream')
    async def stream(ws: WebSocket):
        await ws.accept()
        await ws.send_json({'ok': True})
        await ws.close()

    policy = dict(allow_origins=settings.api_cors_origins,
                  allow_origin_regex=settings.api_cors_origin_regex)
    app.add_middleware(CORSMiddleware, **policy)
    app.add_middleware(LocalOriginGuard, **policy)
    client = TestClient(app)
    for host in ('localhost', '127.0.0.1'):
        origin = f'http://{host}:5180'
        response = client.get('/health', headers={'Origin': origin})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == origin
        with client.websocket_connect('/stream', headers={'Origin': origin}) as ws:
            assert ws.receive_json() == {'ok': True}
    for origin in ('http://127.0.0.1:5181', 'http://evil.example:5180'):
        assert client.get('/health', headers={'Origin': origin}).status_code == 403
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/stream', headers={'Origin': origin}):
                pytest.fail('Unexpected origin allowed')


@pytest.mark.parametrize('port', ['0', '65536', 'nonsense'])
def test_invalid_launcher_port_is_rejected(monkeypatch, port):
    monkeypatch.setenv('MINDMELD_FRONTEND_PORT', port)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
