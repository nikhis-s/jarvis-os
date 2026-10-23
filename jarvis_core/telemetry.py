"""System telemetry collection for the JARVIS Core.

Uses ``psutil`` for real hardware metrics and falls back to a smooth,
believable simulation when psutil is unavailable. Every value returned
from :meth:`TelemetryService.sample` is JSON serialisable.
"""

from __future__ import annotations

import math
import os
import platform
import random
import shutil
import socket
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

try:  # psutil is optional at import time so the core still starts without it
    import psutil
except Exception:  # pragma: no cover - only hit on broken installations
    psutil = None  # type: ignore[assignment]

from .config import CoreConfig


def format_bytes(value: float | int | None) -> str:
    """Format a byte count as a compact human readable string."""

    if value is None:
        return "n/a"
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return "n/a"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    index = 0
    while abs(amount) >= 1024 and index < len(units) - 1:
        amount /= 1024.0
        index += 1
    return f"{amount:.1f} {units[index]}"


def format_duration(seconds: float | int | None) -> str:
    """Format a duration in seconds as ``Xd HH:MM:SS``."""

    if seconds is None:
        return "n/a"
    total = max(0, int(seconds))
    days, remainder = divmod(total, 86_400)
    hours, remainder = divmod(remainder, 3_600)
    minutes, secs = divmod(remainder, 60)
    if days:
        return f"{days}d {hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class TelemetryService:
    """Collect and retain a rolling window of system telemetry."""

    def __init__(self, config: CoreConfig) -> None:
        self.config = config
        self.started_at = time.time()
        self.hostname = socket.gethostname()
        self.platform = platform.platform()
        self.processor = platform.processor() or platform.machine() or "Unknown"
        self.python_version = platform.python_version()
        self._history: deque[dict[str, Any]] = deque(maxlen=config.history_size)
        self._lock = threading.Lock()
        self._last_sample: dict[str, Any] | None = None
        self._last_net: tuple[int, int, int, int] | None = None
        self._last_net_at = time.monotonic()
        self._simulated = psutil is None
        if psutil is not None:
            try:
                psutil.cpu_percent(interval=None)  # prime the non-blocking counter
                psutil.cpu_percent(interval=None, percpu=True)
            except Exception:
                self._simulated = True
            self._last_net = self._read_network_counters()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    @property
    def is_simulated(self) -> bool:
        return self._simulated

    @property
    def source(self) -> str:
        return "simulated" if self._simulated else "psutil"

    def sample(self) -> dict[str, Any]:
        """Return a complete telemetry snapshot and append it to history."""

        with self._lock:
            if not self._simulated:
                try:
                    snapshot = self._sample_psutil()
                except Exception:
                    self._simulated = True
                    snapshot = self._sample_simulated()
            else:
                snapshot = self._sample_simulated()

            summary = {
                "timestamp": snapshot["timestamp"],
                "cpu_percent": snapshot["cpu"]["percent"],
                "memory_percent": snapshot["memory"]["percent"],
                "disk_percent": snapshot["disk"]["percent"],
                "upload_bps": snapshot["network"]["upload_bps"],
                "download_bps": snapshot["network"]["download_bps"],
                "source": snapshot["source"],
            }
            self._history.append(summary)
            self._last_sample = snapshot
            return snapshot

    def history(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._history)

    def processes(self, limit: int | None = None) -> dict[str, Any]:
        """Return the top processes sorted by CPU then memory usage."""

        cap = max(1, min(int(limit or self.config.max_processes), 100))
        if self._simulated or psutil is None:
            processes, total = self._simulated_processes(cap)
        else:
            processes, total = self._psutil_processes(cap)
        return {
            "processes": processes,
            "total": total,
            "source": self.source,
            "timestamp": time.time(),
        }

    def neofetch_lines(self) -> list[str]:
        """Render an ASCII telemetry card using the freshest sample."""

        data = self._last_sample or self.sample()
        cpu = data["cpu"]
        memory = data["memory"]
        disk = data["disk"]
        network = data["network"]
        freq = cpu.get("frequency_mhz")
        freq_text = f"{freq / 1000:.2f} GHz" if freq else "n/a"
        lines = [
            "            .---.            OS: J.A.R.V.I.S. Core "
            f"{self.config.version}",
            "           /     \\           Host: " + data["hostname"],
            "          | () () |          Python: " + data["python_version"],
            "           \\  ^  /           Platform: " + data["platform"][:48],
            "            |||||            CPU: " + data["processor"][:44],
            "            '---'            Cores: "
            f"{cpu.get('logical_cores') or 'n/a'} logical / "
            f"{cpu.get('physical_cores') or 'n/a'} physical",
            "           /     \\           Load: "
            f"{cpu['percent']:.1f}% @ {freq_text}",
            "          /|     |\\          Memory: "
            f"{format_bytes(memory['used'])} / {format_bytes(memory['total'])} "
            f"({memory['percent']:.1f}%)",
            "         (_|     |_)         Disk: "
            f"{format_bytes(disk['used'])} / {format_bytes(disk['total'])} "
            f"({disk['percent']:.1f}%)",
            "                             Network: "
            f"↑ {format_bytes(network['upload_bps'])}/s  "
            f"↓ {format_bytes(network['download_bps'])}/s",
            f"                             Uptime: {format_duration(data['app_uptime_seconds'])}",
            f"                             Source: {data['source']}",
        ]
        return lines

    def prometheus(self) -> str:
        """Expose a small Prometheus compatible metrics page."""

        data = self._last_sample or self.sample()
        cpu = data["cpu"]
        memory = data["memory"]
        disk = data["disk"]
        network = data["network"]
        lines = [
            "# HELP jarvis_core_up Whether the Python core is serving metrics.",
            "# TYPE jarvis_core_up gauge",
            "jarvis_core_up 1",
            "# HELP jarvis_core_cpu_percent Current aggregate CPU load.",
            "# TYPE jarvis_core_cpu_percent gauge",
            f"jarvis_core_cpu_percent {cpu['percent']:.4f}",
            "# HELP jarvis_core_memory_percent Current RAM utilisation.",
            "# TYPE jarvis_core_memory_percent gauge",
            f"jarvis_core_memory_percent {memory['percent']:.4f}",
            "# HELP jarvis_core_disk_percent Current disk utilisation.",
            "# TYPE jarvis_core_disk_percent gauge",
            f"jarvis_core_disk_percent {disk['percent']:.4f}",
            "# HELP jarvis_core_network_upload_bps Current upload rate.",
            "# TYPE jarvis_core_network_upload_bps gauge",
            f"jarvis_core_network_upload_bps {network['upload_bps']:.2f}",
            "# HELP jarvis_core_network_download_bps Current download rate.",
            "# TYPE jarvis_core_network_download_bps gauge",
            f"jarvis_core_network_download_bps {network['download_bps']:.2f}",
            "# HELP jarvis_core_processes Number of visible processes.",
            "# TYPE jarvis_core_processes gauge",
            f"jarvis_core_processes {data['process_count']}",
            "# HELP jarvis_core_uptime_seconds Application uptime.",
            "# TYPE jarvis_core_uptime_seconds counter",
            f"jarvis_core_uptime_seconds {data['app_uptime_seconds']:.2f}",
        ]
        return "\n".join(lines) + "\n"

    def log_line(self) -> str:
        data = self._last_sample or self.sample()
        return (
            f"{_iso(data['timestamp'])} cpu={data['cpu']['percent']:.1f}% "
            f"mem={data['memory']['percent']:.1f}% "
            f"disk={data['disk']['percent']:.1f}% source={data['source']}"
        )

    # ------------------------------------------------------------------
    # psutil implementation
    # ------------------------------------------------------------------
    def _read_network_counters(self) -> tuple[int, int, int, int] | None:
        if psutil is None:
            return None
        try:
            counters = psutil.net_io_counters()
        except Exception:
            return None
        if counters is None:
            return None
        return (
            _safe_int(counters.bytes_sent),
            _safe_int(counters.bytes_recv),
            _safe_int(counters.packets_sent),
            _safe_int(counters.packets_recv),
        )

    def _network_rates(self, counters: tuple[int, int, int, int]) -> tuple[float, float]:
        now = time.monotonic()
        if self._last_net is None:
            self._last_net = counters
            self._last_net_at = now
            return 0.0, 0.0
        elapsed = max(0.001, now - self._last_net_at)
        upload = max(0.0, (counters[0] - self._last_net[0]) / elapsed)
        download = max(0.0, (counters[1] - self._last_net[1]) / elapsed)
        self._last_net = counters
        self._last_net_at = now
        return upload, download

    def _load_average(self) -> list[float]:
        try:
            values = os.getloadavg()
        except (AttributeError, OSError):
            return []
        return [round(float(value), 2) for value in values]

    def _temperature(self) -> float | None:
        if psutil is None:
            return None
        getter = getattr(psutil, "sensors_temperatures", None)
        if getter is None:
            return None
        try:
            groups = getter()
        except Exception:
            return None
        if not groups:
            return None
        for entries in groups.values():
            for entry in entries:
                current = getattr(entry, "current", None)
                if current is not None:
                    return round(float(current), 1)
        return None

    def _battery(self) -> tuple[float | None, bool | None]:
        if psutil is None:
            return None, None
        getter = getattr(psutil, "sensors_battery", None)
        if getter is None:
            return None, None
        try:
            battery = getter()
        except Exception:
            return None, None
        if battery is None:
            return None, None
        return round(_safe_float(battery.percent), 1), bool(battery.power_plugged)

    def _sample_psutil(self) -> dict[str, Any]:
        now = time.time()
        per_core = [
            round(_safe_float(value), 2)
            for value in psutil.cpu_percent(interval=None, percpu=True)
        ]
        cpu_percent = round(sum(per_core) / len(per_core), 2) if per_core else 0.0
        frequency = None
        try:
            freq = psutil.cpu_freq()
            if freq is not None:
                frequency = round(_safe_float(getattr(freq, "current", 0)), 1) or None
        except Exception:
            frequency = None

        logical_cores = psutil.cpu_count(logical=True)
        physical_cores = psutil.cpu_count(logical=False)
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        disk = psutil.disk_usage(str(self.config.data_dir))
        counters = self._read_network_counters() or (0, 0, 0, 0)
        upload, download = self._network_rates(counters)
        battery_percent, battery_plugged = self._battery()
        try:
            boot_time = psutil.boot_time()
            system_uptime = max(0.0, now - boot_time)
        except Exception:
            system_uptime = 0.0
        try:
            process_count = len(psutil.pids())
        except Exception:
            process_count = 0

        return {
            "timestamp": now,
            "timestamp_iso": _iso(now),
            "hostname": self.hostname,
            "platform": self.platform,
            "processor": self.processor,
            "python_version": self.python_version,
            "core_version": self.config.version,
            "source": "psutil",
            "app_uptime_seconds": round(now - self.started_at, 2),
            "system_uptime_seconds": round(system_uptime, 2),
            "cpu": {
                "percent": cpu_percent,
                "frequency_mhz": frequency,
                "physical_cores": physical_cores,
                "logical_cores": logical_cores,
                "per_core": per_core,
                "load_average": self._load_average(),
            },
            "memory": {
                "total": _safe_int(memory.total),
                "used": _safe_int(memory.used),
                "available": _safe_int(memory.available),
                "percent": round(_safe_float(memory.percent), 2),
                "swap_total": _safe_int(swap.total),
                "swap_used": _safe_int(swap.used),
                "swap_percent": round(_safe_float(swap.percent), 2),
            },
            "disk": {
                "path": str(self.config.data_dir),
                "total": _safe_int(disk.total),
                "used": _safe_int(disk.used),
                "free": _safe_int(disk.free),
                "percent": round(_safe_float(disk.percent), 2),
            },
            "network": {
                "bytes_sent": counters[0],
                "bytes_recv": counters[1],
                "packets_sent": counters[2],
                "packets_recv": counters[3],
                "upload_bps": round(upload, 2),
                "download_bps": round(download, 2),
            },
            "process_count": process_count,
            "temperature_c": self._temperature(),
            "battery_percent": battery_percent,
            "battery_plugged": battery_plugged,
        }

    def _psutil_processes(self, limit: int) -> tuple[list[dict[str, Any]], int]:
        attrs = [
            "pid",
            "name",
            "username",
            "cpu_percent",
            "memory_percent",
            "memory_info",
            "status",
            "cmdline",
        ]
        rows: list[dict[str, Any]] = []
        assert psutil is not None
        for process in psutil.process_iter(attrs, ad_value=None):
            try:
                info = process.info
                memory_info = info.get("memory_info")
                rss = _safe_int(getattr(memory_info, "rss", 0)) if memory_info else 0
                cmdline = info.get("cmdline") or []
                if not isinstance(cmdline, list):
                    cmdline = [str(cmdline)]
                rows.append(
                    {
                        "pid": _safe_int(info.get("pid")),
                        "name": str(info.get("name") or "unknown"),
                        "username": info.get("username"),
                        "cpu_percent": round(_safe_float(info.get("cpu_percent")), 2),
                        "memory_percent": round(
                            _safe_float(info.get("memory_percent")), 2
                        ),
                        "memory_rss": rss,
                        "status": info.get("status"),
                        "cmdline": [str(part) for part in cmdline[:6]],
                    }
                )
            except Exception:
                continue
        rows.sort(
            key=lambda row: (row["cpu_percent"], row["memory_percent"]), reverse=True
        )
        return rows[:limit], len(rows)

    # ------------------------------------------------------------------
    # Simulation fallback
    # ------------------------------------------------------------------
    def _sample_simulated(self) -> dict[str, Any]:
        now = time.time()
        phase = now / 7.0
        cpu_percent = round(38 + 22 * math.sin(phase) + random.uniform(-4, 4), 2)
        cpu_percent = max(2.0, min(99.0, cpu_percent))
        per_core = [
            round(max(1.0, min(99.0, cpu_percent + random.uniform(-14, 14))), 2)
            for _ in range(8)
        ]
        memory_total = 32 * 1024**3
        memory_percent = round(54 + 9 * math.sin(phase / 2.1) + random.uniform(-2, 2), 2)
        memory_used = int(memory_total * memory_percent / 100)
        disk_total = shutil.disk_usage(str(self.config.data_dir)).total
        disk_used = shutil.disk_usage(str(self.config.data_dir)).used

        return {
            "timestamp": now,
            "timestamp_iso": _iso(now),
            "hostname": self.hostname,
            "platform": self.platform,
            "processor": self.processor,
            "python_version": self.python_version,
            "core_version": self.config.version,
            "source": "simulated",
            "app_uptime_seconds": round(now - self.started_at, 2),
            "system_uptime_seconds": round(now - self.started_at, 2),
            "cpu": {
                "percent": cpu_percent,
                "frequency_mhz": round(4800 + 220 * math.sin(phase / 3), 1),
                "physical_cores": 8,
                "logical_cores": 16,
                "per_core": per_core,
                "load_average": [round(1.2 + 0.4 * math.sin(phase), 2), 1.1, 0.9],
            },
            "memory": {
                "total": memory_total,
                "used": memory_used,
                "available": memory_total - memory_used,
                "percent": memory_percent,
                "swap_total": 8 * 1024**3,
                "swap_used": int(8 * 1024**3 * 0.18),
                "swap_percent": 18.0,
            },
            "disk": {
                "path": str(self.config.data_dir),
                "total": disk_total,
                "used": disk_used,
                "free": disk_total - disk_used,
                "percent": round(disk_used / disk_total * 100, 2) if disk_total else 0.0,
            },
            "network": {
                "bytes_sent": 0,
                "bytes_recv": 0,
                "packets_sent": 0,
                "packets_recv": 0,
                "upload_bps": round(240_000 + 90_000 * math.sin(phase), 2),
                "download_bps": round(1_800_000 + 700_000 * math.cos(phase), 2),
            },
            "process_count": 142,
            "temperature_c": round(46 + 4 * math.sin(phase), 1),
            "battery_percent": 87.0,
            "battery_plugged": True,
        }

    def _simulated_processes(self, limit: int) -> tuple[list[dict[str, Any]], int]:
        names = [
            ("jarvis-kernel", "SYSTEM", 12.4, 2.1),
            ("holo-compositor", "operator", 18.2, 8.4),
            ("stark-net-mesh", "SYSTEM", 4.5, 1.2),
            ("biometric-eval", "operator", 3.1, 0.8),
            ("arc-reactor-daemon", "SYSTEM", 9.6, 3.4),
            ("python-core", "operator", 6.8, 0.4),
            ("telemetry-writer", "operator", 2.7, 0.2),
            ("hud-renderer", "operator", 14.1, 5.7),
            ("vfs-janitor", "SYSTEM", 0.8, 0.1),
            ("voice-synth", "operator", 1.9, 0.6),
        ]
        rows = []
        for index, (name, user, cpu, memory) in enumerate(names[:limit]):
            rows.append(
                {
                    "pid": 100 + index * 7,
                    "name": name,
                    "username": user,
                    "cpu_percent": cpu,
                    "memory_percent": memory,
                    "memory_rss": int(memory * 1024**3 / 100),
                    "status": "running",
                    "cmdline": [name],
                }
            )
        return rows, 142
