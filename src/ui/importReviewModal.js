/**
 * importReviewModal.js
 * Review AI drafts (from a logbook photo) before anything is saved.
 * Every field stays editable; fields the AI was unsure about are highlighted.
 * Confirmed drafts go through Repository.save* — the same path as the manual form.
 */

import { openModal, closeModal } from './modals.js';
import { showToast } from './toast.js';
import { Repository } from '../services/repository.js';
import { LOW_CONFIDENCE, validateDraft, draftToSave } from '../services/aiParseService.js';

const TYPE_LABELS = { expense: 'Farm Expense', feed: 'Feed', mortality: 'Mortality', sale: 'Sale' };

/** Editable fields per type: [field, label, input type] */
const FIELDS = {
  expense: [['feed_amount', 'Feed (₱)', 'number'], ['other_amount', 'Other costs (₱)', 'number']],
  feed: [['quantity_kg', 'Quantity (kg)', 'number']],
  mortality: [['count', 'Deaths', 'number']],
  sale: [
    ['buyer_name', 'Buyer', 'text'],
    ['quantity_sold', 'Heads sold', 'number'],
    ['weight_kg', 'Total weight (kg)', 'number'],
    ['price_per_kg', 'Price / kg (₱)', 'number']
  ]
};

const INTEGER_FIELDS = new Set(['count', 'quantity_sold']);

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function field(d, name, label, type, inner) {
  const flag = d.uncertain.has(name) ? ' is-uncertain' : '';
  return `
    <label class="form-field import-field${flag}">
      <span class="import-label">${label}${flag ? ' <span class="import-flag" title="Check this value">?</span>' : ''}</span>
      ${inner}
    </label>`;
}

function input(d, name, label, type) {
  const step = type === 'number' ? (INTEGER_FIELDS.has(name) ? ' step="1" min="0"' : ' step="any" min="0"') : '';
  return field(d, name, label, type,
    `<input type="${type}" data-key="${d.key}" data-field="${name}" value="${escapeHtml(d[name] ?? '')}"${step} />`);
}

function batchSelect(d, openBatches) {
  const options = openBatches
    .map((b) => `<option value="${b.batch_id}" ${b.batch_id === d.batch_id ? 'selected' : ''}>${escapeHtml(b.batch_name)}</option>`)
    .join('');
  return field(d, 'batch_id', 'Batch', 'select', `
    <select data-key="${d.key}" data-field="batch_id">
      <option value="" ${d.batch_id ? '' : 'selected'}>Choose batch…</option>
      ${options}
    </select>`);
}

function renderDraftRow(d, openBatches, error) {
  const low = d.confidence < LOW_CONFIDENCE;
  return `
    <div class="import-row ${d.include ? '' : 'is-excluded'}" data-row="${d.key}">
      <div class="flex-row import-row-head">
        <label class="import-include">
          <input type="checkbox" data-key="${d.key}" data-field="include" ${d.include ? 'checked' : ''} />
          <b>${TYPE_LABELS[d.type]}</b>
        </label>
        <span class="import-confidence ${low ? 'low' : ''}" title="AI confidence">${Math.round(d.confidence * 100)}%</span>
      </div>
      ${d.source_text ? `<div class="text-mut import-source">“${escapeHtml(d.source_text)}”</div>` : ''}
      <div class="import-fields">
        ${input(d, 'date', 'Date', 'date')}
        ${d.type === 'expense' ? '' : batchSelect(d, openBatches)}
        ${FIELDS[d.type].map(([name, label, type]) => input(d, name, label, type)).join('')}
      </div>
      ${error ? `<div class="flag-alert import-error">${escapeHtml(error)}</div>` : ''}
    </div>`;
}

/** Modal body (pure, testable without a DOM). errors: Map key → message */
export function renderImportReviewModal(drafts, openBatches, notes = '', errors = new Map()) {
  const uncertainCount = drafts.filter((d) => d.uncertain.size || d.confidence < LOW_CONFIDENCE).length;
  return `
    <div class="flex-row">
      <h2>Review Scanned Entries</h2>
      <button class="btn-icon" id="btn-close-modal" aria-label="Close">✕</button>
    </div>
    <div class="text-mut">
      ${drafts.length
        ? `The AI found <b>${drafts.length}</b> ${drafts.length === 1 ? 'entry' : 'entries'}. Nothing is saved until you confirm.
           ${uncertainCount ? `Check the <span class="import-flag">?</span> fields on ${uncertainCount} of them.` : ''}`
        : 'The AI could not find any entries on this photo.'}
    </div>
    ${notes ? `<div class="import-notes text-mut"><b>AI notes:</b> ${escapeHtml(notes)}</div>` : ''}
    <div class="import-list">
      ${drafts.map((d) => renderDraftRow(d, openBatches, errors.get(d.key))).join('')}
    </div>
    <div class="text-mut import-disclaimer">AI-read values can be wrong. Compare them with the logbook before saving.</div>
    <div class="flex-row" style="margin-top: 4px;">
      <button class="btn-action" id="btn-cancel-import">${drafts.length ? 'Discard' : 'Close'}</button>
      ${drafts.length ? `<button class="btn-action primary" id="btn-confirm-import">Save selected</button>` : ''}
    </div>
  `;
}

