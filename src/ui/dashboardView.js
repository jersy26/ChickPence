import {
  calcTotalProductionCost,
  calcTotalRevenue,
  calcMortalityMetrics,
  evaluateBatchWarnings,
  calcDashboardAverages,
  formatPeso,
  formatPercent,
  formatDate
} from '../services/calculations.js';
import { openThresholdModal } from './modals.js';
import { Repository } from '../services/repository.js';
import { showToast } from './toast.js';

function renderNetProfitChart(last5Batches) {
  if (!last5Batches.length) {
    return `<div class="text-mut" style="padding: 24px; text-align: center;">No completed batches yet. Completed batches will appear here.</div>`;
  }

  const profits = last5Batches.map((item) => item.netProfit);
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
    const profit = item.netProfit;
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
        <rect
          class="b"
          x="${x}"
          y="${y}"
          width="${barWidth}"
          height="${height}"
          rx="3"
          fill="${isPos ? 'var(--acc)' : 'var(--bad)'}"
        />
        <text class="v" x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle">
          ${labelK}
        </text>
        <text x="${x + barWidth / 2}" y="218" text-anchor="middle">
          ${batchShortName}
        </text>
      </g>
    `;
  });

  return `
    <svg viewBox="0 0 520 232" width="100%" style="max-width: 520px; overflow: visible;">
      <!-- Zero axis baseline -->
      <line x1="0" x2="520" y1="${zeroY}" y2="${zeroY}" stroke="var(--ink)" stroke-width="1.5" opacity="0.6"/>
      ${barsSvg}
    </svg>
  `;
}

function renderWarningCard(activeBatchData) {
  if (!activeBatchData?.batch) {
    return `
      <div class="text-mut">No active batch currently running.</div>
      <button class="btn-action" data-action="go-active" style="margin-top: 6px;">Start a Batch</button>
    `;
  }

  const { batch, costs, mortality } = activeBatchData;
  const warnings = evaluateBatchWarnings(batch, costs, mortality);
  const items = [];
  let hasFlag = false;

  // Mortality warning
  if (warnings.mortalityThreshold == null) {
    items.push(`<div class="ok-line text-mut">Mortality: no threshold set</div>`);
  } else if (warnings.mortalityFlag) {
    hasFlag = true;
    items.push(`
      <div class="flag-alert">
        <span>⚠ Mortality ${formatPercent(warnings.mortalityRate)} exceeds limit (${warnings.mortalityThreshold}%)</span>
      </div>
    `);
  } else {
    items.push(`
      <div class="ok-line">
        Mortality ${formatPercent(warnings.mortalityRate)} / limit ${warnings.mortalityThreshold}%
      </div>
    `);
  }

  // Cost warning
  if (warnings.costBudget == null) {
    items.push(`<div class="ok-line text-mut">Cost: no budget set</div>`);
  } else if (warnings.costFlag) {
    hasFlag = true;
    items.push(`
      <div class="flag-alert">
        <span>⚠ Cost ${formatPeso(warnings.totalCost)} exceeds budget (${formatPeso(warnings.costBudget)})</span>
      </div>
    `);
  } else {
    items.push(`
      <div class="ok-line">
        Cost ${formatPeso(warnings.totalCost)} / budget ${formatPeso(warnings.costBudget)}
      </div>
    `);
  }

  return `
    ${items.join('')}
    ${!hasFlag ? '<div class="text-mut">✓ All metrics within safe parameters</div>' : ''}
    <button class="btn-link" id="btn-dash-edit-threshold" style="margin-top: 4px;">✎ Edit thresholds</button>
  `;
}

export function renderDashboard(activeBatchData, completedBatchesWithData) {
  const active = activeBatchData?.batch;
  const { last5, avgNetProfit, avgSellingPricePerKg } = calcDashboardAverages(completedBatchesWithData);

  let activeCardHtml = '';
  if (active) {
    const totalCost = calcTotalProductionCost(active, activeBatchData.costs);
    const totalRevenue = calcTotalRevenue(activeBatchData.sales);
    const { mortalityRate } = calcMortalityMetrics(active, activeBatchData.mortality);

    activeCardHtml = `
      <div class="card-box">
        <div class="flex-row">
          <div>
            <b style="font-size: 16px;">${active.batch_name}</b>
            <span class="badge-pill" style="margin-left: 8px;">Active</span>
          </div>
          <span class="text-mut">
            Started ${formatDate(active.start_date, true)} · ${active.initial_chick_count.toLocaleString()} chicks
          </span>
        </div>

        <div class="grid-3" style="margin-top: 4px;">
          <div class="card-box kpi-card">
            <span class="text-mut">Cost to Date</span>
            <b>${formatPeso(totalCost)}</b>
          </div>
          <div class="card-box kpi-card">
            <span class="text-mut">Sales to Date</span>
            <b>${formatPeso(totalRevenue)}</b>
          </div>
          <div class="card-box kpi-card">
            <span class="text-mut">Mortality Rate</span>
            <b>${formatPercent(mortalityRate)}</b>
          </div>
        </div>
      </div>
    `;
  } else {
    activeCardHtml = `
      <div class="card-box" style="text-align: center; padding: 24px;">
        <div class="text-mut" style="font-size: 14px;">No batch is currently active.</div>
        <button class="btn-action primary" data-action="go-active" style="margin: 10px auto 0;">
          + Create New Batch
        </button>
      </div>
    `;
  }

  return `
    <div class="top-bar">
      <h1>Dashboard</h1>
      ${
        active
          ? `<button class="btn-action primary" data-action="go-active">Open Active Batch →</button>`
          : `<button class="btn-action primary" data-action="go-active">+ New Batch</button>`
      }
    </div>

    <div class="text-mut" style="font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em;">
      Current Active Batch
    </div>
    ${activeCardHtml}

    <div class="dashboard-split">
      <div class="card-box">
        <h2>Last 5 Batches Net Profit</h2>
        <div class="chart-box">
          <div style="flex: 1; min-width: 280px;">
            ${renderNetProfitChart(last5)}
          </div>
          <div style="flex: 1; min-width: 190px; display: flex; flex-direction: column; gap: 10px;">
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
        <span class="text-mut">Tap a bar to open that batch's full summary report. Completed batches only.</span>
      </div>

      <div class="card-box">
        <h2>Batch Warning System</h2>
        ${renderWarningCard(activeBatchData)}
      </div>
    </div>
  `;
}

export function attachDashboardListeners(container, onNavigate, onReload) {
  container.querySelectorAll('[data-action="go-active"]').forEach((btn) => {
    btn.addEventListener('click', () => onNavigate('active'));
  });

  container.querySelectorAll('.chart-bar-group').forEach((bar) => {
    bar.addEventListener('click', () => {
      const batchId = bar.getAttribute('data-batch-id');
      if (batchId) onNavigate('summary', batchId);
    });
  });

  const editThrBtn = container.querySelector('#btn-dash-edit-threshold');
  if (editThrBtn) {
    editThrBtn.addEventListener('click', async () => {
      const activeBatch = await Repository.getActiveBatch();
      if (!activeBatch) return;

      openThresholdModal(activeBatch, async (updates) => {
        await Repository.updateBatchThresholds(activeBatch.batch_id, updates);
        showToast('Thresholds updated');
        onReload();
      });
    });
  }
}
