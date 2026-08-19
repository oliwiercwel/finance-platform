const https=require('https'); const fs=require('fs');
const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'};
function get(url,headers){
  return new Promise((res)=>{ const rq=https.get(url,headers||UA,(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({s:r.statusCode,h:r.headers,d:d.slice(0,400)}));}); rq.on('error',(e)=>res({s:'ERR',d:String(e&&e.message||e)})); rq.setTimeout(15000,()=>{rq.destroy();}); });
}
(async()=>{
  const out={};
  // Yahoo v8 chart direct
  out.yahooV8 = await get('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1d');
  // Yahoo v8 chart with crumb via alternate host
  out.yahooQuery2 = await get('https://query2.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1d');
  // Finnhub demo
  out.finnhub = await get('https://finnhub.io/api/v1/stock/candle?symbol=AAPL&resolution=D&from='+Math.floor((Date.now()-365*86400000)/1000)+'&to='+Math.floor(Date.now()/1000)+'&token=demo');
  // Tiingo
  out.tiingo = await get('https://api.tiingo.com/tiingo/daily/AAPL/prices?startDate='+(new Date(Date.now()-365*86400000).toISOString().slice(0,10))+'&token=zzzz');
  // Alpha Vantage demo
  out.av = await get('https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=AAPL&outputsize=compact&apikey=demo');
  // MarketWatch/ internet archive (run via full fetch later)
  Object.keys(out).forEach(k=>{ const o=out[k]; console.log('==== '+k+' status='+o.s+' ct='+(o.h&&o.h['content-type']||'')); console.log(o.d.slice(0,220)); });
})().then(()=>setTimeout(()=>{},500));
