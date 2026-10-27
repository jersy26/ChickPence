import './style.css';
import { AuthService } from './services/auth.js';
import { Repository } from './services/repository.js';
import { prepareLocalDataFor } from './db/localData.js';
import { syncEngine } from './services/syncEngine.js';
import { renderShell, attachShellListeners } from './ui/shell.js';
import { renderLogin, attachLoginListeners } from './ui/loginView.js';
import { renderDashboard, attachDashboardListeners } from './ui/dashboardView.js';
import { renderBatches, attachBatchesListeners } from './ui/batchesView.js';
import { renderHistory, attachHistoryListeners } from './ui/historyView.js';
import { exportBatch, exportBatchList } from './services/exportService.js';
import { openExportModal } from './ui/exportMenu.js';
import { renderSummary, attachSummaryListeners } from './ui/summaryView.js';
import { computeAllocationsForExpense } from './services/allocationEngine.js';
import { db } from './db/dexie.js';
import { showToast } from './ui/toast.js';
import { openImportReviewModal, openScanProgressModal } from './ui/importReviewModal.js';
import { openLocalAiModal } from './ui/localAiModal.js';
import {
  aiUnavailableReason,
  resizeImage,
  parseImage,
  normalizeDrafts,
  queueImageJob,
  getReadyJobs,
  countPendingJobs,
  deleteJob,
  retryJob,
  processQueuedJobs
} from './services/aiParseService.js';

function getInitialCollapsedBatchIds() {
  try {
    const raw = localStorage.getItem('chickpence_collapsed_batches');
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (_) {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
const state = {
  view: 'dashboard',
  selectedBatchId: null,   // batch_id of the "focused" open batch in Batches view
  activeTab: 'Expenses',
  editingItem: null,
  expensePreview: null,    // Array of { batchName, feedShare, otherShare } | null
  expenseVisibleCount: 15, // how many Farm Expenses rows are shown before "Load More"
  historySearch: '',
  historyStatus: 'All',
  collapsedBatchIds: getInitialCollapsedBatchIds(),
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
  // 1. Initialize Authentication
  await AuthService.init();

  if (!AuthService.isLoggedIn()) {
    state.view = 'login';
  } else {
    state.view = 'dashboard';
    // 2. Demo data only for Demo Mode; a real account gets its own records
    await prepareLocalDataFor(AuthService.getUser());
  }

  // 3. Sync engine subscription
  state.syncStatus = await syncEngine.getSyncStatus();
  syncEngine.subscribe((newStatus) => {
    state.syncStatus = newStatus;
    updateSyncIndicator();
  });

  if (syncEngine.isOnline()) {
    // Show records downloaded at start-up (not while the login form is open)
    syncEngine.syncNow().then(() => AuthService.isLoggedIn() && render());
  }

  // Scan photos that were waiting for the local AI (no internet needed)
  if (AuthService.isLoggedIn()) processQueue();

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
    attachLoginListeners(appContainer, async () => {
      state.view = 'dashboard';
      const action = await prepareLocalDataFor(AuthService.getUser());
      if (action === 'keep-unsynced') {
        showToast('Some records from the previous account are not uploaded yet, so they were kept on this device.', 5000);
      }
      render();
      // A real account downloads its records right away
      if (syncEngine.isOnline()) syncEngine.syncNow().then(render);
    });
    return;
  }

  let contentHtml = '';

  if (state.view === 'dashboard') {
    const [openBatchesData, closedBatchesData] = await Promise.all([
      loadOpenBatchesData(),
      Repository.getClosedBatchesWithData()
    ]);

    contentHtml = renderDashboard(openBatchesData, closedBatchesData, state.collapsedBatchIds);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachDashboardListeners(appContainer, navigate, render, state.collapsedBatchIds, openBatchesData, closedBatchesData);

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
      state.expensePreview,
      state.collapsedBatchIds,
      state.expenseVisibleCount,
      await loadImportState()
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
        expensePreview: state.expensePreview,
        collapsedBatchIds: state.collapsedBatchIds
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
        },
        onLoadMoreExpenses: () => {
          state.expenseVisibleCount += 15;
          render();
        },
        onScanPhoto: (file) => scanLogbookPhoto(file, openBatchesData.map((d) => d.batch)),
        onReviewScans: () => reviewNextScan(openBatchesData.map((d) => d.batch)),
        onAiSettings: () => openLocalAiModal(render)
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
    }, () => openExport(allBatches));

  } else if (state.view === 'summary') {
    const batchId = state.selectedBatchId;
    const batchData = batchId ? await Repository.getBatchFullDetails(batchId) : null;

    contentHtml = renderSummary(batchData);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render);
    attachSummaryListeners(appContainer, navigate, batchData?.batch
      ? async () => openExport(await Repository.getAllBatches(), batchId)
      : null);
  }

  updateSyncIndicator();
}

