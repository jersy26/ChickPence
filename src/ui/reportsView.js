import { datePresets, header, empty, barChart } from './redesignKit.js';
import { buildPnlLedger, pnlForMonth, shiftMonth } from '../services/pnlCalendar.js';
import { buildFarmReport, FARM_REPORTS } from '../services/farmReports.js';
import { escapeHtml } from './html.js';
import { LABS } from './navigation.js';
import { renderPnlCalendar, attachPnlCalendar } from './pnlCalendarView.js';
import { formatPeso, formatDate, localToday } from '../services/calculations.js';
import { farmTabs,farmPagination,attachFarmPagination,downloadFarmCsv,option } from './farmTable.js';
const num=v=>Number(v||0).toLocaleString('en-PH',{maximumFractionDigits:2});
const svg=d=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS={
  export:svg('<path d="M12 15V4M7 9l5-5 5 5M5 14v5h14v-5"/>'),
  print:svg('<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/>'),
  flock:svg('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15 19c0-2 1.6-3.5 3.5-3.5S22 17 22 19"/>'),
  health:svg('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
  sales:svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  pnl:svg('<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/>'),
  breakdown:svg('<path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/>')
};
const TAB_HINTS={flock:'Birds left per batch',health:'Daily feed and deaths',sales:'Buyers and prices',pnl:'Profit by month',breakdown:'Compare two flocks'};
const columns={flock:['Batch','Status','Placed','Age (days)','Initial chicks','Deaths to date','Sold to date','Birds remaining'],health:['Batch','Feed used (kg)','Deaths in period','Mortality to date (%)','Threshold (%)','Health status'],sales:['Buyer / market','Batch','Sales','Heads sold','Weight (kg)','Avg price / kg','Sales total'],pnl:['Batch','Status','Recorded sales','Recorded costs','Recorded P&L','Margin (%)','Basis']};
export function reportValues(row,tab) {
  if(tab==='sales')return[row.buyer,row.batch,row.sales,row.heads,row.kg,row.price==null?'':row.price,row.revenue/100];
  if(tab==='health')return[row.batch,row.feed,row.deaths,row.mortalityRate,row.threshold??'',row.warning?'Above threshold':row.threshold==null?'No threshold':'Within threshold'];
  if(tab==='pnl')return[row.batch,row.status,row.revenue/100,row.cost/100,row.net/100,row.margin??'',row.final?'Closed batch':'Provisional'];
  return[row.batch,row.status,row.start,row.age,row.initial,row.totalDeaths,row.sold,row.live];
}
export function renderReports(items,expenses,{tab='flock',filters={},page=1,size=10}={}) {
  if(tab==='breakdown')return renderBreakdown(items,filters);
  const rows=buildFarmReport(items,expenses,tab,filters),maxPage=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,maxPage);
  const headers=columns[tab]||columns.flock;
  const body=rows.slice((current-1)*size,current*size).map(r=>{
    let cells;
    if(tab==='flock')cells=[escapeHtml(r.batch),`<span class="farm-status">${escapeHtml(r.status)}</span>`,formatDate(r.start,true),num(r.age),num(r.initial),num(r.totalDeaths),num(r.sold),`<b>${num(r.live)}</b>`];
    else if(tab==='health')cells=[escapeHtml(r.batch),num(r.feed),num(r.deaths),`${num(r.mortalityRate)}%`,r.threshold==null?'Not set':`${num(r.threshold)}%`,`<span class="farm-status ${r.warning?'danger':''}">${r.warning?'Needs attention':r.threshold==null?'Not set':'Within limit'}</span>`];
    else if(tab==='sales')cells=[escapeHtml(r.buyer),escapeHtml(r.batch),num(r.sales),num(r.heads),num(r.kg),r.price==null?'—':formatPeso(r.price),formatPeso(r.revenue/100)];
    else cells=[escapeHtml(r.batch),escapeHtml(r.status),formatPeso(r.revenue/100),formatPeso(r.cost/100),`<b class="${r.net<0?'text-bad':''}">${formatPeso(r.net/100)}</b>`,r.margin==null?'—':`${num(r.margin)}%`,r.final?'Closed batch':'Provisional'];
    return `<tr>${cells.map((v,i)=>`<td>${i===0&&tab!=='sales'?`<button type="button" class="farm-record-link" data-report-batch="${escapeHtml(r.batchId)}" data-report-closed="${r.final?'true':'false'}">${v}</button>`:v}</td>`).join('')}</tr>`;
  }).join('');
  const notes={flock:'Bird balance = initial chicks − recorded deaths − recorded sales, through the To date. It is a record balance, not a physical stock count.',health:'Feed and deaths follow the selected date range. Mortality rate and batch thresholds are cumulative through the To date.',sales:'Only saved sales in the selected date range are included. Payment status and outstanding balances are not tracked yet.',pnl:'Recorded P&L follows sale, chick-purchase and expense dates. Open batches are provisional; a date-filtered result is not the final whole-batch profit.'};
  const tabs=[...FARM_REPORTS.map(t=>t[0]==='sales'?['sales','Sales']:t),...(LABS?[['breakdown','Profit breakdown']]:[])];
  return `<section class="page-section farm-records-page rd-reports" aria-labelledby="reports-title"><header class="rd-reports-head"><div><h1 id="reports-title">Reports</h1><p class="text-mut">A clear view of your flock, records and farm performance.</p></div><div class="rd-reports-actions"><button type="button" class="btn-action primary" id="report-detailed-export">${ICONS.export}<span>Export</span></button><button type="button" class="btn-action" id="rd-print-report">${ICONS.print}<span>Print</span></button></div></header>
    <nav class="rd-report-tabs" aria-label="Report type">${tabs.map(([id,label])=>`<button type="button" data-report-tab="${escapeHtml(id)}" class="rd-report-tab t-${escapeHtml(id)} ${id===tab?'active':''}" ${id===tab?'aria-current="page"':''}><span class="rd-report-icon" aria-hidden="true">${ICONS[id]||ICONS.pnl}</span><span><b>${escapeHtml(label)}</b><small>${TAB_HINTS[id]||''}</small></span></button>`).join('')}</nav>
    <div class="rd-report-controls"><div class="rd-report-period"><span>Period</span>${datePresets()}</div><form class="farm-filterbar" id="report-filters">${batchPicker(items,filters.q||'')}<label>Status<select name="status">${option('','All batches',filters.status||'')}${option('Open','Open',filters.status||'')}${option('Closed','Closed',filters.status||'')}</select></label><label>From<input type="date" name="from" value="${escapeHtml(filters.from||'')}"/></label><label>To<input type="date" name="to" value="${escapeHtml(filters.to||'')}" max="${localToday()}"/></label><div class="farm-filter-buttons">${Object.values(filters).some(Boolean)?'<button type="button" class="btn-action" id="report-clear">Clear filters</button>':''}</div></form></div>
    ${reportChart(items,expenses,tab,filters,rows)}<p class="farm-table-context">${escapeHtml(FARM_REPORTS.find(t=>t[0]===tab)?.[1]||'Flock balance')} · ${filters.from?formatDate(filters.from,true):'All recorded dates'} to ${formatDate(filters.to||localToday(),true)}</p>
    <p class="farm-scroll-hint">Swipe the table sideways to see all columns.</p><div class="farm-table-surface"><table class="farm-data-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${headers.length}" class="farm-empty">No farm records match these filters. Try a wider date range.</td></tr>`}</tbody></table></div>${farmPagination(rows.length,current,size)}<p class="farm-footnote">${notes[tab]}</p></section>`;
}
export function attachReports(container,items,expenses,state,onChange,onNavigate,onExport) {
  container.querySelector('#rd-print-report')?.addEventListener('click',()=>window.print());
  container.querySelectorAll('[data-breakdown-select]').forEach(el=>el.addEventListener('change',()=>onChange({...state,filters:{...state.filters,[el.name]:el.value}})));
  let filterTimer;container.querySelector('#report-filters')?.addEventListener('input',e=>{clearTimeout(filterTimer);const form=e.currentTarget;filterTimer=setTimeout(()=>form.requestSubmit(),e.target.type==='search'?350:0);});
  container.querySelectorAll('[data-report-tab]').forEach(button=>button.addEventListener('click',()=>onChange({...state,tab:button.dataset.reportTab,page:1})));
  container.querySelector('#report-filters')?.addEventListener('submit',e=>{e.preventDefault();const filters=Object.fromEntries(new FormData(e.currentTarget));const end=filters.to||localToday();if(filters.from && filters.from>end){e.currentTarget.querySelector('[name="from"]').setCustomValidity('From must be on or before To.');e.currentTarget.reportValidity();return;}onChange({...state,filters,page:1});});
  container.querySelector('#report-filters')?.addEventListener('input',e=>e.currentTarget.querySelector('[name="from"]').setCustomValidity(''));
  container.querySelector('#report-clear')?.addEventListener('click',()=>onChange({...state,filters:{},page:1}));
  attachFarmPagination(container,page=>onChange({...state,page}),size=>onChange({...state,page:1,size}));
  container.querySelector('#report-csv')?.addEventListener('click',()=>downloadFarmCsv(`chickpence-${state.tab}-${localToday()}.csv`,columns[state.tab],buildFarmReport(items,expenses,state.tab,state.filters).map(row=>reportValues(row,state.tab))));
  container.querySelector('#report-detailed-export')?.addEventListener('click',onExport);
  container.querySelectorAll('[data-batch-pick]').forEach(b=>b.addEventListener('click',()=>{const form=b.closest('form');form.querySelector('[name="q"]').value=b.dataset.batchPick;form.requestSubmit();}));
  container.querySelector('.rd-hover-select')?.addEventListener('keydown',e=>{if(e.key==='Escape')document.activeElement?.blur();});
  attachPnlCalendar(container,items,expenses,onNavigate);
  container.querySelectorAll('[data-report-batch]').forEach(button=>button.addEventListener('click',()=>onNavigate(button.dataset.reportClosed==='true'?'summary':'batches',button.dataset.reportBatch)));
}

/** Batch name filter: hover (or focus, for touch and keyboard) opens the list; a pick submits the filter form. */
function batchPicker(items,current) {
 const names=[...new Set(items.map(i=>i.batch.batch_name))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
 const choice=(value,label)=>`<button type="button" class="rd-hover-option ${value===current?'active':''}" data-batch-pick="${escapeHtml(value)}" ${value===current?'aria-current="true"':''}>${escapeHtml(label)}</button>`;
 return `<div class="rd-hover-select farm-filter-grow"><span id="batch-pick-label">Batch name</span><input type="hidden" name="q" value="${escapeHtml(current)}"/><button type="button" class="rd-hover-trigger" aria-labelledby="batch-pick-label batch-pick-value" aria-haspopup="true"><span id="batch-pick-value">${escapeHtml(current||'Select batch name')}</span></button><div class="rd-hover-list" role="group" aria-label="Batches">${choice('','All batches')}${names.map(n=>choice(n,n)).join('')}</div></div>`;
}
function reportChart(items,expenses,tab,filters,rows) {
 if(!rows.length)return '';
 if(tab==='flock')return `<section class="rd-panel"><h2>Birds remaining by batch</h2>${barChart(rows.map(r=>({label:r.batch,value:r.live})),{label:'Recorded live bird balance'})}</section>`;
 if(tab==='sales')return `<section class="rd-panel"><h2>Average sale price per kg</h2>${barChart(rows.map(r=>({label:`${r.buyer} · ${r.batch}`,value:r.price||0})),{money:true,label:'Sale prices by buyer and batch'})}</section>`;
 if(tab==='health'){
   const dates=[...new Set(items.flatMap(i=>[...(i.feed||[]).map(f=>f.entry_date),...(i.mortality||[]).map(m=>m.entry_date)]))].filter(d=>(!filters.from||d>=filters.from)&&d<=(filters.to||localToday())).sort();
   const selected=items.filter(i=>(!filters.q||i.batch.batch_name.toLowerCase()===filters.q.toLowerCase())&&(!filters.status||i.batch.status===filters.status));
   return `<section class="rd-panel"><h2>Feed and deaths over time</h2><div class="rd-compare-grid">${['feed','deaths'].map(key=>{const data=dates.map(date=>({date,value:selected.reduce((s,i)=>s+(key==='feed'?(i.feed||[]).filter(f=>!f.deleted_at&&f.entry_date===date).reduce((n,f)=>n+(f.quantity_g!=null?Number(f.quantity_g)/1000:Number(f.quantity_kg)||0),0):(i.mortality||[]).filter(m=>!m.deleted_at&&m.entry_date===date).reduce((n,m)=>n+(Number(m.count)||0),0)),0)}));return `<div class="rd-trend-card ${key}"><h3>${key==='feed'?'Feed used':'Deaths'}</h3>${trend(data,key==='feed'?{unit:'kg',color:'#5E9C55',light:'#B8DBA9',label:'Feed used'}:{unit:'birds',color:'#C6543B',light:'#F2B5A5',label:'Deaths'})}</div>`;}).join('')}</div></section>`;
 }
 const ledger=buildPnlLedger(items.filter(i=>(!filters.q||i.batch.batch_name.toLowerCase()===filters.q.toLowerCase())&&(!filters.status||i.batch.status===filters.status)),expenses),month=(filters.to||localToday()).slice(0,7),now=pnlForMonth(ledger,month),previous=pnlForMonth(ledger,shiftMonth(month,-1));
 const monthName=m=>new Date(`${m}-01T00:00:00`).toLocaleDateString('en-PH',{month:'long',year:'numeric'}),diff=now.net-previous.net;
 const tile=(label,net,note)=>`<div class="rd-pnl-tile ${net<0?'loss':'gain'}"><span>${escapeHtml(label)}</span><strong>${formatPeso(net/100)}</strong><small>${note}</small></div>`;
 return `<section class="rd-panel rd-pnl-panel"><h2>Recorded P&L by month</h2><div class="rd-pnl-tiles">${tile(monthName(month),now.net,now.net<0?'Loss this month':'Profit this month')}${tile(monthName(shiftMonth(month,-1)),previous.net,'Previous month')}<div class="rd-pnl-tile change ${diff<0?'loss':'gain'}"><span>Change</span><strong>${diff<0?'▼':'▲'} ${formatPeso(Math.abs(diff)/100)}</strong><small>${diff<0?'Worse':'Better'} than the month before</small></div></div>${barChart(Array.from({length:6},(_,n)=>{const m=shiftMonth(month,n-5);return {label:new Date(m+'-01T00:00:00').toLocaleDateString('en-PH',{month:'short',year:'numeric'}),value:pnlForMonth(ledger,m).net/100};}),{money:true,label:'Monthly recorded P&L'})}</section><section id="pnl-calendar-host" class="pnl-calendar-host" aria-label="Profit and loss calendar"><div class="pnl-calendar-body">${renderPnlCalendar(ledger,month)}</div><div class="pnl-preview" id="pnl-preview" role="tooltip" hidden></div></section>`;
}
const short=d=>new Date(`${d}T00:00:00`).toLocaleDateString('en-PH',{month:'short',day:'numeric'});
const nice=v=>{if(v<=0)return 1;const p=10**Math.floor(Math.log10(v)),n=v/p;return ([1,1.5,2,2.5,3,4,5,6,8,10].find(s=>n<=s)||10)*p;};
function trend(data,{unit,color,light,label}) {
 if(!data.length)return empty('No daily records','Choose a wider date range.');
 const start=new Date(`${data[0].date}T00:00:00`),days=d=>Math.round((new Date(`${d}T00:00:00`)-start)/864e5);
 const span=days(data.at(-1).date)+1,weekly=span>21,buckets=[];
 data.forEach(r=>{const i=weekly?Math.floor(days(r.date)/7):days(r.date);buckets[i]??={from:r.date,to:r.date,value:0};buckets[i].to=r.date;buckets[i].value+=r.value;});
 const bars=buckets.filter(Boolean),total=data.reduce((s,r)=>s+r.value,0),peak=bars.reduce((a,b)=>b.value>a.value?b:a,bars[0]);
 const fmt=v=>v.toLocaleString('en-PH',{maximumFractionDigits:0}),top=nice(Math.max(...bars.map(b=>b.value),1));
 const W=500,H=200,L=44,R=8,T=12,B=28,cw=(W-L-R)/bars.length,bw=Math.max(4,Math.min(36,cw*0.68)),id=`g-${unit}`;
 const y=v=>T+(H-T-B)*(1-v/top),grid=[0,0.5,1].map(f=>`<line x1="${L}" x2="${W-R}" y1="${y(top*f)}" y2="${y(top*f)}" stroke="#EFE7D6" stroke-dasharray="${f?'3 4':'0'}"/><text x="${L-6}" y="${y(top*f)+4}" text-anchor="end" font-size="10" fill="#8A8270">${fmt(top*f)}</text>`).join('');
 const rects=bars.map((b,i)=>{const x=L+i*cw+(cw-bw)/2,h=Math.max(2,(H-T-B)-(y(b.value)-T));return `<rect x="${x.toFixed(1)}" y="${(H-B-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(6,bw/2)}" fill="url(#${id})"${b===peak?' class="peak"':''}><title>${weekly?`${short(b.from)} – ${short(b.to)}`:short(b.from)}: ${fmt(b.value)} ${unit}</title></rect>`;}).join('');
 const tickLabel=d=>span>180?new Date(`${d}T00:00:00`).toLocaleDateString('en-PH',{month:'short',year:'numeric'}):short(d),last=bars.length-1;
 const ticks=[0,Math.floor(last/2),last].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text x="${i===0?L:i===last?W-R:(L+i*cw+cw/2).toFixed(1)}" y="${H-8}" text-anchor="${i===0?'start':i===last?'end':'middle'}" font-size="10" fill="#8A8270">${tickLabel(i===last?bars[i].to:bars[i].from)}</text>`).join('');
 return `<div class="rd-trend-stats"><div><span>Total</span><b>${fmt(total)} ${unit}</b></div><div><span>Per day</span><b>${fmt(total/span)} ${unit}</b></div><div><span>Busiest ${weekly?'week':'day'}</span><b>${fmt(peak.value)} ${unit}</b></div></div><svg viewBox="0 0 ${W} ${H}" class="rd-trend" role="img" aria-label="${escapeHtml(label)} per ${weekly?'week':'day'}, ${short(data[0].date)} to ${short(data.at(-1).date)}"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${light}"/></linearGradient></defs>${grid}${rects}${ticks}</svg><p class="rd-trend-note">Each bar is one ${weekly?'week':'day'}. Hover a bar for its total.</p>`;
}
function renderBreakdown(items,filters) {
 const selects=['first','second'].map((name,n)=>`<label>Batch ${n+1}<select name="${name}" data-breakdown-select>${items.map((i,index)=>option(i.batch.batch_id,i.batch.batch_name,filters[name]||items[n]?.batch.batch_id||'')).join('')}</select></label>`).join('');
 return `<section class="page-section">${header('Reports','Understand what changed between two flocks.')} ${farmTabs([...FARM_REPORTS,['breakdown','Profit breakdown']],'breakdown','data-report-tab')}<div class="rd-panel"><h2>Profit breakdown</h2><p class="text-mut">Illustrative preview. These bars are not calculated from your farm’s records. The comparison will be connected when detailed attribution is available.</p><div class="rd-action-row">${selects}</div><div class="rd-waterfall" role="img" aria-label="Illustrative waterfall preview, not farm data"><div><i style="height:80px;background:#9ab384"></i><span>Starting profit</span></div><div><i style="height:45px;bottom:80px;background:#e7bf63"></i><span>Sale price</span></div><div><i style="height:30px;bottom:125px;background:#9ab384"></i><span>Weight sold</span></div><div><i style="height:60px;bottom:95px;background:#d3937d"></i><span>Cost changes</span></div><div><i style="height:95px;background:#9ab384"></i><span>Ending profit</span></div></div><p class="farm-footnote">Choose two batches to prepare the view. No explanation or financial attribution is generated yet.</p></div></section>`;
}
