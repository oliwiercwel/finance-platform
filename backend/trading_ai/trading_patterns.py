"""
trading_ai/trading_patterns.py
Kompletna baza formacji świecowych i wskaźników technicznych
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from typing import List, Dict, Any

def _body(df): return df["Close"] - df["Open"]
def _range(df): return df["High"] - df["Low"]
def _upper_shadow(df): return df["High"] - df[["Open","Close"]].max(axis=1)
def _lower_shadow(df): return df[["Open","Close"]].min(axis=1) - df["Low"]
def _is_bullish(df,i): return df["Close"].iloc[i] > df["Open"].iloc[i]
def _is_bearish(df,i): return df["Close"].iloc[i] < df["Open"].iloc[i]

def detect_doji(df, threshold=0.05):
    res=[]
    body=_body(df).abs(); rng=_range(df)
    for i in range(len(df)):
        if rng.iloc[i]==0: continue
        if body.iloc[i]/rng.iloc[i] < threshold:
            res.append({"index":i,"date":df.index[i],"pattern":"Doji","strength":1})
    return res

def detect_hammer(df, body_thr=0.3, shadow_thr=2.0):
    res=[]
    for i in range(1,len(df)):
        rng=_range(df).iloc[i]
        if rng==0: continue
        body_pct=abs(_body(df).iloc[i])/rng
        lower=_lower_shadow(df).iloc[i]/rng
        upper=_upper_shadow(df).iloc[i]/rng
        if body_pct<body_thr and lower>shadow_thr*body_pct and upper<0.3:
            res.append({"index":i,"date":df.index[i],"pattern":"Hammer","strength":3})
    return res

def detect_shooting_star(df):
    res=[]
    for i in range(1,len(df)):
        rng=_range(df).iloc[i]
        if rng==0: continue
        body_pct=abs(_body(df).iloc[i])/rng
        upper=_upper_shadow(df).iloc[i]/rng
        lower=_lower_shadow(df).iloc[i]/rng
        if body_pct<0.3 and upper>2*lower and upper>0.5:
            res.append({"index":i,"date":df.index[i],"pattern":"Shooting Star","strength":2})
    return res

def detect_engulfing(df):
    res=[]
    for i in range(1,len(df)):
        prev_bull=_is_bullish(df,i-1)
        curr_bull=_is_bullish(df,i)
        if prev_bull and not curr_bull:
            if df["Open"].iloc[i]>=df["Close"].iloc[i-1] and df["Close"].iloc[i]<=df["Open"].iloc[i-1]:
                res.append({"index":i,"date":df.index[i],"pattern":"Bearish Engulfing","strength":3})
        elif not prev_bull and curr_bull:
            if df["Open"].iloc[i]<=df["Close"].iloc[i-1] and df["Close"].iloc[i]>=df["Open"].iloc[i-1]:
                res.append({"index":i,"date":df.index[i],"pattern":"Bullish Engulfing","strength":3})
    return res

def detect_morning_star(df):
    res=[]
    for i in range(2,len(df)):
        if _is_bearish(df,i-2) and abs(_body(df).iloc[i-1])<abs(_body(df).iloc[i-2])*0.5 and _is_bullish(df,i):
            if df["Close"].iloc[i]>(df["Open"].iloc[i-2]+df["Close"].iloc[i-2])/2:
                res.append({"index":i,"date":df.index[i],"pattern":"Morning Star","strength":4})
    return res

def detect_evening_star(df):
    res=[]
    for i in range(2,len(df)):
        if _is_bullish(df,i-2) and abs(_body(df).iloc[i-1])<abs(_body(df).iloc[i-2])*0.5 and _is_bearish(df,i):
            if df["Close"].iloc[i]<(df["Open"].iloc[i-2]+df["Close"].iloc[i-2])/2:
                res.append({"index":i,"date":df.index[i],"pattern":"Evening Star","strength":4})
    return res

def detect_harami(df):
    res=[]
    for i in range(1,len(df)):
        prev_body=abs(_body(df).iloc[i-1])
        curr_body=abs(_body(df).iloc[i])
        if curr_body<prev_body*0.6:
            if _is_bullish(df,i-1) and _is_bearish(df,i):
                res.append({"index":i,"date":df.index[i],"pattern":"Bearish Harami","strength":2})
            elif _is_bearish(df,i-1) and _is_bullish(df,i):
                res.append({"index":i,"date":df.index[i],"pattern":"Bullish Harami","strength":2})
    return res

def detect_three_white_soldiers(df):
    res=[]
    for i in range(2,len(df)):
        if all(_is_bullish(df,j) for j in [i-2,i-1,i]):
            if df["Close"].iloc[i]>df["Close"].iloc[i-1]>df["Close"].iloc[i-2]:
                res.append({"index":i,"date":df.index[i],"pattern":"Three White Soldiers","strength":4})
    return res

def detect_three_black_crows(df):
    res=[]
    for i in range(2,len(df)):
        if all(_is_bearish(df,j) for j in [i-2,i-1,i]):
            if df["Close"].iloc[i]<df["Close"].iloc[i-1]<df["Close"].iloc[i-2]:
                res.append({"index":i,"date":df.index[i],"pattern":"Three Black Crows","strength":4})
    return res

def detect_all_patterns(df):
    patterns=[]
    for fn in [detect_doji,detect_hammer,detect_shooting_star,detect_engulfing,detect_morning_star,detect_evening_star,detect_harami,detect_three_white_soldiers,detect_three_black_crows]:
        try:
            patterns.extend(fn(df))
        except Exception:
            pass
    patterns.sort(key=lambda x:x["index"],reverse=True)
    return {"patterns":patterns[:30],"latest":patterns[0] if patterns else None}

