/**
 * BACKTEST NA REALNYCH DANYCH — okres maj–czerwiec, 1000 wejść, bez lookahead.
 *
 * Zasady uczciwości (zgodnie z wymaganiem użytkownika):
 *  1) WYŁĄCZNIE realne dane (stockanalysis.com, fallback nasdaq.com) — NIGDY mock.
 *  2) BEZ LOOKAHEAD: każde wejście na barze `i` rozstrzygane jest wyłącznie
 *     na barach `i+1..i+HOLD`. Wskaźniki liczone są tylko z barów <= i.
 *  3) PUNKTOWO: przy wejściu ustawiamy TP/SL (wielokrotność ATR w wejściu),
 *     a następnie idziemy świeczka po świeczce i sprawdzamy intraday high/low.
 *     Dokładnie tak jak w prawdziwej transakcji — nie znamy przyszłości.
 *  4) WALK-FORWARD: parametry wybieramy na IN-SAMPLE, a finalną ocenę
 *     (1000 wejść) liczymy na OUT-OF-SAMPLE (maj–czerwiec), bez wybierania
 *     najlepszych akurat parametrów pod ten okres.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const TOP_N  = 40;   // ile symboli z listy użyć (dla 1000 wejść w maju-czerwcu)
const TARGET = 1000; // liczba realnych wejść do rozstrzygnięcia

// Okres analizy (RAPORT): maj-czerwiec 2026
const PERIOD_START = new Date('2026-05-01T00:00:00Z');
const PERIOD_END   = new Date('2026-06-30T23:59:59Z');

// Okres in-sample do dobrania parametrów (marzec-kwiecień) — NIE w raporcie końcowym.
const TRAIN_START = new Date('2026-03-01T00:00:00Z');
const TRAIN_END   = new Date('2026-04-30T23:59:59Z');

const SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','AVGO','ORCL','CRM',
  'AMD','INTC','QCOM','TXN','ADI','PYPL','SHOP','COIN','MRNA','PFE',
  'JPM','BAC','WFC','GS','MS','V','MA','AXP','BLK','SPGI',
  'XOM','CVX','COP','SLB','MRO','OXY','BP','SHEL','TTE','EQNR',
].slice(0, TOP_N);

// Parametry do grid-search (wybierane tylko na in-sample).
const GRID = {
  TP_MULT: [1.5, 2.0, 2.5],   // zysk docelowy = TP_MULT * ATR
  SL_MULT: [3.0, 4.0, 5.0],   // stop = SL_MULT * ATR (szeroki > TP -> wyższy win-rate)
  HOLD:    [5, 7, 10, 14],    // maks. dni trzymania pozycji
  RSI_MIN: [25, 35],          // nie wchodzimy w mocno wyprzedane
  RSI_MAX: [70, 80],          // nie wchodzimy w mocno wykupione
  TREND:   [true],            // wymagaj SMA20 > SMA50 (i tak tylko ten tryb rozpatrujemy)
};

let FETCHED = { ok: 0, fail: 0, sources: {} };
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

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json,text/html,*/*'
};

function get(url, timeoutMs){
  return new Promise((res, rej)=>{
    const rq = https.get(url, UA, (r)=>{
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
        if(r.statusCode!==200) return rej(new Error('HTTP '+r.statusCode));
        res(JSON.parse(d));
      });
    });
    rq.on('error', rej);
    rq.setTimeout(timeoutMs||20000, ()=>rq.destroy(new Error('timeout')));
  });
}

/** Pobranie realnej historii dziennej (OHLCV) dla symbolu.
 *  Źródło główne: stockanalysis.com; fallback: nasdaq.com.
 *  Zwraca tablicę barów posortowaną CHRONOLOGICZNIE (najstarszy->najnowszy). */
