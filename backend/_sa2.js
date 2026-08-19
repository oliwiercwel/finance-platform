const https=require('https'); const fs=require('fs');
const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'application/json'};
function get(url){return new Promise((res)=>{const rq=https.get(url,UA,(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({s:r.statusCode,d:d}));});rq.on('error',(e)=>res({s:'ERR',d:String(e.message)}));rq.setTimeout(20000,()=>rq.destroy());});}
(async()=>{
  const r=await get('https://stockanalysis.com/api/symbol/s/AAPL/history?range=1Y');
  console.log('status',r.s, 'len', r.d.length);
  try{ const j=JSON.parse(r.d); const arr=j.data||[]; console.log('rows',arr.length);
    const dates=arr.map(x=>x.t); console.log('min',dates[dates.length-1], 'max',dates[0]);
    console.log('sample newest',JSON.stringify(arr[0])); console.log('sample old',JSON.stringify(arr[arr.length-1]));
    fs.writeFileSync('_sa_sample.json', JSON.stringify(arr,null,1), 'utf8');
  }catch(e){console.log('parse err',e.message, r.d.slice(0,200));}
})().then(()=>setTimeout(()=>{},300));
