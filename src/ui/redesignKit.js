import { escapeHtml as esc } from './html.js';
import { formatPeso, formatDate, localToday } from '../services/calculations.js';
import { IMPORT_ACCEPT } from '../services/fileImport.js';
export const chicken = (mood='sleepy',className='') => `<img class="rd-chicken ${className}" src="/images/chickens/chicken-${mood}.svg" alt="${mood} chicken" width="240" height="240"/>`;
export const pill = (text,tone='neutral') => `<span class="rd-pill ${tone}">${esc(text)}</span>`;
export const header = (title,description='',action='') => `<header class="page-head"><div><h1>${esc(title)}</h1>${description?`<p class="text-mut">${esc(description)}</p>`:''}</div>${action}</header>`;
/** "Import file": logs from Excel, CSV, PDF or a photo, reviewed before anything is saved (main.js wires it). */
export const importButton = () => `<button type="button" class="btn-action" data-import-file title="Add logs from an Excel, CSV or PDF file, or a photo. You review them before anything is saved.">Import file</button><input type="file" accept="${IMPORT_ACCEPT}" data-import-input hidden/>`;
export const quickButton =(tab,label,batchId='') => `<button type="button" class="btn-action primary" data-quick-entry="${tab}" data-batch-id="${esc(batchId)}">${esc(label)}</button>`;
export const empty = (title,text,action='') => `<div class="rd-empty">${chicken()}<h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;
export const kpi = (label,value,note='',tone='',fullValue=value) => `<div class="rd-kpi ${tone}"><span>${esc(label)}</span><strong title="${esc(String(fullValue))}">${esc(String(value))}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`;
export const moneyCompact = (value,digits) => {
 const places=digits??(Math.abs(value)>=1000000?2:1);
 return Math.abs(value)<10000?formatPeso(value):new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',notation:'compact',maximumFractionDigits:places}).format(value);
};

export function table(headers,rows,footer='',className='') {
 return `<div class="farm-table-surface"><table class="farm-data-table ${className}"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>`<td data-label="${esc(headers[i])}">${v}</td>`).join('')}</tr>`).join('')}</tbody>${footer?`<tfoot>${footer}</tfoot>`:''}</table></div>`;
}
export function barChart(rows,{label='Recorded values',money=false}={}) {
 const max=Math.max(...rows.map(r=>Math.abs(r.value)),1);
 return `<div class="rd-bars" role="img" aria-label="${esc(label)}">${rows.map(r=>`<div class="rd-bar-row"><span>${esc(r.label)}</span><div class="rd-bar-track"><i class="${r.value<0?'negative':''}" style="width:${Math.max(r.value===0?0:1,Math.abs(r.value)/max*100)}%"></i></div><b>${money?formatPeso(r.value):Number(r.value).toLocaleString('en-PH',{maximumFractionDigits:1})}</b></div>`).join('')}</div>`;
}
export function datePresets(attribute='data-date-preset') {
 return `<div class="rd-date-presets">${[['today','Today'],['month','This month'],['last-month','Last month'],['all','All dates'],['custom','Custom']].map(([id,label])=>`<button type="button" class="btn-action" ${attribute}="${id}">${label}</button>`).join('')}</div>`;
}
export function presetRange(preset,today=localToday()) {
 const [year,month]=today.split('-').map(Number);
 if(preset==='today')return {from:today,to:today};
 if(preset==='month')return {from:today.slice(0,7)+'-01',to:today};
 if(preset==='last-month'){const end=new Date(Date.UTC(year,month-1,0));return {from:end.toISOString().slice(0,7)+'-01',to:end.toISOString().slice(0,10)};}
 return {from:'',to:''};
}
/** Enhancement of rendered tables/filters. No record changes are made here. */
export function attachRedesignKit(container) {
 container.querySelectorAll('table').forEach(t=>{
  const heads=[...t.querySelectorAll('thead th')].map(h=>h.textContent.trim());
  t.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((cell,i)=>{if(!cell.hasAttribute('colspan'))cell.dataset.label=heads[i]||'';}));
  if(t.classList.contains('board-table'))return;
  const allRows=[...t.tBodies[0]?.rows||[]].filter(r=>!r.querySelector('[colspan]'));
  if(allRows.length>25) {
    let current=1,size=10;
    const pager=document.createElement('div');pager.className='farm-pagination rd-local-pagination';
    pager.innerHTML='<span data-range></span><div class="farm-page-buttons"><button type="button" class="btn-action" data-prev aria-label="Previous records">‹</button><span data-page></span><button type="button" class="btn-action" data-next aria-label="Next records">›</button></div><label>Rows<select aria-label="Records per page"><option>10</option><option>25</option><option>50</option></select></label>';
    (t.closest('.farm-table-surface,.table-wrap,.log-table-wrap')||t).after(pager);
    const draw=()=>{const rows=[...t.tBodies[0].rows],pages=Math.ceil(rows.length/size);current=Math.max(1,Math.min(current,pages));rows.forEach((r,i)=>r.hidden=i<(current-1)*size||i>=current*size);pager.querySelector('[data-range]').textContent=`${(current-1)*size+1}–${Math.min(current*size,rows.length)} of ${rows.length} records`;pager.querySelector('[data-page]').textContent=`Page ${current} of ${pages}`;pager.querySelector('[data-prev]').disabled=current===1;pager.querySelector('[data-next]').disabled=current===pages;};
    pager.querySelector('[data-prev]').onclick=()=>{current--;draw();};pager.querySelector('[data-next]').onclick=()=>{current++;draw();};pager.querySelector('select').onchange=e=>{size=Number(e.target.value);current=1;draw();};t.addEventListener('cp-table-sort',()=>{current=1;draw();});draw();
  }

  t.querySelectorAll('thead th').forEach((th,index)=>{
   if(!th.textContent.trim() || /Action|Menu/.test(th.textContent))return;
   th.tabIndex=0;th.setAttribute('aria-sort','none');th.title='Sort by '+th.textContent;
   const sort=()=>{const direction=th.getAttribute('aria-sort')==='ascending'?-1:1;const body=t.tBodies[0];const rows=[...body.rows].filter(r=>!r.querySelector('[colspan]'));rows.sort((a,b)=>{const av=a.cells[index]?.textContent.trim()||'',bv=b.cells[index]?.textContent.trim()||'';const n=v=>Number(v.replace(/[₱,%\s]/g,''));return direction*(av!==''&&bv!==''&&Number.isFinite(n(av))&&Number.isFinite(n(bv))?n(av)-n(bv):av.localeCompare(bv,undefined,{numeric:true}));});t.querySelectorAll('thead th').forEach(h=>h.setAttribute('aria-sort','none'));th.setAttribute('aria-sort',direction===1?'ascending':'descending');rows.forEach(r=>body.append(r));t.dispatchEvent(new Event('cp-table-sort'));};
   th.addEventListener('click',sort);th.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();sort();}});
  });
 });
 container.querySelectorAll('.farm-filterbar,.log-filters').forEach(form=>{
  const toggle=document.createElement('button');toggle.className='btn-action rd-filter-toggle';toggle.type='button';toggle.textContent='Filters';toggle.setAttribute('aria-expanded','false');form.before(toggle);toggle.addEventListener('click',()=>{const expanded=form.classList.toggle('filters-open');toggle.setAttribute('aria-expanded',String(expanded));});
 });
 container.querySelectorAll('[data-date-preset]').forEach(btn=>btn.addEventListener('click',()=>{
  const form=btn.closest('section')?.querySelector('.farm-filterbar');if(!form)return;
  if(btn.dataset.datePreset==='custom'){form.classList.add('filters-open');form.querySelector('[name="from"]')?.focus();return;}
  const range=presetRange(btn.dataset.datePreset);Object.entries(range).forEach(([key,value])=>{const input=form.querySelector(`[name="${key}"]`);if(input)input.value=value;});form.requestSubmit();
 }));
}
