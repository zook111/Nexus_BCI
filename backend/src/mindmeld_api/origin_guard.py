"""Reject unrelated browser origins before local API side effects or EEG streaming."""

from collections.abc import Sequence
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.websockets import WebSocket


class LocalOriginGuard:
    def __init__(
        self,
        app: ASGIApp,
        *,
        allow_origins: Sequence[str],
        allow_origin_regex: str | None = None,
    ) -> None:
        self.app = app
        self.policy = CORSMiddleware(
            app, allow_origins=allow_origins, allow_origin_regex=allow_origin_regex
        )

    @staticmethod
    def _same_local_origin(scope: Scope, origin: str) -> bool:
        """Allow same-origin API documentation, including custom local API ports."""
        scheme = {"ws": "http", "wss": "https"}.get(scope["scheme"], scope["scheme"])
        host = Headers(scope=scope).get("host", "")
        try:
            parsed = urlsplit(origin)
        except ValueError:
            return False
        return (
            parsed.scheme == scheme
            and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
            and parsed.netloc.lower() == host.lower()
            and not parsed.path
            and not parsed.query
            and not parsed.fragment
            and parsed.username is None
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in {"http", "websocket"}:
            origin = Headers(scope=scope).get("origin")
            # Native local clients need no Origin. Browsers supply it themselves.
            # This guard is not authentication for processes on the local machine.
            if (
                origin is not None
                and not self.policy.is_allowed_origin(origin)
                and not self._same_local_origin(scope, origin)
            ):
                if scope["type"] == "websocket":
                    await WebSocket(scope, receive, send).close(code=1008)
                else:
                    await JSONResponse(
                        {"detail": "Browser origin is not allowed for the local Nexus API."},
                        status_code=403,
                    )(scope, receive, send)
                return
        await self.app(scope, receive, send)
