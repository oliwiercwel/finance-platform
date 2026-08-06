// Dane akcji - początkowo puste, będą ładowane z backendu
let stocks = [];
let useBackend = false; // Flaga czy używać backendu
const API_BASE = ''; // Zmień na 'http://localhost:3000' jeśli backend działa na innym porcie
const WS_URL = `ws://${window.location.hostname}:${window.location.port || 3000}`;

// Portfolio użytkownika
let portfolio = JSON.parse(localStorage.getItem('portfolio')) || [];

// WebSocket connection
let ws = null;
let wsConnected = false;
let wsReconnectAttempts = 0;
const MAX_WS_RECONNECT_ATTEMPTS = 5;

// Funkcja do pobierania danych z backendu
async function fetchFromBackend(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Błąd pobierania ${endpoint}:`, error);
        return null;
    }
}

// ========== BEZPOŚREDNIE YAHOO FINANCE API (fallback gdy brak backendu) ==========

// Pobierz dane bezpośrednio z Yahoo Finance (przez serwer proxy)
async function fetchYahooFinance(url) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Błąd Yahoo Finance:', error);
        return null;
    }
}

// Pobierz notowania przez serwer (fallback)
async function fetchStockQuotesDirect(symbols) {
    return await fetchFromBackend('/api/stocks');
}

// Zaawansowane wyszukiwanie przez serwer (fallback)
async function advancedSearchDirect(query) {
    return await fetchFromBackend(`/api/search/advanced?q=${encodeURIComponent(query)}`);
}

// Pobierz szczegóły akcji przez serwer (fallback)
async function stockDetailDirect(symbol) {
    return await fetchFromBackend(`/api/stocks/${symbol}/detail`);
}

// Pobierz newsy przez serwer (fallback)
async function fetchNewsDirect() {
    return await fetchFromBackend('/api/news');
}

// Pobierz historię cen przez serwer (fallback)
async function fetchChartHistoryDirect(symbol, range = '1mo') {
    const periodMap = { '5d': '1D', '1wk': '1W', '1mo': '1M', '3mo': '3M', '1y': '1Y' };
    const period = periodMap[range] || '1M';
    const history = await fetchFromBackend(`/api/stocks/${symbol}/history?period=${period}`);
    
    if (history && history.length > 0) {
        return {
            labels: history.map(item => new Date(item.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })),
            data: history.map(item => item.close || 0)
        };
    }
    return null;
}

// Formatowanie wolumenu
function formatVolume(volume) {
    if (!volume) return '0';
    if (volume >= 1e9) return (volume / 1e9).toFixed(1) + 'B';
    if (volume >= 1e6) return (volume / 1e6).toFixed(1) + 'M';
    if (volume >= 1e3) return (volume / 1e3).toFixed(1) + 'K';
    return volume.toString();
}

// Formatowanie kapitalizacji
function formatMarketCap(marketCap) {
    if (!marketCap) return 'N/A';
    if (marketCap >= 1e12) return (marketCap / 1e12).toFixed(1) + 'T';
    if (marketCap >= 1e9) return (marketCap / 1e9).toFixed(1) + 'B';
    if (marketCap >= 1e6) return (marketCap / 1e6).toFixed(1) + 'M';
    return marketCap.toString();
}

// ========== WEBSOCKET ==========

// Inicjalizacja WebSocket
function initWebSocket() {
    try {
        ws = new WebSocket(WS_URL);
        
        ws.onopen = () => {
            console.log('✓ Połączono z WebSocket');
            wsConnected = true;
            wsReconnectAttempts = 0;
            
            // Subskrybuj wszystkie dostępne symbole
            stocks.forEach(stock => {
                subscribeToSymbol(stock.symbol);
            });
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'price_update') {
                    handlePriceUpdate(data);
                }
            } catch (error) {
                console.error('Błąd parsowania wiadomości WebSocket:', error);
            }
        };
        
        ws.onclose = () => {
            console.log('Połączenie WebSocket zamknięte');
            wsConnected = false;
            
            // Próba ponownego połączenia
            if (wsReconnectAttempts < MAX_WS_RECONNECT_ATTEMPTS) {
                wsReconnectAttempts++;
                console.log(`Próba ponownego połączenia (${wsReconnectAttempts}/${MAX_WS_RECONNECT_ATTEMPTS})...`);
                setTimeout(initWebSocket, 5000 * wsReconnectAttempts);
            }
        };
        
        ws.onerror = (error) => {
            console.error('Błąd WebSocket:', error);
        };
    } catch (error) {
        console.error('Nie można połączyć z WebSocket:', error);
    }
}

// Subskrypcja symbolu
function subscribeToSymbol(symbol) {
    if (ws && wsConnected) {
        ws.send(JSON.stringify({
            type: 'subscribe',
            symbol: symbol
        }));
    }
}

// Obsługa aktualizacji ceny z WebSocket
function handlePriceUpdate(data) {
    const { symbol, price, change } = data;
    
    // Znajdź akcję w liście
    const stockIndex = stocks.findIndex(s => s.symbol === symbol);
    if (stockIndex === -1) return;
    
    const oldPrice = stocks[stockIndex].price;
    const newPrice = price;
    
    // Aktualizuj dane
    stocks[stockIndex].price = newPrice;
    stocks[stockIndex].change = change;
    
    // Aktualizuj tabelę z animacją flash
    updateStockRowWithFlash(symbol, oldPrice, newPrice);
    
    // Aktualizuj karty rynkowe
    updateMarketCard(symbol, newPrice, change);
    
    // Aktualizuj portfolio
    renderPortfolio();
    
    // Aktualizuj główny wykres jeśli dotyczy
    updateMainChartWithPrice(symbol, newPrice);
}

// Aktualizacja wiersza tabeli z animacją flash
function updateStockRowWithFlash(symbol, oldPrice, newPrice) {
    const tbody = document.getElementById('stockTableBody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        const symbolCell = row.querySelector('td:first-child strong');
        if (symbolCell && symbolCell.textContent === symbol) {
            const priceCell = row.querySelector('td:nth-child(3)');
            const changeCell = row.querySelector('td:nth-child(4)');
            
            if (priceCell) {
                priceCell.textContent = newPrice.toLocaleString('pl-PL');
                
                // Animacja flash
                priceCell.classList.remove('price-flash-up', 'price-flash-down');
                void priceCell.offsetWidth; // Restart animacji
                
                if (newPrice > oldPrice) {
                    priceCell.classList.add('price-flash-up');
                } else if (newPrice < oldPrice) {
                    priceCell.classList.add('price-flash-down');
                }
            }
            
            if (changeCell) {
                const changeClass = newPrice >= oldPrice ? 'positive' : 'negative';
                const changeSign = newPrice >= oldPrice ? '+' : '';
                changeCell.className = changeClass;
                changeCell.textContent = `${changeSign}${change.toFixed(2)}%`;
            }
        }
    });
}

// Aktualizacja kart rynkowych
function updateMarketCard(symbol, price, change) {
    const marketMap = {
        'WIG20.WA': { priceId: 'wig20Price', changeId: 'wig20Change' },
        'EURPLN=X': { priceId: 'eurplnPrice', changeId: 'eurplnChange' },
        'BTC-USD': { priceId: 'btcPrice', changeId: 'btcChange' },
        'CL=F': { priceId: 'oilPrice', changeId: 'oilChange' }
    };
    
    const map = marketMap[symbol];
    if (!map) return;
    
    const priceEl = document.getElementById(map.priceId);
    const changeEl = document.getElementById(map.changeId);
    
    if (priceEl) {
        priceEl.textContent = price.toLocaleString('pl-PL');
    }
    
    if (changeEl) {
        const changeClass = change >= 0 ? 'positive' : 'negative';
        const changeSign = change >= 0 ? '+' : '';
        changeEl.className = `change ${changeClass}`;
        changeEl.textContent = `${changeSign}${change.toFixed(2)}%`;
    }
}

// Aktualizacja głównego wykresu z nową ceną
function updateMainChartWithPrice(symbol, price) {
    if (!mainChart) return;
    
    const currentSymbol = document.getElementById('chartSymbol')?.value;
    if (currentSymbol === symbol) {
        const data = mainChart.data.datasets[0].data;
        if (data.length > 0) {
            data.push(price);
            data.shift();
            mainChart.update('none');
        }
    }
}

// Inicjalizacja danych z backendu
async function initDataFromBackend() {
    const stocksData = await fetchFromBackend('/api/stocks');
    if (stocksData && stocksData.length > 0) {
        stocks = stocksData;
        useBackend = true;
        renderStockTable();
        console.log('✓ Załadowano dane z Yahoo Finance (backend)');
    } else {
        console.log('⚠ Backend niedostępny, próbuję bezpośrednio z Yahoo Finance...');
        // Próbuj bezpośrednio z Yahoo Finance
        const ALL_SYMBOLS = [
            'WIG20.WA', 'PKN.WA', 'PKO.WA', 'DNP.WA', 'PZU.WA', 'LPP.WA',
            'AAPL', 'TSLA', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'META', 'NFLX',
            'SAP.DE', 'ASML.AS', 'LVMH.PA', 'TTE.PA', 'SIE.DE',
            'BABA', 'BIDU', 'NIO', 'XPEV', 'LI', 'JD',
            '005930.KS', '000660.KS', 'HYMTF',
            'BTC-USD', 'ETH-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'SOL-USD',
            'EURPLN=X', 'USDPLN=X', 'GBPUSD=X', 'EURUSD=X',
            'GC=F', 'SI=F', 'CL=F'
        ];
        const directData = await fetchStockQuotesDirect(ALL_SYMBOLS);
        if (directData && directData.length > 0) {
            stocks = directData;
            renderStockTable();
            console.log('✓ Załadowano dane bezpośrednio z Yahoo Finance');
        } else {
            console.log('⚠ Nie udało się pobrać danych, używam przykładowych');
            loadSampleData();
        }
    }
}

// Załaduj przykładowe dane jeśli backend nie działa
function loadSampleData() {
    stocks = [
        { symbol: 'WIG20.WA', name: 'WIG20 Index', price: 2456.78, change: 1.23, volume: '1.2M', cap: '245B PLN', currency: 'PLN' },
        { symbol: 'AAPL', name: 'Apple Inc.', price: 178.50, change: 2.15, volume: '52.3M', cap: '2.8T USD', currency: 'USD' },
        { symbol: 'TSLA', name: 'Tesla Inc.', price: 245.67, change: -1.45, volume: '98.7M', cap: '780B USD', currency: 'USD' },
        { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 141.80, change: 0.89, volume: '25.4M', cap: '1.8T USD', currency: 'USD' },
        { symbol: 'MSFT', name: 'Microsoft Corp.', price: 378.91, change: 1.56, volume: '22.1M', cap: '2.8T USD', currency: 'USD' },
        { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 178.25, change: -0.34, volume: '35.6M', cap: '1.9T USD', currency: 'USD' },
        { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 875.38, change: 3.21, volume: '45.2M', cap: '2.2T USD', currency: 'USD' },
        { symbol: 'BTC-USD', name: 'Bitcoin', price: 45234, change: 2.45, volume: '28.5B', cap: '890B USD', currency: 'USD' },
        { symbol: 'EURPLN=X', name: 'EUR/PLN', price: 4.32, change: -0.15, volume: '0', cap: 'N/A', currency: 'PLN' },
        { symbol: 'CL=F', name: 'Ropa WTI', price: 78.50, change: -0.89, volume: '150K', cap: 'N/A', currency: 'USD' }
    ];
    renderStockTable();
}

// Newsy - początkowo puste, będą ładowane z backendu
let newsData = [];
let currentNewsCategory = 'all';

// Załaduj przykładowe newsy jeśli backend nie działa
function loadSampleNews() {
    newsData = [
        {
            id: 1,
            title: 'Rekordowe zyski Apple w Q4 2024',
            description: 'Apple ogłosił rekordowe zyski za czwarty kwartał 2024 roku, przewyższając oczekiwania analityków. Sprzedaż iPhone' + "'" + 'ów wzrosła o 8% r/r.',
            date: '2024-08-05',
            category: 'Technologia',
            image: 'https://via.placeholder.com/400x200/1a73e8/ffffff?text=Apple'
        },
        {
            id: 2,
            title: 'NVIDIA prezentuje nowe chipy AI',
            description: 'NVIDIA zaprezentowała nową generację procesorów do sztucznej inteligencji, które mają zrewolucjonizować rynek obliczeń chmurowych.',
            date: '2024-08-04',
            category: 'Technologia',
            image: 'https://via.placeholder.com/400x200/34a853/ffffff?text=NVIDIA'
        },
        {
            id: 3,
            title: 'Ropa naftowa spada poniżej 80 USD',
            description: 'Ceny ropy WTI spadły poniżej 80 USD za baryłkę w reakcji na słabsze dane o zatrudnieniu w Chinach i obawy o spowolnienie gospodarcze.',
            date: '2024-08-05',
            category: 'Towary',
            image: 'https://via.placeholder.com/400x200/ea4335/ffffff?text=Oil'
        },
        {
            id: 4,
            title: 'ECB utrzymuje stopy procentowe',
            description: 'Europejski Bank Centralny postanowił utrzymać stopy procentowe na obecnym poziomie, sygnalizując ostrożność w obliczu inflacji.',
            date: '2024-08-04',
            category: 'Gospodarka',
            image: 'https://via.placeholder.com/400x200/fbbc04/ffffff?text=ECB'
        },
        {
            id: 5,
            title: 'Bitcoin przekracza 45 000 USD',
            description: 'Kryptowaluta Bitcoin wzrosła powyżej 45 000 USD, osiągając najwyższy poziom od marca 2024 roku.',
            date: '2024-08-05',
            category: 'Kryptowaluty',
            image: 'https://via.placeholder.com/400x200/f7931a/ffffff?text=BTC'
        },
        {
            id: 6,
            title: 'Tesla zwiększa produkcję w Niemczech',
            description: 'Tesla ogłosiła plany zwiększenia produkcji w fabryce w Berlinie o 50% w odpowiedzi na rosnący popyt na rynku europejskim.',
            date: '2024-08-03',
            category: 'Motoryzacja',
            image: 'https://via.placeholder.com/400x200/cc0000/ffffff?text=Tesla'
        }
    ];
    renderNews();
}

// Pobierz newsy z backendu
async function loadNewsFromBackend() {
    // Pobierz newsy dla popularnych symboli
    const symbols = 'AAPL,TSLA,BTC-USD,EURPLN=X,CL=F,WIG20.WA';
    const news = await fetchFromBackend(`/api/news?symbols=${symbols}`);
    
    if (news && news.length > 0) {
        newsData = news.map((item, index) => ({
            id: index + 1,
            title: item.title,
            description: item.description || 'Brak opisu',
            date: item.published_at ? new Date(item.published_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            category: 'News',
            image: item.image || 'https://via.placeholder.com/400x200/1a73e8/ffffff?text=News',
            url: item.url || '#'
        }));
        renderNews();
        console.log('✓ Załadowano newsy z Yahoo Finance (backend)');
    } else {
        console.log('⚠ Brak newsów z backendu, próbuję bezpośrednio...');
        const directNews = await fetchNewsDirect();
        if (directNews && directNews.length > 0) {
            newsData = directNews;
            renderNews();
            console.log('✓ Załadowano newsy bezpośrednio z Yahoo Finance');
        } else {
            console.log('⚠ Nie udało się pobrać newsów, używam przykładowych');
            loadSampleNews();
        }
    }
}

// Inicjalizacja wykresów
let charts = {};

// Funkcja do tworzenia danych wykresu
function generateChartData(basePrice, volatility, points = 50) {
    const data = [];
    let currentPrice = basePrice;
    
    for (let i = 0; i < points; i++) {
        const change = (Math.random() - 0.5) * volatility;
        currentPrice += change;
        data.push(currentPrice);
    }
    
    return data;
}

// Funkcja do tworzenia etykiet czasu
function generateTimeLabels(points = 50) {
    const labels = [];
    const now = new Date();
    
    for (let i = points - 1; i >= 0; i--) {
        const time = new Date(now - i * 60000); // co minutę
        labels.push(time.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }));
    }
    
    return labels;
}

// Inicjalizacja mini wykresów
function initMiniCharts() {
    // WIG20
    const wig20Ctx = document.getElementById('wig20Chart');
    if (wig20Ctx) {
        charts.wig20 = new Chart(wig20Ctx, {
            type: 'line',
            data: {
                labels: generateTimeLabels(20),
                datasets: [{
                    data: generateChartData(2456.78, 5, 20),
                    borderColor: '#1a73e8',
                    backgroundColor: 'rgba(26, 115, 232, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    // EUR/PLN
    const eurplnCtx = document.getElementById('eurplnChart');
    if (eurplnCtx) {
        charts.eurpln = new Chart(eurplnCtx, {
            type: 'line',
            data: {
                labels: generateTimeLabels(20),
                datasets: [{
                    data: generateChartData(4.32, 0.02, 20),
                    borderColor: '#ea4335',
                    backgroundColor: 'rgba(234, 67, 53, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    // BTC
    const btcCtx = document.getElementById('btcChart');
    if (btcCtx) {
        charts.btc = new Chart(btcCtx, {
            type: 'line',
            data: {
                labels: generateTimeLabels(20),
                datasets: [{
                    data: generateChartData(45234, 200, 20),
                    borderColor: '#f7931a',
                    backgroundColor: 'rgba(247, 147, 26, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    // Oil
    const oilCtx = document.getElementById('oilChart');
    if (oilCtx) {
        charts.oil = new Chart(oilCtx, {
            type: 'line',
            data: {
                labels: generateTimeLabels(20),
                datasets: [{
                    data: generateChartData(78.50, 0.5, 20),
                    borderColor: '#34a853',
                    backgroundColor: 'rgba(52, 168, 83, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }
}

// Inicjalizacja głównego wykresu
let mainChart;

async function initMainChart() {
    const ctx = document.getElementById('mainChart');
    if (!ctx) return;

    const symbol = document.getElementById('chartSymbol')?.value || 'WIG20.WA';
    
    // Spróbuj pobrać prawdziwą historię
    let history = await fetchFromBackend(`/api/stocks/${symbol}/history?period=1M`);
    if (!history || history.length === 0) {
        history = await fetchChartHistoryDirect(symbol, '1mo');
    }
    
    const labels = history && history.length > 0 
        ? history.map(item => item.date ? new Date(item.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) : '')
        : generateTimeLabels(50);
    
    const data = history && history.length > 0 
        ? history.map(item => item.close || item.price || 0)
        : generateChartData(2456.78, 10, 50);

    mainChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: symbol,
                data: data,
                borderColor: '#1a73e8',
                backgroundColor: 'rgba(26, 115, 232, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// Renderowanie tabeli akcji
function renderStockTable() {
    const tbody = document.getElementById('stockTableBody');
    if (!tbody) return;

    tbody.innerHTML = stocks.map(stock => {
        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const changeSign = stock.change >= 0 ? '+' : '';
        
        return `
            <tr>
                <td><strong>${stock.symbol}</strong></td>
                <td>${stock.name}</td>
                <td class="stock-price">${stock.price.toLocaleString('pl-PL')}</td>
                <td class="${changeClass}">${changeSign}${stock.change.toFixed(2)}%</td>
                <td>${stock.volume}</td>
                <td>${stock.cap}</td>
                <td>
                    <button class="btn-chart" onclick="showStockChart('${stock.symbol}')">
                        <i class="fas fa-chart-line"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Renderowanie newsów
function renderNews() {
    const newsGrid = document.getElementById('newsGrid');
    if (!newsGrid) return;

    newsGrid.innerHTML = newsData.map(news => `
        <div class="news-card" onclick="openNews(${news.id})">
            <div class="news-image">
                <i class="fas fa-newspaper fa-3x"></i>
            </div>
            <div class="news-content">
                <div class="news-date">${formatDate(news.date)}</div>
                <div class="news-title">${news.title}</div>
                <div class="news-description">${news.description}</div>
            </div>
        </div>
    `).join('');
}

// Formatowanie daty
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

// Obsługa wyszukiwania
function initSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        
        // Filtrowanie akcji
        const filteredStocks = stocks.filter(stock => 
            stock.symbol.toLowerCase().includes(searchTerm) ||
            stock.name.toLowerCase().includes(searchTerm)
        );
        
        // Aktualizacja tabeli
        const tbody = document.getElementById('stockTableBody');
        if (tbody && searchTerm) {
            tbody.innerHTML = filteredStocks.map(stock => {
                const changeClass = stock.change >= 0 ? 'positive' : 'negative';
                const changeSign = stock.change >= 0 ? '+' : '';
                
                return `
                    <tr>
                        <td><strong>${stock.symbol}</strong></td>
                        <td>${stock.name}</td>
                        <td class="stock-price">${stock.price.toLocaleString('pl-PL')}</td>
                        <td class="${changeClass}">${changeSign}${stock.change.toFixed(2)}%</td>
                        <td>${stock.volume}</td>
                        <td>${stock.cap}</td>
                        <td>
                            <button class="btn-chart" onclick="showStockChart('${stock.symbol}')">
                                <i class="fas fa-chart-line"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        } else if (tbody) {
            renderStockTable();
        }
    });
}

// Filtrowanie według kategorii
function initMarketFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    if (!filterButtons.length) return;

    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Aktualizuj aktywne przyciski
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            const category = button.dataset.category;
            filterStocksByCategory(category);
        });
    });
}

// Filtruj akcje według kategorii
function filterStocksByCategory(category) {
    const tbody = document.getElementById('stockTableBody');
    if (!tbody) return;

    let filteredStocks = stocks;

    if (category !== 'all') {
        filteredStocks = stocks.filter(stock => {
            const symbol = stock.symbol.toUpperCase();
            
            switch(category) {
                case 'poland':
                    return symbol.includes('.WA') || ['WIG20', 'WIG20.WA'].includes(symbol);
                case 'usa':
                    return !symbol.includes('.') && !symbol.includes('=') && !symbol.includes('-USD');
                case 'europe':
                    return symbol.includes('.DE') || symbol.includes('.AS') || symbol.includes('.PA') || symbol.includes('.MC');
                case 'china':
                    return ['BABA', 'BIDU', 'NIO', 'XPEV', 'LI', 'JD', 'PDD', 'BILI'].includes(symbol);
                case 'korea':
                    return symbol.includes('.KS') || ['HYMTF', '005930.KS', '000660.KS'].includes(symbol);
                case 'crypto':
                    return symbol.includes('-USD') && !['EURPLN=X', 'USDPLN=X', 'GBPUSD=X', 'EURUSD=X', 'USDJPY=X'].includes(symbol);
                case 'forex':
                    return symbol.includes('=X');
                case 'commodities':
                    return symbol.includes('=F');
                default:
                    return true;
            }
        });
    }

    // Renderuj przefiltrowane dane
    tbody.innerHTML = filteredStocks.map(stock => {
        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const changeSign = stock.change >= 0 ? '+' : '';
        
        return `
            <tr>
                <td><strong>${stock.symbol}</strong></td>
                <td>${stock.name}</td>
                <td class="stock-price">${stock.price.toLocaleString('pl-PL')}</td>
                <td class="${changeClass}">${changeSign}${stock.change.toFixed(2)}%</td>
                <td>${stock.volume}</td>
                <td>${stock.cap}</td>
                <td>
                    <button class="btn-chart" onclick="showStockChart('${stock.symbol}')">
                        <i class="fas fa-chart-line"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Zmiana symbolu na głównym wykresie
function initChartControls() {
    const symbolSelect = document.getElementById('chartSymbol');
    const periodSelect = document.getElementById('chartPeriod');
    
    if (symbolSelect) {
        symbolSelect.addEventListener('change', async (e) => {
            const symbol = e.target.value;
            const stock = stocks.find(s => s.symbol === symbol);
            
            if (stock && mainChart) {
                mainChart.data.datasets[0].label = stock.name;
                
                // Pobierz prawdziwą historię
                let history = await fetchFromBackend(`/api/stocks/${symbol}/history?period=1M`);
                if (!history || history.length === 0) {
                    history = await fetchChartHistoryDirect(symbol, '1mo');
                }
                
                if (history && history.length > 0) {
                    mainChart.data.labels = history.map(item => item.date ? new Date(item.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) : '');
                    mainChart.data.datasets[0].data = history.map(item => item.close || item.price || 0);
                } else {
                    mainChart.data.datasets[0].data = generateChartData(stock.price, stock.price * 0.01, 50);
                }
                mainChart.update();
            }
        });
    }
    
    if (periodSelect) {
        periodSelect.addEventListener('change', async (e) => {
            const period = e.target.value;
            const rangeMap = { '1D': '5d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '1Y': '1y' };
            const range = rangeMap[period] || '1mo';
            
            const symbol = symbolSelect ? symbolSelect.value : 'WIG20.WA';
            const stock = stocks.find(s => s.symbol === symbol);
            
            // Pobierz prawdziwą historię
            let history = await fetchFromBackend(`/api/stocks/${symbol}/history?period=${period}`);
            if (!history || history.length === 0) {
                history = await fetchChartHistoryDirect(symbol, range);
            }
            
            if (mainChart) {
                if (history && history.length > 0) {
                    mainChart.data.labels = history.map(item => item.date ? new Date(item.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) : '');
                    mainChart.data.datasets[0].data = history.map(item => item.close || item.price || 0);
                } else {
                    const basePrice = stock ? stock.price : 2456.78;
                    mainChart.data.labels = generateTimeLabels(50);
                    mainChart.data.datasets[0].data = generateChartData(basePrice, basePrice * 0.01, 50);
                }
                mainChart.update();
            }
        });
    }
}

// Pokazanie wykresu dla konkretnej akcji
async function showStockChart(symbol) {
    const stock = stocks.find(s => s.symbol === symbol);
    if (!stock) return;
    
    const symbolSelect = document.getElementById('chartSymbol');
    if (symbolSelect) {
        symbolSelect.value = symbol;
        
        // Spróbuj pobrać prawdziwą historię
        let history = await fetchFromBackend(`/api/stocks/${symbol}/history?period=1M`);
        if (!history || history.length === 0) {
            history = await fetchChartHistoryDirect(symbol, '1mo');
        }
        
        // Aktualizuj wykres
        if (mainChart) {
            mainChart.data.datasets[0].label = stock.name;
            
            if (history && history.length > 0) {
                mainChart.data.labels = history.map(item => item.date ? new Date(item.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) : '');
                mainChart.data.datasets[0].data = history.map(item => item.close || item.price || 0);
            } else {
                mainChart.data.datasets[0].data = generateChartData(stock.price, stock.price * 0.01, 50);
            }
            mainChart.update();
        }
        
        // Przewiń do sekcji wykresu
        document.querySelector('.chart-section').scrollIntoView({ 
            behavior: 'smooth' 
        });
    }
}

// Otwarcie newsa
function openNews(newsId) {
    const news = newsData.find(n => n.id === newsId);
    if (news) {
        if (news.url && news.url !== '#') {
            window.open(news.url, '_blank');
        } else {
            alert(`Kategoria: ${news.category}\n\n${news.description}`);
        }
    }
}

// ========== ZAAWANSOWANA WYSZUKIWARKA ==========

let advancedSearchTimeout = null;
let currentSearchType = 'all';
let advancedSearchResults = [];

// Inicjalizacja zaawansowanej wyszukiwarki
function initAdvancedSearch() {
    const searchInput = document.getElementById('advancedSearchInput');
    const clearBtn = document.getElementById('advancedSearchClear');
    const typeButtons = document.querySelectorAll('.search-type-btn');
    
    if (!searchInput) return;
    
    // Debounce wyszukiwania
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Pokaż/ukryj przycisk czyszczenia
        if (clearBtn) {
            clearBtn.classList.toggle('visible', query.length > 0);
        }
        
        // Debounce 500ms
        clearTimeout(advancedSearchTimeout);
        advancedSearchTimeout = setTimeout(() => {
            if (query.length >= 2) {
                performAdvancedSearch(query);
            } else {
                showSearchPlaceholder();
            }
        }, 500);
    });
    
    // Przycisk czyszczenia
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.remove('visible');
            showSearchPlaceholder();
        });
    }
    
    // Filtry typu
    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            typeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSearchType = btn.dataset.type;
            
            // Ponów wyszukiwanie z filtrem
            const query = searchInput.value.trim();
            if (query.length >= 2) {
                performAdvancedSearch(query);
            }
        });
    });
}

