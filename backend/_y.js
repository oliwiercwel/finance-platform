const yahoo = require('yahoo-finance2').default;
(async ()=>{
  try {
    const h = await yahoo.historical('AAPL', { period1: (Date.now()-365*86400000)/1000, interval: '1d' });
    console.log('YAHOO OK rows=', h.length, 'first=', JSON.stringify(h[0]));
  } catch(e) {
    console.log('YAHOO ERR:', e && (e.message||String(e)));
  }
  process.exit(0);
})();
