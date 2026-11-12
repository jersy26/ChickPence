import { buildPnlLedger, pnlForMonth, batchPerformanceThrough, monthDates, shiftMonth } from '../services/pnlCalendar.js';
import { localToday, formatPeso, formatDate } from '../services/calculations.js';
import { escapeHtml as esc } from './html.js';
const money = c => formatPeso(c / 100);
const compact = c => `${c < 0 ? '−' : '+'}${Math.abs(c/100) >= 1000 ? (Math.abs(c/100)/1000).toFixed(1)+'k' : Math.abs(c/100).toFixed(0)}`;
const monthLabel = month => new Date(month+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const dateLabel = date => new Date(date+'T00:00:00Z').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
const tone = net => net > 0 ? 'pnl-positive' : net < 0 ? 'pnl-negative' : 'pnl-neutral';

export function renderPnlCalendar(ledger, month = localToday().slice(0,7)) {
  const totals = pnlForMonth(ledger, month), dates = monthDates(month);
  const monthDays = dates.filter(Boolean).map(d => ledger.days.get(d)).filter(Boolean);
  const maxAbs = Math.max(...monthDays.map(d => Math.abs(d.net)), 1);
  const gains = monthDays.filter(d => d.net > 0).length, losses = monthDays.filter(d => d.net < 0).length;
  return `<div class="pnl-calendar v2" data-month="${month}">
    <div class="pnl-calendar-head"><div><h2>Profit calendar</h2><span class="pnl-sub">Recorded profit and loss, day by day</span></div><div class="pnl-head-controls"><div class="pnl-month-nav"><button type="button" data-month-step="-1" aria-label="Previous month">‹</button><span aria-live="polite">${monthLabel(month)}</span><button type="button" data-month-step="1" aria-label="Next month">›</button></div><button type="button" class="pnl-jump" data-pnl-today>Today</button><button type="button" class="pnl-jump" data-pnl-latest>Latest</button></div></div>
    <div class="pnl-summary ${tone(totals.net)}"><div class="pnl-month-total ${tone(totals.net)}">${money(totals.net)}<span>${totals.net < 0 ? 'Loss' : totals.net > 0 ? 'Profit' : 'Net'} in ${monthLabel(month)}</span></div><div class="pnl-mini"><span><small>Sales</small><b>${money(totals.revenue)}</b></span><span><small>Costs</small><b>${money(totals.cost)}</b></span><span class="gain"><small>Profit days</small><b>${gains}</b></span><span class="loss"><small>Loss days</small><b>${losses}</b></span></div></div>
    <div class="pnl-weekdays" aria-hidden="true">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="pnl-days" aria-label="${monthLabel(month)} daily profit and loss">
    ${dates.map(date => {
      if (!date) return '<span class="pnl-day-blank"></span>';
      const day=ledger.days.get(date), a=day ? (0.25 + 0.75 * Math.abs(day.net) / maxAbs).toFixed(2) : 0;
      return `<button type="button" class="pnl-day ${day ? tone(day.net) : 'pnl-empty-day'} ${date === localToday() ? 'pnl-today' : ''}" style="--a:${a}" data-pnl-date="${date}" aria-label="${esc(dateLabel(date))}: ${day ? money(day.net)+' recorded P&L' : 'No financial entries'}. View day details." ${date === localToday() ? 'aria-current="date"' : ''}><span>${Number(date.slice(-2))}</span>${day ? `<small>${compact(day.net)}</small>` : ''}</button>`;
    }).join('')}</div>
    <div class="pnl-legend"><span><i class="pnl-dot positive"></i>Profit</span><span><i class="pnl-dot negative"></i>Loss</span><span><i class="pnl-dot neutral"></i>No entries</span><span class="pnl-legend-note">Darker = bigger amount · tap a day for details</span></div>
    ${!totals.days ? '<p class="pnl-no-entries">No financial entries this month.</p>' : ''}
  </div>`;
}

function previewHtml(ledger, date) {
  const day=ledger.days.get(date);
  return `<strong>${formatDate(date,true)}</strong><p>${day ? `${money(day.net)} recorded P&amp;L` : 'No financial entries'}</p>${day ? `<div class="pnl-preview-totals"><span>Sales ${money(day.revenue)}</span><span>Costs ${money(day.cost)}</span></div>${[...day.batches.values()].slice(0,4).map(row=>`<div class="pnl-preview-row"><span>${esc(row.name)}</span><b>${money(row.net)}</b></div>`).join('')}${day.batches.size>4?`<small>+ ${day.batches.size-4} more batches</small>`:''}` : '<small>Click to review batch performance on this date.</small>'}`;
}

function openDay(ledger, date, trigger, onNavigate) {
  const day=ledger.days.get(date);
  const relevant=ledger.batches.filter(item => item.batch.start_date <= date && (day?.batches.has(item.batch.batch_id) || !item.batch.end_date || item.batch.end_date >= date));
  const dialog=document.createElement('dialog');
  dialog.className='pnl-dialog';
  dialog.setAttribute('aria-labelledby','pnl-dialog-title');
  dialog.innerHTML=`<div class="pnl-detail-head"><div><h2 id="pnl-dialog-title">${esc(dateLabel(date))}</h2><p>Your flock’s day, in numbers.</p></div><button type="button" class="pnl-close" aria-label="Close day details">×</button></div>
    <div class="pnl-detail-totals"><div><span>Recorded P&amp;L</span><strong class="${tone(day?.net||0)}">${money(day?.net||0)}</strong></div><div><span>Sales</span><strong>${money(day?.revenue||0)}</strong></div><div><span>Costs</span><strong>${money(day?.cost||0)}</strong></div></div>
    <p class="pnl-basis">Sales on the sale date minus chick purchases on the batch start date and allocated feed/other costs on the expense date. This is recorded daily P&amp;L, not final batch profit.</p>
    ${!day ? '<p class="pnl-empty">No financial entries for this day. Any active batches are shown below.</p>' : `<div class="pnl-cost-breakdown"><span>Chicks <b>${money(day.chicks)}</b></span><span>Feed <b>${money(day.feed)}</b></span><span>Other <b>${money(day.other)}</b></span></div>`}
    <h3>Batch performance</h3><p class="pnl-detail-caption">Day contributions and cumulative performance through ${formatDate(date,true)}.</p>
    <div class="pnl-detail-batches">${relevant.map(item=> {
      const row=day?.batches.get(item.batch.batch_id), cumulative=batchPerformanceThrough(ledger,item,date);
      return `<article class="pnl-detail-batch"><div class="pnl-batch-heading"><h4>${esc(item.batch.batch_name)}</h4><button type="button" data-pnl-batch="${esc(item.batch.batch_id)}" data-pnl-batch-status="${esc(item.batch.status)}">Open batch ↗</button></div>
        <div class="pnl-batch-day"><span>Day P&amp;L <b class="${tone(row?.net||0)}">${money(row?.net||0)}</b></span><span>Sales <b>${money(row?.revenue||0)}</b></span><span>Costs <b>${money(row?.cost||0)}</b></span></div>
        <div class="pnl-batch-cumulative"><span>Cumulative P&amp;L <b>${money(cumulative.net)}</b></span><span>Live birds <b>${cumulative.live.toLocaleString()}</b></span><span>Sold <b>${cumulative.sold.toLocaleString()}</b></span><span>Mortality <b>${cumulative.mortality.toLocaleString()}</b></span></div></article>`;
    }).join('') || '<p class="pnl-empty">No batches active or posting transactions on this date.</p>'}</div>`;
  document.body.append(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();if(trigger.isConnected) trigger.focus();});
  dialog.querySelector('.pnl-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.querySelectorAll('[data-pnl-batch]').forEach(btn=>btn.addEventListener('click',()=>{dialog.close();onNavigate(btn.dataset.pnlBatchStatus==='Closed'?'summary':'batches',btn.dataset.pnlBatch);}));
  dialog.showModal();
}

export function attachPnlCalendar(container, items, expenses, onNavigate) {
  const host=container.querySelector('#pnl-calendar-host');
  if(!host) return;
  const ledger=buildPnlLedger(items,expenses);
  const preview=host.querySelector('.pnl-preview');
  const body=host.querySelector('.pnl-calendar-body');
  const hide=()=>{ preview.hidden=true; host.querySelectorAll('[aria-describedby="pnl-preview"]').forEach(b=>b.removeAttribute('aria-describedby')); };
  const show=btn=>{
    if(!btn) return;
    preview.innerHTML=previewHtml(ledger,btn.dataset.pnlDate); preview.hidden=false;
    btn.setAttribute('aria-describedby','pnl-preview');
    const r=btn.getBoundingClientRect();
    const h=host.getBoundingClientRect();
    preview.style.left=`${Math.max(12,Math.min(innerWidth-292,r.left+r.width/2-140))-h.left}px`;
    preview.style.top=`${(r.top>225 ? r.top-preview.offsetHeight-10 : r.bottom+10)-h.top}px`;
  };
  const change=month=>{hide();body.innerHTML=renderPnlCalendar(ledger,month);};
  host.addEventListener('click',e=>{
    const date=e.target.closest('[data-pnl-date]');
    if(date){hide();openDay(ledger,date.dataset.pnlDate,date,onNavigate);return;}
    const step=e.target.closest('[data-month-step]');
    if(step){change(shiftMonth(body.querySelector('[data-month]').dataset.month,Number(step.dataset.monthStep)));return;}
    if(e.target.closest('[data-pnl-today]')) change(localToday().slice(0,7));
    if(e.target.closest('[data-pnl-latest]')) { const dates=[...ledger.days.keys()].sort(); change((dates.at(-1)||localToday()).slice(0,7)); }
  });
  host.addEventListener('mouseover',e=>{const btn=e.target.closest('[data-pnl-date]');if(btn && !btn.contains(e.relatedTarget)) show(btn);});
  host.addEventListener('mouseout',e=>{const btn=e.target.closest('[data-pnl-date]');if(btn && !btn.contains(e.relatedTarget)) hide();});
  host.addEventListener('focusin',e=>show(e.target.closest('[data-pnl-date]')));
  host.addEventListener('focusout',hide);
  host.addEventListener('keydown',e=>{
    if(e.key==='Escape')hide();
    const btn=e.target.closest('[data-pnl-date]');if(!btn)return;
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];
    if(delta){e.preventDefault();const d=new Date(btn.dataset.pnlDate+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+delta);const date=d.toISOString().slice(0,10);if(date.slice(0,7)!==body.querySelector('[data-month]').dataset.month)change(date.slice(0,7));host.querySelector(`[data-pnl-date="${date}"]`)?.focus();}
  });
  // Hide scroll-displaced previews without retaining page-level handlers on redraw.
  host.addEventListener('wheel',hide,{passive:true});
}
