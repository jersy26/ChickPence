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
import { renderBatchToggleIcon } from './batchesView.js';
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler
} from 'chart.js';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler
);

const TODAY = new Date().toISOString().slice(0, 10);
const CHART_FONT = "'Poppins', sans-serif";

let barChartInstance = null;
let lineChartInstance = null;

function cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const bigint = parseInt(full, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Shared derivation of chart-ready data from closed batches. Used by both
 * renderDashboard (for markup/empty-states) and attachDashboardListeners
 * (for instantiating Chart.js). */
export function getDashboardChartData(closedBatchesWithData = []) {
  const enrichedClosed = closedBatchesWithData.map((item) => {
    const metrics = calcBatchMetrics(item.batch, item.allocations, item.sales, item.mortality, item.feed);
    return { ...item, netProfit: metrics.netProfit };
  });

  const { last5, avgNetProfit, avgSellingPricePerKg } = calcDashboardAverages(enrichedClosed);

  const allClosedSorted = [...enrichedClosed].sort((a, b) =>
    a.batch.start_date < b.batch.start_date ? -1 : 1
  );

  return { enrichedClosed, last5, avgNetProfit, avgSellingPricePerKg, allClosedSorted };
}

export function renderDashboard(openBatchesData, closedBatchesWithData, collapsedBatchIds = new Set()) {
  const { last5, avgNetProfit, avgSellingPricePerKg, allClosedSorted } =
    getDashboardChartData(closedBatchesWithData);

  const allCollapsed =
    openBatchesData.length > 0 &&
    openBatchesData.every((item) => collapsedBatchIds.has(item.batch.batch_id));

  const hasActiveWarning = openBatchesData.some(
    (item) => evalMortalityWarning(item.batch, item.mortality).mortalityFlag
  );

  // Open batches summary cards
  const openCardsHtml = openBatchesData.length
    ? openBatchesData.map((item, idx) => {
        const { batch, feed, mortality, sales, allocations } = item;
        const metrics = calcBatchMetrics(batch, allocations, sales, mortality, feed);
        const warn = evalMortalityWarning(batch, mortality);
        const liveHeads = liveHeadCount(batch, mortality, sales, TODAY);
        const isCollapsed = collapsedBatchIds.has(batch.batch_id);

        return `
          <div class="card-box dash-batch-card dash-animate" id="dash-batch-card-${batch.batch_id}" style="--dash-delay:${0.15 + idx * 0.05}s;margin-bottom: 10px;">
            <div class="flex-row">
              <div style="display: flex; align-items: center; gap: 8px;">
                <button
                  type="button"
                  class="btn-batch-toggle dash-batch-toggle"
                  data-action="toggle-dash-batch-collapse"
                  data-batch-id="${batch.batch_id}"
                  title="${isCollapsed ? 'Maximize' : 'Minimize'}"
                  aria-label="${isCollapsed ? 'Maximize ' + batch.batch_name : 'Minimize ' + batch.batch_name}"
                  aria-expanded="${!isCollapsed}"
                >
                  ${renderBatchToggleIcon(isCollapsed)}
                </button>
                <b style="font-size: 15px;">${batch.batch_name}</b>
              </div>
              <span class="text-mut">Started ${formatDate(batch.start_date, true)} · <b>${liveHeads.toLocaleString()}</b> live</span>
            </div>
            <div class="batch-card-body" id="dash-batch-body-${batch.batch_id}" style="${isCollapsed ? 'display: none;' : ''}">
              <div class="grid-3" style="margin-top:8px;">
                <div class="stat-tile">
                  <b class="stat-value">${formatPeso(metrics.totalCost)}</b>
                  <span class="stat-label">Cost to Date</span>
                </div>
                <div class="stat-tile accent">
                  <b class="stat-value">${formatPeso(metrics.revenue)}</b>
                  <span class="stat-label">Sales to Date</span>
                </div>
                <div class="stat-tile ${warn.mortalityFlag ? 'danger' : ''}">
                  <b class="stat-value">${formatPercent(metrics.mortalityRate)}</b>
                  <span class="stat-label">Mortality</span>
                </div>
              </div>
              ${warn.mortalityFlag ? `<div class="flag-alert" style="margin-top:8px;">⚠ Mortality ${formatPercent(warn.mortalityRate)} exceeds threshold (${warn.mortalityThreshold}%)</div>` : ''}
            </div>
          </div>`;
      }).join('')
    : `<div class="card-box" style="text-align:center;padding:24px;">
        <div class="text-mut" style="font-size:14px;">No open batches.</div>
        <button class="btn-action primary" data-action="go-batches" style="margin:10px auto 0;">+ Create New Batch</button>
      </div>`;

  const warningsHtml = openBatchesData.length
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
    : `<div class="text-mut">No open batches to monitor.</div>`;

  const emptyChartMsg = `<div class="text-mut" style="padding: 24px; text-align: center;">No closed batches yet.</div>`;

  return `
    <div class="top-bar">
      <h1>Dashboard</h1>
      <button class="btn-action primary" data-action="go-batches">Batches →</button>
    </div>

    <div class="dash-warnings-panel dash-animate ${hasActiveWarning ? 'has-alert' : ''}" style="--dash-delay:0s;">
      <div class="flex-row">
        <h2>${hasActiveWarning ? '⚠ Open Batch Warnings' : 'Open Batch Warnings'}</h2>
      </div>
      <div class="dash-warning-list">
        ${warningsHtml}
      </div>
    </div>

    <div class="dash-section-label" style="margin-top:4px;">Performance</div>
    <div class="dash-charts-grid">
      <div class="card-box dash-chart-card dash-animate" style="--dash-delay:.05s;">
        <div class="dash-chart-head">
          <h2>Last 5 Batches Net Profit</h2>
          <span class="text-mut">Closed batches · tap a bar for the full report</span>
        </div>
        ${last5.length ? `<div class="chart-canvas-wrap"><canvas id="dash-bar-chart"></canvas></div>` : emptyChartMsg}
        <div class="stat-mini-row">
          <div class="stat-tile-mini">
            <span class="stat-mini-label">Avg Net Profit</span>
            <b class="stat-mini-value">${formatPeso(avgNetProfit)}</b>
          </div>
          <div class="stat-tile-mini">
            <span class="stat-mini-label">Avg Price / KG</span>
            <b class="stat-mini-value">${formatPeso(avgSellingPricePerKg)}</b>
          </div>
        </div>
      </div>

      <div class="card-box dash-chart-card dash-animate" style="--dash-delay:.1s;">
        <div class="dash-chart-head">
          <h2>Net Profit Trend</h2>
          <span class="text-mut">All closed batches over time</span>
        </div>
        ${allClosedSorted.length ? `<div class="chart-canvas-wrap"><canvas id="dash-line-chart"></canvas></div>` : emptyChartMsg}
      </div>
    </div>

    <div class="flex-row" style="margin:4px 0 6px;align-items:center;">
      <div class="dash-section-label">Open Batches</div>
      ${openBatchesData.length > 1 ? `
        <button class="btn-link" id="btn-toggle-all-dash-batches" style="font-size:11px;font-weight:600;text-transform:uppercase;">
          ${allCollapsed ? '+ Maximize All' : '− Minimize All'}
        </button>
      ` : ''}
    </div>
    ${openCardsHtml}
  `;
}

function renderDashboardCharts(container, closedBatchesWithData, onNavigate) {
  if (barChartInstance) {
    barChartInstance.destroy();
    barChartInstance = null;
  }
  if (lineChartInstance) {
    lineChartInstance.destroy();
    lineChartInstance = null;
  }

  const { last5, allClosedSorted } = getDashboardChartData(closedBatchesWithData);

  const accent = cssVar('--acc', '#c98a00');
  const bad = cssVar('--bad', '#b3261e');
  const mut = cssVar('--mut', '#77756e');
  const ln = cssVar('--ln', '#d6d3ca');
  const ink = cssVar('--ink', '#1f1f1c');

  const barCanvas = container.querySelector('#dash-bar-chart');
  if (barCanvas && last5.length) {
    const labels = last5.map((item) => item.batch.batch_name.replace(/^Batch\s*/i, ''));
    const profits = last5.map((item) => item.netProfit || 0);
    const batchIds = last5.map((item) => item.batch.batch_id);

    barChartInstance = new Chart(barCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: profits,
          borderRadius: 6,
          borderSkipped: false,
          barPercentage: 0.55,
          backgroundColor: (ctx) => {
            const { chart, dataIndex } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return accent;
            const isPos = (profits[dataIndex] || 0) >= 0;
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            const base = isPos ? accent : bad;
            gradient.addColorStop(0, hexToRgba(base, 0.95));
            gradient.addColorStop(1, hexToRgba(base, 0.25));
            return gradient;
          },
          hoverBackgroundColor: (ctx) => (profits[ctx.dataIndex] >= 0 ? accent : bad)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatPeso(ctx.raw) } }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: mut, font: { family: CHART_FONT, size: 11 } }
          },
          y: {
            grid: { color: ln },
            ticks: {
              color: mut,
              font: { family: CHART_FONT, size: 11 },
              callback: (val) => `${Math.round(val / 1000)}k`
            }
          }
        },
        onClick: (evt, elements) => {
          if (elements.length) {
            const batchId = batchIds[elements[0].index];
            if (batchId) onNavigate('summary', batchId);
          }
        },
        onHover: (evt, elements) => {
          if (evt.native?.target) {
            evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
          }
        }
      }
    });
  }

  const lineCanvas = container.querySelector('#dash-line-chart');
  if (lineCanvas && allClosedSorted.length) {
    const labels = allClosedSorted.map((item) => item.batch.batch_name.replace(/^Batch\s*/i, ''));
    const profits = allClosedSorted.map((item) => item.netProfit || 0);

    lineChartInstance = new Chart(lineCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: profits,
          borderColor: accent,
          borderWidth: 2.5,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: accent,
          pointBorderColor: ink,
          fill: 'start',
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return hexToRgba(accent, 0.15);
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, hexToRgba(accent, 0.3));
            gradient.addColorStop(1, hexToRgba(accent, 0));
            return gradient;
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatPeso(ctx.raw) } }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: mut, font: { family: CHART_FONT, size: 11 }, maxRotation: 0, autoSkip: true }
          },
          y: {
            grid: { color: ln },
            ticks: {
              color: mut,
              font: { family: CHART_FONT, size: 11 },
              callback: (val) => `${Math.round(val / 1000)}k`
            }
          }
        }
      }
    });
  }
}

