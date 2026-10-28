import './style.css';
import { AuthService } from './services/auth.js';
import { Repository } from './services/repository.js';
import { prepareLocalDataFor } from './db/localData.js';
import { syncEngine } from './services/syncEngine.js';
import { renderShell, attachShellListeners, renderSyncStatus } from './ui/shell.js';
import { openSyncProblemsModal } from './ui/syncProblemsModal.js';
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
import { extractFromRecords } from './services/localLlm.js';
import { attachInsightsCard, replaceInsightsCard } from './ui/insightsCard.js';
import { isVoiceModelCached } from './services/speechInput.js';
import { fileKind, readLogFile, markDuplicates, importNotes } from './services/fileImport.js';
import { buildDashboardFacts, buildBatchFacts, loadInsights, onInsightsChange, getSuggestionsMode } from './services/insightsService.js';
import {
  localToday,
  aiUnavailableReason,
  resizeImage,
  parseImage,
  normalizeDrafts,
  parseSpokenEntry,
  draftToFormPrefill,
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
  voice: null,             // Voice typing in the entry form: { transcript, message, tone, busy, prefill } | null
  expenseVisibleCount: 15, // how many Farm Expenses rows are shown before "Load More"
  historySearch: '',
  historyStatus: 'All',
  insights: null,          // Suggestions card on screen: { scope, facts } | null
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

  // Suggestions finished in the background: update the card if it is on screen
  onInsightsChange((scope) => {
    if (state.insights?.scope === scope) refreshInsightsCard();
  });

  // 4. Initial render
  await render();
}

/** Sync screen (sidebar status): waiting uploads and refused changes, which can be retried or discarded. */
function openSync() {
  openSyncProblemsModal({
    load: async () => {
      const [items, batches] = await Promise.all([db.outbox.orderBy('id').toArray(), db.batches.toArray()]);
      return { items, online: syncEngine.isOnline(), batchNames: new Map(batches.map((b) => [b.batch_id, b.batch_name])) };
    },
    onRetry: () => syncEngine.syncNow(),
    onDiscard: async (item) => {
      const removed = await syncEngine.discard(item);
      showToast(`Discarded ${removed === 1 ? 'the change' : `${removed} records`} from this device.`);
      render();
    }
  });
}

function updateSyncIndicator() {
  const syncBox = document.getElementById('sidebar-sync-box');
  if (!syncBox) return;

  const indicatorText = document.getElementById('sync-indicator-text');
  if (indicatorText) indicatorText.innerHTML = renderSyncStatus(state.syncStatus);

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
  state.insights = null;

  if (state.view === 'dashboard') {
    const [openBatchesData, closedBatchesData] = await Promise.all([
      loadOpenBatchesData(),
      Repository.getClosedBatchesWithData()
    ]);

    const insights = await showInsights('dashboard', buildDashboardFacts(openBatchesData, closedBatchesData, localToday()));
    contentHtml = renderDashboard(openBatchesData, closedBatchesData, state.collapsedBatchIds, insights);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render, openSync);
    attachDashboardListeners(appContainer, navigate, render, state.collapsedBatchIds, openBatchesData, closedBatchesData);
    attachInsightsCard(appContainer, () => refreshInsightsCard({ force: true }));

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
      await loadImportState(),
      state.voice,
      await isVoiceModelCached()
    );

    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render, openSync);
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
          // Keep what was said so it can be read again, but not the other tab's values
          if (state.voice) state.voice = { transcript: state.voice.transcript };
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
          state.voice = null;
          render();
        },
        onExpensePreview: async (date, feedPeso, otherPeso) => {
          state.expensePreview = await buildExpensePreview(date, feedPeso, otherPeso);
          render();
        },
        onLoadMoreExpenses: () => {
          state.expenseVisibleCount += 15;
          render();
        },
        onScanPhoto: (file) => scanLogbookPhoto(file, openBatchesData.map((d) => d.batch)),
        onImportFile: (file) => importLogFile(file, openBatchesData.map((d) => d.batch)),
        onReviewScans: () => reviewNextScan(openBatchesData.map((d) => d.batch)),
        onAiSettings: () => openLocalAiModal(render),
        onVoiceResult: (text) => fillFormFromVoice(text, openBatchesData.map((d) => d.batch))
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
    attachShellListeners(appContainer, navigate, handleLogout, render, openSync);
    attachHistoryListeners(appContainer, navigate, (search, status) => {
      if (search !== null) state.historySearch = search;
      if (status !== null) state.historyStatus = status;
      render();
    }, () => openExport(allBatches));

  } else if (state.view === 'summary') {
    const batchId = state.selectedBatchId;
    const [batchData, closedBatchesData] = await Promise.all([
      batchId ? Repository.getBatchFullDetails(batchId) : null,
      Repository.getClosedBatchesWithData()
    ]);

    const insights = batchData?.batch
      ? await showInsights(`batch:${batchId}`, buildBatchFacts(batchData, closedBatchesData, localToday()))
      : null;
    contentHtml = renderSummary(batchData, insights);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render, openSync);
    attachSummaryListeners(appContainer, navigate, batchData?.batch
      ? async () => openExport(await Repository.getAllBatches(), batchId)
      : null);
    attachInsightsCard(appContainer, () => refreshInsightsCard({ force: true }));
  }

  updateSyncIndicator();
}

