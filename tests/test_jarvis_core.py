"""Unit and API tests for the JARVIS Python Core."""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from jarvis_core.cli import build_parser
from jarvis_core.commands import CommandRegistry
from jarvis_core.config import CoreConfig
from jarvis_core.filesystem import (
    NotFoundError,
    PathTraversalError,
    VirtualFileSystem,
)
from jarvis_core.security import RateLimiter, TokenError, TokenManager, verify_passcode
from jarvis_core.server import create_app
from jarvis_core.telemetry import TelemetryService, format_bytes, format_duration


class ConfigTests(unittest.TestCase):
    def test_public_url_and_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = CoreConfig(data_dir=Path(tmp), host="0.0.0.0", port=9001)
            config.ensure_dirs()
            self.assertEqual(config.public_url, "http://127.0.0.1:9001")
            self.assertTrue(config.vfs_dir.is_dir())
            self.assertTrue(config.log_dir.is_dir())
            self.assertTrue(config.as_public_dict()["docs_enabled"])

    def test_with_overrides_returns_a_copy(self) -> None:
        config = CoreConfig()
        updated = config.with_overrides(port=9999, host=None)
        self.assertEqual(updated.port, 9999)
        self.assertEqual(config.port, 8765)
        self.assertEqual(updated.host, config.host)


class SecurityTests(unittest.TestCase):
    def test_token_roundtrip_expiry_and_tampering(self) -> None:
        manager = TokenManager("unit-test-secret", ttl=60)
        token, expires_at = manager.issue("operator")
        claims = manager.verify(token)
        self.assertEqual(claims["sub"], "operator")
        self.assertGreater(expires_at, time.time())

        with self.assertRaises(TokenError):
            manager.verify(token + "x")

        expired = TokenManager("unit-test-secret", ttl=60)
        expired.ttl = -5
        expired_token, _ = expired.issue("operator")
        with self.assertRaises(TokenError):
            manager.verify(expired_token)

    def test_rate_limiter(self) -> None:
        limiter = RateLimiter(limit=2, window=60)
        self.assertTrue(limiter.check("client").allowed)
        self.assertTrue(limiter.check("client").allowed)
        blocked = limiter.check("client")
        self.assertFalse(blocked.allowed)
        self.assertGreater(blocked.retry_after, 0)
        self.assertTrue(limiter.check("other-client").allowed)

    def test_passcode(self) -> None:
        self.assertTrue(verify_passcode("151627", "151627"))
        self.assertFalse(verify_passcode("000000", "151627"))
        self.assertFalse(verify_passcode(None, "151627"))


class FilesystemTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.vfs = VirtualFileSystem(Path(self.tmp.name))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_seeded_tree_and_sorting(self) -> None:
        listing = self.vfs.list_dir("/home/operator")
        names = [item["name"] for item in listing["items"]]
        self.assertIn("Documents", names)
        self.assertIn("README.txt", names)
        directories = [item for item in listing["items"] if item["type"] == "dir"]
        self.assertEqual(names[: len(directories)], [item["name"] for item in directories])

    def test_read_write_mkdir_delete(self) -> None:
        created = self.vfs.write_file("/tmp/unit.txt", "hello")
        self.assertEqual(created["path"], "/tmp/unit.txt")
        self.assertEqual(self.vfs.read_file("/tmp/unit.txt")["content"], "hello")
        self.vfs.write_file("/tmp/unit.txt", "\nworld", append=True)
        self.assertEqual(self.vfs.read_file("/tmp/unit.txt")["content"], "hello\nworld")

        folder = self.vfs.mkdir("/tmp/unit")
        self.assertEqual(folder["type"], "dir")
        deleted = self.vfs.delete("/tmp/unit")
        self.assertTrue(deleted["ok"])
        with self.assertRaises(NotFoundError):
            self.vfs.list_dir("/tmp/unit")
        self.vfs.delete("/tmp/unit.txt")
        with self.assertRaises(NotFoundError):
            self.vfs.read_file("/tmp/unit.txt")

    def test_traversal_is_rejected(self) -> None:
        with self.assertRaises(PathTraversalError):
            self.vfs.list_dir("/../../etc")

    def test_tree_contains_seed(self) -> None:
        lines = self.vfs.tree("/", depth=2)
        self.assertEqual(lines[0], "/")
        self.assertTrue(any("home" in line for line in lines))


class TelemetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.config = CoreConfig(data_dir=Path(self.tmp.name), max_processes=3)
        self.telemetry = TelemetryService(self.config)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_snapshot_shape(self) -> None:
        data = self.telemetry.sample()
        for key in (
            "timestamp",
            "hostname",
            "platform",
            "processor",
            "python_version",
            "cpu",
            "memory",
            "disk",
            "network",
            "process_count",
            "source",
        ):
            self.assertIn(key, data)
        for key in ("percent", "per_core", "frequency_mhz", "load_average"):
            self.assertIn(key, data["cpu"])
        for key in ("total", "used", "available", "percent", "swap_used"):
            self.assertIn(key, data["memory"])

    def test_history_is_bounded(self) -> None:
        for _ in range(5):
            self.telemetry.sample()
        history = self.telemetry.history()
        self.assertLessEqual(len(history), self.config.history_size)
        self.assertGreaterEqual(len(history), 1)

    def test_processes_and_prometheus(self) -> None:
        processes = self.telemetry.processes(limit=2)
        self.assertLessEqual(len(processes["processes"]), 2)
        metrics = self.telemetry.prometheus()
        self.assertIn("jarvis_core_cpu_percent", metrics)
        self.assertIn("jarvis_core_memory_percent", metrics)

    def test_format_helpers(self) -> None:
        self.assertEqual(format_bytes(1024), "1.0 KB")
        self.assertEqual(format_duration(3661), "01:01:01")


class CommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.config = CoreConfig(data_dir=Path(self.tmp.name))
        self.filesystem = VirtualFileSystem(self.config.vfs_dir)
        self.telemetry = TelemetryService(self.config)
        self.commands = CommandRegistry(self.telemetry, self.filesystem, self.config)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_catalog_and_help(self) -> None:
        catalog = self.commands.catalog()
        names = {row["name"] for row in catalog}
        self.assertIn("sysinfo", names)
        self.assertIn("ps", names)
        result = self.commands.execute("help")
        self.assertEqual(result.exit_code, 0)
        self.assertTrue(any("COMMAND CATALOG" in line for line in result.output))

    def test_unknown_command(self) -> None:
        result = self.commands.execute("does-not-exist")
        self.assertEqual(result.exit_code, 127)
        self.assertIn("command not found", result.output[0])

    def test_filesystem_directives(self) -> None:
        write = self.commands.execute("write /tmp/directive.txt hello")
        self.assertEqual(write.exit_code, 0)
        read = self.commands.execute("cat /tmp/directive.txt")
        self.assertEqual(read.output, ["hello"])
        changed = self.commands.execute("cd /tmp")
        self.assertEqual(changed.cwd, "/tmp")
        listing = self.commands.execute("ls", cwd=changed.cwd)
        self.assertTrue(any("directive.txt" in line for line in listing.output))

    def test_clear_and_exit_flags(self) -> None:
        self.assertTrue(self.commands.execute("clear").clear)
        self.assertTrue(self.commands.execute("exit").close)


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.passcode = "test-passcode"
        self.config = CoreConfig(
            data_dir=Path(self.tmp.name),
            passcode=self.passcode,
            rate_limit=1000,
            telemetry_interval=60,
        )
        self.app = create_app(self.config)
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self.tmp.cleanup()

    def _token(self) -> str:
        response = self.client.post(
            "/api/auth/login", json={"passcode": self.passcode}
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["token"]

    def test_health_status_and_metadata(self) -> None:
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["version"], self.config.version)

        status = self.client.get("/api/status")
        self.assertEqual(status.status_code, 200)
        body = status.json()
        self.assertGreater(body["command_count"], 10)
        self.assertIn("features", body)

    def test_telemetry_processes_and_metrics(self) -> None:
        telemetry = self.client.get("/api/telemetry")
        self.assertEqual(telemetry.status_code, 200)
        self.assertIn("cpu", telemetry.json())

        processes = self.client.get("/api/processes", params={"limit": 2})
        self.assertEqual(processes.status_code, 200)
        self.assertLessEqual(len(processes.json()["processes"]), 2)

        metrics = self.client.get("/api/metrics")
        self.assertEqual(metrics.status_code, 200)
        self.assertIn("jarvis_core_cpu_percent", metrics.text)

        neofetch = self.client.get("/api/neofetch")
        self.assertEqual(neofetch.status_code, 200)
        self.assertTrue(neofetch.json()["lines"])

    def test_auth_is_required_for_commands(self) -> None:
        denied = self.client.post("/api/command", json={"command": "echo hi"})
        self.assertEqual(denied.status_code, 401)

        bad = self.client.post(
            "/api/auth/login", json={"passcode": "wrong-passcode"}
        )
        self.assertEqual(bad.status_code, 401)

        token = self._token()
        allowed = self.client.post(
            "/api/command",
            json={"command": "echo hi"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(allowed.json()["output"], ["hi"])
        self.assertEqual(allowed.json()["exit_code"], 0)

    def test_filesystem_api_flow(self) -> None:
        token = self._token()
        headers = {"Authorization": f"Bearer {token}"}

        created = self.client.post(
            "/api/fs/write",
            json={"path": "/tmp/api.txt", "content": "api"},
            headers=headers,
        )
        self.assertEqual(created.status_code, 200, created.text)

        read = self.client.get("/api/fs/read", params={"path": "/tmp/api.txt"})
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json()["content"], "api")

        listing = self.client.get("/api/fs", params={"path": "/tmp"})
        self.assertEqual(listing.status_code, 200)
        self.assertIn("api.txt", [item["name"] for item in listing.json()["items"]])

        missing = self.client.get("/api/fs/read", params={"path": "/tmp/nope.txt"})
        self.assertEqual(missing.status_code, 404)

        traversal = self.client.get("/api/fs", params={"path": "/../../etc"})
        self.assertIn(traversal.status_code, (400, 403))

    def test_openapi_and_docs(self) -> None:
        schema = self.client.get("/api/openapi.json")
        self.assertEqual(schema.status_code, 200)
        self.assertIn("/api/telemetry", schema.json()["paths"])


class CliTests(unittest.TestCase):
    def test_parser_accepts_known_subcommands(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["status", "--json"])
        self.assertEqual(args.subcommand, "status")
        self.assertTrue(args.json)

        serve = parser.parse_args(["serve", "--port", "9000"])
        self.assertEqual(serve.port, 9000)

        execute = parser.parse_args(["exec", "sysinfo"])
        self.assertEqual(execute.command, ["sysinfo"])


if __name__ == "__main__":
    unittest.main()
