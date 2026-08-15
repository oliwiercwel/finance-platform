"""
utils/data.py
=============
Pobieranie danych rynkowych (yfinance) oraz kompletny, szeroki zestaw
wskaźników technicznych liczony natywnie (pandas / numpy).

Dlaczego natywnie, a nie `pandas-ta`?
  - biblioteka `pandas-ta` jest zarchiwizowana i łamie się z numpy 2.x
    oraz Pythonem 3.14,
  - własna implementacja daje pełną kontrolę, determinizm i zero
    zależności, które mogą się popsuć przy instalacji na świeżym Pythonie.

Wszystkie wskaźniki zwracają pandas.Series tej samej długości co wejściowe
dane (ostatnie wartości NaN dla rozgrzewki okien).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import yfinance as yf

# ---------------------------------------------------------------------------
# Stałe konfiguracyjne wskaźników
# ---------------------------------------------------------------------------
EMA_PERIODS = (9, 21, 50, 100, 200)
SMA_PERIODS = (20, 50, 100, 200)
ATR_PERIOD = 14
SUPERTREND_PERIOD = 10
SUPERTREND_MULT = 3.0
BB_PERIOD = 20
BB_STD = 2.0
KC_PERIOD = 20
KC_MULT = 2.0
DONCHIAN_PERIOD = 20
VOL_SMA = (20, 50)
ADX_PERIOD = 14
RSI_PERIODS = (7, 14)
STOCH_K = 14
STOCH_D = 3
STOCH_RSI_N = 14
CCI_PERIOD = 20
WILLIAMS_PERIOD = 14
ROC_LOOKBACK = 10
MOMENTUM_LOOKBACK = 10
MFI_PERIOD = 14
CMF_PERIOD = 20
ICHIMOKU_TENKAN = 9
ICHIMOKU_KIJUN = 26
ICHIMOKU_SPAN_B = 52
PSAR_AF_STEP = 0.02
PSAR_AF_MAX = 0.2


# ---------------------------------------------------------------------------
# Pobieranie danych
# ---------------------------------------------------------------------------
def get_data(ticker: str, period: str = "1y") -> pd.DataFrame:
    """Pobiera dzienne OHLCV dla tickera. period: '1y' | '2y' | '5y'."""
    df = yf.download(
        tickers=ticker,
        period=period,
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=False,
    )
    if df is None or df.empty:
        raise ValueError(f"Brak danych dla tickera: {ticker}")

    # yfinance może zwracać MultiIndex kolumn przy wielu tickerach — spłaszczamy.
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    return df.dropna(subset=["Close"])


# ---------------------------------------------------------------------------
# Proste średnie
# ---------------------------------------------------------------------------
def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period).mean()


def rsi(series: pd.Series, period: int) -> pd.Series:
    """RSI (Wilder)."""
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100 - (100 / (1 + rs))
    out = out.where(~(avg_loss == 0), 100.0)
    out = out.where(~(avg_gain == 0), 0.0)
    return out


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["Close"].shift(1)
    tr = pd.concat(
        [
            df["High"] - df["Low"],
            (df["High"] - prev_close).abs(),
            (df["Low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr


def atr(df: pd.DataFrame, period: int = ATR_PERIOD) -> pd.Series:
    return true_range(df).ewm(alpha=1 / period, adjust=False).mean()



# ---------------------------------------------------------------------------
# Wskaźniki trendu
# ---------------------------------------------------------------------------
def macd(series: pd.Series, fast=12, slow=26, signal=9):
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def adx(df: pd.DataFrame, period: int = ADX_PERIOD):
    high, low = df["High"], df["Low"]
    up_move = high.diff()
    down_move = -low.diff()

    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index)

    tr = true_range(df)

    def wilder_smooth(x: pd.Series) -> pd.Series:
        return x.ewm(alpha=1 / period, adjust=False).mean()

    atr_s = wilder_smooth(tr)
    plus_di = 100 * (wilder_smooth(plus_dm) / atr_s.replace(0.0, np.nan))
    minus_di = 100 * (wilder_smooth(minus_dm) / atr_s.replace(0.0, np.nan))

    dx = 100 * ((plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan))
    adx_val = dx.ewm(alpha=1 / period, adjust=False).mean()
    return adx_val, plus_di, minus_di


def ichimoku(df: pd.DataFrame):
    high, low, close = df["High"], df["Low"], df["Close"]

    def midpoint(n: int) -> pd.Series:
        return (high.rolling(n).max() + low.rolling(n).min()) / 2

    conversion = midpoint(ICHIMOKU_TENKAN)          # Tenkan-sen
    base = midpoint(ICHIMOKU_KIJUN)                 # Kijun-sen
    span_a = ((conversion + base) / 2).shift(ICHIMOKU_KIJUN)
    span_b = midpoint(ICHIMOKU_SPAN_B).shift(ICHIMOKU_KIJUN)
    chikou = close.shift(-ICHIMOKU_KIJUN)
    return conversion, base, span_a, span_b, chikou


def parabolic_sar(df: pd.DataFrame):
    """Parabolic SAR (klasyczny)."""
    high, low = df["High"].values, df["Low"].values
    n = len(high)
    result = np.full(n, np.nan)
    if n < 2:
        return pd.Series(result, index=df.index)

    af = PSAR_AF_STEP
    uptrend = high[0] >= low[0]
    sar = low[0] if uptrend else high[0]
    ep = high[0] if uptrend else low[0]
    result[0] = sar

    for i in range(1, n):
        prev_sar = sar
        if uptrend:
            sar = prev_sar + af * (ep - prev_sar)
            sar = min(sar, low[i - 1], low[i - 2] if i >= 2 else low[i - 1])
            if low[i] < sar:
                uptrend = False
                sar = ep
                ep = low[i]
                af = PSAR_AF_STEP
            else:
                if high[i] > ep:
                    ep = high[i]
                    af = min(af + PSAR_AF_STEP, PSAR_AF_MAX)
        else:
            sar = prev_sar + af * (ep - prev_sar)
            sar = max(sar, high[i - 1], high[i - 2] if i >= 2 else high[i - 1])
            if high[i] > sar:
                uptrend = True
                sar = ep
                ep = high[i]
                af = PSAR_AF_STEP
            else:
                if low[i] < ep:
                    ep = low[i]
                    af = min(af + PSAR_AF_STEP, PSAR_AF_MAX)
        result[i] = sar

    return pd.Series(result, index=df.index)


def supertrend(df: pd.DataFrame, period: int = SUPERTREND_PERIOD, mult: float = SUPERTREND_MULT):
    """Supertrend — zwraca (supertrend, kierunek[bull=1/bear=-1])."""
    hl2 = (df["High"] + df["Low"]) / 2
    atr_s = atr(df, period)
    upper = hl2 + mult * atr_s
    lower = hl2 - mult * atr_s

    if len(df) == 0:
        return pd.Series(dtype=float), pd.Series(dtype=int)

    close = df["Close"].to_numpy(dtype=float)
    up_v = upper.to_numpy(dtype=float)
    lo_v = lower.to_numpy(dtype=float)
    st_v = np.full(len(df), np.nan)
    dir_v = np.ones(len(df), dtype=int)

    if len(close) == 0:
        return pd.Series(st_v, index=df.index), pd.Series(dir_v, index=df.index)

    st_v[0] = lo_v[0]
    dir_v[0] = 1

    for i in range(1, len(close)):
        if close[i - 1] > st_v[i - 1]:
            dir_v[i] = 1
        elif close[i - 1] < st_v[i - 1]:
            dir_v[i] = -1
        else:
            dir_v[i] = dir_v[i - 1]

        if dir_v[i] == 1:
            st_v[i] = max(lo_v[i], st_v[i - 1])
        else:
            st_v[i] = min(up_v[i], st_v[i - 1])

        if close[i] > st_v[i]:
            dir_v[i] = 1
        elif close[i] < st_v[i]:
            dir_v[i] = -1

    return (pd.Series(st_v, index=df.index),
            pd.Series(dir_v, index=df.index))


# ---------------------------------------------------------------------------
# Wskaźniki momentum
# ---------------------------------------------------------------------------
def stochastic(df: pd.DataFrame, k: int = STOCH_K, d: int = STOCH_D):
    low_k = df["Low"].rolling(k).min()
    high_k = df["High"].rolling(k).max()
    rng = (high_k - low_k).replace(0.0, np.nan)
    k_line = 100 * (df["Close"] - low_k) / rng
    d_line = k_line.rolling(d).mean()
    return k_line, d_line


def stochastic_rsi(series: pd.Series, n: int = STOCH_RSI_N, k: int = 3, d: int = 3):
    rsi_s = rsi(series, n)
    low = rsi_s.rolling(k).min()
    high = rsi_s.rolling(k).max()
    rng = (high - low).replace(0.0, np.nan)
    stoch = 100 * (rsi_s - low) / rng
    k_line = stoch.rolling(k).mean()
    d_line = k_line.rolling(d).mean()
    return k_line, d_line


def cci(df: pd.DataFrame, period: int = CCI_PERIOD):
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    mean = tp.rolling(period).mean()
    md = (tp - mean).abs().rolling(period).mean()
    return (tp - mean) / (0.015 * md.replace(0.0, np.nan))


def williams_r(df: pd.DataFrame, period: int = WILLIAMS_PERIOD):
    high = df["High"].rolling(period).max()
    low = df["Low"].rolling(period).min()
    return -100 * (high - df["Close"]) / (high - low).replace(0.0, np.nan)


def roc(series: pd.Series, lookback: int = ROC_LOOKBACK):
    return (series - series.shift(lookback)) / series.shift(lookback) * 100


def momentum(series: pd.Series, lookback: int = MOMENTUM_LOOKBACK):
    return series - series.shift(lookback)


# ---------------------------------------------------------------------------
# Wskaźniki zmienności
# ---------------------------------------------------------------------------
def bollinger(series: pd.Series, period: int = BB_PERIOD, num_std: float = BB_STD):
    mid = sma(series, period)
    std = series.rolling(period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    bandwidth = (upper - lower) / mid.replace(0.0, np.nan) * 100
    return mid, upper, lower, bandwidth


def keltner(df: pd.DataFrame, period: int = KC_PERIOD, mult: float = KC_MULT):
    mid = ema(df["Close"], period)
    atr_s = atr(df, period)
    upper = mid + mult * atr_s
    lower = mid - mult * atr_s
    return mid, upper, lower


def donchian(df: pd.DataFrame, period: int = DONCHIAN_PERIOD):
    upper = df["High"].rolling(period).max()
    lower = df["Low"].rolling(period).min()
    mid = (upper + lower) / 2
    return mid, upper, lower


# ---------------------------------------------------------------------------
# Wskaźniki wolumenu
# ---------------------------------------------------------------------------
def obv(df: pd.DataFrame):
    direction = np.sign(df["Close"].diff()).fillna(0.0)
    return (direction * df["Volume"]).cumsum()


def mfi(df: pd.DataFrame, period: int = MFI_PERIOD):
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    mf = tp * df["Volume"]
    up = mf.where(tp > tp.shift(1), 0.0).rolling(period).sum()
    down = mf.where(tp < tp.shift(1), 0.0).rolling(period).sum()
    ratio = up / down.replace(0.0, np.nan)
    return 100 - (100 / (1 + ratio))


def cmf(df: pd.DataFrame, period: int = CMF_PERIOD):
    mfm = ((df["Close"] - df["Low"]) - (df["High"] - df["Close"])) / (df["High"] - df["Low"]).replace(0.0, np.nan)
    mfv = mfm * df["Volume"]
    return mfv.rolling(period).sum() / df["Volume"].rolling(period).sum().replace(0.0, np.nan)


# ---------------------------------------------------------------------------
# Pivot Points (klasyczne)
# ---------------------------------------------------------------------------
def pivot_points(df: pd.DataFrame):
    """Klasyczne pivoty liczone z poprzedniej sesji (H/L/C)."""
    if len(df) < 2:
        return {"P": np.nan, "R1": np.nan, "S1": np.nan, "R2": np.nan, "S2": np.nan}
    prev = df.iloc[-2]
    h, l, c = prev["High"], prev["Low"], prev["Close"]
    p = (h + l + c) / 3
    return {"P": p, "R1": 2 * p - l, "S1": 2 * p - h, "R2": p + (h - l), "S2": p - (h - l)}



# ---------------------------------------------------------------------------
# Layout: dodanie wszystkich wskaźników do DataFrame
# ---------------------------------------------------------------------------
def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Dodaje wszystkie kolumny wskaźników do df (w miejscu) i zwraca go."""
    close = df["Close"]

    # --- Trend: EMY i SMY ---
    for p in EMA_PERIODS:
        df[f"EMA{p}"] = ema(close, p)
    for p in SMA_PERIODS:
        df[f"SMA{p}"] = sma(close, p)

    # --- Ichimoku ---
    conv, base, span_a, span_b, chikou = ichimoku(df)
    df["ICHI_CONVERSION"], df["ICHI_BASE"] = conv, base
    df["ICHI_SPAN_A"], df["ICHI_SPAN_B"] = span_a, span_b
    df["ICHI_CHIKOU"] = chikou

    # --- Supertrend / PSAR ---
    st, st_dir = supertrend(df)
    df["SUPERTREND"] = st
    df["ST_DIRECTION"] = st_dir
    df["PSAR"] = parabolic_sar(df)

    # --- ADX ---
    adx_v, plus_di, minus_di = adx(df)
    df["ADX"], df["DI_PLUS"], df["DI_MINUS"] = adx_v, plus_di, minus_di

    # --- Momentum ---
    for p in RSI_PERIODS:
        df[f"RSI{p}"] = rsi(close, p)
    stoch_k, stoch_d = stochastic(df)
    df["STOCH_K"], df["STOCH_D"] = stoch_k, stoch_d
    srsi_k, srsi_d = stochastic_rsi(close)
    df["STOCH_RSI_K"], df["STOCH_RSI_D"] = srsi_k, srsi_d
    macd_l, macd_s, macd_h = macd(close)
    df["MACD"], df["MACD_SIGNAL"], df["MACD_HIST"] = macd_l, macd_s, macd_h
    df["CCI"] = cci(df)
    df["WILLR"] = williams_r(df)
    df["ROC"] = roc(close)
    df["MOMENTUM"] = momentum(close)

    # --- Zmienność ---
    df["ATR"] = atr(df)
    df["ATR_PCT"] = df["ATR"] / close.replace(0.0, np.nan) * 100
    bb_mid, bb_up, bb_lo, bb_bw = bollinger(close)
    df["BB_MID"], df["BB_UPPER"], df["BB_LOWER"], df["BB_BANDWIDTH"] = bb_mid, bb_up, bb_lo, bb_bw
    kc_mid, kc_up, kc_lo = keltner(df)
    df["KC_MID"], df["KC_UPPER"], df["KC_LOWER"] = kc_mid, kc_up, kc_lo
    dc_mid, dc_up, dc_lo = donchian(df)
    df["DC_MID"], df["DC_UPPER"], df["DC_LOWER"] = dc_mid, dc_up, dc_lo

    # --- Wolumen ---
    for p in VOL_SMA:
        df[f"VOL_SMA{p}"] = sma(df["Volume"], p)
    df["OBV"] = obv(df)
    df["MFI"] = mfi(df)
    df["CMF"] = cmf(df)

    return df


