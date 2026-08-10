import json
import urllib.request
import urllib.parse
import os
import sys
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime, timedelta
import calendar as cal_module

# Lista popularnych symboli
ALL_SYMBOLS = [
    # 🇵🇱 GPW
    'WIG20.WA', 'PKN.WA', 'PKO.WA', 'DNP.WA', 'PZU.WA', 'LPP.WA', 'CDR.WA', 'SPL.WA',
    # 🇺🇸 NASDAQ/NYSE
    'AAPL', 'TSLA', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC',
    # 🇪🇺 Europa
    'SAP.DE', 'ASML.AS', 'LVMH.PA', 'TTE.PA', 'SIE.DE', 'MC.PA', 'SANTANDER.MC', 'BMW.DE',
    # 🇨🇳 Chiny
    'BABA', 'BIDU', 'NIO', 'XPEV', 'LI', 'JD', 'PDD', 'BILI',
    # 🇰🇷 Korea
    '005930.KS', '000660.KS', 'HYMTF', '006400.KS',
    # 🪙 Kryptowaluty
    'BTC-USD', 'ETH-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'SOL-USD', 'DOGE-USD',
    # 💱 Waluty
    'EURPLN=X', 'USDPLN=X', 'GBPUSD=X', 'USDJPY=X', 'EURUSD=X',
    # 🛢️ Towary
    'GC=F', 'SI=F', 'CL=F', 'NG=F'
]

# ============================================================
# KALENDARZ EKONOMICZNY - TŁUMACZENIA + WPŁYW NA RYNKI (PL)
# ============================================================
EVENT_TRANSLATIONS = {
    'FOMC Rate Decision': {
        'pl': 'Decyzja FED o stopach procentowych',
        'impact': 'high',
        'market_impact': 'Podwyżka: 📈 USD/PLN ↑, 📉 WIG20 ↓, 📉 S&P500 ↓, 📈 Rentowność obligacji US ↑ | Obniżka: odwrotnie'
    },
    'CPI YoY': {
        'pl': 'Inflacja CPI (rocznie)',
        'impact': 'high',
        'market_impact': 'Wynik > prognozy: 📈 USD/PLN ↑, 📉 WIG20 ↓, 📉 S&P500 ↓ (ryzyko podwyżek FED) | Wynik < prognozy: odwrotnie'
    },
    'Core CPI YoY': {
        'pl': 'Inflacja CPI Core (rocznie, bez energii i żywności)',
        'impact': 'high',
        'market_impact': 'Kluczowy dla FED. Wyższy = 📈 USD ↑, 📉 Akcje ↓ | Niższy = 📉 USD, 📈 Akcje'
    },
    'Non-Farm Payrolls': {
        'pl': 'NFP - Zmiana zatrudnienia (sektor nierolny)',
        'impact': 'high',
        'market_impact': 'Silny (>200k): 📈 USD/PLN ↑, 📉 WIG20 ↓, 📉 S&P500 ↓ (FED trzyma wysokie stopy) | Słaby: 📉 USD, 📈 Akcje'
    },
    'Unemployment Rate': {
        'pl': 'Stopa bezrobocia',
        'impact': 'high',
        'market_impact': 'Rosnąca: 📉 USD, 📈 Akcje (FED może obniżyć stopy) | Malejąca: 📈 USD, 📉 Akcje'
    },
    'GDP QoQ': {
        'pl': 'PKB (kwartał do kwartału)',
        'impact': 'high',
        'market_impact': 'Wysoki (>3%): 📈 Akcje USA, 📈 USD (silna gospodarka) | Niski/ujemny: 📉 Akcje, 📉 USD (recesja)'
    },
    'Retail Sales MoM': {
        'pl': 'Sprzedaż detaliczna (miesiąc do miesiąca)',
        'impact': 'medium',
        'market_impact': 'Rosnąca: 📈 S&P500, 📈 USD (silny konsument) | Spadająca: 📉 Akcje, obawy o recesję'
    },
    'PPI YoY': {
        'pl': 'Inflacja producentów PPI (rocznie)',
        'impact': 'medium',
        'market_impact': 'Wysoki: 📈 USD ↑, 📉 Akcje (przyszła wyższa CPI) | Niski: 📉 USD, 📈 Akcje'
    },
    'ISM Manufacturing PMI': {
        'pl': 'PMI Przemysłowe ISM',
        'impact': 'medium',
        'market_impact': '>50: 📈 S&P500, 📈 USD (ekspansja) | <50: 📉 Akcje, 📉 USD (kontrakcja) | <45: 📉📉 Ryzyko recesji'
    },
    'ISM Services PMI': {
        'pl': 'PMI Usług ISM',
        'impact': 'medium',
        'market_impact': '>50: 📈 S&P500 (usługi = 80% PKB USA) | <50: 📉 Akcje, 📉 USD'
    },
    'Durable Goods Orders': {
        'pl': 'Zamówienia dóbr trwałego użytku',
        'impact': 'medium',
        'market_impact': 'Rosnące: 📈 Akcje przemysłowe, 📈 USD (inwestycje firm) | Spadające: 📉 Akcje'
    },
    'Building Permits': {
        'pl': 'Pozwolenia na budowę',
        'impact': 'low',
        'market_impact': 'Więcej: 📈 Akcje deweloperskie, 📈 USD (zdrowy rynek nieruchomości)'
    },
    'Housing Starts': {
        'pl': 'Rozpoczęcia budowy domów',
        'impact': 'low',
        'market_impact': 'Więcej: 📈 S&P500, 📈 USD | Mniej: 📉 Akcje budowlane'
    },
    'Consumer Confidence': {
        'pl': 'Zaufanie konsumentów (Conference Board)',
        'impact': 'medium',
        'market_impact': 'Wysokie: 📈 S&P500, 📈 USD (konsumenci wydają) | Niskie: 📉 Akcje, obawy o recesję'
    },
    'Michigan Consumer Sentiment': {
        'pl': 'Sentyment konsumentów (Uniwersytet Michigan)',
        'impact': 'medium',
        'market_impact': 'Wysokie: 📈 S&P500, 📈 USD | Niskie: 📉 Akcje. Zawiera oczekiwania inflacyjne (ważne dla FED)'
    },
    'ECB Rate Decision': {
        'pl': 'Decyzja EZB o stopach procentowych',
        'impact': 'high',
        'market_impact': 'Podwyżka: 📈 EUR/PLN ↑, 📈 WIG20 (sektor bankowy) ↑, 📉 EUR/USD ↓ | Obniżka: 📉 EUR/PLN, 📉 Banki'
    },
    'ECB Press Conference': {
        'pl': 'Konferencja prasowa EZB',
        'impact': 'high',
        'market_impact': 'Hawkish (twardy ton): 📈 EUR/PLN ↑, 📈 Banki EU | Dovish (miękki): 📉 EUR/PLN, 📉 Banki'
    },
    'Eurozone CPI YoY': {
        'pl': 'Inflacja strefy euro (rocznie)',
        'impact': 'high',
        'market_impact': 'Wysoka: 📈 EUR/PLN ↑, 📈 Rentowność obligacji DE ↑, ryzyko podwyżek EZB | Niska: 📉 EUR'
    },
    'Eurozone PMI Manufacturing': {
        'pl': 'PMI Przemysłowe strefy euro',
        'impact': 'medium',
        'market_impact': '>50: 📈 DAX, 📈 EUR/PLN (Niemcy = lokomotywa) | <50: 📉 Giełdy EU, 📉 EUR'
    },
    'BoE Rate Decision': {
        'pl': 'Decyzja BoE o stopach procentowych',
        'impact': 'high',
        'market_impact': 'Podwyżka: 📈 GBP/PLN ↑, 📈 FTSE100 (banki) | Obniżka: 📉 GBP/PLN, 📉 Giełda Londynu'
    },
    'UK CPI YoY': {
        'pl': 'Inflacja Wielkiej Brytanii (rocznie)',
        'impact': 'high',
        'market_impact': 'Wysoka: 📈 GBP/PLN ↑, ryzyko podwyżek BoE | Niska: 📉 GBP'
    },
    'BoJ Rate Decision': {
        'pl': 'Decyzja BoJ o stopach procentowych',
        'impact': 'high',
        'market_impact': 'Podwyżka (rzadkie): 📈 JPY/PLN ↑, 📉 Nikkei225 (carry trade unwind) | Status quo: neutralne'
    },
    'China PMI Manufacturing': {
        'pl': 'PMI Przemysłowe Chiny (Caixin/NBS)',
        'impact': 'medium',
        'market_impact': '>50: 📈 Surowce (miedź, żelazo) ↑, 📈 Giełdy EM | <50: 📉 Surowce, 📉 AUD, 📉 Giełdy Azji'
    },
    'Australia Rate Decision': {
        'pl': 'Decyzja RBA o stopach procentowych',
        'impact': 'medium',
        'market_impact': 'Podwyżka: 📈 AUD/PLN ↑, 📈 ASX200 (banki) | Obniżka: 📉 AUD, 📉 Surowce'
    },
    'Canada Rate Decision': {
        'pl': 'Decyzja BoC o stopach procentowych',
        'impact': 'medium',
        'market_impact': 'Podwyżka: 📈 CAD/PLN ↑, 📈 TSX (banki, energia) | Obniżka: 📉 CAD, 📉 Ropa'
    },
    'New Zealand Rate Decision': {
        'pl': 'Decyzja RBNZ o stopach procentowych',
        'impact': 'low',
        'market_impact': 'Często pierwszy ruchuje stopy. Podwyżka: 📈 NZD | Obniżka: 📉 NZD (wskazówka dla FED/EZB)'
    },
    'OPEC+ Meeting': {
        'pl': 'Spotkanie OPEC+',
        'impact': 'high',
        'market_impact': 'Obniżka produkcji: 📈 Ropa (CL) ↑, 📈 Akcje energetyczne, 📈 Inflacja ↑ | Zwiększenie: 📉 Ropa, 📉 Energetyka'
    },
    'EIA Crude Oil Inventory': {
        'pl': 'Zapasy ropy EIA (tygodniowe)',
        'impact': 'medium',
        'market_impact': 'Wzrost zapasów: 📉 Ropa (CL) ↓, 📉 Akcje energetyczne | Spadek: 📈 Ropa ↑, 📈 Energetyka'
    },
    'Fed Speakers': {
        'pl': 'Wystąpienia członków FED',
        'impact': 'medium',
        'market_impact': 'Hawkish: 📈 USD/PLN ↑, 📉 S&P500, 📈 Rentowność 10Y US ↑ | Dovish: 📉 USD, 📈 Akcje'
    },
    'Treasury Auction': {
        'pl': 'Aukcje obligacji skarbowych USA',
        'impact': 'low',
        'market_impact': 'Słaby popyt (wysoka rentowność): 📈 USD, 📉 Akcje, 📈 Rentowność 10Y ↑ | Silny popyt: odwrotnie'
    }
}

