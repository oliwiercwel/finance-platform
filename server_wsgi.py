"""
WSGI wrapper for PythonAnywhere
Converts the HTTP server to WSGI application
"""

import json
import urllib.request
import urllib.parse
import os
import sys
from datetime import datetime

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import ALL_SYMBOLS, FRONTEND_DIR, fetch_yahoo, fetch_quote, format_volume, format_market_cap

def application(environ, start_response):
    """WSGI application entry point"""
    
    method = environ.get('REQUEST_METHOD', 'GET')
    path = environ.get('PATH_INFO', '/')
    query_string = environ.get('QUERY_STRING', '')
    query_params = urllib.parse.parse_qs(query_string)
    
    # CORS headers
    headers = [
        ('Content-Type', 'application/json; charset=utf-8'),
        ('Access-Control-Allow-Origin', '*'),
        ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
        ('Access-Control-Allow-Headers', 'Content-Type'),
    ]
    
    # Handle OPTIONS
    if method == 'OPTIONS':
        start_response('200 OK', headers)
        return [b'']
    
    try:
        # /api/health
        if path == '/api/health':
            data = {'status': 'ok', 'timestamp': datetime.now().isoformat()}
            start_response('200 OK', headers)
            return [json.dumps(data).encode('utf-8')]
        
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
            start_response('200 OK', headers)
            return [json.dumps(results).encode('utf-8')]
        
        # /api/search/advanced
        if path == '/api/search/advanced':
            query = query_params.get('q', [''])[0]
            if not query or len(query) < 2:
                start_response('200 OK', headers)
                return [json.dumps([]).encode('utf-8')]
            
            url = f"https://query1.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(query)}&quotesCount=20&newsCount=0"
            data = fetch_yahoo(url)
            
            if not data or 'quotes' not in data or not data['quotes']:
                start_response('200 OK', headers)
                return [json.dumps([]).encode('utf-8')]
            
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
            
            start_response('200 OK', headers)
            return [json.dumps(results).encode('utf-8')]
        
        # /api/stocks/{symbol}/detail
        if path.startswith('/api/stocks/') and path.endswith('/detail'):
            symbol = path.split('/')[3]
            quote = fetch_quote(symbol)
            
            if not quote:
                start_response('404 Not Found', headers)
                return [json.dumps({'error': 'Nie znaleziono'}).encode('utf-8')]
            
            quote['averageVolume'] = 'N/A'
            quote['peRatio'] = None
            quote['dividendYield'] = None
            quote['beta'] = None
            quote['eps'] = None
            quote['earningsDate'] = None
            
            start_response('200 OK', headers)
            return [json.dumps(quote).encode('utf-8')]
        
        # /api/stocks/{symbol}/history
        if path.startswith('/api/stocks/') and path.endswith('/history'):
            symbol = path.split('/')[3]
            period = query_params.get('period', ['1M'])[0]
            range_map = {'1D': '5d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '1Y': '1y'}
            range_val = range_map.get(period, '1mo')
            
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range_val}&interval=1d"
            data = fetch_yahoo(url)
            
            if not data or 'chart' not in data or not data['chart']['result']:
                start_response('200 OK', headers)
                return [json.dumps([]).encode('utf-8')]
            
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
            
            start_response('200 OK', headers)
            return [json.dumps(history).encode('utf-8')]
        
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
                        start_response('200 OK', headers)
                        return [json.dumps(news).encode('utf-8')]
            
            start_response('200 OK', headers)
            return [json.dumps([]).encode('utf-8')]
        
        # Not found
        start_response('404 Not Found', headers)
        return [json.dumps({'error': 'Not found'}).encode('utf-8')]
    
    except Exception as e:
        start_response('500 Internal Server Error', headers)
        return [json.dumps({'error': str(e)}).encode('utf-8')]