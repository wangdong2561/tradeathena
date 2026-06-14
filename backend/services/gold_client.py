"""Gold and silver real-time data via gold-api.com (free, no API key required).

Returns live XAU/USD and XAG/USD prices.
"""

import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)

BASE_GOLD = 4200.0
BASE_SILVER = 68.0


class GoldClient:
    """Live gold & silver data from gold-api.com + simulated ticks between refreshes."""

    GOLD_URL = "https://api.gold-api.com/price/XAU"
    SILVER_URL = "https://api.gold-api.com/price/XAG"

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None
        self._xau_tick: Optional[dict] = None
        self._xag_tick: Optional[dict] = None
        self._callbacks: list[Callable] = []
        self._sim_task: Optional[asyncio.Task] = None
        self._refresh_task: Optional[asyncio.Task] = None
        self._running = False

    def on_ticker(self, cb: Callable):
        self._callbacks.append(cb)

    def get_tick(self, symbol: str) -> Optional[dict]:
        sym = symbol.upper()
        if sym == "XAUUSD":
            return self._xau_tick
        if sym == "XAGUSD":
            return self._xag_tick
        return None

    def all_ticks(self) -> list[dict]:
        return [t for t in [self._xau_tick, self._xag_tick] if t]

    async def start(self, _symbols=None):
        self._running = True
        # Init with base prices
        self._init_ticks()
        # First real fetch
        await self._refresh()
        # Only refresh from API every 5 minutes — no sim noise
        self._refresh_task = asyncio.create_task(self._refresh_loop())
        logger.info("Gold/Silver client started (real prices, no sim noise)")

    async def stop(self):
        self._running = False
        if self._refresh_task:
            self._refresh_task.cancel()

    def _init_ticks(self):
        now = datetime.now(timezone.utc).isoformat()
        self._xau_tick = {
            "symbol": "XAUUSD", "bid": 4219.5, "ask": 4221.0, "last": 4220.3,
            "change_24h": 0.5, "volume_24h": 0, "high_24h": 4240, "low_24h": 4200,
            "updated_at": now,
        }
        self._xag_tick = {
            "symbol": "XAGUSD", "bid": 68.10, "ask": 68.22, "last": 68.16,
            "change_24h": 0.3, "volume_24h": 0, "high_24h": 68.5, "low_24h": 67.8,
            "updated_at": now,
        }

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
        return self._http

    async def _refresh(self):
        """Fetch real gold/silver prices from gold-api.com."""
        http = await self._get_http()
        try:
            resp = await http.get(self.GOLD_URL)
            if resp.status_code == 200:
                data = resp.json()
                price = float(data.get("price", 0))
                if price > 0:
                    self._update_tick("XAUUSD", price)
                    logger.info("Gold: $%.2f (real)", price)
        except Exception as e:
            logger.warning("Gold fetch error: %s", e)

        try:
            resp = await http.get(self.SILVER_URL)
            if resp.status_code == 200:
                data = resp.json()
                price = float(data.get("price", 0))
                if price > 0:
                    self._update_tick("XAGUSD", price)
                    logger.info("Silver: $%.2f (real)", price)
        except Exception as e:
            logger.warning("Silver fetch error: %s", e)

    def _update_tick(self, symbol: str, price: float):
        spread = price * 0.0003
        tick = {
            "symbol": symbol,
            "bid": price - spread / 2,
            "ask": price + spread / 2,
            "last": price,
            "change_24h": 0.0,
            "volume_24h": 0,
            "high_24h": price * 1.005,
            "low_24h": price * 0.995,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if symbol == "XAUUSD":
            self._xau_tick = tick
        else:
            self._xag_tick = tick

    async def _refresh_loop(self):
        """Re-fetch from API every 60 seconds (MT4/MT5-like frequency)."""
        while self._running:
            await asyncio.sleep(60)
            if self._running:
                await self._refresh()

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 100) -> list:
        """Generate realistic klines around current real price."""
        tick = self._xau_tick if symbol.upper() == "XAUUSD" else self._xag_tick
        base = tick["last"] if tick else (BASE_GOLD if symbol.upper() == "XAUUSD" else BASE_SILVER)
        vol = base * 0.002  # ~0.2% per tick

        interval_ms = {"1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000,
                       "1h": 3600000, "4h": 14400000, "1d": 86400000}.get(interval, 3600000)
        now = int(datetime.now(timezone.utc).timestamp() * 1000)

        result = []
        price = base
        for i in range(limit):
            o = price + random.gauss(0, 0.5) * vol
            c = o + random.gauss(0, 0.5) * vol
            h = max(o, c) + abs(random.gauss(0, 0.3)) * vol
            l_ = min(o, c) - abs(random.gauss(0, 0.3)) * vol
            result.append([
                now - (limit - i) * interval_ms,
                round(max(o, 0.01), 2),
                round(max(h, 0.01), 2),
                round(max(l_, 0.01), 2),
                round(max(c, 0.01), 2),
                round(random.uniform(100, 5000), 2),
            ])
            price = c
        return result
