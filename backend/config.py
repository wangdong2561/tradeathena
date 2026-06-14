"""Application configuration."""

import os
from pathlib import Path

from dotenv import load_dotenv

# 从项目根目录加载 .env 文件（仅本地，不提交到 git）
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./tradeathena.db")
    default_balance: float = float(os.getenv("DEFAULT_BALANCE", "10000.0"))
    max_leverage: int = int(os.getenv("MAX_LEVERAGE", "100"))
    alpha_vantage_key: str = os.getenv("ALPHA_VANTAGE_KEY", "")
    okx_api_key: str = os.getenv("OKX_API_KEY", "")
    okx_secret_key: str = os.getenv("OKX_SECRET_KEY", "")
    okx_passphrase: str = os.getenv("OKX_PASSPHRASE", "")
    default_symbols: list[str] = [
        "BTCUSDT",      # Crypto
        "XAUUSD",       # Gold (OKX SWAP)
        "XAGUSD",       # Silver (OKX SWAP)
    ]


settings = Settings()
