"""Runtime configuration for the JARVIS Python Core.

Every value can be overridden with an environment variable, which makes
the service easy to run in a terminal, inside a container, or from a
test harness without touching the source code.
"""

from __future__ import annotations

import os
import platform
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PASSCODE = "151627"
CORE_VERSION = "1.0.0"
SERVICE_NAME = "jarvis-core"


def _as_bool(value: str | None, default: bool = False) -> bool:
    """Convert a typical environment string into a boolean."""

    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _as_int(value: str | None, default: int) -> int:
    """Convert an environment string into an integer with a safe fallback."""

    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _as_float(value: str | None, default: float) -> float:
    """Convert an environment string into a float with a safe fallback."""

    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def _as_csv_tuple(value: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    """Split a comma separated environment string into a tuple."""

    if value is None:
        return default
    items = tuple(part.strip() for part in value.split(",") if part.strip())
    return items or default


@dataclass(frozen=True)
class CoreConfig:
    """Immutable configuration shared by every core component."""

    version: str = CORE_VERSION
    service_name: str = SERVICE_NAME
    host: str = "127.0.0.1"
    port: int = 8765
    passcode: str = DEFAULT_PASSCODE
    secret: str = ""
    data_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data")
    token_ttl: int = 8 * 60 * 60
    telemetry_interval: float = 2.0
    history_size: int = 60
    max_processes: int = 15
    rate_limit: int = 30
    rate_window: float = 60.0
    allowed_origins: tuple[str, ...] = ("*",)
    log_level: str = "info"
    max_file_bytes: int = 1_048_576
    docs_enabled: bool = True

    @property
    def vfs_dir(self) -> Path:
        """Location of the sandboxed virtual filesystem."""

        return self.data_dir / "vfs"

    @property
    def log_dir(self) -> Path:
        """Location for core diagnostic logs."""

        return self.data_dir / "logs"

    @property
    def public_url(self) -> str:
        """URL that a local browser should use to reach the core."""

        host = self.host
        if host in {"0.0.0.0", "::", ""}:
            host = "127.0.0.1"
        return f"http://{host}:{self.port}"

    def ensure_dirs(self) -> None:
        """Create every directory required by the core."""

        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.vfs_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def as_public_dict(self) -> dict[str, Any]:
        """Return safe configuration details for the status endpoint."""

        return {
            "service": self.service_name,
            "version": self.version,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "host": self.host,
            "port": self.port,
            "core_url": self.public_url,
            "telemetry_interval": self.telemetry_interval,
            "history_size": self.history_size,
            "max_processes": self.max_processes,
            "token_ttl": self.token_ttl,
            "docs_enabled": self.docs_enabled,
        }

    def endpoint_catalog(self) -> list[dict[str, Any]]:
        """A human readable list of the HTTP surface of the core."""

        return [
            {
                "method": "GET",
                "path": "/api/health",
                "description": "Liveness probe and core metadata",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/status",
                "description": "Full status, feature list and endpoint catalog",
                "auth": False,
            },
            {
                "method": "POST",
                "path": "/api/auth/login",
                "description": "Exchange the passcode for a signed bearer token",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/telemetry",
                "description": "Live CPU, memory, disk, network and load metrics",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/telemetry/history",
                "description": "Rolling history of telemetry samples",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/processes",
                "description": "Top processes sorted by CPU and memory",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/commands",
                "description": "Machine readable command catalog",
                "auth": False,
            },
            {
                "method": "POST",
                "path": "/api/command",
                "description": "Execute a whitelisted shell directive",
                "auth": True,
            },
            {
                "method": "GET",
                "path": "/api/fs",
                "description": "List a directory in the sandboxed virtual filesystem",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/fs/read",
                "description": "Read a text file from the sandbox",
                "auth": False,
            },
            {
                "method": "POST",
                "path": "/api/fs/write",
                "description": "Create or update a sandboxed text file",
                "auth": True,
            },
            {
                "method": "POST",
                "path": "/api/fs/mkdir",
                "description": "Create a sandboxed directory",
                "auth": True,
            },
            {
                "method": "POST",
                "path": "/api/fs/delete",
                "description": "Delete a sandboxed file or directory",
                "auth": True,
            },
            {
                "method": "GET",
                "path": "/api/neofetch",
                "description": "ASCII telemetry card rendered by Python",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/metrics",
                "description": "Prometheus compatible metrics",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/events",
                "description": "Server-sent event stream with live telemetry",
                "auth": False,
            },
            {
                "method": "GET",
                "path": "/api/openapi.json",
                "description": "OpenAPI schema for the Python core",
                "auth": False,
            },
        ]

    @classmethod
    def from_env(cls, **overrides: Any) -> "CoreConfig":
        """Build a configuration from environment variables."""

        data_dir = os.getenv("JARVIS_CORE_DATA", str(PROJECT_ROOT / "data"))
        values: dict[str, Any] = {
            "host": os.getenv("JARVIS_CORE_HOST", "127.0.0.1"),
            "port": _as_int(os.getenv("JARVIS_CORE_PORT"), 8765),
            "passcode": os.getenv("JARVIS_CORE_PASSCODE", DEFAULT_PASSCODE),
            "secret": os.getenv("JARVIS_CORE_SECRET", ""),
            "data_dir": Path(data_dir).expanduser(),
            "token_ttl": _as_int(os.getenv("JARVIS_CORE_TOKEN_TTL"), 8 * 60 * 60),
            "telemetry_interval": _as_float(
                os.getenv("JARVIS_CORE_TELEMETRY_INTERVAL"), 2.0
            ),
            "history_size": _as_int(os.getenv("JARVIS_CORE_HISTORY_SIZE"), 60),
            "max_processes": _as_int(os.getenv("JARVIS_CORE_MAX_PROCESSES"), 15),
            "rate_limit": _as_int(os.getenv("JARVIS_CORE_RATE_LIMIT"), 30),
            "rate_window": _as_float(os.getenv("JARVIS_CORE_RATE_WINDOW"), 60.0),
            "allowed_origins": _as_csv_tuple(
                os.getenv("JARVIS_CORE_ORIGINS"), ("*",)
            ),
            "log_level": os.getenv("JARVIS_CORE_LOG_LEVEL", "info"),
            "max_file_bytes": _as_int(
                os.getenv("JARVIS_CORE_MAX_FILE_BYTES"), 1_048_576
            ),
            "docs_enabled": _as_bool(
                os.getenv("JARVIS_CORE_DOCS"), default=True
            ),
        }
        values.update({key: value for key, value in overrides.items() if value is not None})
        config = cls(**values)
        config.ensure_dirs()
        return config

    def with_overrides(self, **overrides: Any) -> "CoreConfig":
        """Return a copy of this configuration with selected values replaced."""

        cleaned = {key: value for key, value in overrides.items() if value is not None}
        return replace(self, **cleaned)
