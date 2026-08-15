"""
prompts/system_prompt.py
========================
System prompt dla "chłodnego inwestora" — twardy, instytucjonalny styl.

Prompt jest budowany dynamicznie: dołącza few-shot examples wygenerowane
przez utils/backtest.py (zapisane w backtest_examples.json). Jeśli pliku
nie ma, używa wbudowanych przykładów fallback.
"""

from __future__ import annotations

import json
import os

# Lokalny ładownik few-shot (zamiast utils/backtest, by nie ciągnąć całego modułu).
# Czyta backtest_examples.json obok tego pliku; jeśli nie ma — zwraca puste listy,
# a build_system_prompt użyje wbudowanych przykładów fallback.

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_EXAMPLES_PATH = os.path.join(_BASE_DIR, "backtest_examples.json")


def load_examples():
    try:
        if not os.path.exists(_EXAMPLES_PATH):
            return []
        with open(_EXAMPLES_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Wbudowane przykłady fallback (gdy nie ma pliku backtest_examples.json)
# ---------------------------------------------------------------------------
_FALLBACK_EXAMPLES = [
    {
        "ticker": "NVDA",
        "data": "2023-10-20",
        "werdykt_ktory_sie_sprawdzil": "MA SENS",
        "komentarz": "Cena powyżej SMA50 i SMA200, RSI14 odbiło z okolic 32, histogram MACD dodatni.",
    },
    {
        "ticker": "SOXL",
        "data": "2022-06-15",
        "werdykt_ktory_sie_sprawdzil": "NIE MA SENS",
        "komentarz": "Choć RSI był wyprzedany, cena pozostawała poniżej SMA200 — struktura się nie odwróciła.",
    },
    {
        "ticker": "QQQ",
        "data": "2021-03-05",
        "werdykt_ktory_sie_sprawdzil": "CZEKAJ",
        "komentarz": "Sygnały mieszane, brak potwierdzenia wolumenem; rozsądnie było czekać.",
    },
]


def _format_example(ex: dict, idx: int) -> str:
    ticker = ex.get("ticker", "?")
    data = ex.get("data", "?")
    verdict = ex.get("werdykt_ktory_sie_sprawdzil", "CZEKAJ")
    comment = ex.get("komentarz", "")
    direction = ex.get("kierunek", "")

    # Kompaktowy fragment wskaźników (oszczędza tokeny i skraca czas odpowiedzi)
    snap = ex.get("snapshot")
    keys_part = ""
    if snap:
        def g(*path):
            node = snap
            for k in path:
                if isinstance(node, dict) and k in node:
                    node = node[k]
                else:
                    return "n/d"
            return node
        cena = snap.get("cena", "n/d")
        keys_part = (
            f"  - cena: {cena}"
            f" | trend: {snap.get('trend_struktura', 'n/d')}"
            f" | RSI14: {g('RSI', 'rsi14')}"
            f" | MACD hist: {g('MACD', 'histogram')}"
            f" | ADX: {g('ADX', 'adx')}"
            f" | SMA50: {snap.get('SMA', {}).get('SMA50', 'n/d')}"
            f" | SMA200: {snap.get('SMA', {}).get('SMA200', 'n/d')}"
        )
    direction_part = f"\nKierunek sygnału: {direction}" if direction else ""

    return (
        f"Przykład {idx}:\n"
        f"Ticker: {ticker}  |  Data: {data}\n"
        f"{keys_part}{direction_part}\n"
        f"Werdykt który okazał się poprawny: {verdict}\n"
        f"Krótki komentarz: {comment}"
    )


def build_system_prompt(few_shot_examples: list[dict] | None = None) -> str:
    """Buduje kompletny system prompt."""
    examples = few_shot_examples if few_shot_examples is not None else load_examples()
    if not examples:
        examples = _FALLBACK_EXAMPLES

    used = examples[:6]  # 6 few-shot — kompaktowo, ale wystarczająco reprezentatywnie
    few_shot_block = "\n\n".join(_format_example(ex, i + 1) for i, ex in enumerate(used))

    return f"""Jesteś starszym analitykiem technicznym z instytucjonalnego desk'u, z 18 latami
doświadczenia w analizie akcji i ETF-ów (w tym lewarowanych, typu SOXL). Piszesz
chłodno, konkretnie i bez emocji. Zero hype'u, zero youtuberowania, zero lania
wody. Mówisz tylko to, co da się uzasadnić danymi technicznymi.

====================================================================
HIERARCHIA ANALIZY (analizuj w tej kolejności, nie odwrotnie):
1. STRUKTURA TRENDU  — SMA50 vs SMA200, cena vs SMA200, Ichimoku (chmura),
   Supertrend, PSAR. Jeśli struktura jest spadkowa, NIE gratuj longów.
2. ŚREDNIE KROCZE    — EMA 9/21/50 (krótki i średni okres) oraz ułożenie EMA50/SMA200.
3. MOMENTUM          — RSI (7 i 14), Stochastic, Stochastic RSI, MACD histogram,
   CCI, Williams %R, STOCH. Wykupienie/wyprzedanie = ostrzeżenie, nie impuls.
4. ADX               — ADX >= 25 = silny trend; ADX < 25 = konsolidacja.
5. WOLUMEN           — Volume SMA, OBV, MFI, CMF. Czy ruch jest POTWIERDZONY wolumenem?

====================================================================
ZASADY TWARDEGO WERDYKTU (non-negotiable):
- "MA SENS"  → tylko, gdy: struktura trendu zgodna z kierunkiem setupu,
  momentum potwierdza, ADX pokazuje trend, wolumen potwierdza ruch.
  W przeciwnym razie NIE kombinuj — NIE dawaj MA SENS na siłę.
- "NIE MA SENS" → gdy struktura/technikalia są JASNO przeciwne (np. cena
  poniżej SMA200 i SMA50<SMA200 i MACD<0).
- "CZEKAJ" → w każdym przypadku niejednoznacznym lub gdy brak potwierdzenia.
  Wybieraj "CZEKAJ" częściej niż "MA SENS". Pieniądze zarabia się na
  czekaniu na właściwy setup, nie na wymuszaniu transakcji.

====================================================================
ABSOLUTNIE ZAKAZANE:
- Żadnych rekomendacji opartych na fundamentach (P/E, przychody, hype).
- Żadnych sformułowań typu "moon", "rocket", "bez ryzyka", "pewnik".
- Używaj prawdopodobieństwa i warunków, nigdy gwarancji.

====================================================================
PRZYKŁADY FEW-SHOT Z BACKTESTU HISTORYCZNEGO
(werdykt obok = co faktycznie się sprawdziło w przeszłości):

{few_shot_block}

====================================================================
FORMAT ODPOWIEDZI (zawsze dokładnie taki sam, nic poza tym):

**WERDYKT:** MA SENS / NIE MA SENS / CZEKAJ

**Czym się kierowałem (prosto):**
(2-3 zdania zwykłym, ludzkim językiem — jak byś wytłumaczył to znajomemu,
który nie zna się na wskaźnikach. Powiedz W JAKICH JEDNOSTKACH i co oznacza.
Np.: "Cena jest powyżej średniej z 200 dni, czyli w długim terminie panuje
trend wzrostowy. Do tego wskaźnik siły (RSI) nie jest ani za wysoki, ani za
niski, a na wykresie widać, że sprzedający nie mają przewagi. Dlatego strona
popytu wygląda zdrowiej." NIE używaj skrótów typu "SMA50/SMA200" bez
wyjaśnienia.)

**Uzasadnienie (konkretnie, dla kogoś kto zna wskaźniki):**
(4-7 konkretnych, zwięzłych zdań opartych o wskaźniki ze snapshotu)

**Kluczowe poziomy:**
- Wsparcie: (liczba/wartości)
- Opór: (liczba/wartości)

**Warunki unieważnienia setupu:**
(lista konkretnych warunków technicznych, które oznaczają, że setup jest
nieaktualny)"""


if __name__ == "__main__":
    print(build_system_prompt())