# ---------------------------------------------------------------------------
# Opisy (struktura trendu, strefa RSI)
# ---------------------------------------------------------------------------
def _last(series: pd.Series):
    """Ostatnia wartość nie-NaN (lub NaN)."""
    if series is None or len(series) == 0:
        return np.nan
    vals = series.dropna()
    return float(vals.iloc[-1]) if len(vals) else float("nan")


def describe_trend_structure(df: pd.DataFrame) -> str:
    """Krótki tekstowy opis konfiguracji średnich i ceny."""
    close = _last(df["Close"])
    ema50 = _last(df["EMA50"])
    sma200 = _last(df["SMA200"])
    sma50 = _last(df["SMA50"])

    if np.isnan(close):
        return "brak danych"

    parts = []
    if not np.isnan(ema50):
        parts.append("cena POWYŻEJ EMA50" if close > ema50 else "cena PONIŻEJ EMA50")
    if not np.isnan(sma50) and not np.isnan(sma200):
        if sma50 > sma200:
            parts.append("SMA50>SMA200 (trend wzrostowy)")
        elif sma50 < sma200:
            parts.append("SMA50<SMA200 (trend spadkowy)")
        else:
            parts.append("SMA50=SMA200 (stagnacja)")
    if not np.isnan(ema50) and not np.isnan(sma200):
        parts.append("EMA50>SMA200 (pro-wzrostowa)" if ema50 > sma200 else "EMA50<SMA200 (pro-spadkowa)")
    if not np.isnan(sma200):
        parts.append("cena POWYŻEJ SMA200" if close > sma200 else "cena PONIŻEJ SMA200")

    return "; ".join(parts) if parts else "brak jednoznacznej struktury"


