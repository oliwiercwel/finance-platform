const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ścieżka do bazy danych
const dbPath = path.join(__dirname, '../database/finance.db');

// Upewnij się, że katalog database istnieje
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Inicjalizacja bazy danych
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Błąd podczas łączenia z bazą danych:', err);
        process.exit(1);
    }
    console.log('Połączono z bazą danych:', dbPath);
});

// Wstaw przykładowe dane
const sampleStocks = [
    { symbol: 'WIG20', name: 'WIG20 Index', price: 2456.78, change: 1.23, volume: '1.2M', cap: '245B PLN' },
    { symbol: 'AAPL', name: 'Apple Inc.', price: 178.50, change: 2.15, volume: '52.3M', cap: '2.8T USD' },
    { symbol: 'TSLA', name: 'Tesla Inc.', price: 245.67, change: -1.45, volume: '98.7M', cap: '780B USD' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 141.80, change: 0.89, volume: '25.4M', cap: '1.8T USD' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', price: 378.91, change: 1.56, volume: '22.1M', cap: '2.8T USD' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 178.25, change: -0.34, volume: '35.6M', cap: '1.9T USD' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 875.38, change: 3.21, volume: '45.2M', cap: '2.2T USD' },
    { symbol: 'BTC', name: 'Bitcoin', price: 45234, change: 2.45, volume: '28.5B', cap: '890B USD' },
    { symbol: 'ETH', name: 'Ethereum', price: 2456.78, change: 1.89, volume: '15.2B', cap: '295B USD' },
    { symbol: 'PKN', name: 'PKN Orlen SA', price: 68.45, change: -0.56, volume: '2.1M', cap: '32B PLN' },
    { symbol: 'PKO', name: 'PKO BP', price: 42.30, change: 0.78, volume: '1.8M', cap: '28B PLN' },
    { symbol: 'DNP', name: 'Dino Polska', price: 285.00, change: 1.23, volume: '0.5M', cap: '18B PLN' }
];

const sampleNews = [
    {
        title: 'Rekordowe zyski Apple w Q4 2024',
        description: 'Apple ogłosił rekordowe zyski za czwarty kwartał 2024 roku, przewyższając oczekiwania analityków. Sprzedaż iPhone' + "'" + 'ów wzrosła o 8% r/r.',
        category: 'Technologia',
        source: 'Bloomberg',
        url: 'https://example.com/apple-q4-2024'
    },
    {
        title: 'NVIDIA prezentuje nowe chipy AI',
        description: 'NVIDIA zaprezentowała nową generację procesorów do sztucznej inteligencji, które mają zrewolucjonizować rynek obliczeń chmurowych.',
        category: 'Technologia',
        source: 'Reuters',
        url: 'https://example.com/nvidia-ai-chips'
    },
    {
        title: 'Ropa naftowa spada poniżej 80 USD',
        description: 'Ceny ropy WTI spadły poniżej 80 USD za baryłkę w reakcji na słabsze dane o zatrudnieniu w Chinach i obawy o spowolnienie gospodarcze.',
        category: 'Towary',
        source: 'CNBC',
        url: 'https://example.com/oil-price-drop'
    },
    {
        title: 'ECB utrzymuje stopy procentowe',
        description: 'Europejski Bank Centralny postanowił utrzymać stopy procentowe na obecnym poziomie, sygnalizując ostrożność w obliczu inflacji.',
        category: 'Gospodarka',
        source: 'Financial Times',
        url: 'https://example.com/ecb-rates'
    },
    {
        title: 'Bitcoin przekracza 45 000 USD',
        description: 'Kryptowaluta Bitcoin wzrosła powyżej 45 000 USD, osiągając najwyższy poziom od marca 2024 roku.',
        category: 'Kryptowaluty',
        source: 'CoinDesk',
        url: 'https://example.com/bitcoin-45k'
    },
    {
        title: 'Tesla zwiększa produkcję w Niemczech',
        description: 'Tesla ogłosiła plany zwiększenia produkcji w fabryce w Berlinie o 50% w odpowiedzi na rosnący popyt na rynku europejskim.',
        category: 'Motoryzacja',
        source: 'Automotive News',
        url: 'https://example.com/tesla-germany'
    },
    {
        title: 'WIG20 osiąga nowe szczyty',
        description: 'Główny indeks polskiego rynku akcji WIG20 osiągnął nowe szczyty, napędzany silnymi wynikami sektora bankowego.',
        category: 'Giełda',
        source: 'Bankier.pl',
        url: 'https://example.com/wig20-highs'
    },
    {
        title: 'Euro słabnie wobec dolara',
        description: 'Euro osłabiło się wobec dolara amerykańskiego, po słabszych niż oczekiwano danych o inflacji w strefie euro.',
        category: 'Waluty',
        source: 'Reuters',
        url: 'https://example.com/eur-usd'
    }
];

// Inicjalizacja tabel i wstawienie danych
db.serialize(() => {
    console.log('Inicjalizacja tabel...');

    // Wyczyszczenie istniejących danych (opcjonalne)
    db.run('DELETE FROM price_history', (err) => {
        if (err) console.error('Błąd czyszczenia price_history:', err);
    });
    
    db.run('DELETE FROM news', (err) => {
        if (err) console.error('Błąd czyszczenia news:', err);
    });
    
    db.run('DELETE FROM stocks', (err) => {
        if (err) console.error('Błąd czyszczenia stocks:', err);
    });

    // Wstaw akcje
    const insertStock = db.prepare(`INSERT OR REPLACE INTO stocks 
        (symbol, name, price, change, volume, market_cap, last_updated) 
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
    
    sampleStocks.forEach(stock => {
        insertStock.run([
            stock.symbol,
            stock.name,
            stock.price,
            stock.change,
            stock.volume,
            stock.cap
        ], (err) => {
            if (err) console.error('Błąd wstawiania akcji:', stock.symbol, err);
        });
    });
    
    insertStock.finalize((err) => {
        if (err) console.error('Błąd finalizacji insertStock:', err);
        else console.log('✓ Wstawiono', sampleStocks.length, 'akcji');
    });

    // Wstaw newsy
    const insertNews = db.prepare(`INSERT INTO news 
        (title, description, category, source, url, published_at, created_at) 
        VALUES (?, ?, ?, ?, ?, datetime('now', '-1 day'), datetime('now'))`);
    
    sampleNews.forEach((news, index) => {
        insertNews.run([
            news.title,
            news.description,
            news.category,
            news.source,
            news.url
        ], (err) => {
            if (err) console.error('Błąd wstawiania newsa:', index, err);
        });
    });
    
    insertNews.finalize((err) => {
        if (err) console.error('Błąd finalizacji insertNews:', err);
        else console.log('✓ Wstawiono', sampleNews.length, 'newsów');
    });

    // Wygeneruj przykładową historię cen dla każdej akcji
    console.log('Generowanie historii cen...');
    
    sampleStocks.forEach(stock => {
        const insertHistory = db.prepare(`INSERT INTO price_history (symbol, price, timestamp) VALUES (?, ?, ?)`);
        
        // Wygeneruj 200 punktów historycznych
        let currentPrice = stock.price * 0.9; // Zacznij od 10% niższej ceny
        const now = new Date();
        
        for (let i = 200; i >= 0; i--) {
            const timestamp = new Date(now - i * 3600000); // co godzinę
            const change = (Math.random() - 0.5) * stock.price * 0.02;
            currentPrice += change;
            
            insertHistory.run([
                stock.symbol,
                currentPrice,
                timestamp.toISOString()
            ], (err) => {
                if (err) console.error('Błąd wstawiania historii:', err);
            });
        }
        
        insertHistory.finalize((err) => {
            if (err) console.error('Błąd finalizacji insertHistory:', err);
        });
    });
    
    console.log('✓ Wygenerowano historię cen dla', sampleStocks.length, 'akcji');
});

// Weryfikacja danych
setTimeout(() => {
    console.log('\n=== WERYFIKACJA DANYCH ===');
    
    db.get('SELECT COUNT(*) as count FROM stocks', (err, row) => {
        if (!err) console.log(`Akcje w bazie: ${row.count}`);
    });
    
    db.get('SELECT COUNT(*) as count FROM news', (err, row) => {
        if (!err) console.log(`Newsy w bazie: ${row.count}`);
    });
    
    db.get('SELECT COUNT(*) as count FROM price_history', (err, row) => {
        if (!err) console.log(`Rekordów historii cen: ${row.count}`);
    });
    
    console.log('========================\n');
    
    db.close((err) => {
        if (err) console.error('Błąd zamykania bazy:', err);
        else console.log('Inicjalizacja zakończona pomyślnie!');
        process.exit(0);
    });
}, 2000);