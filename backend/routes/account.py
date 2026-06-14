"""Account routes — info, history, reset."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func

from ..app_state import get_app_state
from ..database import async_session
from ..models import TradeHistory, User

router = APIRouter()


@router.get("")
async def get_account(app=Depends(get_app_state)):
    """Get account summary (from Rust engine, in-memory)."""
    acc = app.engine.get_account()
    positions = app.engine.get_positions()
    total_unrealized_pl = sum(p["unrealized_pl"] for p in positions)
    return {
        **acc,
        "open_positions": len(positions),
        "total_unrealized_pl": round(total_unrealized_pl, 2),
    }


@router.get("/history")
async def get_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Get trade history from database."""
    async with async_session() as session:
        total = await session.scalar(select(func.count(TradeHistory.id)))
        result = await session.execute(
            select(TradeHistory)
            .order_by(TradeHistory.close_time.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        trades = result.scalars().all()
        return {
            "trades": [
                {
                    "id": t.id,
                    "symbol": t.symbol,
                    "side": t.side,
                    "volume": t.volume,
                    "entry_price": t.entry_price,
                    "exit_price": t.exit_price,
                    "profit": t.profit,
                    "open_time": t.open_time.isoformat(),
                    "close_time": t.close_time.isoformat(),
                }
                for t in trades
            ],
            "total": total or 0,
            "page": page,
            "page_size": page_size,
        }


@router.post("/reset")
async def reset_account(app=Depends(get_app_state)):
    """Reset account to initial balance (clears all positions and orders)."""
    # Reset engine balance
    app.engine.reset(app.config.default_balance)
    # Persist to DB for active user
    active_id = getattr(app, "active_user_id", None)
    if active_id:
        async with async_session() as session:
            user = await session.get(User, active_id)
            if user:
                user.balance = app.config.default_balance
                await session.commit()
    acc = app.engine.get_account()
    return {"success": True, "account": acc}
