"""
trading_ai/fibonacci.py
Obliczanie poziomów Fibonacciego na podstawie swing high/low
"""

from __future__ import annotations
import pandas as pd
import numpy as np
from typing import Dict, List

FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.618, 2.618]

def find_swing_high_low(df: pd.DataFrame, window: int = 5) -> Dict[str, pd.Series]:
    highs = []
    lows = []
    for i in range(window, len(df)-window):
        window_high = df["High"].iloc[i-window:i+window+1]
        window_low = df["Low"].iloc[i-window:i+window+1]
        if df["High"].iloc[i] == window_high.max():
            highs.append(i)
        if df["Low"].iloc[i] == window_low.min():
            lows.append(i)
    return {"highs": highs, "lows": lows}

def fibonacci_retracement(df: pd.DataFrame, period: int = 100) -> Dict:
    if len(df) < period:
        period = len(df)
    sub = df.tail(period).copy()
    high = sub["High"].max()
    low = sub["Low"].min()
    diff = high - low
    levels = {}
    for lvl in FIB_LEVELS:
        price = high - diff * lvl if high > low else low
        levels[f"fib_{int(lvl*1000)}"] = float(price)
    return {
        "high": float(high),
        "low": float(low),
        "diff": float(diff),
        "levels": levels,
        "swing_high_date": str(sub["High"].idxmax().date()),
        "swing_low_date": str(sub["Low"].idxmin().date())
    }

def fibonacci_extension(df: pd.DataFrame, period: int = 100) -> Dict:
    ret = fibonacci_retracement(df, period)
    high = ret["high"]
    low = ret["low"]
    diff = ret["diff"]
    ext = {}
    for lvl in [1.272, 1.618, 2.618, 4.236]:
        price = high + diff * lvl
        ext[f"ext_{lvl}"] = float(price)
    return ext
