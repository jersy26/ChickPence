import {
  calcDailyCostRowTotal,
  calcTotalProductionCost,
  calcTotalRevenue,
  calcMortalityMetrics,
  calcRunningMortalityList,
  evaluateBatchWarnings,
  formatPeso,
  formatPercent,
  formatDate
} from '../services/calculations.js';
import { Repository } from '../services/repository.js';
import { openThresholdModal, openCompleteBatchModal } from './modals.js';
import { showToast } from './toast.js';

const TODAY = new Date().toISOString().slice(0, 10);

function renderDataTable(activeTab, batchData, onEditEntry, onDeleteEntry) {
  const { batch, costs, feed, mortality, sales } = batchData;

  const editBtn = (table, id) => `
    <button class="btn-icon" data-action="edit-row" data-table="${table}" data-id="${id}" title="Edit entry">
      ✎
    </button>
    <button class="btn-icon" data-action="delete-row" data-table="${table}" data-id="${id}" title="Delete entry" style="color: var(--bad); margin-left: 2px;">
      ✕
    </button>
  `;

  const emptyRow = (cols) => `
    <tr>
      <td colspan="${cols}" class="text-mut" style="text-align: center; padding: 24px;">No records recorded yet.</td>
    </tr>
  `;

  if (activeTab === 'Costs') {
    const rows = [...costs].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
    return `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Feed</th>
            <th>Med.</th>
            <th>Util.</th>
            <th>Labor</th>
            <th>Transp.</th>
            <th>Other</th>
            <th>Total</th>
            <th style="width: 70px;"></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (c) => `
              <tr>
                <td>${formatDate(c.entry_date)}</td>
                <td>${formatPeso(c.feed_cost)}</td>
                <td>${formatPeso(c.medicine_cost)}</td>
                <td>${formatPeso(c.utilities_cost)}</td>
                <td>${formatPeso(c.labor_cost)}</td>
                <td>${formatPeso(c.transport_cost)}</td>
                <td>${formatPeso(c.other_cost)}</td>
                <td><b>${formatPeso(calcDailyCostRowTotal(c))}</b></td>
                <td>${editBtn('daily_costs', c.cost_id)}</td>
              </tr>
            `
                  )
                  .join('')
              : emptyRow(9)
          }
        </tbody>
      </table>
    `;
  }

  if (activeTab === 'Feed') {
    const rows = [...feed].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
    return `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Feed Type</th>
            <th>Quantity (kg)</th>
            <th style="width: 70px;"></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (f) => `
              <tr>
                <td>${formatDate(f.entry_date)}</td>
                <td><span class="badge-pill">${f.feed_type}</span></td>
                <td><b>${Number(f.quantity_kg).toLocaleString()} kg</b></td>
                <td>${editBtn('feed_logs', f.feed_log_id)}</td>
              </tr>
            `
                  )
                  .join('')
              : emptyRow(4)
          }
        </tbody>
      </table>
    `;
  }

  if (activeTab === 'Mortality') {
    const runningList = calcRunningMortalityList(batch, mortality).reverse();
    return `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Deaths</th>
            <th>Cumulative</th>
            <th>Mortality Rate</th>
            <th style="width: 70px;"></th>
          </tr>
        </thead>
        <tbody>
          ${
            runningList.length
              ? runningList
                  .map(
                    (m) => `
              <tr>
                <td>${formatDate(m.entry_date)}</td>
                <td><b>${m.count}</b></td>
                <td>${m.runningCount}</td>
                <td>${formatPercent(m.runningRate)}</td>
                <td>${editBtn('mortality_logs', m.mortality_id)}</td>
              </tr>
            `
                  )
                  .join('')
              : emptyRow(5)
          }
        </tbody>
      </table>
    `;
  }

  // Sales Tab
  const rows = [...sales].sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1));
  return `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Buyer</th>
          <th>Qty (Heads)</th>
          <th>Weight (kg)</th>
          <th>Price / kg</th>
          <th>Total</th>
          <th style="width: 70px;"></th>
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (s) => `
            <tr>
              <td>${formatDate(s.sale_date)}</td>
              <td><b>${s.buyer_name}</b></td>
              <td>${Number(s.quantity_sold).toLocaleString()}</td>
              <td>${Number(s.weight_kg).toLocaleString()} kg</td>
              <td>${formatPeso(s.price_per_kg)}</td>
              <td><b>${formatPeso(s.total_amount)}</b></td>
              <td>${editBtn('sales', s.sale_id)}</td>
            </tr>
          `
                )
                .join('')
            : emptyRow(7)
        }
      </tbody>
    </table>
  `;
}