async function fetchRealHistory(symbol){
  const out = [];
  // 1) stockanalysis.com
  try{
    const j = await get(`https://stockanalysis.com/api/symbol/s/${encodeURIComponent(symbol)}/history?range=1Y`);
    const arr = (j && j.data) || [];
    if(Array.isArray(arr) && arr.length){
      const bars = arr
        .map(x=>({ date:x.t, open:+x.o, high:+x.h, low:+x.l, close:+x.c, volume:+x.v }))
        .filter(b=>Number.isFinite(b.close)&&b.close>0&&b.high>=b.low)
        .sort((a,b)=> a.date<b.date ? -1 : a.date>b.date ? 1 : 0);
      if(bars.length>=80){ FETCHED.sources[symbol]='stockanalysis'; return bars; }
    }
  }catch(e){ /* fallback below */ }

  // 2) nasdaq.com
  try{
    const to=new Date(); const from=new Date(to.getTime()-400*86400000);
    const fromStr=from.toISOString().slice(0,10), toStr=to.toISOString().slice(0,10);
    const j = await get(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${fromStr}&todate=${toStr}&limit=9999`);
    const rows = (j && j.data && j.data.tradesTable && j.data.tradesTable.rows) || [];
    if(Array.isArray(rows) && rows.length){
      const bars = rows.map(x=>({
        date: x.date.split('/').reverse().join('-'),
        open: parseFloat(String(x.open).replace(/,/g,'').replace(/[^0-9.\-]/g,'')),
        high: parseFloat(String(x.high).replace(/,/g,'').replace(/[^0-9.\-]/g,'')),
        low:  parseFloat(String(x.low).replace(/,/g,'').replace(/[^0-9.\-]/g,'')),
        close:parseFloat(String(x['close']||x.close_).replace(/,/g,'').replace(/[^0-9.\-]/g,'')),
        volume:+x.volume
      })).filter(b=>Number.isFinite(b.close)&&b.close>0)
        .sort((a,b)=> a.date<b.date ? -1 : a.date>b.date ? 1 : 0);
      if(bars.length>=80){ FETCHED.sources[symbol]='nasdaq'; return bars; }
    }
  }catch(e){ /* skip */ }

  FETCHED.fail++;
  return null; // brak danych -> symbol pomijany, NIGDY mock
}

/**
 * Punktowa symulacja strategii w oknie dat.
 * - Wskaźniki liczone tylko z barów <= i (brak lookahead).
 * - Wejście tylko, gdy data bar`i` mieści się w [start, end].
 * - Rozstrzygnięcie wyłącznie na barach i+1..i+HOLD (intraday high/low).
 * Zwraca listę {symbol, date, entry, outcome:'TP'|'SL'|'TIMEOUT'}.
 */
function simulateWindow(history, P, symbol, start, end){
  const closes = history.map(c=>c.close);
  const highs = history.map(c=>c.high);
  const lows = history.map(c=>c.low);
  const s20 = sma(closes,20), s50 = sma(closes,50), r = rsi(closes,14), a = atr(highs,lows,closes,14);
  const hold = P.HOLD;
  const t0 = start.getTime(), t1 = end.getTime();
  const entries = [];
  for(let i=50;i<closes.length-hold;i++){
    if(!Number.isFinite(s20[i])||!Number.isFinite(s50[i])||!Number.isFinite(r[i])||!Number.isFinite(a[i])) continue;
    // Okno analizy: tylko wejścia z okresu [start,end]
    const t = new Date(history[i].date + 'T00:00:00Z').getTime();
    if(t < t0 || t > t1) continue;
    if(P.TREND && s20[i] <= s50[i]) continue;   // opcjonalny filtr trendu: SMA20 > SMA50
    if(closes[i] < s20[i]) continue;            // momentum: price >= SMA20
    if(r[i] < P.RSI_MIN || r[i] > P.RSI_MAX) continue;
    const entry=closes[i], atrVal=a[i];
    if(!atrVal || atrVal<=0) continue;
    const tpLevel = entry + P.TP_MULT * atrVal;
    const slLevel = entry - P.SL_MULT * atrVal;
    let outcome='TIMEOUT';
    for(let j=1;j<=hold;j++){
      const h = highs[i+j], l = lows[i+j];
      // Idziemy bar po barze na przyszłość poznaną DOPIERO w danym kroku.
      if(h >= tpLevel){ outcome='TP'; break; }   // najpierw możliwe trafienie TP
      if(l <= slLevel){ outcome='SL'; break; }
    }
    entries.push({ symbol, date: history[i].date, entry, tp: +tpLevel.toFixed(2), sl: +slLevel.toFixed(2), outcome });
  }
  return entries;
}
/**
 * Uczciwy backtest:
 *  - Pobiera REALNE dane (NIGDY mock).
 *  - Wybiera parametry na IN-SAMPLE (marzec–kwiecień) — i do tego dochodzi
 *    bez przyszłości względem okresu badanego (maj–czerwiec).
 *  - Finalny raport: rozstrzygnięcie do 1000 wejść z maj–czerwiec, bez lookahead.
 */
const MIN_TRAIN_TRADES = 15; // min wejść w in-sample, by nie overfit na 2 sygnałach

async function runAll(){
  // 1) Pobierz realne dane dla wszystkich symboli (np. równolegle, mały limit).
  const wip = [];
  for(const sym of SYMBOLS){
    const p = fetchRealHistory(sym).then(h=>[sym,h]);
    wip.push(p);
    await new Promise(r=>setTimeout(r,120)); // rozładowanie rate-limit
    if(wip.length%6===0) await new Promise(r=>setTimeout(r,400));
  }
  const fetched = await Promise.all(wip);
  const histMap = {};
  const symbols = [];
  for(const [sym,h] of fetched){ if(h){ histMap[sym]=h; symbols.push(sym); } }

  console.log('Fetched real history for', symbols.length, 'symbols.');
  console.log('Sources:', JSON.stringify(FETCHED.sources));
  if(!symbols.length){ console.error('NO REAL DATA — aborting, refusing to mock.'); process.exit(3); }

  // 2) Grid parametrów.
  const combos=[];
  for(const TP of GRID.TP_MULT)
  for(const SL of GRID.SL_MULT)
  for(const HOLD of GRID.HOLD)
  for(const RSI_MIN of GRID.RSI_MIN)
  for(const RSI_MAX of GRID.RSI_MAX)
  for(const TREND of GRID.TREND){
    combos.push({ TP_MULT:TP, SL_MULT:SL, HOLD, RSI_MIN, RSI_MAX, TREND });
  }
  console.log('Combos to evaluate (in-sample):', combos.length);

  // 3) Wybór parametrów WYŁĄCZNIE na in-sample (marzec–kwiecień), bez cienia.
  //    Wchodzimy w każdy dzień, ale rozstrzygamy na barach i+1..i+HOLD —
  //    dlatego na brzegu okresu mogę stracić cokolwiek, ale zawsze bez przyszłości.
  const scored = combos.map(P=>{
    const all = [];
    for(const sym of symbols) all.push(...simulateWindow(histMap[sym], P, sym, TRAIN_START, TRAIN_END));
    const tp=all.filter(e=>e.outcome==='TP').length;
    return { P, trades:all.length, tp, sl:all.filter(e=>e.outcome==='SL').length,
             timeout:all.filter(e=>e.outcome==='TIMEOUT').length, winRate: all.length? tp/all.length : 0 };
  }).filter(x=>x.trades>=MIN_TRAIN_TRADES);

  scored.sort((A,B)=>{
    if(A.winRate!==B.winRate) return B.winRate-A.winRate;
    return B.trades-A.trades;
  });

  if(!scored.length){
    console.error('No config met the in-sample trade threshold — widening grid needed, but refusing to mock.');
    process.exit(2);
  }
  const chosenP = scored[0].P;

  // 4) RAPORTED: out-of-sample okres maj–czerwiec przy WYBRANYCH parametrach.
  //    Zbieramy do 1000 wejść. Kolejność ustalamy deterministycznie (symbol jak w liście),
  //    a ponad wymaganą liczbę nie celujemy — raport = dokładnie te realne sygnały.
  const entries = [];
  for(const sym of symbols){
    entries.push(...simulateWindow(histMap[sym], chosenP, sym, PERIOD_START, PERIOD_END));
    if(entries.length>=TARGET) break;
  }
  const reportEntries = entries.slice(0, TARGET);
  const tp=reportEntries.filter(e=>e.outcome==='TP').length;
  const sl=reportEntries.filter(e=>e.outcome==='SL').length;
  const timeout=reportEntries.filter(e=>e.outcome==='TIMEOUT').length;
  const winRate = reportEntries.length? tp/reportEntries.length : 0;

  const perSymbol = {};
  for(const e of reportEntries){
    perSymbol[e.symbol] = perSymbol[e.symbol]||[];
    perSymbol[e.symbol].push(e.outcome);
  }
  const symbolSummary = Object.entries(perSymbol).map(([sym,arr])=>({
    symbol: sym,
    entries: arr.length,
    tp: arr.filter(o=>o==='TP').length,
    sl: arr.filter(o=>o==='SL').length,
    timeout: arr.filter(o=>o==='TIMEOUT').length,
    winRatePct: +(arr.filter(o=>o==='TP').length/arr.length*100).toFixed(2)
  }));

  console.log('Best config:', JSON.stringify(chosenP), '(in-sample winRate=', (scored[0].winRate*100).toFixed(1)+'%, trades=', scored[0].trades+')');

  const summary = {
    ts: new Date().toISOString(),
    integrity: {
      realDataOnly: true,
      lookaheadBias: 'none — each entry resolved strictly on bars i+1..i+HOLD; indicators from bars <= i',
      walkForward: 'params selected on in-sample (Mar 1 - Apr 30 2026), reported on out-of-sample (May 1 - Jun 30 2026)',
      mockUsed: false
    },
    strategy: 'SMA20>SMA50 + RSI filter, long-only; TP/SL (ATR multiples), pointwise intraday resolution, TP checked first per bar',
    period: '2026-05-01..2026-06-30',
    symbolsTested: symbols.length,
    symbolsInReport: symbolSummary.length,
    dataSources: FETCHED.sources,
    chosenConfig: chosenP,
    chosenConfigInSample: { winRatePct: +(scored[0].winRate*100).toFixed(2), trades: scored[0].trades },
    gridEvalTop: scored.slice(0,5).map(s=>({ config:s.P, trades:s.trades, winRatePct:+(s.winRate*100).toFixed(2) })),
    report: {
      entries: reportEntries.length,
      tp, sl, timeout,
      winRate: +winRate.toFixed(4),
      winRatePct: +(winRate*100).toFixed(2)
    },
    perSymbol: symbolSummary
  };
  return summary;
}

runAll().then(s=>{
  console.log('SUMMARY', JSON.stringify(s,null,2));
  fs.writeFileSync(path.join(__dirname,'backtest_report.json'), JSON.stringify(s,null,2), 'utf8');
  console.log('Written backtest_report.json');
  process.exit(0);
}).catch(e=>{ console.error(e); process.exit(1); });