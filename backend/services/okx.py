"""OKX REST client — crypto market data accessible from China without proxy."""

import asyncio
import json
import logging
import ssl
from typing import Callable, Optional

import httpx

# Accept proxy SSL certs (required in China with VPN/proxy)
_INSECURE_SSL = ssl.create_default_context()
_INSECURE_SSL.check_hostname = False
_INSECURE_SSL.verify_mode = ssl.CERT_NONE

logger = logging.getLogger(__name__)

# Symbol: BTCUSDT → BTC-USDT
# Gold/silver → OKX perpetual swap contracts for tick-level WebSocket data
_GOLD_SILVER_SWAP = {"XAUUSD": "XAU-USDT-SWAP", "XAGUSD": "XAG-USDT-SWAP"}

def _to_okx(s: str) -> str:
    raw = s.upper().strip()
    # Gold/silver → perpetual swap (WebSocket tick-level)
    if raw in _GOLD_SILVER_SWAP:
        return _GOLD_SILVER_SWAP[raw]
    if "-" in raw:
        return raw
    for q in ["USDT", "USDC", "USD", "BTC", "ETH"]:
        if raw.endswith(q) and len(raw) > len(q):
            return f"{raw[:-len(q)]}-{q}"
    return raw

def _from_okx(s: str) -> str:
    # Reverse swap mapping: XAU-USDT-SWAP → XAUUSD
    for k, v in _GOLD_SILVER_SWAP.items():
        if s == v:
            return k
    return s.replace("-", "").upper()

_INTERVAL_MAP = {
    "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6H", "12h": "12H", "1d": "1D", "1w": "1W",
}


