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