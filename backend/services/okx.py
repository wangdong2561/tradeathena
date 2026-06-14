"""OKX REST + WebSocket client — crypto market data accessible from mainland China."""

import asyncio
import json
import logging
from typing import Any, Callable, Optional

import httpx
import websockets

logger = logging.getLogger(__name__)

# Symbol mapping: BTCUSDT → BTC-USDT
def _to_okx(symbol: str) -> str:
    """Convert internal symbol (BTCUSDT) to OKX format (BTC-USDT)."""
    s = symbol.upper()
    # Known mappings
    mapping = {
        "BTCUSDT": "BTC-USDT",
        "ETHUSDT": "ETH-USDT",
        "SOLUSDT": "SOL-USDT",
        "BNBUSDT": "BNB-USDT",
        "DOGEUSDT": "DOGE-USDT",
        "XRPUSDT": "XRP-USDT",
    }
    if s in mapping:
        return mapping[s]
    # Generic: find the quote currency (USDT, USD, USDC)
    for quote in ["USDT", "USDC", "USD", "BTC"]:
        if s.endswith(quote) and len(s) > len(quote):
            return f"{s[:-len(quote)]}-{quote}"
    return s


def _from_okx(inst_id: str) -> str:
    """Convert OKX format (BTC-USDT) to internal format (BTCUSDT)."""
    return inst_id.replace("-", "").upper()


# Map internal intervals to OKX bar format
_INTERVAL_MAP = {
    "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1H", "2h": "2H", "4h": "4H",
    "6h": "6H", "12h": "12H", "1d": "1D", "1w": "1W",
}

# Stream name → OKX channel
_STREAM_TO_CHANNEL: dict[str, str] = {
    "@ticker": "tickers",
    "@depth20@100ms": "books",
}


