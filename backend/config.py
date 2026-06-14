"""Application configuration."""

import os


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./tradeathena.db")
    default_balance: float = float(os.getenv("DEFAULT_BALANCE", "10000.0"))
    max_leverage: int = int(os.getenv("MAX_LEVERAGE", "100"))
    alpha_vantage_key: str = os.getenv("ALPHA_VANTAGE_KEY", "VPTKR2Z5XYDCZZZY")
    okx_api_key: str = os.getenv("OKX_API_KEY", "68ded352-8d57-415b-a406-13ccd611c324")
    okx_secret_key: str = os.getenv("OKX_SECRET_KEY", "")
    okx_passphrase: str = os.getenv("OKX_PASSPHRASE", "")
    default_symbols: list[str] = [
        "BTCUSDT",      # Crypto
        "XAUUSD",       # Gold (OKX SWAP)
        "XAGUSD",       # Silver (OKX SWAP)
    ]


settings = Settings()