function renderEntryFormPanel(activeTab, editingItem) {
  const val = (field, fallback = '') => (editingItem ? editingItem[field] ?? fallback : fallback);

  let fieldsHtml = '';
  if (activeTab === 'Costs') {
    fieldsHtml = `
      <label class="form-field">
        Date
        <input id="input-cost-date" type="date" value="${val('entry_date', TODAY)}" />
      </label>
      <label class="form-field">
        Feed Cost (₱)
        <input id="input-cost-feed" type="number" min="0" step="any" placeholder="0.00" value="${val('feed_cost', '')}" />
      </label>
      <label class="form-field">
        Medicine / Vitamins (₱)
        <input id="input-cost-med" type="number" min="0" step="any" placeholder="0.00" value="${val('medicine_cost', '')}" />
      </label>
      <label class="form-field">
        Utilities (Electricity / Water ₱)
        <input id="input-cost-util" type="number" min="0" step="any" placeholder="0.00" value="${val('utilities_cost', '')}" />
      </label>
      <label class="form-field">
        Labor Cost (₱)
        <input id="input-cost-labor" type="number" min="0" step="any" placeholder="0.00" value="${val('labor_cost', '')}" />
      </label>
      <label class="form-field">
        Transportation (₱)
        <input id="input-cost-trans" type="number" min="0" step="any" placeholder="0.00" value="${val('transport_cost', '')}" />
      </label>
      <label class="form-field">
        Other / Miscellaneous (₱)
        <input id="input-cost-other" type="number" min="0" step="any" placeholder="0.00" value="${val('other_cost', '')}" />
      </label>
    `;
  } else if (activeTab === 'Feed') {
    const curType = val('feed_type', 'Starter');
    fieldsHtml = `
      <label class="form-field">
        Date
        <input id="input-feed-date" type="date" value="${val('entry_date', TODAY)}" />
      </label>
      <label class="form-field">
        Feed Type
        <select id="input-feed-type">
          <option ${curType === 'Starter' ? 'selected' : ''}>Starter</option>
          <option ${curType === 'Grower' ? 'selected' : ''}>Grower</option>
          <option ${curType === 'Finisher' ? 'selected' : ''}>Finisher</option>
        </select>
      </label>
      <label class="form-field">
        Quantity Consumed (kg)
        <input id="input-feed-kg" type="number" min="0.01" step="any" placeholder="0.00" value="${val('quantity_kg', '')}" />
      </label>
    `;
  } else if (activeTab === 'Mortality') {
    fieldsHtml = `
      <label class="form-field">
        Date
        <input id="input-mort-date" type="date" value="${val('entry_date', TODAY)}" />
      </label>
      <label class="form-field">
        Number of Deaths
        <input id="input-mort-deaths" type="number" min="0" step="1" placeholder="0" value="${val('count', '')}" />
      </label>
    `;
  } else {
    // Sales Tab
    const kg = Number(val('weight_kg', 0));
    const ppk = Number(val('price_per_kg', 0));
    const initialTotal = +(kg * ppk).toFixed(2);

    fieldsHtml = `
      <label class="form-field">
        Sale Date
        <input id="input-sale-date" type="date" value="${val('sale_date', TODAY)}" />
      </label>
      <label class="form-field">
        Buyer Name
        <input id="input-sale-buyer" type="text" placeholder="e.g. Aling Nena Dressing Plant" value="${val('buyer_name', '')}" />
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
    `;
  }

  const tabButtons = ['Costs', 'Feed', 'Mortality', 'Sales']
    .map(
      (t) => `
      <button class="${activeTab === t ? 'active' : ''}" data-panel-tab="${t}">
        ${t === 'Costs' ? 'Cost' : t === 'Sales' ? 'Sale' : t}
      </button>
    `
    )
    .join('');

  return `
    <div class="side-panel">
      <div class="tab-nav" style="margin: -4px -4px 4px;">
        ${tabButtons}
      </div>

      ${
        editingItem
          ? `<div class="ok-line flex-row">
               <span>Editing Entry</span>
               <button class="btn-link" id="btn-cancel-edit">Cancel</button>
             </div>`
          : ''
      }

      ${fieldsHtml}

      <button class="btn-action primary" id="btn-save-entry" style="margin-top: 4px;">
        ${editingItem ? 'Save Changes' : 'Save Entry'}
      </button>
    </div>
  `;
}

