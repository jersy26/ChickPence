import {
  formatPeso,
  formatPesoCentavos,
  formatPercent,
  formatNumber,
  formatDate,
  filterActive,
  sumField
} from '../services/calculations.js';
import { calcBatchMetrics } from '../services/allocationEngine.js';

const NA = 'N/A';

function metricVal(val, formatter = (v) => v) {
  if (val === NA) return `<span class="text-mut">N/A</span>`;
  return formatter(val);
}

export function renderSummary(batchData) {
  if (!batchData?.batch) {
    return `
      <div class="card-box" style="text-align: center; padding: 32px;">
        <h2>Batch Not Found</h2>
        <button class="btn-action primary" id="btn-summary-back" style="margin-top: 12px;">Back to History</button>
      </div>`;
  }

  const { batch, feed, mortality, sales, allocations } = batchData;
  const isOpen = batch.status === 'Open';

  const metrics = calcBatchMetrics(batch, allocations, sales, mortality, feed);

  // Cost breakdown (peso)
  const allocFeed = metrics.allocFeedPeso;
  const allocOther = metrics.allocOtherPeso;
  const chickCost = metrics.chickCost;
  const totalCost = metrics.totalCost;

  const maxCatCost = Math.max(chickCost, allocFeed, allocOther, 1);

  const barRow = (label, amount) => {
    const barPct = Math.max(Math.round((amount / maxCatCost) * 100), 2);
    return `
      <div class="bar-row">
        <span>${label}</span>
        <div style="flex:1;max-width:220px;background:var(--fill);border-radius:4px;height:14px;">
          <u style="width:${barPct}%;max-width:100%;"></u>
        </div>
        <i>${formatPeso(amount)}</i>
      </div>`;
  };

  const salesRowsHtml = sales.length
    ? sales.map((s) => `
        <tr>
          <td>${formatDate(s.sale_date)}</td>
          <td><b>${s.buyer_name}</b></td>
          <td>${Number(s.quantity_sold).toLocaleString()}</td>
          <td>${Number(s.weight_kg).toLocaleString()} kg</td>
          <td><b>${formatPeso(s.total_amount)}</b></td>
        </tr>`).join('')
    : `<tr><td colspan="5" class="text-mut" style="text-align:center;padding:18px;">No sales recorded.</td></tr>`;

  const isProfitable = typeof metrics.netProfit === 'number' && metrics.netProfit >= 0;

  const statusLabel = isOpen
    ? `<span class="badge-pill" style="background:var(--acc-light,#e3f0ff);color:var(--acc);">Open</span>`
    : `<span class="badge-pill">Closed</span>`;

  const provisionalNote = isOpen
    ? `<div class="text-mut" style="font-size:12px;margin-top:2px;">Provisional — batch still open</div>`
    : `<div class="text-mut" style="font-size:12px;margin-top:2px;">Final</div>`;

  return `
    <div class="top-bar">
      <div class="flex-row" style="gap: 12px;">
        <button class="btn-icon" id="btn-summary-back" title="Back to History" style="font-size: 20px;">←</button>
        <div>
          <h1 style="display:inline-block;">${batch.batch_name}</h1>
          ${statusLabel}
        </div>
      </div>
      <span class="text-mut">
        ${formatDate(batch.start_date, true)} – ${batch.end_date ? formatDate(batch.end_date, true) : 'Present'} · Summary Report
      </span>
    </div>

    ${provisionalNote}

    <div class="grid-4">
      <div class="card-box kpi-card">
        <span class="text-mut">Total Production Cost</span>
        <b>${formatPeso(totalCost)}</b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Total Sales Revenue</span>
        <b>${formatPeso(metrics.revenue)}</b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Net Profit</span>
        <b style="color: ${typeof metrics.netProfit === 'number' && !isProfitable ? 'var(--bad)' : 'inherit'}">
          ${formatPeso(metrics.netProfit)}
        </b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Profit Margin</span>
        <b>${metricVal(metrics.margin, (v) => formatPercent(v))}</b>
      </div>
    </div>

    <div class="grid-4" style="margin-top:8px;">
      <div class="card-box kpi-card">
        <span class="text-mut">Cost per kg</span>
        <b>${metricVal(metrics.costPerKg, (v) => formatPeso(v))}</b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Profit per kg</span>
        <b>${metricVal(metrics.profitPerKg, (v) => formatPeso(v))}</b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">FCR (Sales-based)</span>
        <b>${metricVal(metrics.fcr, (v) => Number(v).toFixed(2))}</b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Return on Batch Cost</span>
        <b>${metricVal(metrics.robc, (v) => formatPercent(v))}</b>
      </div>
    </div>

    <div class="grid-4" style="margin-top:8px;">
      <div class="card-box kpi-card">
        <span class="text-mut">Mortality Rate</span>
        <b>${formatPercent(metrics.mortalityRate)}</b>
        <span class="text-mut" style="font-size:11px;">${metrics.totalDeaths.toLocaleString()} deaths / ${batch.initial_chick_count.toLocaleString()}</span>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Feed Consumed</span>
        <b>${metrics.totalFeedKg.toLocaleString()} kg</b>
      </div>
    </div>

    <div class="dashboard-split" style="grid-template-columns: 1fr 1fr; margin-top: 12px;">
      <div class="card-box">
        <h2>Cost Breakdown</h2>
        <span class="text-mut">Feed consumed: <b>${metrics.totalFeedKg.toLocaleString()} kg</b></span>
        <div class="breakdown-bars" style="margin-top:8px;">
          ${barRow('Chicks', chickCost)}
          ${barRow('Feed', allocFeed)}
          ${barRow('Other Costs', allocOther)}
        </div>
      </div>

      <div class="card-box">
        <h2>Sales Transactions</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Buyer</th><th>Qty</th><th>Weight</th><th>Total</th></tr>
            </thead>
            <tbody>${salesRowsHtml}</tbody>
          </table>
        </div>
        <div class="text-mut" style="margin-top:8px;border-top:1px dashed var(--ln);padding-top:8px;">
          Mortality: <b>${metrics.totalDeaths.toLocaleString()}</b> of ${batch.initial_chick_count.toLocaleString()} chicks (${formatPercent(metrics.mortalityRate)})
          ${batch.mortality_threshold_pct != null ? ` · Threshold: ${batch.mortality_threshold_pct}%` : ''}
        </div>
      </div>
    </div>
  `;
}

export function attachSummaryListeners(container, onNavigate) {
  container.querySelector('#btn-summary-back')?.addEventListener('click', () => {
    onNavigate('history');
  });
}
