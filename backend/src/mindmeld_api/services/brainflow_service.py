from __future__ import annotations

import threading
from csv import reader, writer
from datetime import UTC, datetime
from json import dumps, loads
from pathlib import Path
from re import sub
from time import monotonic

import numpy as np
from brainflow.board_shim import BoardIds, BoardShim, BrainFlowInputParams
from brainflow.exit_codes import BrainFlowError, BrainFlowExitCodes
from scipy.signal import butter, iirnotch, sosfiltfilt

from mindmeld_api.constants import DEFAULT_LINE_FREQUENCY_HZ
from mindmeld_api.schemas import (
    BoardConnectionRequest,
    BoardKind,
    BoardStateResponse,
    BoardStatus,
    CalmCalibrationStartRequest,
    CalmCalibrationState,
    CalmCalibrationStatus,
    CalmFeatureResponse,
    CalmSignalState,
    ChannelSnapshot,
    DspBandPower,
    DspChannelSummary,
    DspSummaryResponse,
    RecordingCalibrationMarker,
    RecordingCalibrationMarkerRequest,
    RecordingCalibrationMarkerWindow,
    RecordingCalibrationReportResponse,
    RecordingPreviewResponse,
    RecordingSetupQualitySnapshot,
    RecordingSetupSnapshotRequest,
    RecordingSpectralAnalysisResponse,
    RecordingStartRequest,
    RecordingStateResponse,
    RecordingUpdateRequest,
    SignalQualityChannel,
    SignalQualityResponse,
    SignalQualityStatus,
    StreamSnapshot,
)

BOARD_IDS: dict[BoardKind, int] = {
    BoardKind.synthetic: BoardIds.SYNTHETIC_BOARD.value,
    BoardKind.cyton: BoardIds.CYTON_BOARD.value,
    BoardKind.cyton_daisy: BoardIds.CYTON_DAISY_BOARD.value,
}

EEG_BANDS: tuple[tuple[str, float, float], ...] = (
    ("delta", 1.0, 4.0),
    ("theta", 4.0, 8.0),
    ("alpha", 8.0, 13.0),
    ("beta", 13.0, 30.0),
    ("gamma", 30.0, 45.0),
)

DEFAULT_CALM_POSTERIOR_LABELS = ["P7", "P8", "O1", "O2"]
CALM_REQUIRED_BASELINE_WINDOWS = 3
CALM_POSTERIOR_FALLBACK_LABELS = {
    "p7",
    "p8",
    "o1",
    "o2",
    "p3",
    "p4",
    "pz",
    "oz",
    "po3",
    "po4",
}