// ---------------------------------------------------------------------------
// AI suggestions (computed numbers → local AI → Suggestions card; advice only)
// ---------------------------------------------------------------------------

/** Card state for the page being rendered; writes new suggestions in the background when the numbers changed. */
async function showInsights(scope, facts) {
  if (getSuggestionsMode() === 'off') return null; // the card is hidden (⚙ Local AI settings)
  state.insights = { scope, facts };
  return loadInsights(scope, facts, localToday());
}

/** Redraw just the Suggestions card (after a background run, or Refresh). */
async function refreshInsightsCard(opts) {
  const current = state.insights;
  if (!current) return;
  const insights = await loadInsights(current.scope, current.facts, localToday(), opts);
  if (state.insights !== current) return; // the user moved to another page meanwhile
  replaceInsightsCard(appContainer, insights, () => refreshInsightsCard({ force: true }));
}

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

// ---------------------------------------------------------------------------
// File import (Excel / CSV / PDF → drafts → review modal → Repository.save*)
// ---------------------------------------------------------------------------

async function importLogFile(file, openBatches) {
  const kind = fileKind(file);
  if (kind === 'image') return scanLogbookPhoto(file, openBatches);
  if (kind === 'old-spreadsheet') return showToast('Save the spreadsheet as Excel Workbook (.xlsx) or CSV first, then import it.', 5000);
  if (kind === 'unknown') return showToast('ChickPence can import Excel (.xlsx), CSV and PDF files, and photos.', 4000);

  showToast(`Reading ${file.name}…`);
  let result;
  try {
    result = await readLogFile(file, { today: localToday(), batches: openBatches.map((b) => b.batch_name) });
  } catch (err) {
    console.error('Import failed', err);
    return showToast(`Could not read ${file.name}: ${err.message}`, 5000);
  }

  // A scanned PDF has no text: its pages go to the logbook scan like photos
  if (result.pageImages) {
    for (const blob of result.pageImages) await queueImageJob(await resizeImage(blob));
    const n = result.pageImages.length;
    const pages = n === 1
      ? 'its page is being read like a logbook photo. It appears'
      : `${result.pageCount > n ? `the first ${n} of its ${result.pageCount} pages are` : `its ${n} pages are`} being read like logbook photos. They appear`;
    showToast(`This PDF is a scan, so ${pages} under "Review scanned" when ready.`, 6000);
    processQueue();
    return render();
  }

  let aiNotes = '';
  if (result.unread.length) ({ result, aiNotes } = await readUnrecognisedWithAi(result, file.name, openBatches));

  const [expenses, feed, mortality, sales] = await Promise.all([
    db.expenses.toArray(), db.feed_logs.toArray(), db.mortality_logs.toArray(), db.sales.toArray()
  ]);
  const drafts = markDuplicates(normalizeDrafts(result.entries, openBatches), { expenses, feed, mortality, sales });
  openImportReviewModal({
    drafts,
    openBatches,
    notes: [importNotes(result), aiNotes].filter(Boolean).join(' '),
    fileName: file.name,
    onSaved: () => render(),
    onDiscard: () => render()
  });
}

const MAX_AI_LINES = 40; // the CPU model needs about half a minute per line

/**
 * Offer to let the local AI read the lines the import rules did not
 * recognise. Returns the result with those entries added (they are drafts
 * like the rest), and a note on what the AI could not read.
 */
async function readUnrecognisedWithAi(result, fileName, openBatches) {
  if (await aiUnavailableReason()) return { result, aiNotes: '' };
  const lines = result.unread.slice(0, MAX_AI_LINES);
  const ask = `${result.unread.length} ${result.unread.length === 1 ? 'line' : 'lines'} in ${fileName} ${result.unread.length === 1 ? 'was' : 'were'} not recognised.`
    + ` Let the local AI read ${lines.length < result.unread.length ? `the first ${lines.length}` : 'them'}? This can take a few minutes.`;
  if (!confirm(ask)) return { result, aiNotes: '' };

  const controller = new AbortController();
  const progress = openScanProgressModal({ title: `Reading ${fileName}`, onCancel: () => controller.abort() });
  progress.update(`Reading ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} with the local AI…`);
  try {
    const ai = await extractFromRecords(lines, {
      today: localToday(),
      batches: openBatches.map((b) => b.batch_name),
      signal: controller.signal,
      onProgress: progress.update
    });
    progress.close();
    const read = new Set(ai.entries.map((e) => e.source_text));
    return {
      result: { ...result, entries: [...result.entries, ...ai.entries], unread: result.unread.filter((l) => !read.has(l)) },
      aiNotes: ai.entries.length ? `The local AI read ${ai.entries.length} of the unrecognised lines; check them carefully.` : ''
    };
  } catch (err) {
    progress.close();
    if (!controller.signal.aborted) showToast(`The local AI could not read them: ${err.message}`, 5000);
    return { result, aiNotes: '' };
  }
}

