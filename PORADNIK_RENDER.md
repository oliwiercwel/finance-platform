# Poradnik krok po kroku: Wdrażanie projektu na Render

## Wstęp
Ten poradnik przeprowadzi Cię przez proces wdrażania Twojego projektu "finance platform" na platformie Render. Postępuj zgodnie z poniższymi krokami, aby Twoja strona działała poprawnie.

## Krok 1: Przygotowanie projektu
1. Upewnij się, że Twój projekt jest gotowy do wdrożenia
2. Sprawdź, czy wszystkie pliki projektu znajdują się w jednym folderze
3. Upewnij się, że masz plik `render.yaml` w głównym katalogu projektu

## Krok 2: Utworzenie konta na Render
1. Przejdź na stronę [https://render.com](https://render.com)
2. Zarejestruj się lub zaloguj na swoje konto
3. Kliknij "New" w panelu nawigacyjnym po lewej stronie

## Krok 3: Utworzenie nowego serwisu webowego
1. Wybierz "Web Service" z listy opcji
2. Połącz swoje konto GitHub, GitLab lub Bitbucket (jeśli jeszcze tego nie zrobiłeś)
3. Wybierz repozytorium zawierające Twój projekt "finance platform"

## Krok 4: Konfiguracja serwisu
1. Wprowadź nazwę dla swojego serwisu (np. "finance-platform")
2. Wybierz region, który jest najbliżej Twoich użytkowników
3. Wybierz typ instancji (dla początkujących polecamy najtańszą opcję)
4. Kliknij "Create Web Service"

## Krok 5: Konfiguracja wdrożenia
1. Render automatycznie wykryje plik `render.yaml` w Twoim projekcie
2. Jeśli nie masz pliku `render.yaml`, utwórz go w głównym katalogu projektu z następującą zawartością:

```yaml
services:
  - type: web
    name: finance-platform
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: python server_wsgi.py
    envVars:
      - key: PYTHON_VERSION
        value: 3.9.7
```

3. Upewnij się, że masz plik `requirements.txt` z wszystkimi zależnościami projektu
4. Upewnij się, że masz plik `server_wsgi.py` jako główny punkt wejścia aplikacji

## Krok 6: Wdrożenie aplikacji
1. Kliknij "Deploy" w panelu Render
2. Poczekaj, aż proces wdrożenia się zakończy (może to potrwać kilka minut)
3. Monitoruj logi wdrożenia, aby sprawdzić, czy nie występują błędy

## Krok 7: Testowanie aplikacji
1. Po zakończeniu wdrożenia, kliknij link do swojej aplikacji
2. Sprawdź, czy wszystkie funkcjonalności działają poprawnie
3. Przetestuj różne scenariusze użytkowania

## Krok 8: Monitorowanie i utrzymanie
1. Regularnie sprawdzaj logi aplikacji w panelu Render
2. Aktualizuj swój projekt i wdrażaj zmiany, gdy są gotowe
3. Monitoruj zużycie zasobów i dostosuj plan, jeśli jest to konieczne

## Rozwiązywanie problemów
Jeśli napotkasz problemy:
1. Sprawdź logi wdrożenia w panelu Render
2. Upewnij się, że wszystkie zależności są poprawnie zainstalowane
3. Sprawdź, czy plik `server_wsgi.py` jest poprawnie skonfigurowany
4. Skontaktuj się z wsparciem Render, jeśli problem nadal występuje

## Dodatkowe wskazówki
- Regularnie twórz kopie zapasowe swojego projektu
- Testuj zmiany lokalnie przed wdrożeniem
- Korzystaj z środowisk testowych, jeśli to możliwe
- Monitoruj wydajność aplikacji i optymalizuj ją w razie potrzeby

Powodzenia z wdrażaniem Twojego projektu "finance platform" na Render!