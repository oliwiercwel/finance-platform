"""
utils/ai_client.py
==================
Klient NVIDIA NIM (OpenAI-compatible) na darmowym endpoincie.
Klucz API pobierany jest z env (plik .env), a jako fallback wpisany
w kodzie — zgodnie z wymaganiem, by użytkownik nie musiał nic wpisywać ręcznie.

Automatyczny łańcuch modeli (fallback):
  1. model skonfigurowany / domyślny: nvidia/nemotron-3-ultra-550b-a55b
  2. z-ai/glm-5.2  (odpowiednik "glm-5.2" dostępny na NVIDIA)
  3. nvidia/llama-3.3-nemotron-super-49b-v1.5 (szybki, potwierdzony)

Jeśli model nie odpowie w zadanym czasie lub zwróci pustą treść,
przechodzimy do następnego. Dzięki temu aplikacja nigdy nie "wisi".

UWAGA: klucz w kodzie to wygoda lokalna. PRZED publikacją projektu w
publicznym repozytorium (np. Hugging Face Spaces) rozważ ustawienie
NVIDIA_API_KEY jako Secret/Environment Variable i usunięcie fallbacka.
"""

from __future__ import annotations

import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()  # wczytaj .env z katalogu roboczego

# Fallback klucza (do użytku lokalnego / demo)
_DEFAULT_API_KEY = "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"
_DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b"
_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"
_DEFAULT_TEMPERATURE = 0.25

# Modele do wyboru w interfejsie (2 główne z NVIDIA NIM).
MODEL_OPTIONS = {
    "Nemotron 3 Ultra 550B (główny)": "nvidia/nemotron-3-ultra-550b-a55b",
    "Inkling (reasoning)": "thinkingmachines/inkling",
}

# Łańcuch fallback (gdy wybrany model nie odpowie na czas):
# najpierw drugi model z listy, potem szybkie "ratunkowe".
_FALLBACK_MODELS = [
    "z-ai/glm-5.2",
    "nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",
]

# Czas (s) na pojedynczą próbę modelu — po nim przechodzimy do fallbacka.
REQUEST_TIMEOUT = 8.0


def get_api_key() -> str:
    return os.environ.get("NVIDIA_API_KEY", "").strip() or _DEFAULT_API_KEY


def get_model() -> str:
    return os.environ.get("NVIDIA_MODEL", "").strip() or _DEFAULT_MODEL


def get_base_url() -> str:
    return os.environ.get("NVIDIA_BASE_URL", "").strip() or _DEFAULT_BASE_URL


def get_temperature() -> float:
    try:
        return float(os.environ.get("NVIDIA_TEMPERATURE", _DEFAULT_TEMPERATURE))
    except ValueError:
        return float(_DEFAULT_TEMPERATURE)


def _client() -> OpenAI:
    # max_retries=0 i timeout, by nie zawieszać aplikacji na wolnych
    # odpowiedziach; błędy połączenia rzucają się od razu.
    return OpenAI(
        api_key=get_api_key(),
        base_url=get_base_url(),
        timeout=REQUEST_TIMEOUT,
        max_retries=0,
    )


def get_model_options() -> dict:
    """Zwraca dict {etykieta: id_modelu} do wyboru w interfejsie."""
    return dict(MODEL_OPTIONS)


def get_model_id_by_label(label: str) -> str | None:
    return MODEL_OPTIONS.get(label)


def _candidate_models(explicit: str | None) -> list[str]:
    """Kolejność prób: wybrany model → drugi model z listy → szybkie fallbacki."""
    models = []
    primary = (explicit or get_model()).strip()
    if primary:
        models.append(primary)
        # drugi "główny" model jako pierwszy fallback (np. Nemotron ↔ Inkling)
        others = [m for m in MODEL_OPTIONS.values() if m != primary]
        models.extend(others)
    for m in _FALLBACK_MODELS:
        if m not in models:
            models.append(m)
    return models


def _extract_text(message) -> str | None:
    """Wyciąga treść odpowiedzi; radzi sobie też z modelami reasoning."""
    content = getattr(message, "content", None)
    if content and str(content).strip():
        return str(content).strip()
    reasoning = getattr(message, "reasoning_content", None)
    if reasoning and str(reasoning).strip():
        return str(reasoning).strip()
    return None