class OkxClient:
    """OKX API client — REST + WebSocket, no API key needed for public data.

    Duck-type compatible with BinanceClient for drop-in replacement.
    """

    REST_URL = "https://www.okx.com"
    WS_URL = "wss://ws.okx.com:8443/ws/v5/public"

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None
        self._ws_task: Optional[asyncio.Task] = None
        self.prices: dict[str, float] = {}
        self.bids: dict[str, float] = {}
        self.asks: dict[str, float] = {}
        self._callbacks: dict[str, list[Callable]] = {}
        self._running = False

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(base_url=self.REST_URL, timeout=httpx.Timeout(10.0))
        return self._http

    async def _get(self, path: str, params: dict = {}) -> dict:
        c = await self._get_http()
        r = await c.get(path, params=params)
        r.raise_for_status()
        d = r.json()
        if d.get("code") != "0":
            raise Exception(f"OKX error: {d.get('msg')}")
        return d

    # ── REST endpoints ──────────────────────────────────

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 200) -> list:
        okx_sym = _to_okx(symbol)
        bar = _INTERVAL_MAP.get(interval, "1H")
        data = await self._get("/api/v5/market/candles", {"instId": okx_sym, "bar": bar, "limit": str(min(limit, 300))})
        raw = data.get("data", [])
        result = []
        for k in raw:
            ts = int(k[0])
            result.append([ts, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]),
                          ts + 3600000, float(k[7]) if k[7] else 0, 0, "0", "0", "0"])
        result.reverse()
        return result

    async def get_ticker_24hr(self, symbol: str) -> dict:
        data = await self._get("/api/v5/market/ticker", {"instId": _to_okx(symbol)})
        t = data["data"][0]
        last = float(t.get("last", 0))
        op = float(t.get("open24h", last))
        return {
            "symbol": symbol.upper(),
            "lastPrice": str(last),
            "bidPrice": t.get("bidPx", "0"),
            "askPrice": t.get("askPx", "0"),
            "priceChangePercent": str((last - op) / max(op, 1) * 100),
            "volume": t.get("vol24h", "0"),
            "highPrice": t.get("high24h", "0"),
            "lowPrice": t.get("low24h", "0"),
        }

    async def get_depth(self, symbol: str, limit: int = 20) -> dict:
        data = await self._get("/api/v5/market/books", {"instId": _to_okx(symbol), "sz": str(min(limit, 400))})
        book = data["data"][0]
        return {"bids": [[b[0], b[1]] for b in book["bids"]], "asks": [[a[0], a[1]] for a in book["asks"]]}

    async def get_all_tickers(self) -> list:
        data = await self._get("/api/v5/market/tickers", {"instType": "SPOT"})
        return [{"symbol": _from_okx(t["instId"]), "price": t.get("last", "0")} for t in data["data"]]

    # ── WebSocket ───────────────────────────────────────

    async def subscribe(self, stream: str, callback: Callable):
        self._callbacks.setdefault(stream, []).append(callback)

    async def _ws_loop(self):
        import websockets
        uri = self.WS_URL
        delay = 1.0
        while self._running:
            try:
                async with websockets.connect(uri, ping_interval=20, ssl=_INSECURE_SSL) as ws:
                    delay = 1.0
                    # Build subscription args from registered callbacks
                    seen = set()
                    args = []
                    for stream in self._callbacks:
                        parts = stream.split("@", 1)
                        sym = _to_okx(parts[0].upper())
                        ch = {"ticker": "tickers", "depth20@100ms": "books"}.get(parts[1], parts[1])
                        key = f"{ch}:{sym}"
                        if key not in seen:
                            seen.add(key)
                            args.append({"channel": ch, "instId": sym})
                    if args:
                        await ws.send(json.dumps({"op": "subscribe", "args": args}))

                    async for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("event") == "subscribe":
                            continue
                        arg = msg.get("arg", {})
                        ch = arg.get("channel", "")
                        inst_id = arg.get("instId", "")
                        sym = _from_okx(inst_id)
                        data = msg.get("data", [])

                        if ch == "tickers" and data:
                            d = data[0]
                            last = float(d.get("last", 0))
                            self.prices[sym] = last
                            self.bids[sym] = float(d.get("bidPx", 0))
                            self.asks[sym] = float(d.get("askPx", 0))
                            ticker_msg = {
                                "s": sym, "c": d.get("last", "0"),
                                "b": d.get("bidPx", "0"), "a": d.get("askPx", "0"),
                                "P": "0", "v": d.get("vol24h", "0"),
                                "h": d.get("high24h", "0"), "l": d.get("low24h", "0"),
                            }
                            for cb in self._callbacks.get(f"{sym.lower()}@ticker", []):
                                try:
                                    await cb(ticker_msg)
                                except Exception:
                                    pass
                        elif ch == "books" and data:
                            d = data[0]
                            if d.get("bids"):
                                self.bids[sym] = float(d["bids"][0][0])
                            if d.get("asks"):
                                self.asks[sym] = float(d["asks"][0][0])
                            depth_msg = {"s": sym, "bids": d.get("bids", []), "asks": d.get("asks", [])}
                            for cb in self._callbacks.get(f"{sym.lower()}@depth20@100ms", []):
                                try:
                                    await cb(depth_msg)
                                except Exception:
                                    pass
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("OKX WS: %s, retry %.1fs", e, delay)
                if self._running:
                    await asyncio.sleep(delay)
                    delay = min(delay * 1.5, 10)

    # ── Start / Stop ────────────────────────────────────

    async def start(self, symbols: Optional[list[str]] = None):
        self._running = True
        symbols = symbols or ["BTCUSDT", "ETHUSDT"]
        for sym in symbols:
            s = sym.lower()
            await self.subscribe(f"{s}@ticker", lambda _: None)
            await self.subscribe(f"{s}@depth20@100ms", lambda _: None)
        self._ws_task = asyncio.create_task(self._ws_loop())
        logger.info("OKX client started: %d symbols", len(symbols))

    async def stop(self):
        self._running = False
        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._http and not self._http.is_closed:
            await self._http.aclose()
