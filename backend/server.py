import json
import urllib.request
import urllib.parse
import os
import sys
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