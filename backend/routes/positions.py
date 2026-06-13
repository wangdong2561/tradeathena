"""Position routes — list, modify SL/TP, close."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..app_state import get_app_state
from ..database import async_session
from ..models import TradeHistory

router = APIRouter()


class ModifySLTPRequest(BaseModel):
    stop_loss: float = Field(0, ge=0)
    take_profit: float = Field(0, ge=0)


@router.get("")
async def get_positions(app=Depends(get_app_state)):
    """Get all open positions and pending orders."""
    positions = app.engine.get_positions()
    pending = app.engine.get_pending_orders()
    return {
        "positions": positions,
        "pending_orders": pending,
    }


@router.put("/{position_id}")
async def modify_position(position_id: int, req: ModifySLTPRequest, app=Depends(get_app_state)):
    """Modify stop loss and take profit on a position."""
    ok = app.engine.modify_position(position_id, req.stop_loss, req.take_profit)
    if not ok:
        raise HTTPException(status_code=404, detail="Position not found")
    await app.ws_manager.broadcast_order_update({"type": "position_modified", "position_id": position_id})
    return {"success": True}


async def _save_trade_history(engine, position_id: int):
    """Save a closed position to the database."""
    # The Rust engine has already removed the position by the time we get here,
    # so we need the position data passed in from the caller.
    pass


@router.post("/{position_id}/close")
async def close_position(position_id: int, app=Depends(get_app_state)):
    """Close a position at current market price and save to history."""
    positions = app.engine.get_positions()
    pos = next((p for p in positions if p["id"] == position_id), None)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")

    market_tick = app.get_tick(pos["symbol"])
    if market_tick:
        bid = market_tick.get("bid", 0)
        ask = market_tick.get("ask", 0)
        last = market_tick.get("last", 0)
    else:
        bid = ask = last = pos["current_price"]

    close_price = bid if pos["side"] == "buy" else ask
    profit = (close_price - pos["entry_price"]) * pos["volume"]
    if pos["side"] == "sell":
        profit = (pos["entry_price"] - close_price) * pos["volume"]

    ok = app.engine.close_position(position_id, bid, ask, last)
    if not ok:
        raise HTTPException(status_code=404, detail="Failed to close position")

    # Save to trade history
    async with async_session() as session:
        session.add(TradeHistory(
            position_id=position_id,
            symbol=pos["symbol"],
            side=pos["side"],
            volume=pos["volume"],
            entry_price=pos["entry_price"],
            exit_price=close_price,
            profit=profit,
            open_time=datetime.now(timezone.utc),
            close_time=datetime.now(timezone.utc),
        ))
        await session.commit()

    acc = app.engine.get_account()
    positions = app.engine.get_positions()
    acc["open_positions"] = len(positions)
    acc["total_unrealized_pl"] = round(sum(p["unrealized_pl"] for p in positions), 2)
    await app.ws_manager.broadcast_account_update(acc)
    return {"success": True, "profit": round(profit, 2), "exit_price": close_price, "side": pos["side"], "volume": pos["volume"]}
