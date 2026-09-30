import { syncEngine } from '../services/syncEngine.js';
import { openSupabaseConfigModal } from './modals.js';
import { checkAndSeedInitialData } from '../db/seed.js';

export function renderShell(activeView, contentHtml, syncStatus, onNavigate, onLogout, onReload) {
  const isOff = !syncStatus.online;
  const pending = syncStatus.pending;

  let syncHtml = '';
  if (isOff) {
    syncHtml = `<b>● Offline${pending ? ` · ${pending} pending sync` : ''}</b>`;
  } else if (pending > 0) {
    syncHtml = `<b>● ${pending} pending sync</b>`;
  } else {
    syncHtml = `<span class="ok">● All synced</span>`;
  }

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

        <div class="sync-status-box" id="sidebar-sync-box">
          <div id="sync-indicator-text">${syncHtml}</div>
          <button class="btn-link" id="btn-toggle-net">
            ${syncStatus.isSimulatedOffline ? 'Go online' : 'Simulate offline'}
          </button>
          <button class="btn-link" id="btn-open-cloud-config" style="margin-top: 2px;">
            ⚙ Supabase ${syncStatus.isSupabaseConnected ? '(Connected)' : '(Demo Mode)'}
          </button>
          ${!syncStatus.isSupabaseConnected ? `
          <button class="btn-link" id="btn-reset-demo" style="margin-top: 2px; color: var(--mut);" title="Clear IndexedDB and reload demo data">
            ↺ Reset demo data
          </button>` : ''}
        </div>
      </aside>

      <main class="main-content">
        ${contentHtml}
      </main>
    </div>
  `;
}

export function attachShellListeners(container, onNavigate, onLogout, onReload) {
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
