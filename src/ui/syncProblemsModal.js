/**
 * syncProblemsModal.js
 * "Sync" screen opened from the sidebar status: what is waiting to upload,
 * and the changes the server refused (with its reason), each of which can be
 * retried or discarded from this device.
 */

import { openModal, closeModal } from './modals.js';
import { escapeHtml } from './importReviewModal.js';
import { outboxProblems } from '../services/syncEngine.js';

const LABELS = { batches: 'Batch', expenses: 'Farm expense', feed_logs: 'Feed log', mortality_logs: 'Mortality log', sales: 'Sale' };

const peso = (centavos) => `₱${((Number(centavos) || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One line describing the record in an outbox item. */
export function describeChange(item, batchNames = new Map()) {
  const p = item.payload || {};
  const batch = batchNames.get(p.batch_id);
  const inBatch = batch ? ` · ${batch}` : '';
  const deleted = p.deleted_at ? ' (deleted)' : '';
  switch (item.table_name) {
    case 'batches': return `${p.batch_name || 'Batch'}, started ${p.start_date || '?'}${deleted}`;
    case 'expenses': return `${p.entry_date || '?'}: feed ${peso(p.feed_centavos)}, other ${peso(p.other_centavos)}${deleted}`;
    case 'feed_logs': return `${p.entry_date || '?'}: ${(Number(p.quantity_g) || 0) / 1000} kg${inBatch}${deleted}`;
    case 'mortality_logs': return `${p.entry_date || '?'}: ${p.count ?? '?'} deaths${inBatch}${deleted}`;
    case 'sales': return `${p.sale_date || '?'}: ${p.buyer_name || 'buyer?'}, ${p.quantity_sold ?? '?'} heads, ${p.weight_kg ?? '?'} kg${inBatch}${deleted}`;
    default: return String(item.record_id);
  }
}

/** Modal body (pure). items: the whole outbox. */
export function renderSyncProblems(items, { online = true, batchNames = new Map() } = {}) {
  const problems = outboxProblems(items);
  const waiting = items.length - problems.length;
  const rows = problems.map((item) => `
    <div class="sync-problem" data-id="${item.id}">
      <div class="flex-row">
        <b>${LABELS[item.table_name] || item.table_name}</b>
        <span class="text-mut">Tried ${item.attempts || 1} ${(item.attempts || 1) === 1 ? 'time' : 'times'}</span>
      </div>
      <div>${escapeHtml(describeChange(item, batchNames))}</div>
      <div class="sync-problem-error">${escapeHtml(item.last_error)}</div>
      <div class="sync-problem-actions">
        <button type="button" class="btn-action" data-discard="${item.id}">Discard this change</button>
      </div>
    </div>`).join('');

  return `
    <div class="flex-row">
      <h2>Sync</h2>
      <button class="btn-icon" id="btn-close-modal" aria-label="Close">✕</button>
    </div>
    <div class="text-mut">
      ${!online ? 'Offline: changes upload when the internet is back. ' : ''}
      ${waiting ? `${waiting} ${waiting === 1 ? 'change is' : 'changes are'} waiting to upload. ` : ''}
      ${problems.length
        ? `The server refused ${problems.length} ${problems.length === 1 ? 'change' : 'changes'}. They stay on this device and are tried again at every sync; fix the record (edit it) or discard the change.`
        : waiting ? '' : 'Everything on this device is uploaded.'}
    </div>
    ${rows ? `<div class="sync-problems">${rows}</div>` : ''}
    ${problems.length ? `<div class="text-mut ai-hint">Discard removes the change from this device. If an earlier version was uploaded, that version comes back at the next sync. Discarding a batch also removes its records that are not uploaded.</div>` : ''}
    <div class="flex-row" style="justify-content: flex-end; gap: 8px;">
      ${items.length && online ? '<button type="button" class="btn-action primary" id="btn-sync-retry">Try again now</button>' : ''}
      <button type="button" class="btn-action" id="btn-sync-close">Close</button>
    </div>
  `;
}

/**
 * Open the Sync screen.
 * @param {{ load: () => Promise<{ items, online, batchNames }>, onRetry: () => Promise, onDiscard: (item) => Promise<number> }} p
 */
export function openSyncProblemsModal({ load, onRetry, onDiscard }) {
  const render = async () => {
    const data = await load();
    openModal(renderSyncProblems(data.items, data));
    const root = document.getElementById('modal');
    root.querySelector('#btn-close-modal').addEventListener('click', closeModal);
    root.querySelector('#btn-sync-close').addEventListener('click', closeModal);
    root.querySelector('#btn-sync-retry')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Syncing…';
      await onRetry();
      render();
    });
    root.querySelectorAll('[data-discard]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = data.items.find((i) => String(i.id) === btn.dataset.discard);
        if (!item) return;
        const extra = item.table_name === 'batches' ? ' Its records that are not uploaded are removed too.' : '';
        if (!confirm(`Discard this ${(LABELS[item.table_name] || 'change').toLowerCase()} from this device?${extra}`)) return;
        await onDiscard(item);
        render();
      });
    });
  };
  render();
}
