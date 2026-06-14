"""Market data simulator — generates realistic crypto price ticks when Binance is unreachable.

Uses a simple random walk with drift, volatility clustering, and realistic spread.
"""

import asyncio
import logging
import math
import random
from datetime import datetime, timezone
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# Realistic prices (as of 2026)
BASE_PRICES = {
    "BTCUSDT": 105000.0,
    "ETHUSDT": 4200.0,
    "SOLUSDT": 185.0,
    "BNBUSDT": 620.0,
    "DOGEUSDT": 0.15,
    "GBPUSD": 1.28,
    "USDCAD": 1.37,
    "USDJPY": 152.0,
    "XAUUSD": 2340.0,
    "XAGUSD": 29.5,
}

VOLATILITY = {
    "BTCUSDT": 0.003,
    "ETHUSDT": 0.004,
    "SOLUSDT": 0.005,
    "BNBUSDT": 0.004,
    "DOGEUSDT": 0.008,
    "GBPUSD": 0.0005,
    "USDCAD": 0.0004,
    "USDJPY": 0.0006,
    "XAUUSD": 0.003,
    "XAGUSD": 0.005,
}

SPREAD_BPS = {
    "BTCUSDT": 1.5, "ETHUSDT": 2.0, "SOLUSDT": 3.0, "BNBUSDT": 2.5, "DOGEUSDT": 5.0,
    "GBPUSD": 0.8, "USDCAD": 0.9, "USDJPY": 0.7,
    "XAUUSD": 1.2, "XAGUSD": 2.0,
}

SPREAD_BPS = {          # spread in basis points (0.01%)
    "BTCUSDT": 1.5,
    "ETHUSDT": 2.0,
    "SOLUSDT": 3.0,
    "BNBUSDT": 2.5,
    "DOGEUSDT": 5.0,
}


class CachedTick:
    """In-memory market snapshot."""

    __slots__ = ("symbol", "bid", "ask", "last", "change_24h", "volume_24h", "high_24h", "low_24h", "updated_at")

    def __init__(self, symbol: str):
        base = BASE_PRICES.get(symbol, 1000.0)
        self.symbol = symbol
        self.bid = base * 0.9999
        self.ask = base * 1.0001
        self.last = base
        self.change_24h = random.uniform(-5.0, 5.0)
        self.volume_24h = random.uniform(10000, 50000)
        self.high_24h = base * 1.02
        self.low_24h = base * 0.98
        self.updated_at = datetime.now(timezone.utc)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "bid": round(self.bid, 2),
            "ask": round(self.ask, 2),
            "last": round(self.last, 2),
            "change_24h": round(self.change_24h, 2),
            "volume_24h": round(self.volume_24h, 2),
            "high_24h": round(self.high_24h, 2),
            "low_24h": round(self.low_24h, 2),
            "updated_at": self.updated_at.isoformat(),
        }


class MarketSimulator:
    """Generates realistic price ticks at ~500ms intervals."""

    def __init__(self):
        self._ticks: dict[str, CachedTick] = {}
        self._prices: dict[str, float] = {}
        self._callbacks: list[Callable] = []
        self._task: Optional[asyncio.Task] = None
        self._running = False

    def on_ticker(self, cb: Callable):
        self._callbacks.append(cb)

    def on_kline(self, cb: Callable):
        """Kline callback registration — no-op for simulator mode (no real klines)."""
        pass  # klines are generated on-demand via SimulatedBinanceClient.get_klines()

    def get_tick(self, symbol: str) -> Optional[CachedTick]:
        return self._ticks.get(symbol.upper())

    def all_ticks(self) -> list[CachedTick]:
        return list(self._ticks.values())

    async def start(self, symbols: list[str]):
        self._running = True
        for s in symbols:
            s_upper = s.upper()
            self._ticks[s_upper] = CachedTick(s_upper)
            self._prices[s_upper] = BASE_PRICES.get(s_upper, 1000.0)

        # Start price simulation loop
        self._task = asyncio.create_task(self._simulate())
        logger.info("Market simulator started with %d symbols", len(symbols))

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Market simulator stopped")

    async def _simulate(self):
        """Main simulation loop — ~2 ticks per second."""
        while self._running:
            for sym, tick in list(self._ticks.items()):
                self._step_price(tick)
                self._prices[sym] = tick.last
                # Notify callbacks
                for cb in self._callbacks:
                    try:
                        await cb(tick.to_dict())
                    except Exception:
                        pass
            await asyncio.sleep(0.5)  # 500ms between ticks

    def _step_price(self, tick: CachedTick):
        vol = VOLATILITY.get(tick.symbol, 0.003)
        spread_bps = SPREAD_BPS.get(tick.symbol, 2.0)

        # Random walk with slight mean reversion
        base = BASE_PRICES.get(tick.symbol, 1000.0)
        reversion = (base - tick.last) * 0.0001
        noise = random.gauss(0, 1) * vol * tick.last
        tick.last = max(tick.last * 0.9, min(tick.last * 1.1, tick.last + reversion + noise))

        # Update spread
        spread = tick.last * spread_bps / 10000
        tick.bid = tick.last - spread / 2
        tick.ask = tick.last + spread / 2

        # Update 24h stats
        tick.high_24h = max(tick.high_24h, tick.last)
        tick.low_24h = min(tick.low_24h, tick.last)
        tick.change_24h = ((tick.last / BASE_PRICES.get(tick.symbol, 1000.0)) - 1) * 100

        # Randomize volume slightly
        tick.volume_24h += random.uniform(-50, 50)
        tick.volume_24h = max(1000, tick.volume_24h)

        tick.updated_at = datetime.now(timezone.utc)

    def get_price(self, symbol: str) -> float:
        return self._prices.get(symbol.upper(), 0.0)

    def get_bid_ask(self, symbol: str) -> tuple[float, float]:
        tick = self._ticks.get(symbol.upper())
        if tick:
            return tick.bid, tick.ask
        return 0.0, 0.0