export function renderActiveBatch(batchData, activeTab = 'Costs', editingItem = null) {
  if (!batchData?.batch) {
    return `
      <h1>Active Batch</h1>
      <div class="text-mut">No active batch right now. Only one batch can be active at a time.</div>
      <div class="card-box" style="max-width: 480px; margin-top: 14px;">
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
        <label class="form-field">
          Cost Budget (₱) · optional
          <input id="new-batch-cb" type="number" min="0" step="any" value="1700000" placeholder="e.g. 1700000" />
        </label>
        <button class="btn-action primary" id="btn-create-batch" style="margin-top: 10px;">
          Create Batch
        </button>
      </div>
    `;
  }

  const { batch, costs, feed, mortality, sales } = batchData;
  const warnings = evaluateBatchWarnings(batch, costs, mortality);
  const totalCost = calcTotalProductionCost(batch, costs);
  const totalRevenue = calcTotalRevenue(sales);
  const { totalDeaths } = calcMortalityMetrics(batch, mortality);

  const tabButtons = ['Costs', 'Feed', 'Mortality', 'Sales']
    .map(
      (t) => `
      <button class="${activeTab === t ? 'active' : ''}" data-batch-tab="${t}">
        ${t}
      </button>
    `
    )
    .join('');

  return `
    <div class="top-bar">
      <div class="flex-row" style="gap: 10px;">
        <button class="btn-icon" id="btn-back-to-dash" title="Back to Dashboard" style="font-size: 20px;">
          ←
        </button>
        <h1>${batch.batch_name}</h1>
        <span class="badge-pill">Active</span>
      </div>
      <div class="flex-row" style="gap: 8px;">
        <button class="btn-action" id="btn-active-edit-threshold">✎ Edit Thresholds</button>
      </div>
    </div>

    <div class="split-layout">
      <div class="split-left">
        ${
          warnings.mortalityFlag
            ? `<div class="flag-alert">
                 ⚠ Mortality ${formatPercent(warnings.mortalityRate)} is above the ${warnings.mortalityThreshold}% threshold
               </div>`
            : ''
        }
        ${
          warnings.costFlag
            ? `<div class="flag-alert">
                 ⚠ Cost ${formatPeso(warnings.totalCost)} is above the ${formatPeso(warnings.costBudget)} budget
               </div>`
            : ''
        }

        <div class="grid-3">
          <div class="card-box kpi-card">
            <span class="text-mut">Running Production Costs</span>
            <b>${formatPeso(totalCost)}</b>
          </div>
          <div class="card-box kpi-card">
            <span class="text-mut">Sales Revenue</span>
            <b>${formatPeso(totalRevenue)}</b>
          </div>
          <div class="card-box kpi-card">
            <span class="text-mut">Mortality</span>
            <b>${totalDeaths.toLocaleString()} / ${batch.initial_chick_count.toLocaleString()} (${formatPercent(warnings.mortalityRate)})</b>
          </div>
        </div>

        <div class="tab-nav">
          ${tabButtons}
        </div>

        <div class="card-box table-wrap">
          ${renderDataTable(activeTab, batchData)}
        </div>

        <div style="margin-top: 8px;">
          <button class="btn-action primary" id="btn-trigger-complete-batch">
            Complete Batch
          </button>
        </div>
      </div>

      ${renderEntryFormPanel(activeTab, editingItem)}
    </div>
  `;
}

