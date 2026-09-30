import { getSupabaseCredentials, setSupabaseCredentials, isSupabaseConfigured } from '../services/supabaseClient.js';
import { syncEngine } from '../services/syncEngine.js';
import { showToast } from './toast.js';

export function openModal(htmlContent) {
  const modalContainer = document.getElementById('modal');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop-el">
      <div class="modal-card">
        ${htmlContent}
      </div>
    </div>
  `;

  document.getElementById('modal-backdrop-el').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop-el') {
      closeModal();
    }
  });
}

export function closeModal() {
  const modalContainer = document.getElementById('modal');
  if (modalContainer) {
    modalContainer.innerHTML = '';
  }
}

/** Edit mortality threshold only (cost_budget removed). */
export function openThresholdModal(batch, onSave) {
  const mtVal = batch.mortality_threshold_pct != null ? batch.mortality_threshold_pct : '';

  openModal(`
    <div class="flex-row">
      <h2>Edit Batch Thresholds</h2>
      <button class="btn-icon" id="btn-close-modal">✕</button>
    </div>
    <div class="text-mut">Set a mortality warning limit for <b>${batch.batch_name}</b>. An alert will appear when the actual rate exceeds this value.</div>

    <label class="form-field">
      Mortality Threshold (%) · optional
      <input id="input-mt" type="number" min="0" max="100" step="0.1" value="${mtVal}" placeholder="e.g. 5.0" />
    </label>

    <div class="flex-row" style="margin-top: 10px;">
      <button class="btn-action" id="btn-cancel-threshold">Cancel</button>
      <button class="btn-action primary" id="btn-save-threshold">Save Changes</button>
    </div>
  `);

  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-threshold')?.addEventListener('click', closeModal);
  document.getElementById('btn-save-threshold')?.addEventListener('click', () => {
    const mt = document.getElementById('input-mt').value.trim();
    onSave({
      mortality_threshold_pct: mt === '' ? null : Number(mt)
    });
    closeModal();
  });
}

/** Confirm closing a batch (renamed from "Complete"). */
export function openCloseBatchModal(batch, salesCount, onConfirm) {
  const hasSales = salesCount > 0;

  openModal(`
    <div class="flex-row">
      <h2>Mark Batch as Closed?</h2>
      <button class="btn-icon" id="btn-close-modal">✕</button>
    </div>

    ${
      hasSales
        ? `<p class="text-mut">Closing <b>${batch.batch_name}</b> sets its end date and locks records into read-only mode. The final Batch Summary report will open.</p>`
        : `<div class="flag-alert">
             <span>⚠ <b>No sales recorded</b> for this batch. Closing now means revenue and profit will be ₱0. Are you sure?</span>
           </div>`
    }

    <div class="flex-row" style="margin-top: 12px;">
      <button class="btn-action" id="btn-cancel-close">Cancel</button>
      <button class="btn-action primary" id="btn-confirm-close">Confirm — Mark as Closed</button>
    </div>
  `);

  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-close')?.addEventListener('click', closeModal);
  document.getElementById('btn-confirm-close')?.addEventListener('click', () => {
    onConfirm();
    closeModal();
  });
}

export function openSupabaseConfigModal(onConfigChanged) {
  const { url, key } = getSupabaseCredentials();

  openModal(`
    <div class="flex-row">
      <h2>Supabase Cloud Configuration</h2>
      <button class="btn-icon" id="btn-close-modal">✕</button>
    </div>
    <div class="text-mut">
      Enter your Supabase project credentials to enable cloud sync. If left blank, ChickPence runs in local offline Demo mode with Dexie.js IndexedDB.
    </div>

    <label class="form-field">
      Supabase Project URL
      <input id="input-sb-url" type="text" placeholder="https://xyzcompany.supabase.co" value="${url || ''}" />
    </label>

    <label class="form-field">
      Supabase Anon API Key
      <input id="input-sb-key" type="password" placeholder="eyJhbGciOiJIUzI1NiIsInR5..." value="${key || ''}" />
    </label>

    <div class="flex-row" style="margin-top: 12px;">
      <button class="btn-action" id="btn-clear-sb">Reset to Local Demo</button>
      <button class="btn-action primary" id="btn-save-sb">Save & Connect</button>
    </div>
  `);

  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-clear-sb')?.addEventListener('click', () => {
    setSupabaseCredentials(null, null);
    showToast('Switched to Local Offline Demo mode');
    closeModal();
    if (onConfigChanged) onConfigChanged();
  });

  document.getElementById('btn-save-sb')?.addEventListener('click', () => {
    const newUrl = document.getElementById('input-sb-url').value.trim();
    const newKey = document.getElementById('input-sb-key').value.trim();

    if (newUrl && !newKey) {
      showToast('Please enter both Supabase URL and Anon Key');
      return;
    }

    setSupabaseCredentials(newUrl, newKey);
    showToast(newUrl ? 'Supabase credentials saved. Syncing…' : 'Switched to Local Demo mode');
    closeModal();
    syncEngine.syncNow();
    if (onConfigChanged) onConfigChanged();
  });
}
