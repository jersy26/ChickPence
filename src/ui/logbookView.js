import { datePresets, importButton } from './redesignKit.js';
/**
 * logbookView.js
 * One log of every entry (feed, deaths, sales, farm expenses), in the layout
 * of the draft's inventory log: filters on top, a read-only table, CSV export.
 */

import { filterActive, formatPeso, formatDate, formatNumber } from '../services/calculations.js';
import { escapeHtml } from './html.js';
import { farmTabs, farmPagination, attachFarmPagination, downloadFarmCsv, option } from './farmTable.js';

export const LOG_TYPES = ['Feed', 'Deaths', 'Sale', 'Expense'];

/** Every active entry as one row, newest change first (pure). */
export function buildLogRows(batchesData = [], expenses = []) {
  const rows = [];
  for (const { batch, feed = [], mortality = [], sales = [] } of batchesData) {
    if (!batch) continue;
    const base = { batchId: batch.batch_id, batch: batch.batch_name, closed: batch.status === 'Closed' };
    for (const f of filterActive(feed)) {
      const kg = f.quantity_g !== undefined ? (Number(f.quantity_g) || 0) / 1000 : Number(f.quantity_kg) || 0;
      rows.push({ ...base, id: f.feed_log_id, type: 'Feed', date: f.entry_date, changed: f.updated_at, change: `+${formatNumber(kg, 2)} kg${f.feed_type ? ` ${f.feed_type}` : ''}`, csv: kg, actor: f.created_by_name || f.created_by || f.user_id || '' });
    }
    for (const m of filterActive(mortality)) {
      const n = Number(m.count) || 0;
      rows.push({ ...base, id: m.mortality_id, type: 'Deaths', date: m.entry_date, changed: m.updated_at, change: n === 0 ? 'No deaths' : `${n} bird${n === 1 ? '' : 's'}`, csv: n, actor: m.created_by_name || m.created_by || m.user_id || '' });
    }
    for (const s of filterActive(sales)) {
      rows.push({ ...base, id: s.sale_id, type: 'Sale', date: s.sale_date, changed: s.updated_at, change: `${Number(s.quantity_sold) || 0} heads · ${formatNumber(s.weight_kg, 2)} kg · ${formatPeso(s.total_amount)}`, csv: Number(s.total_amount) || 0, buyer: s.buyer_name, actor: s.created_by_name || s.created_by || s.user_id || '' });
    }
  }
  for (const e of filterActive(expenses)) {
    const total = ((Number(e.feed_centavos) || 0) + (Number(e.other_centavos) || 0)) / 100;
    rows.push({ id: e.expense_id, batchId: null, batch: 'Farm (shared)', closed: false, type: 'Expense', date: e.entry_date, changed: e.updated_at, change: formatPeso(total), csv: total, actor: e.created_by_name || e.created_by || e.user_id || '' });
  }
  // Newest change first; entries changed at the same moment (an import, the demo data) by record date, newest first
  const key = (r) => `${r.changed || ''}|${r.date || ''}`;
  return rows.sort((a, b) => (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0));
}