class BrainFlowBoardService:
    def __init__(self, recording_dir: Path | str = "recordings") -> None:
        self._lock = threading.RLock()
        self._recording_dir = Path(recording_dir)
        self._board: BoardShim | None = None
        self._board_kind: BoardKind | None = None
        self._board_id: int | None = None
        self._serial_port: str | None = None
        self._status = BoardStatus.idle
        self._last_error: str | None = None
        self._recording_thread: threading.Thread | None = None
        self._recording_stop_event: threading.Event | None = None
        self._recording_session_id: str | None = None
        self._recording_label: str | None = None
        self._recording_file_path: Path | None = None
        self._recording_metadata_path: Path | None = None
        self._recording_metadata_dirty = False
        self._recording_started_at: str | None = None
        self._recording_stopped_at: str | None = None
        self._recording_sample_count = 0
        self._recording_last_timestamp: float | None = None
        self._recording_board: BoardKind | None = None
        self._recording_board_id: int | None = None
        self._recording_sampling_rate: int | None = None
        self._recording_eeg_channels: list[int] = []
        self._recording_eeg_names: list[str] = []
        self._recording_setup_quality_snapshots: list[RecordingSetupQualitySnapshot] = []
        self._recording_calibration_markers: list[RecordingCalibrationMarker] = []
        self._recording_message: str | None = None
        self._calm_calibration_status = CalmCalibrationStatus.inactive
        self._calm_calibration_label: str | None = None
        self._calm_calibration_started_at: str | None = None
        self._calm_calibration_completed_at: str | None = None
        self._calm_calibration_started_monotonic: float | None = None
        self._calm_calibration_elapsed_at_completion: float | None = None
        self._calm_calibration_target_duration_seconds = 30
        self._calm_calibration_line_frequency_hz = DEFAULT_LINE_FREQUENCY_HZ
        self._calm_calibration_window_size = 1000
        self._calm_calibration_posterior_labels = list(DEFAULT_CALM_POSTERIOR_LABELS)
        self._calm_calibration_values: list[float] = []
        self._calm_calibration_last_accept_monotonic: float | None = None
        self._calm_calibration_last_source_timestamp: float | None = None
        self._calm_calibration_baseline_median: float | None = None
        self._calm_calibration_baseline_mad: float | None = None
        self._calm_calibration_message: str | None = None
        self._calm_previous_score: float | None = None

    def state(self) -> BoardStateResponse:
        with self._lock:
            return self._state_locked()

    def connect(self, request: BoardConnectionRequest) -> BoardStateResponse:
        with self._lock:
            board_id = BOARD_IDS[request.board]

            if (
                request.board in {BoardKind.cyton, BoardKind.cyton_daisy}
                and not request.serial_port
            ):
                raise ValueError("serial_port is required for Cyton boards")
            self._reconcile_board_locked()
            if self._status == BoardStatus.streaming:
                raise RuntimeError("Stop streaming before connecting another board session")

            self._release_locked()

            params = BrainFlowInputParams()
            if request.serial_port:
                params.serial_port = request.serial_port

            try:
                board = BoardShim(board_id, params)
                board.prepare_session()
            except Exception as exc:
                self._status = BoardStatus.error
                self._last_error = str(exc)
                raise

            self._board = board
            self._board_kind = request.board
            self._board_id = board_id
            self._serial_port = request.serial_port
            self._status = BoardStatus.prepared
            self._last_error = None
            return self._state_locked()

    def start_stream(
        self, buffer_size: int = 450000, streamer_params: str | None = None
    ) -> BoardStateResponse:
        with self._lock:
            board = self._require_board_locked()
            if self._status == BoardStatus.streaming:
                return self._state_locked()

            try:
                board.start_stream(buffer_size, streamer_params or "")
            except BrainFlowError as exc:
                self._recover_board_locked(str(exc))
                raise

            self._status = BoardStatus.streaming
            self._last_error = None
            return self._state_locked()

    def stop_stream(self) -> BoardStateResponse:
        with self._lock:
            self._reconcile_board_locked()
            if self._board is None:
                return self._state_locked()
            if self._status == BoardStatus.streaming:
                self._request_recording_stop_locked()
                try:
                    self._flush_recording_locked()
                except OSError as exc:
                    self._recording_message = f"Recording could not be fully saved: {exc}"
                    raise
                finally:
                    # Storage failure must never leave the native stream running.
                    if self._board is not None and self._status == BoardStatus.streaming:
                        try:
                            self._board.stop_stream()
                        except BrainFlowError as exc:
                            self._recover_board_locked(str(exc))
                        else:
                            self._status = BoardStatus.prepared
                            self._finalize_recording_locked()
            return self._state_locked()

    def disconnect(self) -> BoardStateResponse:
        with self._lock:
            try:
                self._release_locked()
            except RuntimeError:
                # Keep the native owner for a later Reset if releasing it genuinely failed.
                pass
            return self._state_locked()

    def snapshot(self, max_samples: int) -> StreamSnapshot:
        with self._lock:
            if self._board is None or self._board_id is None:
                return StreamSnapshot(status=self._status, message=self._last_error)
            if self._status != BoardStatus.streaming:
                return StreamSnapshot(
                    status=self._status,
                    board=self._board_kind,
                    board_id=self._board_id,
                    sampling_rate=self._safe_sampling_rate_locked(),
                    message=self._last_error,
                )

            data = self._current_board_data_locked(max_samples)
            sample_count = int(data.shape[1]) if data.size else 0
            timestamp_channel = self._safe_timestamp_channel_locked()
            timestamps: list[float] = []
            if timestamp_channel is not None and sample_count:
                timestamps = data[timestamp_channel].tolist()

            eeg_channels = self._safe_eeg_channels_locked()
            eeg_names = self._safe_eeg_names_locked()
            channels: list[ChannelSnapshot] = []
            for offset, channel_index in enumerate(eeg_channels):
                label = eeg_names[offset] if offset < len(eeg_names) else f"Ch {offset + 1}"
                channels.append(
                    ChannelSnapshot(
                        index=channel_index,
                        label=label,
                        samples=data[channel_index].tolist() if sample_count else [],
                    )
                )

            return StreamSnapshot(
                status=self._status,
                board=self._board_kind,
                board_id=self._board_id,
                sample_count=sample_count,
                sampling_rate=self._safe_sampling_rate_locked(),
                timestamps=timestamps,
                channels=channels,
                message=self._last_error,
            )

    def dsp_summary(
        self,
        window_size: int = 500,
        bandpass_low_hz: float = 1.0,
        bandpass_high_hz: float = 45.0,
        notch_frequency_hz: float | None = DEFAULT_LINE_FREQUENCY_HZ,
    ) -> DspSummaryResponse:
        with self._lock:
            if self._board is None or self._board_id is None:
                return DspSummaryResponse(
                    status=self._status,
                    window_size=window_size,
                    bandpass_low_hz=bandpass_low_hz,
                    bandpass_high_hz=bandpass_high_hz,
                    notch_frequency_hz=notch_frequency_hz,
                    message=self._last_error,
                )
            sampling_rate = self._safe_sampling_rate_locked()
            if self._status != BoardStatus.streaming or sampling_rate is None:
                low_hz, high_hz = self._effective_bandpass_bounds(
                    sampling_rate=sampling_rate,
                    bandpass_low_hz=bandpass_low_hz,
                    bandpass_high_hz=bandpass_high_hz,
                )
                return DspSummaryResponse(
                    status=self._status,
                    board=self._board_kind,
                    board_id=self._board_id,
                    sampling_rate=sampling_rate,
                    window_size=window_size,
                    bandpass_low_hz=low_hz,
                    bandpass_high_hz=high_hz,
                    notch_frequency_hz=notch_frequency_hz,
                    message=self._last_error or "Board must be streaming for DSP summaries",
                )
            low_hz, high_hz = self._effective_bandpass_bounds(
                sampling_rate=sampling_rate,
                bandpass_low_hz=bandpass_low_hz,
                bandpass_high_hz=bandpass_high_hz,
            )

            data = self._current_board_data_locked(window_size)
            sample_count = int(data.shape[1]) if data.size else 0
            eeg_channels = self._safe_eeg_channels_locked()
            eeg_names = self._normalize_eeg_names(self._safe_eeg_names_locked(), len(eeg_channels))

            channels: list[DspChannelSummary] = []
            if sample_count:
                for offset, channel_index in enumerate(eeg_channels):
                    channels.append(
                        self._summarize_dsp_channel(
                            index=channel_index,
                            label=eeg_names[offset],
                            samples=np.asarray(data[channel_index], dtype=float),
                            sampling_rate=sampling_rate,
                            bandpass_low_hz=low_hz,
                            bandpass_high_hz=high_hz,
                            notch_frequency_hz=notch_frequency_hz,
                        )
                    )

            return DspSummaryResponse(
                status=self._status,
                board=self._board_kind,
                board_id=self._board_id,
                sample_count=sample_count,
                sampling_rate=sampling_rate,
                window_size=window_size,
                bandpass_low_hz=low_hz,
                bandpass_high_hz=high_hz,
                notch_frequency_hz=notch_frequency_hz,
                channels=channels,
                message=self._last_error,
            )

    def signal_quality(
        self,
        window_size: int = 500,
        line_frequency_hz: float = DEFAULT_LINE_FREQUENCY_HZ,
        flatline_threshold: float = 1.0,
        rail_threshold: float = 150_000.0,
        noise_rms_threshold: float = 150.0,
    ) -> SignalQualityResponse:
        with self._lock:
            if self._board is None or self._board_id is None:
                return SignalQualityResponse(
                    status=self._status,
                    window_size=window_size,
                    line_frequency_hz=line_frequency_hz,
                    message=self._last_error,
                )

            sampling_rate = self._safe_sampling_rate_locked()
            if self._status != BoardStatus.streaming or sampling_rate is None:
                return SignalQualityResponse(
                    status=self._status,
                    board=self._board_kind,
                    board_id=self._board_id,
                    sampling_rate=sampling_rate,
                    window_size=window_size,
                    line_frequency_hz=line_frequency_hz,
                    message=self._last_error or "Board must be streaming for signal quality",
                )

            data = self._current_board_data_locked(window_size)
            sample_count = int(data.shape[1]) if data.size else 0
            eeg_channels = self._safe_eeg_channels_locked()
            eeg_names = self._normalize_eeg_names(self._safe_eeg_names_locked(), len(eeg_channels))

            channels: list[SignalQualityChannel] = []
            if sample_count:
                for offset, channel_index in enumerate(eeg_channels):
                    channels.append(
                        self._summarize_signal_quality_channel(
                            index=channel_index,
                            label=eeg_names[offset],
                            samples=np.asarray(data[channel_index], dtype=float),
                            sampling_rate=sampling_rate,
                            line_frequency_hz=line_frequency_hz,
                            flatline_threshold=flatline_threshold,
                            rail_threshold=rail_threshold,
                            noise_rms_threshold=noise_rms_threshold,
                        )
                    )

            return SignalQualityResponse(
                status=self._status,
                board=self._board_kind,
                board_id=self._board_id,
                sample_count=sample_count,
                sampling_rate=sampling_rate,
                window_size=window_size,
                line_frequency_hz=line_frequency_hz,
                good_channels=sum(
                    channel.status == SignalQualityStatus.good for channel in channels
                ),
                questionable_channels=sum(
                    channel.status == SignalQualityStatus.questionable for channel in channels
                ),
                bad_channels=sum(channel.status == SignalQualityStatus.bad for channel in channels),
                channels=channels,
                message=self._last_error,
            )

    def start_calm_baseline(self, request: CalmCalibrationStartRequest) -> CalmCalibrationState:
        with self._lock:
            self._calm_calibration_status = CalmCalibrationStatus.running
            self._calm_calibration_label = request.label
            self._calm_calibration_started_at = self._now()
            self._calm_calibration_completed_at = None
            self._calm_calibration_started_monotonic = monotonic()
            self._calm_calibration_elapsed_at_completion = None
            self._calm_calibration_target_duration_seconds = request.duration_seconds
            self._calm_calibration_line_frequency_hz = request.line_frequency_hz
            self._calm_calibration_window_size = request.window_size
            self._calm_calibration_posterior_labels = list(request.posterior_labels)
            self._calm_calibration_values = []
            self._calm_calibration_last_accept_monotonic = None
            self._calm_calibration_last_source_timestamp = None
            self._calm_calibration_baseline_median = None
            self._calm_calibration_baseline_mad = None
            self._calm_calibration_message = "Collecting usable calm-signal baseline windows"
            self._calm_previous_score = None
            self._collect_calm_baseline_locked()
            return self._calm_calibration_state_locked()

    def calm_baseline_state(self) -> CalmCalibrationState:
        with self._lock:
            self._collect_calm_baseline_locked()
            return self._calm_calibration_state_locked()

    def reset_calm_baseline(self) -> CalmCalibrationState:
        with self._lock:
            self._reset_calm_calibration_locked()
            return self._calm_calibration_state_locked()

    def calm_features(
        self,
        window_size: int = 1000,
        line_frequency_hz: float = DEFAULT_LINE_FREQUENCY_HZ,
        posterior_labels: list[str] | None = None,
    ) -> CalmFeatureResponse:
        with self._lock:
            self._collect_calm_baseline_locked()
            labels = posterior_labels or list(DEFAULT_CALM_POSTERIOR_LABELS)
            baseline_median = None
            baseline_mad = None
            baseline_mismatch = False
            if self._calm_calibration_status == CalmCalibrationStatus.complete:
                baseline_mismatch = not self._calm_baseline_matches_locked(
                    window_size=window_size,
                    line_frequency_hz=line_frequency_hz,
                    posterior_labels=labels,
                )
            if (
                self._calm_calibration_status == CalmCalibrationStatus.complete
                and not baseline_mismatch
            ):
                baseline_median = self._calm_calibration_baseline_median
                baseline_mad = self._calm_calibration_baseline_mad

            response = self._calm_feature_locked(
                window_size=window_size,
                line_frequency_hz=line_frequency_hz,
                posterior_labels=labels,
                baseline_median=baseline_median,
                baseline_mad=baseline_mad,
                update_trend=True,
                baseline_mismatch=baseline_mismatch,
            )
            return response

    def recording_state(self) -> RecordingStateResponse:
        with self._lock:
            return self._recording_state_locked()

    def capture_recording_setup_quality(
        self,
        request: RecordingSetupSnapshotRequest,
    ) -> RecordingStateResponse:
        with self._lock:
            if not self._recording_session_id or self._recording_stopped_at is not None:
                raise RuntimeError("An active recording is required for setup quality snapshots")
            quality = self.signal_quality(
                window_size=request.window_size,
                line_frequency_hz=request.line_frequency_hz,
            )
            snapshot = RecordingSetupQualitySnapshot(
                captured_at=self._now(),
                label=request.label,
                board=quality.board,
                sampling_rate=quality.sampling_rate,
                sample_count=quality.sample_count,
                window_size=quality.window_size,
                line_frequency_hz=quality.line_frequency_hz,
                good_channels=quality.good_channels,
                questionable_channels=quality.questionable_channels,
                bad_channels=quality.bad_channels,
                channels=quality.channels,
                message=quality.message,
            )
            self._recording_setup_quality_snapshots.append(snapshot)
            self._write_recording_metadata_locked()
            return self._recording_state_locked()

    def capture_recording_calibration_marker(
        self,
        request: RecordingCalibrationMarkerRequest,
    ) -> RecordingStateResponse:
        with self._lock:
            if not self._recording_session_id or self._recording_stopped_at is not None:
                raise RuntimeError("An active recording is required for calibration markers")

            self._flush_recording_locked()
            if self._recording_stopped_at is not None:
                raise RuntimeError("An active recording is required for calibration markers")

            marker = RecordingCalibrationMarker(
                captured_at=self._now(),
                step_id=request.step_id,
                label=request.label,
                cue=request.cue,
                elapsed_seconds=request.elapsed_seconds,
                stream_sample_count=request.stream_sample_count,
                recording_sample_index=self._recording_sample_count,
                calm_score=request.calm_score,
                confidence=request.confidence,
                alpha_post=request.alpha_post,
                high_frequency_ratio=request.high_frequency_ratio,
                signal_state=request.signal_state,
                quality_good=request.quality_good,
                quality_questionable=request.quality_questionable,
                quality_bad=request.quality_bad,
            )
            self._recording_calibration_markers.append(marker)
            self._write_recording_metadata_locked()
            return self._recording_state_locked()

    def list_recordings(self) -> list[RecordingStateResponse]:
        if not self._recording_dir.exists():
            return []

        recordings: list[RecordingStateResponse] = []
        for metadata_path in sorted(self._recording_dir.glob("*.json"), reverse=True):
            try:
                recordings.append(RecordingStateResponse(**loads(metadata_path.read_text())))
            except Exception:
                continue
        return recordings

    def get_recording(self, session_id: str) -> RecordingStateResponse:
        metadata_path = self._recording_metadata_path_for_session(session_id)
        if not metadata_path.exists():
            raise FileNotFoundError(session_id)
        return RecordingStateResponse(**loads(metadata_path.read_text()))

    def update_recording(
        self,
        session_id: str,
        request: RecordingUpdateRequest,
    ) -> RecordingStateResponse:
        metadata_path = self._recording_metadata_path_for_session(session_id)
        if not metadata_path.exists():
            raise FileNotFoundError(session_id)

        with self._lock:
            if session_id == self._recording_session_id:
                self._recording_label = request.label
                self._write_recording_metadata_locked()
                return self._recording_state_locked()

        recording = RecordingStateResponse(**loads(metadata_path.read_text()))
        updated = recording.model_copy(update={"label": request.label})
        metadata_path.write_text(dumps(updated.model_dump(mode="json"), indent=2))
        return updated

    def delete_recording(self, session_id: str) -> None:
        metadata_path = self._recording_metadata_path_for_session(session_id)
        if not metadata_path.exists():
            raise FileNotFoundError(session_id)

        with self._lock:
            if session_id == self._recording_session_id and self._recording_stopped_at is None:
                raise RuntimeError("Cannot delete an active recording")

        recording = RecordingStateResponse(**loads(metadata_path.read_text()))
        paths = [metadata_path]
        if recording.file_path:
            csv_path = Path(recording.file_path)
            if csv_path.parent.resolve() == self._recording_dir.resolve():
                paths.append(csv_path)

        for path in paths:
            try:
                path.unlink()
            except FileNotFoundError:
                continue

        with self._lock:
            if session_id == self._recording_session_id:
                self._clear_recording_state_locked()

    def recording_csv_path(self, session_id: str) -> Path:
        recording = self.get_recording(session_id)
        if recording.file_path is None:
            raise FileNotFoundError(session_id)
        csv_path = Path(recording.file_path)
        if not csv_path.exists() or csv_path.parent.resolve() != self._recording_dir.resolve():
            raise FileNotFoundError(session_id)
        return csv_path

    def preview_recording(
        self,
        session_id: str,
        limit: int = 500,
        offset: int = 0,
    ) -> RecordingPreviewResponse:
        recording, headers, rows, total_rows = self._read_recording_rows(
            session_id=session_id,
            limit=limit,
            offset=offset,
        )

        return RecordingPreviewResponse(
            recording=recording,
            headers=headers,
            rows=rows,
            offset=max(0, offset),
            row_count=len(rows),
            total_rows=total_rows,
        )

    def calibration_report(
        self,
        session_id: str,
        context_samples: int = 250,
    ) -> RecordingCalibrationReportResponse:
        recording = self.get_recording(session_id)
        csv_path = self.recording_csv_path(session_id)
        safe_context = max(0, context_samples)
        markers = sorted(
            recording.calibration_markers,
            key=lambda item: item.recording_sample_index,
        )
        marker_offsets = [
            max(0, max(0, marker.recording_sample_index) - safe_context) for marker in markers
        ]
        marker_ends = [offset + safe_context * 2 + 1 for offset in marker_offsets]
        marker_rows: list[list[list[float]]] = [[] for _ in markers]
        headers: list[str] = []
        total_rows = 0

        with csv_path.open(newline="") as csv_file:
            csv_reader = reader(csv_file)
            headers = next(csv_reader, [])
            next_marker_index = 0
            active_marker_indices: list[int] = []

            for row in csv_reader:
                try:
                    parsed = [float(value) for value in row]
                except ValueError:
                    continue
                if headers and len(parsed) < len(headers):
                    continue

                while (
                    next_marker_index < len(markers)
                    and marker_offsets[next_marker_index] <= total_rows
                ):
                    active_marker_indices.append(next_marker_index)
                    next_marker_index += 1

                still_active: list[int] = []
                for marker_index in active_marker_indices:
                    if total_rows < marker_ends[marker_index]:
                        marker_rows[marker_index].append(parsed)
                        still_active.append(marker_index)
                active_marker_indices = still_active
                total_rows += 1

        marker_windows: list[RecordingCalibrationMarkerWindow] = []

        for marker, marker_offset, rows in zip(markers, marker_offsets, marker_rows, strict=True):
            marker_index = max(0, marker.recording_sample_index)
            marker_row_offset = marker_index - marker_offset
            if marker_row_offset < 0 or marker_row_offset >= len(rows):
                marker_row_offset = None

            marker_windows.append(
                RecordingCalibrationMarkerWindow(
                    marker=marker,
                    headers=headers,
                    rows=rows,
                    offset=marker_offset,
                    row_count=len(rows),
                    total_rows=total_rows,
                    marker_row_offset=marker_row_offset,
                )
            )

        return RecordingCalibrationReportResponse(
            generated_at=self._now(),
            recording=recording,
            headers=headers,
            context_samples=safe_context,
            total_rows=total_rows,
            marker_windows=marker_windows,
            message=(
                None
                if marker_windows
                else "Recording does not include persisted calibration markers"
            ),
        )

    def analyze_recording(
        self,
        session_id: str,
        limit: int = 1000,
        offset: int = 0,
        bandpass_low_hz: float = 1.0,
        bandpass_high_hz: float = 45.0,
        notch_frequency_hz: float | None = DEFAULT_LINE_FREQUENCY_HZ,
    ) -> RecordingSpectralAnalysisResponse:
        recording, headers, rows, total_rows = self._read_recording_rows(
            session_id=session_id,
            limit=limit,
            offset=offset,
        )
        sampling_rate = recording.sampling_rate
        if sampling_rate is None:
            return RecordingSpectralAnalysisResponse(
                recording=recording,
                sample_count=len(rows),
                total_rows=total_rows,
                offset=max(0, offset),
                sampling_rate=None,
                bandpass_low_hz=bandpass_low_hz,
                bandpass_high_hz=bandpass_high_hz,
                notch_frequency_hz=notch_frequency_hz,
                message="Recording metadata does not include a sampling rate",
            )

        low_hz, high_hz = self._effective_bandpass_bounds(
            sampling_rate=sampling_rate,
            bandpass_low_hz=bandpass_low_hz,
            bandpass_high_hz=bandpass_high_hz,
        )
        labels = headers[1:]
        channels: list[DspChannelSummary] = []
        if rows and labels:
            values = np.asarray(rows, dtype=float)
            for offset_index, label in enumerate(labels):
                column_index = offset_index + 1
                if column_index >= values.shape[1]:
                    continue
                channels.append(
                    self._summarize_dsp_channel(
                        index=column_index,
                        label=label,
                        samples=np.asarray(values[:, column_index], dtype=float),
                        sampling_rate=sampling_rate,
                        bandpass_low_hz=low_hz,
                        bandpass_high_hz=high_hz,
                        notch_frequency_hz=notch_frequency_hz,
                    )
                )

        return RecordingSpectralAnalysisResponse(
            recording=recording,
            sample_count=len(rows),
            total_rows=total_rows,
            offset=max(0, offset),
            sampling_rate=sampling_rate,
            bandpass_low_hz=low_hz,
            bandpass_high_hz=high_hz,
            notch_frequency_hz=notch_frequency_hz,
            channels=channels,
        )

    def _read_recording_rows(
        self,
        *,
        session_id: str,
        limit: int,
        offset: int,
    ) -> tuple[RecordingStateResponse, list[str], list[list[float]], int]:
        recording = self.get_recording(session_id)
        csv_path = self.recording_csv_path(session_id)
        safe_limit = max(1, limit)
        safe_offset = max(0, offset)
        headers: list[str] = []
        rows: list[list[float]] = []
        total_rows = 0

        with csv_path.open(newline="") as csv_file:
            csv_reader = reader(csv_file)
            headers = next(csv_reader, [])
            for row in csv_reader:
                try:
                    parsed = [float(value) for value in row]
                except ValueError:
                    continue
                if headers and len(parsed) < len(headers):
                    continue
                if total_rows >= safe_offset and len(rows) < safe_limit:
                    rows.append(parsed)
                total_rows += 1

        return recording, headers, rows, total_rows

    def start_recording(
        self, request: RecordingStartRequest, *, require_new: bool = False
    ) -> RecordingStateResponse:
        with self._lock:
            self._require_board_locked()
            if self._status != BoardStatus.streaming:
                raise RuntimeError("Board must be streaming before recording can start")
            if self._recording_session_id and self._recording_stopped_at is None:
                if require_new:
                    raise RuntimeError("Save the current recording before starting an experiment")
                return self._recording_state_locked()

            self._recording_dir.mkdir(parents=True, exist_ok=True)
            session_id = self._build_recording_session_id_locked(request.label)
            file_path = self._recording_dir / f"{session_id}.csv"
            metadata_path = self._recording_dir / f"{session_id}.json"

            eeg_channels = self._safe_eeg_channels_locked()
            eeg_names = self._safe_eeg_names_locked()
            if not eeg_channels:
                raise RuntimeError("Board does not expose EEG channels")
            eeg_names = self._normalize_eeg_names(eeg_names, len(eeg_channels))

            try:
                with file_path.open("w", newline="") as csv_file:
                    writer(csv_file).writerow(["timestamp", *eeg_names])

                self._recording_session_id = session_id
                self._recording_label = request.label
                self._recording_file_path = file_path
                self._recording_metadata_path = metadata_path
                self._recording_started_at = self._now()
                self._recording_stopped_at = None
                self._recording_sample_count = 0
                self._recording_last_timestamp = None
                self._recording_board = self._board_kind
                self._recording_board_id = self._board_id
                self._recording_sampling_rate = self._safe_sampling_rate_locked()
                self._recording_eeg_channels = eeg_channels
                self._recording_eeg_names = eeg_names
                self._recording_setup_quality_snapshots = []
                self._recording_calibration_markers = []
                self._recording_message = None
                self._recording_stop_event = threading.Event()
                self._write_recording_metadata_locked()

                self._recording_thread = threading.Thread(
                    target=self._recording_loop,
                    args=(session_id, self._recording_stop_event),
                    name=f"recording-{session_id}",
                    daemon=True,
                )
                self._recording_thread.start()
            except Exception as exc:
                # Initialization must either publish a working recorder or roll back.
                self._request_recording_stop_locked()
                self._clear_recording_state_locked()
                for artifact in (file_path, metadata_path):
                    try:
                        artifact.unlink(missing_ok=True)
                    except OSError as cleanup_error:
                        exc.add_note(f"Could not remove recording artifact: {cleanup_error}")
                raise
            return self._recording_state_locked()

    def stop_recording(self, *, expected_session_id: str | None = None) -> RecordingStateResponse:
        thread: threading.Thread | None
        with self._lock:
            if (
                expected_session_id is not None
                and expected_session_id != self._recording_session_id
            ):
                raise RuntimeError("The active recording has changed; refresh before saving")
            if not self._recording_session_id or self._recording_stopped_at is not None:
                return self._recording_state_locked()
            stopping_session_id = self._recording_session_id
            thread = self._request_recording_stop_locked()

        if thread and thread is not threading.current_thread():
            thread.join(timeout=2)

        with self._lock:
            if self._recording_session_id != stopping_session_id:
                return self._recording_state_locked()
            self._flush_recording_locked()
            self._finalize_recording_locked()
            return self._recording_state_locked()

    def _state_locked(self) -> BoardStateResponse:
        self._reconcile_board_locked()
        return BoardStateResponse(
            status=self._status,
            board=self._board_kind,
            board_id=self._board_id,
            serial_port=self._serial_port,
            sampling_rate=self._safe_sampling_rate_locked(),
            eeg_channels=self._safe_eeg_channels_locked(),
            eeg_names=self._safe_eeg_names_locked(),
            message=self._last_error,
        )

    def _require_board_locked(self) -> BoardShim:
        self._reconcile_board_locked()
        if self._board is None:
            raise RuntimeError("No board session is prepared")
        return self._board

    def _current_board_data_locked(self, max_samples: int) -> np.ndarray:
        self._reconcile_board_locked()
        if self._board is None:
            return np.empty((0, 0))
        try:
            return self._board.get_current_board_data(max_samples)
        except BrainFlowError as exc:
            self._recover_board_locked(str(exc))
            return np.empty((0, 0))

    def _reconcile_board_locked(self) -> None:
        if self._board is None:
            return
        try:
            prepared = self._board.is_prepared()
        except BrainFlowError as exc:
            self._recover_board_locked(str(exc))
            return
        if not prepared:
            self._recover_board_locked("Native board session is no longer prepared")

    def _recover_board_locked(self, reason: str) -> None:
        message = f"Signal paused: {reason}. Reset and connect again."
        if self._recording_session_id and self._recording_stopped_at is None:
            self._recording_message = message
        try:
            # Recovery already knows the native session is unusable; do not read it again.
            self._release_locked(flush_recording=False)
        except RuntimeError as exc:
            message = f"{message} {exc}"
        except OSError as exc:
            message = f"{message} Recording metadata could not be saved: {exc}"
            self._recording_message = message
        finally:
            self._status = BoardStatus.error
            self._last_error = message
            self._reset_calm_calibration_locked()

    def _release_locked(self, *, flush_recording: bool = True) -> None:
        self._request_recording_stop_locked()
        try:
            if (
                flush_recording
                and self._recording_session_id
                and self._recording_stopped_at is None
            ):
                try:
                    self._flush_recording_locked(recover_board=False)
                except BrainFlowError as exc:
                    # A lost session has no readable tail. Teardown below owns recovery.
                    self._recording_message = f"Signal paused: {exc}. Reset and connect again."
                except OSError as exc:
                    self._recording_message = f"Recording could not be fully saved: {exc}"
                    raise
        finally:
            self._release_native_and_finalize_locked()

    def _release_native_and_finalize_locked(self) -> None:
        released = self._board is None
        release_error: BrainFlowError | None = None
        if self._board is not None:
            if self._status == BoardStatus.streaming:
                try:
                    self._board.stop_stream()
                except BrainFlowError:
                    # A failed stop must not prevent releasing a lost/stopped native session.
                    pass
            try:
                self._board.release_session()
                released = True
            except BrainFlowError as exc:
                if exc.exit_code == BrainFlowExitCodes.BOARD_NOT_CREATED_ERROR.value:
                    released = True
                else:
                    release_error = exc
        try:
            self._finalize_recording_locked()
        finally:
            self._reset_calm_calibration_locked()
            if released:
                self._board = None
                self._board_kind = None
                self._board_id = None
                self._serial_port = None
                self._status = BoardStatus.idle
                self._last_error = None
            else:
                self._status = BoardStatus.error
                self._last_error = f"Could not release the board: {release_error}. Try Reset again."
        if not released:
            raise RuntimeError(self._last_error)

    def _collect_calm_baseline_locked(self) -> None:
        if self._calm_calibration_status != CalmCalibrationStatus.running:
            return

        feature = self._calm_feature_locked(
            window_size=self._calm_calibration_window_size,
            line_frequency_hz=self._calm_calibration_line_frequency_hz,
            posterior_labels=self._calm_calibration_posterior_labels,
            baseline_median=None,
            baseline_mad=None,
            update_trend=False,
        )
        raw_index = feature.features.get("raw_calm_index")
        now = monotonic()
        enough_time_since_accept = (
            self._calm_calibration_last_accept_monotonic is None
            or now - self._calm_calibration_last_accept_monotonic >= 0.5
        )
        source_timestamp = feature.source_timestamp
        source_advanced = (
            source_timestamp is not None
            and np.isfinite(source_timestamp)
            and (
                self._calm_calibration_last_source_timestamp is None
                or source_timestamp > self._calm_calibration_last_source_timestamp
            )
        )
        if (
            feature.signal_state == CalmSignalState.usable
            and raw_index is not None
            and enough_time_since_accept
            and source_advanced
        ):
            self._calm_calibration_values.append(raw_index)
            self._calm_calibration_last_accept_monotonic = now
            self._calm_calibration_last_source_timestamp = source_timestamp

        elapsed_seconds = self._calm_calibration_elapsed_seconds_locked()
        if elapsed_seconds < self._calm_calibration_target_duration_seconds:
            return

        if not source_advanced:
            self._calm_calibration_status = CalmCalibrationStatus.failed
            self._calm_calibration_completed_at = self._now()
            self._calm_calibration_elapsed_at_completion = elapsed_seconds
            self._calm_calibration_message = (
                "Baseline failed because signal timestamps stopped advancing"
            )
            return

        if len(self._calm_calibration_values) < CALM_REQUIRED_BASELINE_WINDOWS:
            self._calm_calibration_status = CalmCalibrationStatus.failed
            self._calm_calibration_completed_at = self._now()
            self._calm_calibration_elapsed_at_completion = elapsed_seconds
            self._calm_calibration_message = (
                "Baseline failed because too few usable signal windows were collected"
            )
            return

        values = np.asarray(self._calm_calibration_values, dtype=float)
        median = float(np.median(values))
        mad = float(np.median(np.abs(values - median)))
        self._calm_calibration_baseline_median = median
        self._calm_calibration_baseline_mad = max(mad, 0.05)
        self._calm_calibration_status = CalmCalibrationStatus.complete
        self._calm_calibration_completed_at = self._now()
        self._calm_calibration_elapsed_at_completion = elapsed_seconds
        self._calm_calibration_message = "Baseline complete"

    def _calm_feature_locked(
        self,
        *,
        window_size: int,
        line_frequency_hz: float,
        posterior_labels: list[str],
        baseline_median: float | None,
        baseline_mad: float | None,
        update_trend: bool,
        baseline_mismatch: bool = False,
    ) -> CalmFeatureResponse:
        baseline = self._calm_calibration_state_locked()
        if self._board is None or self._board_id is None:
            return CalmFeatureResponse(
                status=self._status,
                window_size=window_size,
                line_frequency_hz=line_frequency_hz,
                posterior_labels=posterior_labels,
                flags=["board_unavailable"],
                baseline=baseline,
                message=self._last_error,
            )

        sampling_rate = self._safe_sampling_rate_locked()
        if self._status != BoardStatus.streaming or sampling_rate is None:
            return CalmFeatureResponse(
                status=self._status,
                board=self._board_kind,
                board_id=self._board_id,
                sampling_rate=sampling_rate,
                window_size=window_size,
                line_frequency_hz=line_frequency_hz,
                posterior_labels=posterior_labels,
                flags=["stream_unavailable"],
                baseline=baseline,
                message=self._last_error or "Board must be streaming for calm features",
            )

        data = self._current_board_data_locked(window_size)
        if self._status != BoardStatus.streaming:
            return CalmFeatureResponse(
                status=self._status,
                window_size=window_size,
                line_frequency_hz=line_frequency_hz,
                posterior_labels=posterior_labels,
                flags=["board_unavailable"],
                baseline=self._calm_calibration_state_locked(),
                message=self._last_error,
            )
        sample_count = int(data.shape[1]) if data.size else 0
        timestamp_channel = self._safe_timestamp_channel_locked()
        source_timestamp = (
            float(data[timestamp_channel][-1])
            if timestamp_channel is not None and sample_count
            else None
        )
        eeg_channels = self._safe_eeg_channels_locked()
        eeg_names = self._normalize_eeg_names(self._safe_eeg_names_locked(), len(eeg_channels))
        channels = [
            (channel_index, eeg_names[offset], np.asarray(data[channel_index], dtype=float))
            for offset, channel_index in enumerate(eeg_channels)
            if sample_count
        ]
        summary = self._summarize_calm_window(
            channels=channels,
            sampling_rate=sampling_rate,
            line_frequency_hz=line_frequency_hz,
            posterior_labels=posterior_labels,
            baseline_median=baseline_median,
            baseline_mad=baseline_mad,
            allow_posterior_fallback=self._board_kind
            in {BoardKind.synthetic, BoardKind.cyton, BoardKind.cyton_daisy},
        )
        flags = list(summary["flags"])
        if baseline_mismatch:
            flags.append("baseline_mismatch")

        calm_score = summary["calm_score"]
        trend: float | None = None
        if isinstance(calm_score, float):
            if self._calm_previous_score is not None:
                trend = calm_score - self._calm_previous_score
            if update_trend:
                self._calm_previous_score = calm_score
        elif update_trend:
            self._calm_previous_score = None

        return CalmFeatureResponse(
            status=self._status,
            board=self._board_kind,
            board_id=self._board_id,
            sample_count=int(summary["sample_count"]),
            source_timestamp=source_timestamp,
            sampling_rate=sampling_rate,
            window_size=window_size,
            line_frequency_hz=line_frequency_hz,
            posterior_labels=posterior_labels,
            used_labels=list(summary["used_labels"]),
            signal_state=summary["signal_state"],
            confidence=float(summary["confidence"]),
            calm_score=calm_score,
            trend=trend,
            flags=flags,
            features=dict(summary["features"]),
            baseline=baseline,
            message=self._last_error,
        )

    def _calm_calibration_state_locked(self) -> CalmCalibrationState:
        return CalmCalibrationState(
            status=self._calm_calibration_status,
            label=self._calm_calibration_label,
            started_at=self._calm_calibration_started_at,
            completed_at=self._calm_calibration_completed_at,
            elapsed_seconds=self._calm_calibration_elapsed_seconds_locked(),
            target_duration_seconds=self._calm_calibration_target_duration_seconds,
            accepted_windows=len(self._calm_calibration_values),
            required_windows=CALM_REQUIRED_BASELINE_WINDOWS,
            baseline_median=self._calm_calibration_baseline_median,
            baseline_mad=self._calm_calibration_baseline_mad,
            line_frequency_hz=self._calm_calibration_line_frequency_hz,
            window_size=self._calm_calibration_window_size,
            posterior_labels=self._calm_calibration_posterior_labels,
            message=self._calm_calibration_message,
        )

    def _calm_calibration_elapsed_seconds_locked(self) -> float:
        if self._calm_calibration_started_monotonic is None:
            return 0.0
        if self._calm_calibration_status == CalmCalibrationStatus.inactive:
            return 0.0
        if (
            self._calm_calibration_status
            in {CalmCalibrationStatus.complete, CalmCalibrationStatus.failed}
            and self._calm_calibration_elapsed_at_completion is not None
        ):
            return self._calm_calibration_elapsed_at_completion
        return max(0.0, monotonic() - self._calm_calibration_started_monotonic)

    def _calm_baseline_matches_locked(
        self,
        *,
        window_size: int,
        line_frequency_hz: float,
        posterior_labels: list[str],
    ) -> bool:
        return (
            window_size == self._calm_calibration_window_size
            and abs(line_frequency_hz - self._calm_calibration_line_frequency_hz) < 1e-9
            and self._normalize_calm_labels(posterior_labels)
            == self._normalize_calm_labels(self._calm_calibration_posterior_labels)
        )

    @staticmethod
    def _normalize_calm_labels(labels: list[str]) -> list[str]:
        return [BrainFlowBoardService._calm_label_key(label) for label in labels]

    @staticmethod
    def _calm_label_key(label: str) -> str:
        return sub(r"[^a-z0-9]", "", label.strip().lower())

    def _reset_calm_calibration_locked(self) -> None:
        self._calm_calibration_status = CalmCalibrationStatus.inactive
        self._calm_calibration_label = None
        self._calm_calibration_started_at = None
        self._calm_calibration_completed_at = None
        self._calm_calibration_started_monotonic = None
        self._calm_calibration_elapsed_at_completion = None
        self._calm_calibration_target_duration_seconds = 30
        self._calm_calibration_line_frequency_hz = DEFAULT_LINE_FREQUENCY_HZ
        self._calm_calibration_window_size = 1000
        self._calm_calibration_posterior_labels = list(DEFAULT_CALM_POSTERIOR_LABELS)
        self._calm_calibration_values = []
        self._calm_calibration_last_accept_monotonic = None
        self._calm_calibration_last_source_timestamp = None
        self._calm_calibration_baseline_median = None
        self._calm_calibration_baseline_mad = None
        self._calm_calibration_message = None
        self._calm_previous_score = None

    def _safe_sampling_rate_locked(self) -> int | None:
        if self._board_id is None:
            return None
        try:
            return BoardShim.get_sampling_rate(self._board_id)
        except Exception:
            return None

    def _safe_eeg_channels_locked(self) -> list[int]:
        if self._board_id is None:
            return []
        try:
            return list(BoardShim.get_eeg_channels(self._board_id))
        except Exception:
            return []

    def _safe_eeg_names_locked(self) -> list[str]:
        if self._board_id is None:
            return []
        try:
            return list(BoardShim.get_eeg_names(self._board_id))
        except Exception:
            return []

    def _safe_timestamp_channel_locked(self) -> int | None:
        if self._board_id is None:
            return None
        try:
            return BoardShim.get_timestamp_channel(self._board_id)
        except Exception:
            return None

    @staticmethod
    def _normalize_eeg_names(eeg_names: list[str], channel_count: int) -> list[str]:
        return [
            eeg_names[index] if index < len(eeg_names) and eeg_names[index] else f"Ch {index + 1}"
            for index in range(channel_count)
        ]

    @staticmethod
    def _summarize_dsp_channel(
        *,
        index: int,
        label: str,
        samples: np.ndarray,
        sampling_rate: int,
        bandpass_low_hz: float,
        bandpass_high_hz: float,
        notch_frequency_hz: float | None,
    ) -> DspChannelSummary:
        low_hz, high_hz = BrainFlowBoardService._effective_bandpass_bounds(
            sampling_rate=sampling_rate,
            bandpass_low_hz=bandpass_low_hz,
            bandpass_high_hz=bandpass_high_hz,
        )
        filtered = BrainFlowBoardService._filtered_samples(
            samples=samples,
            sampling_rate=sampling_rate,
            bandpass_low_hz=low_hz,
            bandpass_high_hz=high_hz,
            notch_frequency_hz=notch_frequency_hz,
        )
        sample_count = int(filtered.size)
        if sample_count < 2:
            return DspChannelSummary(
                index=index,
                label=label,
                sample_count=sample_count,
                rms=0.0,
                total_power=0.0,
                band_powers=[
                    DspBandPower(
                        name=name,
                        low_hz=low_hz,
                        high_hz=high_hz,
                        power=0.0,
                        relative_power=0.0,
                    )
                    for name, low_hz, high_hz in EEG_BANDS
                ],
            )

        window = np.hanning(sample_count)
        windowed = filtered * window
        freqs = np.fft.rfftfreq(sample_count, d=1.0 / sampling_rate)
        scale = sampling_rate * float(np.sum(window**2)) or 1.0
        power_spectrum = np.abs(np.fft.rfft(windowed)) ** 2 / scale

        total_mask = (freqs >= low_hz) & (freqs <= high_hz)
        total_power = float(np.sum(power_spectrum[total_mask])) if np.any(total_mask) else 0.0
        if np.any(total_mask):
            dominant_index = int(np.argmax(power_spectrum[total_mask]))
            dominant_frequency = float(freqs[total_mask][dominant_index])
        else:
            dominant_frequency = None

        band_powers: list[DspBandPower] = []
        for name, low_hz, high_hz in EEG_BANDS:
            band_mask = (freqs >= low_hz) & (freqs < high_hz)
            power = float(np.sum(power_spectrum[band_mask])) if np.any(band_mask) else 0.0
            band_powers.append(
                DspBandPower(
                    name=name,
                    low_hz=low_hz,
                    high_hz=high_hz,
                    power=power,
                    relative_power=power / total_power if total_power > 0 else 0.0,
                )
            )

        return DspChannelSummary(
            index=index,
            label=label,
            sample_count=sample_count,
            rms=float(np.sqrt(np.mean(filtered**2))),
            dominant_frequency_hz=dominant_frequency,
            total_power=total_power,
            band_powers=band_powers,
        )

    @staticmethod
    def _summarize_signal_quality_channel(
        *,
        index: int,
        label: str,
        samples: np.ndarray,
        sampling_rate: int,
        line_frequency_hz: float,
        flatline_threshold: float,
        rail_threshold: float,
        noise_rms_threshold: float,
    ) -> SignalQualityChannel:
        raw = np.asarray(samples, dtype=float)
        sample_count = int(raw.size)
        finite_mask = np.isfinite(raw)
        finite_sample_count = int(np.sum(finite_mask))
        finite_ratio = finite_sample_count / sample_count if sample_count else 0.0
        issues: list[str] = []
        bad = False

        if sample_count < 64:
            issues.append("low_sample_count")

        if finite_sample_count == 0:
            return SignalQualityChannel(
                index=index,
                label=label,
                status=SignalQualityStatus.bad,
                sample_count=sample_count,
                finite_sample_count=0,
                finite_ratio=finite_ratio,
                mean=0.0,
                rms=0.0,
                filtered_rms=0.0,
                standard_deviation=0.0,
                peak_to_peak=0.0,
                minimum=0.0,
                maximum=0.0,
                line_noise_ratio=0.0,
                issues=[*issues, "no_finite_samples"],
            )

        if finite_ratio < 0.95:
            issues.append("dropouts")
            bad = True
        elif finite_ratio < 1.0:
            issues.append("limited_dropouts")

        clean = raw[finite_mask]
        minimum = float(np.min(clean))
        maximum = float(np.max(clean))
        mean = float(np.mean(clean))
        centered = clean - mean
        rms = float(np.sqrt(np.mean(centered**2)))
        standard_deviation = float(np.std(clean))
        peak_to_peak = float(maximum - minimum)
        max_abs = float(np.max(np.abs(clean)))
        filtered = BrainFlowBoardService._filtered_samples(
            samples=clean,
            sampling_rate=sampling_rate,
            bandpass_low_hz=1.0,
            bandpass_high_hz=45.0,
            notch_frequency_hz=line_frequency_hz,
        )
        filtered_rms = float(np.sqrt(np.mean(filtered**2))) if filtered.size else 0.0

        if peak_to_peak <= flatline_threshold:
            issues.append("flatline")
            bad = True
        if max_abs >= rail_threshold:
            issues.append("railing")
            bad = True
        if filtered_rms >= noise_rms_threshold:
            issues.append("high_eeg_noise")

        line_noise_ratio = BrainFlowBoardService._line_noise_ratio(
            samples=centered,
            sampling_rate=sampling_rate,
            line_frequency_hz=line_frequency_hz,
        )
        if line_noise_ratio >= 0.25:
            issues.append("line_noise")

        status = SignalQualityStatus.bad if bad else SignalQualityStatus.good
        if status == SignalQualityStatus.good and issues:
            status = SignalQualityStatus.questionable

        return SignalQualityChannel(
            index=index,
            label=label,
            status=status,
            sample_count=sample_count,
            finite_sample_count=finite_sample_count,
            finite_ratio=finite_ratio,
            mean=mean,
            rms=rms,
            filtered_rms=filtered_rms,
            standard_deviation=standard_deviation,
            peak_to_peak=peak_to_peak,
            minimum=minimum,
            maximum=maximum,
            line_noise_ratio=line_noise_ratio,
            issues=issues,
        )

    @staticmethod
    def _summarize_calm_window(
        *,
        channels: list[tuple[int, str, np.ndarray]],
        sampling_rate: int,
        line_frequency_hz: float,
        posterior_labels: list[str],
        baseline_median: float | None = None,
        baseline_mad: float | None = None,
        allow_posterior_fallback: bool = False,
    ) -> dict[str, object]:
        if not channels:
            return {
                "sample_count": 0,
                "used_labels": [],
                "signal_state": CalmSignalState.unavailable,
                "confidence": 0.0,
                "calm_score": None,
                "flags": ["no_eeg_channels"],
                "features": {},
            }

        sample_count = min(int(samples.size) for _, _, samples in channels)
        if sample_count < max(128, sampling_rate * 2):
            return {
                "sample_count": sample_count,
                "used_labels": [],
                "signal_state": CalmSignalState.unavailable,
                "confidence": 0.0,
                "calm_score": None,
                "flags": ["insufficient_samples"],
                "features": {},
            }

        normalized_posterior = {
            BrainFlowBoardService._calm_label_key(label) for label in posterior_labels
        }
        posterior_channels = [
            (index, label, samples[-sample_count:])
            for index, label, samples in channels
            if BrainFlowBoardService._calm_label_key(label) in normalized_posterior
        ]
        flags: list[str] = []
        if not posterior_channels and allow_posterior_fallback:
            posterior_channels = BrainFlowBoardService._calm_posterior_fallback_channels(
                channels=channels,
                sample_count=sample_count,
            )
            if posterior_channels:
                flags.append("posterior_fallback")
        if not posterior_channels:
            return {
                "sample_count": sample_count,
                "used_labels": [],
                "signal_state": CalmSignalState.noisy,
                "confidence": 0.0,
                "calm_score": None,
                "flags": ["missing_posterior_channels"],
                "features": {},
            }

        quality_by_index = {
            index: BrainFlowBoardService._summarize_signal_quality_channel(
                index=index,
                label=label,
                samples=samples[-sample_count:],
                sampling_rate=sampling_rate,
                line_frequency_hz=line_frequency_hz,
                flatline_threshold=1.0,
                rail_threshold=150_000.0,
                noise_rms_threshold=150.0,
            )
            for index, label, samples in channels
        }
        posterior_quality = [quality_by_index[index] for index, _, _ in posterior_channels]
        quality_scores = [
            1.0
            if quality.status == SignalQualityStatus.good
            else 0.5
            if quality.status == SignalQualityStatus.questionable
            else 0.0
            for quality in posterior_quality
        ]
        max_line_noise = max(
            (quality.line_noise_ratio for quality in posterior_quality),
            default=0.0,
        )
        confidence = max(0.0, min(1.0, float(np.mean(quality_scores)) - max_line_noise * 0.5))
        if any(quality.status == SignalQualityStatus.bad for quality in posterior_quality):
            flags.append("bad_posterior_signal")
        if max_line_noise >= 0.25:
            flags.append("line_noise")

        all_band_powers = [
            BrainFlowBoardService._calm_band_powers(
                samples=samples[-sample_count:],
                sampling_rate=sampling_rate,
                line_frequency_hz=line_frequency_hz,
            )
            for _, _, samples in channels
        ]
        posterior_band_powers = [
            BrainFlowBoardService._calm_band_powers(
                samples=samples[-sample_count:],
                sampling_rate=sampling_rate,
                line_frequency_hz=line_frequency_hz,
            )
            for _, _, samples in posterior_channels
        ]

        alpha_post = float(np.mean([powers["alpha"] for powers in posterior_band_powers]))
        theta_post = float(np.mean([powers["theta"] for powers in posterior_band_powers]))
        beta_mean = float(np.mean([powers["beta"] for powers in all_band_powers]))
        gamma_mean = float(np.mean([powers["gamma"] for powers in all_band_powers]))
        alpha_beta_ratio = alpha_post / max(beta_mean, 1e-12)
        high_frequency_ratio = gamma_mean / max(
            alpha_post + beta_mean + gamma_mean,
            1e-12,
        )
        raw_calm_index = float(
            np.log1p(alpha_post)
            - 0.65 * np.log1p(beta_mean)
            - 0.35 * np.log1p(gamma_mean)
            - 1.5 * max_line_noise
        )

        features = {
            "alpha_post": alpha_post,
            "theta_post": theta_post,
            "beta": beta_mean,
            "gamma": gamma_mean,
            "alpha_beta_ratio": alpha_beta_ratio,
            "high_frequency_ratio": high_frequency_ratio,
            "line_noise": max_line_noise,
            "raw_calm_index": raw_calm_index,
        }

        signal_state = CalmSignalState.usable
        if confidence < 0.6 or "bad_posterior_signal" in flags:
            signal_state = CalmSignalState.noisy
        if high_frequency_ratio >= 0.8:
            flags.append("high_frequency_noise")
            signal_state = CalmSignalState.noisy

        calm_score: float | None = None
        if signal_state == CalmSignalState.usable:
            if baseline_median is None or baseline_mad is None:
                flags.append("baseline_required")
            else:
                z_score = (raw_calm_index - baseline_median) / max(baseline_mad * 2.5, 0.05)
                calm_score = float(1.0 / (1.0 + np.exp(-z_score)))
                calm_score = max(0.0, min(1.0, calm_score))

        return {
            "sample_count": sample_count,
            "used_labels": [label for _, label, _ in posterior_channels],
            "signal_state": signal_state,
            "confidence": confidence,
            "calm_score": calm_score,
            "flags": flags,
            "features": features,
        }

    @staticmethod
    def _calm_posterior_fallback_channels(
        *,
        channels: list[tuple[int, str, np.ndarray]],
        sample_count: int,
    ) -> list[tuple[int, str, np.ndarray]]:
        labeled_candidates = [
            (index, label, samples[-sample_count:])
            for index, label, samples in channels
            if BrainFlowBoardService._calm_label_key(label) in CALM_POSTERIOR_FALLBACK_LABELS
        ]
        if labeled_candidates:
            return labeled_candidates[-4:]

        return [(index, label, samples[-sample_count:]) for index, label, samples in channels[-4:]]

    @staticmethod
    def _calm_band_powers(
        *,
        samples: np.ndarray,
        sampling_rate: int,
        line_frequency_hz: float,
    ) -> dict[str, float]:
        filtered = BrainFlowBoardService._filtered_samples(
            samples=np.asarray(samples, dtype=float),
            sampling_rate=sampling_rate,
            bandpass_low_hz=1.0,
            bandpass_high_hz=45.0,
            notch_frequency_hz=line_frequency_hz,
        )
        if filtered.size < 2:
            return {"theta": 0.0, "alpha": 0.0, "beta": 0.0, "gamma": 0.0}

        window = np.hanning(filtered.size)
        freqs = np.fft.rfftfreq(filtered.size, d=1.0 / sampling_rate)
        scale = sampling_rate * float(np.sum(window**2)) or 1.0
        power_spectrum = np.abs(np.fft.rfft(filtered * window)) ** 2 / scale
        return {
            name: BrainFlowBoardService._integrated_power(power_spectrum, freqs, low_hz, high_hz)
            for name, low_hz, high_hz in (
                ("theta", 4.0, 8.0),
                ("alpha", 8.0, 13.0),
                ("beta", 13.0, 30.0),
                ("gamma", 30.0, 45.0),
            )
        }

    @staticmethod
    def _integrated_power(
        power_spectrum: np.ndarray, freqs: np.ndarray, low_hz: float, high_hz: float
    ) -> float:
        mask = (freqs >= low_hz) & (freqs < high_hz)
        return float(np.sum(power_spectrum[mask])) if np.any(mask) else 0.0

    @staticmethod
    def _line_noise_ratio(
        *,
        samples: np.ndarray,
        sampling_rate: int,
        line_frequency_hz: float,
    ) -> float:
        if samples.size < 4 or line_frequency_hz <= 0:
            return 0.0

        nyquist = sampling_rate / 2.0
        if line_frequency_hz >= nyquist:
            return 0.0

        window = np.hanning(samples.size)
        freqs = np.fft.rfftfreq(samples.size, d=1.0 / sampling_rate)
        power_spectrum = np.abs(np.fft.rfft(samples * window)) ** 2
        total_mask = (freqs >= 1.0) & (freqs <= nyquist)
        line_mask = (
            total_mask & (freqs >= line_frequency_hz - 1.0) & (freqs <= line_frequency_hz + 1.0)
        )
        total_power = float(np.sum(power_spectrum[total_mask])) if np.any(total_mask) else 0.0
        line_power = float(np.sum(power_spectrum[line_mask])) if np.any(line_mask) else 0.0
        return line_power / total_power if total_power > 0 else 0.0

    @staticmethod
    def _effective_bandpass_bounds(
        *,
        sampling_rate: int | None,
        bandpass_low_hz: float,
        bandpass_high_hz: float,
    ) -> tuple[float, float]:
        if sampling_rate is None:
            return max(0.01, bandpass_low_hz), bandpass_high_hz

        high = min(max(0.01, bandpass_high_hz), (sampling_rate / 2.0) * 0.95)
        low = max(0.01, bandpass_low_hz)
        if low >= high:
            low = max(0.01, high * 0.5)
        return low, high

    @staticmethod
    def _filtered_samples(
        *,
        samples: np.ndarray,
        sampling_rate: int,
        bandpass_low_hz: float,
        bandpass_high_hz: float,
        notch_frequency_hz: float | None,
    ) -> np.ndarray:
        clean = np.asarray(samples, dtype=float)
        if clean.size == 0:
            return clean

        finite = np.isfinite(clean)
        if not np.all(finite):
            fill_value = float(np.mean(clean[finite])) if np.any(finite) else 0.0
            clean = np.nan_to_num(clean, nan=fill_value, posinf=fill_value, neginf=fill_value)
        clean = clean - float(np.mean(clean))

        nyquist = sampling_rate / 2.0
        if notch_frequency_hz and 0 < notch_frequency_hz < nyquist:
            try:
                b, a = iirnotch(notch_frequency_hz, Q=30.0, fs=sampling_rate)
                clean = sosfiltfilt(np.array([[b[0], b[1], b[2], 1.0, a[1], a[2]]]), clean)
            except ValueError:
                pass

        low, high = BrainFlowBoardService._effective_bandpass_bounds(
            sampling_rate=sampling_rate,
            bandpass_low_hz=bandpass_low_hz,
            bandpass_high_hz=bandpass_high_hz,
        )
        if low < high:
            try:
                sos = butter(4, (low, high), btype="bandpass", fs=sampling_rate, output="sos")
                clean = sosfiltfilt(sos, clean)
            except ValueError:
                pass

        return clean

    def _recording_loop(self, session_id: str, stop_event: threading.Event) -> None:
        while True:
            with self._lock:
                if stop_event.is_set() or self._recording_session_id != session_id:
                    return
                self._flush_recording_locked()
            if stop_event.wait(0.25):
                return

    def _flush_recording_locked(self, *, recover_board: bool = True) -> None:
        rows, max_timestamp = self._collect_recording_rows(recover_board=recover_board)
        if rows and self._recording_file_path is not None:
            with self._recording_file_path.open("a", newline="") as csv_file:
                writer(csv_file).writerows(rows)
            self._recording_sample_count += len(rows)
            self._recording_last_timestamp = max_timestamp
            self._write_recording_metadata_locked()

    def _collect_recording_rows(
        self, *, recover_board: bool = True
    ) -> tuple[list[list[float]], float | None]:
        with self._lock:
            if (
                self._board is None
                or self._board_id is None
                or self._status != BoardStatus.streaming
                or self._recording_stopped_at is not None
            ):
                return [], self._recording_last_timestamp

            sample_window = max((self._safe_sampling_rate_locked() or 250) * 2, 250)
            # During teardown, the caller owns native cleanup. Avoid re-entering
            # recovery (and release) if this last read discovers a lost session.
            data = (
                self._current_board_data_locked(sample_window)
                if recover_board
                else self._board.get_current_board_data(sample_window)
            )
            sample_count = int(data.shape[1]) if data.size else 0
            timestamp_channel = self._safe_timestamp_channel_locked()
            if timestamp_channel is None or not sample_count:
                return [], self._recording_last_timestamp

            last_timestamp = self._recording_last_timestamp
            rows: list[list[float]] = []
            max_timestamp = last_timestamp
            for column in range(sample_count):
                timestamp = float(data[timestamp_channel][column])
                if last_timestamp is not None and timestamp <= last_timestamp:
                    continue
                rows.append(
                    [
                        timestamp,
                        *[
                            float(data[channel_index][column])
                            for channel_index in self._recording_eeg_channels
                        ],
                    ]
                )
                if max_timestamp is None or timestamp > max_timestamp:
                    max_timestamp = timestamp

            return rows, max_timestamp

    def _request_recording_stop_locked(self) -> threading.Thread | None:
        if self._recording_stop_event is not None:
            self._recording_stop_event.set()
        return self._recording_thread

    def _finalize_recording_locked(self) -> None:
        try:
            if self._recording_session_id:
                if self._recording_stopped_at is None:
                    self._recording_stopped_at = self._now()
                    self._write_recording_metadata_locked()
                elif self._recording_metadata_dirty:
                    self._write_recording_metadata_locked()
        finally:
            self._recording_thread = None
            self._recording_stop_event = None

    def _clear_recording_state_locked(self) -> None:
        self._recording_thread = None
        self._recording_stop_event = None
        self._recording_session_id = None
        self._recording_label = None
        self._recording_file_path = None
        self._recording_metadata_path = None
        self._recording_metadata_dirty = False
        self._recording_started_at = None
        self._recording_stopped_at = None
        self._recording_sample_count = 0
        self._recording_last_timestamp = None
        self._recording_board = None
        self._recording_board_id = None
        self._recording_sampling_rate = None
        self._recording_eeg_channels = []
        self._recording_eeg_names = []
        self._recording_setup_quality_snapshots = []
        self._recording_calibration_markers = []
        self._recording_message = None

    def _recording_state_locked(self) -> RecordingStateResponse:
        return RecordingStateResponse(
            active=bool(self._recording_session_id and self._recording_stopped_at is None),
            session_id=self._recording_session_id,
            label=self._recording_label,
            file_path=str(self._recording_file_path) if self._recording_file_path else None,
            metadata_path=(
                str(self._recording_metadata_path) if self._recording_metadata_path else None
            ),
            started_at=self._recording_started_at,
            stopped_at=self._recording_stopped_at,
            sample_count=self._recording_sample_count,
            board=self._recording_board,
            board_id=self._recording_board_id,
            sampling_rate=self._recording_sampling_rate,
            eeg_names=self._recording_eeg_names,
            setup_quality_snapshots=self._recording_setup_quality_snapshots,
            calibration_markers=self._recording_calibration_markers,
            message=self._recording_message,
        )

    def _write_recording_metadata_locked(self) -> None:
        if self._recording_metadata_path is None:
            return
        try:
            self._recording_metadata_path.write_text(
                dumps(self._recording_state_locked().model_dump(mode="json"), indent=2)
            )
        except OSError:
            self._recording_metadata_dirty = True
            raise
        else:
            self._recording_metadata_dirty = False

    def _build_recording_session_id_locked(self, label: str | None) -> str:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        label_slug = sub(r"[^a-z0-9]+", "-", (label or "session").lower()).strip("-")
        label_slug = label_slug[:32] or "session"
        candidate = f"{timestamp}-{label_slug}"
        session_id = candidate
        index = 2
        while (self._recording_dir / f"{session_id}.csv").exists():
            session_id = f"{candidate}-{index}"
            index += 1
        return session_id

    def _recording_metadata_path_for_session(self, session_id: str) -> Path:
        safe_session_id = sub(r"[^A-Za-z0-9_.-]", "", session_id)
        if not safe_session_id or safe_session_id != session_id:
            raise FileNotFoundError(session_id)
        return self._recording_dir / f"{safe_session_id}.json"

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()
