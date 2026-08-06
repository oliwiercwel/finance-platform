import json
import urllib.request
import urllib.parse
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime

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