// Wykonaj zaawansowane wyszukiwanie
async function performAdvancedSearch(query) {
    const resultsContainer = document.getElementById('advancedSearchResults');
    if (!resultsContainer) return;
    
    // Pokaż loading
    resultsContainer.innerHTML = `
        <div class="search-loading">
            <i class="fas fa-spinner"></i>
            <p>Wyszukiwanie...</p>
        </div>
    `;
    
    // Najpierw spróbuj backendu
    let results = await fetchFromBackend(`/api/search/advanced?q=${encodeURIComponent(query)}`);
    
    // Jeśli backend nie działa, użyj bezpośredniego API
    if (!results || results.length === 0) {
        results = await advancedSearchDirect(query);
    }
    
    if (results && results.length > 0) {
        advancedSearchResults = results;
        renderAdvancedSearchResults(results);
    } else {
        resultsContainer.innerHTML = `
            <div class="search-no-results">
                <i class="fas fa-search-minus"></i>
                <p>Nie znaleziono wyników dla "${query}"</p>
                <p style="font-size: 14px; opacity: 0.7;">Spróbuj innego symbolu lub nazwy</p>
            </div>
        `;
    }
}

// Renderuj wyniki zaawansowanego wyszukiwania
function renderAdvancedSearchResults(results) {
    const container = document.getElementById('advancedSearchResults');
    if (!container) return;
    
    // Filtruj według typu
    let filteredResults = results;
    if (currentSearchType !== 'all') {
        filteredResults = results.filter(r => r.type === currentSearchType);
    }
    
    if (filteredResults.length === 0) {
        container.innerHTML = `
            <div class="search-no-results">
                <i class="fas fa-filter"></i>
                <p>Brak wyników dla wybranego typu</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <div class="search-results-table">
            <table>
                <thead>
                    <tr>
                        <th>Symbol</th>
                        <th>Nazwa</th>
                        <th>Typ</th>
                        <th>Cena</th>
                        <th>Zmiana</th>
                        <th>Wolumen</th>
                        <th>Kapitalizacja</th>
                        <th>Waluta</th>
                        <th>Akcje</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredResults.map((stock, index) => {
                        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
                        const changeSign = stock.change >= 0 ? '+' : '';
                        const typeLabel = getTypeLabel(stock.type);
                        
                        return `
                            <tr class="clickable" onclick="showStockDetail('${stock.symbol}')">
                                <td class="search-symbol">${stock.symbol}</td>
                                <td>${stock.name}</td>
                                <td><span class="search-type-badge ${stock.type}">${typeLabel}</span></td>
                                <td class="stock-price" id="search-price-${index}">${stock.price.toLocaleString('pl-PL')}</td>
                                <td class="${changeClass}">${changeSign}${stock.change.toFixed(2)}%</td>
                                <td>${stock.volume}</td>
                                <td>${stock.marketCap}</td>
                                <td>${stock.currency}</td>
                                <td>
                                    <button class="btn-chart" onclick="event.stopPropagation(); showStockChart('${stock.symbol}')">
                                        <i class="fas fa-chart-line"></i>
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Pokaż szczegóły akcji
async function showStockDetail(symbol) {
    // Najpierw spróbuj backendu
    let detail = await fetchFromBackend(`/api/stocks/${symbol}/detail`);
    
    // Jeśli backend nie działa, użyj bezpośredniego API
    if (!detail) {
        detail = await stockDetailDirect(symbol);
    }
    
    if (!detail) return;
    
    const changeClass = detail.change >= 0 ? 'positive' : 'negative';
    const changeSign = detail.change >= 0 ? '+' : '';
    
    const detailHtml = `
        <div class="stock-detail-modal">
            <div class="stock-detail-header">
                <div>
                    <h3>${detail.name} <span class="search-symbol">(${detail.symbol})</span></h3>
                    <span class="search-type-badge ${detail.quoteType}">${getTypeLabel(detail.quoteType)}</span>
                    <span class="market-state ${detail.marketState === 'REGULAR' ? 'open' : 'closed'}">
                        ${detail.marketState === 'REGULAR' ? '● Otwarty' : '○ Zamknięty'}
                    </span>
                </div>
                <button class="modal-close" onclick="closeStockDetail()">&times;</button>
            </div>
            <div class="stock-detail-body">
                <div class="stock-detail-price-row">
                    <div class="stock-detail-price">${detail.price.toLocaleString('pl-PL')} ${detail.currency}</div>
                    <div class="stock-detail-change ${changeClass}">${changeSign}${detail.change.toFixed(2)}% (${changeSign}${detail.changeAbs.toFixed(2)})</div>
                </div>
                <div class="stock-detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Otwarcie</span>
                        <span class="detail-value">${detail.open.toLocaleString('pl-PL')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Max dnia</span>
                        <span class="detail-value">${detail.high.toLocaleString('pl-PL')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Min dnia</span>
                        <span class="detail-value">${detail.low.toLocaleString('pl-PL')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Poprzednie zamknięcie</span>
                        <span class="detail-value">${detail.previousClose.toLocaleString('pl-PL')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">52 tyg. max</span>
                        <span class="detail-value">${detail.fiftyTwoWeekHigh.toLocaleString('pl-PL')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">52 tyg. min</span>
                        <span class="detail-value">${detail.fiftyTwoWeekLow.toLocaleString('pl-PL')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Wolumen</span>
                        <span class="detail-value">${detail.volume}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Śr. wolumen</span>
                        <span class="detail-value">${detail.averageVolume}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Kapitalizacja</span>
                        <span class="detail-value">${detail.cap}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">P/E</span>
                        <span class="detail-value">${detail.peRatio ? detail.peRatio.toFixed(2) : 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Dywidenda</span>
                        <span class="detail-value">${detail.dividendYield || 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Beta</span>
                        <span class="detail-value">${detail.beta ? detail.beta.toFixed(2) : 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">EPS</span>
                        <span class="detail-value">${detail.eps ? detail.eps.toFixed(2) : 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Data wyników</span>
                        <span class="detail-value">${detail.earningsDate || 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Giełda</span>
                        <span class="detail-value">${detail.exchange}</span>
                    </div>
                </div>
                <div class="stock-detail-actions">
                    <button class="btn-add-position" onclick="addToPortfolioFromDetail('${detail.symbol}', '${detail.name.replace(/'/g, "\\'")}')">
                        <i class="fas fa-plus"></i> Dodaj do Portfolio
                    </button>
                    <button class="btn-chart-detail" onclick="showStockChart('${detail.symbol}')">
                        <i class="fas fa-chart-line"></i> Pokaż Wykres
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Utwórz modal
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'stockDetailModal';
    modal.innerHTML = `<div class="modal-content stock-detail-content">${detailHtml}</div>`;
    document.body.appendChild(modal);
}

// Zamknij szczegóły akcji
function closeStockDetail() {
    const modal = document.getElementById('stockDetailModal');
    if (modal) {
        modal.remove();
    }
}

// Dodaj do portfolio z detali
function addToPortfolioFromDetail(symbol, name) {
    closeStockDetail();
    
    // Wypełnij formularz
    document.getElementById('positionSymbol').value = symbol;
    document.getElementById('positionName').value = name;
    showAddPositionModal();
}

// Pokaż placeholder wyszukiwania
function showSearchPlaceholder() {
    const container = document.getElementById('advancedSearchResults');
    if (!container) return;
    
    container.innerHTML = `
        <div class="search-placeholder">
            <i class="fas fa-search fa-3x"></i>
            <p>Wpisz minimum 2 znaki, aby rozpocząć wyszukiwanie</p>
            <p class="search-hint">Przykłady: AAPL, TSLA, BTC-USD, EURPLN=X, WIG20.WA, GC=F</p>
        </div>
    `;
}

// Pobierz etykietę typu
function getTypeLabel(type) {
    const labels = {
        'EQUITY': 'Akcje',
        'CRYPTOCURRENCY': 'Krypto',
        'CURRENCY': 'Waluta',
        'FUTURE': 'Towar',
        'INDEX': 'Indeks',
        'ETF': 'ETF',
        'MUTUALFUND': 'Fundusz'
    };
    return labels[type] || type || 'Inny';
}

// ========== FUNKCJE PORTFOLIO ==========

// Oblicz wartość portfolio
function calculatePortfolioValue() {
    let totalValue = 0;
    let totalCost = 0;

    portfolio.forEach(position => {
        const stock = stocks.find(s => s.symbol === position.symbol);
        if (stock) {
            const currentValue = stock.price * position.quantity;
            const cost = position.purchasePrice * position.quantity;
            totalValue += currentValue;
            totalCost += cost;
        }
    });

    return { totalValue, totalCost, profit: totalValue - totalCost };
}

// Renderuj portfolio
function renderPortfolio() {
    const tbody = document.getElementById('portfolioTableBody');
    const portfolioValueEl = document.getElementById('portfolioValue');
    const portfolioChangeEl = document.getElementById('portfolioChange');
    const portfolioProfitEl = document.getElementById('portfolioProfit');
    const portfolioProfitPercentEl = document.getElementById('portfolioProfitPercent');

    if (!tbody) return;

    // Aktualizuj podsumowanie
    const { totalValue, totalCost, profit } = calculatePortfolioValue();
    const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

    if (portfolioValueEl) portfolioValueEl.textContent = totalValue.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
    if (portfolioProfitEl) portfolioProfitEl.textContent = profit.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
    
    if (portfolioChangeEl) {
        portfolioChangeEl.textContent = `${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%`;
        portfolioChangeEl.className = `portfolio-change ${profitPercent >= 0 ? 'positive' : 'negative'}`;
    }
    
    if (portfolioProfitPercentEl) {
        portfolioProfitPercentEl.textContent = `${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%`;
        portfolioProfitPercentEl.className = `portfolio-change ${profitPercent >= 0 ? 'positive' : 'negative'}`;
    }

    // Renderuj tabelę pozycji
    if (portfolio.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #5f6368;">
                    Brak pozycji w portfolio. Dodaj pierwszą pozycję!
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = portfolio.map((position, index) => {
        const stock = stocks.find(s => s.symbol === position.symbol);
        const currentPrice = stock ? stock.price : position.purchasePrice;
        const currentValue = currentPrice * position.quantity;
        const cost = position.purchasePrice * position.quantity;
        const profit = currentValue - cost;
        const profitPercent = (profit / cost) * 100;
        const profitClass = profit >= 0 ? 'positive' : 'negative';
        const profitSign = profit >= 0 ? '+' : '';

        return `
            <tr>
                <td><strong>${position.symbol}</strong></td>
                <td>${position.name}</td>
                <td>${position.quantity.toFixed(4)}</td>
                <td>${position.purchasePrice.toLocaleString('pl-PL')}</td>
                <td class="stock-price">${currentPrice.toLocaleString('pl-PL')}</td>
                <td>${currentValue.toLocaleString('pl-PL')}</td>
                <td class="${profitClass}">${profitSign}${profitPercent.toFixed(2)}%</td>
                <td>
                    <button class="btn-delete" onclick="deletePosition(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Dodaj pozycję
function addPosition(symbol, name, quantity, purchasePrice) {
    portfolio.push({
        symbol: symbol.toUpperCase(),
        name,
        quantity: parseFloat(quantity),
        purchasePrice: parseFloat(purchasePrice),
        date: new Date().toISOString()
    });
    
    savePortfolio();
    renderPortfolio();
}

// Usuń pozycję
function deletePosition(index) {
    if (confirm('Czy na pewno chcesz usunąć tę pozycję?')) {
        portfolio.splice(index, 1);
        savePortfolio();
        renderPortfolio();
    }
}

// Zapisz portfolio do localStorage
function savePortfolio() {
    localStorage.setItem('portfolio', JSON.stringify(portfolio));
}

// Modal funkcje
function showAddPositionModal() {
    document.getElementById('addPositionModal').classList.add('active');
}

function closeAddPositionModal() {
    document.getElementById('addPositionModal').classList.remove('active');
}

// Obsługa formularza dodawania pozycji
function initAddPositionForm() {
    const form = document.getElementById('addPositionForm');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const symbol = document.getElementById('positionSymbol').value;
        const name = document.getElementById('positionName').value;
        const quantity = document.getElementById('positionQuantity').value;
        const price = document.getElementById('positionPrice').value;

        addPosition(symbol, name, quantity, price);
        closeAddPositionModal();
        form.reset();
    });
}

// Smooth scroll dla nawigacji
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Aktywne podświetlanie sekcji podczas scrollowania
function initActiveNavHighlight() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav a');

    window.addEventListener('scroll', () => {
        let current = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            
            if (window.pageYOffset >= sectionTop - 200) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.style.color = '';
            if (link.getAttribute('href') === `#${current}`) {
                link.style.color = 'var(--primary-color)';
            }
        });
    });
}

