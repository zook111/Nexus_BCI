from __future__ import annotations

import asyncio
import sqlite3
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from mindmeld_api import __version__
from mindmeld_api.constants import DEFAULT_LINE_FREQUENCY_HZ
from mindmeld_api.experiment_routes import experiment_router
from mindmeld_api.origin_guard import LocalOriginGuard
from mindmeld_api.schemas import (
    BoardConnectionRequest,
    BoardKind,
    BoardStateResponse,
    CalibrationCueSpeechRequest,
    CalmCalibrationStartRequest,
    CalmCalibrationState,
    CalmFeatureResponse,
    DemoEventCreateRequest,
    DemoEventResponse,
    DemoRunCreateRequest,
    DemoRunResponse,
    DspSummaryResponse,
    HealthResponse,
    RecordingCalibrationMarkerRequest,
    RecordingCalibrationReportResponse,
    RecordingDeleteResponse,
    RecordingPreviewResponse,
    RecordingSetupSnapshotRequest,
    RecordingSpectralAnalysisResponse,
    RecordingStartRequest,
    RecordingStateResponse,
    RecordingUpdateRequest,
    SerialPortInfo,
    SignalQualityResponse,
)
from mindmeld_api.services.brainflow_service import BrainFlowBoardService
from mindmeld_api.services.cartesia_tts import CartesiaTtsError, synthesize_speech
from mindmeld_api.services.demo_store import DemoStore
from mindmeld_api.services.experiment_service import ExperimentService
from mindmeld_api.services.serial_ports import list_serial_ports
from mindmeld_api.settings import get_settings

settings = get_settings()
board_service = BrainFlowBoardService(recording_dir=settings.recording_dir)
demo_store: DemoStore | None = None
experiment_service = ExperimentService(board_service, settings.recording_dir)

app = FastAPI(
    title="Nexus API",
    version=__version__,
    contact={"name": "Nexus BCI", "url": "https://github.com/zook111/Nexus_BCI"},
    license_info={"name": "MIT", "url": "https://github.com/zook111/Nexus_BCI/blob/main/LICENSE"},
)
app.include_router(experiment_router(lambda: experiment_service))
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.api_cors_origins,
    allow_origin_regex=settings.api_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    LocalOriginGuard,
    allow_origins=settings.api_cors_origins,
    allow_origin_regex=settings.api_cors_origin_regex,
)

class StreamStartRequest(BaseModel):
    buffer_size: int = 450000
    streamer_params: str | None = None


def get_demo_store() -> DemoStore:
    global demo_store
    if demo_store is not None:
        return demo_store
    try:
        demo_store = DemoStore(settings.demo_db_path)
    except (OSError, sqlite3.Error) as exc:
        raise HTTPException(
            status_code=503,
            detail="Local demo storage is unavailable",
        ) from exc
    return demo_store


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="mindmeld-api", version=__version__)


@app.get("/api/ports", response_model=list[SerialPortInfo])
def serial_ports() -> list[SerialPortInfo]:
    return list_serial_ports()


@app.get("/api/boards", response_model=dict[str, int])
def boards() -> dict[str, int]:
    return {
        BoardKind.synthetic.value: -1,
        BoardKind.cyton.value: 0,
        BoardKind.cyton_daisy.value: 2,
    }


@app.get("/api/board", response_model=BoardStateResponse)
def board_state() -> BoardStateResponse:
    return board_service.state()


