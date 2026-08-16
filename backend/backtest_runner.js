/**
 * Standalone backtest runner (wymaga działającego serwera na http://localhost:3000).
 * Jeśli endpoint historii nie odpowiada, automatycznie przełączy się na mock data.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const API = 'http://localhost:3000/api';
const SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','AVGO','ORCL','CRM',
  'AMD','INTC','QCOM','TXN','ADI','PYPL','SHOP','COIN','MRNA','PFE',
  'JPM','BAC','WFC','GS','MS','V','MA','AXP','BLK','SPGI',
  'XOM','CVX','COP','SLB','MRO','OXY','BP','SHEL','TTE','EQNR',
];

const LIMITS = { TP_MULT: 1.5, SL_MULT: 1.0, HOLD: 5 };
let USED_MOCK = false;
function mean(arr){ if(!arr.length) return 0; return arr.reduce((a,b)=>a+b,0)/arr.length; }

function sma(closes, length){
  const out = new Array(closes.length).fill(null);
  for(let i=length-1;i<closes.length;i++){
    const slice = closes.slice(i-length+1, i+1);
    out[i]=mean(slice);
  }
  return out;
}

function rsi(closes, length=14){
  const out = new Array(closes.length).fill(null);
  if(closes.length < length+1) return out;
  let gains=0, losses=0;
  for(let i=1;i<=length;i++){
    const d=closes[i]-closes[i-1];
    if(d>0) gains+=d; else losses-=d;
  }
  let avgGain=gains/length, avgLoss=losses/length;
  out[length]=100-100/(1+(avgGain/(avgLoss||1)));
  for(let i=length+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1], g=d>0?d:0, l=d<0?-d:0;
    avgGain=(avgGain*(length-1)+g)/length; avgLoss=(avgLoss*(length-1)+l)/length;
    out[i]=100-100/(1+(avgGain/(avgLoss||1)));
  }
  return out;
}

function atr(highs, lows, closes, length=14){
  const tr = new Array(closes.length).fill(0);
  for(let i=1;i<closes.length;i++){
    tr[i]=Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  const out = new Array(closes.length).fill(null);
  if(closes.length < length+1) return out;
  out[length]=mean(tr.slice(1, length+1));
  for(let i=length+1;i<closes.length;i++){
    out[i]=((out[i-1]*(length-1))+tr[i])/length;
  }
  return out;
}

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function getJSON(url){
  return new Promise((resolve, reject)=>{
    http.get(url,(res)=>{
      let d='';
      res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve(JSON.parse(d)); }catch(e){ reject(new Error(url)); } });
    }).on('error', reject);
  });
}

function generateMock(symbol){
  const len=320, base=50+Math.random()*900, out=[];
  let price=base;
  for(let i=0;i<len;i++){
    const drift=(Math.random()-0.48)*price*0.025; price=Math.max(price*0.7, price+drift);
    out.push({ date:new Date(Date.now()-(len-i)*86400000).toISOString().split('T')[0], open:price, high:price*(1+Math.random()*0.012), low:price*(1-Math.random()*0.012), close:price });
  }
  return out;
}

async function tryHistory(symbol){
  try{
    const data = await getJSON(`${API}/stocks/${encodeURIComponent(symbol)}/history?period=1Y`);
    const arr = Array.isArray(data)?data:(data?.data||data?.history||[]);
    if(!Array.isArray(arr)||arr.length<80) throw new Error('empty');
    const mapped = arr.map(h=>({ date:h.date, open:+h.open, high:+h.high, low:+h.low, close:+h.close })).filter(c=>Number.isFinite(c.close));
    if(mapped.length<80) throw new Error('short');
    return mapped;
  }catch(e){ USED_MOCK=true; return generateMock(symbol); }
}

async function run(){
  let symbols = SYMBOLS.slice(0,20);
  if(!symbols.length) symbols = SYMBOLS;
  console.log('Starting backtest... Symbols:', symbols.join(','));

  const results=[];
  for(const sym of symbols){
    console.log('Backtesting', sym);
    const history = await tryHistory(sym);
    const closes = history.map(c=>c.close);
    const highs = history.map(c=>c.high);
    const lows = history.map(c=>c.low);
    const s20 = sma(closes,20), s50 = sma(closes,50), r = rsi(closes,14), a = atr(highs,lows,closes,14);
    let trades=0, tp=0, sl=0, timeout=0;
    for(let i=50;i<closes.length-LIMITS.HOLD;i++){
      if(!Number.isFinite(s20[i])||!Number.isFinite(s50[i])||!Number.isFinite(r[i])||!Number.isFinite(a[i])) continue;
      if(s20[i] <= s50[i]) continue;
      if(closes[i] < s20[i]) continue;
      if(r[i] <= 35 || r[i] >= 70) continue;
      const entry=closes[i], atrVal=a[i];
      if(!atrVal || atrVal<=0) continue;
      const tpLevel = entry + LIMITS.TP_MULT * atrVal;
      const slLevel = entry - LIMITS.SL_MULT * atrVal;
      let closed=false;
      for(let j=1;j<=LIMITS.HOLD;j++){
        const c = closes[i+j];
        if(c >= tpLevel){ tp++; closed=true; break; }
        if(c <= slLevel){ sl++; closed=true; break; }
      }
      if(!closed) timeout++;
      trades++;
    }
    const winRate = trades? tp/trades : 0;
    results.push({ symbol:sym, status: USED_MOCK?'mock':'history', trades, tp, sl, timeout, winRate: +winRate.toFixed(4) });
    console.log(` -> ${sym} trades=${trades} tp=${tp} sl=${sl} timeout=${timeout} winRate=${(winRate*100).toFixed(1)}%`);
  }
  const tradesAll = results.reduce((a,b)=>a+(b.trades||0),0);
  const tpAll = results.reduce((a,b)=>a+(b.tp||0),0);
  const slAll = results.reduce((a,b)=>a+(b.sl||0),0);
  const timeoutAll = results.reduce((a,b)=>a+(b.timeout||0),0);
  const winRateAll = tradesAll? tpAll/tradesAll : 0;
  const summary = {
    ts: new Date().toISOString(),
    tested: results.length,
    source: USED_MOCK ? 'mock' : 'history',
    trades: tradesAll, tp: tpAll, sl: slAll, timeout: timeoutAll,
    winRate: +winRateAll.toFixed(4), winRatePct: +(winRateAll*100).toFixed(2),
    results
  };
  return summary;
}

run().then(s=>{
  console.log('SUMMARY', JSON.stringify(s,null,2));
  fs.writeFileSync(path.join(__dirname,'backtest_report.json'), JSON.stringify(s,null,2), 'utf8');
  process.exit(0);
}).catch(e=>{ console.error(e); process.exit(1); });