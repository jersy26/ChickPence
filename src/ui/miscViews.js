import { header, empty, chicken } from './redesignKit.js';
import { loadPreviewUsers } from './usersView.js';
import { readPreview, writePreview } from './previewState.js';
/**
 * miscViews.js
 * Team task board, Settings, and the pages for features planned next.
 */

import { buildDailyTasks } from '../services/dailyTasks.js';
import { addDays } from '../services/guidedQuestions.js';
import { formatDate } from '../services/calculations.js';
import { roleLabel } from '../services/permissions.js';
import { LABS } from './navigation.js';
import { escapeHtml } from './html.js';

/** Done/total for each of the last `days` days (pure). */
export function taskHistory({ openBatchesData, expenses, today, marks, dueTime, days = 7 }) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const r = buildDailyTasks({ openBatchesData, expenses, today: date, now: i === 0 ? null : '23:59', dueTime, marks });
    out.push({ date, done: r.done, total: r.total, tasks: r.tasks });
  }
  return out;
}

export function renderTeamBoard(history, todayResult) {
  const todayDate = history[history.length - 1]?.date;
  const state = (t, date) => !t ? 'na' : t.done ? 'done' : date === todayDate ? (t.overdue ? 'missed' : 'due') : 'missed';
  const symbol = { done: '✓', missed: '✕', due: '•' }, word = { done: 'Recorded', missed: 'Missed', due: 'Due today' };
  const cell = (t,date) => { const s = state(t, date); return `<td class="board-cell ${s}${date===todayDate?' is-today':''}" title="${t ? word[s] : 'No task'}">${t?`<button type="button" data-entry-date="${date}" data-quick-entry="${t.type==='feed'?'Feed':t.type==='deaths'?'Mortality':'Expenses'}" data-batch-id="${escapeHtml(t.batchId||'')}" aria-label="${escapeHtml(t.label)}, ${formatDate(date)}: ${word[s]}">${symbol[s]}</button>`:''}</td>`; };
  const taskIds = [...new Set(history.flatMap((d) => d.tasks.map((t) => t.id)))];
  const labelOf = new Map(history.flatMap((d) => d.tasks.map((t) => [t.id, t.label])));
  const people=loadPreviewUsers().filter(p=>p.role==='staff'&&p.status==='active');
  const belongs=(task,p)=>task.type==='receipts'?p.permissions?.includes('record.expense'):p.batches==='All'||String(p.batches||'').split(',').some(name=>name.trim()&&task.label.includes(name.trim()));
  const assigned=id=>{const task=history.flatMap(d=>d.tasks).find(t=>t.id===id);return people.filter(p=>belongs(task,p)).map(p=>p.name).join(', ')||'Not assigned';};
  const rows = taskIds.map((id) => `<tr><th scope="row"><b>${escapeHtml(labelOf.get(id))}</b><small>${escapeHtml(assigned(id))}</small></th>${history.map((d) => cell(d.tasks.find((t) => t.id === id),d.date)).join('')}</tr>`).join('');
  const missed = history.slice(0, -1).reduce((s, d) => s + (d.total - d.done), 0);
  const weekDone = history.reduce((s, d) => s + d.done, 0), weekTotal = history.reduce((s, d) => s + d.total, 0), weekPct = weekTotal ? Math.round(weekDone / weekTotal * 100) : 0;
  const dayName = (date, opts) => new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', opts);
  const spark = history.map((d) => { const r = d.total ? d.done / d.total : 0; return `<i class="${r >= 0.8 ? 'good' : r >= 0.5 ? 'mid' : 'bad'}" style="height:${Math.max(8, r * 100).toFixed(0)}%" title="${formatDate(d.date)}: ${d.done} of ${d.total}"></i>`; }).join('');
  const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const personCard = (p) => {
    const todayTasks = todayResult.tasks.filter((t) => belongs(t, p)), done = todayTasks.filter((t) => t.done).length, total = todayTasks.length;
    const pMissed = history.slice(0, -1).flatMap((d) => d.tasks).filter((t) => belongs(t, p) && !t.done).length, allDone = total > 0 && done === total;
    return `<div class="rd-person ${allDone ? 'is-done' : 'is-due'}"><span class="rd-avatar" aria-hidden="true">${escapeHtml(initials(p.name))}</span><div class="rd-person-main"><b>${escapeHtml(p.name)}</b><span class="rd-person-batch">${escapeHtml(p.batches || 'No batches')}</span><span class="rd-missed-chip ${pMissed ? 'bad' : 'good'}">${pMissed ? `${pMissed} missed this week` : 'Nothing missed this week'}</span></div><div class="home-ring live no-limit rd-person-ring ${allDone ? 'is-done' : ''}" style="--p:${total ? (done / total * 100).toFixed(0) : 0}" role="img" aria-label="${done} of ${total} done today"><span class="home-flock-big-num">${done}/${total}</span><span class="home-flock-big-label">today</span></div></div>`;
  };
  return `<section class="page-section" aria-labelledby="team-title">
    <div class="page-head"><div><h1 id="team-title">Task board</h1><p class="text-mut">Who recorded what over the last 7 days. Tap a square to open that day's entry.</p></div></div>
    <div class="rd-team-summary">
      <div class="rd-team-tile today"><span>Done today</span><strong>${todayResult.done} of ${todayResult.total}</strong><div class="todo-progress"><i style="width:${todayResult.total ? todayResult.done / todayResult.total * 100 : 0}%"></i></div></div>
      <div class="rd-team-tile ${todayResult.overdue ? 'bad' : 'good'}"><span>Overdue today</span><strong>${todayResult.overdue}</strong><small>${todayResult.overdue ? 'Past the due time and not recorded' : 'Nothing overdue'}</small></div>
      <div class="rd-team-tile week ${weekPct >= 80 ? 'good' : weekPct >= 50 ? '' : 'bad'}"><div><span>Last 7 days</span><strong>${weekPct}% done</strong><small>${missed} missed in the past 6 days</small></div><div class="rd-spark" role="img" aria-label="Daily completion, last 7 days">${spark}</div></div>
    </div>
    ${people.length ? `<div class="rd-team-people">${people.map(personCard).join('')}</div>` : ''}
    <div class="card-box log-table-wrap rd-board-wrap">
      <table class="log-table board-table">
        <thead><tr><th>Task</th>${history.map((d) => `<th class="${d.date === todayDate ? 'is-today' : ''}"><span>${dayName(d.date, { weekday: 'short' })}</span><b>${dayName(d.date, { day: 'numeric' })}</b></th>`).join('')}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${history.length + 1}" class="text-mut">No open batches.</td></tr>`}</tbody>
      </table>
      <p class="rd-board-legend"><span class="board-key done">✓</span>Recorded <span class="board-key missed">✕</span>Missed <span class="board-key due">•</span>Due today</p>
    </div>
  </section>`;
}

export function renderSettings(settings,user,role,tab='profile') {
 const scope=user?.id,profile=readPreview(scope,'profile',{});
 const selected=role==='staff'?'profile':tab;
 const titles={profile:'Profile & language',farm:'Farm',data:'Data & sync'};
 let body;
 if(selected==='farm')body=`<form class="card-box pc-form settings-form" id="settings-farm"><h2>Farm details</h2><label>Farm name<input name="farmName" value="${escapeHtml(settings.farmName||'')}" placeholder="Your farm name"/></label><label>Address<input name="farmAddress" value="${escapeHtml(settings.farmAddress||'')}"/></label>${LABS?`<label>Farm logo (device-only preview)<input name="farmLogo" type="file" accept="image/jpeg,image/png,image/webp"/><small class="text-mut">This image is saved on this device for your farm profile.</small></label>${settings.farmLogo?`<img src="${escapeHtml(settings.farmLogo)}" alt="Farm logo preview" width="90" height="90" style="object-fit:contain"/>`:''}<label>Default cumulative mortality limit (%)<input type="number" name="defaultMortalityLimit" min="0" max="100" step="0.1" value="${escapeHtml(settings.defaultMortalityLimit??5)}"/><small class="text-mut">Preview for future batch setup. Existing per-batch limits stay unchanged.</small></label>`:''}<label>Target harvest age (days)<input type="number" name="targetHarvestDays" min="20" max="90" required value="${escapeHtml(settings.targetHarvestDays)}"/><small class="text-mut">Used for the harvest-age indicator.</small></label><label>Daily death limit (birds)<input type="number" name="dailyDeathLimit" min="0" value="${escapeHtml(settings.dailyDeathLimit??'')}" placeholder="Use seven-day average"/><small class="text-mut">If empty, the alert uses twice the seven-day average.</small></label><label>Daily tasks due at<input name="taskDueTime" type="time" value="${escapeHtml(settings.taskDueTime)}" required/></label><p class="text-mut">Cumulative mortality limits stay with each batch.</p><button type="submit" class="btn-action primary">Save farm settings</button></form>`;
 else if(selected==='data'&&role==='owner')body=`<div class="card-box pc-form settings-form"><h2>Data & sync</h2><p class="text-mut">Keep the farm’s saved records connected and backed up.</p><button class="btn-action" type="button" id="btn-open-cloud-config">Cloud connection</button><button class="btn-action" type="button" data-nav="nav:reports:summaries">Export farm records</button><button class="btn-action" type="button" id="rd-sync-open">Review waiting uploads</button><h3>Restore a backup</h3><p class="text-mut">Coming soon. Export your farm records before changing devices.</p><h3>Privacy</h3><p class="text-mut">Use your farm’s own accounts and review who can see financial records in User Management.</p></div>`;
 else body=`<form class="card-box pc-form settings-form" id="settings-profile"><h2>Profile & language</h2><p class="text-mut">Device-only profile preview. Sign-in details stay unchanged.</p><label>Name<input name="name" value="${escapeHtml(profile.name||user?.user_metadata?.full_name||user?.name||'')}"/></label><label>Username<input name="username" value="${escapeHtml(profile.username||user?.email||'')}"/></label><label>Profile photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"/><small class="text-mut">A small photo for this device’s profile preview.</small></label>${profile.photo?`<img src="${escapeHtml(profile.photo)}" width="80" height="80" alt="Profile preview" style="border-radius:50%;object-fit:cover"/>`:''}<label>Language<select name="language"><option>English</option><option disabled>Filipino · Coming soon</option><option disabled>Cebuano / Bisaya · Coming soon</option></select></label><p class="text-mut">Password and PIN changes are coming soon. Your current account password is unchanged.</p><button type="submit" class="btn-action primary">Save profile preview</button></form>`;
 return `<section class="page-section">${header(titles[selected]||titles.profile,'Make ChickPence feel at home on your farm.')}<div class="rd-settings-grid">${body}<aside class="rd-help"><h2>${selected==='farm'?'A little setup, better daily care.':selected==='data'?'Your farm, your records.':'Your day starts here.'}</h2>${chicken('hello')}<p>${selected==='farm'?'Set a realistic harvest target and the time your team should finish daily records.':selected==='data'?'Review waiting uploads before switching accounts or moving to another device.':'English is available now. More languages are coming soon.'}</p></aside></div></section>`;
}
export function attachSettingsListeners(container,onSave) {
 container.querySelector('#settings-farm')?.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,d=Object.fromEntries(new FormData(form)),file=d.farmLogo;let farmLogo;
  if(file?.size){if(file.size>2*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){const input=form.querySelector('[name="farmLogo"]');input.setCustomValidity('Choose a JPEG, PNG or WebP smaller than 2 MB.');input.reportValidity();input.addEventListener('change',()=>input.setCustomValidity(''),{once:true});return;}farmLogo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});}
  onSave({farmName:d.farmName,farmAddress:d.farmAddress,...(farmLogo?{farmLogo}:{}),...(d.defaultMortalityLimit!==undefined?{defaultMortalityLimit:Math.min(100,Math.max(0,Number(d.defaultMortalityLimit)||0))}:{}),targetHarvestDays:Math.max(1,Number(d.targetHarvestDays)||35),dailyDeathLimit:d.dailyDeathLimit===''?null:Math.max(0,Number(d.dailyDeathLimit)),taskDueTime:d.taskDueTime||'18:00'});
 });
}