// Symulacja aktualizacji danych w czasie rzeczywistym (fallback gdy brak WebSocket)
function simulateRealTimeUpdates() {
    setInterval(() => {
        // Aktualizuj ceny akcji
        stocks.forEach(stock => {
            const change = (Math.random() - 0.5) * stock.price * 0.001;
            stock.price += change;
            stock.change += (Math.random() - 0.5) * 0.1;
        });
        
        // Aktualizuj tabelę
        renderStockTable();
        
        // Aktualizuj wykresy
        Object.keys(charts).forEach(key => {
            const chart = charts[key];
            if (chart && chart.data.datasets[0]) {
                const data = chart.data.datasets[0].data;
                const lastValue = data[data.length - 1];
                const newValue = lastValue + (Math.random() - 0.5) * lastValue * 0.002;
                
                data.shift();
                data.push(newValue);
                chart.update('none');
            }
        });
        
        // Aktualizuj główny wykres
        if (mainChart && mainChart.data.datasets[0]) {
            const data = mainChart.data.datasets[0].data;
            const lastValue = data[data.length - 1];
            const newValue = lastValue + (Math.random() - 0.5) * lastValue * 0.001;
            
            data.shift();
            data.push(newValue);
            mainChart.update('none');
        }

        // Aktualizuj portfolio
        renderPortfolio();
    }, 3000); // Co 3 sekundy
}

