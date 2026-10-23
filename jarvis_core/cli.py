"""Command line client for the JARVIS Python Core.

Examples::

    python -m jarvis_core serve
    python -m jarvis_core status
    python -m jarvis_core info
    python -m jarvis_core exec sysinfo
    python -m jarvis_core fs list /home/operator
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .config import CORE_VERSION, DEFAULT_PASSCODE, CoreConfig
from .telemetry import format_bytes, format_duration


class CoreClientError(RuntimeError):
    """Raised when the core cannot be reached or returns an error."""


class CoreClient:
    """Tiny urllib based client, so the CLI has no extra dependencies."""

    def __init__(
        self,
        base_url: str,
        passcode: str | None = None,
        timeout: float = 5.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.passcode = passcode or os.getenv(
            "JARVIS_CORE_PASSCODE", DEFAULT_PASSCODE
        )
        self.timeout = max(0.5, float(timeout))
        self.token: str | None = None

    def request(
        self,
        path: str,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        auth: bool = False,
    ) -> dict[str, Any]:
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            if not self.token:
                self.login()
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            try:
                detail = json.loads(body).get("detail", body)
            except (ValueError, AttributeError):
                detail = body
            raise CoreClientError(f"HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise CoreClientError(
                f"cannot reach core at {self.base_url}: {exc.reason}"
            ) from exc
        except TimeoutError as exc:
            raise CoreClientError(f"timed out talking to {self.base_url}") from exc

    def login(self) -> dict[str, Any]:
        data = self.request(
            "/api/auth/login", method="POST", payload={"passcode": self.passcode}
        )
        self.token = data["token"]
        return data

    def get(self, path: str, auth: bool = False) -> dict[str, Any]:
        return self.request(path, auth=auth)

    def post(self, path: str, payload: dict[str, Any], auth: bool = True) -> dict[str, Any]:
        return self.request(path, method="POST", payload=payload, auth=auth)


# ----------------------------------------------------------------------
# Formatting helpers
# ----------------------------------------------------------------------
def _print_json(data: Any) -> None:
    print(json.dumps(data, indent=2, sort_keys=False))


def _print_health(data: dict[str, Any]) -> None:
    print("J.A.R.V.I.S. PYTHON CORE")
    print("-" * 46)
    print(f"status    : {data.get('status', 'ok')}")
    print(f"service   : {data.get('service', 'jarvis-core')}")
    print(f"version   : {data.get('version')}")
    print(f"python    : {data.get('python_version')}")
    print(f"platform  : {data.get('platform')}")
    print(f"host      : {data.get('hostname')}")
    print(f"core url  : {data.get('core_url')}")
    print(f"telemetry : {data.get('telemetry_source')}")
    print(f"uptime    : {format_duration(data.get('uptime_seconds'))}")


def _print_status(data: dict[str, Any]) -> None:
    _print_health(data)
    print(f"commands  : {data.get('command_count')}")
    print(f"processes : {data.get('process_count')}")
    print(f"vfs files : {data.get('file_count')}")
    features = data.get("features") or []
    if features:
        print("features  :")
        for feature in features:
            print(f"  - {feature}")
    endpoints = data.get("endpoints") or []
    if endpoints:
        print("endpoints :")
        for endpoint in endpoints:
            lock = " [auth]" if endpoint.get("auth") else ""
            print(
                f"  {endpoint.get('method', 'GET'):<5} "
                f"{endpoint.get('path'):<26}{lock}"
            )


def _print_telemetry(data: dict[str, Any]) -> None:
    cpu = data["cpu"]
    memory = data["memory"]
    disk = data["disk"]
    network = data["network"]
    frequency = cpu.get("frequency_mhz")
    print(
        f"CPU     : {cpu['percent']:.1f}%"
        + (f" @ {frequency / 1000:.2f} GHz" if frequency else "")
    )
    print(
        f"Memory  : {format_bytes(memory['used'])} / "
        f"{format_bytes(memory['total'])} ({memory['percent']:.1f}%)"
    )
    print(
        f"Disk    : {format_bytes(disk['used'])} / "
        f"{format_bytes(disk['total'])} ({disk['percent']:.1f}%)"
    )
    print(
        f"Network : up {format_bytes(network['upload_bps'])}/s / "
        f"down {format_bytes(network['download_bps'])}/s"
    )
    print(f"Source  : {data.get('source')}")
    print(f"Uptime  : {format_duration(data.get('app_uptime_seconds'))}")


def _print_processes(data: dict[str, Any]) -> None:
    print(f"{'PID':>7}  {'CPU%':>6}  {'MEM%':>6}  {'RSS':>10}  PROCESS")
    print("-" * 64)
    for process in data.get("processes", []):
        print(
            f"{process['pid']:>7}  {process['cpu_percent']:>6.1f}  "
            f"{process['memory_percent']:>6.1f}  "
            f"{format_bytes(process['memory_rss']):>10}  {process['name']}"
        )
    print(f"\n{data.get('total', 0)} processes // source {data.get('source')}")


def _print_commands(data: dict[str, Any]) -> None:
    print(f"J.A.R.V.I.S. CORE // {data.get('count', 0)} DIRECTIVES")
    print("-" * 52)
    current = None
    for command in data.get("commands", []):
        category = command.get("category")
        if category != current:
            current = category
            print(f"[{str(category).upper()}]")
        print(
            f"  {command.get('name', ''):<9} {command.get('description', '')}"
        )
        print(f"  {'':<9} usage: {command.get('usage', '')}")


def _print_fs_list(data: dict[str, Any]) -> None:
    print(f"DIRECTORY {data.get('path')} ({data.get('total', 0)} items)")
    print("-" * 52)
    for item in data.get("items", []):
        if item.get("type") == "dir":
            print(f"[DIR ]  {item.get('name')}/")
        else:
            print(f"[FILE]  {item.get('name')} ({format_bytes(item.get('size'))})")


def _print_command_result(data: dict[str, Any]) -> None:
    for line in data.get("output", []):
        print(line)
    if data.get("cwd"):
        print(f"(cwd: {data['cwd']})")
    if data.get("exit_code"):
        print(f"(exit code {data['exit_code']})", file=sys.stderr)


# ----------------------------------------------------------------------
# Command handlers
# ----------------------------------------------------------------------
def _cmd_serve(args: argparse.Namespace) -> int:
    from .server import run

    config = CoreConfig.from_env()
    overrides: dict[str, Any] = {
        "host": args.host,
        "port": args.port,
        "passcode": args.passcode,
        "data_dir": Path(args.data_dir).expanduser() if args.data_dir else None,
        "log_level": args.log_level,
        "docs_enabled": not args.no_docs,
    }
    if args.origins:
        overrides["allowed_origins"] = tuple(
            part.strip() for part in args.origins.split(",") if part.strip()
        )
    config = config.with_overrides(**overrides)
    config.ensure_dirs()
    print(f"J.A.R.V.I.S. Core {config.version} listening on {config.public_url}")
    print(f"vfs root: {config.vfs_dir}")
    try:
        run(config, reload=args.reload)
    except KeyboardInterrupt:
        print("\nCore stopped.")
    return 0


def _client(args: argparse.Namespace) -> CoreClient:
    return CoreClient(args.url, passcode=args.passcode, timeout=args.timeout)


def _cmd_status(args: argparse.Namespace) -> int:
    data = _client(args).get("/api/status")
    _print_json(data) if args.json else _print_status(data)
    return 0


def _cmd_info(args: argparse.Namespace) -> int:
    client = _client(args)
    health = client.get("/api/health")
    telemetry = client.get("/api/telemetry")
    if args.json:
        _print_json({"health": health, "telemetry": telemetry})
        return 0
    _print_health(health)
    print()
    _print_telemetry(telemetry)
    return 0


def _cmd_exec(args: argparse.Namespace) -> int:
    command = " ".join(args.command).strip()
    if not command:
        print("error: a command is required", file=sys.stderr)
        return 2
    data = _client(args).post("/api/command", {"command": command})
    _print_json(data) if args.json else _print_command_result(data)
    return 1 if data.get("exit_code") else 0


def _cmd_commands(args: argparse.Namespace) -> int:
    data = _client(args).get("/api/commands")
    _print_json(data) if args.json else _print_commands(data)
    return 0


def _cmd_processes(args: argparse.Namespace) -> int:
    query = urllib.parse.urlencode({"limit": args.limit})
    data = _client(args).get(f"/api/processes?{query}")
    _print_json(data) if args.json else _print_processes(data)
    return 0


def _cmd_neofetch(args: argparse.Namespace) -> int:
    data = _client(args).get("/api/neofetch")
    if args.json:
        _print_json(data)
    else:
        for line in data.get("lines", []):
            print(line)
    return 0


def _cmd_fs_list(args: argparse.Namespace) -> int:
    query = urllib.parse.urlencode({"path": args.path})
    data = _client(args).get(f"/api/fs?{query}")
    _print_json(data) if args.json else _print_fs_list(data)
    return 0


def _cmd_fs_read(args: argparse.Namespace) -> int:
    query = urllib.parse.urlencode({"path": args.path})
    data = _client(args).get(f"/api/fs/read?{query}")
    if args.json:
        _print_json(data)
    else:
        print(data.get("content", ""), end="" if data.get("content", "").endswith("\n") else "\n")
    return 0


def _cmd_fs_write(args: argparse.Namespace) -> int:
    client = _client(args)
    text = args.text if args.text is not None else sys.stdin.read()
    data = client.post(
        "/api/fs/write",
        {"path": args.path, "content": text, "append": args.append},
    )
    _print_json(data) if args.json else print(f"wrote {data.get('path')} ({data.get('size')} bytes)")
    return 0


def _cmd_fs_mkdir(args: argparse.Namespace) -> int:
    data = _client(args).post("/api/fs/mkdir", {"path": args.path})
    _print_json(data) if args.json else print(data.get("message", "created"))
    return 0


def _cmd_fs_rm(args: argparse.Namespace) -> int:
    data = _client(args).post("/api/fs/delete", {"path": args.path})
    _print_json(data) if args.json else print(data.get("message", "deleted"))
    return 0


def _cmd_token(args: argparse.Namespace) -> int:
    data = _client(args).login()
    _print_json(data)
    return 0


def _cmd_version(args: argparse.Namespace) -> int:
    print(f"J.A.R.V.I.S. Core {CORE_VERSION}")
    return 0


# ----------------------------------------------------------------------
# Argument parser
# ----------------------------------------------------------------------
def _add_client_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--url",
        default=os.getenv("JARVIS_CORE_URL", "http://127.0.0.1:8765"),
        help="Core base URL (default: %(default)s)",
    )
    parser.add_argument(
        "--passcode",
        default=os.getenv("JARVIS_CORE_PASSCODE", DEFAULT_PASSCODE),
        help="Core passcode for authenticated directives",
    )
    parser.add_argument("--timeout", type=float, default=5.0, help="HTTP timeout seconds")
    parser.add_argument("--json", action="store_true", help="Print raw JSON")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jarvis_core",
        description="J.A.R.V.I.S. Python Core — telemetry, commands and a sandboxed VFS.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {CORE_VERSION}")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    serve = subparsers.add_parser("serve", help="Start the FastAPI core")
    serve.add_argument("--host", default=None, help="Bind host (default: 127.0.0.1)")
    serve.add_argument("--port", type=int, default=None, help="Bind port (default: 8765)")
    serve.add_argument("--passcode", default=None, help="Override the passcode")
    serve.add_argument("--data-dir", default=None, help="Override the data directory")
    serve.add_argument("--origins", default=None, help="Comma separated CORS origins")
    serve.add_argument("--log-level", default=None, help="uvicorn log level")
    serve.add_argument("--reload", action="store_true", help="Enable auto reload")
    serve.add_argument("--no-docs", action="store_true", help="Disable /api/docs")
    serve.set_defaults(func=_cmd_serve)

    status = subparsers.add_parser("status", help="Show core status")
    _add_client_options(status)
    status.set_defaults(func=_cmd_status)

    info = subparsers.add_parser("info", help="Show health and telemetry")
    _add_client_options(info)
    info.set_defaults(func=_cmd_info)

    exec_parser = subparsers.add_parser("exec", help="Execute a core directive")
    _add_client_options(exec_parser)
    exec_parser.add_argument(
        "command",
        nargs="+",
        help="Directive to run (quote directives that contain flags)",
    )
    exec_parser.set_defaults(func=_cmd_exec)

    commands = subparsers.add_parser("commands", help="List core directives")
    _add_client_options(commands)
    commands.set_defaults(func=_cmd_commands)

    processes = subparsers.add_parser("processes", help="List top processes")
    _add_client_options(processes)
    processes.add_argument("--limit", type=int, default=12)
    processes.set_defaults(func=_cmd_processes)

    neofetch = subparsers.add_parser("neofetch", help="Print the ASCII telemetry card")
    _add_client_options(neofetch)
    neofetch.set_defaults(func=_cmd_neofetch)

    fs = subparsers.add_parser("fs", help="Operate on the sandboxed filesystem")
    fs_sub = fs.add_subparsers(dest="fs_command", required=True)

    fs_list = fs_sub.add_parser("list", help="List a directory")
    _add_client_options(fs_list)
    fs_list.add_argument("path", nargs="?", default="/")
    fs_list.set_defaults(func=_cmd_fs_list)

    fs_read = fs_sub.add_parser("read", help="Read a file")
    _add_client_options(fs_read)
    fs_read.add_argument("path")
    fs_read.set_defaults(func=_cmd_fs_read)

    fs_write = fs_sub.add_parser("write", help="Write a file")
    _add_client_options(fs_write)
    fs_write.add_argument("path")
    fs_write.add_argument("text", nargs="?", default=None)
    fs_write.add_argument("--append", action="store_true")
    fs_write.set_defaults(func=_cmd_fs_write)

    fs_mkdir = fs_sub.add_parser("mkdir", help="Create a directory")
    _add_client_options(fs_mkdir)
    fs_mkdir.add_argument("path")
    fs_mkdir.set_defaults(func=_cmd_fs_mkdir)

    fs_rm = fs_sub.add_parser("rm", help="Delete a file or directory")
    _add_client_options(fs_rm)
    fs_rm.add_argument("path")
    fs_rm.set_defaults(func=_cmd_fs_rm)

    token = subparsers.add_parser("token", help="Authenticate and print a bearer token")
    _add_client_options(token)
    token.set_defaults(func=_cmd_token)

    version = subparsers.add_parser("version", help="Print the core version")
    version.set_defaults(func=_cmd_version)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except CoreClientError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
