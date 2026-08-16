# Finance Platform

Finance Platform to aplikacja webowa do śledzenia notowań giełdowych, walut i kryptowalut.

## Funkcje

- Śledzenie notowań akcji z różnych giełd (GPW, NASDAQ, NYSE, Europa, Chiny)
- Monitorowanie kursów kryptowalut (BTC, ETH, BNB, XRP, ADA, SOL, DOGE)
- Śledzenie kursów walut (EUR/PLN, USD/PLN, GBP/USD, USD/JPY, EUR/USD)
- Śledzenie cen towarów (złoto, srebro, ropa, gaz)
- Wyszukiwanie zaawansowane instrumentów finansowych
- Historia notowań dla poszczególnych instrumentów
- Aktualności finansowe

## Technologie

- **Backend**: Python 3.9.7
- **Frontend**: HTML, CSS, JavaScript
- **API**: Yahoo Finance API
- **Serwer**: Wbudowany serwer HTTP Pythona

## Wymagania

- Python 3.9.7
- Zależności z pliku `backend/requirements.txt`

## Instalacja

1. Sklonuj repozytorium:
   ```bash
   git clone https://github.com/oliwiercwel/finance-platform.git
   cd finance-platform
   ```

2. Zainstaluj zależności:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. Uruchom serwer:
   ```bash
   python server.py
   ```

4. Otwórz przeglądarkę i przejdź do:
   ```
   http://localhost:8000
   ```

## Wdrożenie na Render

Projekt jest skonfigurowany do automatycznego wdrożenia na platformie Render. Plik `render.yaml` zawiera niezbędną konfigurację.

### Auto-deploy z GitHub

1. Wypchnij kod do repozytorium (domyślnie branch `main`).
2. Utwórz konto i serwis na [Render](https://render.com).
3. W ustawieniach serwisu włącz **Auto Deploy** i połącz z repozytorium `finance-platform`.
4. Dla całkowitej automatyzacji dodaj w GitHub Secrets:
   - `RENDER_API_KEY`
   - `RENDER_SERVICE_ID`
5. Push do `main` uruchamia automatyczny build i deploy.

### Konfiguracja Render

Plik `render.yaml` zawiera następującą konfigurację:

```yaml
services:
  - type: web
    name: finance-platform
    runtime: python
    buildCommand: "cd backend && pip install -r requirements.txt"
    startCommand: "cd backend && python server.py"
    envVars:
      - key: PYTHON_VERSION
        value: 3.9.7
    plan: free
```

## Struktura projektu

```
finance-platform/
├── backend/                  # Kod backendowy
│   ├── server.py             # Główny serwer API
│   ├── requirements.txt      # Zależności Pythona
│   └── database/             # Pliki bazy danych
├── frontend/                 # Kod frontendowy
│   ├── index.html            # Główny plik HTML
│   ├── css/                  # Pliki CSS
│   └── js/                   # Pliki JavaScript
├── render.yaml               # Konfiguracja Render
├── .gitignore                # Pliki ignorowane przez Git
└── README.md                 # Ten plik
```

## API

Aplikacja udostępnia następujące endpointy API:

- `GET /api/health` - Sprawdzenie statusu serwera
- `GET /api/stocks` - Lista wszystkich notowań
- `GET /api/search/advanced?q={query}` - Wyszukiwanie instrumentów
- `GET /api/stocks/{symbol}/detail` - Szczegóły instrumentu
- `GET /api/stocks/{symbol}/history?period={period}` - Historia notowań
- `GET /api/news` - Aktualności finansowe

## Licencja

MIT

## Autor

Oliwier Cwel