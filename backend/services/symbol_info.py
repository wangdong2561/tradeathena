"""Symbol information — trading hours, specs, descriptions (Beijing time)."""

SYMBOL_INFO = {
    "BTCUSDT": {
        "name": "BTC/USDT",
        "full_name": "Bitcoin / Tether",
        "type": "加密货币",
        "exchange": "Binance",
        "trading_hours": "24小时 × 7天",
        "trading_hours_cn": "全天候不间断交易",
        "leverage_max": 100,
        "lot_min": 0.001,
        "lot_step": 0.001,
        "description": "比特币兑USDT。全球市值最大的加密货币，全天24小时不间断交易。",
    },
    "XAUUSD": {
        "name": "XAU/USD",
        "full_name": "Gold / US Dollar",
        "type": "贵金属",
        "exchange": "COMEX",
        "trading_hours": "周一 06:00 — 周六 05:00 (夏令时)\n周一 07:00 — 周六 06:00 (冬令时)",
        "trading_hours_cn": "每日05:00-06:00休市(夏令时) / 06:00-07:00休市(冬令时)",
        "leverage_max": 50,
        "lot_min": 0.01,
        "lot_step": 0.01,
        "description": "黄金兑美元。COMEX期货黄金，全球最主要的黄金定价基准。",
    },
    "XAGUSD": {
        "name": "XAG/USD",
        "full_name": "Silver / US Dollar",
        "type": "贵金属",
        "exchange": "COMEX",
        "trading_hours": "周一 06:00 — 周六 05:00 (夏令时)\n周一 07:00 — 周六 06:00 (冬令时)",
        "trading_hours_cn": "每日05:00-06:00休市(夏令时) / 06:00-07:00休市(冬令时)",
        "leverage_max": 50,
        "lot_min": 0.01,
        "lot_step": 0.01,
        "description": "白银兑美元。COMEX期货白银，兼具工业与避险属性。",
    },
}


def get_symbol_info(symbol: str) -> dict | None:
    """Get info for a symbol, or None if not found."""
    return SYMBOL_INFO.get(symbol.upper())


def all_symbol_info() -> dict:
    return SYMBOL_INFO
