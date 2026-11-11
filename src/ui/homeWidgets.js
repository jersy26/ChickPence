/**
 * homeWidgets.js
 * Home's guided question cards ("daily insights"), the auto-ticked to-do list
 * and the mascot banner (thesis audit, sections 13, 16 and 17).
 */

import { escapeHtml } from './html.js';
import { flockCompanion, userDisplayName } from '../services/flockCompanion.js';

const ico = (path) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const CARD_ICONS = {
  coins: ico('<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M15 11.5c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3"/><path d="M9 14.5v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-3"/>'),
  tag: ico('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="8" cy="8" r="1.5"/>'),
  clock: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  heart: ico('<path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9Z"/><path d="M3 12h4l2-3 3 6 2-3h7"/>'),
  chart: ico('<path d="M3 3v18h18"/><path d="m7 9 4 4 3-3 5 5"/>'),
  check: ico('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>')
};

const TONE_WORD = { bad: 'Urgent', warn: 'Watch', info: 'For you', ok: 'Good news' };
const VISIBLE = 4;

/** Cards the question row lists: owners skip the tasks card, the to-do list beside it already shows it. */
export function questionCards(cards = [], role = 'owner') {
  return role === 'staff' ? cards : cards.filter((c) => c.id !== 'tasks');
}

/** "What price do I need for Batch 7?" → "What price do I need?" when the card already names the batch. */
const shortQuestion = (question, batch) => batch ? question.replace(` for ${batch}?`, '?').replace(` on ${batch}?`, '?').replace(` in ${batch}?`, '?').replace(` in ${batch} today?`, ' today?') : question;

/** The guided question row (pure). */
export function renderGuidedCards(allCards = [], { expanded = false, role = 'owner', seen = [], batchNames = {} } = {}) {
  const cards = questionCards(allCards, role);
  const ordered=[...cards].sort((a,b)=>({bad:0,warn:1,info:2,ok:3}[a.tone]??4)-({bad:0,warn:1,info:2,ok:3}[b.tone]??4));
  const shown = role==='staff' ? ordered.filter(c=>c.icon==='check').slice(0,1).map(c=>({...c,question:'My tasks today'})) : expanded ? ordered : ordered.slice(0,VISIBLE);
  const cardHtml = (c) => `<article class="gq-card tone-${c.tone}" data-seen="${seen.includes(c.id)}"><h4 class="gq-question"><button type="button" class="gq-card-link" data-question="${escapeHtml(c.id)}" aria-haspopup="dialog" aria-label="${TONE_WORD[c.tone]}: ${escapeHtml(c.question)}">${escapeHtml(shortQuestion(c.question, batchNames[c.answer?.batchId]))}</button></h4><strong class="gq-value">${escapeHtml(c.value)}</strong><span class="gq-meaning">${escapeHtml(c.meaning.replace(/day (\d+) of (\d+)/g,(_,age,target)=>Number(age)>Number(target)?`Day ${age}, target was day ${target}`:`Day ${age} of ${target}`))}</span></article>`;
  // One heading per batch; shown is most urgent first, so the most urgent batch leads
  const groups = new Map();
  for (const c of shown) {
    const name = batchNames[c.answer?.batchId] || (role === 'staff' ? 'Your day' : 'Farm');
    groups.set(name, [...(groups.get(name) || []), c]);
  }
  const body = shown.length
    ? `<div class="gq-groups">${[...groups].map(([name, list]) => `<div class="gq-group"><h3 class="gq-group-title">${escapeHtml(name)}</h3><div class="gq-row">${list.map(cardHtml).join('')}</div></div>`).join('')}</div>`
    : '<p class="text-mut gq-empty">Nothing needs your attention right now.</p>';
  const more = cards.length > VISIBLE
    ? `<button type="button" class="btn-link" id="btn-gq-toggle">${expanded ? 'Show fewer' : `Show all ${cards.length} insights`}</button>`
    : '';
  const legend = shown.length ? `<p class="gq-legend">${[...new Set(shown.map((c) => c.tone))].map((t) => `<span class="tone-${t}">${TONE_WORD[t]}</span>`).join('')}</p>` : '';
  return `<section class="gq-section" id="home-insights" aria-labelledby="gq-title">
    <div class="flock-panel-heading"><div><h2 id="gq-title">Daily Insights</h2><p class="flock-panel-caption">${role === 'staff' ? 'My tasks for today.' : 'Key figures from your farm records, updated daily. Select a card for the full breakdown.'}</p>${legend}</div><span class="rd-insight-progress">${seen.filter(id=>cards.some(c=>c.id===id)).length} of ${cards.length} reviewed</span>${more}</div>
    ${body}
  </section>`;
}

