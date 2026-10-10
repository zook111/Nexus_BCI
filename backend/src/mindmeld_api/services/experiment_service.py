"""Task-labelled EEG trials; local storage and evaluation on a separate recording.

Markers use board timestamps, not a browser clock or a recorder's buffered row count.
No uploaded/deserialized executable model objects are used. Each evaluation fits anew.
"""

from __future__ import annotations

import csv
import hashlib
import re
import threading
import time
from collections import Counter
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from uuid import uuid4

import numpy as np
from scipy.signal import butter, sosfiltfilt

from mindmeld_api.experiment_schemas import (
    EvaluateRequest,
    EvaluationReport,
    Experiment,
    ExperimentCreate,
    Readiness,
    Trial,
    TrialEdit,
    TrialPrediction,
    TrialStart,
)
from mindmeld_api.schemas import RecordingStartRequest
from mindmeld_api.services.brainflow_service import BrainFlowBoardService


def now() -> str:
    return datetime.now(UTC).isoformat()


class ExperimentService:
    def __init__(self, board: BrainFlowBoardService, root: Path):
        self.board = board
        self.root = Path(root) / "experiments"
        self.lock = threading.RLock()
        self.evaluation_lock = threading.Lock()
        self.windows: dict[str, tuple[float, float, int]] = {}

    def _path(self, session_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,150}", session_id):
            raise FileNotFoundError("Experiment not found")
        return self.root / f"{session_id}.json"

    @staticmethod
    def _write(path: Path, value: Experiment | EvaluationReport) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f".{uuid4().hex}.tmp")
        try:
            temporary.write_text(value.model_dump_json(indent=2))
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

    def get(self, session_id: str) -> Experiment:
        with self.lock:
            result = Experiment.model_validate_json(self._path(session_id).read_text())
            current = self.board.recording_state()
            if result.status == "recording" and (
                not current.active or current.session_id != session_id
            ):
                try:
                    recording = self.board.get_recording(session_id)
                    finalized = (
                        recording.session_id == session_id
                        and not recording.active
                        and recording.stopped_at is not None
                        and not recording.message
                        and recording.sample_count > 0
                        and recording.sampling_rate == result.sampling_rate
                        and recording.board is not None
                        and recording.board.value == result.board
                        and set(result.channels).issubset(recording.eeg_names)
                        and self.board.recording_csv_path(session_id).is_file()
                    )
                except (FileNotFoundError, ValueError):
                    finalized = False
                result.status = "saved" if finalized else "interrupted"
                for trial in result.trials:
                    if trial.end_timestamp is None:
                        trial.included = False
                        trial.issues = list(
                            set(
                                [
                                    *trial.issues,
                                    "unfinished_trial" if finalized else "recording_interrupted",
                                ]
                            )
                        )
                self._write(self._path(session_id), result)
            return result

    def list(self) -> list[Experiment]:
        with self.lock:
            results = []
            for path in sorted(self.root.glob("*.json"), reverse=True):
                try:
                    results.append(self.get(path.stem))
                except (ValueError, FileNotFoundError):
                    continue
            return results

    def create(self, request: ExperimentCreate) -> Experiment:
        with self.lock:
            state = self.board.state()
            if state.status != "streaming":
                raise ValueError("Connect and start streaming in Console first")
            if self.board.recording_state().active:
                raise ValueError("Save the current recording before starting an experiment")
            if not set(request.channels).issubset(state.eeg_names):
                raise ValueError("Selected electrodes are not available on this board")
            recording = self.board.start_recording(
                RecordingStartRequest(label=request.name), require_new=True
            )
            result = Experiment(
                session_id=recording.session_id,
                name=request.name,
                participant=request.participant,
                labels=request.labels,
                channels=request.channels,
                board=state.board.value,
                sampling_rate=state.sampling_rate,
                line_frequency_hz=request.line_frequency_hz,
                created_at=now(),
            )
            try:
                self._write(self._path(result.session_id), result)
            except OSError:
                self.board.stop_recording(expected_session_id=result.session_id)
                raise
            return result

    def _current(self, session_id: str) -> Experiment:
        experiment = self.get(session_id)
        if experiment.status != "recording":
            raise ValueError("This experiment is no longer recording")
        return experiment

    def readiness(self, session_id: str) -> Readiness:
        with self.lock:
            experiment = self._current(session_id)
            snapshot = self.board.snapshot(max_samples=1)
            stamp = snapshot.timestamps[-1] if snapshot.timestamps else None
            quality = self.board.signal_quality(
                window_size=500, line_frequency_hz=experiment.line_frequency_hz
            )
            selected = [c for c in quality.channels if c.label in experiment.channels]
            reason = ""
            if snapshot.status != "streaming" or stamp is None or not np.isfinite(stamp):
                reason = "No live samples; return to Console"
            elif not -1 <= time.time() - stamp <= 2:
                reason = "Samples are stale; reconnect in Console"
            elif len(selected) != len(experiment.channels) or any(
                c.status != "good" or c.sample_count < experiment.sampling_rate for c in selected
            ):
                reason = "Adjust selected electrodes until their signal quality is good"
            last_stamp, checked_at, count = self.windows.get(session_id, (0.0, 0.0, 0))
            current_time = time.monotonic()
            if reason:
                count = 0
            elif stamp > last_stamp and current_time - checked_at >= 1:
                # Polls are at least one second apart, with fresh source data each time.
                count = min(3, count + 1) if current_time - checked_at <= 3 else 1
                checked_at, last_stamp = current_time, stamp
            elif current_time - checked_at > 3:
                count = 0
            self.windows[session_id] = (last_stamp, checked_at, count)
            active = next((t for t in experiment.trials if t.end_timestamp is None), None)
            if active and reason and "signal_quality_changed" not in active.issues:
                active.issues.append("signal_quality_changed")
                active.included = False
                self._write(self._path(session_id), experiment)
            return Readiness(
                ready=not reason and count >= 3,
                clean_windows=count,
                reason=reason or ("Ready" if count >= 3 else "Checking three fresh signal windows"),
                source_timestamp=stamp,
            )

    def start_trial(self, session_id: str, request: TrialStart) -> Experiment:
        with self.lock:
            experiment = self._current(session_id)
            existing = next((t for t in experiment.trials if t.id == request.id), None)
            if existing:
                if (existing.label, existing.duration_seconds) != (
                    request.label,
                    request.duration_seconds,
                ):
                    raise ValueError("Trial ID already used with different settings")
                return experiment  # Retrying a lost response cannot add another trial.
            if request.label not in experiment.labels:
                raise ValueError("Choose one of this experiment's labels")
            if len(experiment.trials) >= 300:
                raise ValueError("Save this session; maximum 300 trials per recording")
            if any(t.end_timestamp is None for t in experiment.trials):
                raise ValueError("Finish or exclude the current trial first")
            ready = self.readiness(session_id)
            if not ready.ready:
                raise ValueError(ready.reason)
            experiment.trials.append(
                Trial(
                    id=request.id,
                    label=request.label,
                    start_timestamp=ready.source_timestamp,
                    duration_seconds=request.duration_seconds,
                )
            )
            self._write(self._path(session_id), experiment)
            return experiment

    def finish_trial(self, session_id: str, trial_id: str, aborted: bool = False) -> Experiment:
        with self.lock:
            experiment = self._current(session_id)
            trial = next((t for t in experiment.trials if t.id == trial_id), None)
            if trial is None:
                raise FileNotFoundError("Trial not found")
            if trial.end_timestamp is not None:
                if aborted:
                    trial.included = False
                    if "operator_aborted" not in trial.issues:
                        trial.issues.append("operator_aborted")
                    self._write(self._path(session_id), experiment)
                return experiment
            if not aborted:
                self.readiness(session_id)
                experiment = self.get(session_id)
                trial = next(t for t in experiment.trials if t.id == trial_id)
            snapshot = self.board.snapshot(max_samples=1)
            stamp = snapshot.timestamps[-1] if snapshot.timestamps else trial.start_timestamp
            trial.end_timestamp = max(trial.start_timestamp, stamp)
            duration = trial.end_timestamp - trial.start_timestamp
            if aborted:
                trial.issues.append("operator_aborted")
            if not trial.duration_seconds - 0.5 <= duration <= trial.duration_seconds + 2:
                trial.issues.append("timing_interrupted")
            trial.included = not trial.issues
            self._write(self._path(session_id), experiment)
            return experiment

    def stop(self, session_id: str) -> Experiment:
        with self.lock:
            experiment = self.get(session_id)
            if experiment.status != "recording":
                return experiment
            for trial in experiment.trials:
                if trial.end_timestamp is None:
                    trial.included = False
                    trial.issues.append("unfinished_trial")
            self.board.stop_recording(expected_session_id=session_id)
            experiment.status = "saved"
            self._write(self._path(session_id), experiment)
            return experiment

    def edit_trial(self, session_id: str, trial_id: str, request: TrialEdit) -> Experiment:
        with self.lock:
            experiment = self.get(session_id)
            if request.label not in experiment.labels:
                raise ValueError("Choose one of this experiment's labels")
            trial = next((t for t in experiment.trials if t.id == trial_id), None)
            if trial is None:
                raise FileNotFoundError("Trial not found")
            if trial.end_timestamp is None:
                raise ValueError("Finish the trial before editing it")
            if request.included and trial.issues:
                raise ValueError(
                    "Interrupted or poor-signal trials cannot be included; record again"
                )
            trial.label, trial.included, trial.note = request.label, request.included, request.note
            self._write(self._path(session_id), experiment)
            return experiment

    def _epochs(self, experiment: Experiment):
        """One independent 3-second epoch per trial, excluding cue onset and filter edges."""
        metadata = self.board.get_recording(experiment.session_id)
        if metadata.active or metadata.sampling_rate != experiment.sampling_rate:
            raise ValueError("Save the recording before evaluation; sample rate must match")
        path = self.board.recording_csv_path(experiment.session_id)
        if path.stat().st_size > 128 * 1024 * 1024:
            raise ValueError("Recording exceeds the 128 MB school-lab limit")
        raw = path.read_bytes()
        with path.open() as handle:
            headers = next(csv.reader(handle))
        if headers != ["timestamp", *metadata.eeg_names]:
            raise ValueError("Recording headers do not match its metadata")
        data = np.loadtxt(raw.splitlines()[1:], delimiter=",", ndmin=2)
        if len(data) < 2 or data.shape[1] != len(headers):
            raise ValueError("Recording has no usable samples")
        stamps = data[:, 0]
        if not np.all(np.isfinite(stamps)) or np.any(np.diff(stamps) <= 0):
            raise ValueError("Recording timestamps must be finite and strictly increasing")
        indices = [headers.index(c) for c in experiment.channels]
        rate = experiment.sampling_rate
        if rate <= 100:
            raise ValueError("This protocol requires a sampling rate above 100 Hz")
        sos = butter(4, [8, 30], fs=rate, btype="bandpass", output="sos")
        epochs, labels, ids, rejected = [], [], [], {}
        previous_end = -float("inf")
        for trial in sorted(experiment.trials, key=lambda t: t.start_timestamp):
            reasons = list(trial.issues)
            if not trial.included:
                reasons.append("excluded_by_operator")
            if trial.end_timestamp is None:
                reasons.append("unfinished_trial")
            elif trial.start_timestamp < previous_end:
                raise ValueError("Trial intervals overlap")
            if trial.end_timestamp is not None:
                previous_end = trial.end_timestamp
            if reasons:
                rejected[trial.id] = reasons
                continue
            start = int(np.searchsorted(stamps, trial.start_timestamp, side="left"))
            end = int(np.searchsorted(stamps, trial.end_timestamp, side="right"))
            segment = data[start:end, indices].T
            segment_stamps = stamps[start:end]
            if (
                len(segment_stamps) < rate * 5
                or segment_stamps[0] - trial.start_timestamp > 2 / rate
                or trial.end_timestamp - segment_stamps[-1] > 2 / rate
                or np.max(np.diff(segment_stamps)) > 3 / rate
                or not np.all(np.isfinite(segment))
            ):
                rejected[trial.id] = ["missing_samples_or_short_trial"]
                continue
            for index, channel in enumerate(segment):
                quality = self.board._summarize_signal_quality_channel(
                    index=index,
                    label=experiment.channels[index],
                    samples=channel,
                    sampling_rate=rate,
                    line_frequency_hz=experiment.line_frequency_hz,
                    flatline_threshold=1.0,
                    rail_threshold=150000,
                    noise_rms_threshold=150,
                )
                reasons.extend(f"{quality.label}: {issue}" for issue in quality.issues)
            if reasons:
                rejected[trial.id] = reasons
                continue
            # Filter each trial independently. Discard 1 s cue/settling time, use next 3 s.
            filtered = sosfiltfilt(sos, segment, axis=-1)
            epochs.append(filtered[:, rate : 4 * rate])
            labels.append(trial.label)
            ids.append(trial.id)
        return (
            np.asarray(epochs),
            np.asarray(labels),
            ids,
            rejected,
            hashlib.sha256(raw).hexdigest(),
        )

    def evaluate(self, request: EvaluateRequest) -> EvaluationReport:
        if not self.evaluation_lock.acquire(blocking=False):
            raise ValueError("Another evaluation is running; wait for it to finish")
        try:
            return self._evaluate(request)
        finally:
            self.evaluation_lock.release()

    def _evaluate(self, request: EvaluateRequest) -> EvaluationReport:
        from pyriemann.estimation import Covariances
        from pyriemann.tangentspace import TangentSpace
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix
        from sklearn.pipeline import make_pipeline
        from threadpoolctl import threadpool_limits

        if request.training_session_id == request.test_session_id:
            raise ValueError("Training and test must be different recordings")
        with self.lock:
            train = self.get(request.training_session_id)
            test = self.get(request.test_session_id)
            if train.status == "recording" or test.status == "recording":
                raise ValueError("Save both recordings before evaluation")
            if (
                train.participant,
                train.channels,
                train.sampling_rate,
                train.line_frequency_hz,
                train.board,
                sorted(train.labels),
            ) != (
                test.participant,
                test.channels,
                test.sampling_rate,
                test.line_frequency_hz,
                test.board,
                sorted(test.labels),
            ):
                raise ValueError(
                    "Use the same participant code, electrodes, board, mains frequency "
                    "and task labels"
                )
            x_train, y_train, _, rejected_train, train_hash = self._epochs(train)
            x_test, y_test, test_ids, rejected_test, test_hash = self._epochs(test)
        if train_hash == test_hash:
            raise ValueError("Training and test contain identical raw recordings")
        train_counts, test_counts = Counter(y_train.tolist()), Counter(y_test.tolist())
        if any(train_counts[label] < 5 or test_counts[label] < 2 for label in train.labels):
            raise ValueError(
                "After quality checks, need at least 5 training and 2 test trials per label. "
                f"Training: {dict(train_counts)}; test: {dict(test_counts)}. "
                f"Excluded: {len(rejected_train)} training, {len(rejected_test)} test. "
                "Collect more trials or review the labels and electrode quality."
            )
        pipeline = make_pipeline(
            Covariances(estimator="oas"),
            TangentSpace(metric="riemann"),
            LogisticRegression(max_iter=2000, C=1.0, random_state=0),
        )
        with threadpool_limits(limits=1):
            pipeline.fit(x_train, y_train)
            probabilities = pipeline.predict_proba(x_test)
        classes = pipeline.classes_.tolist()
        predicted = np.asarray(classes)[np.argmax(probabilities, axis=1)]
        result = EvaluationReport(
            id=uuid4().hex,
            created_at=now(),
            training_session_id=train.session_id,
            test_session_id=test.session_id,
            participant=train.participant,
            channels=train.channels,
            classes=classes,
            synthetic=train.board == "synthetic",
            accuracy=float(accuracy_score(y_test, predicted)),
            balanced_accuracy=float(balanced_accuracy_score(y_test, predicted)),
            chance=1 / len(classes),
            confusion_matrix=confusion_matrix(y_test, predicted, labels=classes).tolist(),
            training_counts=dict(train_counts),
            test_counts=dict(test_counts),
            rejected_trials={
                **{f"train/{k}": v for k, v in rejected_train.items()},
                **{f"test/{k}": v for k, v in rejected_test.items()},
            },
            predictions=[
                TrialPrediction(
                    trial_id=trial_id,
                    actual=actual,
                    predicted=prediction,
                    probabilities=dict(zip(classes, map(float, probs), strict=True)),
                )
                for trial_id, actual, prediction, probs in zip(
                    test_ids, y_test.tolist(), predicted.tolist(), probabilities, strict=True
                )
            ],
            provenance={
                "pipeline_version": "experiment-lab-v1",
                "sampling_rate": train.sampling_rate,
                "line_frequency_hz": train.line_frequency_hz,
                "bandpass_hz": [8, 30],
                "filter": "Butterworth order 4, zero-phase per trial",
                "epoch_seconds": [1, 4],
                "covariance": "oas",
                "tangent_metric": "riemann",
                "logistic_C": 1.0,
                "split": "separate_recording",
                "training_csv_sha256": train_hash,
                "test_csv_sha256": test_hash,
                "training_annotations": train.model_dump(mode="json"),
                "test_annotations": test.model_dump(mode="json"),
                "versions": {
                    name: version(name) for name in ("pyriemann", "scikit-learn", "numpy", "scipy")
                },
                "limitations": [
                    "Task labels are instructions, not verified mental states",
                    "Probabilities are not calibrated confidence",
                    "Repeatedly tuning against this test set invalidates a final test",
                    "Software cues are not hardware-synchronised stimulus markers",
                ],
            },
        )
        self._write(self.root / "reports" / f"{result.id}.json", result)
        return result

    def reports(self) -> list[EvaluationReport]:
        result = []
        for path in sorted((self.root / "reports").glob("*.json")):
            try:
                result.append(EvaluationReport.model_validate_json(path.read_text()))
            except ValueError:
                continue
        return sorted(result, key=lambda report: report.created_at, reverse=True)