def analyze(system_prompt: str, snapshot: dict, model: str | None = None,
            temperature: float | None = None, max_tokens: int = 1500) -> str:
    """Wysyła snapshot do NVIDIA NIM; wraca werdykt w tekście.
    Próbuje kolejno modele z łańcucha fallback, aż jeden odpowie treścią.
    """
    user_content = (
        "Poniżej snapshot wskaźników technicznych. Na jego podstawie wydaj "
        "werdykt w wymaganym formacie.\n\n"
        "SNAPSHOT:\n" + json.dumps(snapshot, ensure_ascii=False, indent=2, default=str)
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    temp = temperature if temperature is not None else get_temperature()

    errors = []
    for m in _candidate_models(model):
        try:
            resp = _client().chat.completions.create(
                model=m,
                messages=messages,
                temperature=temp,
                max_tokens=max_tokens,
            )
            if not resp.choices:
                raise RuntimeError("Brak choices w odpowiedzi.")
            text = _extract_text(resp.choices[0].message)
            if text:
                return text
            errors.append(f"{m}: pusta treść odpowiedzi")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{m}: {type(exc).__name__}: {exc}")

    # Brak odpowiedzi od wszystkich modeli — zwróć None, by backend użył fallbacka.
    return None


def followup(system_prompt: str, snapshot: dict, question: str,
             model: str | None = None, temperature: float | None = None,
             max_tokens: int = 800) -> str:
    """Odpowiada na dodatkowe pytanie użytkownika w kontekście snapshotu.

    Używa tego samego łańcucha modeli (fallback) co analyze().
    """
    user_content = (
        "Masz przed sobą wcześniej wykonaną analizę techniczną. "
        "Użytkownik zadaje dodatkowe pytanie. Odpowiadaj krótko, zwięźle "
        "(max kilka zdań), prostym, zrozumiałym językiem, po polsku.\n\n"
        "SNAPSHOT (wskaźniki):\n" + json.dumps(snapshot, ensure_ascii=False, indent=2, default=str) +
        "\n\nPYTANIE UŻYTKOWNIKA:\n" + question
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    temp = temperature if temperature is not None else get_temperature()

    errors = []
    for m in _candidate_models(model):
        try:
            resp = _client().chat.completions.create(
                model=m,
                messages=messages,
                temperature=temp,
                max_tokens=max_tokens,
            )
            if not resp.choices:
                raise RuntimeError("Brak choices w odpowiedzi.")
            text = _extract_text(resp.choices[0].message)
            if text:
                return text
            errors.append(f"{m}: pusta treść odpowiedzi")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{m}: {type(exc).__name__}: {exc}")

    # Brak odpowiedzi od wszystkich modeli — zwróć None, by backend użył fallbacka.
    return None


def chat(user_message: str, model: str | None = None,
         temperature: float | None = None, max_tokens: int = 1500) -> str:
    """Pełnoprawny czat bez ograniczeń, bez kontekstu rynkowego.

    Używa tego samego łańcucha modeli (fallback) co analyze().
    Odpowiada na WSZYSTKIE pytania po polsku.
    """
    system_prompt = (
        "Jesteś zaawansowanym asystentem AI. Odpowiadasz bez żadnych "
        "ograniczeń tematycznych. Jesteś szczery, otwarty i pomocny. "
        "Pisz po polsku, doceniaj humor, odpowiadaj na pytania o ALL."
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    temp = temperature if temperature is not None else get_temperature()

    errors = []
    for m in _candidate_models(model):
        try:
            resp = _client().chat.completions.create(
                model=m,
                messages=messages,
                temperature=temp,
                max_tokens=max_tokens,
            )
            if not resp.choices:
                raise RuntimeError("Brak choices w odpowiedzi.")
            text = _extract_text(resp.choices[0].message)
            if text:
                return text
            errors.append(f"{m}: pusta treść odpowiedzi")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{m}: {type(exc).__name__}: {exc}")

    # Brak odpowiedzi od wszystkich modeli — zwróć None, by backend użył fallbacka.
    return None