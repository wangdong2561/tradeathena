"""Market data routes — klines, ticker, depth, symbols."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..app_state import get_app_state

router = APIRouter()


class SubscribeKlineRequest(BaseModel):
    symbol: str = Field(..., description="e.g. BTCUSDT")
    interval: str = Field("1h", description="1m/5m/15m/1h/4h/1d")


@router.post("/subscribe-kline")
async def subscribe_kline(req: SubscribeKlineRequest, app=Depends(get_app_state)):
    """Switch real-time kline subscription for a symbol."""
    await app.market_service.subscribe_kline(req.symbol.upper(), req.interval)
    return {"success": True, "symbol": req.symbol.upper(), "interval": req.interval}


@router.get("/klines")
async def get_klines(
    symbol: str = Query("BTCUSDT"),
    interval: str = Query("1h"),
    limit: int = Query(500),
    app=Depends(get_app_state),
):
    """Get historical kline/candlestick data.

    Crypto pairs → Binance API (real data)
    Forex/commodities → Alpha Vantage-based (real base price + realistic ticks)
    """
    sym = symbol.upper()
    if app.gold_client and sym in ["XAUUSD", "XAGUSD"]:
        data = await app.gold_client.get_klines(sym, interval, limit)
    else:
        try:
            data = await app.binance.get_klines(sym, interval, limit)
        except Exception:
            if app.backup_binance:
                data = await app.backup_binance.get_klines(sym, interval, limit)
            else:
                raise
    return {"symbol": sym, "interval": interval, "data": data}


@router.get("/ticker/{symbol}")
async def get_ticker(symbol: str, app=Depends(get_app_state)):
    """Get 24hr ticker for a symbol."""
    tick = app.get_tick(symbol)
    if tick:
        return tick
    # Fall back to primary REST, then backup
    try:
        data = await app.binance.get_ticker_24hr(symbol)
    except Exception:
        if app.backup_binance:
            data = await app.backup_binance.get_ticker_24hr(symbol)
        else:
            return {"symbol": symbol.upper(), "last": 0, "bid": 0, "ask": 0, "change_24h": 0, "volume_24h": 0, "high_24h": 0, "low_24h": 0}
    return {
        "symbol": symbol.upper(),
        "last": float(data.get("lastPrice", 0)),
        "bid": float(data.get("bidPrice", 0)),
        "ask": float(data.get("askPrice", 0)),
        "change_24h": float(data.get("priceChangePercent", 0)),
        "volume_24h": float(data.get("volume", 0)),
        "high_24h": float(data.get("highPrice", 0)),
        "low_24h": float(data.get("lowPrice", 0)),
    }


@router.get("/depth/{symbol}")
async def get_depth(symbol: str, limit: int = Query(20), app=Depends(get_app_state)):
    """Get order book depth."""
    data = await app.binance.get_depth(symbol, limit)
    return {"symbol": symbol.upper(), "bids": data.get("bids", []), "asks": data.get("asks", [])}


@router.get("/symbols")
async def get_symbols(app=Depends(get_app_state)):
    """Get list of available trading symbols with current prices."""
    return {"symbols": app.all_ticks() or [{"symbol": s, "bid": 0, "ask": 0, "last": 0, "change_24h": 0} for s in app.config.default_symbols]}


@router.get("/news")
async def get_news():
    """Get top financial news from free RSS feeds."""
    from ..services.news import get_news as fetch_news
    news = await fetch_news()
    return {"news": news}


@router.get("/symbol-info/{symbol}")
async def get_symbol_info(symbol: str):
    """Get trading hours and description for a symbol."""
    from ..services.symbol_info import get_symbol_info
    info = get_symbol_info(symbol.upper())
    if not info:
        return {"symbol": symbol.upper(), "error": "Unknown symbol"}
    return info