@app.post("/api/board/connect", response_model=BoardStateResponse)
def connect_board(request: BoardConnectionRequest) -> BoardStateResponse:
    try:
        return board_service.connect(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/board/start", response_model=BoardStateResponse)
def start_stream(request: StreamStartRequest) -> BoardStateResponse:
    try:
        return board_service.start_stream(request.buffer_size, request.streamer_params)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/board/stop", response_model=BoardStateResponse)
def stop_stream() -> BoardStateResponse:
    return board_service.stop_stream()


@app.post("/api/board/disconnect", response_model=BoardStateResponse)
def disconnect_board() -> BoardStateResponse:
    return board_service.disconnect()


@app.get("/api/dsp/summary", response_model=DspSummaryResponse)
def dsp_summary(
    window_size: int = Query(default=500, ge=64, le=5000),
    bandpass_low_hz: float = Query(default=1.0, ge=0.01, le=100.0),
    bandpass_high_hz: float = Query(default=45.0, ge=1.0, le=120.0),
    notch_frequency_hz: float | None = Query(
        default=DEFAULT_LINE_FREQUENCY_HZ, gt=0.0, le=120.0
    ),
    notch_enabled: bool = Query(default=True),
) -> DspSummaryResponse:
    if bandpass_low_hz >= bandpass_high_hz:
        raise HTTPException(
            status_code=422,
            detail="bandpass_low_hz must be below bandpass_high_hz",
        )
    active_notch_frequency = notch_frequency_hz if notch_enabled else None
    return board_service.dsp_summary(
        window_size=window_size,
        bandpass_low_hz=bandpass_low_hz,
        bandpass_high_hz=bandpass_high_hz,
        notch_frequency_hz=active_notch_frequency,
    )


@app.get("/api/signal/quality", response_model=SignalQualityResponse)
def signal_quality(
    window_size: int = Query(default=500, ge=64, le=5000),
    line_frequency_hz: float = Query(default=DEFAULT_LINE_FREQUENCY_HZ, ge=0.0, le=120.0),
) -> SignalQualityResponse:
    return board_service.signal_quality(
        window_size=window_size,
        line_frequency_hz=line_frequency_hz,
    )


@app.post("/api/demo/calm/baseline/start", response_model=CalmCalibrationState)
def start_calm_baseline(request: CalmCalibrationStartRequest) -> CalmCalibrationState:
    return board_service.start_calm_baseline(request)


@app.get("/api/demo/calm/baseline", response_model=CalmCalibrationState)
def calm_baseline() -> CalmCalibrationState:
    return board_service.calm_baseline_state()


@app.post("/api/demo/calm/baseline/reset", response_model=CalmCalibrationState)
def reset_calm_baseline() -> CalmCalibrationState:
    return board_service.reset_calm_baseline()


@app.get("/api/demo/calm", response_model=CalmFeatureResponse)
def calm_features(
    window_size: int = Query(default=1000, ge=128, le=5000),
    line_frequency_hz: float = Query(default=DEFAULT_LINE_FREQUENCY_HZ, gt=0.0, le=120.0),
    posterior_labels: Annotated[list[str] | None, Query()] = None,
) -> CalmFeatureResponse:
    return board_service.calm_features(
        window_size=window_size,
        line_frequency_hz=line_frequency_hz,
        posterior_labels=posterior_labels or ["P7", "P8", "O1", "O2"],
    )


@app.get("/api/demo/events", response_model=list[DemoEventResponse])
def demo_events() -> list[DemoEventResponse]:
    return get_demo_store().list_events()


@app.post("/api/demo/events", response_model=DemoEventResponse, status_code=201)
def create_demo_event(request: DemoEventCreateRequest) -> DemoEventResponse:
    return get_demo_store().create_event(request.name)


@app.get("/api/demo/events/{event_id}/runs", response_model=list[DemoRunResponse])
def demo_runs(event_id: str) -> list[DemoRunResponse]:
    try:
        return get_demo_store().list_runs(event_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Demo event not found") from exc


@app.post(
    "/api/demo/events/{event_id}/runs",
    response_model=DemoRunResponse,
    status_code=201,
)
def create_demo_run(event_id: str, request: DemoRunCreateRequest) -> DemoRunResponse:
    try:
        return get_demo_store().create_run(event_id, request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Demo event not found") from exc


@app.post("/api/calibration/cue-speech")
def calibration_cue_speech(request: CalibrationCueSpeechRequest) -> Response:
    if not settings.cartesia_api_key:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})

    try:
        audio = synthesize_speech(
            api_key=settings.cartesia_api_key,
            transcript=request.transcript,
            model_id=settings.cartesia_model_id,
            voice_id=settings.cartesia_voice_id,
            version=settings.cartesia_version,
            speed=request.speed,
            volume=request.volume,
            timeout_seconds=settings.cartesia_timeout_seconds,
        )
    except CartesiaTtsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/recordings", response_model=list[RecordingStateResponse])
def recordings() -> list[RecordingStateResponse]:
    return board_service.list_recordings()


@app.get("/api/recordings/current", response_model=RecordingStateResponse)
def current_recording() -> RecordingStateResponse:
    return board_service.recording_state()


@app.post("/api/recordings/current/setup-quality", response_model=RecordingStateResponse)
def capture_recording_setup_quality(
    request: RecordingSetupSnapshotRequest,
) -> RecordingStateResponse:
    try:
        return board_service.capture_recording_setup_quality(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/recordings/current/calibration-markers", response_model=RecordingStateResponse)
def capture_recording_calibration_marker(
    request: RecordingCalibrationMarkerRequest,
) -> RecordingStateResponse:
    try:
        return board_service.capture_recording_calibration_marker(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/recordings/{session_id}", response_model=RecordingStateResponse)
def recording(session_id: str) -> RecordingStateResponse:
    try:
        return board_service.get_recording(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc


@app.patch("/api/recordings/{session_id}", response_model=RecordingStateResponse)
def update_recording(
    session_id: str,
    request: RecordingUpdateRequest,
) -> RecordingStateResponse:
    try:
        return board_service.update_recording(session_id, request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc


@app.delete("/api/recordings/{session_id}", response_model=RecordingDeleteResponse)
def delete_recording(session_id: str) -> RecordingDeleteResponse:
    try:
        board_service.delete_recording(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return RecordingDeleteResponse(session_id=session_id, deleted=True)


@app.get("/api/recordings/{session_id}/preview", response_model=RecordingPreviewResponse)
def recording_preview(
    session_id: str,
    limit: int = Query(default=500, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
) -> RecordingPreviewResponse:
    try:
        return board_service.preview_recording(session_id, limit=limit, offset=offset)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc


@app.get(
    "/api/recordings/{session_id}/calibration-report",
    response_model=RecordingCalibrationReportResponse,
)
def recording_calibration_report(
    session_id: str,
    response: Response,
    context_samples: int = Query(default=250, ge=0, le=5000),
) -> RecordingCalibrationReportResponse:
    try:
        report = board_service.calibration_report(
            session_id,
            context_samples=context_samples,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc

    response.headers["Content-Disposition"] = (
        f'attachment; filename="{session_id}-calibration-report.json"'
    )
    return report


@app.get(
    "/api/recordings/{session_id}/analysis",
    response_model=RecordingSpectralAnalysisResponse,
)
def recording_analysis(
    session_id: str,
    limit: int = Query(default=1000, ge=64, le=5000),
    offset: int = Query(default=0, ge=0),
    bandpass_low_hz: float = Query(default=1.0, ge=0.01, le=100.0),
    bandpass_high_hz: float = Query(default=45.0, ge=1.0, le=120.0),
    notch_frequency_hz: float | None = Query(
        default=DEFAULT_LINE_FREQUENCY_HZ, gt=0.0, le=120.0
    ),
) -> RecordingSpectralAnalysisResponse:
    if bandpass_low_hz >= bandpass_high_hz:
        raise HTTPException(
            status_code=422,
            detail="bandpass_low_hz must be below bandpass_high_hz",
        )
    try:
        return board_service.analyze_recording(
            session_id,
            limit=limit,
            offset=offset,
            bandpass_low_hz=bandpass_low_hz,
            bandpass_high_hz=bandpass_high_hz,
            notch_frequency_hz=notch_frequency_hz,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc


@app.get("/api/recordings/{session_id}/download")
def recording_download(session_id: str) -> FileResponse:
    try:
        csv_path = board_service.recording_csv_path(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc
    return FileResponse(csv_path, media_type="text/csv", filename=csv_path.name)


@app.post("/api/recordings/start", response_model=RecordingStateResponse)
def start_recording(request: RecordingStartRequest) -> RecordingStateResponse:
    try:
        return board_service.start_recording(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/recordings/stop", response_model=RecordingStateResponse)
def stop_recording() -> RecordingStateResponse:
    return board_service.stop_recording()


@app.websocket("/ws/stream")
async def stream_snapshots(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            snapshot = board_service.snapshot(settings.websocket_sample_window)
            await websocket.send_json(snapshot.model_dump(mode="json"))
            await asyncio.sleep(settings.websocket_interval_seconds)
    except WebSocketDisconnect:
        return
