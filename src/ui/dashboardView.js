import {
  calcTotalRevenue,
  calcDashboardAverages,
  filterActive,
  sumField,
  formatPeso,
  formatPercent,
  formatDate
} from '../services/calculations.js';
import { calcBatchMetrics, evalMortalityWarning, liveHeadCount } from '../services/allocationEngine.js';
import { openThresholdModal } from './modals.js';
import { Repository } from '../services/repository.js';
import { showToast } from './toast.js';

const TODAY = new Date().toISOString().slice(0, 10);

function renderNetProfitChart(last5Batches) {
  if (!last5Batches.length) {
    return `<div class="text-mut" style="padding: 24px; text-align: center;">No closed batches yet.</div>`;
  }

  const profits = last5Batches.map((item) => item.netProfit || 0);
  const maxVal = Math.max(0, ...profits);
  const minVal = Math.min(0, ...profits);

  const topPadding = 28;
  const bottomPadding = 188;
  const range = maxVal - minVal || 1;
  const scale = (bottomPadding - topPadding) / range;
  const zeroY = topPadding + maxVal * scale;
  const chartWidth = 520;
  const barSlotWidth = chartWidth / last5Batches.length;

  let barsSvg = '';
  last5Batches.forEach((item, index) => {
    const profit = item.netProfit || 0;
    const height = Math.max(Math.abs(profit) * scale, 3);
    const x = index * barSlotWidth + barSlotWidth * 0.18;
    const barWidth = barSlotWidth * 0.64;
    const y = profit >= 0 ? zeroY - height : zeroY;
    const isPos = profit >= 0;

    const labelK = `${profit < 0 ? '-' : ''}${Math.abs(Math.round(profit / 1000))}k`;
    const labelY = isPos ? y - 6 : y + height + 14;
    const batchShortName = item.batch.batch_name.replace(/^Batch\s*/i, '');

    barsSvg += `
      <g class="chart-bar-group" data-batch-id="${item.batch.batch_id}" style="cursor: pointer;">
        <title>${item.batch.batch_name}: ${formatPeso(profit)}</title>
        <rect class="b" x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="3" fill="${isPos ? 'var(--acc)' : 'var(--bad)'}"/>
        <text class="v" x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle">${labelK}</text>
        <text x="${x + barWidth / 2}" y="218" text-anchor="middle">${batchShortName}</text>
      </g>`;
  });

  return `
    <svg viewBox="0 0 520 232" width="100%" style="max-width: 520px; overflow: visible;">
      <line x1="0" x2="520" y1="${zeroY}" y2="${zeroY}" stroke="var(--ink)" stroke-width="1.5" opacity="0.6"/>
      ${barsSvg}
    </svg>`;
}

