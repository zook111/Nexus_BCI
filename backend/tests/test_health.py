from fastapi.testclient import TestClient

from mindmeld_api import main
from mindmeld_api.main import app
from mindmeld_api.services.demo_store import DemoStore


def test_health() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_boards() -> None:
    client = TestClient(app)

    response = client.get("/api/boards")

    assert response.status_code == 200
    assert response.json()["cyton"] == 0


def test_connect_endpoint_rejects_while_streaming() -> None:
    main.board_service.disconnect()
    client = TestClient(app)

    try:
        connect_response = client.post("/api/board/connect", json={"board": "synthetic"})
        assert connect_response.status_code == 200

        start_response = client.post(
            "/api/board/start",
            json={"buffer_size": 450000},
        )
        assert start_response.status_code == 200

        reconnect_response = client.post("/api/board/connect", json={"board": "synthetic"})

        assert reconnect_response.status_code == 409
        assert "Stop streaming before connecting" in reconnect_response.json()["detail"]
        assert client.get("/api/board").json()["status"] == "streaming"
    finally:
        main.board_service.disconnect()


def test_dsp_summary_can_disable_notch_filter() -> None:
    client = TestClient(app)

    response = client.get("/api/dsp/summary?notch_enabled=false")

    assert response.status_code == 200
    assert response.json()["notch_frequency_hz"] is None


def test_live_analysis_defaults_to_uk_mains_frequency() -> None:
    client = TestClient(app)

    dsp_response = client.get("/api/dsp/summary")
    quality_response = client.get("/api/signal/quality")
    calm_response = client.get("/api/demo/calm")

    assert dsp_response.status_code == 200
    assert dsp_response.json()["notch_frequency_hz"] == 50.0
    assert quality_response.status_code == 200
    assert quality_response.json()["line_frequency_hz"] == 50.0
    assert calm_response.status_code == 200
    assert calm_response.json()["line_frequency_hz"] == 50.0


def test_calm_demo_endpoints_without_stream() -> None:
    client = TestClient(app)

    start_response = client.post(
        "/api/demo/calm/baseline/start",
        json={"duration_seconds": 2, "label": "Test baseline"},
    )
    assert start_response.status_code == 200
    assert start_response.json()["status"] == "running"

    feature_response = client.get("/api/demo/calm")
    assert feature_response.status_code == 200
    feature_body = feature_response.json()
    assert feature_body["signal_state"] == "unavailable"
    assert feature_body["calm_score"] is None
    assert "board_unavailable" in feature_body["flags"]

    reset_response = client.post("/api/demo/calm/baseline/reset")
    assert reset_response.status_code == 200
    assert reset_response.json()["status"] == "inactive"


def test_calibration_cue_speech_requires_cartesia_key(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "cartesia_api_key", None)
    client = TestClient(app)

    response = client.post("/api/calibration/cue-speech", json={"transcript": "Close eyes now."})

    assert response.status_code == 204
    assert response.content == b""


def test_calibration_cue_speech_returns_wav(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "cartesia_api_key", "test-key")

    def fake_synthesize_speech(**kwargs):
        assert kwargs["api_key"] == "test-key"
        assert kwargs["transcript"] == "Close eyes now."
        assert kwargs["model_id"] == main.settings.cartesia_model_id
        assert kwargs["voice_id"] == main.settings.cartesia_voice_id
        return b"RIFFfake-wav"

    monkeypatch.setattr(main, "synthesize_speech", fake_synthesize_speech)
    client = TestClient(app)

    response = client.post("/api/calibration/cue-speech", json={"transcript": "Close eyes now."})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"RIFFfake-wav"


def test_recording_calibration_marker_requires_active_recording() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/recordings/current/calibration-markers",
        json={
            "step_id": "eyes-open",
            "label": "Eyes open",
            "cue": "Open eyes.",
        },
    )

    assert response.status_code == 409


def test_demo_event_and_run_endpoints_persist_results(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(main, "demo_store", DemoStore(tmp_path / "demo.sqlite3"), raising=False)
    client = TestClient(app)

    assert client.get("/api/demo/events").json() == []

    event_response = client.post("/api/demo/events", json={"name": "Science evening"})
    assert event_response.status_code == 201
    event = event_response.json()

    run_response = client.post(
        f"/api/demo/events/{event['id']}/runs",
        json={
            "participant_name": "Dr Maya Shah",
            "participant_initials": "MS",
            "open_alpha": 1.25,
            "closed_alpha": 2.75,
            "alpha_lift_percent": 120.0,
            "threshold_alpha": 2.225,
            "clean_hold_seconds": 12.4,
            "confidence": 0.98,
            "score": 842,
            "scoring_version": "doctor-demo-v1",
        },
    )

    assert run_response.status_code == 201
    assert run_response.json()["event_id"] == event["id"]
    assert run_response.json()["is_best"] is True
    assert client.get("/api/demo/events").json()[0]["name"] == "Science evening"
    assert client.get(f"/api/demo/events/{event['id']}/runs").json()[0]["score"] == 842


def test_demo_run_endpoints_return_not_found_for_unknown_event(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(main, "demo_store", DemoStore(tmp_path / "demo.sqlite3"), raising=False)
    client = TestClient(app)

    list_response = client.get("/api/demo/events/missing/runs")
    create_response = client.post(
        "/api/demo/events/missing/runs",
        json={
            "participant_name": "Dr Maya Shah",
            "open_alpha": 1.0,
            "closed_alpha": 2.0,
            "alpha_lift_percent": 100.0,
            "threshold_alpha": 1.65,
            "clean_hold_seconds": 10.0,
            "confidence": 0.9,
            "score": 700,
            "scoring_version": "doctor-demo-v1",
        },
    )

    assert list_response.status_code == 404
    assert create_response.status_code == 404


def test_demo_storage_failure_does_not_take_down_other_endpoints(monkeypatch) -> None:
    class BrokenDemoStore:
        def __init__(self, _path) -> None:
            raise OSError("read-only storage")

    monkeypatch.setattr(main, "demo_store", None)
    monkeypatch.setattr(main, "DemoStore", BrokenDemoStore)
    client = TestClient(app)

    assert client.get("/health").status_code == 200
    response = client.get("/api/demo/events")
    assert response.status_code == 503
    assert response.json()["detail"] == "Local demo storage is unavailable"
