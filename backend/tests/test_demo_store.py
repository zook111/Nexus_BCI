from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from mindmeld_api.schemas import DemoRunCreateRequest
from mindmeld_api.services.demo_store import DemoStore


def make_run(
    participant_name: str,
    score: int,
    *,
    initials: str | None = None,
) -> DemoRunCreateRequest:
    return DemoRunCreateRequest(
        participant_name=participant_name,
        participant_initials=initials,
        open_alpha=1.25,
        closed_alpha=2.75,
        alpha_lift_percent=120.0,
        threshold_alpha=2.225,
        clean_hold_seconds=12.4,
        confidence=0.98,
        score=score,
        scoring_version="doctor-demo-v1",
    )


def test_event_creation_is_persisted_and_newest_event_is_listed_first(tmp_path) -> None:
    store = DemoStore(tmp_path / "demo.sqlite3")

    first = store.create_event("Science evening")
    second = store.create_event("Morning demonstration")

    reloaded = DemoStore(tmp_path / "demo.sqlite3").list_events()

    assert [event.id for event in reloaded] == [second.id, first.id]
    assert [event.name for event in reloaded] == ["Morning demonstration", "Science evening"]
    assert all(datetime.fromisoformat(event.created_at).tzinfo is UTC for event in reloaded)


def test_runs_persist_and_mark_only_the_best_score_for_each_participant(tmp_path) -> None:
    store = DemoStore(tmp_path / "nested" / "demo.sqlite3")
    event = store.create_event("Doctor demo")

    first_maya = store.create_run(event.id, make_run("Dr Maya Shah", 610, initials="MS"))
    best_maya = store.create_run(event.id, make_run("dr maya shah", 842, initials="MS"))
    tom = store.create_run(event.id, make_run("Dr Tom Lee", 790, initials="TL"))

    runs = DemoStore(tmp_path / "nested" / "demo.sqlite3").list_runs(event.id)

    assert {run.id for run in runs} == {first_maya.id, best_maya.id, tom.id}
    assert [run.score for run in runs] == [842, 790, 610]
    assert [run.is_best for run in runs] == [True, True, False]
    assert runs[0].participant_name == "dr maya shah"
    assert runs[0].participant_initials == "MS"


def test_run_creation_rejects_an_unknown_event(tmp_path) -> None:
    store = DemoStore(tmp_path / "demo.sqlite3")

    with pytest.raises(FileNotFoundError, match="Demo event not found"):
        store.create_run("missing-event", make_run("Dr Maya Shah", 842))


def test_run_creation_is_idempotent_for_a_client_run_id(tmp_path) -> None:
    store = DemoStore(tmp_path / "demo.sqlite3")
    event = store.create_event("Doctor demo")
    request = make_run("Dr Maya Shah", 842)
    request.client_run_id = "client-run-stable-123"

    first = store.create_run(event.id, request)
    retried = store.create_run(event.id, request)

    assert retried.id == first.id == "client-run-stable-123"
    assert len(store.list_runs(event.id)) == 1


def test_run_measurements_must_be_finite() -> None:
    with pytest.raises(ValidationError, match="finite number"):
        DemoRunCreateRequest(
            participant_name="Dr Maya Shah",
            open_alpha=float("inf"),
            closed_alpha=2.0,
            alpha_lift_percent=100.0,
            threshold_alpha=1.65,
            clean_hold_seconds=10.0,
            confidence=0.9,
            score=700,
            scoring_version="doctor-demo-v1",
        )


def test_listing_runs_rejects_an_unknown_event(tmp_path) -> None:
    store = DemoStore(tmp_path / "demo.sqlite3")

    with pytest.raises(FileNotFoundError, match="Demo event not found"):
        store.list_runs("missing-event")
