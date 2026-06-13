"""Alpha Vantage forex + commodities data client.

Free tier: 25 calls/day, 5 calls/min.
We use a hybrid approach:
  1. Initial fetch: get real rates for all symbols (5 calls)
  2. Between refreshes: tiny random walk from last known real price
  3. Periodic re-sync: staggered across the day to stay within limits
"""

import asyncio
import json
import logging
import random
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import httpx

logger = logging.getLogger(__name__)

# Map our symbol → Alpha Vantage from/to currency
SYMBOL_MAP: dict[str, tuple[str, str]] = {
    "GBPUSD": ("GBP", "USD"),
    "USDCAD": ("USD", "CAD"),
    "USDJPY": ("USD", "JPY"),
    "XAUUSD": ("XAU", "USD"),
    "XAGUSD": ("XAG", "USD"),
}

# Realistic prices for initial fallback and sim drift reference
BASE_PRICES: dict[str, float] = {
    "GBPUSD": 1.28,
    "USDCAD": 1.37,
    "USDJPY": 152.0,
    "XAUUSD": 2340.0,
    "XAGUSD": 29.5,
}

VOLATILITY: dict[str, float] = {
    "GBPUSD": 0.0001,
    "USDCAD": 0.0001,
    "USDJPY": 0.01,
    "XAUUSD": 0.5,
    "XAGUSD": 0.02,
}

INITIAL_CHANGE: dict[str, float] = {
    "GBPUSD": 0.05,
    "USDCAD": -0.03,
    "USDJPY": 0.2,
    "XAUUSD": 1.5,
    "XAGUSD": 0.1,
}


class CachedForexTick:
    __slots__ = ("symbol", "bid", "ask", "last", "change_24h", "volume_24h", "high_24h", "low_24h", "updated_at")

    def __init__(self, symbol: str, price: float):
        self.symbol = symbol
        spread = price * 0.0002  # ~0.02% spread
        self.bid = price - spread / 2
        self.ask = price + spread / 2
        self.last = price
        self.change_24h = INITIAL_CHANGE.get(symbol, 0.0)
        self.volume_24h = 0
        self.high_24h = price * 1.002
        self.low_24h = price * 0.998
        self.updated_at = datetime.now(timezone.utc)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "bid": self.bid,
            "ask": self.ask,
            "last": self.last,
            "change_24h": round(self.change_24h, 2),
            "volume_24h": self.volume_24h,
            "high_24h": self.high_24h,
            "low_24h": self.low_24h,
            "updated_at": self.updated_at.isoformat(),
        }


