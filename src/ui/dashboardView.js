import { daysBetween, addDays } from '../services/guidedQuestions.js';
import { healthStrip } from './operationsView.js';
import { kpi, moneyCompact } from './redesignKit.js';
import { pnlForMonth } from '../services/pnlCalendar.js';
import { buildPnlLedger } from '../services/pnlCalendar.js';
import { attachPnlCalendar } from './pnlCalendarView.js';
import {
  calcDashboardAverages,
  filterActive,
  sumField,
  formatPeso,
  formatPercent,
  formatDate,
  localToday
} from '../services/calculations.js';
import { calcBatchMetrics, evalMortalityWarning, liveHeadCount } from '../services/allocationEngine.js';
import { openThresholdModal } from './modals.js';
import { Repository } from '../services/repository.js';
import { showToast } from './toast.js';
import { renderBatchToggleIcon } from './batchesView.js';
import { renderInsightsCard } from './insightsCard.js';
import { escapeHtml } from './html.js';
import { renderCompanion } from './flockCompanion.js';
import { flockCompanion } from '../services/flockCompanion.js';

// Chart.js is only needed for the Dashboard's profit chart, so it is loaded
// on first use instead of in the main bundle (precached for offline use).
let chartModule = null;
function loadChart() {
  chartModule ??= import('chart.js').then(
    ({ Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler }) => {
      Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);
      return Chart;
    },
    (err) => {
      chartModule = null; // try again on the next render
      throw err;
    }
  );
  return chartModule;
}

const CHART_FONT = "'Poppins', sans-serif";

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

/**
 * @param {object|null} home  Home additions: { greetingHtml, cardsHtml, todoHtml, role }.
 *                            Staff see the greeting, cards, to-do list and flock health only.
 */
