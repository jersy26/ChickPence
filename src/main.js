import { renderConcerns, attachConcerns, addConcernReply, changeConcernStatus } from './ui/concernsView.js';
import { sampleConcerns, visibleConcerns } from './ui/concernsModel.js';
import { renderOpenBatches, renderCompare, renderSales, renderCosts, renderDailyEntry } from './ui/operationsView.js';
import { attachRedesignKit, empty, table, pill, header, barChart } from './ui/redesignKit.js';
import { openQuickEntry } from './ui/quickEntry.js';
import { readPreview, writePreview, assignedItems } from './ui/previewState.js';
import { openCloseBatchModal, openThresholdModal } from './ui/modals.js';
import { escapeHtml } from './ui/html.js';
import { formatPeso } from './services/calculations.js';
import { pnlForMonth } from './services/pnlCalendar.js';
import './style.css';
import './redesign.css';
import { AuthService } from './services/auth.js';
import { Repository } from './services/repository.js';
import { prepareLocalDataFor } from './db/localData.js';
import { syncEngine } from './services/syncEngine.js';
import { renderShell, attachShellListeners, renderSyncStatus, setShellContext } from './ui/shell.js';
import { findSub, defaultSubFor, navForRole, LABS } from './ui/navigation.js';
import { renderGuidedCards, openAnswerModal, renderTodo, renderTaskTracker, mascotState, renderGreeting } from './ui/homeWidgets.js';
import { buildLogRows, renderLogbook, attachLogbookListeners } from './ui/logbookView.js';
import { renderReports, attachReports } from './ui/reportsView.js';
import { renderApprovals, attachApprovals } from './ui/approvalsView.js';
import { newReviewRequest, reviewRequest } from './services/reviewRequests.js';
import { renderPriceCheck, attachPriceCheckListeners } from './ui/priceCheckView.js';
import { loadPreviewUsers, savePreviewUsers, renderUsers, attachUsersListeners, renderRoles } from './ui/usersView.js';
import { taskHistory, renderTeamBoard, renderSettings, attachSettingsListeners, renderPlanned } from './ui/miscViews.js';
import { buildGuidedQuestions, cardsForRole } from './services/guidedQuestions.js';
import { buildDailyTasks, clockOf } from './services/dailyTasks.js';
import { getFarmSettings, saveFarmSettings, getDayMarks, setDayMark } from './services/farmSettings.js';
import { normalizeRole } from './services/permissions.js';
import { openSyncProblemsModal, describeChange } from './ui/syncProblemsModal.js';
import { renderLogin, attachLoginListeners } from './ui/loginView.js';
import { renderWelcome, attachWelcome, attachCompanion } from './ui/flockCompanion.js';
import { buildPnlLedger } from './services/pnlCalendar.js';
import { renderDashboard, attachDashboardListeners } from './ui/dashboardView.js';
import { renderBatches, attachBatchesListeners, isEntryModalOpen } from './ui/batchesView.js';
import { renderHistory, attachHistoryListeners } from './ui/historyView.js';
import { exportBatch, exportBatchList, exportFarmExpenses } from './services/exportService.js';
import { openExportModal } from './ui/exportMenu.js';
import { renderSummary, attachSummaryListeners } from './ui/summaryView.js';
import { calcBatchMetrics, liveHeadCount, computeAllocationsForExpense } from './services/allocationEngine.js';
import { db } from './db/dexie.js';
import { showToast } from './ui/toast.js';
import { openImportReviewModal, openScanProgressModal } from './ui/importReviewModal.js';
import { openLocalAiModal } from './ui/localAiModal.js';
import { extractFromRecords } from './services/localLlm.js';
import { attachInsightsCard, replaceInsightsCard } from './ui/insightsCard.js';
import { isVoiceModelCached } from './services/speechInput.js';
import { fileKind, readLogFile, markDuplicates, importNotes } from './services/fileImport.js';
import { buildBatchFacts, loadInsights, onInsightsChange, getSuggestionsMode } from './services/insightsService.js';
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
  activeTab: 'Feed',
  batchSection: 'Overview',
  compareIds: [],
  salesFilters: {},
  costFilters: {},
  concernsState: {filter:'All',selectedId:null},
  editingItem: null,
  expensePreview: null,    // Array of { batchName, feedShare, otherShare } | null
  voice: null,             // Voice typing in the entry form: { transcript, message, tone, busy, prefill } | null
  expenseVisibleCount: 15, // how many Farm Expenses rows are shown before "Load More"
  historySearch: '',
  historyStatus: 'All',
  insights: null,          // Suggestions card on screen: { scope, facts } | null
  collapsedBatchIds: getInitialCollapsedBatchIds(),
  navKey: 'home:overview', // highlighted subtab in the sidebar
  role: normalizeRole(getFarmSettings().previewRole), // role being previewed
  plannedId: null,         // which planned page is open
  pendingAnchor: null,     // section to scroll to after the next render
  logFilters: {},
  logLimit: 50,
  logTab: 'entries',
  logPage: 1,
  logSize: 10,
  reportState: {tab:'flock',filters:{},page:1,size:10},
  approvalState: {tab:'pending',filters:{},page:1,size:10,requestId:null,entryId:null},
  priceInput: {},
  priceFocus: null,
  userFilters: {},
  gqExpanded: false,
  mascotBatchId: null,
  showWelcome: false,
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
    await openLocalDataFor(AuthService.getUser());
  }

  // 3. Sync engine subscription
  state.syncStatus = await syncEngine.getSyncStatus();
  syncEngine.subscribe((newStatus) => {
    state.syncStatus = newStatus;
    updateSyncIndicator();
  });

  if (syncEngine.isOnline()) {
    // Show records downloaded at start-up (not while the login form is open)
    syncEngine.syncNow().then(refreshFromBackground);
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

/**
 * Match the records on this device to the user who just logged in. Returns
 * false when that user cannot start yet (Demo Mode while an account's changes
 * wait to upload; Demo Mode would discard them): they are logged out again.
 */
async function openLocalDataFor(user) {
  const { action, unsynced, ownerEmail } = await prepareLocalDataFor(user);
  if (action === 'blocked') {
    await AuthService.logout();
    state.view = 'login';
    const changes = unsynced === 1 ? '1 change' : `${unsynced} changes`;
    showToast(`Demo Mode is not available yet: ${changes} from ${ownerEmail || 'an account'} ${unsynced === 1 ? 'is' : 'are'} not uploaded. Log in ${ownerEmail ? `as ${ownerEmail}` : 'with that account'} while online so ${unsynced === 1 ? 'it uploads' : 'they upload'} first.`, 8000);
    return false;
  }
  if (action === 'keep-unsynced') {
    showToast('Some records from the previous account are not uploaded yet, so they were kept on this device.', 5000);
  }
  return true;
}

/**
 * Redraw after something changed in the background (a sync finished, a photo
 * was scanned), but not over an entry being typed: closing the form redraws.
 */
function refreshFromBackground() {
  if (!AuthService.isLoggedIn() || isEntryModalOpen(appContainer)) return;
  render();
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

// Each render() awaits the database (and the local AI check), so one started
// earlier can finish later. Only the latest may draw: an older one would put
// back the page the user just left, under the new page's highlighted nav.
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const isLatest = () => seq === renderSeq;

  if (!AuthService.isLoggedIn() || state.view === 'login') {
    state.insights = null;
    appContainer.innerHTML = renderLogin();
    attachLoginListeners(appContainer, async () => {
      if (!(await openLocalDataFor(AuthService.getUser()))) return render();
      state.view = 'dashboard';
      state.navKey = 'home:overview';
      const welcomeKey=`welcome:${AuthService.getUser()?.id}`;
      state.showWelcome=readPreview(AuthService.getUser()?.id,welcomeKey,'')!==localToday();
      writePreview(AuthService.getUser()?.id,welcomeKey,localToday());
      window.scrollTo(0, 0);
      await render();
      // A real account downloads its records right away
      if (syncEngine.isOnline()) syncEngine.syncNow().then(refreshFromBackground);
    });
    return;
  }

  let contentHtml = '';

  // Guided questions and today's tasks feed both Home and the bell on every page
  const home = await loadHomeModel();
  if (!isLatest()) return;
  setShellContext({ navKey: state.navKey, role: state.role, user: displayUser(), notifications: notificationsFrom(home), cards: home.cards });

  if (state.view === 'dashboard') {
    const { openBatchesData, closedBatchesData, expenses: calendarExpenses, settings } = home;

    // The guided questions replace the local-AI Suggestions card on Home
    const card = null;
    if (!isLatest()) return;
    state.insights = card && { scope: card.scope, facts: card.facts };
    const todayNet = buildPnlLedger([...openBatchesData, ...closedBatchesData], calendarExpenses).days.get(home.today)?.net || 0;
    const mascot = mascotState(openBatchesData, home.today, settings.targetHarvestDays, home.cards, {
      tasks: home.tasks, role: state.role, urgentCount: home.cards.filter(c=>c.tone==='bad').length, monthNetCentavos: pnlForMonth(buildPnlLedger([...openBatchesData,...closedBatchesData],calendarExpenses),home.today.slice(0,7)).net, dailyNetCentavos: todayNet, dailyDeathLimit: settings.dailyDeathLimit, selectedBatchId: state.mascotBatchId
    });
    contentHtml = renderDashboard(openBatchesData, closedBatchesData, state.collapsedBatchIds, card?.insights ?? null, calendarExpenses, {
      role: state.role,
      tasks: home.tasks, targetDays: settings.targetHarvestDays,
      mascot,
      cards: home.cards,
      taskTrackerHtml: renderTaskTracker(home.tasks),
      greetingHtml: renderGreeting(displayUser(), mascot, settings.targetHarvestDays),
      cardsHtml: renderGuidedCards(home.cards, { expanded: state.gqExpanded, role: state.role, batchNames: Object.fromEntries([...home.openBatchesData,...home.closedBatchesData].map(i=>[i.batch.batch_id,i.batch.batch_name])), seen: readPreview(AuthService.getUser().id,`insights-seen:${home.today}`,[]) }),
      todoHtml: renderTodo(home.tasks,{compact:true})
    });
    appContainer.innerHTML = `${state.showWelcome ? renderWelcome(displayUser(),{alerts:notificationsFrom(home).length,tasks:home.tasks.total-home.tasks.done,questions:home.cards.length}) : ''}${renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render)}`;
    attachWelcome(appContainer);
    attachCompanion(appContainer, batchId => { state.mascotBatchId = batchId; render(); });
    attachShellListeners(appContainer, navigate, handleLogout, render, openSync, changeRole);
    attachDashboardListeners(appContainer, navigate, render, state.collapsedBatchIds, openBatchesData, closedBatchesData, calendarExpenses);
    attachInsightsCard(appContainer, () => refreshInsightsCard({ force: true }));
    attachHomeListeners(home);

  } else if (state.view === 'batches') {
    state.insights = null;
    drawPage(renderOpenBatches(home.openBatchesData,{selectedId:state.selectedBatchId,tab:state.batchSection,role:state.role,target:home.settings.targetHarvestDays,permissions:previewPerson()?.permissions||[],editableIds:editablePreviewIds(home)}));

  } else if (state.view === 'sales-record' || state.view === 'sales-history') {
    drawPage(renderSales(home.openBatchesData,home.closedBatchesData,{history:state.view==='sales-history',filters:state.salesFilters}));
    attachLiveFilters('#rd-sales-filters',values=>{state.salesFilters=values;render();});
    appContainer.querySelector('[data-clear-sales]')?.addEventListener('click',()=>{state.salesFilters={};render();});
    appContainer.querySelector('#rd-sales-export')?.addEventListener('click',async()=>openExport(await Repository.getAllBatches()));

  } else if (state.view === 'costs') {
    drawPage(renderCosts([...home.openBatchesData,...home.closedBatchesData],home.expenses,{tab:state.navKey.split(':')[1],filters:state.costFilters}));
    attachLiveFilters('#rd-cost-filters',values=>{state.costFilters=values;render();});
    attachRecurringPreview();

  } else if (state.view === 'daily-entry') {
    drawPage(renderDailyEntry(home.openBatchesData,home.tasks,{batchId:state.selectedBatchId,marks:readPreview(AuthService.getUser().id,'day-submissions'),scope:state.role==='staff'?previewPerson()?.id:AuthService.getUser().id,role:state.role,permissions:previewPerson()?.permissions||[]}));
    appContainer.querySelector('#rd-daily-batch')?.addEventListener('change',e=>{state.selectedBatchId=e.target.value;render();});
    appContainer.querySelector('[data-submit-day]')?.addEventListener('click',e=>{
      const key=e.currentTarget.dataset.submitDay;
      if(confirm('Submit this day? This locks the daily-entry screen on this device. Saved farm records are unchanged.')) {
        writePreview(AuthService.getUser().id,'day-submissions',{...readPreview(AuthService.getUser().id,'day-submissions'),[key]:true});render();
      }
    });

  } else if (state.view === 'concerns') {
    state.insights=null;
    const user=displayUser(),scope=AuthService.getUser().id;
    const person=state.role==='staff'?previewPerson():null;
    const actor={id:person?.id||scope,name:person?.name||user.user_metadata?.full_name||user.name||user.email,role:state.role};
    const load=()=>{const saved=readPreview(scope,'concerns',user.isDemo?sampleConcerns():[]);return Array.isArray(saved)?saved:[];};
    const all=load(),visible=visibleConcerns(all,state.role,actor.id),batches=home.openBatchesData.map(i=>i.batch);
    drawPage(renderConcerns(visible,batches,state.concernsState,actor));
    attachConcerns(appContainer,visible,batches,state.concernsState,actor,{
      onChange:next=>{state.concernsState=next;return render();},
      onSave:async action=>{
        const current=load();let next;
        if(action.type==='create')next=[action.record,...current];
        else {const record=current.find(c=>c.id===action.id);if(!record)throw new Error('This concern is no longer available.');const updated=action.type==='reply'?addConcernReply(record,action.text,actor):changeConcernStatus(record,action.status,actor);next=current.map(c=>c.id===updated.id?updated:c);}
        if(!writePreview(scope,'concerns',next))throw new Error('This device could not save the concern. Try a smaller photo or free storage space.');
        showToast(action.type==='reply'?'Reply saved on this device.':action.type==='status'?'Concern status updated on this device.':'Concern preview saved on this device.');
        if(action.type!=='create')await render();
      }
    });

  } else if (state.view === 'team-activity') {
    drawPage(`<section class="page-section">${header('Activity','Follow your farm’s changes.')} ${empty('A shared activity history is on its way','Earlier versions and author history are not available yet. Saved farm entries remain in Logbook.','<button type="button" class="btn-action" data-nav="nav:logbook:all">Open Logbook</button>')}</section>`);

  } else if (state.view === 'reports') {
    const allBatches=await Repository.getAllBatches();
    const full=(await Promise.all(allBatches.map(b=>Repository.getBatchFullDetails(b.batch_id)))).filter(Boolean);
    if(!isLatest())return;
    state.insights=null;
    drawPage(renderReports(full,home.expenses,state.reportState));
    attachReports(appContainer,full,home.expenses,state.reportState,next=>{state.reportState=next;render();},navigate,()=>openExport(allBatches));

  } else if (state.view === 'approvals' || state.view === 'corrections') {
    const allBatches=await Repository.getAllBatches();
    const full=(await Promise.all(allBatches.map(b=>Repository.getBatchFullDetails(b.batch_id)))).filter(Boolean);
    const user=AuthService.getUser(),key=`review-requests:${user.id}`;
    const saved=await db.app_state.get(key),requests=Array.isArray(saved?.value)?saved.value:[];
    if(!isLatest())return;
    state.insights=null;
    const allRows=buildLogRows(full,home.expenses);
    const attributed=attributePreviewRows(allRows);
    const rows=state.role==='staff'?attributed.filter(r=>r.actorId===previewPerson()?.id):attributed;
    const corrections=state.view==='corrections';
    const visible=corrections?requests.filter(r=>r.requestedBy===user.id):requests;
    drawPage(renderApprovals(visible,rows,state.approvalState,user,state.role,corrections));
    const save=async(next)=>{await db.app_state.put({key,value:next});};
    attachApprovals(appContainer,visible,rows,state.approvalState,next=>{state.approvalState=next;render();},async input=>{
      try {
        const row=rows.find(r=>r.id===input.recordId);
        const request=newReviewRequest({row,proposed:input.proposed,reason:input.reason,user});
        // Read the latest queue before appending: another tab may have added a request.
        await db.transaction('rw',db.app_state,async()=>{const latest=await db.app_state.get(key);await save([request,...(latest?.value||[])]);});
        state.approvalState={...state.approvalState,tab:'pending',entryId:null,requestId:request.id,page:1};
        showToast('Correction request saved on this device.');render();
      } catch(err){showToast(err.message||'Could not save this request.');}
    },async(id,decision)=>{
      try {
        await db.transaction('rw',db.app_state,async()=>{const latest=await db.app_state.get(key),current=latest?.value||[],original=current.find(r=>r.id===id);if(!original)throw new Error('Request no longer exists.');const next=reviewRequest(original,{...decision,user,role:state.role});await save(current.map(r=>r.id===id?next:r));});
        state.approvalState={...state.approvalState,tab:'reviewed',page:1};showToast('Review decision saved. The original farm entry is unchanged.');render();
      } catch(err){showToast(err.message||'Could not save this decision.');}
    },()=>navigate('nav:logbook:corrections'));
    if(state.approvalState.requestId)appContainer.querySelector('.farm-review-detail')?.scrollIntoView({block:'nearest'});

  } else if (state.view === 'history') {
    const allBatches = await Repository.getAllBatches();
    const batchesWithFullData = (await Promise.all(allBatches.map((b) => Repository.getBatchFullDetails(b.batch_id)))).filter(Boolean);
    if (!isLatest()) return;
    state.insights = null;

    contentHtml = state.navKey==='batches:compare' ? renderCompare(batchesWithFullData,state.compareIds) : renderHistory(batchesWithFullData, state.historySearch, 'Closed');
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render, openSync, changeRole);
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

    const card = batchData?.batch
      ? await loadInsightsCard(`batch:${batchId}`, buildBatchFacts(batchData, closedBatchesData, localToday()))
      : null;
    if (!isLatest()) return;
    state.insights = card && { scope: card.scope, facts: card.facts };
    contentHtml = renderSummary(batchData, card?.insights ?? null);
    appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus, navigate, handleLogout, render);
    attachShellListeners(appContainer, navigate, handleLogout, render, openSync, changeRole);
    attachSummaryListeners(appContainer, navigate, batchData?.batch
      ? async () => openExport(await Repository.getAllBatches(), batchId)
      : null);
    attachInsightsCard(appContainer, () => refreshInsightsCard({ force: true }));

  } else if (state.view === 'logbook') {
    const allBatches=await Repository.getAllBatches();
    const full=(await Promise.all(allBatches.map(b=>Repository.getBatchFullDetails(b.batch_id)))).filter(Boolean);
    const queued=await db.outbox.toArray();
    if(!isLatest())return;
    state.insights=null;
    state.logTab=state.navKey==='logbook:waiting'?'sync':'entries';
    let rows=buildLogRows(full,home.expenses);
    rows=attributePreviewRows(rows);
    if(state.role==='staff')rows=rows.filter(r=>r.actorId===previewPerson()?.id);
    if(state.logTab==='sync') {
      const batchNames=new Map(allBatches.map(b=>[b.batch_id,b.batch_name]));
      const types={feed_logs:'Feed',mortality_logs:'Deaths',sales:'Sale',expenses:'Expense',batches:'Batch'};
      rows=queued.map(q=>({id:q.record_id,batchId:q.payload?.batch_id||null,batch:batchNames.get(q.payload?.batch_id)||q.payload?.batch_name||'Farm (shared)',type:types[q.table_name]||'Record',date:q.payload?.entry_date||q.payload?.sale_date||q.payload?.start_date||q.updated_at?.slice(0,10),changed:q.updated_at,change:describeChange(q,batchNames),error:q.last_error,status:q.last_error?'Needs attention':'Waiting to upload',actor:q.payload?.created_by_name||q.payload?.created_by||''}));
    }
    if(state.role==='staff'&&state.logTab==='sync')rows=attributePreviewRows(rows).filter(r=>r.actorId===previewPerson()?.id);
    drawPage(renderLogbook(rows,state.role==='staff'?home.openBatchesData.map(i=>i.batch):allBatches,state.logFilters,state.logLimit,{tab:state.logTab,page:state.logPage,size:state.logSize,role:state.role}));
    attachLogbookListeners(appContainer,rows,state.logFilters,filters=>{state.logFilters=filters;state.logPage=1;render();},null,{
      onTab:tab=>{state.logTab=tab;state.logPage=1;state.logFilters={};render();},
      onPage:page=>{state.logPage=page;render();},onSize:size=>{state.logSize=size;state.logPage=1;render();},
      onRequest:id=>{state.approvalState={...state.approvalState,entryId:id,requestId:null};navigate('nav:logbook:corrections');}
    });

  } else if (state.view === 'price-check') {
    state.insights = null;
    contentHtml = renderPriceCheck(home.openBatchesData, home.closedBatchesData, home.today, state.priceInput);
    drawPage(contentHtml);
    attachPriceCheckListeners(appContainer, (input, focusName) => {
      state.priceInput = input;
      state.priceFocus = focusName || null;
      render();
    });
    if (state.priceFocus) {
      const el = appContainer.querySelector(`#pc-form [name="${state.priceFocus}"]`);
      if (el) {
        el.focus();
        if (el.type !== 'number') el.setSelectionRange?.(el.value.length, el.value.length);
      }
    }

  } else if (state.view === 'team') {
    state.insights = null;
    const history = taskHistory({ openBatchesData: home.openBatchesData, expenses: home.expenses, today: home.today, marks: getDayMarks(), dueTime: home.settings.taskDueTime });
    contentHtml = renderTeamBoard(history, home.tasks);
    drawPage(contentHtml);

  } else if (state.view === 'users') {
    state.insights = null;
    const users = loadPreviewUsers(AuthService.getUser()?.email);
    contentHtml = renderUsers(users, state.userFilters, state.role);
    drawPage(contentHtml);
    attachUsersListeners(appContainer, users, state.role, {
      onChange: (next) => {
        savePreviewUsers(next);
        render();
      },
      onFilter: (filters) => {
        state.userFilters = filters;
        const caret = document.activeElement?.selectionStart;
        render().then(() => {
          const box = appContainer.querySelector('#user-filters [name="q"]');
          if (box && filters.q !== undefined) {
            box.focus();
            box.setSelectionRange(caret ?? box.value.length, caret ?? box.value.length);
          }
        });
      }
    });

  } else if (state.view === 'roles') {
    state.insights = null;
    drawPage(renderRoles(state.roleDetail||'staff'));
    appContainer.querySelectorAll('[data-role-detail]').forEach(b=>b.addEventListener('click',()=>{state.roleDetail=b.dataset.roleDetail;render();}));
    appContainer.querySelectorAll('[data-preview-role]').forEach(b=>b.addEventListener('click',()=>changeRole(b.dataset.previewRole)));

  } else if (state.view === 'settings') {
    state.insights = null;
    drawPage(renderSettings(home.settings, AuthService.getUser(), state.role,state.navKey.split(':')[1]));
    attachSettingsListeners(appContainer, (patch) => {
      saveFarmSettings(patch);
      showToast('Farm settings saved on this device.');
      render();
    });

  } else if (state.view === 'planned') {
    state.insights = null;
    drawPage(renderPlanned(state.plannedId));
  }

  attachRedesignKit(appContainer);
  attachOperationActions(home);
  updateSyncIndicator();

  if (state.pendingAnchor) {
    const target = document.getElementById(state.pendingAnchor);
    state.pendingAnchor = null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/** Draw a page inside the shell and attach the shell's listeners. */
function drawPage(contentHtml) {
  appContainer.innerHTML = renderShell(state.view, contentHtml, state.syncStatus);
  attachShellListeners(appContainer, navigate, handleLogout, render, openSync, changeRole);
}

// ---------------------------------------------------------------------------
// Home model: guided questions, daily tasks, notifications
// ---------------------------------------------------------------------------

async function loadHomeModel() {
  let [openBatchesData, closedBatchesData, expenses] = await Promise.all([
    loadOpenBatchesData(),
    Repository.getClosedBatchesWithData(),
    Repository.getAllExpenses()
  ]);
  if(state.role==='staff'){openBatchesData=assignedItems(openBatchesData,previewPerson());closedBatchesData=[];expenses=attributePreviewRows(buildLogRows([],expenses)).filter(r=>r.actorId===previewPerson()?.id).map(r=>expenses.find(e=>e.expense_id===r.id));}
  const today = localToday();
  const settings = getFarmSettings();
  let tasks = buildDailyTasks({ openBatchesData, expenses, today, now: clockOf(), dueTime: settings.taskDueTime, marks: getDayMarks() });
  if(state.role==='staff'&&!previewPerson()?.permissions?.includes('record.expense')){const list=tasks.tasks.filter(t=>t.type!=='receipts');tasks={tasks:list,total:list.length,done:list.filter(t=>t.done).length,overdue:list.filter(t=>t.overdue).length};}
  const cards = cardsForRole(buildGuidedQuestions({ openBatchesData, closedBatchesWithData: closedBatchesData, expenses, today, settings, tasks }), state.role);
  const saved=await db.app_state.get(`review-requests:${AuthService.getUser()?.id}`);
  const pendingReviews=(saved?.value||[]).filter(r=>r.status==='pending').length;
  return { openBatchesData, closedBatchesData, expenses, today, settings, tasks, cards, pendingReviews };
}

/** Bell items: questions that need action or watching (pure on the model). */
function notificationsFrom(home) {
  const alerts=home.cards.filter(c=>c.tone==='bad'||c.tone==='warn').map(c=>({group:'Alerts',tone:c.tone,title:c.question,text:`${c.value} · ${c.meaning}`,nav:'nav:home:insights'}));
  const tasks=home.tasks.tasks.filter(t=>t.overdue).map(t=>({group:'Tasks',tone:'warn',title:t.label,text:`Overdue · due ${t.due}`,nav:'nav:logbook:daily'}));
  const reviews=LABS&&state.role!=='staff'&&home.pendingReviews?[{group:'Approvals',count:home.pendingReviews,tone:'warn',title:`${home.pendingReviews} waiting for approval`,text:'Review farm record corrections.',nav:'nav:logbook:corrections'}]:[];
  return [...alerts,...reviews,...tasks];
}

function attachHomeListeners(home) {
  appContainer.querySelectorAll('.rd-insights [data-question]').forEach((btn) => btn.addEventListener('click', () => {
    const seen=readPreview(AuthService.getUser().id,`insights-seen:${home.today}`,[]);
    if(!seen.includes(btn.dataset.question))writePreview(AuthService.getUser().id,`insights-seen:${home.today}`,[...seen,btn.dataset.question]);
    const questionCard=btn.closest('.gq-card')||btn;questionCard.dataset.seen='true';
    const checkedLabel=questionCard.querySelector('[data-question-check]');if(checkedLabel){checkedLabel.textContent='✓ Checked';checkedLabel.classList.add('checked');}
    appContainer.querySelectorAll('[data-question-dot]').forEach(dot=>{if(dot.dataset.questionDot===btn.dataset.question)dot.classList.add('checked');});
    const progress=appContainer.querySelector('.rd-insight-progress');if(progress)progress.textContent=`${new Set([...seen,btn.dataset.question]).size} of ${home.cards.length} checked`;
    const card = home.cards.find((c) => c.id === btn.dataset.question);
    if (card) openAnswerModal(card, (view, batchId) => {
      if (view === 'price-check') state.priceInput = { batchId };
      navigate(view, batchId);
    });
  }));
  appContainer.querySelector('#btn-gq-toggle')?.addEventListener('click', () => {
    state.gqExpanded = !state.gqExpanded;
    state.pendingAnchor = 'home-insights';
    render();
  });
  appContainer.querySelectorAll('[data-task-record]').forEach((btn) => btn.addEventListener('click', () => {
    launchQuickEntry(home,btn.dataset.tab,btn.dataset.batchId||null);
  }));
  appContainer.querySelectorAll('[data-task-none]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (btn.dataset.taskNone === 'deaths') {
        await Repository.saveMortalityLog({ batch_id: btn.dataset.batchId, entry_date: home.today, count: 0 });
        showToast('Saved: no deaths today.');
      } else {
        setDayMark(`no-receipts:${home.today}`);
        showToast('Marked: no receipts today.');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not save.');
    }
    state.pendingAnchor = 'home-todo';
    render();
  }));
}