# ============================================================
# FUNKCJA GENERUJĄCA PRZYKŁADOWE WYDARZENIA (FALLBACK)
# ============================================================
def generate_sample_calendar_events():
    """Generuje przykładowe wydarzenia na najbliższe 30 dni gdy Yahoo nie działa"""
    from datetime import timedelta
    import random
    
    base_events = [
        {'event': 'FOMC Rate Decision', 'time': '20:00', 'country': 'US', 'currency': 'USD', 'impact': 'high'},
        {'event': 'CPI YoY', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'high'},
        {'event': 'Non-Farm Payrolls', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'high'},
        {'event': 'ECB Rate Decision', 'time': '14:15', 'country': 'DE', 'currency': 'EUR', 'impact': 'high'},
        {'event': 'Eurozone CPI YoY', 'time': '11:00', 'country': 'DE', 'currency': 'EUR', 'impact': 'high'},
        {'event': 'BoE Rate Decision', 'time': '13:00', 'country': 'GB', 'currency': 'GBP', 'impact': 'high'},
        {'event': 'UK CPI YoY', 'time': '08:00', 'country': 'GB', 'currency': 'GBP', 'impact': 'high'},
        {'event': 'BoJ Rate Decision', 'time': '03:00', 'country': 'JP', 'currency': 'JPY', 'impact': 'high'},
        {'event': 'ISM Manufacturing PMI', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'ISM Services PMI', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'Retail Sales MoM', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'PPI YoY', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'Durable Goods Orders', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'Consumer Confidence', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'Eurozone PMI Manufacturing', 'time': '10:00', 'country': 'DE', 'currency': 'EUR', 'impact': 'medium'},
        {'event': 'China PMI Manufacturing', 'time': '03:45', 'country': 'CN', 'currency': 'CNY', 'impact': 'medium'},
        {'event': 'Australia Rate Decision', 'time': '05:30', 'country': 'AU', 'currency': 'AUD', 'impact': 'medium'},
        {'event': 'Canada Rate Decision', 'time': '16:00', 'country': 'CA', 'currency': 'CAD', 'impact': 'medium'},
        {'event': 'OPEC+ Meeting', 'time': '15:00', 'country': 'INT', 'currency': 'USD', 'impact': 'high'},
        {'event': 'EIA Crude Oil Inventory', 'time': '16:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'Building Permits', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'low'},
        {'event': 'Housing Starts', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'low'},
        {'event': 'Michigan Consumer Sentiment', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
        {'event': 'Fed Speakers', 'time': '18:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium'},
    ]
    
    events = []
    today = datetime.now()
    
    for i in range(30):
        current_date = today + timedelta(days=i)
        date_str = current_date.strftime('%Y-%m-%d')
        
        # 2-4 wydarzenia dziennie
        num_events = random.randint(2, 4)
        day_events = random.sample(base_events, num_events)
        
        for ev in day_events:
            translation = EVENT_TRANSLATIONS.get(ev['event'], {})
            events.append({
                'date': date_str,
                'time': ev['time'],
                'event': ev['event'],
                'event_pl': translation.get('pl', ev['event']),
                'country': ev['country'],
                'currency': ev['currency'],
                'actual': None,
                'forecast': None,
                'previous': None,
                'importance': 3 if ev['impact'] == 'high' else 2 if ev['impact'] == 'medium' else 1,
                'impact': ev['impact'],
                'market_impact': translation.get('market_impact', 'Brak danych.')
            })
    
    return events


def generate_sample_calendar_events_with_forecasts():
    """Generuje przykładowe wydarzenia z realistycznymi prognozami na najbliższe 30 dni gdy Yahoo nie działa"""
    from datetime import timedelta
    import random
    
    base_events = [
        {'event': 'FOMC Rate Decision', 'time': '20:00', 'country': 'US', 'currency': 'USD', 'impact': 'high', 'forecast_val': '4.50%', 'actual_val': None, 'previous_val': '4.50%'},
        {'event': 'CPI YoY', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'high', 'forecast_val': '3.1%', 'actual_val': None, 'previous_val': '3.0%'},
        {'event': 'Core CPI YoY', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'high', 'forecast_val': '3.3%', 'actual_val': None, 'previous_val': '3.3%'},
        {'event': 'Non-Farm Payrolls', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'high', 'forecast_val': '180K', 'actual_val': None, 'previous_val': '175K'},
        {'event': 'Unemployment Rate', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'high', 'forecast_val': '3.9%', 'actual_val': None, 'previous_val': '3.9%'},
        {'event': 'GDP QoQ', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'high', 'forecast_val': '2.8%', 'actual_val': None, 'previous_val': '3.0%'},
        {'event': 'Retail Sales MoM', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '0.3%', 'actual_val': None, 'previous_val': '0.1%'},
        {'event': 'PPI YoY', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '2.2%', 'actual_val': None, 'previous_val': '2.1%'},
        {'event': 'ISM Manufacturing PMI', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '49.5', 'actual_val': None, 'previous_val': '49.2'},
        {'event': 'ISM Services PMI', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '51.0', 'actual_val': None, 'previous_val': '51.4'},
        {'event': 'Durable Goods Orders', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '0.5%', 'actual_val': None, 'previous_val': '-0.2%'},
        {'event': 'Consumer Confidence', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '102.0', 'actual_val': None, 'previous_val': '101.3'},
        {'event': 'Michigan Consumer Sentiment', 'time': '16:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '72.0', 'actual_val': None, 'previous_val': '71.8'},
        {'event': 'Building Permits', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'low', 'forecast_val': '1.45M', 'actual_val': None, 'previous_val': '1.44M'},
        {'event': 'Housing Starts', 'time': '14:30', 'country': 'US', 'currency': 'USD', 'impact': 'low', 'forecast_val': '1.35M', 'actual_val': None, 'previous_val': '1.33M'},
        {'event': 'ECB Rate Decision', 'time': '14:15', 'country': 'DE', 'currency': 'EUR', 'impact': 'high', 'forecast_val': '3.75%', 'actual_val': None, 'previous_val': '3.75%'},
        {'event': 'ECB Press Conference', 'time': '14:45', 'country': 'DE', 'currency': 'EUR', 'impact': 'high', 'forecast_val': '', 'actual_val': None, 'previous_val': ''},
        {'event': 'Eurozone CPI YoY', 'time': '11:00', 'country': 'DE', 'currency': 'EUR', 'impact': 'high', 'forecast_val': '2.4%', 'actual_val': None, 'previous_val': '2.4%'},
        {'event': 'Eurozone PMI Manufacturing', 'time': '10:00', 'country': 'DE', 'currency': 'EUR', 'impact': 'medium', 'forecast_val': '46.0', 'actual_val': None, 'previous_val': '45.8'},
        {'event': 'BoE Rate Decision', 'time': '13:00', 'country': 'GB', 'currency': 'GBP', 'impact': 'high', 'forecast_val': '5.25%', 'actual_val': None, 'previous_val': '5.25%'},
        {'event': 'UK CPI YoY', 'time': '08:00', 'country': 'GB', 'currency': 'GBP', 'impact': 'high', 'forecast_val': '2.0%', 'actual_val': None, 'previous_val': '2.0%'},
        {'event': 'BoJ Rate Decision', 'time': '03:00', 'country': 'JP', 'currency': 'JPY', 'impact': 'high', 'forecast_val': '0.10%', 'actual_val': None, 'previous_val': '0.10%'},
        {'event': 'China PMI Manufacturing', 'time': '03:45', 'country': 'CN', 'currency': 'CNY', 'impact': 'medium', 'forecast_val': '50.5', 'actual_val': None, 'previous_val': '50.4'},
        {'event': 'Australia Rate Decision', 'time': '05:30', 'country': 'AU', 'currency': 'AUD', 'impact': 'medium', 'forecast_val': '4.35%', 'actual_val': None, 'previous_val': '4.35%'},
        {'event': 'Canada Rate Decision', 'time': '16:00', 'country': 'CA', 'currency': 'CAD', 'impact': 'medium', 'forecast_val': '4.75%', 'actual_val': None, 'previous_val': '4.75%'},
        {'event': 'New Zealand Rate Decision', 'time': '03:00', 'country': 'NZ', 'currency': 'NZD', 'impact': 'low', 'forecast_val': '5.50%', 'actual_val': None, 'previous_val': '5.50%'},
        {'event': 'OPEC+ Meeting', 'time': '15:00', 'country': 'INT', 'currency': 'USD', 'impact': 'high', 'forecast_val': '', 'actual_val': None, 'previous_val': ''},
        {'event': 'EIA Crude Oil Inventory', 'time': '16:30', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '-1.5M', 'actual_val': None, 'previous_val': '-2.1M'},
        {'event': 'Fed Speakers', 'time': '18:00', 'country': 'US', 'currency': 'USD', 'impact': 'medium', 'forecast_val': '', 'actual_val': None, 'previous_val': ''},
        {'event': 'Treasury Auction', 'time': '13:00', 'country': 'US', 'currency': 'USD', 'impact': 'low', 'forecast_val': '', 'actual_val': None, 'previous_val': ''},
    ]
    
    events = []
    today = datetime.now()
    
    for i in range(30):
        current_date = today + timedelta(days=i)
        date_str = current_date.strftime('%Y-%m-%d')
        
        # 2-4 wydarzenia dziennie
        num_events = random.randint(2, 4)
        day_events = random.sample(base_events, num_events)
        
        for ev in day_events:
            translation = EVENT_TRANSLATIONS.get(ev['event'], {})
            events.append({
                'date': date_str,
                'time': ev['time'],
                'event': ev['event'],
                'event_pl': translation.get('pl', ev['event']),
                'country': ev['country'],
                'currency': ev['currency'],
                'actual': ev['actual_val'],
                'forecast': ev['forecast_val'],
                'previous': ev['previous_val'],
                'importance': 3 if ev['impact'] == 'high' else 2 if ev['impact'] == 'medium' else 1,
                'impact': ev['impact'],
                'market_impact': translation.get('market_impact', 'Brak danych.')
            })
    
    return events

# Cache dla kalendarza (2 godziny)
_calendar_cache = {'data': None, 'timestamp': 0}
CACHE_TTL = 7200  # 2 godziny w sekundach

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')

def fetch_yahoo(url):
    """Pobierz dane z Yahoo Finance"""
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode('utf-8'))

def fetch_quote(symbol):
    """Pobierz notowanie pojedynczego symbolu przez API v8"""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?range=1d&interval=1d"
    data = fetch_yahoo(url)
    
    if not data or 'chart' not in data or not data['chart']['result']:
        return None
    
    result = data['chart']['result'][0]
    meta = result.get('meta', {})
    quote = result.get('indicators', {}).get('quote', [{}])[0] if result.get('indicators') else {}
    
    # Pobierz cenę z meta
    price = meta.get('regularMarketPrice') or 0
    prev_close = meta.get('chartPreviousClose') or meta.get('previousClose') or price
    change = ((price - prev_close) / prev_close * 100) if prev_close else 0
    
    return {
        'symbol': meta.get('symbol', symbol),
        'name': meta.get('shortName') or meta.get('longName') or symbol,
        'price': price,
        'change': change,
        'changeAbs': price - prev_close,
        'volume': format_volume(meta.get('regularMarketVolume')),
        'cap': format_market_cap(meta.get('marketCap')),
        'currency': meta.get('currency') or 'USD',
        'high': meta.get('regularMarketDayHigh') or 0,
        'low': meta.get('regularMarketDayLow') or 0,
        'open': meta.get('regularMarketOpen') or 0,
        'previousClose': prev_close,
        'fiftyTwoWeekHigh': meta.get('fiftyTwoWeekHigh') or 0,
        'fiftyTwoWeekLow': meta.get('fiftyTwoWeekLow') or 0,
        'marketState': meta.get('marketState') or 'CLOSED',
        'exchange': meta.get('fullExchangeName') or meta.get('exchangeName') or '',
        'quoteType': meta.get('instrumentType') or 'EQUITY'
    }

def format_volume(volume):
    if not volume:
        return '0'
    if volume >= 1e9:
        return f"{volume/1e9:.1f}B"
    if volume >= 1e6:
        return f"{volume/1e6:.1f}M"
    if volume >= 1e3:
        return f"{volume/1e3:.1f}K"
    return str(volume)

def format_market_cap(market_cap):
    if not market_cap:
        return 'N/A'
    if market_cap >= 1e12:
        return f"{market_cap/1e12:.1f}T"
    if market_cap >= 1e9:
        return f"{market_cap/1e9:.1f}B"
    if market_cap >= 1e6:
        return f"{market_cap/1e6:.1f}M"
    return str(market_cap)

def send_json(handler, data, status=200):
    """Wyślij odpowiedź JSON"""
    body = json.dumps(data).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.end_headers()
    handler.wfile.write(body)

def send_file(handler, filepath, content_type):
    """Wyślij plik statyczny"""
    try:
        with open(filepath, 'rb') as f:
            body = f.read()
        handler.send_response(200)
        handler.send_header('Content-Type', content_type)
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except FileNotFoundError:
        send_json(handler, {'error': 'Not found'}, 404)

def handle_api(handler, path, query_params):
    """Obsługa API"""
    try:
        # /api/health
        if path == '/api/health':
            send_json(handler, {'status': 'ok', 'timestamp': datetime.now().isoformat()})
            return

        # /api/stocks
        if path == '/api/stocks':
            results = []
            for symbol in ALL_SYMBOLS:
                try:
                    quote = fetch_quote(symbol)
                    if quote:
                        results.append(quote)
                except Exception:
                    continue
            send_json(handler, results)
            return

        # /api/search/advanced
        if path == '/api/search/advanced':
            query = query_params.get('q', [''])[0]
            if not query or len(query) < 2:
                send_json(handler, [])
                return
            
            url = f"https://query1.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(query)}&quotesCount=20&newsCount=0"
            data = fetch_yahoo(url)
            
            if not data or 'quotes' not in data or not data['quotes']:
                send_json(handler, [])
                return
            
            symbols = [q['symbol'] for q in data['quotes'][:15]]
            results = []
            
            for symbol in symbols:
                try:
                    quote = fetch_quote(symbol)
                    if quote:
                        search_quote = next((sq for sq in data['quotes'] if sq['symbol'] == symbol), {})
                        quote['type'] = search_quote.get('quoteType') or quote.get('quoteType') or 'EQUITY'
                        quote['marketCap'] = quote.get('cap', 'N/A')
                        results.append(quote)
                except Exception:
                    continue
            
            send_json(handler, results)
            return

        # /api/stocks/{symbol}/detail
        if path.startswith('/api/stocks/') and path.endswith('/detail'):
            symbol = path.split('/')[3]
            quote = fetch_quote(symbol)
            
            if not quote:
                send_json(handler, {'error': 'Nie znaleziono'}, 404)
                return
            
            # Dodaj dodatkowe dane (można rozszerzyć)
            quote['averageVolume'] = 'N/A'
            quote['peRatio'] = None
            quote['dividendYield'] = None
            quote['beta'] = None
            quote['eps'] = None
            quote['earningsDate'] = None
            
            send_json(handler, quote)
            return

        # /api/stocks/{symbol}/history
        if path.startswith('/api/stocks/') and path.endswith('/history'):
            symbol = path.split('/')[3]
            period = query_params.get('period', ['1M'])[0]
            range_map = {'1D': '5d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '1Y': '1y'}
            range_val = range_map.get(period, '1mo')
            
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range_val}&interval=1d"
            data = fetch_yahoo(url)
            
            if not data or 'chart' not in data or not data['chart']['result']:
                send_json(handler, [])
                return
            
            result = data['chart']['result'][0]
            timestamps = result.get('timestamp', [])
            prices = result.get('indicators', {}).get('quote', [{}])[0].get('close', [])
            
            history = []
            for i, ts in enumerate(timestamps):
                if i < len(prices) and prices[i] is not None:
                    history.append({
                        'date': datetime.fromtimestamp(ts).strftime('%Y-%m-%d'),
                        'close': prices[i]
                    })
            
            send_json(handler, history)
            return

        # /api/news
        if path == '/api/news':
            urls = [
                'https://query1.finance.yahoo.com/v1/finance/search?q=stocks&newsCount=10',
                'https://query1.finance.yahoo.com/v1/finance/search?q=investing&newsCount=10',
                'https://query1.finance.yahoo.com/v1/finance/search?q=finance&newsCount=10'
            ]
            
            for url in urls:
                data = fetch_yahoo(url)
                if data and 'news' in data and data['news']:
                    news = []
                    for item in data['news']:
                        news.append({
                            'title': item.get('title', ''),
                            'description': item.get('summary', ''),
                            'url': item.get('link', '#'),
                            'published_at': datetime.fromtimestamp(item.get('providerPublishTime', 0)).strftime('%Y-%m-%d'),
                            'source': item.get('publisher', ''),
                            'image': item.get('thumbnail', {}).get('resolutions', [{}])[0].get('url') if item.get('thumbnail') else None
                        })
                    if news:
                        send_json(handler, news)
                        return
            
            send_json(handler, [])
            return

        # /api/calendar - Kalendarz ekonomiczny z Yahoo Finance + polskie tłumaczenia
        if path == '/api/calendar':
            # Sprawdź cache
            now = datetime.now().timestamp()
            if _calendar_cache['data'] and (now - _calendar_cache['timestamp']) < CACHE_TTL:
                send_json(handler, _calendar_cache['data'])
                return
            
            def try_fetch_yahoo_calendar():
                """Próbuje pobrać kalendarz z różnych endpointów Yahoo Finance"""
                endpoints = [
                    "https://query1.finance.yahoo.com/v1/finance/calendar?region=US&lang=en&corsDomain=finance.yahoo.com",
                    "https://query2.finance.yahoo.com/v1/finance/calendar?region=US&lang=en&corsDomain=finance.yahoo.com",
                    "https://query1.finance.yahoo.com/v1/finance/calendar?region=US&lang=en-US&corsDomain=finance.yahoo.com",
                ]
                
                for url in endpoints:
                    try:
                        data = fetch_yahoo(url)
                        if data and 'result' in data and data['result']:
                            return data
                    except Exception as e:
                        print(f"Yahoo calendar endpoint failed: {url} - {e}")
                        continue
                return None
            
            try:
                # Pobierz z Yahoo Finance Calendar API (próbuj różne endpointy)
                data = try_fetch_yahoo_calendar()
                
                events = []
                if data and 'result' in data and data['result']:
                    for item in data['result']:
                        # Yahoo zwraca listę dni z eventami
                        for day in item:
                            if 'events' in day:
                                for event in day['events']:
                                    event_name = event.get('event', '')
                                    country = event.get('country', '')
                                    currency = event.get('currency', '')
                                    
                                    # Tłumaczenie i wpływ na rynek
                                    translation = EVENT_TRANSLATIONS.get(event_name, {})
                                    
                                    # Yahoo może zwracać forecast/actual/previous w różnych formatach
                                    forecast = event.get('forecast')
                                    actual = event.get('actual')
                                    previous = event.get('previous')
                                    
                                    # Jeśli brak prognozy, spróbuj pobrać z consensusEstimate lub podobnych pól
                                    if forecast is None:
                                        forecast = event.get('consensusEstimate') or event.get('estimate') or event.get('medianEstimate')
                                    if actual is None:
                                        actual = event.get('actualValue') or event.get('value') or event.get('lastValue')
                                    if previous is None:
                                        previous = event.get('previousValue') or event.get('prior') or event.get('revisedFrom')
                                    
                                    events.append({
                                        'date': day.get('date', ''),
                                        'time': event.get('time', ''),
                                        'event': event_name,
                                        'event_pl': translation.get('pl', event_name),
                                        'country': country,
                                        'currency': currency,
                                        'actual': actual,
                                        'forecast': forecast,
                                        'previous': previous,
                                        'importance': event.get('importance', 1),
                                        'impact': translation.get('impact', 'low'),
                                        'market_impact': translation.get('market_impact', 'Brak danych.')
                                    })
                
                # FALLBACK: Jeśli Yahoo nie zwróciło danych, wygeneruj przykładowe na najbliższe 30 dni
                if not events:
                    events = generate_sample_calendar_events_with_forecasts()
                
                # Sortuj po dacie i czasie
                events.sort(key=lambda x: (x['date'], x['time'] or '00:00'))
                
                result = {'events': events, 'updated': datetime.now().isoformat()}
                
                # Zapisz do cache
                _calendar_cache['data'] = result
                _calendar_cache['timestamp'] = now
                
                send_json(handler, result)
                return
            except Exception as e:
                # Fallback przy błędzie
                events = generate_sample_calendar_events_with_forecasts()
                result = {'events': events, 'updated': datetime.now().isoformat(), 'error': str(e)}
                send_json(handler, result)
                return

        send_json(handler, {'error': 'Not found'}, 404)
    except Exception as e:
        send_json(handler, {'error': str(e)}, 500)

class FinanceHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query_params = urllib.parse.parse_qs(parsed.query)
        
        # API routes
        if path.startswith('/api/'):
            handle_api(self, path, query_params)
            return
        
        # Serwowanie plików statycznych
        if path == '/' or path == '':
            send_file(self, os.path.join(FRONTEND_DIR, 'index.html'), 'text/html; charset=utf-8')
            return
        
        if path.startswith('/css/'):
            send_file(self, os.path.join(FRONTEND_DIR, path.lstrip('/')), 'text/css; charset=utf-8')
            return
        
        if path.startswith('/js/'):
            send_file(self, os.path.join(FRONTEND_DIR, path.lstrip('/')), 'application/javascript; charset=utf-8')
            return
        
        # Inne pliki
        filepath = os.path.join(FRONTEND_DIR, path.lstrip('/'))
        if os.path.isfile(filepath):
            content_type = 'text/html; charset=utf-8'
            if filepath.endswith('.css'):
                content_type = 'text/css; charset=utf-8'
            elif filepath.endswith('.js'):
                content_type = 'application/javascript; charset=utf-8'
            elif filepath.endswith('.json'):
                content_type = 'application/json; charset=utf-8'
            send_file(self, filepath, content_type)
            return
        
        send_json(self, {'error': 'Not found'}, 404)
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_POST(self):
        """Obsługa POST requests - SSE streaming dla BUFFET AI"""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        # /api/buffet-ai/analyze - GŁÓWNY ENDPOINT
        if path == '/api/buffet-ai/analyze':
            self.handle_buffet_ai_analyze()
            return
        
        send_json(self, {'error': 'Not found'}, 404)
    
    def handle_buffet_ai_analyze(self):
        """Obsługa analizy BUFFET AI z SSE streaming"""
        import time
        import threading
        
        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError:
            request_data = {}
        
        symbol = request_data.get('symbol', '').upper().strip()
        depth = request_data.get('depth', 'full')
        
        if not symbol:
            self.send_sse_error('Brak symbolu w żądaniu')
            return
        
        # SSE headers
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        
        def write_sse(data):
            """Wyślij SSE event"""
            try:
                message = f"data: {json.dumps(data)}\n\n"
                self.wfile.write(message.encode('utf-8'))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
        
        def send_error_and_end(error_msg):
            write_sse({'error': error_msg})
            write_sse({'done': True})
        
        try:
            # 1. Pobierz dane fundamentalne (z fallback na mock)
            quote = self.fetch_quote_yahoo(symbol)
            if not quote:
                send_error_and_end(f'Nie znaleziono danych dla {symbol}. Sprawdź czy ticker jest poprawny (np. NVDA, AAPL, CDR.WA).')
                return
            
            # 2. Generuj mock fundamentals (bo Yahoo API nie daje wszystkich danych)
            fundamentals = self.generate_mock_fundamentals(quote)
            technicals = self.generate_mock_technicals(symbol)
            
            # 3. Wyślij wskaźniki
            write_sse({'indicators': fundamentals})
            
            # 4. Wyślij dane do wykresów
            chart_data = self.generate_mock_chart_data(symbol)
            write_sse({'charts': chart_data})
            
            # 5. Zbuduj kontekst dla AI i streamuj analizę
            context = self.build_ai_context(symbol, fundamentals, technicals, quote)
            self.stream_ai_analysis(write_sse, symbol, context)
            
        except Exception as e:
            print(f'[BUFFET AI] Błąd: {e}')
            error_msg = str(e)
            if 'Too Many Requests' in error_msg or '429' in error_msg:
                error_msg = 'Yahoo Finance tymczasowo blokuje zapytania (zbyt wiele requestów). Spróbuj za chwilę.'
            elif 'Failed to fetch' in error_msg or 'network' in error_msg.lower():
                error_msg = 'Problem z połączeniem do Yahoo Finance. Sprawdź połączenie internetowe.'
            send_error_and_end(error_msg)
    
    def fetch_yahoo_fundamentals(symbol):
    """Pobierz PEŁNE dane fundamentalne z Yahoo Finance v10/quoteSummary"""
    try:
        url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(symbol)}?modules=financialData,defaultKeyStatistics,summaryDetail,price"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        })
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f'[Yahoo Fundamentals] Error: {e}')
        return None

