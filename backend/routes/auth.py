"""Auth routes — register, login, current user."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from ..app_state import get_app_state
from ..auth_deps import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ..database import async_session
from ..models import User

logger = logging.getLogger("toptrader")

router = APIRouter()


# ── Schemas ─────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    balance: float
    role: str

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    token: str
    user: UserResponse


# ── Routes ─────────────────────────────────────────────-

@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, app=Depends(get_app_state)):
    """Authenticate user, return JWT token + user info.

    On login, loads user balance from DB into the Rust engine.
    """
    async with async_session() as session:
        result = await session.execute(
            select(User).where(User.username == body.username)
        )
        user = result.scalar_one_or_none()

        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误",
            )

        # Initialize Rust engine with user's balance from DB
        if app.engine:
            app.engine.reset(user.balance)
            app.active_user_id = user.id
            logger.info(
                "User %s logged in, engine balance set to %.2f",
                user.username, user.balance,
            )

        token = create_access_token({"sub": str(user.id)})
        return LoginResponse(
            token=token,
            user=UserResponse.model_validate(user),
        )


@router.post("/register", response_model=UserResponse)
async def register(body: RegisterRequest):
    """Register a new user account (public)."""
    if len(body.username) < 2 or len(body.password) < 4:
        raise HTTPException(
            status_code=400,
            detail="用户名至少2个字符，密码至少4个字符",
        )

    async with async_session() as session:
        # Check duplicate username
        result = await session.execute(
            select(User).where(User.username == body.username)
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409,
                detail="用户名已存在",
            )

        user = User(
            username=body.username,
            password_hash=hash_password(body.password),
            balance=10000.0,
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        logger.info("New user registered: %s", body.username)
        return UserResponse.model_validate(user)


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    """Get current user info."""
    return UserResponse.model_validate(user)


@router.post("/reload")
async def reload_engine(
    user: User = Depends(get_current_user),
    app=Depends(get_app_state),
):
    """Reload engine with user's DB balance (for page refresh / server restart)."""
    if app.engine:
        app.engine.reset(user.balance)
        app.active_user_id = user.id
        logger.info(
            "Engine reloaded for user %s, balance=%.2f",
            user.username, user.balance,
        )
    return {"success": True, "balance": user.balance}
