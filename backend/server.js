require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Inicjalizacja bazy danych SQLite
const db = new sqlite3.Database(process.env.DB_PATH || './database/finance.db', (err) => {
    if (err) {
        console.error('Błąd podczas łączenia z bazą danych:', err);
    } else {
        console.log('Połączono z bazą danych SQLite');
    }
});

// Tworzenie tabel jeśli nie istnieją
db.serialize(() => {
    // Tabela akcji
    db.run(`CREATE TABLE IF NOT EXISTS stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        change REAL,
        volume TEXT,
        market_cap TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela historycznych danych cenowych
    db.run(`CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol)
    )`);

    // Tabela newsów
    db.run(`CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        source TEXT,
        url TEXT,
        published_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela użytkowników (do rozbudowy)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela portfolio (do rozbudowy)
    db.run(`CREATE TABLE IF NOT EXISTS portfolio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        symbol TEXT NOT NULL,
        quantity REAL NOT NULL,
        purchase_price REAL NOT NULL,
        purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
});

// ========== API ROUTES ==========

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Pobierz wszystkie akcje z Yahoo Finance
app.get('/api/stocks', async (req, res) => {
    try {
        // Lista popularnych symboli z całego świata
        const symbols = [
            // 🇵🇱 GPW
            'WIG20.WA', 'PKN.WA', 'PKO.WA', 'DNP.WA', 'PZU.WA', 'LPP.WA', 'CDR.WA', 'SPL.WA',
            // 🇺🇸 NASDAQ/NYSE
            'AAPL', 'TSLA', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC',
            // 🇪🇺 Europa
            'SAP.DE', 'ASML.AS', 'LVMH.PA', 'TTE.PA', 'SIE.DE', 'MC.PA', 'SANTANDER.MC', 'BMW.DE',
            // 🇨🇳 Chiny
            'BABA', 'BIDU', 'NIO', 'XPEV', 'LI', 'JD', 'PDD', 'BILI',
            // 🇰🇷 Korea
            '005930.KS', '000660.KS', 'HYMTF', '006400.KS',
            // 🪙 Kryptowaluty
            'BTC-USD', 'ETH-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'SOL-USD', 'DOGE-USD',
            // 💱 Waluty
            'EURPLN=X', 'USDPLN=X', 'GBPUSD=X', 'USDJPY=X', 'EURUSD=X',
            // 🛢️ Towary
            'GC=F', 'SI=F', 'CL=F', 'NG=F'
        ];

        const results = [];
        
        // Pobierz dane dla każdego symbolu (batch po 10)
        for (let i = 0; i < symbols.length; i += 10) {
            const batch = symbols.slice(i, i + 10);
            const batchResults = await yahooFinance.quote(batch);
            results.push(...batchResults);
        }

        // Przekształć dane do naszego formatu
        const formattedStocks = results.map(quote => {
            if (!quote || !quote.symbol) return null;
            
            const change = quote.regularMarketChangePercent || 0;
            const price = quote.regularMarketPrice || 0;
            
            return {
                symbol: quote.symbol,
                name: quote.shortName || quote.longName || quote.symbol,
                price: price,
                change: change,
                volume: formatVolume(quote.regularMarketVolume),
                cap: formatMarketCap(quote.marketCap),
                currency: quote.currency || 'USD'
            };
        }).filter(stock => stock !== null);

        // Zapisz do bazy danych
        const insertSql = `INSERT OR REPLACE INTO stocks 
            (symbol, name, price, change, volume, market_cap, last_updated) 
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`;
        
        formattedStocks.forEach(stock => {
            db.run(insertSql, [
                stock.symbol,
                stock.name,
                stock.price,
                stock.change,
                stock.volume,
                stock.cap
            ]);
        });

        res.json(formattedStocks);
    } catch (error) {
        console.error('Błąd pobierania danych z Yahoo Finance:', error);
        res.status(500).json({ error: 'Błąd pobierania danych', details: error.message });
    }
});

// Pobierz konkretną akcję
app.get('/api/stocks/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const quote = await yahooFinance.quote(symbol);
        
        if (!quote) {
            return res.status(404).json({ error: 'Akcja nie znaleziona' });
        }

        const stock = {
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChangePercent || 0,
            volume: formatVolume(quote.regularMarketVolume),
            cap: formatMarketCap(quote.marketCap),
            currency: quote.currency || 'USD',
            high: quote.regularMarketDayHigh,
            low: quote.regularMarketDayLow,
            open: quote.regularMarketOpen,
            previousClose: quote.regularMarketPreviousClose
        };

        res.json(stock);
    } catch (error) {
        console.error('Błąd pobierania akcji:', error);
        res.status(500).json({ error: 'Błąd pobierania danych', details: error.message });
    }
});

// Pobierz historię cenową
app.get('/api/stocks/:symbol/history', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { period = '1M' } = req.query;
        
        // Mapowanie okresów na parametry Yahoo Finance
        const periodMap = {
            '1D': { period1: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1m' },
            '1W': { period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1h' },
            '1M': { period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1d' },
            '3M': { period1: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1d' },
            '1Y': { period1: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1d' }
        };

        const params = periodMap[period] || periodMap['1M'];
        
        const history = await yahooFinance.historical(symbol, params);
        
        const formattedHistory = history.map(item => ({
            date: item.date,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume
        }));

        res.json(formattedHistory);
    } catch (error) {
        console.error('Błąd pobierania historii:', error);
        res.status(500).json({ error: 'Błąd pobierania historii', details: error.message });
    }
});

// Pobierz newsy
app.get('/api/news', async (req, res) => {
    try {
        const { symbols } = req.query;
        
        if (!symbols) {
            return res.json([]);
        }

        const symbolArray = symbols.split(',');
        const news = await yahooFinance.search(symbolArray.join(' '), { quotesCount: 0, newsCount: 10 });
        
        if (news.news && news.news.length > 0) {
            const formattedNews = news.news.map(item => ({
                title: item.title,
                description: item.summary || '',
                url: item.link,
                published_at: new Date(item.providerPublishTime * 1000).toISOString(),
                source: item.publisher,
                image: item.thumbnail?.resolutions?.[0]?.url || null
            }));
            
            res.json(formattedNews);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Błąd pobierania newsów:', error);
        res.status(500).json({ error: 'Błąd pobierania newsów', details: error.message });
    }
});

// Wyszukiwanie symboli
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Brak parametru wyszukiwania' });
        }

        const results = await yahooFinance.search(q, { quotesCount: 20, newsCount: 0 });
        
        if (results.quotes && results.quotes.length > 0) {
            const formattedResults = results.quotes.map(quote => ({
                symbol: quote.symbol,
                name: quote.shortName || quote.longName || quote.symbol,
                type: quote.quoteType,
                exchange: quote.exchange
            }));
            res.json(formattedResults);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Błąd wyszukiwania:', error);
        res.status(500).json({ error: 'Błąd wyszukiwania', details: error.message });
    }
});

// Zaawansowane wyszukiwanie - zwraca pełne dane tickerów
app.get('/api/search/advanced', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Brak parametru wyszukiwania' });
        }

        const results = await yahooFinance.search(q, { quotesCount: 30, newsCount: 0 });
        
        if (results.quotes && results.quotes.length > 0) {
            // Pobierz pełne dane dla znalezionych symboli
            const symbols = results.quotes.slice(0, 15).map(q => q.symbol);
            const quotes = await yahooFinance.quote(symbols);
            
            const formattedResults = quotes.map(quote => {
                if (!quote || !quote.symbol) return null;
                return {
                    symbol: quote.symbol,
                    name: quote.shortName || quote.longName || quote.symbol,
                    price: quote.regularMarketPrice || 0,
                    change: quote.regularMarketChangePercent || 0,
                    changeAbs: quote.regularMarketChange || 0,
                    volume: formatVolume(quote.regularMarketVolume),
                    marketCap: formatMarketCap(quote.marketCap),
                    currency: quote.currency || 'USD',
                    type: quote.quoteType || 'EQUITY',
                    exchange: quote.exchange || '',
                    high: quote.regularMarketDayHigh || 0,
                    low: quote.regularMarketDayLow || 0,
                    open: quote.regularMarketOpen || 0,
                    previousClose: quote.regularMarketPreviousClose || 0,
                    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
                    fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
                    marketState: quote.marketState || 'CLOSED'
                };
            }).filter(item => item !== null);
            
            res.json(formattedResults);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Błąd zaawansowanego wyszukiwania:', error);
        res.status(500).json({ error: 'Błąd wyszukiwania', details: error.message });
    }
});

// Szczegółowe dane akcji (pełny widok)
app.get('/api/stocks/:symbol/detail', async (req, res) => {
    try {
        const { symbol } = req.params;
        const quote = await yahooFinance.quote(symbol);
        
        if (!quote) {
            return res.status(404).json({ error: 'Akcja nie znaleziona' });
        }

        const stock = {
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChangePercent || 0,
            changeAbs: quote.regularMarketChange || 0,
            volume: formatVolume(quote.regularMarketVolume),
            cap: formatMarketCap(quote.marketCap),
            currency: quote.currency || 'USD',
            high: quote.regularMarketDayHigh || 0,
            low: quote.regularMarketDayLow || 0,
            open: quote.regularMarketOpen || 0,
            previousClose: quote.regularMarketPreviousClose || 0,
            fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
            fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
            marketState: quote.marketState || 'CLOSED',
            marketCap: quote.marketCap || 0,
            averageVolume: formatVolume(quote.averageDailyVolume3Month || quote.averageDailyVolume10Day),
            peRatio: quote.trailingPE || quote.forwardPE || null,
            dividendYield: quote.dividendYield ? (quote.dividendYield * 100).toFixed(2) + '%' : null,
            beta: quote.beta || null,
            eps: quote.epsTrailingTwelveMonths || null,
            earningsDate: quote.earningsTimestamp ? new Date(quote.earningsTimestamp * 1000).toISOString().split('T')[0] : null,
            exchange: quote.exchange || '',
            quoteType: quote.quoteType || 'EQUITY'
        };

        res.json(stock);
    } catch (error) {
        console.error('Błąd pobierania szczegółów akcji:', error);
        res.status(500).json({ error: 'Błąd pobierania danych', details: error.message });
    }
});

// Pobierz listę kategorii rynków
app.get('/api/markets/categories', (req, res) => {
    const categories = [
        { id: 'poland', name: '🇵🇱 Polska (GPW)', symbols: ['WIG20.WA', 'PKN.WA', 'PKO.WA', 'DNP.WA', 'PZU.WA', 'LPP.WA'] },
        { id: 'usa', name: '🇺🇸 USA (NASDAQ/NYSE)', symbols: ['AAPL', 'TSLA', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'META', 'NFLX'] },
        { id: 'europe', name: '🇪🇺 Europa', symbols: ['SAP.DE', 'ASML.AS', 'LVMH.PA', 'TTE.PA', 'SIE.DE'] },
        { id: 'china', name: '🇨🇳 Chiny', symbols: ['BABA', 'BIDU', 'NIO', 'XPEV', 'LI', 'JD'] },
        { id: 'korea', name: '🇰🇷 Korea', symbols: ['005930.KS', '000660.KS', 'HYMTF'] },
        { id: 'crypto', name: '🪙 Kryptowaluty', symbols: ['BTC-USD', 'ETH-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'SOL-USD'] },
        { id: 'forex', name: '💱 Waluty', symbols: ['EURPLN=X', 'USDPLN=X', 'GBPUSD=X', 'EURUSD=X'] },
        { id: 'commodities', name: '🛢️ Towary', symbols: ['GC=F', 'SI=F', 'CL=F'] }
    ];
    
    res.json(categories);
});

// ========== KALENDARZ EKONOMICZNY ==========

// Tłumaczenia wydarzeń i wpływ na rynek (PL)
const EVENT_TRANSLATIONS = {
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
};

// Cache dla kalendarza (2 godziny)
let calendarCache = { data: null, timestamp: 0 };
const CACHE_TTL = 7200000; // 2 godziny w milisekundach

// Funkcja do pobierania kalendarza z Yahoo Finance
async function fetchYahooCalendar() {
    const endpoints = [
        'https://query1.finance.yahoo.com/v1/finance/calendar?region=US&lang=en&corsDomain=finance.yahoo.com',
        'https://query2.finance.yahoo.com/v1/finance/calendar?region=US&lang=en&corsDomain=finance.yahoo.com',
        'https://query1.finance.yahoo.com/v1/finance/calendar?region=US&lang=en-US&corsDomain=finance.yahoo.com',
    ];
    
    for (const url of endpoints) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const data = await response.json();
            if (data && data.result && data.result.length > 0) {
                return data;
            }
        } catch (error) {
            console.log(`Yahoo calendar endpoint failed: ${url} - ${error.message}`);
            continue;
        }
    }
    return null;
}

// Generuj przykładowe wydarzenia z realistycznymi prognozami (fallback)
function generateSampleCalendarEventsWithForecasts() {
    const baseEvents = [
        { event: 'FOMC Rate Decision', time: '20:00', country: 'US', currency: 'USD', impact: 'high', forecast: '4.50%', actual: null, previous: '4.50%' },
        { event: 'CPI YoY', time: '14:30', country: 'US', currency: 'USD', impact: 'high', forecast: '3.1%', actual: null, previous: '3.0%' },
        { event: 'Core CPI YoY', time: '14:30', country: 'US', currency: 'USD', impact: 'high', forecast: '3.3%', actual: null, previous: '3.3%' },
        { event: 'Non-Farm Payrolls', time: '14:30', country: 'US', currency: 'USD', impact: 'high', forecast: '180K', actual: null, previous: '175K' },
        { event: 'Unemployment Rate', time: '14:30', country: 'US', currency: 'USD', impact: 'high', forecast: '3.9%', actual: null, previous: '3.9%' },
        { event: 'GDP QoQ', time: '14:30', country: 'US', currency: 'USD', impact: 'high', forecast: '2.8%', actual: null, previous: '3.0%' },
        { event: 'Retail Sales MoM', time: '14:30', country: 'US', currency: 'USD', impact: 'medium', forecast: '0.3%', actual: null, previous: '0.1%' },
        { event: 'PPI YoY', time: '14:30', country: 'US', currency: 'USD', impact: 'medium', forecast: '2.2%', actual: null, previous: '2.1%' },
        { event: 'ISM Manufacturing PMI', time: '16:00', country: 'US', currency: 'USD', impact: 'medium', forecast: '49.5', actual: null, previous: '49.2' },
        { event: 'ISM Services PMI', time: '16:00', country: 'US', currency: 'USD', impact: 'medium', forecast: '51.0', actual: null, previous: '51.4' },
        { event: 'Durable Goods Orders', time: '14:30', country: 'US', currency: 'USD', impact: 'medium', forecast: '0.5%', actual: null, previous: '-0.2%' },
        { event: 'Consumer Confidence', time: '16:00', country: 'US', currency: 'USD', impact: 'medium', forecast: '102.0', actual: null, previous: '101.3' },
        { event: 'Michigan Consumer Sentiment', time: '16:00', country: 'US', currency: 'USD', impact: 'medium', forecast: '72.0', actual: null, previous: '71.8' },
        { event: 'Building Permits', time: '14:30', country: 'US', currency: 'USD', impact: 'low', forecast: '1.45M', actual: null, previous: '1.44M' },
        { event: 'Housing Starts', time: '14:30', country: 'US', currency: 'USD', impact: 'low', forecast: '1.35M', actual: null, previous: '1.33M' },
        { event: 'ECB Rate Decision', time: '14:15', country: 'DE', currency: 'EUR', impact: 'high', forecast: '3.75%', actual: null, previous: '3.75%' },
        { event: 'ECB Press Conference', time: '14:45', country: 'DE', currency: 'EUR', impact: 'high', forecast: '', actual: null, previous: '' },
        { event: 'Eurozone CPI YoY', time: '11:00', country: 'DE', currency: 'EUR', impact: 'high', forecast: '2.4%', actual: null, previous: '2.4%' },
        { event: 'Eurozone PMI Manufacturing', time: '10:00', country: 'DE', currency: 'EUR', impact: 'medium', forecast: '46.0', actual: null, previous: '45.8' },
        { event: 'BoE Rate Decision', time: '13:00', country: 'GB', currency: 'GBP', impact: 'high', forecast: '5.25%', actual: null, previous: '5.25%' },
        { event: 'UK CPI YoY', time: '08:00', country: 'GB', currency: 'GBP', impact: 'high', forecast: '2.0%', actual: null, previous: '2.0%' },
        { event: 'BoJ Rate Decision', time: '03:00', country: 'JP', currency: 'JPY', impact: 'high', forecast: '0.10%', actual: null, previous: '0.10%' },
        { event: 'China PMI Manufacturing', time: '03:45', country: 'CN', currency: 'CNY', impact: 'medium', forecast: '50.5', actual: null, previous: '50.4' },
        { event: 'Australia Rate Decision', time: '05:30', country: 'AU', currency: 'AUD', impact: 'medium', forecast: '4.35%', actual: null, previous: '4.35%' },
        { event: 'Canada Rate Decision', time: '16:00', country: 'CA', currency: 'CAD', impact: 'medium', forecast: '4.75%', actual: null, previous: '4.75%' },
        { event: 'New Zealand Rate Decision', time: '03:00', country: 'NZ', currency: 'NZD', impact: 'low', forecast: '5.50%', actual: null, previous: '5.50%' },
        { event: 'OPEC+ Meeting', time: '15:00', country: 'INT', currency: 'USD', impact: 'high', forecast: '', actual: null, previous: '' },
        { event: 'EIA Crude Oil Inventory', time: '16:30', country: 'US', currency: 'USD', impact: 'medium', forecast: '-1.5M', actual: null, previous: '-2.1M' },
        { event: 'Fed Speakers', time: '18:00', country: 'US', currency: 'USD', impact: 'medium', forecast: '', actual: null, previous: '' },
        { event: 'Treasury Auction', time: '13:00', country: 'US', currency: 'USD', impact: 'low', forecast: '', actual: null, previous: '' },
    ];
    
    const events = [];
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
        const currentDate = new Date(today);
        currentDate.setDate(today.getDate() + i);
        const dateStr = currentDate.toISOString().split('T')[0];
        
        // 2-4 wydarzenia dziennie
        const numEvents = Math.floor(Math.random() * 3) + 2; // 2-4
        const shuffled = [...baseEvents].sort(() => 0.5 - Math.random());
        const dayEvents = shuffled.slice(0, numEvents);
        
        for (const ev of dayEvents) {
            const translation = EVENT_TRANSLATIONS[ev.event] || {};
            events.push({
                date: dateStr,
                time: ev.time,
                event: ev.event,
                event_pl: translation.pl || ev.event,
                country: ev.country,
                currency: ev.currency,
                actual: ev.actual,
                forecast: ev.forecast,
                previous: ev.previous,
                importance: ev.impact === 'high' ? 3 : ev.impact === 'medium' ? 2 : 1,
                impact: ev.impact,
                market_impact: translation.market_impact || 'Brak danych.'
            });
        }
    }
    
    return events;
}

// /api/calendar - Kalendarz ekonomiczny z Yahoo Finance + polskie tłumaczenia
app.get('/api/calendar', async (req, res) => {
    try {
        // Sprawdź cache
        const now = Date.now();
        if (calendarCache.data && (now - calendarCache.timestamp) < CACHE_TTL) {
            return res.json(calendarCache.data);
        }
        
        // Pobierz z Yahoo Finance Calendar API (próbuj różne endpointy)
        const data = await fetchYahooCalendar();
        
        let events = [];
        if (data && data.result && data.result.length > 0) {
            for (const item of data.result) {
                // Yahoo zwraca listę dni z eventami
                for (const day of item) {
                    if (day.events) {
                        for (const event of day.events) {
                            const eventName = event.event || '';
                            const country = event.country || '';
                            const currency = event.currency || '';
                            
                            // Tłumaczenie i wpływ na rynek
                            const translation = EVENT_TRANSLATIONS[eventName] || {};
                            
                            // Yahoo może zwracać forecast/actual/previous w różnych formatach
                            let forecast = event.forecast;
                            let actual = event.actual;
                            let previous = event.previous;
                            
                            // Jeśli brak prognozy, spróbuj pobrać z consensusEstimate lub podobnych pól
                            if (forecast === null || forecast === undefined) {
                                forecast = event.consensusEstimate || event.estimate || event.medianEstimate;
                            }
                            if (actual === null || actual === undefined) {
                                actual = event.actualValue || event.value || event.lastValue;
                            }
                            if (previous === null || previous === undefined) {
                                previous = event.previousValue || event.prior || event.revisedFrom;
                            }
                            
                            events.push({
                                date: day.date || '',
                                time: event.time || '',
                                event: eventName,
                                event_pl: translation.pl || eventName,
                                country: country,
                                currency: currency,
                                actual: actual,
                                forecast: forecast,
                                previous: previous,
                                importance: event.importance || 1,
                                impact: translation.impact || 'low',
                                market_impact: translation.market_impact || 'Brak danych.'
                            });
                        }
                    }
                }
            }
        }
        
        // FALLBACK: Jeśli Yahoo nie zwróciło danych, wygeneruj przykładowe na najbliższe 30 dni
        if (events.length === 0) {
            events = generateSampleCalendarEventsWithForecasts();
        }
        
        // Sortuj po dacie i czasie
        events.sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            return (a.time || '00:00').localeCompare(b.time || '00:00');
        });
        
        const result = { events: events, updated: new Date().toISOString() };
        
        // Zapisz do cache
        calendarCache.data = result;
        calendarCache.timestamp = now;
        
        res.json(result);
    } catch (error) {
        console.error('Błąd pobierania kalendarza:', error);
        // Fallback przy błędzie
        const events = generateSampleCalendarEventsWithForecasts();
        const result = { events: events, updated: new Date().toISOString(), error: error.message };
        res.json(result);
    }
});

// ========== WEBSOCKET ==========

wss.on('connection', (ws) => {
    console.log('Nowe połączenie WebSocket');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Odebrano:', data);
            
            // Obsługa subskrypcji
            if (data.type === 'subscribe') {
                ws.subscriptions = ws.subscriptions || [];
                if (!ws.subscriptions.includes(data.symbol)) {
                    ws.subscriptions.push(data.symbol);
                }
            }
        } catch (err) {
            console.error('Błąd parsowania wiadomości:', err);
        }
    });
    
    ws.on('close', () => {
        console.log('Połączenie WebSocket zamknięte');
    });
});

// Funkcja do broadcastu aktualizacji cen
function broadcastPriceUpdate(symbol, price, change) {
    const message = JSON.stringify({
        type: 'price_update',
        symbol,
        price,
        change,
        timestamp: new Date().toISOString()
    });
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            // Wyślij tylko jeśli klient subskrybuje ten symbol
            if (!client.subscriptions || client.subscriptions.includes(symbol)) {
                client.send(message);
            }
        }
    });
}

// ========== CRON JOBS ==========

// Aktualizacja danych co 30 sekund z Yahoo Finance
cron.schedule('*/30 * * * * *', async () => {
    console.log('Aktualizacja danych rynkowych z Yahoo Finance...');
    
    try {
        const symbols = [
            'WIG20.WA', 'AAPL', 'TSLA', 'BTC-USD', 'EURPLN=X', 'CL=F'
        ];
        
        const quotes = await yahooFinance.quote(symbols);
        
        quotes.forEach(quote => {
            if (!quote || !quote.symbol) return;
            
            const price = quote.regularMarketPrice || 0;
            const change = quote.regularMarketChangePercent || 0;
            
            // Aktualizuj w bazie
            const updateSql = `UPDATE stocks 
                              SET price = ?, change = ?, last_updated = CURRENT_TIMESTAMP 
                              WHERE symbol = ?`;
            db.run(updateSql, [price, change, quote.symbol]);
            
            // Zapisz do historii
            const historySql = `INSERT INTO price_history (symbol, price) VALUES (?, ?)`;
            db.run(historySql, [quote.symbol, price]);
            
            // Broadcast przez WebSocket
            broadcastPriceUpdate(quote.symbol, price, change);
        });
    } catch (error) {
        console.error('Błąd aktualizacji danych:', error);
    }
});

// Czyszczenie starej historii co dzień o północy
cron.schedule('0 0 * * *', () => {
    console.log('Czyszczenie starej historii cen...');
    const sql = `DELETE FROM price_history 
                 WHERE timestamp < datetime('now', '-30 days')`;
    db.run(sql, (err) => {
        if (err) console.error('Błąd czyszczenia historii:', err);
        else console.log('Historia wyczyszczona');
    });
});

// ========== SERWOWANIE STATYCZNEGO FRONTENDU ==========

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/css/:file', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/css', req.params.file));
});

app.get('/js/:file', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/js', req.params.file));
});

// ========== HELPER FUNCTIONS ==========

function formatVolume(volume) {
    if (!volume) return '0';
    if (volume >= 1e9) return (volume / 1e9).toFixed(1) + 'B';
    if (volume >= 1e6) return (volume / 1e6).toFixed(1) + 'M';
    if (volume >= 1e3) return (volume / 1e3).toFixed(1) + 'K';
    return volume.toString();
}

function formatMarketCap(marketCap) {
    if (!marketCap) return 'N/A';
    if (marketCap >= 1e12) return (marketCap / 1e12).toFixed(1) + 'T';
    if (marketCap >= 1e9) return (marketCap / 1e9).toFixed(1) + 'B';
    if (marketCap >= 1e6) return (marketCap / 1e6).toFixed(1) + 'M';
    return marketCap.toString();
}

// ========== STARTOWANIE SERWERA ==========

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Serwer HTTP uruchomiony na porcie ${PORT}`);
    console.log(`📊 Frontend dostępne pod: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket uruchomiony na tym samym porcie (${PORT})`);
    console.log(`💾 Baza danych: ${process.env.DB_PATH || './database/finance.db'}`);
});

// Obsługa zamknięcia
process.on('SIGINT', () => {
    console.log('\nZamykanie serwera...');
    db.close((err) => {
        if (err) console.error('Błąd zamykania bazy danych:', err);
        else console.log('Baza danych zamknięta');
    });
    server.close(() => {
        console.log('Serwer zamknięty');
        process.exit(0);
    });
});

module.exports = { app, server, db };