def rsi_zone(rsi_val: float) -> str:
    if np.isnan(rsi_val):
        return "brak danych"
    if rsi_val >= 70:
        return "wykupienie (>=70)"
    if rsi_val <= 30:
        return "wyprzedanie (<=30)"
    return "strefa neutralna (30-70)"


def _adx_comment(adx_v, di_plus, di_minus):
    if any(np.isnan(x) for x in (adx_v, di_plus, di_minus)):
        return "brak danych"
    if adx_v >= 25:
        if di_plus > di_minus:
            return f"silny trend wzrostowy (ADX {adx_v:.0f})"
        return f"silny trend spadkowy (ADX {adx_v:.0f})"
    return f"brak wyraźnego trendu / konsolidacja (ADX {adx_v:.0f})"

# ---------------------------------------------------------------------------
# Snapshot (bogaty słownik dla AI)
# ---------------------------------------------------------------------------
def get_latest_snapshot(df: pd.DataFrame) -> dict:
    """Zwraca bogaty słownik z najnowszymi wartościami wszystkich wskaźników."""
    close = _last(df["Close"])
    last_row = df.iloc[-1]

    def v(col):
        return _last(df[col]) if col in df.columns else np.nan

    trend_structure = describe_trend_structure(df)
    r14 = v("RSI14")
    r7 = v("RSI7")

    if not np.isnan(v("ICHI_SPAN_A")) and not np.isnan(v("ICHI_SPAN_B")):
        cloud_top = max(v("ICHI_SPAN_A"), v("ICHI_SPAN_B"))
        cloud_bot = min(v("ICHI_SPAN_A"), v("ICHI_SPAN_B"))
        icchi_direction = ("powyżej chmury" if close > cloud_top
                           else "poniżej chmury" if close < cloud_bot else "w chmurze")
    else:
        icchi_direction = "brak danych"

    macd_h = v("MACD_HIST")
    if not np.isnan(macd_h):
        macd_cross = "MACD hist>0 (momentum pro-bull)" if macd_h > 0 else "MACD hist<0 (momentum pro-bear)"
    else:
        macd_cross = "brak danych"

    bullish = (
        not np.isnan(v("SMA50")) and not np.isnan(v("SMA200"))
        and v("SMA50") > v("SMA200") and close > v("SMA200")
    )
    bearish = (
        not np.isnan(v("SMA50")) and not np.isnan(v("SMA200"))
        and v("SMA50") < v("SMA200")
    )
    if bullish:
        long_term = "bull (SMA50>SMA200 i cena>SMA200)"
    elif bearish:
        long_term = "bear (SMA50<SMA200)"
    else:
        long_term = "mieszana/nieokreślona"

    snap = {
        "data": str(last_row.name.date()) if hasattr(last_row.name, "date") else str(last_row.name),
        "cena": round(close, 4) if not np.isnan(close) else None,
        "trend_struktura": trend_structure,
        "EMA": {f"EMA{p}": round(v(f"EMA{p}"), 4) for p in EMA_PERIODS},
        "SMA": {f"SMA{p}": round(v(f"SMA{p}"), 4) for p in SMA_PERIODS},
        "Ichimoku": {
            "conversion": round(v("ICHI_CONVERSION"), 4),
            "base": round(v("ICHI_BASE"), 4),
            "span_a": round(v("ICHI_SPAN_A"), 4),
            "span_b": round(v("ICHI_SPAN_B"), 4),
            "pozycja": icchi_direction,
        },
        "Supertrend": {
            "wartosc": round(v("SUPERTREND"), 4),
            "kierunek": "bull" if v("ST_DIRECTION") == 1 else "bear",
        },
        "PSAR": round(v("PSAR"), 4),
        "ADX": {
            "adx": round(v("ADX"), 2),
            "di_plus": round(v("DI_PLUS"), 2),
            "di_minus": round(v("DI_MINUS"), 2),
            "komentarz": _adx_comment(v("ADX"), v("DI_PLUS"), v("DI_MINUS")),
        },
        "RSI": {"rsi7": round(r7, 2), "rsi14": round(r14, 2), "strefa_rsi14": rsi_zone(r14)},
        "Stochastic": {"k": round(v("STOCH_K"), 2), "d": round(v("STOCH_D"), 2)},
        "StochasticRSI": {"k": round(v("STOCH_RSI_K"), 2), "d": round(v("STOCH_RSI_D"), 2)},
        "MACD": {
            "linia": round(v("MACD"), 4),
            "sygnal": round(v("MACD_SIGNAL"), 4),
            "histogram": round(macd_h, 4),
            "momentum": macd_cross,
        },
        "CCI": round(v("CCI"), 2),
        "WilliamsR": round(v("WILLR"), 2),
        "ROC": round(v("ROC"), 2),
        "Momentum": round(v("MOMENTUM"), 4),
        "ATR": {"atr": round(v("ATR"), 4), "atr_pct": round(v("ATR_PCT"), 2)},
        "Bollinger": {
            "mid": round(v("BB_MID"), 4),
            "upper": round(v("BB_UPPER"), 4),
            "lower": round(v("BB_LOWER"), 4),
            "bandwidth": round(v("BB_BANDWIDTH"), 2),
        },
        "Keltner": {"mid": round(v("KC_MID"), 4), "upper": round(v("KC_UPPER"), 4), "lower": round(v("KC_LOWER"), 4)},
        "Donchian": {"mid": round(v("DC_MID"), 4), "upper": round(v("DC_UPPER"), 4), "lower": round(v("DC_LOWER"), 4)},
        "Volume": {
            "vol": int(v("Volume")) if not np.isnan(v("Volume")) else None,
            "vol_sma20": round(v("VOL_SMA20"), 0),
            "vol_sma50": round(v("VOL_SMA50"), 0),
            "obv": round(v("OBV"), 0),
            "mfi": round(v("MFI"), 2),
            "cmf": round(v("CMF"), 4),
        },
        "struktura_dlugoterminowa": long_term,
    }

    pivots = pivot_points(df)
    snap["PivotPoints"] = {k: (round(val, 4) if not np.isnan(val) else None) for k, val in pivots.items()}

    return snap


def get_full_data(ticker: str, period: str = "1y"):
    """Pobiera dane, liczy wskaźniki i zwraca (df, snapshot)."""
    df = get_data(ticker, period)
    df = add_indicators(df)
    return df, get_latest_snapshot(df)
