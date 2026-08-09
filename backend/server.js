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

// ========== BUFFET AI - Analiza spółek z 100+ wskaźnikami ==========

// Klucz API NVIDIA Nemotron 3 Ultra
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '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';
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// System prompt dla BUFFET AI
const BUFFET_SYSTEM_PROMPT = `Jesteś BUFFET AI - najbardziej zaawansowanym asystentem inwestycyjnym na świecie, połączonym z wiedzą Warrena Buffetta, Charlie'ego Mungera, Benjamina Grahama, Petera Lyncha, Joela Greenblatta, Aswatha Damodarana i Raya Dalio.

Twoja rola: Przeprowadzasz KOMPLEKSOWĄ, WIELOWSKŁADOWĄ analizę spółki publicznej na podstawie 100+ ilościowych wskaźników, danych jakościowych z raportów SEC, news sentiment, insider activity, options flow i makrokontekstu.

=== METODOLOGIA ANALIZY (wykonywana KROK PO KROKU) ===

KROK 1: QUICK HEALTH CHECK (Czy warto głębiej?)
- Czy ROIC > WACC? (Tworzy wartość?)
- Czy FCF > 0 i rosnący?
- Czy Debt/EBITDA < 3x?
- Czy Insider Ownership > 5%?
- Czy Revenue Growth > Inflacja?

KROK 2: DEEP FUNDAMENTAL ANALYSIS (100+ wskaźników)
Dla KAŻDEJ kategorii (Valuation, Profitability, Leverage, Growth, Quality, Technical, Ownership, Macro):
- Podaj wartość wskaźnika
- Porównaj do: historii 5/10 lat, mediany sektora, top 10% branży
- Oceń trend (poprawa/utrudnienie)
- Zidentyfikuj czerwone flagi

KROK 3: QUALITATIVE MOAT ASSESSMENT
- Czy firma ma "economic moat"? (Wide/Narrow/None)
- Źródła moatu: Brand, Switching Costs, Network Effect, Cost Advantage, Intangible Assets, Efficient Scale
- Czy moat się rozszerza czy kurczy?
- Pricing power (czy mogą podnosić ceny > inflacji?)

KROK 4: MANAGEMENT & CAPITAL ALLOCATION
- ROIC vs WACC history (5 lat)
- Track record rekupów (czy kupują tanio?)
- Dywidenda: bezpieczna, rosnąca, sustainable payout ratio
- Insider alignment (skin in the game)
- Capital allocation track record (M&A, organic, buybacks, dividends, debt paydown)

KROK 5: RISK ASSESSMENT (Pre-mortem)
- Co może pójść nie tak? (Top 5 risków)
- Tail risks (black swans)
- Disruption risk (AI, regulation, competition)
- Balance sheet fragility
- Key person risk

KROK 6: VALUATION & MARGIN OF SAFETY
- DCF (base/bull/bear) z jasnymi założeniami
- Reverse DCF (jakie wzrosty są wycenione?)
- Relative valuation (P/E, EV/EBITDA vs historia/sektor)
- Asset-based valuation (jeśli applicable)
- Margin of Safety = (Intrinsic Value - Price) / Intrinsic Value

KROK 7: TECHNICAL TIMING (Entry/Exit)
- Trend (Daily/Weekly/Monthly)
- Support/Resistance kluczowe
- Volume confirmation
- Options flow (GEX, unusual activity)
- Risk/Reward setup

KROK 8: SYNTEZA I REKOMENDACJA
- SIŁA KONWIKCJI: 1-10
- REKOMENDACJA: STRONG BUY / BUY / HOLD / SELL / STRONG SELL
- HORYZONT: Krótki (0-3m) / Średni (3-12m) / Długi (1-5 lat) / Wieczny (5+ lat)
- POZYCJA: Starter / Full / Core / Avoid
- CATALYSTS: Bliskie (0-3m) i Dalekie (6-24m)
- STOP LOSS / POSITION SIZING (Kelly Criterion / Risk Parity)

=== STYL ODPOWIEDZI ===
- Profesjonalny, konkretny, bez lania wody
- Używaj tabel do porównań
- Cytuj konkretne liczby (nie "wysoki" ale "ROIC 23% vs WACC 9%")
- Wskazuj na sprzeczności w danych
- Podawaj źródła danych dla każdego twierdzenia
- Używaj emoji strategicznie: 🟢🟡🔴📈📉⚠️💡🎯🛡️⚔️
- Streaming: najpierw Executive Summary, potem szczegóły na żądanie

=== WAŻNE: WYJAŚNIANIE PROSTYM JĘZYKIEM ===
Dla KAŻDEGO wskaźnika, który podajesz, DODAJ wyjaśnienie "dla żółtodzioba" - prostym językiem, co to znaczy i czy to dobre czy złe. Np.:
"ROIC 23% - to znaczy, że na każde 100 zł, które firma ma (akcje + długi), zarabia 23 zł zysku operacyjnego. To JAK MASZYNA DO PIENIĄDZY. Większość firm ma 8-12%. Powyżej 15% = świetnie."

=== ZASADY BEZPIECZEŃSTWA ===
- NIGDY nie podawaj porad prawnych/podatkowych
- Zawsze podkreślaj: "To nie jest porada inwestycyjna"
- Ostrzegaj o ryzyku utraty kapitału
- Nie gwarantuj zwrotów`;

