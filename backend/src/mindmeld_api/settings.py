from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MINDMELD_", env_file=".env", extra="ignore")

    api_cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
        ]
    )
    api_cors_origin_regex: str | None = r"http://(localhost|127\.0\.0\.1):517[3-9]"
    recording_dir: Path = Path("recordings")
    demo_db_path: Path = Path("data/mindmeld_demo.sqlite3")
    websocket_interval_seconds: float = 0.1
    websocket_sample_window: int = 250
    cartesia_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("MINDMELD_CARTESIA_API_KEY", "CARTESIA_API_KEY"),
    )
    cartesia_version: str = "2026-03-01"
    cartesia_model_id: str = "sonic-3.5"
    cartesia_voice_id: str = "62ae83ad-4f6a-430b-af41-a9bede9286ca"
    cartesia_timeout_seconds: float = 8.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
