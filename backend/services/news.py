"""Financial news from free APIs — real data, no fake analysis."""

import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Free Chinese financial news
CN_SOURCES = [
    "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=&num=15",
]

# Free English financial news (fallback)
EN_SOURCES = [
    "https://feeds.content.dowjones.io/public/rss/mw_topstories",
]

_cache: dict[str, Any] = {"data": [], "updated_at": 0}
_CACHE_TTL = 300  # 5 minutes


async def _fetch_sina(http: httpx.AsyncClient) -> list[dict]:
    """Parse 新浪财经 JSON API — real Chinese financial news."""
    items = []
    try:
        resp = await http.get(CN_SOURCES[0], headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if resp.status_code != 200:
            return items
        data = resp.json()
        for entry in data.get("result", {}).get("data", []):
            title = entry.get("title", "") or entry.get("Title", "")
            link = entry.get("url", "") or entry.get("Url", "") or ""
            if title:
                items.append({"title": title.strip(), "url": link, "source": "新浪财经"})
    except Exception as e:
        logger.warning("Sina fetch error: %s", e)
    return items


async def _fetch_rss(http: httpx.AsyncClient, url: str) -> list[dict]:
    """Parse RSS feed."""
    items = []
    try:
        resp = await http.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if resp.status_code != 200:
            return items
        root = ET.fromstring(resp.text)
        for entry in root.iter("item"):
            title = entry.findtext("title", "")
            link = entry.findtext("link", "")
            if title:
                items.append({"title": title.strip()[:80], "url": link.strip() or "", "source": "MarketWatch"})
    except Exception as e:
        logger.warning("RSS fetch error: %s", e)
    return items


async def get_news() -> list[dict]:
    """Fetch real financial news from free sources."""
    now = datetime.now(timezone.utc).timestamp()
    if _cache["data"] and (now - _cache["updated_at"]) < _CACHE_TTL:
        return _cache["data"]

    all_items = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as http:
        # Chinese news first
        cn = await _fetch_sina(http)
        all_items.extend(cn)
        # English fallback
        for url in EN_SOURCES:
            items = await _fetch_rss(http, url)
            all_items.extend(items)

    # Deduplicate
    seen = set()
    result = []
    for item in all_items:
        key = item["title"][:30]
        if key not in seen:
            seen.add(key)
            result.append(item)

    _cache["data"] = result[:15]
    _cache["updated_at"] = now
    logger.info("News: %d items (CN: %d)", len(result), sum(1 for x in result if x["source"] == "新浪财经"))
    return _cache["data"]
