"""FastAPI dependency injection — provides access to shared application state.

All hot-path state lives in the Rust MatchingEngine (memory).
Python layer holds config, services, and WS manager.
"""

from fastapi import Request

from .config import settings


class AppState:
    """Holds references to all shared services."""

    def __init__(self):
        self.config = settings
        self.binance = None          # Primary data source (BinanceClient or OkxClient)
        self.backup_binance = None   # Backup data source (only if both are reachable)
        self.market_service = None   # MarketService (crypto)
        self.gold_client = None      # GoldClient (XAUUSD, XAGUSD)
        self.engine = None           # Rust MatchingEngine
        self.ws_manager = None       # WSManager
        self.active_user_id: int | None = None  # Currently logged-in user ID

    def get_tick(self, symbol: str):
        """Get latest tick from any data source."""
        sym = symbol.upper()
        # Check gold client first (has XAU/XAG prices)
        if self.gold_client:
            t = self.gold_client.get_tick(sym)
            if t and t.get("last", 0):
                return t
        # Fall back to market service (crypto)
        if self.market_service:
            t = self.market_service.get_tick(sym)
            if t:
                d = t.to_dict() if hasattr(t, 'to_dict') else t
                if d.get("last", 0):
                    return d
        return None

    def all_ticks(self) -> list:
        """Get all ticks from all data sources (deduplicated)."""
        seen = set()
        result = []
        def add(tick):
            tick = tick.to_dict() if hasattr(tick, 'to_dict') else tick
            if tick["symbol"] not in seen:
                seen.add(tick["symbol"])
                result.append(tick)
        if self.market_service:
            for t in self.market_service.all_ticks():
                add(t)
        if self.gold_client:
            for t in self.gold_client.all_ticks():
                add(t)
        return result


def get_app_state(request: Request) -> AppState:
    return request.app.state.app_state