export function filterLogRows(rows, { batchId = '', type = '', from = '', to = '', q = '', actor = '' } = {}) {
  return rows.filter((r) =>
    (!q || `${r.batch} ${r.id} ${r.change} ${r.buyer || ''}`.toLowerCase().includes(q.toLowerCase())) &&
    (!actor || r.actor === actor) &&
    (!batchId || r.batchId === batchId || (batchId === 'farm' && r.batchId === null)) &&
    (!type || r.type === type) &&
    (!from || r.date >= from) &&
    (!to || r.date <= to));
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function logRowsToCsv(rows) {
  const head = ['Record date', 'Last changed', 'Batch', 'Type', 'Change', 'Value', 'Buyer', 'Entered by', 'Status'];
  const lines = rows.map((r) => [r.date, r.changed || '', r.batch, r.type, r.change, r.csv, r.buyer || '', '', 'Saved'].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n');
}


function changedLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function renderLogbook(rows, batches, filters = {}, limit = 50, {tab='entries',page=1,size=10,role='owner'}={}) {
  const shown=filterLogRows(rows,filters),pages=Math.max(1,Math.ceil(shown.length/size)),current=Math.min(page,pages);
  const tabs=[];
  const body=shown.slice((current-1)*size,current*size).map(r=>`<tr><td class="farm-time">${changedLabel(r.changed)}</td><td>${formatDate(r.date,true)}</td><td><b>${escapeHtml(r.batch)}</b>${r.closed?' <span class="farm-status">Closed</span>':''}<small class="farm-record-id">${escapeHtml(String(r.id))}</small></td><td><span class="log-type type-${r.type.toLowerCase()}">${escapeHtml(r.type)}</span></td><td>${escapeHtml(r.change)}${r.buyer?`<small class="farm-secondary">${escapeHtml(r.buyer)}</small>`:''}${r.error?`<small class="text-bad">${escapeHtml(r.error)}</small>`:''}</td><td>${escapeHtml(r.actor||'Not recorded')}</td><td><span class="farm-status ${r.error?'danger':''}">${escapeHtml(r.status||'Saved')}</span></td>${tab==='entries'?`<td><button type="button" class="farm-record-link" data-request-correction="${escapeHtml(r.id)}">Request correction</button></td>`:''}</tr>`).join('');
  const span=tab==='entries'?8:7;
  const types=role==='staff'?['Feed','Deaths']:[...new Set([...LOG_TYPES,...rows.map(r=>r.type)])];
  return `<section class="page-section farm-records-page" aria-labelledby="logbook-title"><header class="page-head"><div><h1 id="logbook-title">Logbook</h1><p class="text-mut">Your daily farm records, in one place.</p></div>${role==='staff'?'':`<div class="rd-action-row">${importButton()}</div>`}</header>${datePresets()}
    <form class="farm-filterbar" id="log-filters"><label class="farm-filter-grow">Search<input type="search" name="q" value="${escapeHtml(filters.q||'')}" placeholder="Search batch or buyer"/></label><label>Batch<select name="batchId">${option('','All batches',filters.batchId||'')}${role==='staff'?'':option('farm','Farm expenses',filters.batchId||'')}${batches.map(b=>option(b.batch_id,b.batch_name,filters.batchId||'')).join('')}</select></label><label>Type<select name="type">${option('','All types',filters.type||'')}${types.map(t=>option(t,t,filters.type||'')).join('')}</select></label><label>From<input type="date" name="from" value="${escapeHtml(filters.from||'')}"/></label><label>To<input type="date" name="to" value="${escapeHtml(filters.to||'')}"/></label><div class="farm-filter-buttons">${Object.values(filters).some(Boolean)?'<button type="button" class="btn-action" id="btn-log-clear">Clear</button>':''}<button type="button" class="btn-action" id="btn-log-csv">Export CSV</button></div></form>
    <p class="farm-scroll-hint">Swipe the table sideways to see all columns.</p><div class="farm-table-surface"><table class="farm-data-table"><thead><tr><th scope="col">${tab==='sync'?'Queued':'Last changed'}</th><th scope="col">Record date</th><th scope="col">Batch / record</th><th scope="col">Type</th><th scope="col">${tab==='activity'?'Latest recorded value':'Entry'}</th><th scope="col">Entered by</th><th scope="col">Status</th>${tab==='entries'?'<th scope="col">Action</th>':''}</tr></thead><tbody>${body||`<tr><td colspan="${span}" class="farm-empty">${tab==='sync'?'No changes are waiting to upload.':'No entries match these filters.'}</td></tr>`}</tbody></table></div>${shown.length>size?farmPagination(shown.length,current,size):''}
    <p class="farm-footnote">${tab==='sync'?'Pending changes on this device leave this list after uploading.':'Request a correction with a reason when a saved entry needs to change.'}</p></section>`;
}

export function attachLogbookListeners(container, rows, filters, onFilter, onMore, {onTab,onPage,onSize,onRequest}={}) {
  const form=container.querySelector('#log-filters');
  form?.addEventListener('submit',e=>{e.preventDefault();const values=Object.fromEntries(new FormData(form));if(values.from && values.to && values.from>values.to){form.querySelector('[name="from"]').setCustomValidity('From must be on or before To.');form.reportValidity();return;}onFilter(values);});
  let timer;
  form?.addEventListener('input', e=>{form.querySelector('[name="from"]').setCustomValidity('');clearTimeout(timer);const name=e.target.name,caret=e.target.selectionStart;timer=setTimeout(()=>{const values=Object.fromEntries(new FormData(form));if(values.from&&values.to&&values.from>values.to)return;onFilter(values);setTimeout(()=>{const next=document.querySelector(`#log-filters [name="${name}"]`);next?.focus();if(caret!=null)next?.setSelectionRange?.(caret,caret);},0);},e.target.type==='search'?300:0);});
  container.querySelector('#btn-log-clear')?.addEventListener('click',()=>onFilter({}));
  container.querySelectorAll('[data-log-tab]').forEach(btn=>btn.addEventListener('click',()=>onTab?.(btn.dataset.logTab)));
  attachFarmPagination(container,page=>onPage?.(page),size=>onSize?.(size));
  container.querySelectorAll('[data-request-correction]').forEach(btn=>btn.addEventListener('click',()=>onRequest?.(btn.dataset.requestCorrection)));
  container.querySelector('#btn-log-csv')?.addEventListener('click',()=>downloadFarmCsv('chickpence-logs.csv',['Record date','Last changed','Batch','Type','Entry','Entered by','Status'],filterLogRows(rows,filters).map(r=>[r.date,r.changed||'',r.batch,r.type,r.change,r.actor||'',r.status||'Saved'])));
}
