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
import { calcBatchMetrics, evalMortalityWarning, liveHeadCount } from '../services/allocationEngine.js';
import { Repository } from '../services/repository.js';
import { openThresholdModal, openCloseBatchModal } from './modals.js';
import { showToast } from './toast.js';

const TODAY = new Date().toISOString().slice(0, 10);
const NA = 'N/A';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function metricCell(val, formatter) {
  if (val === NA) return `<span class="text-mut">${NA}</span>`;
  return formatter(val);
}

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
              ? rows.map((f) => `
                <tr>
                  <td>${formatDate(f.entry_date)}</td>
                  <td><b>${Number(f.quantity_kg).toLocaleString()} kg</b></td>
                  <td>${editBtn('feed_logs', f.feed_log_id)}</td>
                </tr>`).join('')
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
// ENTRY FORM PANEL
// ---------------------------------------------------------------------------

function renderEntryFormPanel(activeTab, openBatches, selectedBatchId, editingItem, expensePreview) {
  const val = (field, fallback = '') => (editingItem ? (editingItem[field] ?? fallback) : fallback);

  if (activeTab === 'Expenses') {
    const feedVal = editingItem ? (editingItem.feed_centavos / 100).toFixed(2) : '';
    const otherVal = editingItem ? (editingItem.other_centavos / 100).toFixed(2) : '';

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
      <div class="side-panel">
        <div style="font-weight:600;margin-bottom:6px;">${editingItem ? 'Edit Expense' : 'New Farm Expense'}</div>
        ${editingItem ? `<div class="ok-line flex-row"><span>Editing Entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
        <label class="form-field">
          Date
          <input id="input-exp-date" type="date" value="${val('entry_date', TODAY)}" />
        </label>
        <label class="form-field">
          Feed Amount (₱)
          <input id="input-exp-feed" type="number" min="0" step="0.01" placeholder="0.00" value="${feedVal}" />
        </label>
        <label class="form-field">
          Other Costs (₱)
          <input id="input-exp-other" type="number" min="0" step="0.01" placeholder="0.00" value="${otherVal}" />
        </label>
        ${previewHtml}
        <button class="btn-action primary" id="btn-preview-expense" style="margin-top:4px;">
          ${expensePreview ? 'Refresh Preview' : 'Preview Allocation'}
        </button>
        <button class="btn-action primary" id="btn-save-expense" style="margin-top:4px;" ${!expensePreview ? 'disabled' : ''}>
          ${editingItem ? 'Save Changes' : 'Save Expense'}
        </button>
      </div>`;
  }

  const batchSelector = openBatches.length
    ? `<label class="form-field">
        Batch
        <select id="input-batch-select">
          ${renderBatchSelectorOptions(openBatches, selectedBatchId)}
        </select>
      </label>`
    : `<div class="text-mut">No open batches.</div>`;

  if (activeTab === 'Feed') {
    return `
      <div class="side-panel">
        <div style="font-weight:600;margin-bottom:6px;">${editingItem ? 'Edit Feed Log' : 'New Feed Log'}</div>
        ${editingItem ? `<div class="ok-line flex-row"><span>Editing Entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
        ${batchSelector}
        <label class="form-field">
          Date
          <input id="input-feed-date" type="date" value="${val('entry_date', TODAY)}" />
        </label>
        <label class="form-field">
          Quantity Consumed (kg)
          <input id="input-feed-kg" type="number" min="0.01" step="any" placeholder="0.00" value="${val('quantity_kg', '')}" />
        </label>
        <button class="btn-action primary" id="btn-save-entry" style="margin-top:4px;">
          ${editingItem ? 'Save Changes' : 'Save Entry'}
        </button>
      </div>`;
  }

  if (activeTab === 'Mortality') {
    return `
      <div class="side-panel">
        <div style="font-weight:600;margin-bottom:6px;">${editingItem ? 'Edit Mortality' : 'New Mortality Log'}</div>
        ${editingItem ? `<div class="ok-line flex-row"><span>Editing Entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
        ${batchSelector}
        <label class="form-field">
          Date
          <input id="input-mort-date" type="date" value="${val('entry_date', TODAY)}" />
        </label>
        <label class="form-field">
          Number of Deaths
          <input id="input-mort-deaths" type="number" min="0" step="1" placeholder="0" value="${val('count', '')}" />
        </label>
        <button class="btn-action primary" id="btn-save-entry" style="margin-top:4px;">
          ${editingItem ? 'Save Changes' : 'Save Entry'}
        </button>
      </div>`;
  }

  // Sales
  const kg = Number(val('weight_kg', 0));
  const ppk = Number(val('price_per_kg', 0));
  const initialTotal = +(kg * ppk).toFixed(2);

  return `
    <div class="side-panel">
      <div style="font-weight:600;margin-bottom:6px;">${editingItem ? 'Edit Sale' : 'New Sale'}</div>
      ${editingItem ? `<div class="ok-line flex-row"><span>Editing Entry</span><button class="btn-link" id="btn-cancel-edit">Cancel</button></div>` : ''}
      ${batchSelector}
      <label class="form-field">
        Sale Date
        <input id="input-sale-date" type="date" value="${val('sale_date', TODAY)}" />
      </label>
      <label class="form-field">
        Buyer Name
        <input id="input-sale-buyer" type="text" placeholder="e.g. Buyer (placeholder)" value="${val('buyer_name', '')}" />
      </label>
      <label class="form-field">
        Quantity Sold (heads)
        <input id="input-sale-qty" type="number" min="1" step="1" placeholder="0" value="${val('quantity_sold', '')}" />
      </label>
      <label class="form-field">
        Total Weight (kg)
        <input id="input-sale-kg" type="number" min="0.01" step="any" placeholder="0.00" value="${val('weight_kg', '')}" />
      </label>
      <label class="form-field">
        Price per kg (₱)
        <input id="input-sale-ppk" type="number" min="0.01" step="any" placeholder="0.00" value="${val('price_per_kg', '')}" />
      </label>
      <div class="ok-line flex-row">
        <span>Total Amount</span>
        <b id="live-sale-total">${formatPeso(initialTotal)}</b>
      </div>
      <button class="btn-action primary" id="btn-save-entry" style="margin-top:4px;">
        ${editingItem ? 'Save Changes' : 'Save Entry'}
      </button>
    </div>`;
}

// ---------------------------------------------------------------------------
// BATCH CARD (per open batch)
// ---------------------------------------------------------------------------

function renderOpenBatchCard(batchFullData, selectedBatchId, activeTab, editingItem, expensePreview, expenses) {
  const { batch, feed, mortality, sales, allocations } = batchFullData;
  const warn = evalMortalityWarning(batch, mortality);
  const metrics = calcBatchMetrics(batch, allocations, sales, mortality, feed);
  const liveHeads = liveHeadCount(batch, mortality, sales, TODAY);

  const isSelected = batch.batch_id === selectedBatchId;

  return `
    <div class="card-box" id="batch-card-${batch.batch_id}" style="margin-bottom: 14px;">
      <div class="flex-row" style="align-items: flex-start;">
        <div style="flex:1;">
          <div class="flex-row" style="gap: 8px;">
            <b style="font-size: 16px;">${batch.batch_name}</b>
            <span class="badge-pill" style="background: var(--acc-light, #e3f0ff); color: var(--acc);">Open</span>
            ${warn.mortalityFlag ? `<span class="badge-pill" style="background:var(--bad-light,#fff0f0);color:var(--bad);">⚠ Mortality</span>` : ''}
          </div>
          <div class="text-mut" style="font-size: 12px; margin-top: 2px;">
            Started ${formatDate(batch.start_date, true)} · ${batch.initial_chick_count.toLocaleString()} chicks initial · <b>${liveHeads.toLocaleString()}</b> live today
          </div>
        </div>
        <div class="flex-row" style="gap: 6px;">
          <button class="btn-action" data-action="edit-threshold" data-batch-id="${batch.batch_id}">✎ Thresholds</button>
          <button class="btn-action primary" data-action="close-batch" data-batch-id="${batch.batch_id}">Mark as closed</button>
        </div>
      </div>

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

      ${warn.mortalityFlag ? `<div class="flag-alert" style="margin-top:6px;">⚠ Mortality ${formatPercent(warn.mortalityRate)} exceeds threshold (${warn.mortalityThreshold}%)</div>` : ''}

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
    </div>`;
}

// ---------------------------------------------------------------------------
// MAIN RENDER
// ---------------------------------------------------------------------------

export function renderBatches(openBatchesData, expenses, selectedBatchId, activeTab, editingItem, expensePreview) {
  const TODAY = new Date().toISOString().slice(0, 10);

  const openBatches = openBatchesData.map((d) => d.batch);

  const expenseRows = renderExpenseTable(expenses, []);

  const batchCardsHtml = openBatchesData.length
    ? openBatchesData.map((bd) =>
        renderOpenBatchCard(bd, selectedBatchId, activeTab, editingItem, expensePreview, expenses)
      ).join('')
    : `<div class="card-box text-mut" style="padding:24px;text-align:center;">
        No open batches. Create one below.
      </div>`;

  const tabButtons = ['Expenses', 'Feed', 'Mortality', 'Sales'].map((t) => `
    <button class="${activeTab === t ? 'active' : ''}" data-panel-tab="${t}">${t}</button>
  `).join('');

  return `
    <div class="top-bar">
      <h1>Batches</h1>
      <button class="btn-action primary" id="btn-show-new-batch-form">+ New Batch</button>
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
    <div style="font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em;margin-bottom:6px;">
      Open Batches
    </div>
    ${batchCardsHtml}

    <!-- FARM-LEVEL EXPENSES + ENTRY PANEL -->
    <div class="split-layout" style="margin-top: 14px;">
      <div class="split-left">
        <div style="font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em;margin-bottom:6px;">
          Farm Expenses
        </div>
        <div class="card-box table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Feed</th><th>Other Costs</th><th>Total</th><th style="width:80px;"></th></tr>
            </thead>
            <tbody>${expenseRows}</tbody>
          </table>
        </div>
      </div>

      <div class="split-right">
        <div class="tab-nav" style="margin: -4px -4px 4px;">
          ${tabButtons}
        </div>
        ${renderEntryFormPanel(activeTab, openBatches, selectedBatchId, editingItem, expensePreview)}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// LISTENERS
// ---------------------------------------------------------------------------

export function attachBatchesListeners(container, state, callbacks) {
  const { onTabChange, onReload, onNavigate, onSetEdit, onCancelEdit, onSelectBatch, onExpensePreview } = callbacks;

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

  // Panel tab buttons
  container.querySelectorAll('[data-panel-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-panel-tab');
      onTabChange(tab);
    });
  });

  // Table row edit / delete
  container.querySelectorAll('[data-action="edit-row"]').forEach((btn) => {
    btn.addEventListener('click', () => {
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
  container.querySelectorAll('[data-action="edit-expense"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expId = btn.getAttribute('data-id');
      const exp = state.expenses.find((e) => e.expense_id === expId);
      if (exp) {
        onTabChange('Expenses');
        onSetEdit('expenses', expId);
      }
    });
  });

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
        onCancelEdit();
      } catch (err) {
        showToast(err.message || 'Failed to save entry');
      }
    });
  }
}