/** Load all open batches with their full details */
/** Export modal: detailed report of one batch, or the whole history. */
function openExport(allBatches, defaultBatchId = null) {
  openExportModal({
    batches: allBatches,
    defaultBatchId,
    onExport: async ({ scope, batchId, format }) => {
      if (scope === 'history') {
        const all = await Promise.all(allBatches.map((b) => Repository.getBatchFullDetails(b.batch_id)));
        return exportBatchList(all.filter(Boolean), format);
      }
      const batchData = await Repository.getBatchFullDetails(batchId);
      if (!batchData) throw new Error('Batch not found');
      const expensesById = await Repository.getExpensesByIds(batchData.allocations.map((a) => a.expense_id));
      return exportBatch(batchData, expensesById, format);
    }
  });
}

// ---------------------------------------------------------------------------
// Logbook scanning (AI drafts → review modal → Repository.save*)
// ---------------------------------------------------------------------------

async function loadImportState() {
  const [queued, ready, unavailableReason] = await Promise.all([countPendingJobs(), getReadyJobs(), aiUnavailableReason()]);
  // Photos taken while the local AI was off get scanned once it is back
  if (!unavailableReason && queued > ready.length) processQueue();
  return { unavailableReason, queued, ready: ready.length };
}

async function scanLogbookPhoto(file, openBatches) {
  let image;
  try {
    image = await resizeImage(file);
  } catch (err) {
    console.error('Could not read photo', err);
    return showToast('Could not read that photo. Try a JPEG or PNG.');
  }

  const reason = await aiUnavailableReason({ force: true });
  if (reason) {
    await queueImageJob(image);
    showToast(`${reason} The photo was saved and will be scanned when the local AI is ready.`, 5000);
    return render();
  }

  const controller = new AbortController();
  const progress = openScanProgressModal({ onCancel: () => controller.abort() });
  try {
    const result = await parseImage(image, openBatches.map((b) => b.batch_name), {
      signal: controller.signal,
      onProgress: progress.update
    });
    progress.close();
    openReview(result, openBatches);
  } catch (err) {
    progress.close();
    if (controller.signal.aborted) return showToast('Scan cancelled');
    console.error('Local AI scan failed', err);
    // Keep the photo so the user does not have to retake it
    await queueImageJob(image, { error: err.message });
    showToast(`Scan failed: ${err.message} The photo was kept; retry from "Review scanned".`, 5000);
    render();
  }
}

function openReview(result, openBatches, { onSaved, onDiscard } = {}) {
  openImportReviewModal({
    drafts: normalizeDrafts(result?.entries, openBatches),
    openBatches,
    notes: result?.notes || '',
    onSaved: async (count) => {
      await onSaved?.(count);
      render();
    },
    onDiscard: async () => {
      await onDiscard?.();
      render();
    }
  });
}

async function reviewNextScan(openBatches) {
  const [job] = await getReadyJobs();
  if (!job) return render();

  if (job.status === 'failed') {
    if (confirm(`This photo could not be scanned (${job.error}). Try again? Cancel deletes the photo.`)) {
      await retryJob(job.id);
      showToast('Retrying in the background… this can take a few minutes.', 4000);
      processQueue();
    } else {
      await deleteJob(job.id);
    }
    return render();
  }

  // The job is removed once the user saves or discards its drafts
  openReview(job.result, openBatches, {
    onSaved: () => deleteJob(job.id),
    onDiscard: () => deleteJob(job.id)
  });
}

async function processQueue() {
  const openBatches = await Repository.getOpenBatches();
  const finished = await processQueuedJobs(openBatches.map((b) => b.batch_name));
  if (finished) {
    showToast(`${finished} scanned ${finished === 1 ? 'photo is' : 'photos are'} ready to review (Batches page).`, 4000);
    if (state.view === 'batches') render();
  }
}

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
