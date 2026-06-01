/* TradeArchive — Analytics v7 (Tables API) */

document.addEventListener('DOMContentLoaded', async () => {
  const trades = await DB.getAll('trades');
  if (trades.length === 0) {
    document.getElementById('noDataMsg').style.display = 'block';
    document.getElementById('analyticsContent').style.display = 'none';
    const btn = document.getElementById('excelDownloadBtn');
    if (btn) btn.style.display = 'none';
    return;
  }
  document.getElementById('noDataMsg').style.display = 'none';
  document.getElementById('analyticsContent').style.display = 'block';
  renderStats(trades);
  renderDowChart(trades);
  renderHourChart(trades);
  renderDistChart(trades);
  renderDurationChart(trades);
  renderSymbolTable(trades);
  const btn = document.getElementById('excelDownloadBtn');
  if (btn) btn.addEventListener('click', () => excelExport.analytics(trades));
});

function renderStats(trades) {
  const s = calcStats(trades);
  if (!s) return;
  const grid = document.getElementById('statGrid');
  const items = [
    { label:'총 거래수',    val: trades.length + '건',             cls:'' },
    { label:'승률',         val: fmt.percent(s.winRate),           cls: s.winRate >= 50 ? 'pos' : 'neg' },
    { label:'누적 수익',    val: fmt.currency(s.total),            cls: s.total >= 0 ? 'pos' : 'neg' },
    { label:'손익비',       val: isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞', cls: s.profitFactor >= 1 ? 'pos' : 'neg' },
    { label:'평균 수익',    val: fmt.currency(s.avgWin),           cls:'pos' },
    { label:'평균 손실',    val: fmt.currency(s.avgLoss),          cls:'neg' },
    { label:'최대 수익',    val: fmt.currency(s.maxWin),           cls:'pos' },
    { label:'최대 손실',    val: fmt.currency(s.maxLoss),          cls:'neg' },
    { label:'MDD',          val: fmt.percent(s.mdd),               cls:'neg' },
    { label:'최대 연속 승', val: s.maxCW + '연속',                 cls:'pos' },
    { label:'최대 연속 패', val: s.maxCL + '연속',                 cls:'neg' },
    { label:'평균 보유',    val: fmt.duration(s.avgDuration),      cls:'' },
    { label:'Sharpe Ratio', val: s.sharpe.toFixed(2),              cls: s.sharpe >= 1 ? 'pos' : '' },
    { label:'총 커미션',    val: fmt.currency(s.totalComm),        cls:'neg' },
    { label:'총 스왑',      val: fmt.currency(s.totalSwap),        cls: s.totalSwap >= 0 ? 'pos' : 'neg' },
    { label:'승 거래수',    val: s.wins + '건',                    cls:'pos' },
  ];
  grid.innerHTML = items.map(item => `
    <div class="stat-box">
      <div class="stat-box-label">${item.label}</div>
      <div class="stat-box-val ${item.cls}">${item.val}</div>
    </div>`).join('');
}

const CHART_DEFAULTS = {
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color:'rgba(255,255,255,0.05)' }, ticks: { color:'#8a9aaa', font:{ size:11 } } },
    y: { grid: { color:'rgba(255,255,255,0.05)' }, ticks: { color:'#8a9aaa', font:{ size:11 } } }
  }
};