export function attachActiveBatchListeners(container, state, callbacks) {
  const { onTabChange, onReload, onNavigate, onSetEdit, onCancelEdit } = callbacks;

  // New batch creation
  const createBatchBtn = container.querySelector('#btn-create-batch');
  if (createBatchBtn) {
    createBatchBtn.addEventListener('click', async () => {
      const name = container.querySelector('#new-batch-name').value.trim();
      const start = container.querySelector('#new-batch-start').value;
      const chicks = container.querySelector('#new-batch-chicks').value;
      const chickCost = container.querySelector('#new-batch-chick-cost').value;
      const mt = container.querySelector('#new-batch-mt').value.trim();
      const cb = container.querySelector('#new-batch-cb').value.trim();

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
          mortality_threshold_pct: mt === '' ? null : Number(mt),
          cost_budget: cb === '' ? null : Number(cb)
        });
        showToast('Batch created successfully');
        onReload();
      } catch (err) {
        showToast(err.message || 'Failed to create batch');
      }
    });
    return;
  }

  // Back button
  container.querySelector('#btn-back-to-dash')?.addEventListener('click', () => {
    onNavigate('dashboard');
  });

  // Thresholds modal
  container.querySelector('#btn-active-edit-threshold')?.addEventListener('click', () => {
    openThresholdModal(state.batchData.batch, async (updates) => {
      await Repository.updateBatchThresholds(state.batchData.batch.batch_id, updates);
      showToast('Thresholds updated');
      onReload();
    });
  });

  // Tab switching
  container.querySelectorAll('[data-batch-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-batch-tab');
      onTabChange(tab);
    });
  });

  container.querySelectorAll('[data-panel-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-panel-tab');
      onTabChange(tab);
    });
  });

  // Live sales total computation
  const saleKg = container.querySelector('#input-sale-kg');
  const salePpk = container.querySelector('#input-sale-ppk');
  const liveSaleTotal = container.querySelector('#live-sale-total');

  const updateSaleTotal = () => {
    if (saleKg && salePpk && liveSaleTotal) {
      const tot = (Number(saleKg.value) || 0) * (Number(salePpk.value) || 0);
      liveSaleTotal.textContent = formatPeso(tot);
    }
  };

  saleKg?.addEventListener('input', updateSaleTotal);
  salePpk?.addEventListener('input', updateSaleTotal);

  // Cancel edit button
  container.querySelector('#btn-cancel-edit')?.addEventListener('click', () => {
    onCancelEdit();
  });

  // Table row actions: Edit & Delete
  container.querySelectorAll('[data-action="edit-row"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const table = btn.getAttribute('data-table');
      const id = btn.getAttribute('data-id');
      onSetEdit(table, id);
    });
  });

  container.querySelectorAll('[data-action="delete-row"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const table = btn.getAttribute('data-table');
      const id = btn.getAttribute('data-id');
      if (confirm('Delete this entry?')) {
        await Repository.deleteRecord(table, id);
        showToast('Entry deleted');
        onReload();
      }
    });
  });

  // Save / Update entry button
  const saveBtn = container.querySelector('#btn-save-entry');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const batchId = state.batchData.batch.batch_id;
      const editing = state.editingItem;

      try {
        if (state.activeTab === 'Costs') {
          const date = container.querySelector('#input-cost-date').value;
          if (!date) return showToast('Please select a date');

          await Repository.saveDailyCost({
            cost_id: editing?.cost_id,
            batch_id: batchId,
            entry_date: date,
            feed_cost: container.querySelector('#input-cost-feed').value,
            medicine_cost: container.querySelector('#input-cost-med').value,
            utilities_cost: container.querySelector('#input-cost-util').value,
            labor_cost: container.querySelector('#input-cost-labor').value,
            transport_cost: container.querySelector('#input-cost-trans').value,
            other_cost: container.querySelector('#input-cost-other').value
          });
        } else if (state.activeTab === 'Feed') {
          const date = container.querySelector('#input-feed-date').value;
          const type = container.querySelector('#input-feed-type').value;
          const kg = Number(container.querySelector('#input-feed-kg').value);

          if (!date || !type || !(kg > 0)) {
            return showToast('Please enter date, feed type, and positive quantity (kg)');
          }

          await Repository.saveFeedLog({
            feed_log_id: editing?.feed_log_id,
            batch_id: batchId,
            entry_date: date,
            feed_type: type,
            quantity_kg: kg
          });
        } else if (state.activeTab === 'Mortality') {
          const date = container.querySelector('#input-mort-date').value;
          const deaths = Number(container.querySelector('#input-mort-deaths').value);

          if (!date || deaths < 0 || isNaN(deaths)) {
            return showToast('Please enter date and valid number of deaths');
          }

          await Repository.saveMortalityLog({
            mortality_id: editing?.mortality_id,
            batch_id: batchId,
            entry_date: date,
            count: deaths
          });
        } else {
          // Sales Tab
          const date = container.querySelector('#input-sale-date').value;
          const buyer = container.querySelector('#input-sale-buyer').value.trim();
          const qty = Number(container.querySelector('#input-sale-qty').value);
          const kg = Number(container.querySelector('#input-sale-kg').value);
          const ppk = Number(container.querySelector('#input-sale-ppk').value);

          if (!date || !buyer || !(qty > 0) || !(kg > 0) || !(ppk > 0)) {
            return showToast('Please fill in buyer, positive quantity, weight, and price');
          }

          await Repository.saveSale({
            sale_id: editing?.sale_id,
            batch_id: batchId,
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

  // Complete Batch trigger
  container.querySelector('#btn-trigger-complete-batch')?.addEventListener('click', () => {
    openCompleteBatchModal(state.batchData.batch, state.batchData.sales.length, async () => {
      await Repository.completeBatch(state.batchData.batch.batch_id);
      showToast('Batch completed');
      onNavigate('summary', state.batchData.batch.batch_id);
    });
  });
}