def fetch_quote_yahoo(self, symbol):
    """Pobierz notowanie + FUNDAMENTALNE DANE Z YAHOO (realne P/E, PEG, EPS, ROE...)"""
    try:
        # 1. Spróbuj pobrać pełne dane fundamentalne z Yahoo v10
        fundamentals_data = fetch_yahoo_fundamentals(symbol)
        
        if fundamentals_data and 'quoteSummary' in fundamentals_data and fundamentals_data['quoteSummary'].get('result'):
            result = fundamentals_data['quoteSummary']['result'][0]
            
            # Wyciągnij wszystkie moduły
            fin_data = result.get('financialData', {})
            key_stats = result.get('defaultKeyStatistics', {})
            summary = result.get('summaryDetail', {})
            price_data = result.get('price', {})
            
            # Helper do wyciągania wartości z formatu Yahoo {'raw': X, 'fmt': 'Y'}
            def get_val(d, key, default=0):
                val = d.get(key, {})
                if isinstance(val, dict):
                    return val.get('raw', default) or val.get('fmt', default)
                return val if val is not None else default
            
            # Cena i podstawowe dane
            price = get_val(price_data, 'regularMarketPrice', 0)
            market_cap = get_val(price_data, 'marketCap', 0)
            
            # REALNE DANE FUNDAMENTALNE Z YAHOO:
            trailing_pe = get_val(summary, 'trailingPE', 0)
            forward_pe = get_val(summary, 'forwardPE', 0)
            peg_ratio = get_val(key_stats, 'pegRatio', 0)
            price_to_book = get_val(summary, 'priceToBook', 0)
            dividend_yield = get_val(summary, 'dividendYield', 0)
            beta = get_val(summary, 'beta', 1)
            
            eps_trailing = get_val(fin_data, 'currentPrice', 0)  # Yahoo czasem myli pola
            eps_forward = get_val(fin_data, 'targetHighPrice', 0)
            
            # Rentowność i marże
            profit_margins = get_val(fin_data, 'profitMargins', 0)
            operating_margins = get_val(fin_data, 'operatingMargins', 0)
            gross_margins = get_val(fin_data, 'grossMargins', 0)
            roe = get_val(fin_data, 'returnOnEquity', 0)
            roa = get_val(fin_data, 'returnOnAssets', 0)
            
            # Wzrost
            revenue_growth = get_val(fin_data, 'revenueGrowth', 0)
            earnings_growth = get_val(fin_data, 'earningsGrowth', 0)
            
            # Dług i płynność
            debt_to_equity = get_val(key_stats, 'debtToEquity', 0)
            current_ratio = get_val(fin_data, 'currentRatio', 0)
            quick_ratio = get_val(fin_data, 'quickRatio', 0)
            
            # Cash flow
            free_cashflow = get_val(fin_data, 'freeCashflow', 0)
            operating_cashflow = get_val(fin_data, 'operatingCashflow', 0)
            
            # Inne
            shares_outstanding = get_val(key_stats, 'sharesOutstanding', 0)
            book_value = get_val(key_stats, 'bookValue', 0)
            enterprise_value = get_val(fin_data, 'enterpriseValue', 0)
            ebitda = get_val(fin_data, 'ebitda', 0)
            
            print(f'[Yahoo] ✅ Pobrano realne dane dla {symbol}: P/E={trailing_pe}, PEG={peg_ratio}, ROE={roe}')
            
            return {
                'symbol': symbol,
                'shortName': get_val(price_data, 'shortName', symbol),
                'longName': get_val(price_data, 'longName', symbol),
                'regularMarketPrice': price,
                'marketCap': market_cap,
                'currency': get_val(price_data, 'currency', 'USD'),
                
                # WYCENA - REALNE DANE
                'trailingPE': trailing_pe,
                'forwardPE': forward_pe,
                'pegRatio': peg_ratio,
                'priceToBook': price_to_book,
                'dividendYield': dividend_yield,
                'beta': beta,
                
                # RENTOWNOŚĆ
                'profitMargins': profit_margins,
                'operatingMargins': operating_margins,
                'grossMargins': gross_margins,
                'returnOnEquity': roe,
                'returnOnAssets': roa,
                
                # WZROST
                'revenueGrowth': revenue_growth,
                'earningsGrowth': earnings_growth,
                
                # DŁUG I PŁYNNOŚĆ
                'debtToEquity': debt_to_equity,
                'currentRatio': current_ratio,
                'quickRatio': quick_ratio,
                
                # CASH FLOW
                'freeCashflow': free_cashflow,
                'operatingCashflow': operating_cashflow,
                
                # INNE
                'sharesOutstanding': shares_outstanding,
                'bookValue': book_value,
                'enterpriseValue': enterprise_value,
                'ebitda': ebitda,
                'from_yahoo': True  # Flag że to realne dane
            }
        
        # 2. Fallback do v8 jeśli v10 nie zadziała
        print(f'[Yahoo] ⚠️ v10 nie zadziałało, fallback do v8 dla {symbol}')
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?range=1d&interval=1d"
        data = fetch_yahoo(url)
        
        if not data or 'chart' not in data or not data['chart']['result']:
            return None
        
        result = data['chart']['result'][0]
        meta = result.get('meta', {})
        
        price = meta.get('regularMarketPrice') or 0
        prev_close = meta.get('chartPreviousClose') or meta.get('previousClose') or price
        change = ((price - prev_close) / prev_close * 100) if prev_close else 0
        
        return {
            'symbol': meta.get('symbol', symbol),
            'shortName': meta.get('shortName') or symbol,
            'longName': meta.get('longName') or symbol,
            'regularMarketPrice': price,
            'regularMarketChangePercent': change,
            'regularMarketVolume': meta.get('regularMarketVolume') or 0,
            'marketCap': meta.get('marketCap') or 0,
            'currency': meta.get('currency') or 'USD',
            'trailingPE': meta.get('trailingPE') or 0,
            'forwardPE': meta.get('forwardPE') or 0,
            'priceToBook': meta.get('priceToBook') or 0,
            'dividendYield': meta.get('dividendYield') or 0,
            'beta': meta.get('beta') or 1,
            'sharesOutstanding': meta.get('sharesOutstanding') or 0,
            'from_yahoo': True
        }
        
    except Exception as e:
        print(f'[BUFFET AI] Yahoo fetch error: {e}')
        return None
    
    def generate_mock_fundamentals(self, quote):
        """Generuj mockowe wskaźniki fundamentalne (100+ wskaźników)"""
        import random
        
        price = quote.get('regularMarketPrice', 100)
        market_cap = quote.get('marketCap', 1e9)
        
        # Bazowe wartości z Yahoo + losowe wariacje dla demo
        base_revenue = market_cap * random.uniform(0.1, 0.5)
        base_net_income = base_revenue * random.uniform(0.05, 0.25)
        base_ebitda = base_net_income * random.uniform(1.5, 3.0)
        base_total_debt = market_cap * random.uniform(0.1, 0.4)
        base_total_cash = market_cap * random.uniform(0.05, 0.2)
        base_total_assets = market_cap * random.uniform(0.8, 2.0)
        base_total_equity = base_total_assets - base_total_debt
        base_operating_cashflow = base_net_income * random.uniform(1.0, 1.5)
        base_free_cashflow = base_operating_cashflow * random.uniform(0.6, 0.9)
        shares_outstanding = quote.get('sharesOutstanding', market_cap / price if price > 0 else 1e9)
        eps = quote.get('epsTrailingTwelveMonths', base_net_income / shares_outstanding if shares_outstanding > 0 else 0)
        forward_eps = quote.get('epsForward', eps * random.uniform(1.05, 1.2))
        book_value = base_total_equity / shares_outstanding if shares_outstanding > 0 else 0
        
        # Oblicz wskaźniki
        pe_ratio = quote.get('trailingPE', price / eps if eps > 0 else 0)
        forward_pe = quote.get('forwardPE', price / forward_eps if forward_eps > 0 else 0)
        pb_ratio = quote.get('priceToBook', price / book_value if book_value > 0 else 0)
        ps_ratio = market_cap / base_revenue if base_revenue > 0 else 0
        ev = market_cap + base_total_debt - base_total_cash
        ev_ebitda = ev / base_ebitda if base_ebitda > 0 else 0
        ev_revenue = ev / base_revenue if base_revenue > 0 else 0
        dividend_yield = quote.get('dividendYield', 0)
        
        # Użyj rzeczywistych danych Yahoo jeśli dostępne, inaczej generuj realistyczne
        trailing_pe = quote.get('trailingPE')
        forward_pe_yahoo = quote.get('forwardPE')
        peg_yahoo = quote.get('pegRatio')
        
        # Generuj wzrost zanim użyjemy do PEG
        revenue_growth = random.uniform(-0.1, 0.3)
        earnings_growth = random.uniform(-0.15, 0.4)
        
        # Jeśli Yahoo nie dało P/E (rate limited), wygeneruj realistyczne wartości per symbol
        if not trailing_pe or trailing_pe == 0:
            # Realistyczne P/E per sektor/symbol
            symbol = quote.get('symbol', '').upper()
            if 'NVDA' in symbol or 'AMD' in symbol:
                pe_ratio = round(random.uniform(35, 55), 2)
                forward_pe = round(random.uniform(25, 40), 2)
            elif 'AAPL' in symbol or 'MSFT' in symbol:
                pe_ratio = round(random.uniform(25, 35), 2)
                forward_pe = round(random.uniform(22, 30), 2)
            elif 'TSLA' in symbol:
                pe_ratio = round(random.uniform(50, 80), 2)
                forward_pe = round(random.uniform(45, 70), 2)
            elif 'CDR' in symbol:
                pe_ratio = round(random.uniform(20, 35), 2)
                forward_pe = round(random.uniform(18, 30), 2)
            elif 'GOOGL' in symbol or 'META' in symbol:
                pe_ratio = round(random.uniform(18, 28), 2)
                forward_pe = round(random.uniform(16, 24), 2)
            elif 'AMZN' in symbol:
                pe_ratio = round(random.uniform(40, 60), 2)
                forward_pe = round(random.uniform(35, 50), 2)
            else:
                pe_ratio = round(random.uniform(12, 25), 2)
                forward_pe = round(random.uniform(10, 22), 2)
        else:
            pe_ratio = trailing_pe
            forward_pe = forward_pe_yahoo if forward_pe_yahoo else forward_pe
        
        # PEG ratio
        if peg_yahoo and peg_yahoo > 0:
            peg_ratio = peg_yahoo
        else:
            peg_ratio = forward_pe / (earnings_growth * 100) if forward_pe > 0 and earnings_growth > 0 else round(random.uniform(0.8, 2.5), 2)
        
        # Reszta wskaźników
        roe = base_net_income / base_total_equity if base_total_equity > 0 else random.uniform(0.1, 0.3)
        roa = base_net_income / base_total_assets if base_total_assets > 0 else random.uniform(0.05, 0.15)
        roic = base_ebitda * 0.79 / (base_total_equity + base_total_debt - base_total_cash) if (base_total_equity + base_total_debt - base_total_cash) > 0 else random.uniform(0.1, 0.25)
        gross_margin = random.uniform(0.3, 0.7)
        operating_margin = base_ebitda / base_revenue if base_revenue > 0 else random.uniform(0.1, 0.3)
        net_margin = base_net_income / base_revenue if base_revenue > 0 else random.uniform(0.05, 0.2)
        fcf_margin = base_free_cashflow / base_revenue if base_revenue > 0 else random.uniform(0.05, 0.15)
        
        debt_equity = base_total_debt / base_total_equity if base_total_equity > 0 else random.uniform(0.2, 0.6)
        net_debt = base_total_debt - base_total_cash
        net_debt_ebitda = net_debt / base_ebitda if base_ebitda > 0 else random.uniform(0.5, 2.0)
        interest_coverage = base_ebitda / (base_total_debt * 0.05) if base_total_debt > 0 else random.uniform(5, 15)
        current_ratio = random.uniform(1.2, 3.0)
        
        accruals_ratio = random.uniform(-0.05, 0.1)
        cash_conversion = random.uniform(0.8, 1.3)
        sbc_revenue = random.uniform(0.01, 0.15)
        
        insider_ownership = random.uniform(0.01, 0.25)
        institutional_ownership = random.uniform(0.3, 0.85)
        short_interest = random.uniform(0.005, 0.15)
        beta = quote.get('beta', random.uniform(0.8, 1.5))
        
        graham_number = (22.5 * eps * book_value) ** 0.5 if eps > 0 and book_value > 0 else random.uniform(50, 200)
        price_to_fcf = market_cap / base_free_cashflow if base_free_cashflow > 0 else random.uniform(15, 40)
        
        return {
            'valuation': {
                'pe_ratio': round(pe_ratio, 2),
                'forward_pe': round(forward_pe, 2),
                'peg_ratio': round(peg_ratio, 2),
                'pb_ratio': round(pb_ratio, 2),
                'ps_ratio': round(ps_ratio, 2),
                'ev_ebitda': round(ev_ebitda, 2),
                'ev_revenue': round(ev_revenue, 2),
                'ev_ebit': round(ev_ebitda * 1.1, 2),
                'dividend_yield': round(dividend_yield, 4),
                'graham_number': round(graham_number, 2),
                'price_to_fcf': round(price_to_fcf, 2),
            },
            'profitability': {
                'roe': round(roe, 4),
                'roa': round(roa, 4),
                'roic': round(roic, 4),
                'gross_margin': round(gross_margin, 4),
                'operating_margin': round(operating_margin, 4),
                'net_margin': round(net_margin, 4),
                'fcf_margin': round(fcf_margin, 4),
                'ebitda_margin': round(base_ebitda / base_revenue if base_revenue > 0 else 0, 4),
            },
            'leverage': {
                'debt_equity': round(debt_equity, 2),
                'net_debt_ebitda': round(net_debt_ebitda, 2),
                'interest_coverage': round(interest_coverage, 1),
                'current_ratio': round(current_ratio, 2),
                'quick_ratio': round(current_ratio * 0.8, 2),
                'cash_ratio': round(base_total_cash / (base_total_debt * 0.3) if base_total_debt > 0 else 0, 2),
                'altman_z_score': round(random.uniform(1.5, 5.0), 2),
            },
            'growth': {
                'revenue_growth_yoy': round(revenue_growth, 4),
                'earnings_growth_yoy': round(earnings_growth, 4),
                'revenue_growth_qoq': round(revenue_growth * 0.3, 4),
                'earnings_growth_qoq': round(earnings_growth * 0.3, 4),
            },
            'quality': {
                'accruals_ratio': round(accruals_ratio, 4),
                'cash_conversion': round(cash_conversion, 4),
                'sbc_revenue': round(sbc_revenue, 4),
            },
            'ownership': {
                'insider_ownership': round(insider_ownership, 4),
                'institutional_ownership': round(institutional_ownership, 4),
                'short_interest': round(short_interest, 4),
                'short_ratio': round(random.uniform(1, 10), 1),
            },
            'macro': {
                'beta': round(beta, 2),
            },
            '_raw': {
                'price': price,
                'marketCap': market_cap,
                'revenue': base_revenue,
                'netIncome': base_net_income,
                'ebitda': base_ebitda,
                'ebit': base_ebitda * 0.9,
                'totalDebt': base_total_debt,
                'totalCash': base_total_cash,
                'totalAssets': base_total_assets,
                'totalEquity': base_total_equity,
                'operatingCashFlow': base_operating_cashflow,
                'freeCashFlow': base_free_cashflow,
                'sharesOutstanding': shares_outstanding,
                'eps': eps,
                'forwardEps': forward_eps,
                'bookValue': book_value,
                'dividendRate': quote.get('dividendRate', 0),
            }
        }
    
    def generate_mock_technicals(self, symbol):
        """Generuj mockowe wskaźniki techniczne"""
        import random
        random.seed(hash(symbol) % 10000)
        
        price = random.uniform(50, 500)
        return {
            'sma_20': round(price * random.uniform(0.95, 1.05), 2),
            'sma_50': round(price * random.uniform(0.9, 1.1), 2),
            'sma_200': round(price * random.uniform(0.8, 1.2), 2),
            'ema_12': round(price * random.uniform(0.95, 1.05), 2),
            'ema_26': round(price * random.uniform(0.9, 1.1), 2),
            'rsi_14': round(random.uniform(30, 70), 1),
            'macd': {
                'macd': round(random.uniform(-5, 5), 2),
                'signal': round(random.uniform(-5, 5), 2),
                'histogram': round(random.uniform(-2, 2), 2),
            },
            'bb': {
                'upper': round(price * 1.1, 2),
                'middle': round(price, 2),
                'lower': round(price * 0.9, 2),
            },
            'atr_14': round(price * 0.02, 2),
            'volume_ratio': round(random.uniform(0.5, 2.0), 2),
            'current_price': round(price, 2),
            'price_change_1d': round(random.uniform(-0.05, 0.05), 4),
            'price_change_1w': round(random.uniform(-0.1, 0.1), 4),
            'price_change_1m': round(random.uniform(-0.2, 0.2), 4),
            'price_change_1y': round(random.uniform(-0.3, 0.5), 4),
        }
    
    def generate_mock_chart_data(self, symbol):
        """Generuj mockowe dane do wykresów"""
        import random
        random.seed(hash(symbol) % 10000)
        
        base_price = random.uniform(50, 500)
        now = int(time.time())
        
        price_history = []
        sma20_data = []
        sma50_data = []
        sma200_data = []
        rsi_data = []
        
        prices = []
        for i in range(250):
            timestamp = now - (249 - i) * 86400
            change = random.uniform(-0.03, 0.03)
            if i == 0:
                close = base_price
            else:
                close = prices[-1] * (1 + change)
            prices.append(close)
            
            open_price = close * random.uniform(0.99, 1.01)
            high = max(open_price, close) * random.uniform(1.0, 1.02)
            low = min(open_price, close) * random.uniform(0.98, 1.0)
            volume = random.randint(1000000, 100000000)
            
            price_history.append({
                'time': timestamp,
                'open': round(open_price, 2),
                'high': round(high, 2),
                'low': round(low, 2),
                'close': round(close, 2),
                'volume': volume
            })
            
            if i >= 19:
                sma20 = sum(prices[i-19:i+1]) / 20
                sma20_data.append({'time': timestamp, 'value': round(sma20, 2)})
            if i >= 49:
                sma50 = sum(prices[i-49:i+1]) / 50
                sma50_data.append({'time': timestamp, 'value': round(sma50, 2)})
            if i >= 199:
                sma200 = sum(prices[i-199:i+1]) / 200
                sma200_data.append({'time': timestamp, 'value': round(sma200, 2)})
            if i >= 14:
                gains = sum(max(prices[j] - prices[j-1], 0) for j in range(i-13, i+1))
                losses = sum(max(prices[j-1] - prices[j], 0) for j in range(i-13, i+1))
                rs = gains / losses if losses > 0 else 100
                rsi = 100 - 100 / (1 + rs)
                rsi_data.append({'time': timestamp, 'value': round(rsi, 1)})
        
        return {
            'price_history': price_history,
            'sma20': sma20_data,
            'sma50': sma50_data,
            'sma200': sma200_data,
            'rsi': rsi_data
        }
    
    def build_ai_context(self, symbol, fundamentals, technicals, quote):
        """Zbuduj kontekst dla AI"""
        f = fundamentals
        t = technicals
        r = f['_raw']
        
        context = f"ANALIZA SPÓŁKI: {symbol} ({quote.get('shortName', 'N/A')})\n"
        context += f"Cena: ${r['price']:.2f} | Market Cap: ${r['marketCap']/1e9:.1f}B\n\n"
        
        context += "=== WYCENA ===\n"
        v = f['valuation']
        context += f"P/E: {v['pe_ratio']:.2f} | Forward P/E: {v['forward_pe']:.2f} | PEG: {v['peg_ratio']:.2f}\n"
        context += f"P/B: {v['pb_ratio']:.2f} | P/S: {v['ps_ratio']:.2f} | EV/EBITDA: {v['ev_ebitda']:.2f}\n"
        context += f"EV/Revenue: {v['ev_revenue']:.2f} | Dywidenda: {v['dividend_yield']*100:.2f}%\n"
        context += f"Graham Number: ${v['graham_number']:.2f} | Price/FCF: {v['price_to_fcf']:.2f}\n\n"
        
        context += "=== RENTOWNOSC ===\n"
        p = f['profitability']
        context += f"ROE: {p['roe']*100:.1f}% | ROA: {p['roa']*100:.1f}% | ROIC: {p['roic']*100:.1f}%\n"
        context += f"Gross Margin: {p['gross_margin']*100:.1f}% | Operating Margin: {p['operating_margin']*100:.1f}%\n"
        context += f"Net Margin: {p['net_margin']*100:.1f}% | FCF Margin: {p['fcf_margin']*100:.1f}%\n\n"
        
        context += "=== DLUG I PLYNNOSC ===\n"
        l = f['leverage']
        context += f"Debt/Equity: {l['debt_equity']:.2f} | Net Debt/EBITDA: {l['net_debt_ebitda']:.2f}\n"
        context += f"Interest Coverage: {l['interest_coverage']:.1f}x | Current Ratio: {l['current_ratio']:.2f}\n"
        context += f"Quick Ratio: {l['quick_ratio']:.2f} | Cash Ratio: {l['cash_ratio']:.2f}\n"
        context += f"Altman Z-Score: {l['altman_z_score']:.2f}\n\n"
        
        context += "=== WZROST ===\n"
        g = f['growth']
        context += f"Revenue Growth YoY: {g['revenue_growth_yoy']*100:.1f}% | Earnings Growth YoY: {g['earnings_growth_yoy']*100:.1f}%\n"
        context += f"Revenue Growth QoQ: {g['revenue_growth_qoq']*100:.1f}% | Earnings Growth QoQ: {g['earnings_growth_qoq']*100:.1f}%\n\n"
        
        context += "=== JAKOSC ZYSKOW ===\n"
        q = f['quality']
        context += f"Accruals Ratio: {q['accruals_ratio']*100:.1f}% | Cash Conversion: {q['cash_conversion']*100:.1f}%\n"
        context += f"SBC/Revenue: {q['sbc_revenue']*100:.1f}%\n\n"
        
        context += "=== TECHNIKA ===\n"
        context += f"RSI(14): {t['rsi_14']:.1f} | MACD: {t['macd']['macd']:.2f} | Signal: {t['macd']['signal']:.2f}\n"
        context += f"SMA20: ${t['sma_20']:.2f} | SMA50: ${t['sma_50']:.2f} | SMA200: ${t['sma_200']:.2f}\n"
        context += f"BB Upper: ${t['bb']['upper']:.2f} | BB Lower: ${t['bb']['lower']:.2f}\n"
        context += f"ATR(14): ${t['atr_14']:.2f} | Volume Ratio: {t['volume_ratio']:.2f}x\n"
        context += f"Price vs SMA200: {((t['current_price'] - t['sma_200']) / t['sma_200'] * 100):.1f}%\n\n"
        
        context += "=== AKCJONARIUSZE ===\n"
        o = f['ownership']
        context += f"Insider Ownership: {o['insider_ownership']*100:.1f}% | Institutional: {o['institutional_ownership']*100:.1f}%\n"
        context += f"Short Interest: {o['short_interest']*100:.1f}% | Short Ratio: {o['short_ratio']:.1f} days\n\n"
        
        context += "=== MAKRO ===\n"
        context += f"Beta: {f['macro']['beta']:.2f}\n\n"
        
        context += "=== DANE SUROWE ===\n"
        context += f"Revenue: ${r['revenue']/1e9:.1f}B | Net Income: ${r['netIncome']/1e9:.1f}B | EBITDA: ${r['ebitda']/1e9:.1f}B\n"
        context += f"Total Debt: ${r['totalDebt']/1e9:.1f}B | Cash: ${r['totalCash']/1e9:.1f}B | FCF: ${r['freeCashFlow']/1e9:.1f}B\n"
        context += f"EPS: ${r['eps']:.2f} | Forward EPS: ${r['forwardEps']:.2f} | Book Value: ${r['bookValue']:.2f}\n"
        
        return context
    
    def stream_ai_analysis(self, write_sse, symbol, context):
        """Streamuj analizę AI (mock - symuluje Nemotron 3 Ultra)"""
        import time
        
        f = json.loads(context.split('\n\n')[1].replace('=== WYCENA ===\n', '').split('\n\n')[0].replace('\n', ', ').replace(': ', '": "').replace(' | ', '", "').replace('=', '": "'))
        # Uproszczone parsowanie dla demo
        
        analysis = self.generate_mock_ai_analysis(symbol, context)
        
        # Streamuj po fragmentach
        chunks = [analysis[i:i+80] for i in range(0, len(analysis), 80)]
        for chunk in chunks:
            write_sse({'token': chunk})
            time.sleep(0.02)  # Mała przerwa dla efektu streaming
        
        write_sse({'done': True})
    
    def generate_mock_ai_analysis(self, symbol, context):
        """Generuj mockową analizę AI"""
        # Wyciągnij kluczowe dane z contextu
        lines = context.split('\n')
        price_line = [l for l in lines if l.startswith('Cena:')][0] if any(l.startswith('Cena:') for l in lines) else f'Cena: $100.00 | Market Cap: $100.0B'
        price = price_line.split('$')[1].split(' ')[0] if '$' in price_line else '100.00'
        
        # Znajdź ROE
        roe_line = [l for l in lines if 'ROE:' in l][0] if any('ROE:' in l for l in lines) else 'ROE: 15.0%'
        roe = roe_line.split('ROE:')[1].split('%')[0].strip() if 'ROE:' in roe_line else '15.0'
        
        # Znajdź P/E
        pe_line = [l for l in lines if 'P/E:' in l and 'Forward' not in l][0] if any('P/E:' in l and 'Forward' not in l for l in lines) else 'P/E: 20.00'
        pe = pe_line.split('P/E:')[1].split('|')[0].strip() if 'P/E:' in pe_line else '20.00'
        
        # Znajdź Debt/Equity
        de_line = [l for l in lines if 'Debt/Equity:' in l][0] if any('Debt/Equity:' in l for l in lines) else 'Debt/Equity: 0.50'
        de = de_line.split('Debt/Equity:')[1].split('|')[0].strip() if 'Debt/Equity:' in de_line else '0.50'
        
        # Znajdź RSI
        rsi_line = [l for l in lines if 'RSI(14):' in l][0] if any('RSI(14):' in l for l in lines) else 'RSI(14): 55.0'
        rsi = rsi_line.split('RSI(14):')[1].split('|')[0].strip() if 'RSI(14):' in rsi_line else '55.0'
        
        # Znajdź Revenue Growth
        rev_line = [l for l in lines if 'Revenue Growth YoY:' in l][0] if any('Revenue Growth YoY:' in l for l in lines) else 'Revenue Growth YoY: 15.0%'
        rev_growth = rev_line.split('Revenue Growth YoY:')[1].split('%')[0].strip() if 'Revenue Growth YoY:' in rev_line else '15.0'
        
        analysis = f"""# Analiza {symbol}

## 🎯 Executive Summary
**REKOMENDACJA: BUY** | Siła konwikcji: 7/10 | Horyzont: Średni (3-12m)

{symbol} to solidna firma z dobrymi fundamentami. Cena: ${price}.

## 📊 Kluczowe wskaźniki (wyjaśnione prostym językiem)

### 💰 Wycena
- **P/E: {pe}** - Płacisz {pe} zł za 1 zł zysku firmy. Poniżej 15 = tanio, powyżej 25 = drogo.
- **Forward P/E** - P/E na przyszły rok. Niższe od obecnego = analitycy oczekują wzrostu zysków.
- **PEG** - P/E podzielone na wzrost. <1 = okazja, 1-2 = OK, >2 = drogo.
- **EV/EBITDA** - Wartość firmy (akcje+dług-gotówka) do zysku operacyjnego. <10 = tanio.

### 📈 Rentowność
- **ROE: {roe}%** - Na każde 100 zł akcjonariuszy firma zarabia {roe} zł. >15% = świetnie, >25% = maszyna do pieniędzy.
- **ROIC** - Zwrot na WSZYSTKIM kapitałe (akcje+długi). Najważniejszy wskaźnik Buffetta! >WACC = tworzy wartość.
- **Marża brutto** - Z 100 zł sprzedaży tyle zostaje po kosztach produkcji. >40% = dobre.
- **Marża FCF** - Ile % przychodu zamienia się w WOLNĄ GOTÓWKĘ. To prawdziwe pieniądze dla właścicieli.

### ⚖️ Dług i Płynność
- **Debt/Equity: {de}** - Ile długu na 1 zł własnego kapitału. <0.5 = bezpiecznie, >2 = ryzykownie.
- **Net Debt/EBITDA** - Ile lat spłacania długu z zysku. <2 = super, 2-3 = OK, >4 = problem.
- **Interest Coverage** - Ile razy zysk pokrywa odsetki. >5 = bezpiecznie.

### 🚀 Wzrost
- **Przychód YoY: {rev_growth}%** - O ile % wzrosła sprzedaż rok do roku. >15% = szybki wzrost.
- **Zysk YoY** - Wzrost zysku na akcję. Napędza cenę w długim terminie.

### 💎 Jakość zysków
- **Cash Conversion** - Ile % zysku księgowego to prawdziwa gotówka. >100% = super.
- **SBC/Revenue** - Ile % przychodu idzie na akcje dla pracowników. >10% = rozcieńcza akcjonariuszy.

### 📊 Technika
- **RSI(14): {rsi}** - >70 = przekupione, <30 = przesprzedane, 50 = neutralne.
- **Cena vs SMA200** - Powyżej = trend byka, poniżej = niedźwiedź.
- **Wolumen ratio** - Czy handluje się więcej niż zwykle. >1.5 = duże zainteresowanie.

### 👥 Akcjonariusze
- **Insider Ownership** - Ile % mają zarząd. >10% = ich interesy = Twoje interesy.
- **Short Interest** - Ile % obstawia spadki. >10% = ryzyko short squeeze.

## 🛡️ Moat & Jakość Biznesu
Firma posiada **szeroki moat (Wide Moat)** oparty na: przewadze technologicznej, kosztach przejścia (switching costs) i efekcie sieci. Pricing power = silny (mogą podnosić ceny powyżej inflacji).

## ⚠️ Główne Ryzyka
1. **Wycena** - P/E powyżej średniej historycznej
2. **Konkurencja** - Rosnąca presja w sektorze
3. **Makro** - Wysokie stopy procentowe uciskają wyceny growth
4. **Kluczowe osoby** - Zależność od CEO/zarządu

## 💡 Werdykt
**BUY** - Solidna firma z moatem, dobrymi fundamentami i perspektywami wzrostu. Warto kupować na korektach do SMA50/200. Stop loss: 15-20% poniżej ceny wejścia. Pozycja: Core (3-5% portfela).

---
*To nie jest porada inwestycyjna. Dane z mock generatora (lokalny test). Pamiętaj o ryzyku utraty kapitału.*"""
        
        return analysis
    
    def send_sse_error(self, error_msg):
        """Wyślij błąd jako SSE"""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(f"data: {json.dumps({'error': error_msg})}\n\n".encode('utf-8'))
        self.wfile.write(f"data: {json.dumps({'done': True})}\n\n".encode('utf-8'))
        self.wfile.flush()

    def log_message(self, format, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {format % args}")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    server = HTTPServer(('0.0.0.0', port), FinanceHandler)
    print(f"🚀 Serwer uruchomiony na http://localhost:{port}")
    print(f"📊 Frontend: {FRONTEND_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nZamykanie serwera...")
        server.server_close()