export const PLANNED = {
  buyers: {
    title: 'Buyers / Markets',
    lead: 'A list of the businesses and markets the farm sells to, with what each one paid and still owes.',
    points: ['Name, location and contact of each buyer', 'Sales and price per kg history per buyer', 'Unpaid balances: sales not yet paid', 'Pick a buyer from the list when recording a sale'],
    needs: 'A buyers table on the server and a buyer link on each sale.'
  },
  corrections: {
    title: 'Correction requests',
    lead: 'Fix a saved entry without editing the log: the change waits for an Owner or Admin.',
    points: ['Choose New entry, Correction or Delete request', 'Reason required, with quick chips: "Wrong count", "Late receipt", "Typing error"', 'Shows Before → After for the reviewer', 'You get a notification when it is approved or rejected'],
    needs: 'The change_requests and audit_log tables, and role rules on the server.'
  },
  approvals: {
    title: 'Approvals',
    lead: 'Owner and Admin review corrections and backdated entries before they change a record.',
    points: ['Approve or reject with a note', 'An Admin cannot approve their own request', 'Entries touching a closed batch always come here first', 'Every decision is kept in the batch history'],
    needs: 'The change_requests table and a database function that applies approved changes.'
  },
  concerns: {
    title: 'Concerns',
    lead: 'Raise a question on any entry and follow it to the end, like a ticket.',
    points: ['"Mali ang bilang ng patay" on the entry itself', 'Replies in a thread', 'Status: Open, In progress, Resolved', 'A badge when someone answers'],
    needs: 'The concerns and concern_replies tables, and notifications.'
  },
  payroll: {
    title: 'Payroll',
    lead: 'Wages for farm workers, posted to batch costs automatically. Owner only.',
    points: ['Pay type and rate per worker', 'Attendance from the task board', 'Cash advances (bale) deducted on payday', 'Payslips under each worker\'s "My pay"', 'Payday check: sales cash this period vs. wages due'],
    needs: 'Employee and pay tables visible only to the owner, and consent under the Data Privacy Act.'
  }
};

export function renderPlanned(id) {
 const pages={buyers:['Buyers / Markets',"Soon you’ll see who you sell to and who still owes you.",'nav:sales:record','Record a sale'],concerns:['Concerns','Soon you can raise a concern on a farm entry and follow the reply.','nav:logbook:all','Open Logbook'],payroll:['Payroll','Payroll is coming soon. Record wages as recurring costs for now.','nav:costs:recurring','Open recurring costs']};
 const p=pages[id]||['Coming soon','This farm tool is on its way.','nav:home:overview','Back to Home'];
 return `<section class="page-section">${header(p[0])}<div class="rd-panel planned-card">${empty('Coming soon',p[1],`<button class="btn-action primary" type="button" data-nav="${p[2]}">${p[3]}</button>`)}</div></section>`;
}
