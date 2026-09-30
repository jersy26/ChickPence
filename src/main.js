import './style.css';
import { AuthService } from './services/auth.js';
import { Repository } from './services/repository.js';
import { checkAndSeedInitialData } from './db/seed.js';
import { syncEngine } from './services/syncEngine.js';
import { renderShell, attachShellListeners } from './ui/shell.js';
import { renderLogin, attachLoginListeners } from './ui/loginView.js';
import { renderDashboard, attachDashboardListeners } from './ui/dashboardView.js';
import { renderActiveBatch, attachActiveBatchListeners } from './ui/activeBatchView.js';
import { renderHistory, attachHistoryListeners } from './ui/historyView.js';
import { renderSummary, attachSummaryListeners } from './ui/summaryView.js';

// Application state
const state = {
  view: 'dashboard',
  selectedBatchId: null,
  activeTab: 'Costs',
  editingItem: null,
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
  // 1. Check & seed default prototype batches if IndexedDB is empty
  await checkAndSeedInitialData(false);

  // 2. Initialize Authentication session
  await AuthService.init();

  if (!AuthService.isLoggedIn()) {
    state.view = 'login';
  } else {
    state.view = 'dashboard';
  }

  // 3. Setup Sync Engine subscription
  state.syncStatus = await syncEngine.getSyncStatus();
  syncEngine.subscribe((newStatus) => {
    state.syncStatus = newStatus;
    updateSyncIndicator();
  });

  // Attempt initial sync if online
  if (syncEngine.isOnline()) {
    syncEngine.syncNow();
  }

  // 4. Initial Render
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
  if (indicatorText) {
    indicatorText.innerHTML = syncHtml;
  }

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
    const activeBatch = await Repository.getActiveBatch();
    let activeBatchData = null;
    if (activeBatch) {
      activeBatchData = await Repository.getBatchFullDetails(activeBatch.batch_id);
    }
    const completedBatchesWithData = await Repository.getCompletedBatchesWithData();

    contentHtml = renderDashboard(activeBatchData, completedBatchesWithData);
    appContainer.innerHTML = renderShell(
      state.view,
      contentHtml,
      state.syncStatus,
      navigate,
      handleLogout,
      render
    );

    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachDashboardListeners(appContainer, navigate, render);
  } else if (state.view === 'active') {
    const activeBatch = await Repository.getActiveBatch();
    let batchData = null;
    if (activeBatch) {
      batchData = await Repository.getBatchFullDetails(activeBatch.batch_id);
    }

    contentHtml = renderActiveBatch(batchData, state.activeTab, state.editingItem);
    appContainer.innerHTML = renderShell(
      state.view,
      contentHtml,
      state.syncStatus,
      navigate,
      handleLogout,
      render
    );

    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachActiveBatchListeners(
      appContainer,
      {
        batchData,
        activeTab: state.activeTab,
        editingItem: state.editingItem
      },
      {
        onTabChange: (tab) => {
          state.activeTab = tab;
          state.editingItem = null;
          render();
        },
        onReload: render,
        onNavigate: navigate,
        onSetEdit: async (table, id) => {
          if (!batchData) return;
          if (table === 'daily_costs') {
            state.editingItem = batchData.costs.find((c) => c.cost_id === id);
          } else if (table === 'feed_logs') {
            state.editingItem = batchData.feed.find((f) => f.feed_log_id === id);
          } else if (table === 'mortality_logs') {
            state.editingItem = batchData.mortality.find((m) => m.mortality_id === id);
          } else if (table === 'sales') {
            state.editingItem = batchData.sales.find((s) => s.sale_id === id);
          }
          render();
        },
        onCancelEdit: () => {
          state.editingItem = null;
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
    appContainer.innerHTML = renderShell(
      state.view,
      contentHtml,
      state.syncStatus,
      navigate,
      handleLogout,
      render
    );

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
    appContainer.innerHTML = renderShell(
      state.view,
      contentHtml,
      state.syncStatus,
      navigate,
      handleLogout,
      render
    );

    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachSummaryListeners(appContainer, navigate);
  }

  updateSyncIndicator();
}

function navigate(view, batchId = null) {
  state.view = view;
  if (batchId) {
    state.selectedBatchId = batchId;
  }
  state.editingItem = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}

async function handleLogout() {
  await AuthService.logout();
  state.view = 'login';
  state.selectedBatchId = null;
  state.editingItem = null;
  render();
}

// Start application
initApp();
