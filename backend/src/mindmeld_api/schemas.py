from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from mindmeld_api.constants import DEFAULT_LINE_FREQUENCY_HZ


class BoardKind(StrEnum):
    synthetic = "synthetic"
    cyton = "cyton"
    cyton_daisy = "cyton_daisy"


class BoardStatus(StrEnum):
    idle = "idle"
    prepared = "prepared"
    streaming = "streaming"
    error = "error"


class SignalQualityStatus(StrEnum):
    good = "good"
    questionable = "questionable"
    bad = "bad"


class CalmSignalState(StrEnum):
    unavailable = "unavailable"
    noisy = "noisy"
    usable = "usable"


class CalmCalibrationStatus(StrEnum):
    inactive = "inactive"
    running = "running"
    complete = "complete"
    failed = "failed"


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class SerialPortInfo(BaseModel):
    device: str
    name: str | None = None
    description: str | None = None
    manufacturer: str | None = None
    serial_number: str | None = None
    transport: str = "unknown"
    recommended: bool = False
    rank: int = 0
    message: str | None = None


class BoardConnectionRequest(BaseModel):
    board: BoardKind = BoardKind.synthetic
    serial_port: str | None = Field(
        default=None,
        description="Required for Cyton/Cyton Daisy. On macOS, prefer /dev/cu.* over /dev/tty.*.",
    )
    streamer_params: str | None = Field(
        default=None,
        description="Optional BrainFlow streamer target, e.g. file://recordings/session.csv:w.",
    )
    buffer_size: int = Field(default=450000, ge=1024)


class RecordingStartRequest(BaseModel):
    label: str | None = Field(default=None, max_length=80)


class RecordingSetupSnapshotRequest(BaseModel):
    label: str | None = Field(default=None, max_length=80)
    window_size: int = Field(default=500, ge=64, le=5000)
    line_frequency_hz: float = Field(default=DEFAULT_LINE_FREQUENCY_HZ, ge=0.0, le=120.0)


class RecordingCalibrationMarkerRequest(BaseModel):
    step_id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    cue: str = Field(min_length=1, max_length=240)
    elapsed_seconds: float = Field(default=0.0, ge=0.0)
    stream_sample_count: int = Field(default=0, ge=0)
    calm_score: float | None = None
    confidence: float | None = None
    alpha_post: float | None = None
    high_frequency_ratio: float | None = None
    signal_state: CalmSignalState | None = None
    quality_good: int | None = Field(default=None, ge=0)
    quality_questionable: int | None = Field(default=None, ge=0)
    quality_bad: int | None = Field(default=None, ge=0)


class RecordingUpdateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=80)


class RecordingDeleteResponse(BaseModel):
    session_id: str
    deleted: bool


class CalibrationCueSpeechRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=240)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    volume: float = Field(default=1.0, ge=0.0, le=2.0)


class BoardStateResponse(BaseModel):
    status: BoardStatus
    board: BoardKind | None = None
    board_id: int | None = None
    serial_port: str | None = None
    sampling_rate: int | None = None
    eeg_channels: list[int] = Field(default_factory=list)
    eeg_names: list[str] = Field(default_factory=list)
    message: str | None = None


class ChannelSnapshot(BaseModel):
    index: int
    label: str
    samples: list[float]


class StreamSnapshot(BaseModel):
    status: BoardStatus
    board: BoardKind | None = None
    board_id: int | None = None
    sample_count: int = 0
    sampling_rate: int | None = None
    timestamps: list[float] = Field(default_factory=list)
    channels: list[ChannelSnapshot] = Field(default_factory=list)
    message: str | None = None


class DspBandPower(BaseModel):
    name: str
    low_hz: float
    high_hz: float
    power: float
    relative_power: float


class DspChannelSummary(BaseModel):
    index: int
    label: str
    sample_count: int
    rms: float
    dominant_frequency_hz: float | None = None
    total_power: float
    band_powers: list[DspBandPower] = Field(default_factory=list)


class DspSummaryResponse(BaseModel):
    status: BoardStatus
    board: BoardKind | None = None
    board_id: int | None = None
    sample_count: int = 0
    sampling_rate: int | None = None
    window_size: int
    bandpass_low_hz: float
    bandpass_high_hz: float
    notch_frequency_hz: float | None = None
    channels: list[DspChannelSummary] = Field(default_factory=list)
    message: str | None = None


class SignalQualityChannel(BaseModel):
    index: int
    label: str
    status: SignalQualityStatus
    sample_count: int
    finite_sample_count: int
    finite_ratio: float
    mean: float
    rms: float
    filtered_rms: float
    standard_deviation: float
    peak_to_peak: float
    minimum: float
    maximum: float
    line_noise_ratio: float
    issues: list[str] = Field(default_factory=list)


class SignalQualityResponse(BaseModel):
    status: BoardStatus
    board: BoardKind | None = None
    board_id: int | None = None
    sample_count: int = 0
    sampling_rate: int | None = None
    window_size: int
    line_frequency_hz: float
    good_channels: int = 0
    questionable_channels: int = 0
    bad_channels: int = 0
    channels: list[SignalQualityChannel] = Field(default_factory=list)
    message: str | None = None


class RecordingSetupQualitySnapshot(BaseModel):
    captured_at: str
    label: str | None = None
    board: BoardKind | None = None
    sampling_rate: int | None = None
    sample_count: int = 0
    window_size: int
    line_frequency_hz: float
    good_channels: int = 0
    questionable_channels: int = 0
    bad_channels: int = 0
    channels: list[SignalQualityChannel] = Field(default_factory=list)
    message: str | None = None


