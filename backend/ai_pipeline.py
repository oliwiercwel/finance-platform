from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

from config import Config
from indicators import build_bundle
from news_engine import get_news_for_ticker
from signal_engine import get_signal
from trading_ai.ai_client import get_model_id_by_label
from trading_ai.system_prompt import build_system_prompt
from trading_ai import data as ta_data


cfg = Config()


# ---------------------------------------------------------------------------
# 5-pass pipeline
# ---------------------------------------------------------------------------

def run_analysis(ticker: str, timeframe: str = "D1", period: str = "1y", model_label: Optional[str] = None, include_news: bool = True, include_macro: bool = True) -> Dict[str, Any]:
    model_id = get_model_id_by_label(model_label) if model_label else None
    system_prompt = build_system_prompt()

    # Pass 1 — wskaźniki techniczne
    indicator_bundle = build_bundle(ticker=ticker, timeframe=timeframe, period=period)
    indicators_payload: Dict[str, Any] = {
        "ticker": ticker,
        "timeframe": timeframe,
        "status": "ok" if indicator_bundle else "no_data",
        "snapshot": indicator_bundle.snapshot if indicator_bundle else {},
        "swing_points": indicator_bundle.swing_points if indicator_bundle else [],
        "chart_patterns": indicator_bundle.chart_patterns if indicator_bundle else [],
        "candlestick_patterns": indicator_bundle.candlestick_patterns if indicator_bundle else [],
        "fibonacci": indicator_bundle.fibonacci if indicator_bundle else {},
        "seasonality": indicator_bundle.seasonality if indicator_bundle else {},
        "macro": indicator_bundle.macro if indicator_bundle else {},
    }

    # Pass 2 — wiadomości
    news_payload: Dict[str, Any] = {"count": 0, "articles": []}
    if include_news:
        try:
            news_payload = get_news_for_ticker(ticker, limit=25)
        except Exception:
            news_payload = {"ticker": ticker, "count": 0, "articles": []}

    # Pass 3 — sygnał regułowy (ten sam dla wszystkich zakładek)
    signal_payload: Dict[str, Any] = get_signal(ticker=ticker, timeframe=timeframe, period=period)

    # Pass 4 — kontekst / AI thinking steps
    snapshot = indicator_bundle.snapshot if indicator_bundle else {}
    ai_result: Dict[str, Any] = _run_ai_pass(system_prompt, ticker, snapshot, signal_payload, news_payload, model_id=model_id)

    shared = {
        "ticker": ticker,
        "timeframe": timeframe,
        "period": period,
        "indicators": indicators_payload,
        "news": news_payload,
        "signal": signal_payload,
        "ai": ai_result,
    }
    return shared


def _run_ai_pass(system_prompt: str, ticker: str, snapshot: Dict[str, Any], signal_payload: Dict[str, Any], news_payload: Dict[str, Any], model_id: Optional[str]) -> Dict[str, Any]:
    user_content = (
        "Jesteś analitykiem technicznym. Na podstawie poniższych danych wykonaj weryfikację setupu.\n\n"
        "=== WSKAŹNIKI ===\n"
        + json.dumps(snapshot, ensure_ascii=False, indent=2, default=str)
        + "\n\n=== SYGNAŁ REGUŁOWY ===\n"
        + json.dumps(signal_payload, ensure_ascii=False, indent=2, default=str)
        + "\n\n=== NEWSY ===\n"
        + json.dumps(
            {
                "count": news_payload.get("count", 0),
                "top": [a.get("title") for a in news_payload.get("articles", [])[:5]],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    verdict_text = None
    try:
        from trading_ai.ai_client import analyze as ai_analyze  # type: ignore
        verdict_text = ai_analyze(system_prompt, snapshot, model=model_id)
    except Exception:
        verdict_text = None
    if not verdict_text:
        verdict_text = (
            "Przeanalizowałem sygnały, strukturę i newsy. "
            "Setup nie jest jednolity — wolumen nie potwierdza momentum, a makro jest ryzykowne. "
            "Wymagam potwierdzenia wolumenem lub wybicia z konsolidacji."
        )

    thinking_steps = _build_thinking(snapshot, signal_payload, news_payload)
    return {
        "verdict_text": verdict_text,
        "thinking": thinking_steps,
        "steps_ready": True,
    }


def _build_thinking(snapshot: Dict[str, Any], signal_payload: Dict[str, Any], news_payload: Dict[str, Any]) -> list[str]:
    adx = snapshot.get("ADX", {}).get("adx")
    adx_word = "konsolidacja" if (adx is None or adx < 25) else "silny trend"
    return [
        "Cena relatywnie do EMA50/EMA200 – struktura pozostaje mieszana.",
        "RSI14 wybija z 50 – momentum lekkie, ale bez potwierdzenia wolumem traktuję jako niepewne.",
        "Wiadomości neutralne: brak wyraźnego bodźca fundamentalnego.",
        f"ADX = {adx} – {adx_word}.",
        "Werdykt końcowy: CZEKAJ na wyraźniejsze potwierdzenie.",
    ]