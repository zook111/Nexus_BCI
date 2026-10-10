import time
from json import dumps

import numpy as np
import pytest

from mindmeld_api.schemas import (
    BoardConnectionRequest,
    BoardKind,
    BoardStatus,
    CalmCalibrationStartRequest,
    CalmCalibrationStatus,
    CalmSignalState,
    RecordingCalibrationMarkerRequest,
    RecordingSetupSnapshotRequest,
    RecordingStartRequest,
    RecordingUpdateRequest,
    SignalQualityStatus,
)
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


def test_invalid_cyton_connect_does_not_release_active_session() -> None:
    service = BrainFlowBoardService()
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        with pytest.raises(ValueError, match="serial_port is required"):
            service.connect(BoardConnectionRequest(board=BoardKind.cyton))

        state = service.state()

        assert state.status == BoardStatus.streaming
        assert state.board == BoardKind.synthetic
        assert state.sampling_rate == 250
    finally:
        service.disconnect()


def test_connect_while_streaming_keeps_active_session() -> None:
    service = BrainFlowBoardService()
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        with pytest.raises(RuntimeError, match="Stop streaming before connecting"):
            service.connect(BoardConnectionRequest(board=BoardKind.synthetic))

        state = service.state()

        assert state.status == BoardStatus.streaming
        assert state.board == BoardKind.synthetic
        assert state.sampling_rate == 250
    finally:
        service.disconnect()


