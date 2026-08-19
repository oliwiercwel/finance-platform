const https=require('https'); 
const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36','Accept':'text/html,application/json,*/*','Accept-Language':'en-US,en;q=0.9'};
function get(url,headers){return new Promise((res)=>{const rq=https.get(url,headers||UA,(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({s:r.statusCode,d:d}));});rq.on('error',(e)=>res({s:'ERR',d:String(e&&e.message||e)}));rq.setTimeout(15000,()=>rq.destroy());});}
(async()=>{
  const tests={};
  tests.nasdaq=await get('https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&fromdate=2024-06-01&limit=30', {'User-Agent':UA['User-Agent'],'Accept':'application/json'});
  tests.stockanalysis=await get('https://stockanalysis.com/api/symbol/s/AAPL/history?range=1Y');
  tests.datamall=await get('https://data.mall.ibm... ');
  tests.stooqPlus=await get('https://stooq.pl/q/d/l/?s=aapl.us&i=d');
  tests.gurufocus=await get('https://customticker.gurufocus.com/ticker/price?t=AAPL');
  Object.keys(tests).forEach(k=>{console.log('==== '+k+' status='+tests[k].s); console.log((tests[k].d||'').slice(0,180));});
})().then(()=>setTimeout(()=>{},400));
