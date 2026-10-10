from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from mindmeld_api.schemas import DemoEventResponse, DemoRunCreateRequest, DemoRunResponse


class DemoStore:
    def __init__(self, database_path: Path | str) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS demo_events (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS demo_runs (
                    id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL REFERENCES demo_events(id) ON DELETE CASCADE,
                    participant_name TEXT NOT NULL,
                    participant_initials TEXT,
                    open_alpha REAL NOT NULL,
                    closed_alpha REAL NOT NULL,
                    alpha_lift_percent REAL NOT NULL,
                    threshold_alpha REAL NOT NULL,
                    clean_hold_seconds REAL NOT NULL,
                    confidence REAL NOT NULL,
                    score INTEGER NOT NULL,
                    scoring_version TEXT NOT NULL,
                    recording_session_id TEXT,
                    completed_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS demo_runs_event_id_idx
                ON demo_runs(event_id);
                """
            )

    def create_event(self, name: str) -> DemoEventResponse:
        event = DemoEventResponse(
            id=str(uuid4()),
            name=name.strip(),
            created_at=datetime.now(UTC).isoformat(),
        )
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO demo_events (id, name, created_at) VALUES (?, ?, ?)",
                (event.id, event.name, event.created_at),
            )
        return event

    def list_events(self) -> list[DemoEventResponse]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, name, created_at FROM demo_events "
                "ORDER BY created_at DESC, rowid DESC"
            ).fetchall()
        return [DemoEventResponse(**dict(row)) for row in rows]

    def create_run(
        self,
        event_id: str,
        request: DemoRunCreateRequest,
    ) -> DemoRunResponse:
        self._require_event(event_id)
        run_id = request.client_run_id or str(uuid4())
        completed_at = datetime.now(UTC).isoformat()
        values = request.model_dump()
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT event_id FROM demo_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if existing is not None:
                if existing["event_id"] != event_id:
                    raise ValueError("Client run id already belongs to another demo event")
                return next(run for run in self.list_runs(event_id) if run.id == run_id)
            connection.execute(
                """
                INSERT INTO demo_runs (
                    id, event_id, participant_name, participant_initials,
                    open_alpha, closed_alpha, alpha_lift_percent, threshold_alpha,
                    clean_hold_seconds, confidence, score, scoring_version,
                    recording_session_id, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    event_id,
                    values["participant_name"].strip(),
                    values["participant_initials"].strip()
                    if values["participant_initials"]
                    else None,
                    values["open_alpha"],
                    values["closed_alpha"],
                    values["alpha_lift_percent"],
                    values["threshold_alpha"],
                    values["clean_hold_seconds"],
                    values["confidence"],
                    values["score"],
                    values["scoring_version"],
                    values["recording_session_id"],
                    completed_at,
                ),
            )
        return next(run for run in self.list_runs(event_id) if run.id == run_id)

    def list_runs(self, event_id: str) -> list[DemoRunResponse]:
        self._require_event(event_id)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, event_id, participant_name, participant_initials,
                       open_alpha, closed_alpha, alpha_lift_percent, threshold_alpha,
                       clean_hold_seconds, confidence, score, scoring_version,
                       recording_session_id, completed_at
                FROM demo_runs
                WHERE event_id = ?
                ORDER BY score DESC, completed_at DESC, rowid DESC
                """,
                (event_id,),
            ).fetchall()

        best_participants: set[str] = set()
        runs: list[DemoRunResponse] = []
        for row in rows:
            values = dict(row)
            participant_key = values["participant_name"].strip().casefold()
            is_best = participant_key not in best_participants
            best_participants.add(participant_key)
            runs.append(
                DemoRunResponse(
                    **values,
                    participant_key=participant_key,
                    is_best=is_best,
                )
            )
        return runs

    def _require_event(self, event_id: str) -> None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM demo_events WHERE id = ?",
                (event_id,),
            ).fetchone()
        if row is None:
            raise FileNotFoundError("Demo event not found")