/** Preview the app as another role; pages that role cannot open fall back to Home. */
function changeRole(role) {
  state.role = normalizeRole(role);
  saveFarmSettings({ previewRole: state.role });
  const allowed = navForRole(state.role).some((g) => g.subs.some((s) => s.key === state.navKey));
  if (!allowed) {
    state.navKey = 'home:overview';
    state.view = 'dashboard';
  }
  render();
}

// ---------------------------------------------------------------------------
// AI suggestions (computed numbers → local AI → Suggestions card; advice only)
// ---------------------------------------------------------------------------

/**
 * The Suggestions card of the page being rendered: { scope, facts, insights }, or null when
 * the card is switched off. Writes new suggestions in the background when the numbers changed.
 */
async function loadInsightsCard(scope, facts) {
  if (getSuggestionsMode() === 'off') return null; // the card is hidden (⚙ Local AI settings)
  return { scope, facts, insights: await loadInsights(scope, facts, localToday()) };
}

/** Redraw just the Suggestions card (after a background run, or Refresh). */
async function refreshInsightsCard(opts) {
  const current = state.insights;
  if (!current) return;
  const insights = await loadInsights(current.scope, current.facts, localToday(), opts);
  if (state.insights !== current) return; // the user moved to another page meanwhile
  replaceInsightsCard(appContainer, insights, () => refreshInsightsCard({ force: true }));
}

