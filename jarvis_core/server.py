"""HTTP surface for the JARVIS Python Core.

Run it with::

    python -m jarvis_core serve

or import :func:`create_app` and mount it inside another ASGI server.
"""

from __future__ import annotations

import asyncio
import platform
import time
from contextlib import asynccontextmanager
from string import Template
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse

from .commands import CommandRegistry
from .config import CoreConfig
from .events import EventBroker
from .filesystem import (
    AlreadyExistsError,
    NotFoundError,
    PathTraversalError,
    VFSError,
    VirtualFileSystem,
)
from .models import (
    CommandCatalogResponse,
    CommandRequest,
    CommandResponse,
    EndpointInfo,
    FSDeleteRequest,
    FSListResponse,
    FSMkdirRequest,
    FSOperationResponse,
    FSReadResponse,
    FSWriteRequest,
    FSWriteResponse,
    HealthResponse,
    HistoryResponse,
    LoginRequest,
    LoginResponse,
    NeofetchResponse,
    ProcessListResponse,
    StatusResponse,
    TelemetryResponse,
)
from .security import RateLimiter, TokenError, TokenManager, verify_passcode
from .telemetry import TelemetryService


INDEX_TEMPLATE = Template(
    """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>J.A.R.V.I.S. Python Core</title>
  <style>
    :root { color-scheme: dark; --cyan: #00f0ff; --green: #00ff88; --muted: #5a8a9f; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: radial-gradient(circle at 50% 0%, #072235 0%, #03080e 60%);
      color: #d8f6ff; font-family: "Segoe UI", system-ui, sans-serif;
    }
    main { width: min(880px, 92vw); padding: 48px 0 64px; }
    .badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px;
      border: 1px solid rgba(0, 240, 255, 0.4); border-radius: 999px;
      color: var(--green); font: 600 12px/1 monospace; letter-spacing: 2px;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green);
      box-shadow: 0 0 10px var(--green); }
    h1 { margin: 22px 0 8px; font-size: clamp(32px, 6vw, 64px); letter-spacing: 4px; }
    h1 span { color: var(--cyan); }
    p.lead { color: var(--muted); font-size: 17px; line-height: 1.6; max-width: 680px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin: 28px 0; }
    .card {
      padding: 18px; border: 1px solid rgba(0, 240, 255, 0.18); border-radius: 12px;
      background: rgba(8, 20, 30, 0.72);
    }
    .card b { display: block; color: var(--cyan); font-size: 12px; letter-spacing: 2px; margin-bottom: 8px; }
    .card code { font-size: 13px; color: #e6fbff; }
    a { color: var(--cyan); text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(0, 240, 255, 0.1); }
    th { color: var(--muted); font-weight: 600; letter-spacing: 1px; font-size: 11px; text-transform: uppercase; }
    .method { color: var(--green); font-family: monospace; font-size: 12px; }
    footer { margin-top: 34px; color: var(--muted); font: 12px monospace; }
  </style>
</head>
<body>
  <main>
    <div class="badge"><span class="dot"></span> PYTHON CORE ONLINE // v$version</div>
    <h1>J.A.R.V.I.S. <span>CORE</span></h1>
    <p class="lead">
      The local Python brain behind the holographic HUD. FastAPI serves live
      telemetry, a sandboxed filesystem, a whitelisted command engine and an
      event stream. The browser view connects automatically when this process
      is running.
    </p>
    <div class="grid">
      <div class="card"><b>HEALTH</b><code>GET /api/health</code></div>
      <div class="card"><b>TELEMETRY</b><code>GET /api/telemetry</code></div>
      <div class="card"><b>COMMANDS</b><code>POST /api/command</code></div>
      <div class="card"><b>EVENTS</b><code>GET /api/events</code></div>
    </div>
    <h2>API Surface</h2>
    <table>
      <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
      <tbody>$endpoint_rows</tbody>
    </table>
    <footer>
      Python $python // $platform // $host:$port<br>
      Docs: <a href="/api/docs">/api/docs</a> &nbsp;|&nbsp;
      OpenAPI: <a href="/api/openapi.json">/api/openapi.json</a>
    </footer>
  </main>
</body>
</html>
"""
)


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def create_app(config: CoreConfig | None = None) -> FastAPI:
    """Build and return the FastAPI application."""

    config = config or CoreConfig.from_env()
    config.ensure_dirs()

    telemetry = TelemetryService(config)
    filesystem = VirtualFileSystem(config.vfs_dir, config.max_file_bytes)
    tokens = TokenManager(config.secret or None, config.token_ttl)
    limiter = RateLimiter(config.rate_limit, config.rate_window)
    broker = EventBroker()
    commands = CommandRegistry(telemetry, filesystem, config)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        telemetry.sample()

        async def publisher() -> None:
            while True:
                try:
                    snapshot = await asyncio.to_thread(telemetry.sample)
                    await broker.publish("telemetry", snapshot)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    pass
                await asyncio.sleep(max(0.5, config.telemetry_interval))

        task = asyncio.create_task(publisher())
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    app = FastAPI(
        title="J.A.R.V.I.S. Python Core",
        description=(
            "Local telemetry, sandboxed filesystem and command service for the "
            "J.A.R.V.I.S. HUD."
        ),
        version=config.version,
        lifespan=lifespan,
        docs_url="/api/docs" if config.docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if config.docs_enabled else None,
    )

    app.state.config = config
    app.state.telemetry = telemetry
    app.state.filesystem = filesystem
    app.state.tokens = tokens
    app.state.limiter = limiter
    app.state.broker = broker
    app.state.commands = commands

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.allowed_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Jarvis-Core", "X-Process-Time"],
    )

    @app.middleware("http")
    async def core_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Jarvis-Core"] = config.version
        response.headers["X-Process-Time"] = f"{(time.perf_counter() - started) * 1000:.2f}ms"
        return response

    def require_auth(request: Request) -> dict[str, Any]:
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            raise HTTPException(
                status_code=401,
                detail="Missing bearer token. POST /api/auth/login first.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token = header.split(" ", 1)[1].strip()
        try:
            return tokens.verify(token)
        except TokenError as exc:
            raise HTTPException(
                status_code=401,
                detail=str(exc),
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    def enforce_rate(request: Request, scope: str) -> None:
        result = limiter.check(f"{scope}:{_client_key(request)}")
        if not result.allowed:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Slow down and retry.",
                headers={"Retry-After": str(max(1, int(result.retry_after)))},
            )

    @app.exception_handler(VFSError)
    async def vfs_exception_handler(request: Request, exc: VFSError) -> JSONResponse:
        if isinstance(exc, NotFoundError):
            status_code = 404
        elif isinstance(exc, AlreadyExistsError):
            status_code = 409
        elif isinstance(exc, PathTraversalError):
            status_code = 403
        else:
            status_code = 400
        return JSONResponse(status_code=status_code, content={"detail": str(exc)})

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------
    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    async def index() -> HTMLResponse:
        rows = "\n".join(
            "<tr><td class=\"method\">{method}</td><td><code>{path}</code></td>"
            "<td>{description}{auth}</td></tr>".format(
                method=endpoint["method"],
                path=endpoint["path"],
                description=endpoint["description"],
                auth=" <em>(auth)</em>" if endpoint["auth"] else "",
            )
            for endpoint in config.endpoint_catalog()
        )
        return HTMLResponse(
            INDEX_TEMPLATE.substitute(
                version=config.version,
                endpoint_rows=rows,
                python=platform.python_version(),
                platform=platform.platform(),
                host=config.host,
                port=config.port,
            )
        )

    @app.get("/api/health", response_model=HealthResponse, tags=["discovery"])
    async def health() -> HealthResponse:
        return HealthResponse(
            version=config.version,
            python_version=platform.python_version(),
            platform=platform.platform(),
            hostname=telemetry.hostname,
            uptime_seconds=round(time.time() - telemetry.started_at, 2),
            timestamp=time.time(),
            core_url=config.public_url,
            telemetry_source=telemetry.source,
        )

    @app.get("/api/status", response_model=StatusResponse, tags=["discovery"])
    async def status() -> StatusResponse:
        snapshot = telemetry.sample()
        return StatusResponse(
            version=config.version,
            python_version=platform.python_version(),
            platform=platform.platform(),
            hostname=telemetry.hostname,
            uptime_seconds=round(time.time() - telemetry.started_at, 2),
            timestamp=time.time(),
            core_url=config.public_url,
            telemetry_source=telemetry.source,
            command_count=commands.count,
            process_count=int(snapshot["process_count"]),
            file_count=filesystem.count_files(),
            endpoints=[EndpointInfo(**endpoint) for endpoint in config.endpoint_catalog()],
            features=[
                "real system telemetry",
                "top process monitor",
                "sandboxed virtual filesystem",
                "whitelisted command engine",
                "HMAC bearer authentication",
                "server-sent telemetry events",
                "Prometheus metrics",
                "CLI client",
            ],
        )

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------
    @app.post("/api/auth/login", response_model=LoginResponse, tags=["auth"])
    async def login(payload: LoginRequest, request: Request) -> LoginResponse:
        enforce_rate(request, "login")
        if not verify_passcode(payload.passcode, config.passcode):
            raise HTTPException(status_code=401, detail="Invalid core passcode")
        token, expires_at = tokens.issue("operator")
        return LoginResponse(token=token, expires_at=expires_at, subject="operator")

    # ------------------------------------------------------------------
    # Telemetry
    # ------------------------------------------------------------------
    @app.get("/api/telemetry", response_model=TelemetryResponse, tags=["telemetry"])
    async def telemetry_snapshot() -> TelemetryResponse:
        return TelemetryResponse(**telemetry.sample())

    @app.get(
        "/api/telemetry/history",
        response_model=HistoryResponse,
        tags=["telemetry"],
    )
    async def telemetry_history() -> HistoryResponse:
        return HistoryResponse(history=telemetry.history())

    @app.get("/api/processes", response_model=ProcessListResponse, tags=["telemetry"])
    async def processes(
        limit: int | None = Query(default=None, ge=1, le=100),
    ) -> ProcessListResponse:
        return ProcessListResponse(**telemetry.processes(limit))

    @app.get("/api/neofetch", response_model=NeofetchResponse, tags=["telemetry"])
    async def neofetch() -> NeofetchResponse:
        return NeofetchResponse(lines=telemetry.neofetch_lines(), source=telemetry.source)

    @app.get("/api/metrics", response_class=PlainTextResponse, tags=["telemetry"])
    async def metrics() -> PlainTextResponse:
        return PlainTextResponse(telemetry.prometheus())

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------
    @app.get(
        "/api/commands",
        response_model=CommandCatalogResponse,
        tags=["commands"],
    )
    async def command_catalog() -> CommandCatalogResponse:
        return CommandCatalogResponse(commands=commands.catalog(), count=commands.count)

    @app.post("/api/command", response_model=CommandResponse, tags=["commands"])
    async def execute_command(
        payload: CommandRequest,
        request: Request,
        _: dict[str, Any] = Depends(require_auth),
    ) -> CommandResponse:
        enforce_rate(request, "command")
        result = commands.execute(payload.command, payload.cwd)
        return CommandResponse(
            command=payload.command,
            output=result.output,
            exit_code=result.exit_code,
            duration_ms=result.duration_ms,
            clear=result.clear,
            close=result.close,
            cwd=result.cwd,
        )

    # ------------------------------------------------------------------
    # Virtual filesystem
    # ------------------------------------------------------------------
    @app.get("/api/fs", response_model=FSListResponse, tags=["filesystem"])
    async def fs_list(path: str = Query(default="/", max_length=1024)) -> FSListResponse:
        return FSListResponse(**filesystem.list_dir(path))

    @app.get("/api/fs/read", response_model=FSReadResponse, tags=["filesystem"])
    async def fs_read(path: str = Query(min_length=1, max_length=1024)) -> FSReadResponse:
        return FSReadResponse(**filesystem.read_file(path))

    @app.post("/api/fs/write", response_model=FSWriteResponse, tags=["filesystem"])
    async def fs_write(
        payload: FSWriteRequest,
        request: Request,
        _: dict[str, Any] = Depends(require_auth),
    ) -> FSWriteResponse:
        enforce_rate(request, "fs")
        return FSWriteResponse(
            **filesystem.write_file(payload.path, payload.content, payload.append)
        )

    @app.post("/api/fs/mkdir", response_model=FSOperationResponse, tags=["filesystem"])
    async def fs_mkdir(
        payload: FSMkdirRequest,
        request: Request,
        _: dict[str, Any] = Depends(require_auth),
    ) -> FSOperationResponse:
        enforce_rate(request, "fs")
        item = filesystem.mkdir(payload.path)
        return FSOperationResponse(path=item["path"], message=f"Created {item['path']}")

    @app.post("/api/fs/delete", response_model=FSOperationResponse, tags=["filesystem"])
    async def fs_delete(
        payload: FSDeleteRequest,
        request: Request,
        _: dict[str, Any] = Depends(require_auth),
    ) -> FSOperationResponse:
        enforce_rate(request, "fs")
        return FSOperationResponse(**filesystem.delete(payload.path))

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------
    @app.get("/api/events", tags=["events"])
    async def events(request: Request) -> StreamingResponse:
        queue = await broker.subscribe()

        async def generator() -> AsyncIterator[str]:
            yield "retry: 3000\n\n"
            async for chunk in broker.stream(queue):
                if await request.is_disconnected():
                    break
                yield chunk

        return StreamingResponse(
            generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return app


def run(config: CoreConfig | None = None, reload: bool = False) -> None:
    """Start the core with uvicorn."""

    import uvicorn

    config = config or CoreConfig.from_env()
    if reload:
        uvicorn.run(
            "jarvis_core.server:create_app",
            factory=True,
            host=config.host,
            port=config.port,
            reload=True,
            log_level=config.log_level,
        )
        return
    uvicorn.run(
        create_app(config),
        host=config.host,
        port=config.port,
        log_level=config.log_level,
    )


if __name__ == "__main__":  # pragma: no cover
    run()