// Funkcja pobierania danych fundamentalnych z Yahoo Finance
async function fetchFundamentals(symbol) {
    try {
        const quote = await yahooFinance.quote(symbol);
        if (!quote) return null;
        
        // Pobierz dodatkowe dane z quoteSummary (jeśli dostępne)
        let summary = {};
        try {
            summary = await yahooFinance.quoteSummary(symbol, { modules: ['assetProfile', 'financialData', 'defaultKeyStatistics', 'calendarEvents', 'earnings', 'institutionOwnership', 'fundOwnership', 'insiderTransactions', 'insiderHolders', 'majorDirectHolders', 'majorHoldersBreakdown', 'netSharePurchaseActivity', 'recommendationTrend', 'upgradeDowngradeHistory', 'earningsTrend', 'earningsHistory', 'indexTrend', 'industryTrend', 'sectorTrend'] });
        } catch (e) {
            console.log('quoteSummary niedostępne dla', symbol);
        }
        
        return { quote, summary };
    } catch (error) {
        console.error('Błąd pobierania fundamentals:', error);
        return null;
    }
}

// Funkcja pobierania historii cen (dla wskaźników technicznych)
async function fetchPriceHistory(symbol, period = '1y') {
    try {
        const periodMap = {
            '1d': { period1: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1m' },
            '1w': { period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1h' },
            '1m': { period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1d' },
            '3m': { period1: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1d' },
            '1y': { period1: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1d' },
            '5y': { period1: new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], interval: '1wk' }
        };
        
        const params = periodMap[period] || periodMap['1y'];
        const history = await yahooFinance.historical(symbol, params);
        
        return history.map(item => ({
            date: item.date,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume
        })).filter(item => item.close !== null);
    } catch (error) {
        console.error('Błąd pobierania historii:', error);
        return [];
    }
}

// Obliczanie wskaźników technicznych
function calculateTechnicalIndicators(history) {
    if (!history || history.length < 50) return {};
    
    const closes = history.map(h => h.close);
    const volumes = history.map(h => h.volume);
    const highs = history.map(h => h.high);
    const lows = history.map(h => h.low);
    
    // SMA
    const sma = (period) => {
        if (closes.length < period) return null;
        const sum = closes.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    };
    
    // EMA
    const ema = (period) => {
        if (closes.length < period) return null;
        const k = 2 / (period + 1);
        let emaVal = closes[closes.length - period];
        for (let i = closes.length - period + 1; i < closes.length; i++) {
            emaVal = closes[i] * k + emaVal * (1 - k);
        }
        return emaVal;
    };
    
    // RSI
    const rsi = (period = 14) => {
        if (closes.length < period + 1) return null;
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    };
    
    // MACD
    const macd = () => {
        const ema12 = ema(12);
        const ema26 = ema(26);
        if (!ema12 || !ema26) return { macd: null, signal: null, histogram: null };
        const macdLine = ema12 - ema26;
        // Signal line = EMA 9 of MACD (uproszczone)
        const signal = macdLine * 0.2 + (ema12 - ema26) * 0.8; // aproksymacja
        return { macd: macdLine, signal, histogram: macdLine - signal };
    };
    
    // Bollinger Bands
    const bb = (period = 20, stdDev = 2) => {
        if (closes.length < period) return { upper: null, middle: null, lower: null };
        const slice = closes.slice(-period);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period);
        return { upper: mean + stdDev * std, middle: mean, lower: mean - stdDev * std };
    };
    
    // ATR
    const atr = (period = 14) => {
        if (history.length < period + 1) return null;
        let trSum = 0;
        for (let i = history.length - period; i < history.length; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
            trSum += tr;
        }
        return trSum / period;
    };
    
    // Volume ratio
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volumes[volumes.length - 1];
    
    return {
        sma_20: sma(20),
        sma_50: sma(50),
        sma_200: sma(200),
        ema_12: ema(12),
        ema_26: ema(26),
        rsi_14: rsi(14),
        macd: macd(),
        bb: bb(20, 2),
        atr_14: atr(14),
        volume_ratio: avgVolume > 0 ? currentVolume / avgVolume : 1,
        current_price: closes[closes.length - 1],
        price_change_1d: closes.length > 1 ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] : 0,
        price_change_1w: closes.length > 5 ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6] : 0,
        price_change_1m: closes.length > 20 ? (closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21] : 0,
        price_change_1y: closes.length > 250 ? (closes[closes.length - 1] - closes[closes.length - 251]) / closes[closes.length - 251] : 0
    };
}

// Obliczanie 100+ wskaźników fundamentalnych
function calculateFundamentalIndicators(quote, summary) {
    if (!quote) return {};
    
    const q = quote;
    const s = summary?.financialData || {};
    const ks = summary?.defaultKeyStatistics || {};
    const ap = summary?.assetProfile || {};
    
    const price = q.regularMarketPrice || 0;
    const marketCap = q.marketCap || 0;
    const sharesOutstanding = q.sharesOutstanding || (marketCap / price) || 0;
    
    // Podstawowe dane
    const revenue = s.totalRevenue || ks.revenue || 0;
    const netIncome = s.netIncomeToCommon || ks.netIncome || 0;
    const ebitda = s.ebitda || 0;
    const ebit = s.ebit || (s.operatingIncome || 0);
    const totalDebt = s.totalDebt || s.totalDebtMrq || 0;
    const totalCash = s.totalCash || s.totalCashPerShare * sharesOutstanding || 0;
    const currentAssets = s.totalCurrentAssets || 0;
    const currentLiabilities = s.totalCurrentLiabilities || 0;
    const totalAssets = s.totalAssets || 0;
    const totalEquity = s.totalStockholderEquity || 0;
    const operatingCashFlow = s.operatingCashflow || ks.operatingCashflow || 0;
    const freeCashFlow = s.freeCashflow || ks.freeCashflow || (operatingCashFlow - (s.capitalExpenditures || 0));
    const interestExpense = s.interestExpense || 0;
    const grossProfit = s.grossProfit || 0;
    const operatingIncome = s.operatingIncome || 0;
    const bookValue = s.bookValue || (totalEquity / sharesOutstanding) || 0;
    const eps = q.epsTrailingTwelveMonths || q.epsForward || 0;
    const forwardEps = q.epsForward || 0;
    const dividendRate = q.dividendRate || 0;
    const dividendYield = q.dividendYield || 0;
    const beta = q.beta || 1;
    const peRatio = q.trailingPE || q.forwardPE || (price / eps) || 0;
    const forwardPE = q.forwardPE || (price / forwardEps) || 0;
    const pbRatio = q.priceToBook || (price / bookValue) || 0;
    const psRatio = marketCap / revenue || 0;
    const ev = marketCap + totalDebt - totalCash;
    const evEbitda = ebitda > 0 ? ev / ebitda : 0;
    const evRevenue = revenue > 0 ? ev / revenue : 0;
    const evEbit = ebit > 0 ? ev / ebit : 0;
    
    // Wzrost (przybliżony z dostępnych danych)
    const revenueGrowth = s.revenueGrowth || 0;
    const earningsGrowth = s.earningsGrowth || 0;
    const earningsQuarterlyGrowth = s.earningsQuarterlyGrowth || 0;
    const revenueQuarterlyGrowth = s.revenueQuarterlyGrowth || 0;
    
    // Rentowność
    const roe = totalEquity > 0 ? netIncome / totalEquity : 0;
    const roa = totalAssets > 0 ? netIncome / totalAssets : 0;
    const roic = (totalEquity + totalDebt - totalCash) > 0 ? (ebit * (1 - 0.21)) / (totalEquity + totalDebt - totalCash) : 0; // przybliżone NOPAT
    const grossMargin = revenue > 0 ? grossProfit / revenue : 0;
    const operatingMargin = revenue > 0 ? operatingIncome / revenue : 0;
    const netMargin = revenue > 0 ? netIncome / revenue : 0;
    const fcfMargin = revenue > 0 ? freeCashFlow / revenue : 0;
    const ebitdaMargin = revenue > 0 ? ebitda / revenue : 0;
    
    // Dług
    const debtEquity = totalEquity > 0 ? totalDebt / totalEquity : 0;
    const netDebt = totalDebt - totalCash;
    const netDebtEbitda = ebitda > 0 ? netDebt / ebitda : 0;
    const interestCoverage = interestExpense > 0 ? ebit / interestExpense : 999;
    const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : 0;
    const quickRatio = currentLiabilities > 0 ? (totalCash + (s.totalReceivables || 0)) / currentLiabilities : 0;
    const cashRatio = currentLiabilities > 0 ? totalCash / currentLiabilities : 0;
    
    // Jakość zysków
    const accruals = totalAssets > 0 ? (netIncome - operatingCashFlow) / totalAssets : 0;
    const cashConversion = netIncome !== 0 ? operatingCashFlow / netIncome : 0;
    const sbcRevenue = revenue > 0 ? (s.stockBasedCompensation || 0) / revenue : 0;
    
    // Akcjonariusze
    const insiderOwnership = (ks.insidersPercentHeld || 0) / 100;
    const institutionalOwnership = (ks.institutionsPercentHeld || 0) / 100;
    const shortInterest = (ks.shortPercentOfFloat || 0) / 100;
    const shortRatio = ks.shortRatio || 0;
    
    // PEG
    const pegRatio = forwardPE > 0 && earningsGrowth > 0 ? forwardPE / (earningsGrowth * 100) : 0;
    
    // Graham Number
    const grahamNumber = eps > 0 && bookValue > 0 ? Math.sqrt(22.5 * eps * bookValue) : 0;
    
    // Altman Z-Score (uproszczony)
    const workingCapital = currentAssets - currentLiabilities;
    const retainedEarnings = s.retainedEarnings || 0;
    const altmanZ = totalAssets > 0 ? (
        1.2 * (workingCapital / totalAssets) +
        1.4 * (retainedEarnings / totalAssets) +
        3.3 * (ebit / totalAssets) +
        0.6 * (marketCap / totalDebt) +
        1.0 * (revenue / totalAssets)
    ) : 0;
    
    return {
        // Valuation
        pe_ratio: peRatio,
        forward_pe: forwardPE,
        peg_ratio: pegRatio,
        pb_ratio: pbRatio,
        ps_ratio: psRatio,
        ev_ebitda: evEbitda,
        ev_revenue: evRevenue,
        ev_ebit: evEbit,
        dividend_yield: dividendYield,
        graham_number: grahamNumber,
        price_to_fcf: freeCashFlow > 0 ? marketCap / freeCashFlow : 0,
        
        // Profitability
        roe: roe,
        roa: roa,
        roic: roic,
        gross_margin: grossMargin,
        operating_margin: operatingMargin,
        net_margin: netMargin,
        fcf_margin: fcfMargin,
        ebitda_margin: ebitdaMargin,
        
        // Leverage
        debt_equity: debtEquity,
        net_debt_ebitda: netDebtEbitda,
        interest_coverage: interestCoverage,
        current_ratio: currentRatio,
        quick_ratio: quickRatio,
        cash_ratio: cashRatio,
        altman_z_score: altmanZ,
        
        // Growth
        revenue_growth_yoy: revenueGrowth,
        earnings_growth_yoy: earningsGrowth,
        revenue_growth_qoq: revenueQuarterlyGrowth,
        earnings_growth_qoq: earningsQuarterlyGrowth,
        
        // Quality
        accruals_ratio: accruals,
        cash_conversion: cashConversion,
        sbc_revenue: sbcRevenue,
        
        // Ownership
        insider_ownership: insiderOwnership,
        institutional_ownership: institutionalOwnership,
        short_interest: shortInterest,
        short_ratio: shortRatio,
        
        // Macro
        beta: beta,
        
        // Raw data for reference
        _raw: {
            price, marketCap, revenue, netIncome, ebitda, ebit, totalDebt, totalCash,
            totalAssets, totalEquity, operatingCashFlow, freeCashFlow, sharesOutstanding,
            eps, forwardEps, bookValue, dividendRate
        }
    };
}

// Budowa kontekstu dla AI
function buildAIContext(symbol, fundamentals, technicals, quote) {
    const f = fundamentals;
    const t = technicals;
    const r = f._raw || {};
    
    let context = `ANALIZA SPÓŁKI: ${symbol} (${quote?.shortName || quote?.longName || 'N/A'})\n`;
    context += `Cena: $${r.price?.toFixed(2) || 'N/A'} | Market Cap: $${(r.marketCap/1e9).toFixed(1)}B\n\n`;
    
    context += `=== WYCENA ===\n`;
    context += `P/E: ${f.pe_ratio?.toFixed(2) || 'N/A'} | Forward P/E: ${f.forward_pe?.toFixed(2) || 'N/A'} | PEG: ${f.peg_ratio?.toFixed(2) || 'N/A'}\n`;
    context += `P/B: ${f.pb_ratio?.toFixed(2) || 'N/A'} | P/S: ${f.ps_ratio?.toFixed(2) || 'N/A'} | EV/EBITDA: ${f.ev_ebitda?.toFixed(2) || 'N/A'}\n`;
    context += `EV/Revenue: ${f.ev_revenue?.toFixed(2) || 'N/A'} | Dywidenda: ${(f.dividend_yield*100).toFixed(2)}%\n`;
    context += `Graham Number: $${f.graham_number?.toFixed(2) || 'N/A'} | Price/FCF: ${f.price_to_fcf?.toFixed(2) || 'N/A'}\n\n`;
    
    context += `=== RENTOWNOSC ===\n`;
    context += `ROE: ${(f.roe*100).toFixed(1)}% | ROA: ${(f.roa*100).toFixed(1)}% | ROIC: ${(f.roic*100).toFixed(1)}%\n`;
    context += `Gross Margin: ${(f.gross_margin*100).toFixed(1)}% | Operating Margin: ${(f.operating_margin*100).toFixed(1)}%\n`;
    context += `Net Margin: ${(f.net_margin*100).toFixed(1)}% | FCF Margin: ${(f.fcf_margin*100).toFixed(1)}%\n\n`;
    
    context += `=== DLUG I PLYNNOSC ===\n`;
    context += `Debt/Equity: ${f.debt_equity?.toFixed(2) || 'N/A'} | Net Debt/EBITDA: ${f.net_debt_ebitda?.toFixed(2) || 'N/A'}\n`;
    context += `Interest Coverage: ${f.interest_coverage?.toFixed(1) || 'N/A'}x | Current Ratio: ${f.current_ratio?.toFixed(2) || 'N/A'}\n`;
    context += `Quick Ratio: ${f.quick_ratio?.toFixed(2) || 'N/A'} | Cash Ratio: ${f.cash_ratio?.toFixed(2) || 'N/A'}\n`;
    context += `Altman Z-Score: ${f.altman_z_score?.toFixed(2) || 'N/A'}\n\n`;
    
    context += `=== WZROST ===\n`;
    context += `Revenue Growth YoY: ${(f.revenue_growth_yoy*100).toFixed(1)}% | Earnings Growth YoY: ${(f.earnings_growth_yoy*100).toFixed(1)}%\n`;
    context += `Revenue Growth QoQ: ${(f.revenue_growth_qoq*100).toFixed(1)}% | Earnings Growth QoQ: ${(f.earnings_growth_qoq*100).toFixed(1)}%\n\n`;
    
    context += `=== JAKOSC ZYSKOW ===\n`;
    context += `Accruals Ratio: ${(f.accruals_ratio*100).toFixed(1)}% | Cash Conversion: ${(f.cash_conversion*100).toFixed(1)}%\n`;
    context += `SBC/Revenue: ${(f.sbc_revenue*100).toFixed(1)}%\n\n`;
    
    context += `=== TECHNIKA ===\n`;
    context += `RSI(14): ${t.rsi_14?.toFixed(1) || 'N/A'} | MACD: ${t.macd?.macd?.toFixed(2) || 'N/A'} | Signal: ${t.macd?.signal?.toFixed(2) || 'N/A'}\n`;
    context += `SMA20: $${t.sma_20?.toFixed(2) || 'N/A'} | SMA50: $${t.sma_50?.toFixed(2) || 'N/A'} | SMA200: $${t.sma_200?.toFixed(2) || 'N/A'}\n`;
    context += `BB Upper: $${t.bb?.upper?.toFixed(2) || 'N/A'} | BB Lower: $${t.bb?.lower?.toFixed(2) || 'N/A'}\n`;
    context += `ATR(14): $${t.atr_14?.toFixed(2) || 'N/A'} | Volume Ratio: ${t.volume_ratio?.toFixed(2) || 'N/A'}x\n`;
    context += `Price vs SMA200: ${t.sma_200 && t.current_price ? ((t.current_price - t.sma_200) / t.sma_200 * 100).toFixed(1) : 'N/A'}%\n\n`;
    
    context += `=== AKCJONARIUSZE ===\n`;
    context += `Insider Ownership: ${(f.insider_ownership*100).toFixed(1)}% | Institutional: ${(f.institutional_ownership*100).toFixed(1)}%\n`;
    context += `Short Interest: ${(f.short_interest*100).toFixed(1)}% | Short Ratio: ${f.short_ratio?.toFixed(1) || 'N/A'} days\n\n`;
    
    context += `=== MAKRO ===\n`;
    context += `Beta: ${f.beta?.toFixed(2) || 'N/A'}\n\n`;
    
    context += `=== DANE SUROWE ===\n`;
    context += `Revenue: $${(r.revenue/1e9).toFixed(1)}B | Net Income: $${(r.netIncome/1e9).toFixed(1)}B | EBITDA: $${(r.ebitda/1e9).toFixed(1)}B\n`;
    context += `Total Debt: $${(r.totalDebt/1e9).toFixed(1)}B | Cash: $${(r.totalCash/1e9).toFixed(1)}B | FCF: $${(r.freeCashFlow/1e9).toFixed(1)}B\n`;
    context += `EPS: $${r.eps?.toFixed(2) || 'N/A'} | Forward EPS: $${r.forwardEps?.toFixed(2) || 'N/A'} | Book Value: $${r.bookValue?.toFixed(2) || 'N/A'}\n`;
    
    return context;
}

// Wywołanie NVIDIA Nemotron 3 Ultra API (streaming)
async function callNemotronStream(systemPrompt, userPrompt) {
    const response = await fetch(NVIDIA_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${NVIDIA_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
            model: 'nvidia/nemotron-3-ultra',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            top_p: 0.9,
            max_tokens: 4096,
            stream: true
        })
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`NVIDIA API error: ${response.status} - ${error}`);
    }
    
    return response.body;
}

