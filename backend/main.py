"""TradeAthena — FastAPI async web server.

Architecture:
  Rust MatchingEngine (PyO3) ← → Python FastAPI ← WebSocket → React Frontend
                                   ↕
                          Binance API / Market Simulator
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("toptrader")

from sqlalchemy import select

from .app_state import AppState
from .config import settings
from .database import async_session, init_db


def _create_engine():
    """Create Rust MatchingEngine instance."""
    try:
        import toptrader_core
        engine = toptrader_core.MatchingEngine(settings.default_balance, settings.max_leverage)
        logger.info("Rust MatchingEngine initialized")
        return engine
    except ImportError as e:
        logger.warning("Rust core unavailable (%s). Using Python fallback.", e)
        return _create_py_fallback()


def _create_py_fallback():
    """Minimal Python fallback engine for dev without Rust build."""
    class _PyEngine:
        def __init__(self, balance, leverage):
            self._balance = balance
            self._leverage = leverage

        def place_order(self, symbol, side, order_type, volume, price=0, stop_price=0, sl=0, tp=0, bid=0, ask=0):
            fp = ask if side == "buy" else bid
            filled = fp > 0 and order_type == "market"
            return {"order_id": 1, "filled": filled, "fill_price": fp if filled else 0,
                    "fill_volume": volume if filled else 0, "message": "Filled (py)" if filled else "Pending (py)"}

        def on_tick(self, symbol, bid, ask, last):
            return []
        def get_account(self):
            return {"id": 1, "balance": self._balance, "equity": self._balance, "margin": 0,
                    "free_margin": self._balance, "margin_level": 0, "leverage": self._leverage}
        def get_positions(self): return []
        def get_pending_orders(self): return []
        def cancel_order(self, _id): return True
        def modify_position(self, _id, sl, tp): return True
        def close_position(self, _id, bid, ask, last): return True
        def reset(self, balance): self._balance = balance
        def restore_state(self, _positions, _orders, _balance): pass
    return _PyEngine(settings.default_balance, settings.max_leverage)


def _enrich_account(state) -> dict:
    """Add derived fields to raw engine account data."""
    acc = state.engine.get_account()
    positions = state.engine.get_positions()
    total_pl = sum(p["unrealized_pl"] for p in positions)
    acc["open_positions"] = len(positions)
    acc["total_unrealized_pl"] = round(total_pl, 2)
    return acc


async def _check_mode() -> tuple[str, str | None]:
    """Check reachable data source: BINANCE > OKX > SIMULATOR (parallel)."""
    import httpx

    async def _try(url: str, check: callable) -> bool:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0), verify=False) as c:
                r = await c.get(url)
                return check(r)
        except Exception:
            return False

    results = await asyncio.gather(
        _try("https://api.binance.com/api/v3/ping", lambda r: r.status_code == 200),
        _try("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT",
             lambda r: r.status_code == 200 and r.json().get("code") == "0"),
    )
    if results[0]:
        return "BINANCE", ("OKX" if results[1] else None)
    if results[1]:
        return "OKX", None
    return "SIMULATOR", None


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = AppState()
    state.engine = _create_engine()
    state.app = app

    primary, backup = await _check_mode()
    logger.info("Data source: %s%s", primary, f" + backup({backup})" if backup else "")

    _ws = None
    if primary == "BINANCE":
        from .services.binance import BinanceClient
        state.binance = BinanceClient()
        if backup == "OKX":
            from .services.okx import OkxClient
            state.backup_binance = OkxClient()
    elif primary == "OKX":
        from .services.okx import OkxClient
        state.binance = OkxClient()
        if backup == "BINANCE":
            from .services.binance import BinanceClient
            state.backup_binance = BinanceClient()
    else:
        from .services.simulator import MarketSimulator, SimulatedBinanceClient
        sim = MarketSimulator()
        state.market_service = sim
        state.binance = SimulatedBinanceClient(sim)

    from .ws.manager import WSManager
    state.ws_manager = WSManager()

    # Create MarketService for real data sources (not simulator)
    if primary in ("BINANCE", "OKX"):
        from .services.market import MarketService
        state.market_service = MarketService(state.binance)

    # Gold client only in BINANCE mode (OKX has XAU/XAG via WebSocket swaps)
    if primary == "BINANCE":
        try:
            from .services.gold_client import GoldClient
            state.gold_client = GoldClient()
        except Exception as e:
            logger.warning("Gold init failed: %s", e)
    else:
        state.gold_client = None

    # Register ticker → Rust engine callback
    async def on_ticker(tick: dict):
        sym = tick["symbol"]
        sym_u = sym.upper()
        # Snapshot positions before tick (for detecting SL/TP closes)
        before = {p["id"]: p for p in state.engine.get_positions() if p["symbol"] == sym_u}

        filled = state.engine.on_tick(sym, tick.get("bid", 0), tick.get("ask", 0), tick.get("last", 0))

        if filled:
            # Detect positions closed by SL/TP and save to history
            after_ids = {p["id"] for p in state.engine.get_positions()}
            for pid in filled:
                if pid in before and pid not in after_ids:
                    pos = before[pid]
                    cp = tick.get("bid", 0) if pos["side"] == "buy" else tick.get("ask", 0)
                    profit = (cp - pos["entry_price"]) * pos["volume"]
                    if pos["side"] == "sell":
                        profit = (pos["entry_price"] - cp) * pos["volume"]
                    # Offload DB write
                    async def _save(p=pos, cp=cp, pl=profit):
                        from .database import async_session
                        from .models import TradeHistory, ActivePosition
                        from sqlalchemy import delete
                        async with async_session() as s:
                            s.add(TradeHistory(
                                position_id=p["id"], symbol=p["symbol"], side=p["side"],
                                volume=p["volume"], entry_price=p["entry_price"],
                                exit_price=cp, profit=pl,
                            ))
                            await s.execute(delete(ActivePosition).where(ActivePosition.position_id == p["id"]))
                            await s.commit()
                    asyncio.create_task(_save())

            acc = _enrich_account(state)
            await state.ws_manager.broadcast_account_update(acc)
        await state.ws_manager.broadcast_ticker(tick)

    # Register kline → WebSocket broadcast
    async def on_kline(kline: dict):
        await state.ws_manager.broadcast("market", {"type": "kline", "data": kline})

    state.market_service.on_ticker(on_ticker)
    state.market_service.on_kline(on_kline)

    # Also register gold/silver ticker callbacks
    if state.gold_client:
        state.gold_client.on_ticker(on_ticker)

    # Start data sources
    await init_db()

    # Restore positions and pending orders from DB (survives restart)
    try:
        from .models import ActivePosition, PendingOrderStore
        from datetime import datetime
        async with async_session() as session:
            # Load active positions
            pos_result = await session.execute(
                select(ActivePosition).order_by(ActivePosition.id)
            )
            db_positions = pos_result.scalars().all()

            # Load pending orders
            ord_result = await session.execute(
                select(PendingOrderStore).order_by(PendingOrderStore.id)
            )
            db_orders = ord_result.scalars().all()

        if db_positions or db_orders:
            positions_data = [{
                "id": p.position_id, "symbol": p.symbol, "side": p.side,
                "volume": p.volume, "entry_price": p.entry_price,
                "current_price": p.current_price, "stop_loss": p.stop_loss,
                "take_profit": p.take_profit,
                "created_at": int(p.created_at.timestamp()) if p.created_at else 0,
            } for p in db_positions]

            orders_data = [{
                "id": o.order_id, "symbol": o.symbol, "side": o.side,
                "order_type": o.order_type, "volume": o.volume,
                "price": o.price, "stop_price": o.stop_price,
                "stop_loss": o.stop_loss, "take_profit": o.take_profit,
                "created_at": int(o.created_at.timestamp()) if o.created_at else 0,
            } for o in db_orders]

            state.engine.restore_state(positions_data, orders_data, 0)
            logger.info(
                "Restored %d positions, %d pending orders from DB",
                len(db_positions), len(db_orders),
            )
    except Exception as e:
        logger.warning("State restore skipped: %s", e)

    await state.binance.start(settings.default_symbols)
    await state.market_service.start(settings.default_symbols)
    if state.gold_client:
        await state.gold_client.start()

    app.state.app_state = state
    logger.info("═══ TradeAthena ready [%s] ═══", primary)
    yield

    await state.market_service.stop()
    await state.binance.stop()
    logger.info("TradeAthena stopped")


app = FastAPI(title="TradeAthena", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .routes import market, orders, account, positions, auth, admin
app.include_router(market.router, prefix="/api/v1/market", tags=["market"])
app.include_router(orders.router, prefix="/api/v1/orders", tags=["orders"])
app.include_router(account.router, prefix="/api/v1/account", tags=["account"])
app.include_router(positions.router, prefix="/api/v1/positions", tags=["positions"])
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])


# ── WebSocket ──────────────────────────────────────────

@app.websocket("/ws/market")
async def ws_market(ws: WebSocket):
    state = app.state.app_state
    await state.ws_manager.connect(ws, "market")
    try:
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, Exception):
        await state.ws_manager.disconnect(ws, "market")


@app.websocket("/ws/orders")
async def ws_orders(ws: WebSocket):
    state = app.state.app_state
    await state.ws_manager.connect(ws, "orders")
    try:
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, Exception):
        await state.ws_manager.disconnect(ws, "orders")


# ── Serve frontend (production) ────────────────────────
# 开发时使用 http://localhost:5173/ (Vite dev server, 热更新)
# 生产构建: cd frontend && npm run build （取消注释下行）
# import os
# _frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
# if os.path.isdir(_frontend_dir):
#     app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
