from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import feedparser
import requests

from config import Config

cfg = Config()

NEWS_SOURCES = [
    {"name": "investing-com-rss", "url": "https://www.investing.com/rss/news.rss"},
    {"name": "marketwatch-rss", "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories"},
]


def _get(url: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    headers = {"User-Agent": "FinancePlatform/1.0"}
    try:
        r = requests.get(url, params=params, headers=headers, timeout=cfg.REQUEST_TIMEOUT)
        if r.status_code == 200:
            return r.json()
   except Exception:
        pass
    return None


def get_news_for_ticker(ticker: str, limit: int = 25) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    clean = ticker.upper()
    # 1) yfinance news (no key required)
    try:
        import yfinance as yf
        info = yf.Ticker(clean).news or []
        for item in info[: max(0, limit - len(results))]:
            results.append({
                "source": "yfinance",
                "title": item.get("title"),
                "link": item.get("link"),
                "published": item.get("providerPublishTime"),
                "summary": item.get("summary"),
            })
    except Exception:
        pass
    # 2) RSS fallback
    for src in NEWS_SOURCES:
        if len(results) >= limit:
            break
        try:
            feed = feedparser.parse(src["url"])
            for entry in feed.entries[: max(0, limit - len(results))]:
                title = getattr(entry, "title", "") or ""
                if ticker.upper() in title.upper() or clean in title.upper():
                    results.append({
                        "source": src["name"],
                        "title": title,
                        "link": getattr(entry, "link", ""),
                        "published": getattr(entry, "published", ""),
                        "summary": getattr(entry, "summary", ""),
                    })
        except Exception:
            pass
    # 3) NewsAPI
    if len(results) < limit and cfg.NEWS_API_KEY:
        try:
            url = f"https://newsapi.org/v2/everything?q={ticker}&language=en&sortBy=publishedAt&pageSize={limit-len(results)}"
            data = _get(url, {"apiKey": cfg.NEWS_API_KEY})
            if data:
                for item in data.get("articles", []):
                    results.append({
                        "source": "newsapi",
                        "title": item.get("title"),
                        "link": item.get("url"),
                        "published": item.get("publishedAt"),
                        "summary": item.get("description"),
                    })
        except Exception:
            pass
    # 4) Alpha Vantage News Sentiment
    if len(results) < limit and cfg.ALPHA_VANTAGE_KEY:
        try:
            url = "https://www.alphavantage.co/query"
            data = _get(url, {
                "function": "NEWS_SENTIMENT",
                "tickers": ticker,
                "apikey": cfg.ALPHA_VANTAGE_KEY,
                "limit": str(limit - len(results)),
            })
            if data:
                for item in data.get("feed", [])[: limit - len(results)]:
                    results.append({
                        "source": "alphavantage",
                        "title": item.get("title"),
                        "link": item.get("url"),
                        "published": item.get("time_published"),
                        "summary": item.get("summary"),
                    })
        except Exception:
            pass
        
    return {
        "ticker": ticker,
        "count": len(results),
        "articles": results[:limit],
    }