function renderDowChart(trades) {
  const days = ['일','월','화','수','목','금','토'];
  const map  = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
  trades.forEach(t => { if (!t.close_time) return; const d = new Date(t.close_time); if (!isNaN(d)) map[d.getDay()].push(parseFloat(t.profit)||0); });
  const avgs = days.map((_,i) => map[i].length > 0 ? map[i].reduce((a,b)=>a+b,0)/map[i].length : 0);
  new Chart(document.getElementById('dowChart'), { type:'bar', data:{ labels:days, datasets:[{ data:avgs, backgroundColor:avgs.map(v=>v>=0?'rgba(61,214,140,0.7)':'rgba(240,96,96,0.7)'), borderRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, ...CHART_DEFAULTS } });
}

function renderHourChart(trades) {
  const map = {};
  for (let i=0;i<24;i++) map[i]=[];
  trades.forEach(t => { if (!t.close_time) return; const d = new Date(t.close_time); if (!isNaN(d)) map[d.getHours()].push(parseFloat(t.profit)||0); });
  const labels = Array.from({length:24},(_,i)=>i+'시');
  const avgs   = Array.from({length:24},(_,i)=>map[i].length>0?map[i].reduce((a,b)=>a+b,0)/map[i].length:0);
  new Chart(document.getElementById('hourChart'), { type:'bar', data:{ labels, datasets:[{ data:avgs, backgroundColor:avgs.map(v=>v>=0?'rgba(91,168,224,0.7)':'rgba(240,96,96,0.7)'), borderRadius:3 }] }, options:{ responsive:true, maintainAspectRatio:false, ...CHART_DEFAULTS } });
}

function renderDistChart(trades) {
  const profits = trades.map(t=>parseFloat(t.profit)||0);
  const min=Math.floor(Math.min(...profits)/10)*10, max=Math.ceil(Math.max(...profits)/10)*10;
  const buckets={}, step=10;
  for(let v=min;v<max;v+=step){ const label=`${v}~${v+step}`; buckets[label]=profits.filter(p=>p>=v&&p<v+step).length; }
  new Chart(document.getElementById('distChart'), { type:'bar', data:{ labels:Object.keys(buckets), datasets:[{ data:Object.values(buckets), backgroundColor:'rgba(167,139,250,0.7)', borderRadius:3 }] }, options:{ responsive:true, maintainAspectRatio:false, ...CHART_DEFAULTS } });
}

function renderDurationChart(trades) {
  const durs=trades.filter(t=>t.open_time&&t.close_time).map(t=>(new Date(t.close_time)-new Date(t.open_time))/60000).filter(d=>d>0);
  const buckets={'0-15분':0,'15-60분':0,'1-4시간':0,'4-24시간':0,'1일+':0};
  durs.forEach(m=>{ if(m<15) buckets['0-15분']++; else if(m<60) buckets['15-60분']++; else if(m<240) buckets['1-4시간']++; else if(m<1440) buckets['4-24시간']++; else buckets['1일+']++; });
  new Chart(document.getElementById('durationChart'), { type:'bar', data:{ labels:Object.keys(buckets), datasets:[{ data:Object.values(buckets), backgroundColor:'rgba(245,166,35,0.7)', borderRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, ...CHART_DEFAULTS } });
}

function renderSymbolTable(trades) {
  const map={};
  trades.forEach(t=>{ if(!t.symbol)return; if(!map[t.symbol])map[t.symbol]=[]; map[t.symbol].push(t); });
  const rows=Object.entries(map).map(([sym,ts])=>{ const profits=ts.map(t=>parseFloat(t.profit)||0); const total=profits.reduce((a,b)=>a+b,0); const wins=profits.filter(p=>p>0).length; const wr=((wins/ts.length)*100).toFixed(1); return { sym, cnt:ts.length, wr, total, avg:total/ts.length, max:Math.max(...profits), min:Math.min(...profits) }; }).sort((a,b)=>b.total-a.total);
  document.getElementById('symbolTbody').innerHTML = rows.map(r=>`
    <tr>
      <td style="font-weight:600;color:var(--text-primary);">${r.sym}</td>
      <td>${r.cnt}건</td>
      <td class="${parseFloat(r.wr)>=50?'profit-cell pos':'profit-cell neg'}">${r.wr}%</td>
      <td class="profit-cell ${r.total>=0?'pos':'neg'}">${fmt.currency(r.total)}</td>
      <td class="profit-cell ${r.avg>=0?'pos':'neg'}">${fmt.currency(r.avg)}</td>
      <td class="profit-cell pos">${fmt.currency(r.max)}</td>
      <td class="profit-cell neg">${fmt.currency(r.min)}</td>
    </tr>`).join('');
}