// Inicjalizacja aplikacji
document.addEventListener('DOMContentLoaded', async () => {
    // Spróbuj załadować dane z backendu
    await initDataFromBackend();
    
    // Załaduj newsy - zawsze próbuj pobrać prawdziwe
    await loadNewsFromBackend();
    
    renderStockTable();
    renderNews();
    renderPortfolio();
    initMiniCharts();
    await initMainChart();
    initSearch();
    initChartControls();
    initAddPositionForm();
    initSmoothScroll();
    initActiveNavHighlight();
    initMarketFilters();
    initAdvancedSearch();
    
    // Inicjalizuj WebSocket jeśli używamy backendu
    if (useBackend) {
        initWebSocket();
        startRealtimeUpdates();
    } else {
        simulateRealTimeUpdates();
    }
});

// Funkcja do pobierania aktualizacji z backendu (polling fallback)
function startRealtimeUpdates() {
    // Polling co 15 sekund jako fallback do WebSocket
    setInterval(async () => {
        const stocksData = await fetchFromBackend('/api/stocks');
        if (stocksData && stocksData.length > 0) {
            // Porównaj stare i nowe ceny dla animacji
            const oldPrices = {};
            stocks.forEach(s => oldPrices[s.symbol] = s.price);
            
            stocks = stocksData;
            renderStockTable();
            renderPortfolio();
            
            // Animacje flash dla zmienionych cen
            stocks.forEach(stock => {
                if (oldPrices[stock.symbol] !== undefined && oldPrices[stock.symbol] !== stock.price) {
                    updateStockRowWithFlash(stock.symbol, oldPrices[stock.symbol], stock.price);
                }
            });
        }
    }, 15000);
}