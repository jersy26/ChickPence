import './style.css';
import { AuthService } from './services/auth.js';
import { Repository } from './services/repository.js';
import { checkAndSeedInitialData } from './db/seed.js';
import { syncEngine } from './services/syncEngine.js';
import { renderShell, attachShellListeners } from './ui/shell.js';
import { renderLogin, attachLoginListeners } from './ui/loginView.js';
import { renderDashboard, attachDashboardListeners } from './ui/dashboardView.js';
import { renderBatches, attachBatchesListeners } from './ui/batchesView.js';
import { renderHistory, attachHistoryListeners } from './ui/historyView.js';
import { renderSummary, attachSummaryListeners } from './ui/summaryView.js';
import { computeAllocationsForExpense } from './services/allocationEngine.js';
import { db } from './db/dexie.js';
import { showToast } from './ui/toast.js';

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
const state = {
  view: 'dashboard',
  selectedBatchId: null,   // batch_id of the "focused" open batch in Batches view
  activeTab: 'Expenses',
  editingItem: null,
  expensePreview: null,    // Array of { batchName, feedShare, otherShare } | null
  historySearch: '',
  historyStatus: 'All',
  syncStatus: {
    online: true,
    isSimulatedOffline: false,
    pending: 0,
    isSyncing: false,
    isSupabaseConnected: false
  }
};

const appContainer = document.getElementById('app');

async function initApp() {
  // 1. Seed default data if IndexedDB is empty
  await checkAndSeedInitialData(false);

  // 2. Initialize Authentication
  await AuthService.init();

  if (!AuthService.isLoggedIn()) {
    state.view = 'login';
  } else {
    state.view = 'dashboard';
  }

  // 3. Sync engine subscription
  state.syncStatus = await syncEngine.getSyncStatus();
  syncEngine.subscribe((newStatus) => {
    state.syncStatus = newStatus;
    updateSyncIndicator();
  });

  if (syncEngine.isOnline()) {
    syncEngine.syncNow();
  }

  // 4. Initial render
  await render();
}

function updateSyncIndicator() {
  const syncBox = document.getElementById('sidebar-sync-box');
  if (!syncBox) return;

  const isOff = !state.syncStatus.online;
  const pending = state.syncStatus.pending;

  let syncHtml = '';
  if (isOff) {
    syncHtml = `<b>● Offline${pending ? ` · ${pending} pending sync` : ''}</b>`;
  } else if (pending > 0) {
    syncHtml = `<b>● ${pending} pending sync</b>`;
  } else {
    syncHtml = `<span class="ok">● All synced</span>`;
  }

  const indicatorText = document.getElementById('sync-indicator-text');
  if (indicatorText) indicatorText.innerHTML = syncHtml;

  const toggleNetBtn = document.getElementById('btn-toggle-net');
  if (toggleNetBtn) {
    toggleNetBtn.textContent = state.syncStatus.isSimulatedOffline ? 'Go online' : 'Simulate offline';
  }

  const cloudBtn = document.getElementById('btn-open-cloud-config');
  if (cloudBtn) {
    cloudBtn.textContent = `⚙ Supabase ${state.syncStatus.isSupabaseConnected ? '(Connected)' : '(Demo Mode)'}`;
  }
}

