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

export function openThresholdModal(batch, onSave) {
  const mtVal = batch.mortality_threshold_pct != null ? batch.mortality_threshold_pct : '';
  const cbVal = batch.cost_budget != null ? batch.cost_budget : '';

  openModal(`
    <div class="flex-row">
      <h2>Edit Batch Thresholds</h2>
      <button class="btn-icon" id="btn-close-modal">✕</button>
    </div>
    <div class="text-mut">Set warning limits for ${batch.batch_name}. If actuals exceed these values, warning alerts will appear.</div>
    
    <label class="form-field">
      Mortality Threshold (%) · optional
      <input id="input-mt" type="number" min="0" max="100" step="0.1" value="${mtVal}" placeholder="e.g. 5.0" />
    </label>

    <label class="form-field">
      Cost Budget (₱) · optional
      <input id="input-cb" type="number" min="0" step="any" value="${cbVal}" placeholder="e.g. 1700000" />
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
    const cb = document.getElementById('input-cb').value.trim();

    onSave({
      mortality_threshold_pct: mt === '' ? null : Number(mt),
      cost_budget: cb === '' ? null : Number(cb)
    });
    closeModal();
  });
}

export function openCompleteBatchModal(batch, salesCount, onConfirm) {
  const hasSales = salesCount > 0;

  openModal(`
    <div class="flex-row">
      <h2>Complete Batch?</h2>
      <button class="btn-icon" id="btn-close-modal">✕</button>
    </div>

    ${
      hasSales
        ? `<p class="text-mut">Completing <b>${batch.batch_name}</b> sets its end date, locks all child records into read-only mode, and opens the final Batch Summary report.</p>`
        : `<div class="flag-alert">
             <span>⚠ <b>No sales recorded</b> for this batch. Completing now means revenue and profit will be recorded as ₱0. Are you sure you want to complete?</span>
           </div>`
    }

    <div class="flex-row" style="margin-top: 12px;">
      <button class="btn-action" id="btn-cancel-complete">Cancel</button>
      <button class="btn-action primary" id="btn-confirm-complete">Confirm Completion</button>
    </div>
  `);

  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-complete')?.addEventListener('click', closeModal);
  document.getElementById('btn-confirm-complete')?.addEventListener('click', () => {
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