export function attachDashboardListeners(
  container,
  onNavigate,
  onReload,
  collapsedBatchIds = new Set(),
  openBatchesData = [],
  closedBatchesData = []
) {
  container.querySelectorAll('[data-action="go-batches"]').forEach((btn) => {
    btn.addEventListener('click', () => onNavigate('batches'));
  });

  // Open batch minimize / maximize toggle on dashboard
  container.querySelectorAll('[data-action="toggle-dash-batch-collapse"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const batchId = btn.getAttribute('data-batch-id');
      const isNowCollapsed = !collapsedBatchIds.has(batchId);

      if (isNowCollapsed) {
        collapsedBatchIds.add(batchId);
      } else {
        collapsedBatchIds.delete(batchId);
      }
      try {
        localStorage.setItem('chickpence_collapsed_batches', JSON.stringify([...collapsedBatchIds]));
      } catch (_) {}

      const body = container.querySelector(`#dash-batch-body-${batchId}`);
      if (body) {
        body.style.display = isNowCollapsed ? 'none' : '';
      }
      btn.setAttribute('title', isNowCollapsed ? 'Maximize' : 'Minimize');
      btn.setAttribute('aria-label', `${isNowCollapsed ? 'Maximize' : 'Minimize'} batch`);
      btn.setAttribute('aria-expanded', String(!isNowCollapsed));
      btn.innerHTML = renderBatchToggleIcon(isNowCollapsed);

      const allToggleBtn = container.querySelector('#btn-toggle-all-dash-batches');
      if (allToggleBtn && openBatchesData.length > 0) {
        const allCollapsed = openBatchesData.every((d) => collapsedBatchIds.has(d.batch.batch_id));
        allToggleBtn.textContent = allCollapsed ? '+ Maximize All' : '− Minimize All';
      }
    });
  });

  // Toggle all open batches on dashboard
  container.querySelector('#btn-toggle-all-dash-batches')?.addEventListener('click', () => {
    const allCollapsed =
      openBatchesData.length > 0 &&
      openBatchesData.every((d) => collapsedBatchIds.has(d.batch.batch_id));
    if (allCollapsed) {
      openBatchesData.forEach((d) => collapsedBatchIds.delete(d.batch.batch_id));
    } else {
      openBatchesData.forEach((d) => collapsedBatchIds.add(d.batch.batch_id));
    }
    try {
      localStorage.setItem('chickpence_collapsed_batches', JSON.stringify([...collapsedBatchIds]));
    } catch (_) {}
    onReload();
  });

  renderDashboardCharts(container, closedBatchesData, onNavigate);
}
