"""Pydantic contracts for the JARVIS Python Core API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class _StrictRequest(BaseModel):
    """Base class for request bodies that must not contain extra keys."""

    model_config = ConfigDict(extra="forbid")


class LoginRequest(_StrictRequest):
    passcode: str = Field(min_length=1, max_length=256, description="Core passcode")


class LoginResponse(BaseModel):
    token: str
    token_type: str = "Bearer"
    expires_at: float
    subject: str


class EndpointInfo(BaseModel):
    method: str
    path: str
    description: str
    auth: bool


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "jarvis-core"
    version: str
    python_version: str
    platform: str
    hostname: str
    uptime_seconds: float
    timestamp: float
    core_url: str
    telemetry_source: str


class StatusResponse(BaseModel):
    status: str = "ok"
    service: str = "jarvis-core"
    version: str
    python_version: str
    platform: str
    hostname: str
    uptime_seconds: float
    timestamp: float
    core_url: str
    telemetry_source: str
    command_count: int
    process_count: int
    file_count: int
    endpoints: list[EndpointInfo]
    features: list[str]


class CpuMetrics(BaseModel):
    percent: float = 0.0
    frequency_mhz: float | None = None
    physical_cores: int | None = None
    logical_cores: int | None = None
    per_core: list[float] = Field(default_factory=list)
    load_average: list[float] = Field(default_factory=list)


class MemoryMetrics(BaseModel):
    total: int = 0
    used: int = 0
    available: int = 0
    percent: float = 0.0
    swap_total: int = 0
    swap_used: int = 0
    swap_percent: float = 0.0


class DiskMetrics(BaseModel):
    path: str
    total: int = 0
    used: int = 0
    free: int = 0
    percent: float = 0.0


class NetworkMetrics(BaseModel):
    bytes_sent: int = 0
    bytes_recv: int = 0
    packets_sent: int = 0
    packets_recv: int = 0
    upload_bps: float = 0.0
    download_bps: float = 0.0


class ProcessInfo(BaseModel):
    pid: int
    name: str
    username: str | None = None
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    memory_rss: int = 0
    status: str | None = None
    cmdline: list[str] = Field(default_factory=list)


class ProcessListResponse(BaseModel):
    processes: list[ProcessInfo]
    total: int
    source: str
    timestamp: float


class TelemetryResponse(BaseModel):
    timestamp: float
    timestamp_iso: str
    hostname: str
    platform: str
    processor: str
    python_version: str
    core_version: str
    source: str
    app_uptime_seconds: float
    system_uptime_seconds: float
    cpu: CpuMetrics
    memory: MemoryMetrics
    disk: DiskMetrics
    network: NetworkMetrics
    process_count: int = 0
    temperature_c: float | None = None
    battery_percent: float | None = None
    battery_plugged: bool | None = None


class HistoryResponse(BaseModel):
    history: list[dict[str, Any]]


class CommandInfo(BaseModel):
    name: str
    description: str
    usage: str
    category: str
    mutates_filesystem: bool = False


class CommandCatalogResponse(BaseModel):
    commands: list[CommandInfo]
    count: int


class CommandRequest(_StrictRequest):
    command: str = Field(min_length=1, max_length=2048)
    cwd: str = Field(default="/home/operator", max_length=512)


class CommandResponse(BaseModel):
    command: str
    output: list[str]
    exit_code: int
    duration_ms: float
    clear: bool = False
    close: bool = False
    cwd: str | None = None


class FSItem(BaseModel):
    name: str
    path: str
    type: str
    size: int = 0
    modified: float = 0.0
    modified_iso: str = ""


class FSListResponse(BaseModel):
    path: str
    items: list[FSItem]
    total: int


class FSReadResponse(BaseModel):
    path: str
    content: str
    size: int
    modified: float
    modified_iso: str


class FSWriteRequest(_StrictRequest):
    path: str = Field(min_length=1, max_length=1024)
    content: str = Field(default="", max_length=1_048_576)
    append: bool = False


class FSWriteResponse(BaseModel):
    path: str
    size: int
    modified: float
    modified_iso: str
    created: bool


class FSMkdirRequest(_StrictRequest):
    path: str = Field(min_length=1, max_length=1024)


class FSDeleteRequest(_StrictRequest):
    path: str = Field(min_length=1, max_length=1024)


class FSOperationResponse(BaseModel):
    ok: bool = True
    path: str
    message: str


class NeofetchResponse(BaseModel):
    lines: list[str]
    source: str


class ErrorResponse(BaseModel):
    detail: str
