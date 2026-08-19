from __future__ import annotations

import calendar
import json
import math
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import yfinance as yf

from trading_ai.data import get_data, add_indicators, rsi, macd, stochastic, bollinger
from trading_ai.fibonacci import fibonacci_retracement, fibonacci_extension, find_swing_high_low
from trading_ai.trading_patterns import detect_all_patterns

MACRO_SYMBOLS = ["DX-Y.NYB", "^TNX", "GC=F", "SI=F"]

INTERVALS = [
    {"id": "D1", "period": "2y", "interval": "1d", "weight": 1.0},
    {"id": "W1", "period": "5y", "interval": "1wk", "weight": 0.7},
    {"id": "H1", "period": "60d", "interval": "1h", "weight": 0.5},
]


@dataclass
class IndicatorBundle:
    ticker: str
    timeframe: str
    period: str
    df: pd.DataFrame
    snapshot: Dict[str, Any]
    generated_at: datetime = field(default_factory=datetime.utcnow)
    swing_points: List[Dict[str, Any]] = field(default_factory=list)
    chart_patterns: List[str] = field(default_factory=list)
    candlestick_patterns: List[Dict[str, Any]] = field(default_factory=list)
    fibonacci: Optional[Dict[str, Any]] = None
    seasonality: Optional[Dict[str, Any]] = None
    macro: Optional[Dict[str, Any]] = None


def _safe_num(v, digits=4):
    try:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return round(float(v), digits)
    except Exception:
        return None


def _last(df, col):
    try:
        return df[col].iloc[-1]
    except Exception:
        return None
def build_bundle(ticker: str, timeframe: str = "D1", period: str = "2y") -> Optional[IndicatorBundle]:
    try:
        # Try multiple intervals when requested as ALL
        if timeframe == "ALL":
            bundles = []
            for cfg in INTERVALS:
                try:
                    b = _build_single(ticker, cfg["id"], cfg["period"])
                    if b:
                        bundles.append(b)
                except Exception:
                    pass
            # Merge: prefer D1 as canonical
            return bundles[0] if bundles else None
        else:
            return _build_single(ticker, timeframe, period)
    except Exception:
        return None


def _build_single(ticker: str, timeframe: str, period: str) -> Optional[IndicatorBundle]:
    # Map our labels to yfinance interval/period
    interval_map = {"D1": "1d", "W1": "1wk", "H1": "1h"}
    yf_interval = interval_map.get(timeframe, "1d")
    df = get_data(ticker, period=period)
    if df is None or df.empty:
        return None
    df = add_indicators(df)
    snap = _snapshot(df)
    bundle = IndicatorBundle(ticker=ticker, timeframe=timeframe, period=period, df=df, snapshot=snap)
    bundle.candlestick_patterns = _patterns_to_levels(detect_all_patterns(df), df)
    bundle.swing_points = _swing_points(df, window=5)
    bundle.chart_patterns = _chart_patterns(bundle.swing_points)
    bundle.fibonacci = _fib_context(df)
    bundle.seasonality = _seasonality(ticker)
    bundle.macro = _macro_snapshot()
    return bundle


def _snapshot(df: pd.DataFrame) -> Dict[str, Any]:
    c = _last(df, "Close")
    r7 = _last(df, "RSI7")
    r14 = _last(df, "RSI14")
    macd_h = _last(df, "MACD_HIST")
    adx_v = _last(df, "ADX")
    dp = _last(df, "DI_PLUS")
    dm = _last(df, "DI_MINUS")
    ema20 = _last(df, "EMA20")
    ema50 = _last(df, "EMA50")
    ema200 = _last(df, "EMA200")
    sma20 = _last(df, "SMA20")
    sma50 = _last(df, "SMA50")
    sma200 = _last(df, "SMA200")
    atr = _last(df, "ATR")
    atr_pct = _last(df, "ATR_PCT")
    st_k = _last(df, "STOCH_K")
    st_d = _last(df, "STOCH_D")
    vol = _last(df, "Volume")
    obv = _last(df, "OBV")
    trend_structure = "brak danych"
    if c is not None and ema50 is not None and ema200 is not None:
        if c > ema50 > ema200:
            trend_structure = "bull (cena>EMA50>EMA200)"
        elif c < ema50 < ema200:
            trend_structure = "bear (cena<EMA50<EMA200)"
        else:
            trend_structure = "mieszana"
    return {
        "cena": _safe_num(c),
        "RSI": {"rsi7": _safe_num(r7), "rsi14": _safe_num(r14)},
        "MACD": {"histogram": _safe_num(macd_h)},
        "ADX": {"adx": _safe_num(adx_v), "di_plus": _safe_num(dp), "di_minus": _safe_num(dm)},
        "EMA": {"ema20": _safe_num(ema20), "ema50": _safe_num(ema50), "ema200": _safe_num(ema200)},
        "SMA": {"sma20": _safe_num(sma20), "sma50": _safe_num(sma50), "sma200": _safe_num(sma200)},
        "ATR": {"atr": _safe_num(atr), "atr_pct": _safe_num(atr_pct)},
        "Stochastic": {"k": _safe_num(st_k, 2), "d": _safe_num(st_d, 2)},
        "Volume": {"vol": int(vol) if vol is not None else None, "obv": _safe_num(obv, 0)},
        "trend_struktura": trend_structure,
    }