/** Export modal: detailed report of one batch, the whole history, or the farm expenses. */
function openExport(allBatches, defaultBatchId = null) {
  openExportModal({
    batches: allBatches,
    defaultBatchId,
    onExport: async ({ scope, batchId, format }) => {
      if (scope === 'expenses') return exportFarmExpenses(await Repository.getAllExpenses(), format);
      if (scope === 'history') {
        const all = await Promise.all(allBatches.map((b) => Repository.getBatchFullDetails(b.batch_id)));
        return exportBatchList(all.filter(Boolean), format, await Repository.getAllExpenses());
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
  if (kind === 'old-spreadsheet') return showToast('Export the spreadsheet as Excel (.xlsx) or CSV first, then import it.', 5000);
  if (kind === 'unknown') return showToast('ChickPence can import Excel (.xlsx, .xls), OpenDocument (.ods), CSV and PDF files, and photos.', 4000);

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
    + ` Let the local AI read ${lines.length < result.unread.length ? `the first ${lines.length}` : result.unread.length === 1 ? 'it' : 'them'}? This can take a few minutes.`;
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
    if (state.view === 'batches') refreshFromBackground();
  }
}

/**
 * Allocation preview of a not-yet-saved expense, from the local DB: { rows, values }. rows is
 * null when no batch is active that day; values are the date and amounts it was made for, so
 * the redrawn form still shows what was typed.
 */
async function buildExpensePreview(date, feedPeso, otherPeso) {
  const fakeExpense = {
    expense_id: 'preview',
    entry_date: date,
    feed_centavos: Math.round(feedPeso * 100),
    other_centavos: Math.round(otherPeso * 100)
  };
  const values = {
    entry_date: date,
    feed_centavos: fakeExpense.feed_centavos || null,
    other_centavos: fakeExpense.other_centavos || null
  };

  const [allBatches, allMort, allSales] = await Promise.all([
    db.batches.filter((b) => !b.deleted_at).toArray(),
    db.mortality_logs.filter((m) => !m.deleted_at).toArray(),
    db.sales.filter((s) => !s.deleted_at).toArray()
  ]);

  const result = computeAllocationsForExpense(fakeExpense, allBatches, allMort, allSales);
  if (!result) {
    showToast(`No batch is active on ${date}. Cannot allocate.`);
    return { rows: null, values };
  }
  const rows = result.rows.map((row) => {
    const batch = allBatches.find((b) => b.batch_id === row.batch_id);
    return {
      batchName: batch?.batch_name || row.batch_id,
      feedShare: row.feed_centavos / 100,
      otherShare: row.other_centavos / 100
    };
  });
  return { rows, values };
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
  return (await Promise.all(openBatches.map((b) => Repository.getBatchFullDetails(b.batch_id)))).filter(Boolean);
}

function navigate(view, batchId = null) {
  state.showWelcome = false;
  if (view.startsWith('nav:')) return navigateTo(view.slice(4));
  state.view = view;
  state.navKey = defaultSubFor(view, { tab: state.activeTab, status: state.historyStatus, planned: state.plannedId });
  if (batchId) state.selectedBatchId = batchId;
  state.editingItem = null;
  state.expensePreview = null;
  state.voice = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}

/** Open a sidebar subtab: its page, entry tab, history filter, or section. */
async function navigateTo(key) {
  state.showWelcome = false;
  const sub = findSub(key);
  if (!sub || !navForRole(state.role).some(group=>group.subs.some(item=>item.key===key))) return;
  if (sub.action === 'export') return openExport(await Repository.getAllBatches());
  state.navKey = key;
  if(key==='reports:breakdown')state.reportState={...state.reportState,tab:'breakdown'};
  if (sub.tab) state.activeTab = sub.tab;
  if (sub.status) state.historyStatus = sub.status;
  if (sub.planned) state.plannedId = sub.planned;
  state.view = sub.view;
  state.pendingAnchor = sub.anchor || null;
  state.editingItem = null;
  state.expensePreview = null;
  state.voice = null;
  if (!sub.anchor) window.scrollTo({ top: 0, behavior: 'smooth' });
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


function displayUser(){const user=AuthService.getUser(),profile=readPreview(user?.id,'profile'),name=state.role==='staff'&&user?.isDemo?previewPerson()?.name:profile.name;return name?{...user,user_metadata:{...user.user_metadata,full_name:name}}:user;}
function previewPerson() {
  const user=AuthService.getUser();
  const people=loadPreviewUsers(user?.email);
  return people.find(p=>p.login===user?.email&&p.role==='staff') || (user?.isDemo?people.find(p=>p.role==='staff'&&p.status==='active'):null);
}
function attributePreviewRows(rows) {
 const authors=readPreview(AuthService.getUser()?.id,'entry-authors');
 return rows.map(r=>({...r,actor:r.actor||authors[r.id]?.name||'',actorId:authors[r.id]?.id||r.actor}));
}
function attachLiveFilters(selector,callback) {
 const form=appContainer.querySelector(selector);if(!form)return;
 let timer;form.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form));if(d.from&&d.to&&d.from>d.to)return showToast('Choose an end date on or after the start date.');callback(d);});
 form.addEventListener('input',e=>{clearTimeout(timer);const name=e.target.name,caret=e.target.selectionStart;timer=setTimeout(()=>{const d=Object.fromEntries(new FormData(form));if(d.from&&d.to&&d.from>d.to)return;callback(d);setTimeout(()=>{const replacement=appContainer.querySelector(`${selector} [name="${name}"]`);if(replacement){replacement.focus();if(caret!=null)replacement.setSelectionRange?.(caret,caret);}},0);},e.target.type==='search'?300:0);});
}
async function launchQuickEntry(home,tab,batchId,editing=null,prefill=null) {
 const person=state.role==='staff'?previewPerson():null;
 if(state.role==='staff'&&(!person||!['Feed','Mortality',...(person.permissions?.includes('record.expense')?['Expenses']:[]),...(person.permissions?.includes('sale.record')?['Sales']:[])].includes(tab)))return showToast('Ask your manager to enable this entry type.');
 const allowed=home.openBatchesData;
 if(tab!=='Expenses'&&!allowed.length)return showToast('No open batch is available.');
 if(state.role==='staff'&&batchId&&!allowed.some(i=>i.batch.batch_id===batchId))return;
 const [beforeItems,beforeExpenses]=await Promise.all([loadOpenBatchesData(),Repository.getAllExpenses()]);
 const existing=new Set(buildLogRows(beforeItems,beforeExpenses).map(r=>r.id));
 openQuickEntry({container:appContainer,items:allowed,closed:home.closedBatchesData,tab,batchId:batchId||state.selectedBatchId,editing,prefill,staff:state.role==='staff',previewExpense:buildExpensePreview,onSaved:async()=>{
   const full=await loadOpenBatchesData(),expenses=await Repository.getAllExpenses();
   const authors=readPreview(AuthService.getUser().id,'entry-authors');
   const actor=person||{id:AuthService.getUser().id,name:AuthService.getUser().user_metadata?.full_name||AuthService.getUser().email};
   buildLogRows(full,expenses).filter(r=>!existing.has(r.id)).forEach(r=>{authors[r.id]={id:actor.id,name:actor.name};});
   writePreview(AuthService.getUser().id,'entry-authors',authors);render();
 }});
}
function attachOperationActions(home) {
 appContainer.querySelectorAll('[data-request-entry]').forEach(b=>b.addEventListener('click',()=>{state.approvalState={...state.approvalState,entryId:b.dataset.requestEntry,requestId:null};navigate('nav:logbook:corrections');}));
 appContainer.querySelectorAll('[data-daily-none]').forEach(b=>b.addEventListener('click',async()=>{
   b.disabled=true;
   try {if(b.dataset.dailyNone==='deaths') {
      const before=new Set(buildLogRows(home.openBatchesData,[]).map(r=>r.id));
      await Repository.saveMortalityLog({batch_id:b.dataset.batchId,entry_date:home.today,count:0});
      const authors=readPreview(AuthService.getUser().id,'entry-authors'),actor=state.role==='staff'?previewPerson():{id:AuthService.getUser().id,name:displayUser().user_metadata?.full_name||AuthService.getUser().email};
      buildLogRows(await loadOpenBatchesData(),[]).filter(r=>!before.has(r.id)).forEach(r=>authors[r.id]={id:actor.id,name:actor.name});writePreview(AuthService.getUser().id,'entry-authors',authors);
   } else setDayMark(`no-receipts:${home.today}`);render();}catch(err){showToast(err.message);b.disabled=false;}
 }));
 appContainer.querySelectorAll('[data-quick-entry]').forEach(b=>b.addEventListener('click',()=>launchQuickEntry(home,b.dataset.quickEntry,b.dataset.batchId,null,b.dataset.entryDate?{entry_date:b.dataset.entryDate,sale_date:b.dataset.entryDate}:null)));
 appContainer.querySelectorAll('[data-select-batch]').forEach(b=>b.addEventListener('click',()=>{state.selectedBatchId=b.dataset.selectBatch;render();}));
 appContainer.querySelectorAll('[data-batch-section]').forEach(b=>b.addEventListener('click',()=>{state.batchSection=b.dataset.batchSection;render();}));
 appContainer.querySelectorAll('[data-compare-batch]').forEach(b=>b.addEventListener('change',()=>{state.compareIds=[...appContainer.querySelectorAll('[data-compare-batch]:checked')].map(i=>i.dataset.compareBatch);render();}));
 appContainer.querySelectorAll('[data-edit-cost]').forEach(b=>b.addEventListener('click',()=>{const e=home.expenses.find(e=>e.expense_id===b.dataset.editCost);launchQuickEntry(home,'Expenses',null,e);}));
 appContainer.querySelectorAll('[data-action="edit-row"]').forEach(b=>b.addEventListener('click',()=>{
   if(state.role==='staff'&&!editablePreviewIds(home).includes(b.dataset.id))return showToast('Request a correction in Logbook.');
   const mapping={feed_logs:['feed','feed_log_id','Feed'],mortality_logs:['mortality','mortality_id','Mortality'],sales:['sales','sale_id','Sales']},[key,id,tab]=mapping[b.dataset.table]||[];
   const item=home.openBatchesData.find(i=>i[key]?.some(r=>r[id]===b.dataset.id));if(item)launchQuickEntry(home,tab,item.batch.batch_id,item[key].find(r=>r[id]===b.dataset.id));
 }));
 appContainer.querySelectorAll('[data-action="delete-row"]').forEach(b=>b.addEventListener('click',async()=>{
   if(state.role==='staff')return showToast('Request a correction in Logbook.');
   if(confirm('Delete this saved entry? This changes the batch records and queues the deletion for upload.')){const original=await db[b.dataset.table].get(b.dataset.id);await Repository.deleteRecord(b.dataset.table,b.dataset.id);await render();offerUndoEntry(b.dataset.table,original);}
 }));
 appContainer.querySelectorAll('[data-batch-threshold]').forEach(b=>b.addEventListener('click',()=>{const item=home.openBatchesData.find(i=>i.batch.batch_id===b.dataset.batchThreshold);if(item)openThresholdModal(item.batch,async patch=>{await Repository.updateBatchThresholds(item.batch.batch_id,patch);render();});}));
 appContainer.querySelectorAll('[data-batch-close]').forEach(b=>b.addEventListener('click',()=>{
   const item=home.openBatchesData.find(i=>i.batch.batch_id===b.dataset.batchClose);if(!item)return;
   openCloseChecklist(item,home);
 }));
 appContainer.querySelector('#rd-create-batch')?.addEventListener('click',()=>{
   const dialog=document.createElement('dialog');dialog.className='entry-drawer';dialog.setAttribute('aria-label','Create new batch');
   const temp=document.createElement('div');temp.innerHTML=renderBatches([],[],null,'Feed',null,null);
   const form=temp.querySelector('#new-batch-form-container');form.style.display='block';
   dialog.innerHTML='<button type="button" class="cp-icon-btn" data-close aria-label="Close new batch form">×</button>';dialog.append(form);appContainer.append(dialog);
   const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-close]').addEventListener('click',close);dialog.addEventListener('cancel',close);
   attachBatchesListeners(dialog,{openBatchesData:[],collapsedBatchIds:new Set()},{onReload:()=>{close();render();},onNavigate:navigate});dialog.querySelector('#btn-cancel-new-batch').addEventListener('click',close);dialog.showModal();
 });
 appContainer.querySelector('#pc-record-sale')?.addEventListener('click',()=>launchQuickEntry(home,'Sales',state.priceInput.batchId,null,{quantity_sold:state.priceInput.heads,weight_kg:state.priceInput.kg,price_per_kg:state.priceInput.price}));
 appContainer.querySelector('#pc-sell-all')?.addEventListener('click',()=>{state.priceInput={batchId:state.priceInput.batchId,price:state.priceInput.price};render();});
}
function editablePreviewIds(home) {
 const actor=state.role==='staff'?previewPerson()?.id:AuthService.getUser()?.id;
 const authors=readPreview(AuthService.getUser()?.id,'entry-authors'),submitted=readPreview(AuthService.getUser()?.id,'day-submissions');
 return buildLogRows(home.openBatchesData,home.expenses).filter(r=>authors[r.id]?.id===actor&&r.date===home.today&&!submitted[`submit-preview:${actor}:${r.batchId}:${home.today}`]).map(r=>r.id);
}
function offerUndoEntry(table,original) {
 if(!original)return;const notice=document.createElement('div');notice.className='rd-undo';notice.setAttribute('role','status');notice.innerHTML='<span>Entry deleted.</span><button class="btn-action" type="button">Undo</button>';document.body.append(notice);
 const timer=setTimeout(()=>notice.remove(),10000);
 notice.querySelector('button').onclick=async()=>{clearTimeout(timer);try{if(table==='feed_logs')await Repository.saveFeedLog({...original,quantity_kg:original.quantity_g!=null?original.quantity_g/1000:original.quantity_kg});else if(table==='mortality_logs')await Repository.saveMortalityLog(original);else if(table==='sales')await Repository.saveSale(original);notice.remove();showToast('Entry restored.');render();}catch(err){showToast(err.message);}};
}
function openCloseChecklist(item,home) {
 const d=document.createElement('dialog');d.className='gq-dialog';d.setAttribute('aria-label','Review batch before closing');
 const metrics=calcBatchMetrics(item.batch,item.allocations,item.sales,item.mortality,item.feed),live=liveHeadCount(item.batch,item.mortality,item.sales,home.today);
 d.innerHTML=`<h2>Before closing ${escapeHtml(item.batch.batch_name)}</h2><p class="text-mut">Checklist preview. Closing still follows the current farm workflow.</p><dl class="gq-numbers"><div><dt>Live birds to check</dt><dd>${live.toLocaleString()}</dd></div><div><dt>Pending reviews, farm-wide</dt><dd>${home.pendingReviews}</dd></div><div><dt>Recorded sales</dt><dd>${formatPeso(metrics.revenue)}</dd></div><div><dt>Recorded net</dt><dd>${formatPeso(metrics.netProfit)}</dd></div></dl><p class="text-mut">Confirm all birds and final entries have been accounted for. The existing confirmation follows.</p><div class="rd-action-row"><button type="button" class="btn-action" data-cancel>Keep open</button><button type="button" class="btn-action primary" data-continue>Continue to close</button></div>`;
 document.body.append(d);const close=()=>{d.close();d.remove();};d.querySelector('[data-cancel]').onclick=close;d.addEventListener('cancel',close);d.querySelector('[data-continue]').onclick=()=>{close();openCloseBatchModal(item.batch,item.sales.length,async()=>{await Repository.closeBatch(item.batch.batch_id);navigate('summary',item.batch.batch_id);});};d.showModal();
}
function attachRecurringPreview() {
 const list=appContainer.querySelector('#rd-recurring-list');if(!list)return;
 const scope=AuthService.getUser().id,rows=readPreview(scope,'recurring-costs',[]);
 list.innerHTML=rows.length?table(['Cost','Amount','Frequency','Start date','Status'],rows.map(r=>[escapeHtml(r.name),formatPeso(r.amount),escapeHtml(r.frequency),escapeHtml(r.start),pill('Preview only','watch')])):empty('Plan the farm’s regular costs','Add wages, water, electricity or rent as a device-only preview.');
 appContainer.querySelector('#rd-add-recurring')?.addEventListener('click',()=>{
  const d=document.createElement('dialog');d.className='entry-drawer';d.setAttribute('aria-label','Add recurring cost');d.innerHTML=`<form class="pc-form"><h2>Add recurring cost</h2><p class="text-mut">Device-only preview. No expenses are created automatically.</p><label>Name<input name="name" required maxlength="100"/></label><label>Amount (₱)<input name="amount" type="number" min="0.01" step="0.01" required/></label><label>How often<select name="frequency"><option>Monthly</option><option>Weekly</option><option>Daily</option></select></label><label>Start date<input name="start" type="date" required value="${localToday()}"/></label><div class="rd-action-row"><button class="btn-action" type="button" data-close>Cancel</button><button class="btn-action primary" type="submit">Save preview</button></div></form>`;appContainer.append(d);d.querySelector('[data-close]').onclick=()=>{d.close();d.remove();};d.addEventListener('cancel',()=>d.remove());d.querySelector('form').onsubmit=e=>{e.preventDefault();writePreview(scope,'recurring-costs',[...rows,Object.fromEntries(new FormData(e.currentTarget))]);d.close();d.remove();render();};d.showModal();
 });
}

// Start application
initApp();
