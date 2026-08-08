// Chart subpage logic
const params = new URLSearchParams(window.location.search);
const symbol = params.get('symbol') || 'AAPL';

document.getElementById('symbolTitle').textContent = 'Wykres - ' + symbol;

// Initialize KLineCharts Pro
const container = document.getElementById('chartContainer');
const chart = klinecharts.init(container);
chart.createIndicator({ name: 'MA', shortName: 'MA', calcParams: [5,10,20], series: 'price' });

// Fetch history
fetch('/api/stocks/'+symbol+'/history?period=1M')
  .then(r => r.json())
  .then(data => {
    const candles = data.map(d => ({
      time: Math.floor(new Date(d.date).getTime()/1000),
      open: d.open, high: d.high, low: d.low, close: d.close
    }));
    chart.applyNewData(candles);
  });
