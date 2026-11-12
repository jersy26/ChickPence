import {
  formatPeso,
  formatPesoCentavos,
  formatPercent,
  formatNumber,
  formatDate,
  filterActive,
  sumField
} from '../services/calculations.js';
import { calcBatchMetrics, sharedCostByBasis, leftoverHoldingCost } from '../services/allocationEngine.js';
import { renderExportButton, attachExportButton } from './exportMenu.js';
import { renderInsightsCard } from './insightsCard.js';
import { escapeHtml } from './html.js';

const NA = 'N/A';

function metricVal(val, formatter = (v) => v) {
  if (val === NA) return `<span class="text-mut">Not available</span>`;
  return formatter(val);
}

const signedPeso = (centavos) => (centavos > 0 ? '+' : '') + formatPesoCentavos(centavos);

/**
 * The batch's total cost under each way of sharing the daily costs (thesis
 * Table 18). Only the shared costs move; the chick cost stays on the batch.
 */
function renderSharingComparison(batch, chickCost, farm) {
  const shared = sharedCostByBasis(batch.batch_id, farm.expenses, farm.batches, farm.mortality, farm.sales);
  if (!shared.live && !shared.initial && !shared.equal) return '';
  const chick = Math.round(chickCost * 100);
  const rules = [
    ['Live birds (used by the app)', shared.live],
    ['Initial chicks', shared.initial],
    ['Equal split', shared.equal]
  ];
  const rows = rules.map(([label, cents], i) => `
        <tr>
          <td>${i === 0 ? `<b>${label}</b>` : label}</td>
          <td>${formatPesoCentavos(cents)}</td>
          <td><b>${formatPesoCentavos(chick + cents)}</b></td>
          <td>${i === 0 ? '—' : signedPeso(cents - shared.live)}</td>
        </tr>`).join('');
  const same = shared.live === shared.initial && shared.live === shared.equal;
  return `
    <div class="card-box" style="margin-top: 12px;">
      <h2>Cost under other sharing rules</h2>
      <span class="text-mut">What this batch would have cost if shared daily costs were split another way.</span>
      <div class="table-wrap" style="margin-top:8px;">
        <table>
          <thead><tr><th>Sharing rule</th><th>Shared costs</th><th>Total recorded cost</th><th>Difference</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-mut" style="margin-top:8px;font-size:12px;">
        ${same
          ? 'This batch never shared a day with another batch, so every rule gives the same cost.'
          : `The chick cost (${formatPesoCentavos(chick)}) is the same under every rule. Live birds is the owner-approved rule; the others show how much the choice matters.`}
      </div>
    </div>`;
}

/** What the batch's leftover birds have cost since a newer batch arrived. */
function renderLeftoverCost(batch, batchData, farm) {
  const r = leftoverHoldingCost(batch, {
    batches: farm.batches,
    expenses: farm.expenses,
    allocations: batchData.allocations,
    mortality: batchData.mortality,
    sales: batchData.sales,
    feed: batchData.feed,
    today: farm.today
  });
  if (!r || !r.holdingCentavos) return '';
  const open = batch.status === 'Open';
  return `
    <div class="card-box" style="margin-top: 12px;">
      <h2>Leftover birds</h2>
      <span class="text-mut">
        Since ${escapeHtml(r.newerBatchName)} started on ${formatDate(r.since, true)}, this batch's birds have shared the farm's daily costs with it.
      </span>
      <div class="grid-4" style="margin-top:8px;">
        <div class="kpi-card">
          <span class="text-mut">Cost since then</span>
          <b>${formatPesoCentavos(r.holdingCentavos)}</b>
          <span class="text-mut" style="font-size:11px;">over ${r.days.toLocaleString()} day${r.days === 1 ? '' : 's'}</span>
        </div>
        <div class="kpi-card">
          <span class="text-mut">Cost per day lately</span>
          <b>${formatPesoCentavos(r.perDayCentavos)}</b>
          <span class="text-mut" style="font-size:11px;">average of the last 7 days</span>
        </div>
        ${open && r.perBirdCentavos != null ? `
        <div class="kpi-card">
          <span class="text-mut">Still to earn back per bird</span>
          <b>${formatPesoCentavos(r.perBirdCentavos)}</b>
          <span class="text-mut" style="font-size:11px;">${r.liveBirds.toLocaleString()} live birds share ${formatPesoCentavos(r.unrecoveredCentavos)}</span>
        </div>` : ''}
      </div>
      ${open ? `<div class="text-mut" style="margin-top:8px;font-size:12px;">Every extra day adds about ${formatPesoCentavos(r.perDayCentavos)} to this batch. Use Price check to test a buyer's offer for the remaining birds.</div>` : ''}
    </div>`;
}

export function renderSummary(batchData, insights = null, farm = null) {
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
          <td><b>${escapeHtml(s.buyer_name)}</b></td>
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
          <h1 style="display:inline-block;">${escapeHtml(batch.batch_name)}</h1>
          ${statusLabel}
        </div>
      </div>
      <span class="text-mut">
        ${formatDate(batch.start_date, true)} – ${batch.end_date ? formatDate(batch.end_date, true) : 'Present'} · Summary Report
      </span>
    </div>

    <div class="flex-row" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
      ${provisionalNote}
      ${renderExportButton('summary')}
    </div>

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
          ${batch.mortality_threshold_pct != null ? ` · Threshold: ${escapeHtml(batch.mortality_threshold_pct)}%` : ''}
        </div>
      </div>
    </div>

    ${farm ? renderLeftoverCost(batch, batchData, farm) : ''}
    ${farm ? renderSharingComparison(batch, chickCost, farm) : ''}

    ${insights ? `<div style="margin-top: 12px;">${renderInsightsCard(insights)}</div>` : ''}
  `;
}

export function attachSummaryListeners(container, onNavigate, onExport) {
  container.querySelector('#btn-summary-back')?.addEventListener('click', () => {
    onNavigate('history');
  });
  if (onExport) attachExportButton(container, 'summary', onExport);
}
