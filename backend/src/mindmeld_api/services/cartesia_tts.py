from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class CartesiaTtsError(RuntimeError):
    pass


def synthesize_speech(
    *,
    api_key: str,
    transcript: str,
    model_id: str,
    voice_id: str,
    version: str,
    speed: float = 1.0,
    volume: float = 1.0,
    timeout_seconds: float = 8.0,
) -> bytes:
    payload = {
        "model_id": model_id,
        "transcript": transcript,
        "voice": {
            "mode": "id",
            "id": voice_id,
        },
        "output_format": {
            "container": "wav",
            "encoding": "pcm_s16le",
            "sample_rate": 44100,
        },
        "language": "en",
        "generation_config": {
            "speed": speed,
            "volume": volume,
        },
    }
    request = Request(
        "https://api.cartesia.ai/tts/bytes",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Cartesia-Version": version,
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            return response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise CartesiaTtsError(f"Cartesia TTS failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise CartesiaTtsError(f"Cartesia TTS request failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise CartesiaTtsError("Cartesia TTS request timed out") from exc
