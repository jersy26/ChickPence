import { openModal, closeModal } from './modals.js';
import { showToast } from './toast.js';
import { formatDate } from '../services/calculations.js';

const FORMATS = [
  { id: 'xlsx', label: 'Excel' },
  { id: 'pdf', label: 'PDF' },
  { id: 'csv', label: 'CSV' }
];

const FORMAT_HINTS = {
  batch: {
    xlsx: 'One workbook: Summary, Expenses, Feed, Mortality and Sales sheets.',
    pdf: 'Printable report with the summary and every record of the batch.',
    csv: 'Every record of the batch in one dated list.'
  },
  history: {
    xlsx: 'One row per batch with cost, revenue, profit, mortality and FCR.',
    pdf: 'Printable table comparing all batches.',
    csv: 'One row per batch with cost, revenue, profit, mortality and FCR.'
  }
};

/** Single "Export" button that opens the export modal. */
export function renderExportButton(scope) {
  return `<button class="btn-action export-btn" data-export-open="${scope}" title="Download a report">⤓ Export</button>`;
}

export function attachExportButton(container, scope, onOpen) {
  container.querySelector(`[data-export-open="${scope}"]`)?.addEventListener('click', onOpen);
}

/** Modal body (pure, so it can be tested without a DOM). */
export function renderExportModal(batches, defaultBatchId) {
  const selectedId = defaultBatchId ?? batches[0]?.batch_id;
  const options = batches
    .map((b) => `
      <option value="${b.batch_id}" ${b.batch_id === selectedId ? 'selected' : ''}>
        ${b.batch_name} · ${b.status} · ${formatDate(b.start_date, true)}
      </option>`)
    .join('');

  return `
    <div class="flex-row">
      <h2>Export Report</h2>
      <button class="btn-icon" id="btn-close-modal" aria-label="Close">✕</button>
    </div>

    <fieldset class="export-options">
      <legend class="text-mut">What to export</legend>

      <label class="export-option">
        <input type="radio" name="export-scope" value="batch" checked />
        <span>
          <b>Detailed batch report</b>
          <span class="text-mut">Summary plus every expense, feed, mortality and sale record of one batch.</span>
        </span>
      </label>
      <label class="form-field export-batch-field">
        Batch
        <select id="export-batch-select">${options}</select>
      </label>

      <label class="export-option">
        <input type="radio" name="export-scope" value="history" />
        <span>
          <b>Whole history</b>
          <span class="text-mut">All ${batches.length} batches side by side, open and closed.</span>
        </span>
      </label>
    </fieldset>

    <fieldset class="export-options">
      <legend class="text-mut">Format</legend>
      <div class="chips-container">
        ${FORMATS.map((f, i) => `
          <label class="chip-filter export-format ${i === 0 ? 'active' : ''}">
            <input type="radio" name="export-format" value="${f.id}" ${i === 0 ? 'checked' : ''} />
            ${f.label}
          </label>`).join('')}
      </div>
      <div class="text-mut export-hint" id="export-format-hint">${FORMAT_HINTS.batch.xlsx}</div>
    </fieldset>

    <div class="flex-row" style="margin-top: 4px;">
      <button class="btn-action" id="btn-cancel-export">Cancel</button>
      <button class="btn-action primary" id="btn-confirm-export">Download</button>
    </div>
  `;
}

/**
 * Open the export modal.
 * @param {object[]} batches – all batches for the picker (newest first)
 * @param {string|null} defaultBatchId – preselected batch (e.g. the summary being viewed)
 * @param {(choice: {scope: 'batch'|'history', batchId: string, format: string}) => Promise<string>} onExport
 *        – resolves with the downloaded file name
 */
export function openExportModal({ batches, defaultBatchId = null, onExport }) {
  openModal(renderExportModal(batches, defaultBatchId));

  const root = document.getElementById('modal');
  const batchSelect = root.querySelector('#export-batch-select');
  const hint = root.querySelector('#export-format-hint');
  const confirmBtn = root.querySelector('#btn-confirm-export');

  const current = () => ({
    scope: root.querySelector('input[name="export-scope"]:checked').value,
    format: root.querySelector('input[name="export-format"]:checked').value,
    batchId: batchSelect.value
  });

  const refresh = () => {
    const { scope, format } = current();
    batchSelect.disabled = scope !== 'batch';
    root.querySelector('.export-batch-field').classList.toggle('is-disabled', scope !== 'batch');
    root.querySelectorAll('.export-format').forEach((chip) => {
      chip.classList.toggle('active', chip.querySelector('input').checked);
    });
    hint.textContent = FORMAT_HINTS[scope][format];
  };

  root.querySelectorAll('input[name="export-scope"], input[name="export-format"]').forEach((input) => {
    input.addEventListener('change', refresh);
  });
  // Picking a batch implies the detailed report
  batchSelect.addEventListener('focus', () => {
    root.querySelector('input[name="export-scope"][value="batch"]').checked = true;
    refresh();
  });

  root.querySelector('#btn-close-modal').addEventListener('click', closeModal);
  root.querySelector('#btn-cancel-export').addEventListener('click', closeModal);

  confirmBtn.addEventListener('click', async () => {
    const choice = current();
    if (choice.scope === 'batch' && !choice.batchId) {
      showToast('Pick a batch to export.');
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Preparing…';
    try {
      const fileName = await onExport(choice);
      closeModal();
      showToast(`Downloaded ${fileName}`);
    } catch (err) {
      console.error('Export failed', err);
      showToast(`Export failed: ${err.message}`);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Download';
    }
  });

  refresh();
}
