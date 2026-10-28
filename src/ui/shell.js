import { syncEngine } from '../services/syncEngine.js';
import { openSupabaseConfigModal } from './modals.js';
import { checkAndSeedInitialData } from '../db/seed.js';

/** Sidebar sync line: offline, waiting uploads, or changes the server refused (pure). */
export function renderSyncStatus(syncStatus = {}) {
  const { online = true, pending = 0, problems = 0, isSyncing = false } = syncStatus;
  if (problems > 0) return `<span class="sync-bad">⚠ ${problems} could not upload</span>`;
  if (!online) return `<b>● Offline${pending ? ` · ${pending} waiting` : ''}</b>`;
  if (pending > 0) return `<b>● ${isSyncing ? 'Uploading' : `${pending} waiting to upload`}</b>`;
  return `<span class="ok">● All synced</span>`;
}

export function renderShell(activeView, contentHtml, syncStatus, onNavigate, onLogout, onReload) {
  const syncHtml = renderSyncStatus(syncStatus);

  const navItem = (key, label) => `
    <button class="nav-link ${activeView === key ? 'active' : ''}" data-nav="${key}">
      ${label}
    </button>
  `;

  return `
    <div class="app-container">
      <aside class="sidebar">
        <div class="logo-brand cursor-pointer" data-nav="dashboard">
          <span style="font-size: 22px;">🐥</span>
          <span>ChickPence</span>
        </div>

        ${navItem('dashboard', 'Dashboard')}
        ${navItem('batches', 'Open Batches')}
        ${navItem('history', 'History')}

        <button class="nav-link" id="btn-shell-logout">
          Logout
        </button>

        <button type="button" class="sync-status-box sync-status" id="sidebar-sync-box" title="Sync: what is waiting to upload, and changes the server refused">
          <span id="sync-indicator-text">${syncHtml}</span>
        </button>

      </aside>

      <main class="main-content">
        ${contentHtml}
      </main>
    </div>
  `;
}

export function attachShellListeners(container, onNavigate, onLogout, onReload, onSyncStatus) {
  container.querySelector('#sidebar-sync-box')?.addEventListener('click', () => onSyncStatus?.());

  container.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-nav');
      if (target) onNavigate(target);
    });
  });

  const logoutBtn = container.querySelector('#btn-shell-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', onLogout);
  }

  const toggleNetBtn = container.querySelector('#btn-toggle-net');
  if (toggleNetBtn) {
    toggleNetBtn.addEventListener('click', () => {
      syncEngine.toggleSimulatedOffline();
    });
  }

  const cloudBtn = container.querySelector('#btn-open-cloud-config');
  if (cloudBtn) {
    cloudBtn.addEventListener('click', () => {
      openSupabaseConfigModal(onReload);
    });
  }

  const resetDemoBtn = container.querySelector('#btn-reset-demo');
  if (resetDemoBtn) {
    resetDemoBtn.addEventListener('click', async () => {
      if (!confirm('Reset all demo data? This clears IndexedDB and reloads the seed batches.')) return;
      await checkAndSeedInitialData(true);
      onReload();
    });
  }
}