def _patterns_to_levels(patterns: Dict[str, Any], df: pd.DataFrame) -> List[Dict[str, Any]]:
    out = []
    latest_close = _last(df, "Close")
    for p in patterns.get("patterns", [])[:10]:
        strength = p.get("strength", 1)
        idx = p.get("index")
        level = None
        if idx is not None and 0 <= idx < len(df):
            level = _safe_num(df["High"].iloc[idx]) or _safe_num(df["Low"].iloc[idx])
        out.append({
            "pattern": p.get("pattern"),
            "strength": strength,
            "timeframe": "D1",
            "at_level": level,
            "close": _safe_num(latest_close),
        })
    return out


def _swing_points(df: pd.DataFrame, window: int = 5) -> List[Dict[str, Any]]:
    pts = []
    highs = df["High"].values
    lows = df["Low"].values
    idxs = list(range(window, len(df) - window))
    for i in idxs:
        if highs[i] == max(highs[i - window : i + window + 1]):
            pts.append({"type": "high", "index": i, "date": str(df.index[i].date()), "price": _safe_num(highs[i])})
        if lows[i] == min(lows[i - window : i + window + 1]):
            pts.append({"type": "low", "index": i, "date": str(df.index[i].date()), "price": _safe_num(lows[i])})
    return pts


def _chart_patterns(swing_points: List[Dict[str, Any]]) -> List[str]:
    # Very light heuristic from swing highs/lows
    highs = [p for p in swing_points if p.get("type") == "high"]
    lows = [p for p in swing_points if p.get("type") == "low"]
    out = []
    if len(highs) >= 2 and len(lows) >= 2:
        h1, h2 = highs[-2], highs[-1]
        l1, l2 = lows[-2], lows[-1]
        if h1["price"] is not None and h2["price"] is not None and l1["price"] is not None and l2["price"] is not None:
            if h2["price"] > h1["price"] and l2["price"] > l1["price"]:
                out.append("ascending triangle forming")
            elif abs(h2["price"] - h1["price"]) < 0.02 * h1["price"] and l2["price"] < l1["price"]:
                out.append("descending triangle forming")
            elif abs(h2["price"] - h1["price"]) < 0.02 * h1["price"] and abs(l2["price"] - l1["price"]) < 0.02 * l1["price"]:
                out.append("symmetrical triangle forming")
            elif highs[-1]["price"] < highs[-2]["price"] < highs[-3]["price"] and lows[-1]["price"] < lows[-2]["price"] < lows[-3]["price"]:
                out.append("lower highs/lows sequence")
    return out


def _fib_context(df: pd.DataFrame) -> Dict[str, Any]:
    try:
        ret = fibonacci_retracement(df, period=min(100, len(df)))
        latest = _last(df, "Close")
        levels = ret.get("levels", {})
        atr = _last(df, "ATR") or 0.0
        near = None
        for k, v in levels.items():
            if latest is not None and atr is not None and abs(v - latest) <= 0.5 * atr:
                near = f"{k}%"
                break
        return {
            "swing_high": _safe_num(ret.get("high")),
            "swing_low": _safe_num(ret.get("low")),
            "current_price_near_level": near,
            "levels": {k: _safe_num(v) for k, v in levels.items()},
        }
    except Exception:
        return {}


def _seasonality(ticker: str) -> Dict[str, Any]:
    try:
        sym = ticker
        if "." in ticker:
            sym = ticker.split(".")[0]
        if len(sym) > 5:
            sym = ticker
        df = get_data(sym, period="10y")
        if df is None or df.empty:
            return {}
        monthly = {}
        df["month"] = df.index.month
        for m in range(1, 13):
            sub = df[df["month"] == m]
            if len(sub) < 3:
                continue
            # monthly return approximated from close to close aggregated by year
            rets = sub["Close"].pct_change().dropna()
            if rets.empty:
                continue
            monthly[str(m)] = {
                "avg_return_pct": _safe_num(rets.mean() * 100, 2),
                "years": len(rets),
            }
        return {
            "ticker": sym,
            "monthly_avg_return_pct": monthly,
        }
    except Exception:
        return {}


def _macro_snapshot() -> Dict[str, Any]:
    try:
        rows = []
        for sym in MACRO_SYMBOLS:
            try:
                df = get_data(sym, period="1y")
                if df is None or df.empty:
                    continue
                rows.append({
                    "symbol": sym,
                    "close": _safe_num(df["Close"].iloc[-1]),
                    "change_pct": _safe_num(df["Close"].pct_change().iloc[-1] * 100, 2),
                })
            except Exception:
                pass
        return {"symbols": rows}
    except Exception:
        return {}



