# FinanceHub - Platforma Finansowa 📈

Platforma do śledzenia rynków finansowych w czasie rzeczywistym z danymi z Yahoo Finance.

## 🚀 Szybki start (lokalnie)

### Wymagania:
- **Python 3** (zainstalowany)
- Przeglądarka internetowa

### Uruchomienie:
```bash
cd backend
python server.py
```
Otwórz: **http://localhost:8000**

## 🌐 Wdrożenie na Render.com (DARMOWE)

### Krok 1: Utwórz repozytorium GitHub
1. Załóż konto na [github.com](https://github.com) (darmowe)
2. Utwórz **nowe repozytorium** np. `finance-platform`
3. Wgraj całą zawartość folderu `finance-platform`

### Krok 2: Załóż konto na Render.com
1. Wejdź na [render.com](https://render.com) i zarejestruj się
2. Kliknij **"New +"** → **"Web Service"**
3. Podepnij swoje konto GitHub
4. Wybierz repozytorium `finance-platform`

### Krok 3: Konfiguracja
Ustaw następujące opcje:
- **Name:** `financehub`
- **Environment:** `Python`
- **Build Command:** (puste - brak zależności)
- **Start Command:** `cd backend && python server.py`
- **Instance Type:** Free (darmowy)

### Krok 4: Wdrożenie
Kliknij **"Create Web Service"**

Render automatycznie:
- Pobraze kod z GitHub
- Zainstaluje Pythona
- Uruchomi serwer
- Przydzieli darmowy URL np. `https://financehub.onrender.com`

### Krok 5: Gotowe! 🎉
Twoja strona działa pod adresem:
**https://financehub.onrender.com**

## 📊 Funkcje

- **Rynki w czasie rzeczywistym** - aktualne notowania z Yahoo Finance
- **Zaawansowana wyszukiwarka** - wyszukaj dowolny ticker z całego świata
- **Szczegóły akcji** - kliknij na wynik, aby zobaczyć pełne dane
- **Newsy** - aktualne wiadomości finansowe
- **Wykresy** - historia cen dla wybranego symbolu
- **Portfolio** - śledź swoje inwestycje

## 📁 Struktura projektu

```
finance-platform/
├── backend/
│   ├── server.py          # Serwer Python (proxy do Yahoo Finance)
│   └── Procfile           # Konfiguracja Render
└── frontend/
    ├── index.html         # Strona główna
    ├── css/style.css      # Style
    └── js/app.js          # Logika aplikacji
```

## ⚙️ Technologie

- **Backend:** Python (bez zależności - wbudowany http.server)
- **Frontend:** HTML, CSS, JavaScript, Chart.js
- **Dane:** Yahoo Finance API

## ⚠️ Uwagi

- Darmowy tier Render.com ma limit 750 godzin/miesiąc (wystarczy dla 1-2 osób)
- Serwer może się "uśpić" po 15 minutach bezczynności na darmowym tierze
- Pierwsze otwarcie po uśpieniu może potrwać kilka sekund