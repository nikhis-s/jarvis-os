"""Server-sent event fan-out for live HUD telemetry."""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from typing import Any, AsyncIterator


class EventBroker:
    """A small in-process pub/sub broker for Server-Sent Events."""

    def __init__(self, history: int = 30) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._history: deque[dict[str, Any]] = deque(maxlen=max(1, history))
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        async with self._lock:
            self._subscribers.add(queue)
            for message in list(self._history):
                try:
                    queue.put_nowait(message)
                except asyncio.QueueFull:
                    break
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers.discard(queue)

    async def publish(self, event: str, data: dict[str, Any]) -> None:
        message = {"event": event, "data": data, "ts": time.time()}
        async with self._lock:
            self._history.append(message)
            subscribers = list(self._subscribers)
        for queue in subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # Slow client: drop this frame instead of blocking the core.
                continue

    async def stream(
        self, queue: asyncio.Queue[dict[str, Any]], heartbeat: float = 15.0
    ) -> AsyncIterator[str]:
        try:
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                event = message.get("event", "message")
                payload = json.dumps(message.get("data", {}), separators=(",", ":"))
                yield f"event: {event}\ndata: {payload}\n\n"
        finally:
            await self.unsubscribe(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def history_size(self) -> int:
        return len(self._history)