def test_recording_writes_csv_and_metadata(tmp_path) -> None:
    service = BrainFlowBoardService(recording_dir=tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        started = service.start_recording(RecordingStartRequest(label="Test Session"))

        assert started.active is True
        assert started.session_id is not None
        assert started.file_path is not None
        assert started.metadata_path is not None

        deadline = 2.0
        while service.recording_state().sample_count == 0 and deadline > 0:
            time.sleep(0.1)
            deadline -= 0.1

        stopped = service.stop_recording()

        assert stopped.active is False
        assert stopped.sample_count > 0
        assert stopped.stopped_at is not None
        assert stopped.file_path is not None
        assert stopped.metadata_path is not None
        assert "timestamp,Fz,C3,Cz" in tmp_path.joinpath(f"{stopped.session_id}.csv").read_text()
        assert '"active": false' in tmp_path.joinpath(f"{stopped.session_id}.json").read_text()
    finally:
        service.disconnect()


def test_recording_setup_quality_snapshot_is_saved_to_metadata(tmp_path) -> None:
    service = BrainFlowBoardService(recording_dir=tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        active = service.start_recording(RecordingStartRequest(label="Setup quality"))
        assert active.session_id is not None
        time.sleep(0.3)

        updated = service.capture_recording_setup_quality(
            RecordingSetupSnapshotRequest(label="pre-save quality", window_size=250)
        )

        assert len(updated.setup_quality_snapshots) == 1
        snapshot = updated.setup_quality_snapshots[0]
        assert snapshot.label == "pre-save quality"
        assert snapshot.sample_count > 0
        snapshot_total = (
            snapshot.good_channels + snapshot.questionable_channels + snapshot.bad_channels
        )
        assert snapshot_total == len(snapshot.channels)
        assert updated.metadata_path is not None
        assert "setup_quality_snapshots" in tmp_path.joinpath(
            f"{updated.session_id}.json"
        ).read_text()
    finally:
        service.disconnect()


def test_recording_setup_quality_snapshot_requires_active_recording(tmp_path) -> None:
    service = BrainFlowBoardService(recording_dir=tmp_path)

    with pytest.raises(RuntimeError, match="active recording"):
        service.capture_recording_setup_quality(RecordingSetupSnapshotRequest())


def test_recording_calibration_marker_is_saved_to_metadata(tmp_path) -> None:
    service = BrainFlowBoardService(recording_dir=tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        active = service.start_recording(RecordingStartRequest(label="Cue markers"))
        assert active.session_id is not None
        time.sleep(0.3)

        updated = service.capture_recording_calibration_marker(
            RecordingCalibrationMarkerRequest(
                step_id="eyes-closed",
                label="Eyes closed",
                cue="Close eyes now.",
                elapsed_seconds=12.5,
                stream_sample_count=240,
                calm_score=0.62,
                confidence=0.74,
                alpha_post=0.31,
                high_frequency_ratio=0.08,
                signal_state=CalmSignalState.usable,
                quality_good=6,
                quality_questionable=2,
                quality_bad=0,
            )
        )

        assert len(updated.calibration_markers) == 1
        marker = updated.calibration_markers[0]
        assert marker.step_id == "eyes-closed"
        assert marker.recording_sample_index >= 0
        assert marker.stream_sample_count == 240
        assert marker.signal_state == CalmSignalState.usable
        assert updated.metadata_path is not None
        metadata = tmp_path.joinpath(f"{updated.session_id}.json").read_text()
        assert "calibration_markers" in metadata
        assert "recording_sample_index" in metadata
    finally:
        service.disconnect()


def test_recording_calibration_marker_requires_active_recording(tmp_path) -> None:
    service = BrainFlowBoardService(recording_dir=tmp_path)

    with pytest.raises(RuntimeError, match="active recording"):
        service.capture_recording_calibration_marker(
            RecordingCalibrationMarkerRequest(
                step_id="eyes-open",
                label="Eyes open",
                cue="Open eyes.",
            )
        )


def test_recording_eeg_labels_match_channel_count() -> None:
    assert BrainFlowBoardService._normalize_eeg_names([], 3) == ["Ch 1", "Ch 2", "Ch 3"]
    assert BrainFlowBoardService._normalize_eeg_names(["Fz"], 3) == ["Fz", "Ch 2", "Ch 3"]
    assert BrainFlowBoardService._normalize_eeg_names(["Fz", "", "Cz"], 3) == [
        "Fz",
        "Ch 2",
        "Cz",
    ]


def test_recording_preview_reads_csv_rows(tmp_path) -> None:
    session_id = "20260520T120000Z-test"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text("timestamp,Fz,C3\n1.0,2.0,3.0\n4.0,5.0,6.0\n")
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "Test",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 2,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 250,
                "eeg_names": ["Fz", "C3"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    preview = service.preview_recording(session_id)

    assert preview.recording.session_id == session_id
    assert preview.headers == ["timestamp", "Fz", "C3"]
    assert preview.rows == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
    assert preview.row_count == 2
    assert preview.offset == 0
    assert preview.total_rows == 2
    assert service.recording_csv_path(session_id) == csv_path


def test_recording_preview_reads_offset_window(tmp_path) -> None:
    session_id = "20260520T120000Z-window"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text(
        "timestamp,Fz\n"
        "0.0,1.0\n"
        "0.1,2.0\n"
        "0.2,3.0\n"
        "0.3,4.0\n"
    )
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "Window",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 4,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 10,
                "eeg_names": ["Fz"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    preview = service.preview_recording(session_id, limit=2, offset=1)

    assert preview.rows == [[0.1, 2.0], [0.2, 3.0]]
    assert preview.row_count == 2
    assert preview.offset == 1
    assert preview.total_rows == 4


def test_recording_calibration_report_builds_marker_windows(tmp_path) -> None:
    session_id = "20260520T120000Z-marker-report"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text(
        "timestamp,Fz\n"
        "0.0,1.0\n"
        "0.1,2.0\n"
        "0.2,3.0\n"
        "0.3,4.0\n"
        "0.4,5.0\n"
        "0.5,6.0\n"
    )
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "Marker report",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 6,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 10,
                "eeg_names": ["Fz"],
                "calibration_markers": [
                    {
                        "captured_at": "2026-05-20T12:00:00.400000+00:00",
                        "step_id": "late",
                        "label": "Late",
                        "cue": "Late cue",
                        "elapsed_seconds": 0.4,
                        "stream_sample_count": 4,
                        "recording_sample_index": 4,
                    },
                    {
                        "captured_at": "2026-05-20T12:00:00.100000+00:00",
                        "step_id": "early",
                        "label": "Early",
                        "cue": "Early cue",
                        "elapsed_seconds": 0.1,
                        "stream_sample_count": 1,
                        "recording_sample_index": 1,
                    },
                ],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    report = service.calibration_report(session_id, context_samples=2)

    assert report.recording.session_id == session_id
    assert report.headers == ["timestamp", "Fz"]
    assert report.context_samples == 2
    assert report.total_rows == 6
    assert report.message is None
    assert [window.marker.step_id for window in report.marker_windows] == ["early", "late"]

    early_window = report.marker_windows[0]
    assert early_window.offset == 0
    assert early_window.row_count == 5
    assert early_window.marker_row_offset == 1
    assert early_window.rows[1] == [0.1, 2.0]

    late_window = report.marker_windows[1]
    assert late_window.offset == 2
    assert late_window.row_count == 4
    assert late_window.marker_row_offset == 2
    assert late_window.rows[2] == [0.4, 5.0]


def test_recording_calibration_report_handles_no_markers(tmp_path) -> None:
    session_id = "20260520T120000Z-no-markers"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text("timestamp,Fz\n0.0,1.0\n")
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "No markers",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 1,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 10,
                "eeg_names": ["Fz"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    report = service.calibration_report(session_id)

    assert report.headers == ["timestamp", "Fz"]
    assert report.total_rows == 1
    assert report.marker_windows == []
    assert report.message == "Recording does not include persisted calibration markers"


def test_recording_calibration_report_does_not_rescan_csv_per_marker(
    tmp_path,
    monkeypatch,
) -> None:
    session_id = "20260520T120000Z-single-scan-report"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text(
        "timestamp,Fz\n"
        "0.0,1.0\n"
        "0.1,2.0\n"
        "0.2,3.0\n"
        "0.3,4.0\n"
        "0.4,5.0\n"
    )
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "Single scan report",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 5,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 10,
                "eeg_names": ["Fz"],
                "calibration_markers": [
                    {
                        "captured_at": "2026-05-20T12:00:00.100000+00:00",
                        "step_id": "first",
                        "label": "First",
                        "cue": "First cue",
                        "recording_sample_index": 1,
                    },
                    {
                        "captured_at": "2026-05-20T12:00:00.300000+00:00",
                        "step_id": "second",
                        "label": "Second",
                        "cue": "Second cue",
                        "recording_sample_index": 3,
                    },
                ],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    def fail_preview_reader(**kwargs):
        raise AssertionError("_read_recording_rows should not be used by calibration_report")

    monkeypatch.setattr(service, "_read_recording_rows", fail_preview_reader)

    report = service.calibration_report(session_id, context_samples=1)

    assert report.total_rows == 5
    assert [window.marker.step_id for window in report.marker_windows] == ["first", "second"]
    assert [window.rows for window in report.marker_windows] == [
        [[0.0, 1.0], [0.1, 2.0], [0.2, 3.0]],
        [[0.2, 3.0], [0.3, 4.0], [0.4, 5.0]],
    ]


def test_recording_analysis_detects_saved_alpha_peak(tmp_path) -> None:
    session_id = "20260520T120000Z-alpha"
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    alpha = np.sin(2 * np.pi * 10 * timestamps)
    beta = 0.2 * np.sin(2 * np.pi * 20 * timestamps)
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text(
        "timestamp,Fz,C3\n"
        + "\n".join(
            f"{timestamp:.4f},{alpha_sample:.8f},{beta_sample:.8f}"
            for timestamp, alpha_sample, beta_sample in zip(timestamps, alpha, beta, strict=True)
        )
        + "\n"
    )
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "Alpha",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:04+00:00",
                "sample_count": int(timestamps.size),
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": sampling_rate,
                "eeg_names": ["Fz", "C3"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    analysis = service.analyze_recording(session_id, limit=500, offset=250)
    fz_bands = {band.name: band.relative_power for band in analysis.channels[0].band_powers}

    assert analysis.sample_count == 500
    assert analysis.total_rows == int(timestamps.size)
    assert analysis.offset == 250
    assert analysis.sampling_rate == sampling_rate
    assert analysis.channels[0].label == "Fz"
    assert analysis.channels[0].dominant_frequency_hz == pytest.approx(10.0, abs=0.75)
    assert fz_bands["alpha"] > fz_bands["beta"]


def test_recording_analysis_reports_samples_without_sampling_rate(tmp_path) -> None:
    session_id = "20260520T120000Z-no-rate"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text("timestamp,Fz\n0.0,1.0\n0.1,2.0\n0.2,3.0\n")
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "No rate",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 3,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": None,
                "eeg_names": ["Fz"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    analysis = service.analyze_recording(session_id, limit=2, offset=1)

    assert analysis.sample_count == 2
    assert analysis.total_rows == 3
    assert analysis.offset == 1
    assert analysis.sampling_rate is None
    assert analysis.channels == []
    assert analysis.message == "Recording metadata does not include a sampling rate"


def test_recording_update_changes_label_in_metadata(tmp_path) -> None:
    session_id = "20260520T120000Z-test"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text("timestamp,Fz\n1.0,2.0\n")
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "Before",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 1,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 250,
                "eeg_names": ["Fz"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    updated = service.update_recording(
        session_id,
        RecordingUpdateRequest(label="After"),
    )

    assert updated.label == "After"
    assert service.get_recording(session_id).label == "After"
    assert csv_path.exists()


def test_recording_delete_removes_csv_and_metadata(tmp_path) -> None:
    session_id = "20260520T120000Z-test"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text("timestamp,Fz\n1.0,2.0\n")
    metadata_path.write_text(
        dumps(
            {
                "active": False,
                "session_id": session_id,
                "label": "Delete me",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": "2026-05-20T12:00:01+00:00",
                "sample_count": 1,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 250,
                "eeg_names": ["Fz"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    service.delete_recording(session_id)

    assert not csv_path.exists()
    assert not metadata_path.exists()
    with pytest.raises(FileNotFoundError):
        service.get_recording(session_id)


def test_recording_delete_removes_stale_active_metadata(tmp_path) -> None:
    session_id = "20260520T120000Z-stale-active"
    csv_path = tmp_path / f"{session_id}.csv"
    metadata_path = tmp_path / f"{session_id}.json"
    csv_path.write_text("timestamp,Fz\n1.0,2.0\n")
    metadata_path.write_text(
        dumps(
            {
                "active": True,
                "session_id": session_id,
                "label": "Stale active",
                "file_path": str(csv_path),
                "metadata_path": str(metadata_path),
                "started_at": "2026-05-20T12:00:00+00:00",
                "stopped_at": None,
                "sample_count": 1,
                "board": "synthetic",
                "board_id": -1,
                "sampling_rate": 250,
                "eeg_names": ["Fz"],
                "message": None,
            }
        )
    )
    service = BrainFlowBoardService(recording_dir=tmp_path)

    service.delete_recording(session_id)

    assert not csv_path.exists()
    assert not metadata_path.exists()


def test_recording_delete_rejects_active_session(tmp_path) -> None:
    service = BrainFlowBoardService(recording_dir=tmp_path)
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        active = service.start_recording(RecordingStartRequest(label="Active"))
        assert active.session_id is not None

        with pytest.raises(RuntimeError, match="Cannot delete an active recording"):
            service.delete_recording(active.session_id)
    finally:
        service.disconnect()


def test_recording_lookup_rejects_unsafe_session_id(tmp_path) -> None:
    service = BrainFlowBoardService(recording_dir=tmp_path)

    with pytest.raises(FileNotFoundError):
        service.get_recording("../outside")


def test_dsp_summary_returns_band_power_channels() -> None:
    service = BrainFlowBoardService()
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        time.sleep(0.2)
        summary = service.dsp_summary(window_size=250)

        assert summary.status == BoardStatus.streaming
        assert summary.sampling_rate == 250
        assert summary.sample_count > 0
        assert summary.channels
        assert {band.name for band in summary.channels[0].band_powers} == {
            "delta",
            "theta",
            "alpha",
            "beta",
            "gamma",
        }
    finally:
        service.disconnect()


def test_dsp_channel_summary_detects_alpha_peak() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 2, 1 / sampling_rate)
    samples = np.sin(2 * np.pi * 10 * timestamps)

    summary = BrainFlowBoardService._summarize_dsp_channel(
        index=1,
        label="Fz",
        samples=samples,
        sampling_rate=sampling_rate,
        bandpass_low_hz=1.0,
        bandpass_high_hz=45.0,
        notch_frequency_hz=60.0,
    )
    band_powers = {band.name: band.relative_power for band in summary.band_powers}

    assert summary.dominant_frequency_hz == pytest.approx(10.0, abs=0.75)
    assert band_powers["alpha"] > band_powers["theta"]
    assert band_powers["alpha"] > band_powers["beta"]


def test_dsp_channel_summary_clamps_out_of_band_filter_bounds() -> None:
    sampling_rate = 125
    timestamps = np.arange(0, 2, 1 / sampling_rate)
    samples = np.sin(2 * np.pi * 40 * timestamps)

    summary = BrainFlowBoardService._summarize_dsp_channel(
        index=1,
        label="Fz",
        samples=samples,
        sampling_rate=sampling_rate,
        bandpass_low_hz=70.0,
        bandpass_high_hz=120.0,
        notch_frequency_hz=60.0,
    )
    band_powers = {band.name: band.relative_power for band in summary.band_powers}

    assert summary.total_power > 0
    assert summary.dominant_frequency_hz == pytest.approx(40.0, abs=1.0)
    assert band_powers["gamma"] > 0


def test_signal_quality_returns_channel_statuses() -> None:
    service = BrainFlowBoardService()
    service.connect(BoardConnectionRequest(board=BoardKind.synthetic))
    service.start_stream()

    try:
        time.sleep(0.2)
        summary = service.signal_quality(window_size=250)

        assert summary.status == BoardStatus.streaming
        assert summary.sampling_rate == 250
        assert summary.sample_count > 0
        assert summary.channels
        assert summary.good_channels + summary.questionable_channels + summary.bad_channels == len(
            summary.channels
        )
        assert all(channel.finite_ratio > 0 for channel in summary.channels)
    finally:
        service.disconnect()


def test_signal_quality_channel_detects_flatline() -> None:
    summary = BrainFlowBoardService._summarize_signal_quality_channel(
        index=1,
        label="Fz",
        samples=np.ones(250) * 10,
        sampling_rate=250,
        line_frequency_hz=60.0,
        flatline_threshold=1.0,
        rail_threshold=150_000.0,
        noise_rms_threshold=100.0,
    )

    assert summary.status == SignalQualityStatus.bad
    assert "flatline" in summary.issues
    assert summary.peak_to_peak == 0
    assert summary.filtered_rms == pytest.approx(0.0, abs=0.001)


def test_signal_quality_channel_detects_railing_and_dropouts() -> None:
    samples = np.sin(np.linspace(0, 6, 250))
    samples[0] = np.nan
    samples[1] = 200_000

    summary = BrainFlowBoardService._summarize_signal_quality_channel(
        index=1,
        label="Fz",
        samples=samples,
        sampling_rate=250,
        line_frequency_hz=60.0,
        flatline_threshold=1.0,
        rail_threshold=150_000.0,
        noise_rms_threshold=100.0,
    )

    assert summary.status == SignalQualityStatus.bad
    assert "limited_dropouts" in summary.issues
    assert "railing" in summary.issues


def test_signal_quality_channel_ignores_slow_drift_for_noise_score() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    samples = (
        1_000 * np.sin(2 * np.pi * 0.2 * timestamps)
        + 20 * np.sin(2 * np.pi * 10 * timestamps)
    )

    summary = BrainFlowBoardService._summarize_signal_quality_channel(
        index=1,
        label="Fz",
        samples=samples,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        flatline_threshold=1.0,
        rail_threshold=150_000.0,
        noise_rms_threshold=150.0,
    )

    assert summary.rms > 500
    assert summary.filtered_rms < 50
    assert summary.status == SignalQualityStatus.good
    assert "high_eeg_noise" not in summary.issues


def test_signal_quality_channel_flags_filtered_eeg_noise() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    samples = 300 * np.sin(2 * np.pi * 10 * timestamps)

    summary = BrainFlowBoardService._summarize_signal_quality_channel(
        index=1,
        label="Fz",
        samples=samples,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        flatline_threshold=1.0,
        rail_threshold=150_000.0,
        noise_rms_threshold=150.0,
    )

    assert summary.filtered_rms >= 150
    assert summary.status == SignalQualityStatus.questionable
    assert "high_eeg_noise" in summary.issues


def test_signal_quality_channel_detects_line_noise() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 2, 1 / sampling_rate)
    samples = np.sin(2 * np.pi * 60 * timestamps)

    summary = BrainFlowBoardService._summarize_signal_quality_channel(
        index=1,
        label="Fz",
        samples=samples,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        flatline_threshold=1.0,
        rail_threshold=150_000.0,
        noise_rms_threshold=100.0,
    )

    assert summary.status == SignalQualityStatus.questionable
    assert summary.line_noise_ratio > 0.9
    assert "line_noise" in summary.issues


def test_line_noise_ratio_stays_bounded_for_sub_hz_line_frequency() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    samples = np.sin(2 * np.pi * 0.5 * timestamps) + 0.1 * np.sin(2 * np.pi * 10 * timestamps)

    ratio = BrainFlowBoardService._line_noise_ratio(
        samples=samples,
        sampling_rate=sampling_rate,
        line_frequency_hz=0.5,
    )

    assert 0 <= ratio <= 1


def test_calm_window_detects_posterior_alpha_with_baseline() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    alpha = 40 * np.sin(2 * np.pi * 10 * timestamps)
    beta = 5 * np.sin(2 * np.pi * 20 * timestamps)
    channels = [
        (1, "Fp1", beta),
        (2, "Fp2", beta),
        (3, "C3", beta),
        (4, "C4", beta),
        (5, "P7", alpha + beta),
        (6, "P8", alpha + beta),
        (7, "O1", alpha + beta),
        (8, "O2", alpha + beta),
    ]

    summary = BrainFlowBoardService._summarize_calm_window(
        channels=channels,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        posterior_labels=["P7", "P8", "O1", "O2"],
        baseline_median=0.0,
        baseline_mad=0.25,
    )

    assert summary["signal_state"] == CalmSignalState.usable
    assert summary["confidence"] == pytest.approx(1.0)
    assert summary["calm_score"] > 0.5
    assert summary["features"]["alpha_post"] > summary["features"]["beta"]
    assert summary["used_labels"] == ["P7", "P8", "O1", "O2"]


def test_calm_window_penalizes_high_beta_activity() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    alpha = 5 * np.sin(2 * np.pi * 10 * timestamps)
    beta = 80 * np.sin(2 * np.pi * 22 * timestamps)
    channels = [
        (1, "P7", alpha + beta),
        (2, "P8", alpha + beta),
        (3, "O1", alpha + beta),
        (4, "O2", alpha + beta),
    ]

    summary = BrainFlowBoardService._summarize_calm_window(
        channels=channels,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        posterior_labels=["P7", "P8", "O1", "O2"],
        baseline_median=0.0,
        baseline_mad=0.25,
    )

    assert summary["signal_state"] == CalmSignalState.usable
    assert summary["calm_score"] < 0.5
    assert summary["features"]["beta"] > summary["features"]["alpha_post"]


def test_calm_window_pauses_for_bad_posterior_signal() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    alpha = 25 * np.sin(2 * np.pi * 10 * timestamps)
    channels = [
        (1, "P7", alpha),
        (2, "P8", alpha),
        (3, "O1", np.ones_like(timestamps) * 10),
        (4, "O2", alpha),
    ]

    summary = BrainFlowBoardService._summarize_calm_window(
        channels=channels,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        posterior_labels=["P7", "P8", "O1", "O2"],
        baseline_median=0.0,
        baseline_mad=0.25,
    )

    assert summary["signal_state"] == CalmSignalState.noisy
    assert summary["calm_score"] is None
    assert "bad_posterior_signal" in summary["flags"]


def test_calm_window_requires_posterior_channels_without_fallback() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    samples = 20 * np.sin(2 * np.pi * 10 * timestamps)

    summary = BrainFlowBoardService._summarize_calm_window(
        channels=[(1, "Fz", samples), (2, "Cz", samples)],
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        posterior_labels=["P7", "P8", "O1", "O2"],
        baseline_median=0.0,
        baseline_mad=0.25,
    )

    assert summary["signal_state"] == CalmSignalState.noisy
    assert summary["calm_score"] is None
    assert "missing_posterior_channels" in summary["flags"]


def test_calm_window_matches_normalized_posterior_labels() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    alpha = 30 * np.sin(2 * np.pi * 10 * timestamps)
    channels = [
        (1, "P 7", alpha),
        (2, "P-8", alpha),
        (3, "O 1", alpha),
        (4, "O-2", alpha),
    ]

    summary = BrainFlowBoardService._summarize_calm_window(
        channels=channels,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        posterior_labels=["P7", "P8", "O1", "O2"],
        baseline_median=0.0,
        baseline_mad=0.25,
    )

    assert summary["signal_state"] == CalmSignalState.usable
    assert summary["used_labels"] == ["P 7", "P-8", "O 1", "O-2"]
    assert summary["calm_score"] is not None


def test_calm_window_falls_back_to_last_four_channels_when_enabled() -> None:
    sampling_rate = 250
    timestamps = np.arange(0, 4, 1 / sampling_rate)
    beta = 8 * np.sin(2 * np.pi * 20 * timestamps)
    alpha = 28 * np.sin(2 * np.pi * 10 * timestamps)
    channels = [
        (1, "EEG 1", beta),
        (2, "EEG 2", beta),
        (3, "EEG 3", beta),
        (4, "EEG 4", beta),
        (5, "EEG 5", alpha),
        (6, "EEG 6", alpha),
        (7, "EEG 7", alpha),
        (8, "EEG 8", alpha),
    ]

    summary = BrainFlowBoardService._summarize_calm_window(
        channels=channels,
        sampling_rate=sampling_rate,
        line_frequency_hz=60.0,
        posterior_labels=["P7", "P8", "O1", "O2"],
        baseline_median=0.0,
        baseline_mad=0.25,
        allow_posterior_fallback=True,
    )

    assert summary["signal_state"] == CalmSignalState.usable
    assert summary["used_labels"] == ["EEG 5", "EEG 6", "EEG 7", "EEG 8"]
    assert "posterior_fallback" in summary["flags"]
    assert summary["calm_score"] is not None


def test_calm_baseline_completes_with_accepted_windows() -> None:
    service = BrainFlowBoardService()
    started = service.start_calm_baseline(
        CalmCalibrationStartRequest(duration_seconds=2, label="Eyes open")
    )
    assert started.status == CalmCalibrationStatus.running

    service._calm_calibration_values = [0.1, 0.2, 0.3]
    service._calm_calibration_started_monotonic = time.monotonic() - 3

    completed = service.calm_baseline_state()

    assert completed.status == CalmCalibrationStatus.complete
    assert completed.accepted_windows == 3
    assert completed.baseline_median == pytest.approx(0.2)
    assert completed.baseline_mad is not None


def test_calm_baseline_elapsed_time_freezes_after_completion() -> None:
    service = BrainFlowBoardService()
    service.start_calm_baseline(CalmCalibrationStartRequest(duration_seconds=2))
    service._calm_calibration_values = [0.1, 0.2, 0.3]
    service._calm_calibration_started_monotonic = time.monotonic() - 3

    completed = service.calm_baseline_state()
    first_elapsed = completed.elapsed_seconds
    time.sleep(0.01)
    second_elapsed = service.calm_baseline_state().elapsed_seconds

    assert completed.status == CalmCalibrationStatus.complete
    assert second_elapsed == pytest.approx(first_elapsed)


def test_calm_score_is_suppressed_when_baseline_settings_mismatch(monkeypatch) -> None:
    class FakeBoard:
        def is_prepared(self):
            return True

        def get_current_board_data(self, max_samples: int) -> np.ndarray:
            data = np.zeros((32, max_samples))
            data[30, -1] = 1234.5
            return data

    def fake_summarize_calm_window(**kwargs):
        baseline_median = kwargs["baseline_median"]
        return {
            "sample_count": kwargs["channels"][0][2].size,
            "used_labels": ["P7", "P8", "O1", "O2"],
            "signal_state": CalmSignalState.usable,
            "confidence": 1.0,
            "calm_score": 0.7 if baseline_median is not None else None,
            "flags": [] if baseline_median is not None else ["baseline_required"],
            "features": {"raw_calm_index": 0.2},
        }

    monkeypatch.setattr(
        BrainFlowBoardService,
        "_summarize_calm_window",
        staticmethod(fake_summarize_calm_window),
    )

    service = BrainFlowBoardService()
    service._board = FakeBoard()
    service._board_kind = BoardKind.synthetic
    service._board_id = -1
    service._status = BoardStatus.streaming
    service._calm_calibration_status = CalmCalibrationStatus.complete
    service._calm_calibration_window_size = 1000
    service._calm_calibration_line_frequency_hz = 60.0
    service._calm_calibration_posterior_labels = ["P7", "P8", "O1", "O2"]
    service._calm_calibration_baseline_median = 0.0
    service._calm_calibration_baseline_mad = 0.25

    matched = service.calm_features(window_size=1000, line_frequency_hz=60.0)
    mismatched = service.calm_features(window_size=500, line_frequency_hz=60.0)

    assert matched.calm_score == 0.7
    assert matched.source_timestamp == pytest.approx(1234.5)
    assert "baseline_mismatch" not in matched.flags
    assert mismatched.calm_score is None
    assert "baseline_mismatch" in mismatched.flags