# For backward compatibility with old code that uses BinanceClient API
class SimulatedBinanceClient:
    """Duck-typed replacement for BinanceClient that uses the simulator."""

    def __init__(self, simulator: MarketSimulator):
        self.simulator = simulator
        self.prices = {}
        self.bids = {}
        self.asks = {}

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 500):
        """Generate realistic kline data."""
        tick = self.simulator.get_tick(symbol)
        base = tick.last if tick else BASE_PRICES.get(symbol.upper(), 1000.0)
        vol = VOLATILITY.get(symbol.upper(), 0.003)

        result = []
        now = int(datetime.now(timezone.utc).timestamp() * 1000)
        interval_ms = {"1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000,
                       "1h": 3600000, "4h": 14400000, "1d": 86400000}.get(interval, 3600000)

        price = base * 0.95
        for i in range(limit):
            o = price + random.gauss(0, 1) * vol * base * 0.5
            c = o + random.gauss(0, 1) * vol * base
            h = max(o, c) * (1 + abs(random.gauss(0, 0.3)) * vol)
            l_ = min(o, c) * (1 - abs(random.gauss(0, 0.3)) * vol)
            v = random.uniform(100, 1000)
            result.append([
                now - (limit - i) * interval_ms,  # time
                round(max(o, 1), 2),              # open
                round(max(h, 1), 2),              # high
                round(max(l_, 1), 2),             # low
                round(max(c, 1), 2),              # close
                round(v, 4),                      # volume
                interval_ms,                      # close time
                round(v * random.uniform(0.8, 1.2), 4),  # quote volume
                100,                              # trades
                "0", "0", "0",
            ])
            price = c
        return result

    async def get_ticker_24hr(self, symbol: str):
        tick = self.simulator.get_tick(symbol)
        if tick:
            return {
                "symbol": symbol.upper(),
                "lastPrice": str(tick.last),
                "bidPrice": str(tick.bid),
                "askPrice": str(tick.ask),
                "priceChangePercent": str(tick.change_24h),
                "volume": str(tick.volume_24h),
                "highPrice": str(tick.high_24h),
                "lowPrice": str(tick.low_24h),
            }
        return {"symbol": symbol.upper(), "lastPrice": "0", "bidPrice": "0", "askPrice": "0",
                "priceChangePercent": "0", "volume": "0", "highPrice": "0", "lowPrice": "0"}

    async def get_depth(self, symbol: str, limit: int = 20):
        tick = self.simulator.get_tick(symbol)
        price = tick.last if tick else BASE_PRICES.get(symbol.upper(), 1000.0)
        spread = price * SPREAD_BPS.get(symbol.upper(), 2.0) / 10000
        bids = [[f"{price - spread - i * spread * 0.1:.2f}", f"{random.uniform(0.1, 10):.4f}"] for i in range(limit)]
        asks = [[f"{price + spread + i * spread * 0.1:.2f}", f"{random.uniform(0.1, 10):.4f}"] for i in range(limit)]
        return {"bids": bids, "asks": asks}

    async def get_all_tickers(self):
        return [{"symbol": s, "price": str(self.simulator.get_price(s))} for s in BASE_PRICES]

    async def subscribe(self, stream: str, callback: Callable):
        pass  # Simulator handles its own tick generation

    async def start(self, symbols=None):
        pass

    async def stop(self):
        pass
