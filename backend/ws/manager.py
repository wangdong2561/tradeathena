"""WebSocket connection manager — broadcasts market data and order updates to frontend clients."""

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WSManager:
    """Manages WebSocket connections from frontend clients. O(1) broadcast per channel."""

    def __init__(self):
        self._channels: dict[str, set[WebSocket]] = {}  # channel -> set of WS connections
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, channel: str = "global"):
        await ws.accept()
        async with self._lock:
            self._channels.setdefault(channel, set()).add(ws)

    async def disconnect(self, ws: WebSocket, channel: str = "global"):
        async with self._lock:
            self._channels.get(channel, set()).discard(ws)

    async def broadcast(self, channel: str, data: dict[str, Any]):
        """Send data to all clients on a channel. Non-blocking on failure per client."""
        async with self._lock:
            targets = list(self._channels.get(channel, set()))
        payload = json.dumps(data, default=str)
        for ws in targets:
            try:
                await ws.send_text(payload)
            except Exception:
                async with self._lock:
                    self._channels.get(channel, set()).discard(ws)

    async def broadcast_ticker(self, tick: dict):
        """Broadcast a ticker update to all market subscribers."""
        await self.broadcast("market", {"type": "ticker", "data": tick})

    async def broadcast_order_update(self, data: dict):
        await self.broadcast("orders", {"type": "order_update", "data": data})

    async def broadcast_account_update(self, data: dict):
        await self.broadcast("orders", {"type": "account_update", "data": data})
