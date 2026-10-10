"""Local, non-medical task labels and reproducible classifier evaluations."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class ExperimentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    participant: Name
    name: Name
    labels: list[Name] = Field(min_length=2, max_length=4)
    channels: list[Name] = Field(min_length=2, max_length=16)
    line_frequency_hz: float = Field(default=50.0, gt=0.0, le=120.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def unique_fields(self):
        for values in (self.labels, self.channels):
            if len(set(values)) != len(values):
                raise ValueError("Labels and channels must be unique")
        return self


class TrialStart(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9-]{1,64}$")
    label: Name
    duration_seconds: int = Field(default=6, ge=5, le=30)


class TrialFinish(BaseModel):
    aborted: bool = False


class TrialEdit(BaseModel):
    label: Name
    included: bool
    note: str = Field(default="", max_length=300)


class Trial(BaseModel):
    id: str
    label: str
    start_timestamp: float
    end_timestamp: float | None = None
    duration_seconds: int
    included: bool = True
    issues: list[str] = Field(default_factory=list)
    note: str = ""


class Experiment(BaseModel):
    schema_version: int = 1
    session_id: str
    name: str
    participant: str
    labels: list[str]
    channels: list[str]
    board: str
    sampling_rate: int
    line_frequency_hz: float = Field(default=50.0, gt=0.0, le=120.0, allow_inf_nan=False)
    created_at: str
    status: Literal["recording", "saved", "interrupted"] = "recording"
    trials: list[Trial] = Field(default_factory=list)


class Readiness(BaseModel):
    ready: bool = False
    clean_windows: int = 0
    reason: str
    source_timestamp: float | None = None


class EvaluateRequest(BaseModel):
    training_session_id: str
    test_session_id: str


class TrialPrediction(BaseModel):
    trial_id: str
    actual: str
    predicted: str
    probabilities: dict[str, float]


class EvaluationReport(BaseModel):
    id: str
    created_at: str
    method: str = "OAS covariance → Riemannian tangent space → logistic regression"
    training_session_id: str
    test_session_id: str
    participant: str
    channels: list[str]
    classes: list[str]
    synthetic: bool
    accuracy: float
    balanced_accuracy: float
    chance: float
    confusion_matrix: list[list[int]]
    training_counts: dict[str, int]
    test_counts: dict[str, int]
    rejected_trials: dict[str, list[str]]
    predictions: list[TrialPrediction]
    provenance: dict