async function render() {
  if (!AuthService.isLoggedIn() || state.view === 'login') {
    appContainer.innerHTML = renderLogin();
    attachLoginListeners(appContainer, () => {
      state.view = 'dashboard';
      render();
    });
    return;
  }

  let contentHtml = '';

  if (state.view === 'dashboard') {
    const [openBatchesData, closedBatchesData] = await Promise.all([
      loadOpenBatchesData(),
      Repository.getClosedBatchesWithData()
    ]);

    contentHtml = renderDashboard(openBatchesData, closedBatchesData);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachDashboardListeners(appContainer, navigate, render);

  } else if (state.view === 'batches') {
    const [openBatchesData, expenses] = await Promise.all([
      loadOpenBatchesData(),
      Repository.getAllExpenses()
    ]);

    // Default selectedBatchId to first open batch if not set
    if (!state.selectedBatchId && openBatchesData.length) {
      state.selectedBatchId = openBatchesData[0].batch.batch_id;
    }

    contentHtml = renderBatches(
      openBatchesData,
      expenses,
      state.selectedBatchId,
      state.activeTab,
      state.editingItem,
      state.expensePreview
    );

    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachBatchesListeners(
      appContainer,
      {
        openBatchesData,
        expenses,
        selectedBatchId: state.selectedBatchId,
        activeTab: state.activeTab,
        editingItem: state.editingItem,
        expensePreview: state.expensePreview
      },
      {
        onTabChange: (tab) => {
          state.activeTab = tab;
          state.editingItem = null;
          state.expensePreview = null;
          render();
        },
        onReload: render,
        onNavigate: navigate,
        onSelectBatch: (batchId) => {
          state.selectedBatchId = batchId;
        },
        onSetEdit: async (table, id) => {
          if (table === 'expenses') {
            state.editingItem = await Repository.getExpenseById(id);
            state.activeTab = 'Expenses';
            state.expensePreview = null;
          } else {
            // Find among all open batch data
            const allFeed = openBatchesData.flatMap((d) => d.feed);
            const allMort = openBatchesData.flatMap((d) => d.mortality);
            const allSales = openBatchesData.flatMap((d) => d.sales);
            if (table === 'feed_logs') state.editingItem = allFeed.find((f) => f.feed_log_id === id) || null;
            else if (table === 'mortality_logs') state.editingItem = allMort.find((m) => m.mortality_id === id) || null;
            else if (table === 'sales') state.editingItem = allSales.find((s) => s.sale_id === id) || null;
          }
          render();
        },
        onCancelEdit: () => {
          state.editingItem = null;
          state.expensePreview = null;
          render();
        },
        onExpensePreview: async (date, feedPeso, otherPeso) => {
          // Build preview synchronously from local DB
          const feedCentavos = Math.round(feedPeso * 100);
          const otherCentavos = Math.round(otherPeso * 100);
          const fakeExpense = { expense_id: 'preview', entry_date: date, feed_centavos: feedCentavos, other_centavos: otherCentavos };

          const [allBatches, allMort, allSales] = await Promise.all([
            db.batches.filter((b) => !b.deleted_at).toArray(),
            db.mortality_logs.filter((m) => !m.deleted_at).toArray(),
            db.sales.filter((s) => !s.deleted_at).toArray()
          ]);

          const result = computeAllocationsForExpense(fakeExpense, allBatches, allMort, allSales);
          if (!result) {
            showToast(`No batch is active on ${date}. Cannot allocate.`);
            state.expensePreview = null;
          } else {
            state.expensePreview = result.rows.map((row) => {
              const batch = allBatches.find((b) => b.batch_id === row.batch_id);
              return {
                batchName: batch?.batch_name || row.batch_id,
                feedShare: row.feed_centavos / 100,
                otherShare: row.other_centavos / 100
              };
            });
          }
          render();
        }
      }
    );

  } else if (state.view === 'history') {
    const allBatches = await Repository.getAllBatches();
    const batchesWithFullData = [];
    for (const b of allBatches) {
      const details = await Repository.getBatchFullDetails(b.batch_id);
      if (details) batchesWithFullData.push(details);
    }

    contentHtml = renderHistory(batchesWithFullData, state.historySearch, state.historyStatus);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachHistoryListeners(appContainer, navigate, (search, status) => {
      if (search !== null) state.historySearch = search;
      if (status !== null) state.historyStatus = status;
      render();
    });

  } else if (state.view === 'summary') {
    const batchId = state.selectedBatchId;
    const batchData = batchId ? await Repository.getBatchFullDetails(batchId) : null;

    contentHtml = renderSummary(batchData);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachSummaryListeners(appContainer, navigate);
  }

  updateSyncIndicator();
}

/** Load all open batches with their full details */
async function loadOpenBatchesData() {
  const openBatches = await Repository.getOpenBatches();
  const results = [];
  for (const b of openBatches) {
    const details = await Repository.getBatchFullDetails(b.batch_id);
    if (details) results.push(details);
  }
  return results;
}

function navigate(view, batchId = null) {
  state.view = view;
  if (batchId) state.selectedBatchId = batchId;
  state.editingItem = null;
  state.expensePreview = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}

async function handleLogout() {
  await AuthService.logout();
  state.view = 'login';
  state.selectedBatchId = null;
  state.editingItem = null;
  state.expensePreview = null;
  render();
}

// Start application
initApp();