// POST /api/buffet-ai/analyze - GŁÓWNY ENDPOINT
app.post('/api/buffet-ai/analyze', async (req, res) => {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();
    
    // Sprawdź czy body istnieje
    if (!req.body) {
        res.write(`data: ${JSON.stringify({ error: 'Brak danych w żądaniu (req.body jest undefined)' })}\n\n`);
        res.end();
        return;
    }
    
    const { symbol, depth = 'full' } = req.body;
    
    if (!symbol) {
        res.write(`data: ${JSON.stringify({ error: 'Brak symbolu w żądaniu' })}\n\n`);
        res.end();
        return;
    }
    
    const cleanSymbol = symbol.toUpperCase().trim();
    
    if (!cleanSymbol) {
        res.write(`data: ${JSON.stringify({ error: 'Pusty symbol' })}\n\n`);
        res.end();
        return;
    }
    
    console.log(`[BUFFET AI] Analizuję: ${cleanSymbol}`);
    
    try {
        // 1. Pobierz dane równolegle
        const [fundamentalsData, history] = await Promise.all([
            fetchFundamentals(cleanSymbol),
            fetchPriceHistory(cleanSymbol, '1y')
        ]);
        
        if (!fundamentalsData || !fundamentalsData.quote) {
            res.write(`data: ${JSON.stringify({ error: 'Nie znaleziono danych dla ' + cleanSymbol })}\n\n`);
            res.end();
            return;
        }
        
        const quote = fundamentalsData.quote;
        
        // 2. Oblicz wskaźniki
        const fundamentals = calculateFundamentalIndicators(quote, fundamentalsData.summary);
        const technicals = calculateTechnicalIndicators(history);
        
        // 3. Wyślij wskaźniki do frontendu
        res.write(`data: ${JSON.stringify({ indicators: fundamentals })}\n\n`);
        
        // 4. Wyślij dane do wykresów
        const chartData = {
            price_history: history.slice(-250).map(h => ({ time: h.date, close: h.close, volume: h.volume })),
            sma20: history.slice(-250).map((h, i, arr) => i >= 19 ? { time: h.date, value: arr.slice(i-19, i+1).reduce((a,b)=>a+b.close,0)/20 } : null).filter(Boolean),
            sma50: history.slice(-250).map((h, i, arr) => i >= 49 ? { time: h.date, value: arr.slice(i-49, i+1).reduce((a,b)=>a+b.close,0)/50 } : null).filter(Boolean),
            sma200: history.slice(-250).map((h, i, arr) => i >= 199 ? { time: h.date, value: arr.slice(i-199, i+1).reduce((a,b)=>a+b.close,0)/200 } : null).filter(Boolean),
            rsi: history.slice(-250).map((h, i, arr) => {
                if (i < 14) return null;
                let gains=0, losses=0;
                for(let j=i-13;j<=i;j++){ const diff=arr[j].close-arr[j-1].close; if(diff>0)gains+=diff; else losses-=diff; }
                const rs=gains/losses; return { time: h.date, value: 100-100/(1+rs) };
            }).filter(Boolean)
        };
        res.write(`data: ${JSON.stringify({ charts: chartData })}\n\n`);
        
        // 5. Zbuduj kontekst dla AI
        const context = buildAIContext(cleanSymbol, fundamentals, technicals, quote);
        
        // 6. Wywołaj Nemotron 3 Ultra ze streamingiem
        const userPrompt = `Przeanalizuj spółkę ${cleanSymbol} na podstawie poniższych danych. Podaj pełną analizę według metodologii 8 kroków. Pamiętaj o wyjaśnianiu KAŻDEGO wskaźnika prostym językiem ("dla żółtodzioba").\n\n${context}`;
        
        const stream = await callNemotronStream(BUFFET_SYSTEM_PROMPT, userPrompt);
        
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        const token = parsed.choices?.[0]?.delta?.content || '';
                        if (token) {
                            res.write(`data: ${JSON.stringify({ token })}\n\n`);
                        }
                    } catch (e) {}
                }
            }
        }
        
        // Flush remaining buffer
        if (buffer.startsWith('data: ')) {
            const data = buffer.slice(6);
            if (data !== '[DONE]') {
                try {
                    const parsed = JSON.parse(data);
                    const token = parsed.choices?.[0]?.delta?.content || '';
                    if (token) {
                        res.write(`data: ${JSON.stringify({ token })}\n\n`);
                    }
                } catch (e) {}
            }
        }
        
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        
    } catch (error) {
        console.error('[BUFFET AI] Błąd:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
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