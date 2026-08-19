const https=require('https'); const fs=require('fs');
const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'application/json'};
function get(url){return new Promise((res)=>{const rq=https.get(url,UA,(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({s:r.statusCode,d:d}));});rq.on('error',(e)=>res({s:'ERR',d:String(e.message)}));rq.setTimeout(20000,()=>rq.destroy());});}
const SYMS=['AAPL','MSFT','NVDA','TSLA','AMD','COIN','F','JPM'];
(async()=>{
  for(const s of SYMS){
    try{
      const r=await get('https://stockanalysis.com/api/symbol/s/'+s+'/history?range=1Y');
      const j=JSON.parse(r.d); const arr=j.data||[];
      const dates=arr.map(x=>x.t);
      const may=arr.filter(x=>x.t>= '2026-05-01' && x.t<= '2026-06-30').length;
      console.log(s, 'rows='+arr.length, 'first='+dates[dates.length-1], 'last='+dates[0], 'may-jun='+may, 'asc>='+(dates[0]>=dates[dates.length-1]?'last-newest':'last-oldest'));
    }catch(e){console.log(s,'ERR',String(e.message||e));}
  }
})().then(()=>setTimeout(()=>{},300));
