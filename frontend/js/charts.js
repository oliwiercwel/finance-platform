// ========== LIGHTWEIGHT CHARTS INTEGRATION ==========
// TradingView Lightweight Charts dla profesjonalnych wykresów

let fullscreenChart = null;
let fullscreenChartSeries = null;
let currentFullscreenSymbol = null;

/**
 * Otwórz pełnoekranowy wykres dla symbolu
 */
async function openFullscreenChart(symbol) {
    const stock = stocks.find(s => s.symbol === symbol);
    if (!stock) return;

    currentFullscreenSymbol = symbol;
    const modal = document.getElementById('fullscreenChartModal');
    const title = document.getElementById('fullscreenChartTitle');
    const container = document.getElementById('fullscreenChart');
    const periodSelect = document.getElementById('fullscreenChartPeriod');

    // Ustaw tytuł
    title.textContent = `Wykres - ${stock.name} (${symbol})`;

    // Pokaż modal
    modal.style.display = 'flex';

    // Inicjalizuj Lightweight Chart
    if (fullscreenChart) {
        fullscreenChart.remove();
    }

    const chartOptions = {
        layout: {
            textColor: '#d1d5db',
            background: { color: '#1f2937' }
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false
        }
    };

    fullscreenChart = LightweightCharts.createChart(container, chartOptions);
    fullscreenChartSeries = fullscreenChart.addCandlestickSeries({
        upColor: '#16a34a',
        downColor: '#dc2626',
        wickUpColor: '#16a34a',
        wickDownColor: '#dc2626',
        borderVisible: false
    });

    // Załaduj dane dla wybranego okresu
    const period = periodSelect.value || '1M';
    await loadFullscreenChartData(symbol, period);

    // Fit content
    fullscreenChart.timeScale().fitContent();

    // Obsługa zmiany okresu
    periodSelect.onchange = async (e) => {
        await loadFullscreenChartData(symbol, e.target.value);
        fullscreenChart.timeScale().fitContent();
    };

    // Handle resize
    window.addEventListener('resize', () => {
        if (fullscreenChart) {
            fullscreenChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        }
    });
}

/**
 * Załaduj dane dla pełnoekranowego wykresu
 */
async function loadFullscreenChartData(symbol, period) {
    if (!fullscreenChartSeries) return;

    try {
        // Pobierz historię cen
        let history = await fetchFromBackend(`/api/stocks/${symbol}/history?period=${period}`);
        
        if (!history || history.length === 0) {
            history = await fetchChartHistoryDirect(symbol, getPeriodRange(period));
        }

        if (!history || history.length === 0) {
            console.warn(`Brak danych dla ${symbol}`);
            // Jeśli brak danych, użyj przykładowych
            history = generateSampleHistory(symbol, period);
        }

        // Konwertuj dane do formatu Lightweight Charts
        const candleData = convertToCandleFormat(history);
        
        // Wyczyść stare dane
        fullscreenChartSeries.setData(candleData);

    } catch (error) {
        console.error('Błąd ładowania danych wykresu:', error);
    }
}

/**
 * Generuj przykładowe dane historyczne
 */
function generateSampleHistory(symbol, period) {
    const days = period === '1D' ? 5 : period === '1W' ? 7 : period === '1M' ? 30 : period === '3M' ? 90 : period === '6M' ? 180 : 365;
    const stock = stocks.find(s => s.symbol === symbol);
    const basePrice = stock ? stock.price : 100;
    
    const history = [];
    const now = new Date();
    
    for (let i = days; i > 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        
        const volatility = basePrice * 0.02;
        const open = basePrice + (Math.random() - 0.5) * volatility;
        const close = open + (Math.random() - 0.5) * volatility;
        const high = Math.max(open, close) + Math.random() * (volatility / 2);
        const low = Math.min(open, close) - Math.random() * (volatility / 2);
        
        history.push({
            date: date.toISOString().split('T')[0],
            open: parseFloat(open.toFixed(2)),
            high: parseFloat(high.toFixed(2)),
            low: parseFloat(low.toFixed(2)),
            close: parseFloat(close.toFixed(2))
        });
    }
    
    return history;
}

/**
 * Konwertuj dane historyczne do formatu candlestick
 */
function convertToCandleFormat(history) {
    if (!history || history.length === 0) return [];

    return history.map((item, index) => {
        const date = new Date(item.date);
        const timestamp = Math.floor(date.getTime() / 1000);
        
        // Jeśli mamy tylko close price, użyj go dla wszystkich
        const close = item.close || item.price || 0;
        const open = item.open || close;
        const high = item.high || close;
        const low = item.low || close;

        return {
            time: timestamp,
            open: open,
            high: high,
            low: low,
            close: close
        };
    });
}

/**
 * Mapuj okres do zakresu dla API
 */
function getPeriodRange(period) {
    const periodMap = {
        '1D': '5d',
        '1W': '1wk',
        '1M': '1mo',
        '3M': '3mo',
        '6M': '6mo',
        '1Y': '1y',
        '5Y': '5y'
    };
    return periodMap[period] || '1mo';
}

/**
 * Zamknij pełnoekranowy wykres
 */
function closeFullscreenChart() {
    const modal = document.getElementById('fullscreenChartModal');
    modal.style.display = 'none';
    
    if (fullscreenChart) {
        fullscreenChart.remove();
        fullscreenChart = null;
        fullscreenChartSeries = null;
    }
    currentFullscreenSymbol = null;
}

/**
 * Obsługa kliknięcia na przycisk wykresu w tabeli
 * Zastępuje stary showStockChart() dla przycisków w tabeli
 */
async function showStockChartFullscreen(symbol) {
    await openFullscreenChart(symbol);
}