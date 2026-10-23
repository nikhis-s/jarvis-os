"""Small, dependency-free security primitives for the JARVIS Core.

The core is designed to be a *local* service, but it still protects
mutating endpoints with short-lived HMAC signed bearer tokens, constant
time passcode comparisons and a simple in-process rate limiter.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Deque


class TokenError(ValueError):
    """Raised when a bearer token is malformed, tampered with or expired."""


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def verify_passcode(entered: str, expected: str) -> bool:
    """Compare a submitted passcode against the configured one safely."""

    if not entered or not expected:
        return False
    return hmac.compare_digest(entered.encode("utf-8"), expected.encode("utf-8"))


class TokenManager:
    """Issue and verify stateless HMAC-SHA256 bearer tokens.

    Tokens are deliberately simple: ``base64(payload).base64(signature)``.
    They contain no secrets, are signed with a per-process key and expire
    after ``ttl`` seconds. No third party token library is required.
    """

    def __init__(self, secret: str | None = None, ttl: int = 8 * 60 * 60) -> None:
        raw_secret = (secret or "").encode("utf-8")
        if not raw_secret:
            raw_secret = secrets.token_bytes(32)
        self._key = hashlib.sha256(raw_secret).digest()
        self.ttl = max(60, int(ttl))
        self._revoked: set[str] = set()
        self._lock = threading.Lock()

    def issue(self, subject: str = "operator") -> tuple[str, float]:
        """Return ``(token, expires_at)`` for a subject."""

        now = time.time()
        expires_at = now + self.ttl
        payload = {
            "sub": subject,
            "iat": now,
            "exp": expires_at,
            "nonce": secrets.token_hex(8),
        }
        body = _b64encode(
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )
        signature = _b64encode(
            hmac.new(self._key, body.encode("ascii"), hashlib.sha256).digest()
        )
        return f"{body}.{signature}", expires_at

    def verify(self, token: str) -> dict[str, Any]:
        """Validate a token and return its payload."""

        if not token or token.count(".") != 1:
            raise TokenError("Malformed bearer token")
        body, signature = token.split(".", 1)
        expected = _b64encode(
            hmac.new(self._key, body.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(signature, expected):
            raise TokenError("Invalid token signature")
        with self._lock:
            if token in self._revoked:
                raise TokenError("Token has been revoked")
        try:
            payload = json.loads(_b64decode(body).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise TokenError("Invalid token payload") from exc
        if not isinstance(payload, dict):
            raise TokenError("Invalid token payload")
        try:
            expires_at = float(payload.get("exp", 0))
        except (TypeError, ValueError) as exc:
            raise TokenError("Invalid token expiry") from exc
        if expires_at < time.time():
            raise TokenError("Token has expired")
        if not payload.get("sub"):
            raise TokenError("Token is missing a subject")
        return payload

    def revoke(self, token: str) -> None:
        """Revoke a token for the lifetime of this process."""

        with self._lock:
            self._revoked.add(token)

    @property
    def revoked_count(self) -> int:
        with self._lock:
            return len(self._revoked)


@dataclass
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: float = 0.0


class RateLimiter:
    """Sliding window rate limiter keyed by client identity."""

    def __init__(self, limit: int = 30, window: float = 60.0) -> None:
        self.limit = max(1, int(limit))
        self.window = max(1.0, float(window))
        self._hits: dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._accepted = 0
        self._rejected = 0

    def check(self, key: str) -> RateLimitResult:
        """Record a hit for ``key`` and report whether it is allowed."""

        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                self._rejected += 1
                retry_after = max(0.0, self.window - (now - bucket[0]))
                return RateLimitResult(False, 0, retry_after)
            bucket.append(now)
            self._accepted += 1
            return RateLimitResult(True, self.limit - len(bucket))

    def reset(self, key: str | None = None) -> None:
        """Clear one bucket, or every bucket when ``key`` is omitted."""

        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return {
                "keys": len(self._hits),
                "accepted": self._accepted,
                "rejected": self._rejected,
                "limit": self.limit,
                "window_seconds": int(self.window),
            }


@dataclass
class AuthEvent:
    """Audit record for a successful or failed authentication attempt."""

    timestamp: float
    client: str
    success: bool
    reason: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
