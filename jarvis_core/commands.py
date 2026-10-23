"""Whitelisted command engine for the JARVIS Core.

The engine intentionally never calls a real shell. Each directive is a
Python function with a small, explicit argument surface. That makes it
safe to expose to the browser once the caller has authenticated.
"""

from __future__ import annotations

import difflib
import platform
import posixpath
import shlex
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from .config import CoreConfig
from .filesystem import VFSError, VirtualFileSystem
from .telemetry import TelemetryService, format_bytes, format_duration


@dataclass
class CommandResult:
    """The result of a command, shaped like a tiny process result."""

    output: list[str] = field(default_factory=list)
    exit_code: int = 0
    clear: bool = False
    close: bool = False
    cwd: str | None = None
    duration_ms: float = 0.0


@dataclass(frozen=True)
class CommandSpec:
    name: str
    description: str
    usage: str
    category: str
    handler: Callable[[list[str], str], CommandResult | list[str] | str]
    mutates_filesystem: bool = False


class CommandRegistry:
    """Register and execute the core's shell directives."""

    def __init__(
        self,
        telemetry: TelemetryService,
        filesystem: VirtualFileSystem,
        config: CoreConfig,
    ) -> None:
        self.telemetry = telemetry
        self.filesystem = filesystem
        self.config = config
        self._commands: dict[str, CommandSpec] = {}
        self._register_builtins()

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def register(
        self,
        name: str,
        description: str,
        usage: str,
        category: str,
        handler: Callable[[list[str], str], CommandResult | list[str] | str],
        mutates_filesystem: bool = False,
    ) -> None:
        self._commands[name] = CommandSpec(
            name=name,
            description=description,
            usage=usage,
            category=category,
            handler=handler,
            mutates_filesystem=mutates_filesystem,
        )

    def _register_builtins(self) -> None:
        builtins = [
            (
                "help",
                "Show this catalog or details for one directive",
                "help [command]",
                "core",
                self._cmd_help,
                False,
            ),
            (
                "version",
                "Show the Python core version",
                "version",
                "core",
                self._cmd_version,
                False,
            ),
            (
                "core",
                "Show the core link, Python version and safety model",
                "core",
                "core",
                self._cmd_core,
                False,
            ),
            (
                "metrics",
                "Print Prometheus style metrics",
                "metrics",
                "core",
                self._cmd_metrics,
                False,
            ),
            (
                "log",
                "Tail the virtual system log",
                "log [lines]",
                "core",
                self._cmd_log,
                False,
            ),
            (
                "sysinfo",
                "Full hardware and Python telemetry report",
                "sysinfo",
                "telemetry",
                self._cmd_sysinfo,
                False,
            ),
            (
                "neofetch",
                "ASCII telemetry card rendered by Python",
                "neofetch",
                "telemetry",
                self._cmd_neofetch,
                False,
            ),
            (
                "ps",
                "List the top processes by CPU and memory",
                "ps [limit]",
                "telemetry",
                self._cmd_ps,
                False,
            ),
            (
                "df",
                "Show disk capacity for the sandbox volume",
                "df",
                "telemetry",
                self._cmd_df,
                False,
            ),
            (
                "uptime",
                "Show application and system uptime",
                "uptime",
                "telemetry",
                self._cmd_uptime,
                False,
            ),
            (
                "hostname",
                "Show the machine hostname",
                "hostname",
                "telemetry",
                self._cmd_hostname,
                False,
            ),
            (
                "whoami",
                "Show the active operator identity",
                "whoami",
                "identity",
                self._cmd_whoami,
                False,
            ),
            (
                "date",
                "Show the current local and UTC timestamp",
                "date",
                "identity",
                self._cmd_date,
                False,
            ),
            (
                "python",
                "Show the interpreter, implementation and executable",
                "python",
                "identity",
                self._cmd_python,
                False,
            ),
            (
                "ls",
                "List a directory in the sandbox",
                "ls [path]",
                "filesystem",
                self._cmd_ls,
                False,
            ),
            (
                "pwd",
                "Print the current virtual directory",
                "pwd",
                "filesystem",
                self._cmd_pwd,
                False,
            ),
            (
                "cd",
                "Change the active virtual directory",
                "cd <path>",
                "filesystem",
                self._cmd_cd,
                False,
            ),
            (
                "cat",
                "Print a text file",
                "cat <path>",
                "filesystem",
                self._cmd_cat,
                False,
            ),
            (
                "write",
                "Write text to a file (use --append to append)",
                "write [--append] <path> <text>",
                "filesystem",
                self._cmd_write,
                True,
            ),
            (
                "mkdir",
                "Create a directory",
                "mkdir <path>",
                "filesystem",
                self._cmd_mkdir,
                True,
            ),
            (
                "touch",
                "Create an empty file",
                "touch <path>",
                "filesystem",
                self._cmd_touch,
                True,
            ),
            (
                "rm",
                "Delete a file or directory",
                "rm <path>",
                "filesystem",
                self._cmd_rm,
                True,
            ),
            (
                "echo",
                "Echo text back to the caller",
                "echo <text>",
                "misc",
                self._cmd_echo,
                False,
            ),
            (
                "ping",
                "Simulate a four packet latency probe",
                "ping [host]",
                "misc",
                self._cmd_ping,
                False,
            ),
            (
                "clear",
                "Ask the client to clear its console",
                "clear",
                "misc",
                self._cmd_clear,
                False,
            ),
            (
                "exit",
                "Close the client shell session",
                "exit",
                "misc",
                self._cmd_exit,
                False,
            ),
        ]
        for name, description, usage, category, handler, mutates in builtins:
            self.register(name, description, usage, category, handler, mutates)

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------
    def execute(self, line: str, cwd: str = "/home/operator") -> CommandResult:
        started = time.perf_counter()
        text = (line or "").strip()
        if not text:
            return CommandResult([], 0, cwd=cwd)
        try:
            parts = shlex.split(text, posix=True)
        except ValueError as exc:
            return CommandResult(
                [f"parse error: {exc}"], 2, cwd=cwd, duration_ms=_elapsed(started)
            )
        if not parts:
            return CommandResult([], 0, cwd=cwd)
        name = parts[0].lower()
        args = parts[1:]
        spec = self._commands.get(name)
        if spec is None:
            suggestion = difflib.get_close_matches(name, self._commands.keys(), n=1)
            hint = f" Did you mean '{suggestion[0]}'?" if suggestion else ""
            return CommandResult(
                [f"command not found: {name}.{hint} Type 'help' for directives."],
                127,
                cwd=cwd,
                duration_ms=_elapsed(started),
            )
        try:
            raw = spec.handler(args, cwd)
        except VFSError as exc:
            raw = CommandResult([str(exc)], 1)
        except Exception as exc:  # pragma: no cover - defensive boundary
            raw = CommandResult([f"internal error: {exc}"], 1)
        result = _normalise(raw)
        result.duration_ms = _elapsed(started)
        if result.cwd is None:
            result.cwd = cwd
        return result

    def catalog(self) -> list[dict[str, object]]:
        rows = []
        for spec in sorted(self._commands.values(), key=lambda item: item.name):
            rows.append(
                {
                    "name": spec.name,
                    "description": spec.description,
                    "usage": spec.usage,
                    "category": spec.category,
                    "mutates_filesystem": spec.mutates_filesystem,
                }
            )
        return rows

    @property
    def count(self) -> int:
        return len(self._commands)

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------
    def _join(self, cwd: str, path: str | None) -> str:
        if not path:
            return cwd or "/"
        if path.startswith("/"):
            return posixpath.normpath(path)
        base = cwd if (cwd or "").startswith("/") else "/" + (cwd or "")
        return posixpath.normpath(posixpath.join(base, path))

    # ------------------------------------------------------------------
    # Core commands
    # ------------------------------------------------------------------
    def _cmd_help(self, args: list[str], cwd: str) -> CommandResult:
        if args:
            spec = self._commands.get(args[0].lower())
            if spec is None:
                return CommandResult([f"unknown command: {args[0]}"], 1)
            return CommandResult(
                [
                    f"{spec.name} — {spec.description}",
                    f"usage    : {spec.usage}",
                    f"category : {spec.category}",
                    f"writes   : {'yes' if spec.mutates_filesystem else 'no'}",
                ]
            )
        lines = ["J.A.R.V.I.S. CORE // COMMAND CATALOG", "-" * 42]
        categories: dict[str, list[CommandSpec]] = {}
        for spec in self._commands.values():
            categories.setdefault(spec.category, []).append(spec)
        for category in sorted(categories):
            lines.append(f"[{category.upper()}]")
            for spec in sorted(categories[category], key=lambda item: item.name):
                lines.append(f"  {spec.name:<9} {spec.description}")
            lines.append("")
        lines.append("File writes and the API command endpoint require a bearer token.")
        return CommandResult(lines)

    def _cmd_version(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult(
            [
                f"J.A.R.V.I.S. Core {self.config.version}",
                f"Python {platform.python_version()} ({platform.python_implementation()})",
                f"Platform {platform.platform()}",
            ]
        )

    def _cmd_core(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult(
            [
                "J.A.R.V.I.S. PYTHON CORE // LINK ACTIVE",
                f"endpoint : {self.config.public_url}",
                f"version  : {self.config.version}",
                f"python   : {platform.python_version()}",
                f"telemetry: {self.telemetry.source}",
                "safety   : whitelisted directives, sandboxed filesystem, HMAC tokens",
                "docs     : GET /api/openapi.json",
            ]
        )

    def _cmd_metrics(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult(self.telemetry.prometheus().strip().splitlines())

    def _cmd_log(self, args: list[str], cwd: str) -> CommandResult:
        count = 20
        if args:
            try:
                count = max(1, min(int(args[0]), 200))
            except ValueError:
                return CommandResult(["usage: log [lines]"], 2)
        return CommandResult(self.filesystem.tail("/system/core.log", count) or ["(log is empty)"])

    # ------------------------------------------------------------------
    # Telemetry commands
    # ------------------------------------------------------------------
    def _cmd_sysinfo(self, args: list[str], cwd: str) -> CommandResult:
        data = self.telemetry.sample()
        cpu = data["cpu"]
        memory = data["memory"]
        disk = data["disk"]
        network = data["network"]
        frequency = cpu.get("frequency_mhz")
        freq_text = f"{frequency / 1000:.2f} GHz" if frequency else "n/a"
        load = ", ".join(f"{value:.2f}" for value in cpu.get("load_average", [])) or "n/a"
        battery = data.get("battery_percent")
        battery_text = (
            f"{battery:.0f}% ({'plugged in' if data.get('battery_plugged') else 'battery'})"
            if battery is not None
            else "n/a"
        )
        temperature = data.get("temperature_c")
        lines = [
            "J.A.R.V.I.S. CORE // SYSTEM TELEMETRY",
            "-" * 46,
            f"Host       : {data['hostname']}",
            f"Platform   : {data['platform']}",
            f"Processor  : {data['processor']}",
            f"Python     : {data['python_version']}",
            f"Core       : {data['core_version']}",
            f"Source     : {data['source']}",
            f"Uptime     : app {format_duration(data['app_uptime_seconds'])} / "
            f"system {format_duration(data['system_uptime_seconds'])}",
            "",
            f"CPU        : {cpu['percent']:.1f}% @ {freq_text} "
            f"({cpu.get('physical_cores') or 'n/a'}C / {cpu.get('logical_cores') or 'n/a'}T)",
            f"Load avg   : {load}",
            f"Per core   : {', '.join(f'{value:.0f}%' for value in cpu.get('per_core', []))}",
            f"Memory     : {format_bytes(memory['used'])} / {format_bytes(memory['total'])} "
            f"({memory['percent']:.1f}%)",
            f"Swap       : {format_bytes(memory['swap_used'])} / "
            f"{format_bytes(memory['swap_total'])} ({memory['swap_percent']:.1f}%)",
            f"Disk       : {format_bytes(disk['used'])} / {format_bytes(disk['total'])} "
            f"({disk['percent']:.1f}%)",
            f"Network    : up {format_bytes(network['upload_bps'])}/s / "
            f"down {format_bytes(network['download_bps'])}/s",
            f"Temperature: {temperature if temperature is not None else 'n/a'}",
            f"Battery    : {battery_text}",
            f"Processes  : {data['process_count']}",
        ]
        return CommandResult(lines)

    def _cmd_neofetch(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult(self.telemetry.neofetch_lines())

    def _cmd_ps(self, args: list[str], cwd: str) -> CommandResult:
        limit = None
        if args:
            try:
                limit = max(1, min(int(args[0]), 50))
            except ValueError:
                return CommandResult(["usage: ps [limit]"], 2)
        data = self.telemetry.processes(limit)
        lines = [
            f"{'PID':>7}  {'CPU%':>6}  {'MEM%':>6}  {'RSS':>10}  PROCESS",
            "-" * 64,
        ]
        for process in data["processes"]:
            lines.append(
                f"{process['pid']:>7}  {process['cpu_percent']:>6.1f}  "
                f"{process['memory_percent']:>6.1f}  "
                f"{format_bytes(process['memory_rss']):>10}  {process['name']}"
            )
        lines.append("")
        lines.append(f"{data['total']} processes visible // source {data['source']}")
        return CommandResult(lines)

    def _cmd_df(self, args: list[str], cwd: str) -> CommandResult:
        disk = self.telemetry.sample()["disk"]
        return CommandResult(
            [
                "Filesystem        Size      Used     Avail  Capacity  Mounted on",
                "-" * 68,
                f"jarvis-vfs     {format_bytes(disk['total']):>9} "
                f"{format_bytes(disk['used']):>9} {format_bytes(disk['free']):>9} "
                f"{disk['percent']:>7.1f}%  {disk['path']}",
            ]
        )

    def _cmd_uptime(self, args: list[str], cwd: str) -> CommandResult:
        data = self.telemetry.sample()
        return CommandResult(
            [
                f"core uptime  : {format_duration(data['app_uptime_seconds'])}",
                f"system uptime: {format_duration(data['system_uptime_seconds'])}",
            ]
        )

    def _cmd_hostname(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult([self.telemetry.hostname])

    # ------------------------------------------------------------------
    # Identity commands
    # ------------------------------------------------------------------
    def _cmd_whoami(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult(["operator@jarvis-core (Security: Level 9)"])

    def _cmd_date(self, args: list[str], cwd: str) -> CommandResult:
        local = datetime.now().astimezone()
        return CommandResult(
            [
                local.isoformat(timespec="seconds"),
                f"epoch: {local.timestamp():.0f}",
                f"utc  : {datetime.utcnow().isoformat(timespec='seconds')}Z",
            ]
        )

    def _cmd_python(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult(
            [
                f"version       : {platform.python_version()}",
                f"implementation: {platform.python_implementation()}",
                f"executable    : {sys.executable}",
                f"compiler      : {platform.python_compiler()}",
            ]
        )

    # ------------------------------------------------------------------
    # Filesystem commands
    # ------------------------------------------------------------------
    def _cmd_ls(self, args: list[str], cwd: str) -> CommandResult:
        target = self._join(cwd, args[0] if args else ".")
        listing = self.filesystem.list_dir(target)
        lines = [f"DIRECTORY {listing['path']}"]
        if not listing["items"]:
            lines.append("(empty)")
            return CommandResult(lines)
        for item in listing["items"]:
            if item["type"] == "dir":
                lines.append(f"[DIR ]  {item['name']}/")
            else:
                lines.append(f"[FILE]  {item['name']} ({format_bytes(item['size'])})")
        return CommandResult(lines)

    def _cmd_pwd(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult([cwd or "/"])

    def _cmd_cd(self, args: list[str], cwd: str) -> CommandResult:
        if not args:
            return CommandResult([cwd or "/"], 0, cwd=cwd or "/")
        target = self._join(cwd, args[0])
        info = self.filesystem.stat(target)
        if info["type"] != "dir":
            return CommandResult([f"not a directory: {target}"], 1, cwd=cwd)
        return CommandResult([], 0, cwd=info["path"])

    def _cmd_cat(self, args: list[str], cwd: str) -> CommandResult:
        if not args:
            return CommandResult(["usage: cat <path>"], 2)
        target = self._join(cwd, args[0])
        data = self.filesystem.read_file(target)
        return CommandResult(data["content"].splitlines() or [""])

    def _cmd_write(self, args: list[str], cwd: str) -> CommandResult:
        append = False
        if args and args[0] in {"--append", "-a"}:
            append = True
            args = args[1:]
        if not args:
            return CommandResult(["usage: write [--append] <path> <text>"], 2)
        target = self._join(cwd, args[0])
        content = " ".join(args[1:])
        data = self.filesystem.write_file(target, content, append=append)
        action = "Appended to" if append else ("Created" if data["created"] else "Updated")
        return CommandResult([f"{action} {data['path']} ({data['size']} bytes)"])

    def _cmd_mkdir(self, args: list[str], cwd: str) -> CommandResult:
        if not args:
            return CommandResult(["usage: mkdir <path>"], 2)
        data = self.filesystem.mkdir(self._join(cwd, args[0]))
        return CommandResult([f"Created directory {data['path']}"])

    def _cmd_touch(self, args: list[str], cwd: str) -> CommandResult:
        if not args:
            return CommandResult(["usage: touch <path>"], 2)
        data = self.filesystem.touch(self._join(cwd, args[0]))
        return CommandResult([f"Touched {data['path']}"])

    def _cmd_rm(self, args: list[str], cwd: str) -> CommandResult:
        if not args:
            return CommandResult(["usage: rm <path>"], 2)
        data = self.filesystem.delete(self._join(cwd, args[0]))
        return CommandResult([data["message"]])

    # ------------------------------------------------------------------
    # Misc commands
    # ------------------------------------------------------------------
    def _cmd_echo(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult([" ".join(args)])

    def _cmd_ping(self, args: list[str], cwd: str) -> CommandResult:
        host = args[0] if args else "127.0.0.1"
        lines = [f"PING {host} (simulated probe, no packets are sent)"]
        for sequence in range(1, 5):
            latency = 12 + sequence * 3 + (sequence % 2) * 2
            lines.append(
                f"64 bytes from {host}: icmp_seq={sequence} ttl=64 time={latency} ms"
            )
        lines.append("")
        lines.append(f"--- {host} ping statistics ---")
        lines.append("4 packets transmitted, 4 received, 0% packet loss")
        return CommandResult(lines)

    def _cmd_clear(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult([], 0, clear=True, cwd=cwd)

    def _cmd_exit(self, args: list[str], cwd: str) -> CommandResult:
        return CommandResult(["Disengaging core shell session."], 0, close=True, cwd=cwd)


def _elapsed(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 3)


def _normalise(raw: CommandResult | list[str] | str) -> CommandResult:
    if isinstance(raw, CommandResult):
        return raw
    if isinstance(raw, str):
        return CommandResult(raw.splitlines())
    if isinstance(raw, list):
        return CommandResult([str(line) for line in raw])
    return CommandResult([str(raw)])
