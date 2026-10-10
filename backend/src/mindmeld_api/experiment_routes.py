"""Experiment Lab API, separate from acquisition and demo routes."""

from collections.abc import Callable
from functools import wraps

from fastapi import APIRouter, HTTPException

from mindmeld_api.experiment_schemas import (
    EvaluateRequest,
    EvaluationReport,
    Experiment,
    ExperimentCreate,
    Readiness,
    TrialEdit,
    TrialFinish,
    TrialStart,
)
from mindmeld_api.services.experiment_service import ExperimentService


def errors(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except FileNotFoundError as exc:
            raise HTTPException(404, "Experiment or recording not found") from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        except OSError as exc:
            raise HTTPException(503, "Local experiment storage is unavailable") from exc

    return wrapped


def experiment_router(get_service: Callable[[], ExperimentService]) -> APIRouter:
    router = APIRouter(prefix="/api/experiments", tags=["Experiment Lab"])

    @router.get("", response_model=list[Experiment])
    @errors
    def list_experiments():
        return get_service().list()

    @router.post("", response_model=Experiment, status_code=201)
    @errors
    def create(request: ExperimentCreate):
        return get_service().create(request)

    @router.post("/evaluate", response_model=EvaluationReport)
    @errors
    def evaluate(request: EvaluateRequest):
        return get_service().evaluate(request)

    @router.get("/reports", response_model=list[EvaluationReport])
    @errors
    def reports():
        return get_service().reports()

    @router.get("/{session_id}", response_model=Experiment)
    @errors
    def get(session_id: str):
        return get_service().get(session_id)

    @router.get("/{session_id}/readiness", response_model=Readiness)
    @errors
    def readiness(session_id: str):
        return get_service().readiness(session_id)

    @router.post("/{session_id}/trials", response_model=Experiment)
    @errors
    def start_trial(session_id: str, request: TrialStart):
        return get_service().start_trial(session_id, request)

    @router.post("/{session_id}/trials/{trial_id}/finish", response_model=Experiment)
    @errors
    def finish_trial(session_id: str, trial_id: str, request: TrialFinish):
        return get_service().finish_trial(session_id, trial_id, request.aborted)

    @router.patch("/{session_id}/trials/{trial_id}", response_model=Experiment)
    @errors
    def edit_trial(session_id: str, trial_id: str, request: TrialEdit):
        return get_service().edit_trial(session_id, trial_id, request)

    @router.post("/{session_id}/stop", response_model=Experiment)
    @errors
    def stop(session_id: str):
        return get_service().stop(session_id)

    return router
