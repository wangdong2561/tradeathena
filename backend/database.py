"""Database setup with SQLAlchemy async (for persistence only, not on hot path)."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from .config import settings

logger = logging.getLogger("toptrader")

engine = create_async_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False},
)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables on startup and seed default admin."""
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed default admin user if not exists
    import bcrypt
    async with async_session() as session:
        result = await session.execute(select(models.User).where(models.User.username == "admin"))
        admin = result.scalar_one_or_none()
        if admin is None:
            session.add(models.User(
                username="admin",
                password_hash=bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode("utf-8"),
                balance=settings.default_balance,
                role="admin",
            ))
            await session.commit()
            logger.info("Seeded admin user (admin/admin123)")
