import {
  calcCostBreakdown,
  calcTotalProductionCost,
  calcHighestCostCategory,
  calcTotalRevenue,
  calcNetProfit,
  calcProfitMargin,
  calcTotalFeedConsumed,
  calcMortalityMetrics,
  formatPeso,
  formatPercent,
  formatDate
} from '../services/calculations.js';

export function renderSummary(batchData) {
  if (!batchData?.batch) {
    return `
      <div class="card-box" style="text-align: center; padding: 32px;">
        <h2>Batch Not Found</h2>
        <button class="btn-action primary" id="btn-summary-back" style="margin-top: 12px;">Back to History</button>
      </div>
    `;
  }

  const { batch, costs, feed, mortality, sales } = batchData;

  const costBreakdown = calcCostBreakdown(batch, costs);
  const totalCost = calcTotalProductionCost(batch, costs);
  const totalRev = calcTotalRevenue(sales);
  const netProfit = calcNetProfit(totalRev, totalCost);
  const margin = calcProfitMargin(netProfit, totalRev);
  const feedConsumedKg = calcTotalFeedConsumed(feed);
  const highestCategory = calcHighestCostCategory(costBreakdown);
  const { totalDeaths, mortalityRate } = calcMortalityMetrics(batch, mortality);

  const maxCategoryCost = Math.max(...Object.values(costBreakdown), 1);

  const isProfitable = netProfit >= 0;

  const costBarsHtml = Object.entries(costBreakdown)
    .map(([catName, amount]) => {
      const barPct = Math.max(Math.round((amount / maxCategoryCost) * 100), 2);
      return `
        <div class="bar-row">
          <span>${catName}</span>
          <div style="flex: 1; max-width: 220px; background: var(--fill); border-radius: 4px; height: 14px;">
            <u style="width: ${barPct}%; max-width: 100%;"></u>
          </div>
          <i>${formatPeso(amount)}</i>
        </div>
      `;
    })
    .join('');

  const salesRowsHtml = sales.length
    ? sales
        .map(
          (s) => `
        <tr>
          <td>${formatDate(s.sale_date)}</td>
          <td><b>${s.buyer_name}</b></td>
          <td>${Number(s.quantity_sold).toLocaleString()}</td>
          <td>${Number(s.weight_kg).toLocaleString()} kg</td>
          <td><b>${formatPeso(s.total_amount)}</b></td>
        </tr>
      `
        )
        .join('')
    : `
      <tr>
        <td colspan="5" class="text-mut" style="text-align: center; padding: 18px;">No sales transactions were recorded for this batch.</td>
      </tr>
    `;

  return `
    <div class="top-bar">
      <div class="flex-row" style="gap: 12px;">
        <button class="btn-icon" id="btn-summary-back" title="Back to History" style="font-size: 20px;">
          ←
        </button>
        <div>
          <h1 style="display: inline-block;">${batch.batch_name}</h1>
          <span class="badge-pill" style="margin-left: 8px;">${batch.status}</span>
        </div>
      </div>
      <span class="text-mut">
        ${formatDate(batch.start_date, true)} – ${batch.end_date ? formatDate(batch.end_date, true) : 'Present'} · Read-only Summary Report
      </span>
    </div>

    <div class="grid-4">
      <div class="card-box kpi-card">
        <span class="text-mut">Total Production Cost</span>
        <b>${formatPeso(totalCost)}</b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Total Sales Revenue</span>
        <b>${formatPeso(totalRev)}</b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Net Profit</span>
        <b style="color: ${isProfitable ? 'inherit' : 'var(--bad)'}">
          ${formatPeso(netProfit)}
        </b>
      </div>
      <div class="card-box kpi-card">
        <span class="text-mut">Profit Margin</span>
        <b>${formatPercent(margin)}</b>
      </div>
    </div>

    <div class="dashboard-split" style="grid-template-columns: 1fr 1fr;">
      <div class="card-box">
        <h2>Cost Breakdown</h2>
        <span class="text-mut">
          Highest Cost: <b>${highestCategory.category}</b> (${formatPeso(highestCategory.amount)}) · Feed consumed: <b>${feedConsumedKg.toLocaleString()} kg</b>
        </span>
        <div class="breakdown-bars" style="margin-top: 8px;">
          ${costBarsHtml}
        </div>
      </div>

      <div class="card-box">
        <h2>Sales Transactions</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Buyer</th>
                <th>Qty</th>
                <th>Weight</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${salesRowsHtml}
            </tbody>
          </table>
        </div>
        <div class="text-mut" style="margin-top: 8px; border-top: 1px dashed var(--ln); padding-top: 8px;">
          Mortality: <b>${totalDeaths.toLocaleString()}</b> of ${batch.initial_chick_count.toLocaleString()} chicks (${formatPercent(mortalityRate)})
          ${batch.mortality_threshold_pct != null ? ` · Threshold limit: ${batch.mortality_threshold_pct}%` : ''}
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
