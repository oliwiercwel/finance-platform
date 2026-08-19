const yahoo = require('yahoo-finance2').default;
const fs = require('fs');
(async ()=>{
  try {
    const h = await yahoo.chart('AAPL', { period1: (Date.now()-365*86400000)/1000, interval: '1d' });
    const ts = h.quotes || [];
    fs.writeFileSync('_yahoo_out.json', JSON.stringify({ rows: ts.length, sample: ts[0] }, null, 1), 'utf8');
    console.log('CHART rows=', ts.length);
  } catch(e) {
    fs.writeFileSync('_yahoo_out.json', JSON.stringify({ err: String(e&&e.message||e) }), 'utf8');
    console.log('CHART ERR:', String(e&&e.message||e));
  }
})();
setTimeout(()=>{}, 2000);
