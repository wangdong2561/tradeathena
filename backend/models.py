"""SQLAlchemy models — used for order/position history persistence, not hot-path state."""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, Float, String, DateTime, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .database import Base


class User(Base):
    """User account — supports multi-user, per-user balance in DB."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    balance = Column(Float, default=10000.0)
    role = Column(String, default="user")  # 'admin' | 'user'
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class OrderHistory(Base):
    """Historical record of completed/cancelled orders."""

    __tablename__ = "order_history"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, nullable=False)  # matching engine order id
    symbol = Column(String, nullable=False)
    side = Column(String, nullable=False)
    order_type = Column(String, nullable=False)
    volume = Column(Float, nullable=False)
    price = Column(Float, nullable=True)
    filled_price = Column(Float, nullable=True)
    filled_volume = Column(Float, default=0.0)
    status = Column(String, nullable=False)  # filled / cancelled
    stop_loss = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    closed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class TradeHistory(Base):
    """Historical record of closed trades (positions)."""

    __tablename__ = "trade_history"

    id = Column(Integer, primary_key=True)
    position_id = Column(Integer, nullable=False)
    symbol = Column(String, nullable=False)
    side = Column(String, nullable=False)
    volume = Column(Float, nullable=False)
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float, nullable=False)
    profit = Column(Float, nullable=False)
    open_time = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    close_time = Column(DateTime, default=lambda: datetime.now(timezone.utc))