export function renderDashboard(openBatchesData, closedBatchesWithData, collapsedBatchIds = new Set(), insights = null, expenses = [], home = null) {
  const today=localToday(),staff=home?.role==='staff',target=home?.targetDays||35;
  const ledger=buildPnlLedger([...openBatchesData,...closedBatchesWithData],expenses),month=pnlForMonth(ledger,today.slice(0,7));
  const monthDays=[...ledger.days.values()].filter(d=>d.date.startsWith(today.slice(0,7))),lossDays=monthDays.filter(d=>d.net<0).length,profitDays=monthDays.filter(d=>d.net>0).length;
  const mascot=home?.mascot||flockCompanion(openBatchesData,today);
  const warningItem=openBatchesData.find(i=>evalMortalityWarning(i.batch,i.mortality).mortalityFlag);
  const warning=warningItem?evalMortalityWarning(warningItem.batch,warningItem.mortality):null;
  const displayMascot=warning&&mascot.mood==='alerted'?{...mascot,reason:`${warningItem.batch.batch_name} mortality is ${warning.mortalityRate.toFixed(1)}%, above your ${warning.mortalityThreshold}% limit.`}:mascot;
  const heads=openBatchesData.reduce((sum,i)=>sum+liveHeadCount(i.batch,i.mortality,i.sales,addDays(today,1)),0);
  const chips=`<div class="rd-companion-kpis">${kpi('Live birds',heads.toLocaleString(),`${openBatchesData.length} open ${openBatchesData.length===1?'batch':'batches'}`)}${staff?'':`<div class="rd-kpi ${month.net<0?'urgent':'good'}"><span>This month</span><strong title="${formatPeso(month.net/100)}">${moneyCompact(month.net/100,0)}</strong><small>${month.net<0?`${lossDays} loss days`:month.net>0?`${profitDays} profit days`:'Recorded P&L'}</small></div>`}${kpi('Today’s tasks',`${home?.tasks?.done||0} of ${home?.tasks?.total||0}`,'Done','warm')}</div>`;
  const health=openBatchesData.map(i=>{
    const m=calcBatchMetrics(i.batch,i.allocations,i.sales,i.mortality,i.feed),warn=evalMortalityWarning(i.batch,i.mortality),age=Math.max(0,daysBetween(i.batch.start_date,today)),over=Math.max(0,age-target);
    const live=liveHeadCount(i.batch,i.mortality,i.sales,addDays(today,1)),limit=warn.mortalityThreshold,scale=Math.max(Number(limit||0)*2,m.mortalityRate,1),mortalityWidth=Math.min(100,m.mortalityRate/scale*100),ageStatus=over?'past-target':age/target>0.85?'near-target':'',ageBarWidth=over?Math.max(0,Math.min(100,target/age*100)):Math.min(100,age/target*100);
    return `<article class="home-flock-card${over?' card-overdue':ageStatus==='near-target'?' card-near-target':''}"><header><h3><button type="button" class="home-batch-link" data-dashboard-batch="${escapeHtml(i.batch.batch_id)}">${escapeHtml(i.batch.batch_name)}</button></h3>${over?'<span class="rd-pill urgent">Overdue</span>':''}</header><div class="home-flock-hero"><div class="home-ring ${ageStatus}" style="--p:${over?100:Math.min(100,age/target*100)}" role="img" aria-label="Day ${age} of ${target}"><span class="home-flock-big-num${over?' text-bad':''}">${age}</span><span class="home-flock-big-label">of ${target} days</span></div><div class="home-ring live" style="--p:${Math.min(100,live/(Number(i.batch.initial_chick_count)||live||1)*100)}" role="img" aria-label="${live.toLocaleString()} live birds"><span class="home-flock-big-num">${live.toLocaleString()}</span><span class="home-flock-big-label">live birds</span></div></div><p class="home-flock-meta">Started ${formatDate(i.batch.start_date,true)}${over?` · <b class="text-bad">${over} day${over===1?'':'s'} overdue</b>`:''}</p><div class="home-health-bar-row"><span class="home-bar-label">Age</span><div class="home-age-track ${ageStatus}" role="img" aria-label="Day ${age}, target day ${target}"><i style="width:${ageBarWidth}%"></i></div></div><div class="home-health-bar-row"><span class="home-bar-label">Mortality <b class="${warn.mortalityFlag?'text-bad':''}">${m.mortalityRate.toFixed(1)}%</b></span><div class="rd-meter mortality ${warn.mortalityFlag?'urgent':''}"><i style="width:${mortalityWidth}%"></i>${limit==null?'':`<em style="left:${Math.min(100,Number(limit)/scale*100)}%" title="Mortality limit"></em>`}</div></div>${staff?'':`<dl class="home-flock-money"><div><dt>Cost</dt><dd title="${formatPeso(m.totalCost)}">${moneyCompact(m.totalCost)}</dd></div><div><dt>Sales</dt><dd title="${formatPeso(m.revenue)}">${moneyCompact(m.revenue)}</dd></div><div><dt>Net</dt><dd class="${m.netProfit<0?'text-bad':''}" title="${formatPeso(m.netProfit)}">${moneyCompact(m.netProfit)}</dd></div></dl>`}</article>`;
  }).join('');
  const healthPanel=`<section id="home-health" class="rd-panel dashboard-health-panel"><div class="page-head"><div><h2>Flock health</h2><p class="text-mut">${openBatchesData.length} open ${openBatchesData.length===1?'batch':'batches'} · ${heads.toLocaleString()} live birds</p></div><button class="btn-link" type="button" data-action="go-batches">View all batches ↗</button></div><div class="rd-health-grid">${health||'<p class="text-mut">No open batches to monitor yet.</p>'}</div></section>`;
  return `<section class="flock-dashboard overview-garden dense-overview ${staff?'staff-overview':''}" aria-label="Farm dashboard">
    <div class="home-hero">${home?.greetingHtml||'<h1>Home</h1>'}${staff?'':'<div class="flock-header-actions"><button type="button" class="flock-primary" data-action="go-batches">Manage batches ↗</button></div>'}</div>
    <div class="rd-home-top">${renderCompanion(displayMascot,openBatchesData,{staff,financialHtml:chips})}<div class="rd-home-tasks">${staff?home?.taskTrackerHtml||'':''}${home?.todoHtml||''}</div></div>
    <div class="rd-insights">${home?.cardsHtml||''}</div>
    ${healthPanel}
  </section>`;
}

async function renderDashboardCharts(container, closedBatchesWithData, onNavigate) {
  if (lineChartInstance) {
    lineChartInstance.destroy();
    lineChartInstance = null;
  }

  const { allClosedSorted } = getDashboardChartData(closedBatchesWithData);
  const lineCanvas = container.querySelector('#dash-line-chart');
  if (!lineCanvas || !allClosedSorted.length) return;

  let Chart;
  try {
    Chart = await loadChart();
  } catch (err) {
    console.error('Could not load the chart', err);
    return;
  }
  const accent = cssVar('--acc', '#c98a00');
  const bad = cssVar('--bad', '#b3261e');
  const mut = cssVar('--mut', '#77756e');
  const ln = cssVar('--ln', '#d6d3ca');
  const ink = cssVar('--ink', '#1f1f1c');

  // The page may have been redrawn (or left) while Chart.js was loading
  if (lineCanvas.isConnected) {
    lineChartInstance?.destroy();
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
        animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700, easing: 'easeOutQuart' },
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
  closedBatchesData = [],
  expenses = []
) {
  container.querySelectorAll('[data-dashboard-batch]').forEach(b=>b.addEventListener('click',()=>onNavigate('batches',b.dataset.dashboardBatch)));
  attachPnlCalendar(container, [...openBatchesData, ...closedBatchesData], expenses, onNavigate);
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
        allToggleBtn.textContent = allCollapsed ? 'Expand all' : 'Collapse all';
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

  void renderDashboardCharts(container, closedBatchesData, onNavigate);
}
