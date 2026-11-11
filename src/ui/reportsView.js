import { datePresets, header, empty, barChart, kpi } from './redesignKit.js';
import { buildPnlLedger, pnlForMonth, shiftMonth } from '../services/pnlCalendar.js';
import { buildFarmReport, FARM_REPORTS } from '../services/farmReports.js';
import { escapeHtml } from './html.js';
import { LABS } from './navigation.js';
import { renderPnlCalendar, attachPnlCalendar } from './pnlCalendarView.js';
import { formatPeso, formatDate, localToday } from '../services/calculations.js';
import { farmTabs,farmPagination,attachFarmPagination,downloadFarmCsv,option } from './farmTable.js';
const num=v=>Number(v||0).toLocaleString('en-PH',{maximumFractionDigits:2});
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
  return `<section class="page-section farm-records-page" aria-labelledby="reports-title"><header class="page-head"><div><h1 id="reports-title">Reports</h1><p class="text-mut">A clear view of your flock, records and farm performance.</p></div><button type="button" class="btn-action" id="report-detailed-export">Export</button><button type="button" class="btn-action" id="rd-print-report">Print</button></header>${farmTabs([...FARM_REPORTS.map(t=>t[0]==='sales'?['sales','Sales']:t),...(LABS?[['breakdown','Profit breakdown']]:[])],tab,'data-report-tab')}${datePresets()}
    <form class="farm-filterbar" id="report-filters">${batchPicker(items,filters.q||'')}<label>Status<select name="status">${option('','All batches',filters.status||'')}${option('Open','Open',filters.status||'')}${option('Closed','Closed',filters.status||'')}</select></label><label>From<input type="date" name="from" value="${escapeHtml(filters.from||'')}"/></label><label>To<input type="date" name="to" value="${escapeHtml(filters.to||'')}" max="${localToday()}"/></label><div class="farm-filter-buttons">${Object.values(filters).some(Boolean)?'<button type="button" class="btn-action" id="report-clear">Clear</button>':''}</div></form>
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
   return `<section class="rd-panel"><h2>Daily feed and deaths</h2><div class="rd-compare-grid">${['feed','deaths'].map(key=>{const data=dates.map(date=>({label:formatDate(date),value:selected.reduce((s,i)=>s+(key==='feed'?(i.feed||[]).filter(f=>!f.deleted_at&&f.entry_date===date).reduce((n,f)=>n+(f.quantity_g!=null?Number(f.quantity_g)/1000:Number(f.quantity_kg)||0),0):(i.mortality||[]).filter(m=>!m.deleted_at&&m.entry_date===date).reduce((n,m)=>n+(Number(m.count)||0),0)),0)}));return `<div><h3>${key==='feed'?'Feed (kg)':'Deaths (birds)'}</h3>${trend(data,key==='feed'?'Feed used per day':'Deaths per day')}</div>`;}).join('')}</div></section>`;
 }
 const ledger=buildPnlLedger(items.filter(i=>(!filters.q||i.batch.batch_name.toLowerCase()===filters.q.toLowerCase())&&(!filters.status||i.batch.status===filters.status)),expenses),month=(filters.to||localToday()).slice(0,7),now=pnlForMonth(ledger,month),previous=pnlForMonth(ledger,shiftMonth(month,-1));
 return `<section class="rd-panel"><h2>Recorded P&L by month</h2><div class="rd-kpis">${kpi('Selected month',formatPeso(now.net/100))}${kpi('Previous month',formatPeso(previous.net/100))}${kpi('Change',formatPeso((now.net-previous.net)/100))}</div>${barChart(Array.from({length:6},(_,n)=>{const m=shiftMonth(month,n-5);return {label:new Date(m+'-01T00:00:00').toLocaleDateString('en-PH',{month:'short',year:'numeric'}),value:pnlForMonth(ledger,m).net/100};}),{money:true,label:'Monthly recorded P&L'})}</section><section id="pnl-calendar-host" class="pnl-calendar-host" aria-label="Profit and loss calendar"><div class="pnl-calendar-body">${renderPnlCalendar(ledger,month)}</div><div class="pnl-preview" id="pnl-preview" role="tooltip" hidden></div></section>`;
}
function trend(data,label) {
 if(!data.length)return empty('No daily records','Choose a wider date range.');
 const max=Math.max(...data.map(r=>r.value),1),points=data.map((r,i)=>`${20+(i/(data.length-1||1))*460},${150-r.value/max*120}`).join(' ');
 return `<svg viewBox="0 0 500 190" class="rd-trend" role="img" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}: ${data.length} recorded days</title><path d="M20 20V150H480" fill="none" stroke="#d9cdb5"/><polyline points="${points}" fill="none" stroke="#9b711f" stroke-width="3" stroke-linejoin="round"/>${data.map((r,i)=>`<circle cx="${20+i/(data.length-1||1)*460}" cy="${150-r.value/max*120}" r="3" fill="#9b711f"><title>${escapeHtml(r.label)}: ${r.value.toFixed(1)}</title></circle>`).join('')}<text x="20" y="177" fill="#6b6457" font-size="11">${escapeHtml(data[0].label)}</text><text x="480" y="177" text-anchor="end" fill="#6b6457" font-size="11">${escapeHtml(data.at(-1).label)}</text><text x="20" y="14" fill="#6b6457" font-size="11">${max.toFixed(1)}</text></svg>`;
}
function renderBreakdown(items,filters) {
 const selects=['first','second'].map((name,n)=>`<label>Batch ${n+1}<select name="${name}" data-breakdown-select>${items.map((i,index)=>option(i.batch.batch_id,i.batch.batch_name,filters[name]||items[n]?.batch.batch_id||'')).join('')}</select></label>`).join('');
 return `<section class="page-section">${header('Reports','Understand what changed between two flocks.')} ${farmTabs([...FARM_REPORTS,['breakdown','Profit breakdown']],'breakdown','data-report-tab')}<div class="rd-panel"><h2>Profit breakdown</h2><p class="text-mut">Illustrative preview. These bars are not calculated from your farm’s records. The comparison will be connected when detailed attribution is available.</p><div class="rd-action-row">${selects}</div><div class="rd-waterfall" role="img" aria-label="Illustrative waterfall preview, not farm data"><div><i style="height:80px;background:#9ab384"></i><span>Starting profit</span></div><div><i style="height:45px;bottom:80px;background:#e7bf63"></i><span>Sale price</span></div><div><i style="height:30px;bottom:125px;background:#9ab384"></i><span>Weight sold</span></div><div><i style="height:60px;bottom:95px;background:#d3937d"></i><span>Cost changes</span></div><div><i style="height:95px;background:#9ab384"></i><span>Ending profit</span></div></div><p class="farm-footnote">Choose two batches to prepare the view. No explanation or financial attribution is generated yet.</p></div></section>`;
}