class ForexClient:
    """Alpha Vantage forex data client with hybrid live+sim updates."""

    BASE_URL = "https://www.alphavantage.co/query"

    def __init__(self, api_key: str):
        self._api_key = api_key
        self._http: Optional[httpx.AsyncClient] = None
        self._ticks: dict[str, CachedForexTick] = {}
        self._callbacks: list[Callable] = []
        self._sim_task: Optional[asyncio.Task] = None
        self._sync_task: Optional[asyncio.Task] = None
        self._running = False
        self._symbols: list[str] = []

    def on_ticker(self, cb: Callable):
        self._callbacks.append(cb)

    def get_tick(self, symbol: str) -> Optional[CachedForexTick]:
        return self._ticks.get(symbol.upper())

    def all_ticks(self) -> list[CachedForexTick]:
        return list(self._ticks.values())

    async def start(self, symbols: list[str]):
        self._running = True
        self._symbols = [s.upper() for s in symbols if s.upper() in SYMBOL_MAP]
        if not self._symbols:
            return

        # Init with base prices
        for sym in self._symbols:
            self._ticks[sym] = CachedForexTick(sym, BASE_PRICES.get(sym, 1.0))

        # Initial fetch from Alpha Vantage
        await self._sync_all()

        # Start simulation loop (~2 ticks/sec)
        self._sim_task = asyncio.create_task(self._sim_loop())

        # Start sync task (refresh from Alpha Vantage periodically)
        self._sync_task = asyncio.create_task(self._sync_loop())

        logger.info("Forex client started: %s", self._symbols)

    async def stop(self):
        self._running = False
        if self._sim_task:
            self._sim_task.cancel()
        if self._sync_task:
            self._sync_task.cancel()
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    # ── Alpha Vantage API ──────────────────────────────

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(base_url=self.BASE_URL, timeout=httpx.Timeout(10.0))
        return self._http

    async def fetch_rate(self, symbol: str) -> Optional[float]:
        """Fetch real-time exchange rate from Alpha Vantage."""
        pair = SYMBOL_MAP.get(symbol)
        if not pair:
            return None
        from_c, to_c = pair
        client = await self._get_http()
        try:
            resp = await client.get("", params={
                "function": "CURRENCY_EXCHANGE_RATE",
                "from_currency": from_c,
                "to_currency": to_c,
                "apikey": self._api_key,
            })
            data = resp.json()
            rate_str = data.get("Realtime Currency Exchange Rate", {}).get("5. Exchange Rate", "")
            if rate_str:
                return float(rate_str)
            logger.warning("Alpha Vantage response for %s: %s", symbol, str(data)[:200])
        except Exception as e:
            logger.warning("Alpha Vantage fetch failed for %s: %s", symbol, e)
        return None

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 100) -> list:
        """Generate realistic klines around the current real price.

        Uses the current real price (last Alpha Vantage fetch) to generate
        a realistic kline series. Doesn't consume API calls.
        """
        tick = self._ticks.get(symbol.upper())
        base = tick.last if tick else BASE_PRICES.get(symbol.upper(), 1.0)
        vol = VOLATILITY.get(symbol.upper(), 0.0001)

        interval_ms = {"1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000,
                       "1h": 3600000, "4h": 14400000, "1d": 86400000}.get(interval, 3600000)
        now = int(datetime.now(timezone.utc).timestamp() * 1000)

        result = []
        price = base * (1 + random.uniform(-0.005, 0.005))  # small offset
        for i in range(limit):
            o = price + random.gauss(0, 0.3) * vol
            c = o + random.gauss(0, 0.3) * vol
            h = max(o, c) * (1 + abs(random.gauss(0, 0.3)) * vol / base)
            l_ = min(o, c) * (1 - abs(random.gauss(0, 0.3)) * vol / base)
            result.append([
                now - (limit - i) * interval_ms,
                round(max(o, 1.0), max(2, 4 - int(base))),
                round(max(h, 1.0), max(2, 4 - int(base))),
                round(max(l_, 1.0), max(2, 4 - int(base))),
                round(max(c, 1.0), max(2, 4 - int(base))),
                round(random.uniform(100, 10000), 2),
            ])
            price = c
        return result

    async def _sync_all(self):
        """Fetch latest rates for all forex symbols from Alpha Vantage."""
        for sym in self._symbols:
            rate = await self.fetch_rate(sym)
            if rate and rate > 0:
                tick = self._ticks[sym]
                spread = rate * 0.0002
                tick.last = rate
                tick.bid = rate - spread / 2
                tick.ask = rate + spread / 2
                tick.high_24h = max(tick.high_24h, rate)
                tick.low_24h = min(tick.low_24h, rate)
                tick.change_24h = ((tick.last / BASE_PRICES.get(sym, 1.0)) - 1) * 100
                logger.info("Forex %s: %.4f (real)", sym, rate)
            await asyncio.sleep(2)  # space calls to avoid rate limit

    # ── Simulation loop (between real refreshes) ──────

    async def _sim_loop(self):
        """Generate smooth tick updates between Alpha Vantage refreshes."""
        while self._running:
            for sym, tick in list(self._ticks.items()):
                vol = VOLATILITY.get(sym, 0.0001)
                base = BASE_PRICES.get(sym, 1.0)
                reversion = (base - tick.last) * 0.0001
                noise = random.gauss(0, 1) * vol
                tick.last = max(tick.last * 0.95, min(tick.last * 1.05, tick.last + reversion + noise))
                spread = tick.last * 0.0002
                tick.bid = tick.last - spread / 2
                tick.ask = tick.last + spread / 2
                tick.high_24h = max(tick.high_24h, tick.last)
                tick.low_24h = min(tick.low_24h, tick.last)
                tick.updated_at = datetime.now(timezone.utc)
                # Notify callbacks
                for cb in self._callbacks:
                    try:
                        await cb(tick.to_dict())
                    except Exception:
                        pass
            await asyncio.sleep(0.5)

    # ── Periodic sync with Alpha Vantage ──────────────

    async def _sync_loop(self):
        """Re-sync with Alpha Vantage every ~3 hours (stay within 25/day limit)."""
        # With 5 symbols, each full sync = 5 calls
        # 25 calls/day ÷ 5 symbols = 5 full syncs per day = every ~4.8 hours
        calls_per_cycle = len(self._symbols)
        max_cycles = max(1, 25 // calls_per_cycle)
        interval = 86400 / max_cycles  # seconds between cycles

        logger.info("Forex sync interval: %.0f min (%d cycles/day, %d calls/cycle)",
                    interval / 60, max_cycles, calls_per_cycle)

        while self._running:
            await asyncio.sleep(interval)
            if self._running:
                logger.info("Forex re-sync from Alpha Vantage...")
                await self._sync_all()