/** Full answer for one card, in a dialog. */
export function openAnswerModal(card, onNavigate) {
  const dialog = document.createElement('dialog');
  dialog.className = 'gq-dialog';
  dialog.setAttribute('aria-labelledby', 'gq-dialog-title');
  const go = card.answer.view && card.answer.view !== 'todo'
    ? `<button type="button" class="btn-action primary" data-go>${card.answer.view === 'summary' ? 'Open batch summary' : card.answer.view === 'price-check' ? 'Open price check' : 'Open the batch'}</button>`
    : '';
  dialog.innerHTML = `
    <div class="gq-dialog-head tone-${card.tone}"><span class="gq-icon">${CARD_ICONS[card.icon] || ''}</span><div><span class="gq-tone">${TONE_WORD[card.tone]}</span><h2 id="gq-dialog-title">${escapeHtml(card.question)}</h2></div></div>
    <p class="gq-answer">${escapeHtml(card.answer.sentence)}</p>
    <dl class="gq-numbers">${card.answer.numbers.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
    <p class="gq-action"><b>What you can do:</b> ${escapeHtml(card.answer.action)}</p>
    <p class="gq-source">Based on your saved farm records.</p>
    <div class="gq-dialog-foot"><button type="button" class="btn-action" data-close>Close</button>${go}</div>`;
  document.body.appendChild(dialog);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.querySelector('[data-go]')?.addEventListener('click', () => {
    close();
    onNavigate(card.answer.view, card.answer.batchId);
  });
  dialog.showModal();
  dialog.querySelector('[data-close]').focus();
}

const TASK_TAB = { feed: 'Feed', deaths: 'Mortality', receipts: 'Expenses' };

/** Staff's daily progress, derived from the same tasks as the list. */
export function renderTaskTracker(result = {}) {
  const total = result.total || 0;
  const done = Math.min(total, result.done || 0);
  const remaining = total - done;
  const overdue = result.overdue || 0;
  const pct = total ? Math.round(done / total * 100) : 0;
  return `<div class="staff-task-tracker"><div class="task-ring" role="progressbar" aria-label="Daily tasks completed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${done} of ${total} tasks completed">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="task-ring-track" cx="60" cy="60" r="51"/><circle class="task-ring-fill" cx="60" cy="60" r="51" pathLength="100" stroke-dasharray="${pct} 100"/></svg><span><strong>${pct}%</strong><small>completed</small></span>
    </div><div class="task-ring-summary"><h2>Your day, one task at a time.</h2><p>${total ? done === total ? 'All done. Your flock is in good hands.' : `${done} of ${total} tasks accomplished. Keep going!` : 'No tasks yet. Your next flock starts here.'}</p><dl><div><dt>Done</dt><dd>${done}</dd></div><div><dt>Remaining</dt><dd>${remaining}</dd></div><div class="${overdue ? 'has-overdue' : ''}"><dt>Overdue</dt><dd>${overdue}</dd></div></dl></div></div>`;
}

/** Today's to-do list (pure). */
export function renderTodo(result, { compact = false } = {}) {
  if (!result || !result.total) {
    return `<section class="todo-section" id="home-todo"><div class="flock-panel-heading"><h2>To-do list</h2></div><p class="text-mut">No open batches, so nothing to record today.</p></section>`;
  }
  const pct = Math.round((result.done / result.total) * 100);
  const rows = result.tasks.map((t) => {
    const state = t.done ? 'done' : t.overdue ? 'overdue' : 'todo';
    const status = t.done ? escapeHtml(t.detail || 'Done') : t.overdue ? `Overdue · was due ${t.due}` : `Due ${t.due}`;
    const actions = t.done ? '' : `
      <button type="button" class="btn-action" data-task-record="${t.type}" data-batch-id="${escapeHtml(t.batchId || '')}" data-tab="${TASK_TAB[t.type]}">Record</button>
      ${t.canMarkNone && !compact ? `<button type="button" class="btn-action" data-task-none="${t.type}" data-batch-id="${escapeHtml(t.batchId || '')}">${t.type === 'deaths' ? 'No deaths today' : 'No receipts today'}</button>` : ''}`;
    return `<li class="todo-item ${state}">
      <span class="todo-check" aria-hidden="true">${t.done ? '✓' : t.overdue ? '!' : ''}</span>
      <span class="todo-text"><b>${escapeHtml(t.label)}</b><small>${status}</small></span>
      <span class="todo-actions">${actions}</span>
    </li>`;
  }).join('');
  return `<section class="todo-section" id="home-todo" aria-labelledby="todo-title">
    <div class="flock-panel-heading"><div><h2 id="todo-title">To-do list</h2><p class="flock-panel-caption">Ticks itself when the entry is saved.</p></div><span class="todo-count ${result.overdue ? 'bad' : ''}">${result.done} of ${result.total} done${result.overdue ? ` · ${result.overdue} overdue` : ''}</span></div>
    <div class="todo-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Tasks done today"><i style="width:${pct}%"></i></div>
    <ul class="todo-list">${rows}</ul>
  </section>`;
}

/** Derive the character from today's saved farm records. */
export function mascotState(openBatchesData = [], today, targetDays = 35, cards = [], context = {}) {
  return flockCompanion(openBatchesData, today, targetDays, context);
}

function greetingFor(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function renderGreeting(user, mascot, targetDays, now = new Date()) {
  return `<header class="greet-banner"><div><span class="home-date">${now.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</span><h1>${greetingFor(now)}, ${escapeHtml(userDisplayName(user))}.</h1><p class="greet-mood">A new day. A little care. A growing flock.</p></div></header>`;
}
