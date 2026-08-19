const https = require('https');
function get(url){
  return new Promise((res,rej)=>{
    https.get(url,{headers:{'User-Agent':'Mozilla/5.0'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode, d}));}).on('error',rej);
  });
}
(async()=>{
  try{
    const r = await get('https://stooq.com/q/d/l/?s=aapl.us&i=d');
    const lines = r.d.split('\n').filter(Boolean);
    console.log('STATUS=', r.status, 'LINES=', lines.length, 'HEAD=', lines[0], '| TAIL=', lines[Math.max(1,lines.length-2)]);
  }catch(e){ console.log('ERR', String(e&&e.message||e)); }
})();
setTimeout(()=>{},1500);