class RecordingCalibrationMarker(BaseModel):
    captured_at: str
    step_id: str
    label: str
    cue: str
    elapsed_seconds: float = 0.0
    stream_sample_count: int = 0
    recording_sample_index: int = 0
    calm_score: float | None = None
    confidence: float | None = None
    alpha_post: float | None = None
    high_frequency_ratio: float | None = None
    signal_state: CalmSignalState | None = None
    quality_good: int | None = None
    quality_questionable: int | None = None
    quality_bad: int | None = None


class CalmCalibrationStartRequest(BaseModel):
    duration_seconds: int = Field(default=30, ge=2, le=300)
    label: str | None = Field(default=None, max_length=80)
    line_frequency_hz: float = Field(default=DEFAULT_LINE_FREQUENCY_HZ, gt=0.0, le=120.0)
    window_size: int = Field(default=1000, ge=128, le=5000)
    posterior_labels: list[str] = Field(default_factory=lambda: ["P7", "P8", "O1", "O2"])


class CalmCalibrationState(BaseModel):
    status: CalmCalibrationStatus = CalmCalibrationStatus.inactive
    label: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    elapsed_seconds: float = 0.0
    target_duration_seconds: int = 30
    accepted_windows: int = 0
    required_windows: int = 3
    baseline_median: float | None = None
    baseline_mad: float | None = None
    line_frequency_hz: float = DEFAULT_LINE_FREQUENCY_HZ
    window_size: int = 1000
    posterior_labels: list[str] = Field(default_factory=lambda: ["P7", "P8", "O1", "O2"])
    message: str | None = None


class CalmFeatureResponse(BaseModel):
    status: BoardStatus
    board: BoardKind | None = None
    board_id: int | None = None
    sample_count: int = 0
    source_timestamp: float | None = None
    sampling_rate: int | None = None
    window_size: int
    line_frequency_hz: float
    posterior_labels: list[str] = Field(default_factory=list)
    used_labels: list[str] = Field(default_factory=list)
    signal_state: CalmSignalState = CalmSignalState.unavailable
    confidence: float = 0.0
    calm_score: float | None = None
    trend: float | None = None
    flags: list[str] = Field(default_factory=list)
    features: dict[str, float] = Field(default_factory=dict)
    baseline: CalmCalibrationState
    message: str | None = None


class DemoEventCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("name must contain visible characters")
        return value.strip()


class DemoEventResponse(BaseModel):
    id: str
    name: str
    created_at: str


class DemoRunCreateRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    client_run_id: str | None = Field(default=None, min_length=8, max_length=80)
    participant_name: str = Field(min_length=1, max_length=80)
    participant_initials: str | None = Field(default=None, max_length=8)
    open_alpha: float = Field(ge=0.0)
    closed_alpha: float = Field(ge=0.0)
    alpha_lift_percent: float
    threshold_alpha: float = Field(ge=0.0)
    clean_hold_seconds: float = Field(ge=0.0, le=300.0)
    confidence: float = Field(ge=0.0, le=1.0)
    score: int = Field(ge=0, le=1000)
    scoring_version: str = Field(min_length=1, max_length=40)
    recording_session_id: str | None = Field(default=None, max_length=120)

    @field_validator("participant_name")
    @classmethod
    def validate_participant_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("participant_name must contain visible characters")
        return value.strip()

    @field_validator("participant_initials")
    @classmethod
    def normalize_initials(cls, value: str | None) -> str | None:
        return value.strip().upper() or None if value is not None else None


class DemoRunResponse(DemoRunCreateRequest):
    id: str
    event_id: str
    participant_key: str
    completed_at: str
    is_best: bool = False


class RecordingStateResponse(BaseModel):
    active: bool = False
    session_id: str | None = None
    label: str | None = None
    file_path: str | None = None
    metadata_path: str | None = None
    started_at: str | None = None
    stopped_at: str | None = None
    sample_count: int = 0
    board: BoardKind | None = None
    board_id: int | None = None
    sampling_rate: int | None = None
    eeg_names: list[str] = Field(default_factory=list)
    setup_quality_snapshots: list[RecordingSetupQualitySnapshot] = Field(default_factory=list)
    calibration_markers: list[RecordingCalibrationMarker] = Field(default_factory=list)
    message: str | None = None


class RecordingPreviewResponse(BaseModel):
    recording: RecordingStateResponse
    headers: list[str] = Field(default_factory=list)
    rows: list[list[float]] = Field(default_factory=list)
    offset: int = 0
    row_count: int = 0
    total_rows: int = 0


class RecordingCalibrationMarkerWindow(BaseModel):
    marker: RecordingCalibrationMarker
    headers: list[str] = Field(default_factory=list)
    rows: list[list[float]] = Field(default_factory=list)
    offset: int = 0
    row_count: int = 0
    total_rows: int = 0
    marker_row_offset: int | None = None


class RecordingCalibrationReportResponse(BaseModel):
    generated_at: str
    recording: RecordingStateResponse
    headers: list[str] = Field(default_factory=list)
    context_samples: int
    total_rows: int = 0
    marker_windows: list[RecordingCalibrationMarkerWindow] = Field(default_factory=list)
    message: str | None = None


class RecordingSpectralAnalysisResponse(BaseModel):
    recording: RecordingStateResponse
    sample_count: int = 0
    total_rows: int = 0
    offset: int = 0
    sampling_rate: int | None = None
    bandpass_low_hz: float
    bandpass_high_hz: float
    notch_frequency_hz: float | None = None
    channels: list[DspChannelSummary] = Field(default_factory=list)
    message: str | None = None