export function renderDashboard(openBatchesData, closedBatchesWithData) {
  // Build enriched closed batch data with netProfit for chart
  const enrichedClosed = closedBatchesWithData.map((item) => {
    const metrics = calcBatchMetrics(item.batch, item.allocations, item.sales, item.mortality, item.feed);
    return { ...item, netProfit: metrics.netProfit };
  });

  const { last5, avgNetProfit, avgSellingPricePerKg } = calcDashboardAverages(enrichedClosed);

  // Open batches summary cards
  const openCardsHtml = openBatchesData.length
    ? openBatchesData.map((item) => {
        const { batch, feed, mortality, sales, allocations } = item;
        const metrics = calcBatchMetrics(batch, allocations, sales, mortality, feed);
        const warn = evalMortalityWarning(batch, mortality);
        const liveHeads = liveHeadCount(batch, mortality, sales, TODAY);

        return `
          <div class="card-box" style="margin-bottom: 10px;">
            <div class="flex-row">
              <div>
                <b style="font-size: 15px;">${batch.batch_name}</b>
                <span class="badge-pill" style="margin-left: 8px; background:var(--acc-light,#e3f0ff);color:var(--acc);">Open</span>
                ${warn.mortalityFlag ? `<span class="badge-pill" style="margin-left:4px;background:var(--bad-light,#fff0f0);color:var(--bad);">⚠ Mortality</span>` : ''}
              </div>
              <span class="text-mut">Started ${formatDate(batch.start_date, true)} · <b>${liveHeads.toLocaleString()}</b> live</span>
            </div>
            <div class="grid-3" style="margin-top:6px;">
              <div class="card-box kpi-card">
                <span class="text-mut">Cost to Date</span>
                <b>${formatPeso(metrics.totalCost)}</b>
              </div>
              <div class="card-box kpi-card">
                <span class="text-mut">Sales to Date</span>
                <b>${formatPeso(metrics.revenue)}</b>
              </div>
              <div class="card-box kpi-card">
                <span class="text-mut">Mortality</span>
                <b>${formatPercent(metrics.mortalityRate)}</b>
              </div>
            </div>
            ${warn.mortalityFlag ? `<div class="flag-alert" style="margin-top:6px;">⚠ Mortality ${formatPercent(warn.mortalityRate)} exceeds threshold (${warn.mortalityThreshold}%)</div>` : ''}
          </div>`;
      }).join('')
    : `<div class="card-box" style="text-align:center;padding:24px;">
        <div class="text-mut" style="font-size:14px;">No open batches.</div>
        <button class="btn-action primary" data-action="go-batches" style="margin:10px auto 0;">+ Create New Batch</button>
      </div>`;

  return `
    <div class="top-bar">
      <h1>Dashboard</h1>
      <button class="btn-action primary" data-action="go-batches">Batches →</button>
    </div>

    <div class="text-mut" style="font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em;">
      Open Batches
    </div>
    ${openCardsHtml}

    <div class="dashboard-split">
      <div class="card-box">
        <h2>Last 5 Batches Net Profit</h2>
        <div class="chart-box">
          <div style="flex:1;min-width:280px;">${renderNetProfitChart(last5)}</div>
          <div style="flex:1;min-width:190px;display:flex;flex-direction:column;gap:10px;">
            <div class="card-box kpi-card">
              <span class="text-mut">Average Net Profit</span>
              <b>${formatPeso(avgNetProfit)}</b>
            </div>
            <div class="card-box kpi-card">
              <span class="text-mut">Average Selling Price / KG</span>
              <b>${formatPeso(avgSellingPricePerKg)}</b>
            </div>
          </div>
        </div>
        <span class="text-mut">Tap a bar to open that batch's full summary report. Closed batches only.</span>
      </div>

      <div class="card-box">
        <h2>Open Batch Warnings</h2>
        ${openBatchesData.length
          ? openBatchesData.map((item) => {
              const warn = evalMortalityWarning(item.batch, item.mortality);
              if (!warn.mortalityFlag && warn.mortalityThreshold == null) {
                return `<div class="ok-line text-mut">${item.batch.batch_name}: no mortality threshold set</div>`;
              }
              if (warn.mortalityFlag) {
                return `<div class="flag-alert"><span>⚠ ${item.batch.batch_name}: Mortality ${formatPercent(warn.mortalityRate)} exceeds ${warn.mortalityThreshold}%</span></div>`;
              }
              return `<div class="ok-line">✓ ${item.batch.batch_name}: Mortality ${formatPercent(warn.mortalityRate)} / limit ${warn.mortalityThreshold}%</div>`;
            }).join('')
          : `<div class="text-mut">No open batches to monitor.</div>`
        }
      </div>
    </div>
  `;
}

export function attachDashboardListeners(container, onNavigate, onReload) {
  container.querySelectorAll('[data-action="go-batches"]').forEach((btn) => {
    btn.addEventListener('click', () => onNavigate('batches'));
  });

  container.querySelectorAll('.chart-bar-group').forEach((bar) => {
    bar.addEventListener('click', () => {
      const batchId = bar.getAttribute('data-batch-id');
      if (batchId) onNavigate('summary', batchId);
    });
  });
}