/**
 * Progress while the local AI reads a photo (can take minutes on a CPU-only PC).
 * Returns { update(message), close() }.
 */
export function openScanProgressModal({ onCancel }) {
  openModal(`
    <h2>Scanning the logbook</h2>
    <div class="scan-progress">
      <div class="scan-spinner" aria-hidden="true"></div>
      <div>
        <div id="scan-progress-step">Starting…</div>
        <div class="text-mut" id="scan-progress-time">0:00</div>
      </div>
    </div>
    <div class="text-mut import-disclaimer">This runs on this computer and can take a few minutes. You can keep the app open while it works.</div>
    <div class="flex-row" style="justify-content:flex-end;">
      <button class="btn-action" id="btn-cancel-scan">Cancel</button>
    </div>
  `);
  const root = document.getElementById('modal');
  // Clicking outside must not hide a scan that is still running
  root.querySelector('.modal-backdrop')?.replaceWith(root.querySelector('.modal-backdrop').cloneNode(true));
  const started = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    const el = root.querySelector('#scan-progress-time');
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  root.querySelector('#btn-cancel-scan').addEventListener('click', () => onCancel?.());

  return {
    update(message) {
      const el = root.querySelector('#scan-progress-step');
      if (el) el.textContent = message;
    },
    close() {
      clearInterval(timer);
      closeModal();
    }
  };
}

function readValue(el) {
  const name = el.dataset.field;
  if (name === 'include') return el.checked;
  const raw = el.value.trim();
  if (el.type === 'number') return raw === '' ? null : Number(raw);
  return raw === '' ? null : raw;
}

/**
 * Open the review modal.
 * @param {object[]} drafts – from normalizeDrafts()
 * @param {object[]} openBatches
 * @param {string} notes – the AI's notes on lines it skipped
 * @param {(savedCount: number) => void} onSaved – called after at least one entry was saved
 * @param {() => void} [onDiscard] – called when the user discards the remaining drafts
 */
export function openImportReviewModal({ drafts, openBatches, notes = '', onSaved, onDiscard }) {
  let current = drafts;
  let errors = new Map();
  let savedTotal = 0;

  const render = () => {
    openModal(renderImportReviewModal(current, openBatches, notes, errors));
    const root = document.getElementById('modal');
    root.querySelector('.modal-card')?.classList.add('import-modal');

    root.querySelectorAll('[data-key][data-field]').forEach((el) => {
      el.addEventListener('change', () => {
        const d = current.find((x) => x.key === el.dataset.key);
        if (!d) return;
        d[el.dataset.field] = readValue(el);
        if (el.dataset.field === 'include') {
          root.querySelector(`[data-row="${d.key}"]`)?.classList.toggle('is-excluded', !d.include);
        }
      });
    });

    const finish = () => {
      closeModal();
      if (savedTotal) onSaved?.(savedTotal);
      else onDiscard?.();
    };
    root.querySelector('#btn-close-modal').addEventListener('click', finish);
    root.querySelector('#btn-cancel-import').addEventListener('click', () => {
      if (current.some((d) => d.include) && !confirm('Discard these scanned entries?')) return;
      finish();
    });

    const confirmBtn = root.querySelector('#btn-confirm-import');
    confirmBtn?.addEventListener('click', async () => {
      const selected = current.filter((d) => d.include);
      if (!selected.length) return showToast('Select at least one entry to save.');

      errors = new Map();
      for (const d of selected) {
        const problems = validateDraft(d);
        if (problems.length) errors.set(d.key, `Missing or invalid: ${problems.join(', ')}`);
      }
      if (errors.size) {
        render();
        return showToast('Fix the highlighted entries first.');
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving…';
      const failed = [];
      for (const d of selected) {
        const [method, args] = draftToSave(d);
        try {
          await Repository[method](args);
          savedTotal++;
        } catch (err) {
          failed.push(d);
          errors.set(d.key, err.message || 'Could not save this entry.');
        }
      }

      if (!failed.length) {
        closeModal();
        showToast(`Saved ${savedTotal} ${savedTotal === 1 ? 'entry' : 'entries'} · queued for sync`);
        onSaved?.(savedTotal);
        return;
      }
      // Keep only what failed (plus anything left unselected) so nothing is saved twice
      current = current.filter((d) => !d.include || failed.includes(d));
      render();
      showToast(`Saved ${savedTotal}; ${failed.length} need fixing.`);
    });
  };

  render();
}