class OkxClient:
    """OKX API client — REST + WebSocket, no API key required for public data.

    Duck-type compatible with BinanceClient for drop-in replacement.
    Uses symbol format BTCUSDT internally, converts to BTC-USDT for OKX API.
    """

    REST_URL = "https://www.okx.com"
    WS_URL = "wss://ws.okx.com:8443/ws/v5/public"

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._ws_task: Optional[asyncio.Task] = None
        # Price cache (same keys as BinanceClient for compatibility)
        self.prices: dict[str, float] = {}
        self.bids: dict[str, float] = {}
        self.asks: dict[str, float] = {}
        # Subscription management
        self._callbacks: dict[str, list[Callable]] = {}  # stream_name -> [cb]
        self._channels: set[str] = set()  # subscribed OKX channels
        self._running = False

    # ── HTTP helpers ────────────────────────────────────

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=self.REST_URL,
                timeout=httpx.Timeout(10.0),
            )
        return self._http

    async def _get(self, path: str, params: dict = {}) -> dict:
        client = await self._get_http()
        resp = await client.get(path, params=params)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "0":
            raise Exception(f"OKX API error: {data.get('msg', 'unknown')}")
        return data

    # ── REST endpoints ──────────────────────────────────

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 200) -> list:
        """Get kline data, returns in Binance-compatible format."""
        okx_sym = _to_okx(symbol)
        bar = _INTERVAL_MAP.get(interval, "1H")
        data = await self._get("/api/v5/market/candles", {
            "instId": okx_sym,
            "bar": bar,
            "limit": str(min(limit, 300)),
        })
        raw = data.get("data", [])
        # Convert OKX format to Binance-compatible format
        # OKX: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
        # Binance: [time, open, high, low, close, volume, closeTime, quoteVol, trades, ...]
        result = []
        for k in raw:
            ts = int(k[0])
            result.append([
                ts,                          # time
                float(k[1]),                 # open
                float(k[2]),                 # high
                float(k[3]),                 # low
                float(k[4]),                 # close
                float(k[5]),                 # volume
                ts + 3600_000,               # closeTime (approximate)
                float(k[7]) if k[7] else 0,  # quote volume
                0, "0", "0", "0",            # padding
            ])
        # OKX returns descending; reverse to ascending
        result.reverse()
        return result

    async def get_ticker_24hr(self, symbol: str) -> dict:
        """Get 24hr ticker, returns dict with Binance-compatible keys."""
        okx_sym = _to_okx(symbol)
        data = await self._get("/api/v5/market/ticker", {"instId": okx_sym})
        items = data.get("data", [])
        if not items:
            return {"symbol": symbol, "lastPrice": "0", "bidPrice": "0", "askPrice": "0",
                    "priceChangePercent": "0", "volume": "0", "highPrice": "0", "lowPrice": "0"}
        t = items[0]
        return {
            "symbol": symbol,
            "lastPrice": t.get("last", "0"),
            "bidPrice": t.get("bidPx", "0"),
            "askPrice": t.get("askPx", "0"),
            "priceChangePercent": str((float(t.get("last", 0)) - float(t.get("open24h", 0))) / max(float(t.get("open24h", 1)), 1) * 100),
            "volume": t.get("vol24h", "0"),
            "highPrice": t.get("high24h", "0"),
            "lowPrice": t.get("low24h", "0"),
        }

    async def get_depth(self, symbol: str, limit: int = 20) -> dict:
        """Get order book depth, returns in Binance-compatible format."""
        okx_sym = _to_okx(symbol)
        data = await self._get("/api/v5/market/books", {
            "instId": okx_sym,
            "sz": str(min(limit, 400)),
        })
        items = data.get("data", [])
        if not items:
            return {"bids": [], "asks": []}
        book = items[0]
        return {
            "bids": [[b[0], b[1]] for b in book.get("bids", [])],
            "asks": [[a[0], a[1]] for a in book.get("asks", [])],
        }

    async def get_all_tickers(self) -> list[dict]:
        """Get all SPOT tickers."""
        data = await self._get("/api/v5/market/tickers", {"instType": "SPOT"})
        return [
            {"symbol": _from_okx(t["instId"]), "price": t.get("last", "0")}
            for t in data.get("data", [])
        ]

    # ── WebSocket ───────────────────────────────────────

    async def subscribe(self, stream: str, callback: Callable):
        """Register a callback for a stream (e.g. 'BTCUSDT@ticker').

        Streams are mapped to OKX channels on connect.
        """
        self._callbacks.setdefault(stream, []).append(callback)

    def _stream_to_channel(self, stream: str) -> tuple[str, str]:
        """Convert stream name to (channel, instId)."""
        parts = stream.split("@", 1)
        sym = parts[0].upper()
        suffix = f"@{parts[1]}" if len(parts) > 1 else ""
        okx_sym = _to_okx(sym)
        channel = _STREAM_TO_CHANNEL.get(suffix, suffix.lstrip("@"))
        return channel, okx_sym

    def _channel_key(self, channel: str, inst_id: str) -> str:
        return f"{channel}:{inst_id}"

    async def _build_subscribe_args(self) -> list[dict]:
        """Build OKX subscription args from registered callbacks."""
        seen: set[str] = set()
        args = []
        for stream in self._callbacks:
            channel, inst_id = self._stream_to_channel(stream)
            key = self._channel_key(channel, inst_id)
            if key not in seen:
                seen.add(key)
                args.append({"channel": channel, "instId": inst_id})
        return args

    async def _ws_loop(self):
        """Single WebSocket connection — handles all channels."""
        uri = self.WS_URL
        delay = 1.0
        while self._running:
            try:
                async with websockets.connect(uri, ping_interval=20) as ws:
                    self._ws = ws
                    delay = 1.0
                    logger.info("OKX WebSocket connected")

                    # Subscribe to all channels
                    args = await self._build_subscribe_args()
                    if args:
                        sub_msg = json.dumps({"op": "subscribe", "args": args})
                        await ws.send(sub_msg)
                        logger.info("OKX subscribed to %d channels", len(args))

                    # Read loop
                    async for raw in ws:
                        msg = json.loads(raw)
                        event = msg.get("event")
                        if event == "subscribe":
                            continue  # subscription confirmation

                        data = msg.get("data", [])
                        arg = msg.get("arg", {})
                        channel = arg.get("channel", "")
                        inst_id = arg.get("instId", "")

                        if channel == "tickers" and data:
                            await self._on_ticker(data[0], inst_id)
                        elif channel == "books" and data:
                            await self._on_depth(data[0], inst_id)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("OKX WS error: %s, retry in %.1fs", e, delay)
                if self._running:
                    await asyncio.sleep(delay)
                    delay = min(delay * 1.5, 10)

    async def _on_ticker(self, data: dict, inst_id: str):
        """Process ticker update and dispatch callbacks."""
        sym = _from_okx(inst_id)
        last = float(data.get("last", 0))
        bid = float(data.get("bidPx", 0))
        ask = float(data.get("askPx", 0))
        self.prices[sym] = last
        self.bids[sym] = bid
        self.asks[sym] = ask

        # Build Binance-compatible ticker message
        msg = {
            "s": sym,
            "c": data.get("last", "0"),
            "b": data.get("bidPx", "0"),
            "a": data.get("askPx", "0"),
            "P": str((last - float(data.get("open24h", last))) / max(float(data.get("open24h", last)), 1) * 100),
            "v": data.get("vol24h", "0"),
            "h": data.get("high24h", "0"),
            "l": data.get("low24h", "0"),
            "t": data.get("ts", "0"),
        }
        stream = f"{sym}@ticker"
        for cb in self._callbacks.get(stream, []):
            try:
                await cb(msg)
            except Exception:
                pass

    async def _on_depth(self, data: dict, inst_id: str):
        """Process depth update and dispatch callbacks."""
        sym = _from_okx(inst_id)
        bids = data.get("bids", [])
        asks = data.get("asks", [])
        if bids:
            self.bids[sym] = float(bids[0][0])
        if asks:
            self.asks[sym] = float(asks[0][0])

        msg = {
            "s": sym,
            "bids": [[b[0], b[1]] for b in bids],
            "asks": [[a[0], a[1]] for a in asks],
        }
        stream = f"{sym}@depth20@100ms"
        for cb in self._callbacks.get(stream, []):
            try:
                await cb(msg)
            except Exception:
                pass

    # ── Start / Stop ────────────────────────────────────

    async def start(self, symbols: Optional[list[str]] = None):
        """Start WebSocket connection and subscribe to ticker + depth for symbols."""
        self._running = True
        symbols = symbols or ["BTCUSDT", "ETHUSDT"]
        for sym in symbols:
            s_lower = sym.lower()
            await self.subscribe(f"{s_lower}@ticker", lambda _: None)
            await self.subscribe(f"{s_lower}@depth20@100ms", lambda _: None)

        self._ws_task = asyncio.create_task(self._ws_loop())
        logger.info("OKX client started: %d symbols", len(symbols))

    async def stop(self):
        """Stop WebSocket and close HTTP client."""
        self._running = False
        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except (asyncio.CancelledError, Exception):
                pass
            self._ws_task = None
        self._ws = None
        if self._http and not self._http.is_closed:
            await self._http.aclose()