async function processQueue() {
  const openBatches = await Repository.getOpenBatches();
  const finished = await processQueuedJobs(openBatches.map((b) => b.batch_name));
  if (finished) {
    showToast(`${finished} scanned ${finished === 1 ? 'photo is' : 'photos are'} ready to review (Batches page).`, 4000);
    if (state.view === 'batches') render();
  }
}

/** Allocation preview of a not-yet-saved expense, from the local DB. null when no batch is active that day. */
async function buildExpensePreview(date, feedPeso, otherPeso) {
  const fakeExpense = {
    expense_id: 'preview',
    entry_date: date,
    feed_centavos: Math.round(feedPeso * 100),
    other_centavos: Math.round(otherPeso * 100)
  };

  const [allBatches, allMort, allSales] = await Promise.all([
    db.batches.filter((b) => !b.deleted_at).toArray(),
    db.mortality_logs.filter((m) => !m.deleted_at).toArray(),
    db.sales.filter((s) => !s.deleted_at).toArray()
  ]);

  const result = computeAllocationsForExpense(fakeExpense, allBatches, allMort, allSales);
  if (!result) {
    showToast(`No batch is active on ${date}. Cannot allocate.`);
    return null;
  }
  return result.rows.map((row) => {
    const batch = allBatches.find((b) => b.batch_id === row.batch_id);
    return {
      batchName: batch?.batch_name || row.batch_id,
      feedShare: row.feed_centavos / 100,
      otherShare: row.other_centavos / 100
    };
  });
}

// ---------------------------------------------------------------------------
// Voice typing (spoken sentence → prefilled entry form → user taps Save)
// ---------------------------------------------------------------------------

const ENTRY_LABEL = { expense: 'farm expense', feed: 'feed', mortality: 'mortality', sale: 'sale' };
const FIELD_LABEL = {
  date: 'date', batch_id: 'batch', feed_amount: 'feed amount', other_amount: 'other costs', quantity_kg: 'quantity',
  count: 'deaths', buyer_name: 'buyer', quantity_sold: 'heads', weight_kg: 'weight', price_per_kg: 'price per kg'
};

async function fillFormFromVoice(transcript, openBatches) {
  state.voice = { transcript, message: 'Reading what you said…', tone: 'info', busy: true };
  try {
    const { entry, notes } = await parseSpokenEntry(transcript, openBatches.map((b) => b.batch_name), {
      onProgress: (message) => {
        state.voice = { ...state.voice, message: `${message} This can take a few minutes.` };
        render();
      }
    });
    if (!entry) {
      state.voice = { transcript, message: `${notes} Try again, or fill in the form yourself.`, tone: 'warn' };
      return render();
    }

    const [draft] = normalizeDrafts([entry], openBatches);
    const prefill = draftToFormPrefill(draft);
    state.activeTab = prefill.tab;
    state.editingItem = null;
    state.expensePreview = null;
    if (prefill.batch_id) state.selectedBatchId = prefill.batch_id;

    // Save Expense needs the allocation preview first
    if (draft.type === 'expense' && (draft.feed_amount || draft.other_amount) && draft.date) {
      state.expensePreview = await buildExpensePreview(draft.date, draft.feed_amount || 0, draft.other_amount || 0);
    }

    const check = prefill.uncertain.map((f) => FIELD_LABEL[f] || f);
    state.voice = {
      transcript,
      prefill,
      tone: check.length ? 'warn' : 'ok',
      message: [
        `Filled in a ${ENTRY_LABEL[draft.type]} entry.`,
        check.length ? `Check the ${check.join(', ')}, then tap Save.` : 'Check it, then tap Save.',
        notes
      ].filter(Boolean).join(' ')
    };
  } catch (err) {
    console.error('Voice entry failed', err);
    state.voice = { transcript, message: `Could not read that: ${err.message}`, tone: 'warn' };
  }
  render();
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
  state.voice = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}

async function handleLogout() {
  await AuthService.logout();
  state.view = 'login';
  state.selectedBatchId = null;
  state.editingItem = null;
  state.expensePreview = null;
  state.voice = null;
  render();
}

// Start application
initApp();
