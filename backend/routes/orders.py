"""Order routes — place, cancel, modify orders."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..app_state import get_app_state
from ..database import async_session
from ..models import OrderHistory

router = APIRouter()


class PlaceOrderRequest(BaseModel):
    symbol: str = Field(..., description="Trading symbol, e.g. BTCUSDT")
    side: str = Field(..., pattern="^(buy|sell)$")
    order_type: str = Field(..., pattern="^(market|limit|stop)$")
    volume: float = Field(..., gt=0)
    price: float = Field(0, ge=0)
    stop_price: float = Field(0, ge=0)
    stop_loss: float = Field(0, ge=0)
    take_profit: float = Field(0, ge=0)


class ModifyOrderRequest(BaseModel):
    stop_loss: float = Field(0, ge=0)
    take_profit: float = Field(0, ge=0)


@router.post("")
async def place_order(req: PlaceOrderRequest, app=Depends(get_app_state)):
    """Place an order via the Rust matching engine."""
    sym = req.symbol.upper()
    tick = app.get_tick(sym)
    bid = tick.get("bid", 0) if tick else 0.0
    ask = tick.get("ask", 0) if tick else 0.0

    result = app.engine.place_order(
        sym, req.side, req.order_type, req.volume,
        req.price, req.stop_price,
        req.stop_loss, req.take_profit,
        bid, ask,
    )

    # Async persist to history
    if result["filled"] or result["order_id"] > 0:
        async with async_session() as session:
            session.add(OrderHistory(
                order_id=result["order_id"],
                symbol=sym,
                side=req.side,
                order_type=req.order_type,
                volume=req.volume,
                price=req.price if req.price > 0 else None,
                filled_price=result["fill_price"] if result["filled"] else None,
                filled_volume=result["fill_volume"] if result["filled"] else 0.0,
                status="filled" if result["filled"] else "pending",
                stop_loss=req.stop_loss if req.stop_loss > 0 else None,
                take_profit=req.take_profit if req.take_profit > 0 else None,
            ))
            await session.commit()

    # Broadcast
    await app.ws_manager.broadcast_order_update(result)
    acc = app.engine.get_account()
    positions = app.engine.get_positions()
    acc["open_positions"] = len(positions)
    acc["total_unrealized_pl"] = round(sum(p["unrealized_pl"] for p in positions), 2)
    await app.ws_manager.broadcast_account_update(acc)

    result["side"] = req.side
    return result


@router.delete("/{order_id}")
async def cancel_order(order_id: int, app=Depends(get_app_state)):
    """Cancel a pending order."""
    ok = app.engine.cancel_order(order_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Order not found or already filled")
    await app.ws_manager.broadcast_order_update({"action": "cancelled", "order_id": order_id})
    return {"success": True, "order_id": order_id}


@router.get("/pending")
async def get_pending_orders(app=Depends(get_app_state)):
    """Get all pending orders."""
    orders = app.engine.get_pending_orders()
    return {"orders": orders}


@router.put("/{order_id}")
async def modify_order(order_id: int, req: ModifyOrderRequest, app=Depends(get_app_state)):
    """Modify order (currently changes SL/TP on the associated position)."""
    ok = app.engine.modify_position(order_id, req.stop_loss, req.take_profit)
    if not ok:
        raise HTTPException(status_code=404, detail="Position not found")
    return {"success": True, "order_id": order_id}
