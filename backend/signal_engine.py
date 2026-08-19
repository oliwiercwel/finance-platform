from __future__ import annotations

import math
from typing import Any, Dict, Optional

from indicators import build_bundle  # type: ignore


def _norm(v, digits: int = 4):
    try:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return round(float(v), digits)
    except Exception:
        return None


def score_snapshot(bundle) -> Dict[str, Any]:
    snap = bundle.snapshot
    trend = snap.get("trend_struktura", "mieszana") or "mieszana"
    rsi14 = _norm(snap.get("RSI", {}).get("rsi14"))
    macd_h = _norm(snap.get("MACD", {}).get("histogram"))
    adx = _norm(snap.get("ADX", {}).get("adx"))
    di_plus = _norm(snap.get("ADX", {}).get("di_plus"))
    di_minus = _norm(snap.get("ADX", {}).get("di_minus"))

    trend_score = 0
    if "bull" in trend or "wzrostowy" in trend or "POWYŻEJ" in trend:
        trend_score = 1
    elif "bear" in trend or "spadkowy" in trend or "PONIŻEJ" in trend:
        trend_score = -1

    momentum_score = 0
    if rsi14 is not None and rsi14 >= 55:
        momentum_score += 1
    if rsi14 is not None and rsi14 <= 45:
        momentum_score -= 1
    if macd_h is not None and macd_h > 0:
        momentum_score += 1
    if macd_h is not None and macd_h < 0:
        momentum_score -= 1

    adx_score = 0
    if adx is not None and adx >= 25:
        if di_plus is not None and di_minus is not None:
            adx_score = 1 if di_plus > di_minus else -1
        else:
            adx_score = 1

    total = trend_score + momentum_score + adx_score

    if total >= 2 and trend_score == 1 and momentum_score >= 1 and adx_score >= 0:
        verdict = "MA SENS"
    elif total <= -2 and trend_score == -1 and momentum_score <= -1 and adx_score <= 0:
        verdict = "NIE MA SENS"
    else:
        verdict = "CZEKAJ"

    confidence = max(0.0, min(1.0, (abs(total) * 0.25) + (0.5 if verdict != "CZEKAJ" else 0.0)))

    return {
        "score": total,
        "trend_score": trend_score,
        "momentum_score": momentum_score,
        "adx_score": adx_score,
        "confidence": round(confidence, 2),
        "verdict": verdict,
        "components": {
            "trend": trend,
            "rsi14": rsi14,
            "macd_hist": macd_h,
            "adx": adx,
            "di_plus": di_plus,
            "di_minus": di_minus,
        },
    }


def build_reason(bundle, score: Dict[str, Any]) -> str:
    snap = bundle.snapshot
    trend = snap.get("trend_struktura", "mieszana") or "mieszana"
    rsi14 = snap.get("RSI", {}).get("rsi14")
    macd_h = snap.get("MACD", {}).get("histogram")
    adx = snap.get("ADX", {}).get("adx")

    parts: list[str] = []
    if "bull" in trend or "wzrostowy" in trend or "POWYŻEJ" in trend:
        parts.append("cena trzyma się powyżej średnich – trend wzrostowy")
    elif "bear" in trend or "spadkowy" in trend or "PONIŻEJ" in trend:
        parts.append("cena pozostaje poniżej średnich – trend spadkowy")
    else:
        parts.append("struktura jest mieszana – brak jednoznacznego kierunku")

    if rsi14 is not None:
        if rsi14 >= 70:
            parts.append(f"RSI ({rsi14}) wskazuje wykupienie, ryzyko korekty")
        elif rsi14 <= 30:
            parts.append(f"RSI ({rsi14}) wskazuje wyprzedanie")
        else:
            parts.append(f"RSI ({rsi14}) jest w przedziale neutralnym")
    if macd_h is not None:
        parts.append("MACD potwierdza momentum" if macd_h > 0 else "MACD nie potwierdza impulsu wzrostowego")
    if adx is not None:
        parts.append(f"ADX ({adx}) wskazuje silny trend" if adx >= 25 else f"ADX ({adx}) wskazuje konsolidację")

    tail = (
        "Dlatego ryzyko i potencjał przemawiają za wejściem, ale.</poczekaj na potwierdzenie wolumenem>"
        if score["verdict"] == "MA SENS"
        else "Dlatego trzymam się z dala – struktura nie przekonuje."
        if score["verdict"] == "NIE MA SENS"
        else "Dlatego nie wymuszam setupu. Lepiej poczekać na wyraźniejsze sygnały."
    )

    return (
        f"**WERDYKT:** {score['verdict']}\n\n"
        "**Czym się kierowałem (prosto):**\n"
        + ". ".join(parts)
        + ". "
        + tail
        + "\n\n**Uzasadnienie (konkretnie):**\n"
        + f"- Struktura: {trend}\n"
        + f"- RSI(14): {rsi14} | MACD histogram: {macd_h} | ADX: {adx}\n"
        + "- Do pełnego przekonania brakuje jednoznacznego potwierdzenia wolumenem.\n\n"
        + "**Kluczowe poziomy:**\n"
        + "- Wsparcie: ostatnie minimum lokalne\n"
        + "- Opór: ostatnie maksimum lokalne\n\n"
        + "**Warunki unieważnienia setupu:**\n"
        + "- cena traci poziom wsparcia lub zmienia kierunek średnich\n"
        + "- RSI przekracza 70 przy spadkowej dywergencji\n\n"
        + "*Wynik wygenerowany automatycznie na podstawie modelu wskaźnikowego.*"
    )


def get_signal(ticker: str, timeframe: str = "D1", period: str = "2y") -> Dict[str, Any]:
    bundle = build_bundle(ticker=ticker, timeframe=timeframe, period=period)
    if bundle is None:
        return {
            "ticker": ticker,
            "timeframe": timeframe,
            "status": "no_data",
            "verdict": "CZEKAJ",
            "confidence": 0.0,
            "reason": "Brak danych wskaźnikowych.",
            "score": {
                "trend_score": 0,
                "momentum_score": 0,
                "adx_score": 0,
                "confidence": 0.0,
                "verdict": "CZEKAJ",
            },
        }

    score = score_snapshot(bundle)
    reason = build_reason(bundle, score)

    return {
        "ticker": ticker,
        "timeframe": timeframe,
        "status": "ok",
        "verdict": score["verdict"],
        "confidence": score["confidence"],
        "reason": reason,
        "score": score,
        "generated_at": bundle.generated_at.isoformat() if bundle.generated_at else None,
    }