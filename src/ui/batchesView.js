/**
 * batchesView.js
 * Replaces activeBatchView.js.
 * Shows all open batches; allows creating new batches, recording mortality/feed/sales per batch,
 * and recording farm-level expenses with an allocation preview.
 */

import {
  calcRunningMortalityList,
  formatPeso,
  formatPesoCentavos,
  formatPercent,
  formatDate
} from '../services/calculations.js';
import { calcBatchMetrics, liveHeadCount } from '../services/allocationEngine.js';
import { Repository } from '../services/repository.js';
import { openThresholdModal, openCloseBatchModal } from './modals.js';
import { showToast } from './toast.js';
import { isSpeechSupported, startDictation, VOICE_LANGS, getVoiceLang, setVoiceLang } from '../services/speechInput.js';

const TODAY = new Date().toISOString().slice(0, 10);
const NA = 'N/A';
const EXPENSE_PAGE_SIZE = 15;

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function metricCell(val, formatter) {
  if (val === NA) return `<span class="text-mut">${NA}</span>`;
  return formatter(val);
}

/**
 * "Scan logbook" (photo → local AI drafts), a "Review scanned" button when
 * queued photos are done, and the local AI settings. When the local AI is off
 * the button still works: the photo waits in the queue.
 */
export function renderScanActions(importState) {
  if (!importState) return '';
  const { unavailableReason, queued = 0, ready = 0 } = importState;
  const waiting = queued - ready;
  const title = unavailableReason
    ? `${unavailableReason} Photos you take now will be scanned later.`
    : 'Take or pick a photo of the logbook; the local AI drafts the entries for you to review';
  return `
    ${ready > 0 ? `<button class="btn-action accent" id="btn-review-scans">Review scanned (${ready})</button>` : ''}
    <label class="btn-action scan-btn ${unavailableReason ? 'is-warn' : ''}" title="${escapeAttr(title)}">
      📷 Scan logbook${unavailableReason ? ' <span class="scan-status">· AI off</span>' : ''}${waiting > 0 ? ` <span class="text-mut">(${waiting} waiting)</span>` : ''}
      <input type="file" id="input-scan-logbook" accept="image/*" capture="environment" hidden />
    </label>
    <button class="btn-action btn-ai-settings" id="btn-ai-settings" title="Local AI settings" aria-label="Local AI settings">⚙</button>
  `;
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderBatchSelectorOptions(openBatches, selectedId) {
  return openBatches
    .map(
      (b) =>
        `<option value="${b.batch_id}" ${b.batch_id === selectedId ? 'selected' : ''}>${b.batch_name}</option>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// DATA TABLE (per batch)
// ---------------------------------------------------------------------------

function renderDataTable(activeTab, batchData) {
  const { batch, feed, mortality, sales } = batchData;

  const editBtn = (table, id) => `
    <button class="btn-icon" data-action="edit-row" data-table="${table}" data-id="${id}" title="Edit entry">✎</button>
    <button class="btn-icon" data-action="delete-row" data-table="${table}" data-id="${id}" title="Delete entry" style="color: var(--bad); margin-left: 2px;">✕</button>
  `;

  const emptyRow = (cols) => `
    <tr><td colspan="${cols}" class="text-mut" style="text-align: center; padding: 24px;">No records yet.</td></tr>
  `;

  if (activeTab === 'Feed') {
    const rows = [...feed].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
    return `
      <table>
        <thead><tr><th>Date</th><th>Quantity (kg)</th><th style="width:70px;"></th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows.map((f) => {
                  // quantity_g is integer grams (v3+); fall back to quantity_kg for pre-migration rows
                  const dispKg = f.quantity_g !== undefined
                    ? (Number(f.quantity_g) || 0) / 1000
                    : (Number(f.quantity_kg) || 0);
                  return `
                <tr>
                  <td>${formatDate(f.entry_date)}</td>
                  <td><b>${dispKg.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg</b></td>
                  <td>${editBtn('feed_logs', f.feed_log_id)}</td>
                </tr>`;
              }).join('')
              : emptyRow(3)
          }
        </tbody>
      </table>`;
  }

  if (activeTab === 'Mortality') {
    const runningList = calcRunningMortalityList(batch, mortality).reverse();
    return `
      <table>
        <thead><tr><th>Date</th><th>Deaths</th><th>Cumulative</th><th>Mortality Rate</th><th style="width:70px;"></th></tr></thead>
        <tbody>
          ${
            runningList.length
              ? runningList.map((m) => `
                <tr>
                  <td>${formatDate(m.entry_date)}</td>
                  <td><b>${m.count}</b></td>
                  <td>${m.runningCount}</td>
                  <td>${formatPercent(m.runningRate)}</td>
                  <td>${editBtn('mortality_logs', m.mortality_id)}</td>
                </tr>`).join('')
              : emptyRow(5)
          }
        </tbody>
      </table>`;
  }

  // Sales Tab
  const rows = [...sales].sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1));
  return `
    <table>
      <thead><tr><th>Date</th><th>Buyer</th><th>Qty (Heads)</th><th>Weight (kg)</th><th>Price / kg</th><th>Total</th><th style="width:70px;"></th></tr></thead>
      <tbody>
        ${
          rows.length
            ? rows.map((s) => `
              <tr>
                <td>${formatDate(s.sale_date)}</td>
                <td><b>${s.buyer_name}</b></td>
                <td>${Number(s.quantity_sold).toLocaleString()}</td>
                <td>${Number(s.weight_kg).toLocaleString()} kg</td>
                <td>${formatPeso(s.price_per_kg)}</td>
                <td><b>${formatPeso(s.total_amount)}</b></td>
                <td>${editBtn('sales', s.sale_id)}</td>
              </tr>`).join('')
            : emptyRow(7)
        }
      </tbody>
    </table>`;
}

// ---------------------------------------------------------------------------
// EXPENSE TABLE
// ---------------------------------------------------------------------------

function renderExpenseTable(expenses, allAllocations) {
  const editBtn = (id) => `
    <button class="btn-icon" data-action="edit-expense" data-id="${id}" title="Edit">✎</button>
    <button class="btn-icon" data-action="void-expense" data-id="${id}" title="Void" style="color:var(--bad);margin-left:2px;">✕</button>
  `;

  if (!expenses.length) {
    return `<tr><td colspan="4" class="text-mut" style="text-align:center;padding:24px;">No expenses recorded yet.</td></tr>`;
  }

  return expenses.map((e) => {
    const feedPeso = (Number(e.feed_centavos) || 0) / 100;
    const otherPeso = (Number(e.other_centavos) || 0) / 100;
    const total = feedPeso + otherPeso;
    return `
      <tr>
        <td>${formatDate(e.entry_date)}</td>
        <td>${formatPeso(feedPeso)}</td>
        <td>${formatPeso(otherPeso)}</td>
        <td><b>${formatPeso(total)}</b></td>
        <td>${editBtn(e.expense_id)}</td>
      </tr>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// ENTRY FORM (modal content — no side-panel wrapper)
// ---------------------------------------------------------------------------

// Module-level flag: keep modal open across re-renders triggered by tab switches
let _batchModalOpen = false;

/**
 * Voice typing above the entry form: mic + language, the transcript (editable,
 * so a misheard word can be fixed and read again), and a status line.
 * The mic is hidden where the browser has no speech recognition.
 */
export function renderVoiceBar(voice, { supported, online = true } = {}) {
  const v = voice || {};
  const micTitle = online
    ? 'Say one entry, e.g. "may tatlong patay sa batch 9 kahapon"'
    : 'Voice typing needs internet. You can still type the sentence.';
  const lang = getVoiceLang();
  return `
    <div class="voice-bar">
      ${supported ? `
        <div class="voice-row">
          <button type="button" class="btn-action voice-mic" id="btn-voice" title="${escapeAttr(micTitle)}" ${online && !v.busy ? '' : 'disabled'}>🎤 Speak</button>
          <select id="voice-lang" aria-label="Voice language">
            ${VOICE_LANGS.map((l) => `<option value="${l.code}" ${l.code === lang ? 'selected' : ''}>${l.label}</option>`).join('')}
          </select>
        </div>` : ''}
      <div class="voice-row">
        <input id="voice-transcript" type="text" autocomplete="off"
          placeholder="${supported ? 'Or type one entry' : 'Type one entry, e.g. 3 patay sa batch 9'}"
          value="${escapeAttr(v.transcript || '')}" ${v.busy ? 'disabled' : ''} />
        <button type="button" class="btn-action" id="btn-voice-read" ${v.busy ? 'disabled' : ''}>Fill form</button>
      </div>
      <div class="voice-msg ${v.tone ? `is-${v.tone}` : ''}" id="voice-msg" role="status">${v.message ? escapeAttr(v.message) : ''}</div>
      ${supported ? `<div class="voice-privacy text-mut">The browser's speech service turns your voice into text (Chrome and Edge send the audio online). Nothing is saved until you tap Save.</div>` : ''}
    </div>`;
}

function renderEntryFormPanel(activeTab, openBatches, selectedBatchId, editingItem, expensePreview, prefill = null) {
  // A voice prefill fills the form like an edit, but saves as a new entry
  const src = editingItem || prefill?.values || null;
  const val = (field, fallback = '') => (src ? (src[field] ?? fallback) : fallback);
  const flagged = new Set(editingItem ? [] : prefill?.uncertain || []);
  const chk = (...fields) => (fields.some((f) => flagged.has(f)) ? 'class="is-uncertain" title="Check this value"' : '');

  if (activeTab === 'Expenses') {
    const feedVal = src?.feed_centavos != null ? (src.feed_centavos / 100).toFixed(2) : '';
    const otherVal = src?.other_centavos != null ? (src.other_centavos / 100).toFixed(2) : '';

    let previewHtml = '';
    if (expensePreview && expensePreview.length) {
      previewHtml = `
        <div class="ok-line text-mut" style="margin-top: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;">
          Allocation Preview
        </div>
        ${expensePreview.map((p) => `
          <div class="ok-line" style="font-size: 13px;">
            <span>${p.batchName}</span>
            <span>${formatPeso(p.feedShare)} feed · ${formatPeso(p.otherShare)} other</span>
          </div>`).join('')}
      `;
    }

    return `
      ${editingItem ? `<div class="ok-line flex-row" style="margin-bottom:6px;"><span class="text-mut">Editing entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
      <label class="form-field">
        Date
        <input id="input-exp-date" type="date" ${chk('date')} value="${val('entry_date', TODAY)}" />
      </label>
      <label class="form-field">
        Feed Amount (₱)
        <input id="input-exp-feed" type="number" ${chk('feed_amount')} min="0" step="0.01" placeholder="0.00" value="${feedVal}" />
      </label>
      <label class="form-field">
        Other Costs (₱)
        <input id="input-exp-other" type="number" ${chk('other_amount')} min="0" step="0.01" placeholder="0.00" value="${otherVal}" />
      </label>
      ${previewHtml}
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn-action" id="btn-preview-expense" style="flex:1;">
          ${expensePreview ? 'Refresh Preview' : 'Preview Allocation'}
        </button>
        <button class="btn-action accent" id="btn-save-expense" style="flex:1;" ${!expensePreview ? 'disabled' : ''}>
          ${editingItem ? 'Save Changes' : 'Save Expense'}
        </button>
      </div>`;
  }

  const batchSelector = openBatches.length
    ? `<label class="form-field">
        Batch
        <select id="input-batch-select" ${chk('batch_id')}>
          ${renderBatchSelectorOptions(openBatches, selectedBatchId)}
        </select>
      </label>`
    : `<div class="text-mut">No open batches.</div>`;

  if (activeTab === 'Feed') {
    return `
      ${editingItem ? `<div class="ok-line flex-row" style="margin-bottom:6px;"><span class="text-mut">Editing entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
      ${batchSelector}
      <label class="form-field">
        Date
        <input id="input-feed-date" type="date" ${chk('date')} value="${val('entry_date', TODAY)}" />
      </label>
      <label class="form-field">
        Quantity Consumed (kg)
        <input id="input-feed-kg" type="number" ${chk('quantity_kg')} min="0.001" step="any" placeholder="0.000" value="${
          src
            ? (src.quantity_g !== undefined
                ? ((Number(src.quantity_g) || 0) / 1000).toFixed(3)
                : (src.quantity_kg ?? ''))
            : ''
        }" />
      </label>
      <button class="btn-action primary" id="btn-save-entry" style="margin-top:8px;">
        ${editingItem ? 'Save Changes' : 'Save Entry'}
      </button>`;
  }

  if (activeTab === 'Mortality') {
    return `
      ${editingItem ? `<div class="ok-line flex-row" style="margin-bottom:6px;"><span class="text-mut">Editing entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
      ${batchSelector}
      <label class="form-field">
        Date
        <input id="input-mort-date" type="date" ${chk('date')} value="${val('entry_date', TODAY)}" />
      </label>
      <label class="form-field">
        Number of Deaths
        <input id="input-mort-deaths" type="number" ${chk('count')} min="0" step="1" placeholder="0" value="${val('count', '')}" />
      </label>
      <button class="btn-action primary" id="btn-save-entry" style="margin-top:8px;">
        ${editingItem ? 'Save Changes' : 'Save Entry'}
      </button>`;
  }

  // Sales
  const kg = Number(val('weight_kg', 0));
  const ppk = Number(val('price_per_kg', 0));
  const initialTotal = +(kg * ppk).toFixed(2);

  return `
    ${editingItem ? `<div class="ok-line flex-row" style="margin-bottom:6px;"><span class="text-mut">Editing entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
    ${batchSelector}
    <label class="form-field">
      Sale Date
      <input id="input-sale-date" type="date" ${chk('date')} value="${val('sale_date', TODAY)}" />
    </label>
    <label class="form-field">
      Buyer Name
      <input id="input-sale-buyer" type="text" ${chk('buyer_name')} placeholder="e.g. Buyer (placeholder)" value="${val('buyer_name', '')}" />
    </label>
    <label class="form-field">
      Quantity Sold (heads)
      <input id="input-sale-qty" type="number" ${chk('quantity_sold')} min="1" step="1" placeholder="0" value="${val('quantity_sold', '')}" />
    </label>
    <label class="form-field">
      Total Weight (kg)
      <input id="input-sale-kg" type="number" ${chk('weight_kg')} min="0.01" step="any" placeholder="0.00" value="${val('weight_kg', '')}" />
    </label>
    <label class="form-field">
      Price per kg (₱)
      <input id="input-sale-ppk" type="number" ${chk('price_per_kg')} min="0.01" step="any" placeholder="0.00" value="${val('price_per_kg', '')}" />
    </label>
    <div class="ok-line flex-row" style="margin-top:4px;">
      <span>Total Amount</span>
      <b id="live-sale-total">${formatPeso(initialTotal)}</b>
    </div>
    <button class="btn-action primary" id="btn-save-entry" style="margin-top:8px;">
      ${editingItem ? 'Save Changes' : 'Save Entry'}
    </button>`;
}

export function renderBatchToggleIcon(isCollapsed) {
  if (isCollapsed) {
    // Maximize icon (+)
    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>`;
  }
  // Minimize icon (-)
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>`;
}

// ---------------------------------------------------------------------------
// BATCH CARD (per open batch)
// ---------------------------------------------------------------------------

function renderOpenBatchCard(batchFullData, selectedBatchId, activeTab, editingItem, expensePreview, expenses, isCollapsed = false) {
  const { batch, feed, mortality, sales, allocations } = batchFullData;
  const metrics = calcBatchMetrics(batch, allocations, sales, mortality, feed);
  const liveHeads = liveHeadCount(batch, mortality, sales, TODAY);

  const isSelected = batch.batch_id === selectedBatchId;

  return `
    <div class="card-box" id="batch-card-${batch.batch_id}" style="margin-bottom: 14px;">
      <div class="flex-row" style="align-items: flex-start;">
        <div style="flex:1;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button
              type="button"
              class="btn-batch-toggle"
              data-action="toggle-batch-collapse"
              data-batch-id="${batch.batch_id}"
              title="${isCollapsed ? 'Maximize' : 'Minimize'}"
              aria-label="${isCollapsed ? 'Maximize ' + batch.batch_name : 'Minimize ' + batch.batch_name}"
              aria-expanded="${!isCollapsed}"
            >
              ${renderBatchToggleIcon(isCollapsed)}
            </button>
            <b style="font-size: 16px;">${batch.batch_name}</b>
          </div>
          <div class="text-mut" style="font-size: 12px; margin-top: 2px;">
            Started ${formatDate(batch.start_date, true)} · ${batch.initial_chick_count.toLocaleString()} chicks initial · <b class="live-count-chip">${liveHeads.toLocaleString()}</b> live today
          </div>
        </div>
        <div class="flex-row" style="gap: 6px;">
          <button class="btn-action" data-action="edit-threshold" data-batch-id="${batch.batch_id}">✎ Thresholds</button>
          <button class="btn-action primary" data-action="close-batch" data-batch-id="${batch.batch_id}">Mark as closed</button>
        </div>
      </div>

      <div class="batch-card-body" id="batch-body-${batch.batch_id}" style="${isCollapsed ? 'display: none;' : ''}">
        <div class="grid-3" style="margin-top: 8px;">
          <div class="card-box kpi-card">
            <span class="text-mut">Cost to Date</span>
            <b>${formatPeso(metrics.totalCost)}</b>
            <span class="text-mut" style="font-size:11px;">Provisional</span>
          </div>
          <div class="card-box kpi-card">
            <span class="text-mut">Sales to Date</span>
            <b>${formatPeso(metrics.revenue)}</b>
          </div>
          <div class="card-box kpi-card">
            <span class="text-mut">Mortality</span>
            <b>${metrics.totalDeaths.toLocaleString()} / ${batch.initial_chick_count.toLocaleString()} (${formatPercent(metrics.mortalityRate)})</b>
          </div>
        </div>

        <div class="tab-nav" style="margin-top: 10px;">
          ${['Feed', 'Mortality', 'Sales'].map((t) => `
            <button class="${isSelected && activeTab === t ? 'active' : ''}" data-batch-tab="${t}" data-batch-id="${batch.batch_id}">${t}</button>
          `).join('')}
        </div>

        ${isSelected ? `
          <div class="card-box table-wrap" style="margin-top: 6px;">
            ${renderDataTable(activeTab, batchFullData)}
          </div>
        ` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// MAIN RENDER
// ---------------------------------------------------------------------------

export function renderBatches(
  openBatchesData,
  expenses,
  selectedBatchId,
  activeTab,
  editingItem,
  expensePreview,
  collapsedBatchIds = new Set(),
  expenseVisibleCount = EXPENSE_PAGE_SIZE,
  importState = null, // { unavailableReason, queued, ready } for the "Scan logbook" action
  voice = null // { transcript, message, tone, busy, prefill } for voice typing in the entry form
) {
  const TODAY = new Date().toISOString().slice(0, 10);

  const openBatches = openBatchesData.map((d) => d.batch);

  const visibleExpenses = expenses.slice(0, expenseVisibleCount);
  const expenseRows = renderExpenseTable(visibleExpenses, []);
  const remainingExpenseCount = expenses.length - visibleExpenses.length;

  const allCollapsed =
    openBatchesData.length > 0 &&
    openBatchesData.every((bd) => collapsedBatchIds.has(bd.batch.batch_id));

  const batchCardsHtml = openBatchesData.length
    ? openBatchesData.map((bd) =>
        renderOpenBatchCard(
          bd,
          selectedBatchId,
          activeTab,
          editingItem,
          expensePreview,
          expenses,
          collapsedBatchIds.has(bd.batch.batch_id)
        )
      ).join('')
    : `<div class="card-box text-mut" style="padding:24px;text-align:center;">
        No open batches. Create one below.
      </div>`;

  const modalTitle = activeTab === 'Expenses' ? 'Farm Expense'
    : activeTab === 'Feed' ? 'Feed Log'
    : activeTab === 'Mortality' ? 'Mortality Log'
    : 'Sale';

  const tabButtons = ['Expenses', 'Feed', 'Mortality', 'Sales'].map((t) => `
    <button class="${activeTab === t ? 'active' : ''}" data-panel-tab="${t}">${t}</button>
  `).join('');

  return `
    <!-- ENTRY MODAL -->
    <div id="entry-modal-backdrop" class="modal-backdrop" style="display:none;">
      <div class="modal-card" style="max-width:480px;width:100%;gap:10px;">
        <div class="flex-row">
          <b style="font-size:15px;">${editingItem ? 'Edit' : 'New'} ${modalTitle}</b>
          <button data-action="close-modal" class="btn-icon" style="font-size:22px;line-height:1;padding:0 4px;" title="Close">×</button>
        </div>
        <div class="tab-nav" style="margin: -4px -4px 4px;">
          ${tabButtons}
        </div>
        ${editingItem ? '' : renderVoiceBar(voice, { supported: isSpeechSupported(), online: globalThis.navigator?.onLine !== false })}
        ${renderEntryFormPanel(activeTab, openBatches, selectedBatchId, editingItem, expensePreview, voice?.prefill?.tab === activeTab ? voice.prefill : null)}
      </div>
    </div>

    <div class="top-bar">
      <h1>Open Batches</h1>
      <button class="btn-action accent" id="btn-show-new-batch-form">+ New Batch</button>
    </div>

    <!-- NEW BATCH FORM (hidden by default) -->
    <div id="new-batch-form-container" style="display:none;" class="card-box" style="max-width:480px;margin-bottom:14px;">
      <h2>Create New Batch</h2>
      <label class="form-field">
        Batch Name / ID
        <input id="new-batch-name" type="text" value="Batch ${new Date().toISOString().slice(0, 7)}" />
      </label>
      <label class="form-field">
        Start Date
        <input id="new-batch-start" type="date" value="${TODAY}" />
      </label>
      <label class="form-field">
        Initial Chick Count (Fixed)
        <input id="new-batch-chicks" type="number" min="1" step="1" value="10000" />
      </label>
      <label class="form-field">
        Chick Acquisition Cost (₱)
        <input id="new-batch-chick-cost" type="number" min="0" step="any" value="550000" />
      </label>
      <label class="form-field">
        Mortality Threshold (%) · optional
        <input id="new-batch-mt" type="number" min="0" max="100" step="0.1" value="5" placeholder="e.g. 5.0" />
      </label>
      <div class="flex-row" style="margin-top:10px;gap:8px;">
        <button class="btn-action" id="btn-cancel-new-batch">Cancel</button>
        <button class="btn-action primary" id="btn-create-batch">Create Batch</button>
      </div>
    </div>

    <!-- OPEN BATCHES LIST -->
    <div class="flex-row" style="margin-bottom:6px;align-items:center;">
      <div style="font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em;">
        Open Batches
      </div>
      ${openBatchesData.length > 1 ? `
        <button class="btn-link" id="btn-toggle-all-open-batches" style="font-size:11px;font-weight:600;text-transform:uppercase;">
          ${allCollapsed ? '+ Maximize All' : '− Minimize All'}
        </button>
      ` : ''}
    </div>
    ${batchCardsHtml}

    <!-- FARM-LEVEL EXPENSES (full-width) -->
    <div style="margin-top:20px;">
      <div class="flex-row" style="margin-bottom:8px;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:.05em;">
          Farm Expenses
        </div>
        <div class="import-actions">
          ${renderScanActions(importState)}
          <button class="btn-action primary" data-panel-tab="Expenses" id="btn-open-entry-modal">+ Add New Log</button>
        </div>
      </div>
      <div class="card-box table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Feed</th><th>Other Costs</th><th>Total</th><th style="width:80px;"></th></tr>
          </thead>
          <tbody>${expenseRows}</tbody>
        </table>
      </div>
      ${remainingExpenseCount > 0 ? `
        <div class="load-more-row">
          <button class="btn-action" id="btn-load-more-expenses">Load More (${remainingExpenseCount} older)</button>
        </div>
      ` : ''}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// LISTENERS
// ---------------------------------------------------------------------------

let _dictation = null; // the recording in progress, if any

/** Mic → transcript → onVoiceResult(text), which parses it and prefills the form. */
function attachVoiceListeners(container, onVoiceResult) {
  const micBtn = container.querySelector('#btn-voice');
  const langSelect = container.querySelector('#voice-lang');
  const input = container.querySelector('#voice-transcript');
  const msg = container.querySelector('#voice-msg');
  if (!input) return;

  _dictation?.stop(); // a re-render replaced the button that was listening
  _dictation = null;

  const say = (text, tone = '') => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = `voice-msg ${tone ? `is-${tone}` : ''}`;
  };
  const setListening = (on) => {
    if (!micBtn) return;
    micBtn.textContent = on ? '■ Stop' : '🎤 Speak';
    micBtn.classList.toggle('is-listening', on);
  };
  const read = () => {
    const text = input.value.trim();
    if (!text) return say('Say or type one entry first.', 'warn');
    onVoiceResult?.(text);
  };

  langSelect?.addEventListener('change', () => setVoiceLang(langSelect.value));
  container.querySelector('#btn-voice-read')?.addEventListener('click', read);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      read();
    }
  });

  micBtn?.addEventListener('click', () => {
    if (_dictation) {
      _dictation.stop(); // onFinal still runs with what was heard
      return;
    }
    setListening(true);
    say('Listening… say one entry.', 'info');
    _dictation = startDictation({
      lang: langSelect?.value || getVoiceLang(),
      onInterim: (text) => {
        input.value = text;
      },
      onFinal: (text) => {
        _dictation = null;
        setListening(false);
        input.value = text;
        onVoiceResult?.(text);
      },
      onError: (message) => {
        _dictation = null;
        setListening(false);
        say(message, 'warn');
      },
      onEnd: () => {
        _dictation = null;
        setListening(false);
        say('No speech was heard. Tap the mic and try again.', 'warn');
      }
    });
  });
}

export function attachBatchesListeners(container, state, callbacks) {
  const { onTabChange, onReload, onNavigate, onSetEdit, onCancelEdit, onSelectBatch, onExpensePreview, onLoadMoreExpenses, onScanPhoto, onReviewScans, onAiSettings, onVoiceResult } = callbacks;

  attachVoiceListeners(container, onVoiceResult);

  // Scan logbook: the file input sits inside the button label
  container.querySelector('#btn-ai-settings')?.addEventListener('click', () => onAiSettings?.());
  const scanInput = container.querySelector('#input-scan-logbook');
  scanInput?.addEventListener('change', () => {
    const file = scanInput.files?.[0];
    scanInput.value = ''; // allow picking the same photo again
    if (file) onScanPhoto?.(file);
  });
  container.querySelector('#btn-review-scans')?.addEventListener('click', () => onReviewScans?.());

  container.querySelector('#btn-load-more-expenses')?.addEventListener('click', () => {
    onLoadMoreExpenses?.();
  });

  // Show / hide new batch form
  container.querySelector('#btn-show-new-batch-form')?.addEventListener('click', () => {
    const form = container.querySelector('#new-batch-form-container');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  container.querySelector('#btn-cancel-new-batch')?.addEventListener('click', () => {
    const form = container.querySelector('#new-batch-form-container');
    if (form) form.style.display = 'none';
  });

  // Create new batch
  container.querySelector('#btn-create-batch')?.addEventListener('click', async () => {
    const name = container.querySelector('#new-batch-name')?.value.trim();
    const start = container.querySelector('#new-batch-start')?.value;
    const chicks = container.querySelector('#new-batch-chicks')?.value;
    const chickCost = container.querySelector('#new-batch-chick-cost')?.value;
    const mt = container.querySelector('#new-batch-mt')?.value.trim();

    if (!name || !start || !chicks || Number(chicks) <= 0) {
      showToast('Please enter a valid batch name, start date, and chick count');
      return;
    }

    try {
      await Repository.createBatch({
        batch_name: name,
        start_date: start,
        initial_chick_count: Number(chicks),
        chick_cost: Number(chickCost) || 0,
        mortality_threshold_pct: mt === '' ? null : Number(mt)
      });
      showToast('Batch created successfully');
      onReload();
    } catch (err) {
      showToast(err.message || 'Failed to create batch');
    }
  });

  // Batch minimize / maximize toggle
  container.querySelectorAll('[data-action="toggle-batch-collapse"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const batchId = btn.getAttribute('data-batch-id');
      const collapsedSet = state.collapsedBatchIds || new Set();
      const isNowCollapsed = !collapsedSet.has(batchId);

      if (isNowCollapsed) {
        collapsedSet.add(batchId);
      } else {
        collapsedSet.delete(batchId);
      }
      try {
        localStorage.setItem('chickpence_collapsed_batches', JSON.stringify([...collapsedSet]));
      } catch (_) {}

      const body = container.querySelector(`#batch-body-${batchId}`);
      if (body) {
        body.style.display = isNowCollapsed ? 'none' : '';
      }
      btn.setAttribute('title', isNowCollapsed ? 'Maximize' : 'Minimize');
      btn.setAttribute('aria-label', `${isNowCollapsed ? 'Maximize' : 'Minimize'} batch`);
      btn.setAttribute('aria-expanded', String(!isNowCollapsed));
      btn.innerHTML = renderBatchToggleIcon(isNowCollapsed);

      const allToggleBtn = container.querySelector('#btn-toggle-all-open-batches');
      if (allToggleBtn && state.openBatchesData) {
        const allCollapsed =
          state.openBatchesData.length > 0 &&
          state.openBatchesData.every((d) => collapsedSet.has(d.batch.batch_id));
        allToggleBtn.textContent = allCollapsed ? '+ Maximize All' : '− Minimize All';
      }
    });
  });

  // Toggle all open batches
  container.querySelector('#btn-toggle-all-open-batches')?.addEventListener('click', () => {
    const collapsedSet = state.collapsedBatchIds || new Set();
    const allCollapsed =
      state.openBatchesData.length > 0 &&
      state.openBatchesData.every((d) => collapsedSet.has(d.batch.batch_id));
    if (allCollapsed) {
      state.openBatchesData.forEach((d) => collapsedSet.delete(d.batch.batch_id));
    } else {
      state.openBatchesData.forEach((d) => collapsedSet.add(d.batch.batch_id));
    }
    try {
      localStorage.setItem('chickpence_collapsed_batches', JSON.stringify([...collapsedSet]));
    } catch (_) {}
    onReload();
  });

  // Threshold editing
  container.querySelectorAll('[data-action="edit-threshold"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const batchId = btn.getAttribute('data-batch-id');
      const batch = state.openBatchesData.find((d) => d.batch.batch_id === batchId)?.batch;
      if (!batch) return;
      openThresholdModal(batch, async (updates) => {
        await Repository.updateBatchThresholds(batchId, updates);
        showToast('Thresholds updated');
        onReload();
      });
    });
  });

  // Mark as closed
  container.querySelectorAll('[data-action="close-batch"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const batchId = btn.getAttribute('data-batch-id');
      const batchData = state.openBatchesData.find((d) => d.batch.batch_id === batchId);
      if (!batchData) return;
      openCloseBatchModal(batchData.batch, batchData.sales.length, async () => {
        await Repository.closeBatch(batchId);
        showToast('Batch marked as closed');
        onNavigate('summary', batchId);
      });
    });
  });

  // Batch tab click → select that batch + tab
  container.querySelectorAll('[data-batch-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-batch-tab');
      const batchId = btn.getAttribute('data-batch-id');
      onSelectBatch(batchId);
      onTabChange(tab);
    });
  });

  // Helper: show / hide the entry modal
  const getModal = () => container.querySelector('#entry-modal-backdrop');
  const showModal = () => { const m = getModal(); if (m) m.style.display = 'flex'; };
  const hideModal = () => { const m = getModal(); if (m) m.style.display = 'none'; };

  // Auto-show modal when re-rendering in edit mode or after a tab-switch
  if (_batchModalOpen || state.editingItem) showModal();

  // Close modal button
  container.querySelector('[data-action="close-modal"]')?.addEventListener('click', () => {
    _batchModalOpen = false;
    hideModal();
    onCancelEdit();
  });

  // Panel tab buttons (inside modal tabs OR the "+ Add" action buttons)
  container.querySelectorAll('[data-panel-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-panel-tab');
      _batchModalOpen = true;
      onTabChange(tab);
    });
  });

  // Table row edit / delete
  container.querySelectorAll('[data-action="edit-row"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _batchModalOpen = false; // editingItem being set will auto-show modal
      onSetEdit(btn.getAttribute('data-table'), btn.getAttribute('data-id'));
    });
  });

  container.querySelectorAll('[data-action="delete-row"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      await Repository.deleteRecord(btn.getAttribute('data-table'), btn.getAttribute('data-id'));
      showToast('Entry deleted');
      onReload();
    });
  });

  // Expense table
  container.querySelectorAll('[data-action="void-expense"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Void this expense entry?')) return;
      await Repository.voidExpense(btn.getAttribute('data-id'));
      showToast('Expense voided');
      onReload();
    });
  });

  // Cancel edit
  container.querySelector('#btn-cancel-edit')?.addEventListener('click', onCancelEdit);

  // Live sales total
  const saleKg = container.querySelector('#input-sale-kg');
  const salePpk = container.querySelector('#input-sale-ppk');
  const liveSaleTotal = container.querySelector('#live-sale-total');

  const updateSaleTotal = () => {
    if (saleKg && salePpk && liveSaleTotal) {
      liveSaleTotal.textContent = formatPeso((Number(saleKg.value) || 0) * (Number(salePpk.value) || 0));
    }
  };
  saleKg?.addEventListener('input', updateSaleTotal);
  salePpk?.addEventListener('input', updateSaleTotal);

  // Table row edit / delete — editing an existing row also opens the modal
  container.querySelectorAll('[data-action="edit-expense"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _batchModalOpen = false; // editingItem being set will trigger auto-show
      onTabChange('Expenses');
      onSetEdit('expenses', btn.getAttribute('data-id'));
    });
  });

  // Expense preview
  container.querySelector('#btn-preview-expense')?.addEventListener('click', async () => {
    const date = container.querySelector('#input-exp-date')?.value;
    const feed = Number(container.querySelector('#input-exp-feed')?.value) || 0;
    const other = Number(container.querySelector('#input-exp-other')?.value) || 0;
    if (!date) return showToast('Please select a date');
    if (feed === 0 && other === 0) return showToast('At least one of Feed or Other costs must be > 0');
    await onExpensePreview(date, feed, other);
  });

  // Save expense
  container.querySelector('#btn-save-expense')?.addEventListener('click', async () => {
    const date = container.querySelector('#input-exp-date')?.value;
    const feed = Number(container.querySelector('#input-exp-feed')?.value) || 0;
    const other = Number(container.querySelector('#input-exp-other')?.value) || 0;

    try {
      await Repository.saveExpense({
        expense_id: state.editingItem?.expense_id,
        entry_date: date,
        feed_amount: feed,
        other_amount: other
      });
      showToast(state.editingItem ? 'Expense updated' : 'Expense saved · queued for sync');
      _batchModalOpen = false;
      onCancelEdit();
    } catch (err) {
      showToast(err.message || 'Failed to save expense');
    }
  });

  // Save feed / mortality / sales entry
  const saveBtn = container.querySelector('#btn-save-entry');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const selectedBatchId =
        container.querySelector('#input-batch-select')?.value || state.selectedBatchId;
      const editing = state.editingItem;

      try {
        if (state.activeTab === 'Feed') {
          const date = container.querySelector('#input-feed-date')?.value;
          const kg = Number(container.querySelector('#input-feed-kg')?.value);
          if (!date || !(kg > 0)) return showToast('Please enter date and positive quantity (kg)');
          if (!selectedBatchId) return showToast('Please select a batch');
          await Repository.saveFeedLog({
            feed_log_id: editing?.feed_log_id,
            batch_id: selectedBatchId,
            entry_date: date,
            quantity_kg: kg
          });
        } else if (state.activeTab === 'Mortality') {
          const date = container.querySelector('#input-mort-date')?.value;
          const deaths = Number(container.querySelector('#input-mort-deaths')?.value);
          if (!date || deaths < 0 || isNaN(deaths)) return showToast('Please enter date and valid death count');
          if (!selectedBatchId) return showToast('Please select a batch');
          await Repository.saveMortalityLog({
            mortality_id: editing?.mortality_id,
            batch_id: selectedBatchId,
            entry_date: date,
            count: deaths
          });
        } else {
          // Sales
          const date = container.querySelector('#input-sale-date')?.value;
          const buyer = container.querySelector('#input-sale-buyer')?.value.trim();
          const qty = Number(container.querySelector('#input-sale-qty')?.value);
          const kg = Number(container.querySelector('#input-sale-kg')?.value);
          const ppk = Number(container.querySelector('#input-sale-ppk')?.value);
          if (!date || !buyer || !(qty > 0) || !(kg > 0) || !(ppk > 0))
            return showToast('Please fill in all sale fields');
          if (!selectedBatchId) return showToast('Please select a batch');
          await Repository.saveSale({
            sale_id: editing?.sale_id,
            batch_id: selectedBatchId,
            sale_date: date,
            buyer_name: buyer,
            quantity_sold: qty,
            weight_kg: kg,
            price_per_kg: ppk
          });
        }

        showToast(editing ? 'Entry updated · queued for sync' : 'Entry saved · queued for sync');
        _batchModalOpen = false;
        onCancelEdit();
      } catch (err) {
        showToast(err.message || 'Failed to save entry');
      }
    });
  }
}
