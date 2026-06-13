"""Market data service — caches latest ticks & klines in memory, pushes via callbacks."""

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from .binance import BinanceClient

logger = logging.getLogger(__name__)


class CachedTick:
    """In-memory snapshot of current market state for one symbol."""

    __slots__ = ("symbol", "bid", "ask", "last", "change_24h", "volume_24h", "high_24h", "low_24h", "updated_at")

    def __init__(self, symbol: str):
        self.symbol = symbol
        self.bid = 0.0
        self.ask = 0.0
        self.last = 0.0
        self.change_24h = 0.0
        self.volume_24h = 0.0
        self.high_24h = 0.0
        self.low_24h = 0.0
        self.updated_at = datetime.now(timezone.utc)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "bid": self.bid,
            "ask": self.ask,
            "last": self.last,
            "change_24h": self.change_24h,
            "volume_24h": self.volume_24h,
            "high_24h": self.high_24h,
            "low_24h": self.low_24h,
            "updated_at": self.updated_at.isoformat(),
        }


class MarketService:
    """Aggregates Binance ticker & kline data, emits callbacks on every update."""

    def __init__(self, binance: BinanceClient):
        self._binance = binance
        self._ticks: dict[str, CachedTick] = {}
        self._ticker_callbacks: list[Callable] = []
        self._kline_callbacks: list[Callable] = []
        # Track active kline subscriptions: symbol -> interval
        self._active_kline: dict[str, str] = {}

    def on_ticker(self, cb: Callable):
        self._ticker_callbacks.append(cb)

    def on_kline(self, cb: Callable):
        """Register callback for real-time kline updates. Args: (symbol, interval, kline_dict)."""
        self._kline_callbacks.append(cb)

    def get_tick(self, symbol: str) -> Optional[CachedTick]:
        return self._ticks.get(symbol.upper())

    def all_ticks(self) -> list[CachedTick]:
        return list(self._ticks.values())

    async def subscribe_kline(self, symbol: str, interval: str):
        """Subscribe (or switch) real-time kline feed for a symbol."""
        sym = symbol.upper()
        prev = self._active_kline.get(sym)
        if prev == interval:
            return  # already subscribed
        self._active_kline[sym] = interval
        logger.info("Subscribing kline: %s %s", sym, interval)

        sid = sym
        async def on_kline_msg(msg: dict):
            k = msg.get("k", {})
            if not k:
                return
            kline_data = {
                "symbol": msg.get("s", sid),
                "interval": k.get("i", interval),
                "time": k["t"],               # ms
                "open": float(k["o"]),
                "high": float(k["h"]),
                "low": float(k["l"]),
                "close": float(k["c"]),
                "volume": float(k["v"]),
                "closed": k.get("x", False),   # True if candle is final
            }
            for cb in self._kline_callbacks:
                try:
                    await cb(kline_data)
                except Exception:
                    pass

        await self._binance.subscribe(f"{symbol.lower()}@kline_{interval}", on_kline_msg)

    async def start(self, symbols: list[str]):
        symbols_upper = [s.upper() for s in symbols]
        for s in symbols_upper:
            self._ticks[s] = CachedTick(s)

        for s in symbols:
            s_lower = s.lower()
            sid = s.upper()

            async def on_ticker(msg: dict, sym: str = sid, ct: CachedTick = self._ticks[sid]):
                ct.last = float(msg.get("c", ct.last))
                ct.bid = float(msg.get("b", ct.bid))
                ct.ask = float(msg.get("a", ct.ask))
                ct.change_24h = float(msg.get("P", ct.change_24h))
                ct.volume_24h = float(msg.get("v", ct.volume_24h))
                ct.high_24h = float(msg.get("h", ct.high_24h))
                ct.low_24h = float(msg.get("l", ct.low_24h))
                ct.updated_at = datetime.now(timezone.utc)
                for cb in self._ticker_callbacks:
                    try:
                        await cb(ct.to_dict())
                    except Exception:
                        pass

            await self._binance.subscribe(f"{s_lower}@ticker", on_ticker)

            # Depth stream for order book (best bid/ask already from ticker)
            async def on_depth(msg: dict, ct: CachedTick = self._ticks[sid]):
                if msg.get("bids"):
                    ct.bid = float(msg["bids"][0][0])
                if msg.get("asks"):
                    ct.ask = float(msg["asks"][0][0])

            await self._binance.subscribe(f"{s_lower}@depth20@100ms", on_depth)

        # Subscribe default kline stream for first symbol
        if symbols:
            await self.subscribe_kline(symbols[0], "1h")

        logger.info("Market service started: %d symbols", len(symbols))

    async def stop(self):
        self._ticker_callbacks.clear()
        self._kline_callbacks.clear()
