"""Application configuration."""

import os


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./toptrader.db")
    default_balance: float = float(os.getenv("DEFAULT_BALANCE", "10000.0"))
    max_leverage: int = int(os.getenv("MAX_LEVERAGE", "100"))
    default_symbols: list[str] = [
        "BTCUSDT",      # Crypto (Binance)
        "XAUUSD",       # Gold (gold-api.com)
        "XAGUSD",       # Silver (gold-api.com)
    ]


settings = Settings()
