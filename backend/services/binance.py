"""Async Binance REST + WebSocket client with auto-reconnect and proxy/SSL compatibility."""

import asyncio
import json
import logging
import ssl
from typing import Any, Callable, Optional

import httpx
import websockets

logger = logging.getLogger(__name__)


# Create an SSL context that doesn't verify certificates.
# Required for proxies that do SSL interception (common with local VPN/proxy tools).
_INSECURE_SSL = ssl.create_default_context()
_INSECURE_SSL.check_hostname = False
_INSECURE_SSL.verify_mode = ssl.CERT_NONE


class BinanceClient:
    """Async Binance API client — HTTP + WebSocket with automatic reconnection."""

    REST_URL = "https://api.binance.com"
    WS_URL = "wss://stream.binance.com:9443/ws"

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None
        self._ws_tasks: dict[str, asyncio.Task] = {}
        self._callbacks: dict[str, list[Callable]] = {}
        # Price cache (hot-path, no lock needed)
        self.prices: dict[str, float] = {}
        self.bids: dict[str, float] = {}
        self.asks: dict[str, float] = {}
        self._running = False

    # ── HTTP ────────────────────────────────────────────

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=self.REST_URL,
                timeout=httpx.Timeout(10.0),
                verify=False,  # allow proxy SSL interception
            )
        return self._http

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 500) -> list:
        client = await self._get_http()
        resp = await client.get("/api/v3/klines", params={"symbol": symbol.upper(), "interval": interval, "limit": min(limit, 1000)})
        resp.raise_for_status()
        return resp.json()

    async def get_ticker_24hr(self, symbol: str) -> dict:
        client = await self._get_http()
        resp = await client.get("/api/v3/ticker/24hr", params={"symbol": symbol.upper()})
        resp.raise_for_status()
        return resp.json()

    async def get_depth(self, symbol: str, limit: int = 20) -> dict:
        client = await self._get_http()
        resp = await client.get("/api/v3/depth", params={"symbol": symbol.upper(), "limit": min(limit, 100)})
        resp.raise_for_status()
        return resp.json()

    # ── WebSocket ───────────────────────────────────────

    async def subscribe(self, stream: str, callback: Callable):
        self._callbacks.setdefault(stream, []).append(callback)
        if stream not in self._ws_tasks:
            self._ws_tasks[stream] = asyncio.create_task(self._run_ws(stream))

    async def _run_ws(self, stream: str):
        url = f"{self.WS_URL}/{stream}"
        delay = 0.5
        while self._running:
            try:
                async with websockets.connect(
                    url,
                    ping_interval=20,
                    close_timeout=5,
                    ssl=_INSECURE_SSL,  # accept proxy SSL certs
                ) as ws:
                    delay = 0.5
                    logger.debug("WS connected: %s", stream)
                    async for raw in ws:
                        msg = json.loads(raw)
                        self._cache_update(stream, msg)
                        for cb in self._callbacks.get(stream, []):
                            try:
                                await cb(msg)
                            except Exception:
                                pass
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("WS %s: %s, retry in %.1fs", stream, e, delay)
                if self._running:
                    await asyncio.sleep(delay)
                    delay = min(delay * 1.5, 10)

    def _cache_update(self, stream: str, msg: dict):
        if stream.endswith("@ticker"):
            sym = msg.get("s", "")
            self.prices[sym] = float(msg.get("c", 0))
        elif stream.endswith("@depth20@100ms"):
            sym = msg.get("s", stream.split("@")[0].upper())
            if msg.get("bids"):
                self.bids[sym] = float(msg["bids"][0][0])
            if msg.get("asks"):
                self.asks[sym] = float(msg["asks"][0][0])
        elif stream.endswith("@trade"):
            self.prices[msg.get("s", "")] = float(msg.get("p", 0))

    # ── Start / Stop ────────────────────────────────────

    async def start(self, symbols: Optional[list[str]] = None):
        self._running = True
        symbols = symbols or ["btcusdt", "ethusdt", "solusdt"]
        for sym in symbols:
            await self.subscribe(f"{sym.lower()}@ticker", lambda _: None)
            await self.subscribe(f"{sym.lower()}@depth20@100ms", lambda _: None)
        logger.info("Binance client started: %d symbols", len(symbols))

    async def stop(self):
        self._running = False
        for t in self._ws_tasks.values():
            t.cancel()
        if self._ws_tasks:
            await asyncio.gather(*self._ws_tasks.values(), return_exceptions=True)
        self._ws_tasks.clear()
        if self._http and not self._http.is_closed:
            await self._http.aclose()
