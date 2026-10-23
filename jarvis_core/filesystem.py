"""Sandboxed virtual filesystem for the JARVIS Core.

All paths are mapped beneath a single root directory. Traversal outside
that root, including via symlinks, is rejected. The filesystem is small
on purpose: it is a safe demo space for the HUD file manager and the
Python command engine.
"""

from __future__ import annotations

import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class VFSError(Exception):
    """Base error for virtual filesystem operations."""


class PathTraversalError(VFSError):
    """Raised when a path attempts to escape the sandbox."""


class NotFoundError(VFSError):
    """Raised when a requested path does not exist."""


class AlreadyExistsError(VFSError):
    """Raised when creating something that already exists."""


class NotAFileError(VFSError):
    """Raised when a file operation targets a directory."""


class NotADirectoryError(VFSError):
    """Raised when a directory operation targets a file."""


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


class VirtualFileSystem:
    """A tiny, thread-safe, sandboxed filesystem."""

    DEFAULT_DIRS = (
        "home/operator",
        "home/operator/Documents",
        "home/operator/Projects",
        "system",
        "tmp",
    )

    DEFAULT_FILES = {
        "home/operator/README.txt": (
            "J.A.R.V.I.S. PYTHON CORE // VIRTUAL FILESYSTEM\n"
            "============================================\n\n"
            "This sandbox is owned by the Python backend, not the browser.\n"
            "Use the HUD File Manager or the core CLI to read and write it.\n\n"
            "Try:\n"
            "  curl http://127.0.0.1:8765/api/fs?path=/home/operator\n"
            "  python -m jarvis_core fs list /\n"
        ),
        "home/operator/notes.md": (
            "# Operator Notes\n\n"
            "- Python core is the telemetry and command brain.\n"
            "- The HUD is the holographic view.\n"
            "- Keep the core bound to 127.0.0.1 unless you mean to expose it.\n"
        ),
        "home/operator/Projects/core-bridge.md": (
            "# Core Bridge\n\n"
            "The browser connects to the Python core over HTTP.\n\n"
            "Endpoints used by the HUD:\n"
            "- GET /api/health\n"
            "- GET /api/telemetry\n"
            "- GET /api/processes\n"
            "- POST /api/command (bearer token)\n"
        ),
        "home/operator/Documents/mission-log.md": (
            "# Mission Log\n\n"
            "Status: ALL SYSTEMS NOMINAL\n"
            "Core: Python 3 + FastAPI + psutil\n"
            "Operator: authenticated\n"
        ),
        "system/core.log": "",
        "system/endpoints.txt": (
            "health, status, auth, telemetry, history, processes, commands,\n"
            "command, fs, fs/read, fs/write, fs/mkdir, fs/delete, neofetch,\n"
            "metrics, events, openapi.json\n"
        ),
        "tmp/.keep": "",
    }

    def __init__(self, root: Path, max_file_bytes: int = 1_048_576) -> None:
        self.root = Path(root).expanduser().resolve()
        self.max_file_bytes = max(1, int(max_file_bytes))
        self._lock = threading.RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        self.seed()

    # ------------------------------------------------------------------
    # Path handling
    # ------------------------------------------------------------------
    def _resolve(self, path: str) -> Path:
        if not isinstance(path, str) or not path.strip():
            raise VFSError("A non-empty path is required")
        if "\x00" in path:
            raise VFSError("Path contains an invalid character")
        cleaned = path.replace("\\", "/").strip()
        if not cleaned.startswith("/"):
            cleaned = "/" + cleaned
        parts: list[str] = []
        for part in cleaned.split("/"):
            if part in {"", "."}:
                continue
            if part == "..":
                raise PathTraversalError("Path traversal is not permitted")
            parts.append(part)
        target = self.root.joinpath(*parts).resolve()
        try:
            target.relative_to(self.root)
        except ValueError as exc:
            raise PathTraversalError("Path escapes the virtual filesystem") from exc
        return target

    def _display(self, target: Path) -> str:
        relative = target.relative_to(self.root).as_posix()
        return "/" if relative in {"", "."} else f"/{relative}"

    def _stat_dict(self, target: Path) -> dict[str, Any]:
        stats = target.stat()
        is_dir = target.is_dir()
        return {
            "name": target.name or "/",
            "path": self._display(target),
            "type": "dir" if is_dir else "file",
            "size": 0 if is_dir else int(stats.st_size),
            "modified": float(stats.st_mtime),
            "modified_iso": _iso(stats.st_mtime),
        }

    # ------------------------------------------------------------------
    # Seeding
    # ------------------------------------------------------------------
    def seed(self) -> None:
        """Create the default demo tree without overwriting user content."""

        with self._lock:
            for directory in self.DEFAULT_DIRS:
                self._resolve(directory).mkdir(parents=True, exist_ok=True)
            for filename, content in self.DEFAULT_FILES.items():
                target = self._resolve(filename)
                if target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------
    def exists(self, path: str) -> bool:
        try:
            return self._resolve(path).exists()
        except VFSError:
            return False

    def stat(self, path: str) -> dict[str, Any]:
        with self._lock:
            target = self._resolve(path)
            if not target.exists():
                raise NotFoundError(f"No such file or directory: {path}")
            return self._stat_dict(target)

    def list_dir(self, path: str = "/") -> dict[str, Any]:
        with self._lock:
            target = self._resolve(path)
            if not target.exists():
                raise NotFoundError(f"No such directory: {path}")
            if not target.is_dir():
                raise NotADirectoryError(f"Not a directory: {path}")
            items = [self._stat_dict(child) for child in target.iterdir()]
            items.sort(key=lambda item: (item["type"] != "dir", item["name"].lower()))
            return {
                "path": self._display(target),
                "items": items,
                "total": len(items),
            }

    def read_file(self, path: str) -> dict[str, Any]:
        with self._lock:
            target = self._resolve(path)
            if not target.exists():
                raise NotFoundError(f"No such file: {path}")
            if target.is_dir():
                raise NotAFileError(f"Is a directory: {path}")
            size = target.stat().st_size
            if size > self.max_file_bytes:
                raise VFSError(
                    f"File is too large to display ({size} > {self.max_file_bytes} bytes)"
                )
            content = target.read_text(encoding="utf-8", errors="replace")
            stats = target.stat()
            return {
                "path": self._display(target),
                "content": content,
                "size": size,
                "modified": float(stats.st_mtime),
                "modified_iso": _iso(stats.st_mtime),
            }

    def tail(self, path: str, lines: int = 20) -> list[str]:
        content = self.read_file(path)["content"]
        return content.splitlines()[-max(1, int(lines)) :]

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------
    def write_file(
        self, path: str, content: str, append: bool = False
    ) -> dict[str, Any]:
        if not isinstance(content, str):
            raise VFSError("File content must be text")
        encoded = content.encode("utf-8")
        if len(encoded) > self.max_file_bytes:
            raise VFSError(
                f"Content exceeds the {self.max_file_bytes} byte sandbox limit"
            )
        with self._lock:
            target = self._resolve(path)
            if target.exists() and target.is_dir():
                raise NotAFileError(f"Is a directory: {path}")
            target.parent.mkdir(parents=True, exist_ok=True)
            created = not target.exists()
            mode = "a" if append else "w"
            with target.open(mode, encoding="utf-8") as handle:
                handle.write(content)
            stats = target.stat()
            self.append_log(
                f"{'append' if append else 'write'} {self._display(target)} "
                f"({stats.st_size} bytes)"
            )
            return {
                "path": self._display(target),
                "size": int(stats.st_size),
                "modified": float(stats.st_mtime),
                "modified_iso": _iso(stats.st_mtime),
                "created": created,
            }

    def touch(self, path: str) -> dict[str, Any]:
        with self._lock:
            target = self._resolve(path)
            if target.exists() and target.is_dir():
                raise NotAFileError(f"Is a directory: {path}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch(exist_ok=True)
            return self._stat_dict(target)

    def mkdir(self, path: str) -> dict[str, Any]:
        with self._lock:
            target = self._resolve(path)
            if target.exists():
                raise AlreadyExistsError(f"Already exists: {path}")
            target.mkdir(parents=True, exist_ok=False)
            self.append_log(f"mkdir {self._display(target)}")
            return self._stat_dict(target)

    def delete(self, path: str) -> dict[str, Any]:
        with self._lock:
            target = self._resolve(path)
            if target == self.root:
                raise VFSError("Refusing to delete the virtual filesystem root")
            if not target.exists():
                raise NotFoundError(f"No such file or directory: {path}")
            display = self._display(target)
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
            self.append_log(f"delete {display}")
            return {"ok": True, "path": display, "message": f"Deleted {display}"}

    def append_log(self, message: str) -> None:
        """Append a line to ``/system/core.log`` without recursion."""

        try:
            target = self._resolve("system/core.log")
            target.parent.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(tz=timezone.utc).isoformat()
            with target.open("a", encoding="utf-8") as handle:
                handle.write(f"[{stamp}] {message}\n")
        except Exception:
            # Logging must never break a filesystem operation.
            pass

    # ------------------------------------------------------------------
    # Aggregate helpers
    # ------------------------------------------------------------------
    def count_files(self) -> int:
        with self._lock:
            return sum(1 for path in self.root.rglob("*") if path.is_file())

    def total_bytes(self) -> int:
        with self._lock:
            total = 0
            for path in self.root.rglob("*"):
                if path.is_file():
                    try:
                        total += path.stat().st_size
                    except OSError:
                        continue
            return total

    def tree(self, path: str = "/", depth: int = 2) -> list[str]:
        """Render a simple ASCII tree for the CLI."""

        with self._lock:
            root = self._resolve(path)
            if not root.exists():
                raise NotFoundError(f"No such directory: {path}")
            if not root.is_dir():
                raise NotADirectoryError(f"Not a directory: {path}")
            lines = [self._display(root)]
            self._walk_tree(root, "", max(1, int(depth)), lines)
            return lines

    def _walk_tree(self, directory: Path, prefix: str, depth: int, lines: list[str]) -> None:
        if depth <= 0:
            return
        entries = sorted(
            directory.iterdir(), key=lambda item: (item.is_file(), item.name.lower())
        )
        for index, entry in enumerate(entries):
            last = index == len(entries) - 1
            connector = "└── " if last else "├── "
            suffix = "/" if entry.is_dir() else ""
            lines.append(f"{prefix}{connector}{entry.name}{suffix}")
            if entry.is_dir():
                extension = "    " if last else "│   "
                self._walk_tree(entry, prefix + extension, depth - 1, lines)
