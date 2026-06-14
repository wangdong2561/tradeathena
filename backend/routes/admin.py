"""Admin routes — user management, balance modification."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..app_state import get_app_state
from ..auth_deps import require_admin
from ..database import async_session
from ..models import User

logger = logging.getLogger("toptrader")

router = APIRouter(dependencies=[Depends(require_admin)])


# ── Schemas ─────────────────────────────────────────────

class UserListItem(BaseModel):
    id: int
    username: str
    balance: float
    role: str
    created_at: str

    model_config = {"from_attributes": True}


class BalanceUpdateRequest(BaseModel):
    balance: float


# ── Routes ──────────────────────────────────────────────

@router.get("/users")
async def list_users():
    """List all users (admin only)."""
    async with async_session() as session:
        result = await session.execute(
            select(User).order_by(User.id)
        )
        users = result.scalars().all()
        return {
            "users": [
                {
                    "id": u.id,
                    "username": u.username,
                    "balance": u.balance,
                    "role": u.role,
                    "created_at": u.created_at.isoformat() if u.created_at else "",
                }
                for u in users
            ]
        }


@router.put("/users/{user_id}/balance")
async def update_balance(
    user_id: int,
    body: BalanceUpdateRequest,
    admin=Depends(require_admin),
    app_state=Depends(get_app_state),
):
    """Modify a user's balance (admin only)."""
    if body.balance < 0:
        raise HTTPException(status_code=400, detail="余额不能为负数")

    async with async_session() as session:
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="用户不存在")

        old_balance = user.balance
        user.balance = body.balance
        await session.commit()

        logger.info(
            "Admin %s changed user %s balance: %.2f → %.2f",
            admin.username, user.username, old_balance, body.balance,
        )

    # If changing current active user's balance, sync to Rust engine
    if app_state and app_state.engine:
        # Check if this user is the active one by comparing stored active_user_id
        active_id = getattr(app_state, "active_user_id", None)
        if active_id == user_id:
            app_state.engine.reset(body.balance)
            logger.info("Synced new balance to active engine")

    return {"success": True, "username": user.username, "balance": body.balance}
