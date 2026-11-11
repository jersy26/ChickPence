import { renderChickCount, attachChickCount } from './chickCountView.js';
import { syncEngine } from '../services/syncEngine.js';
import { openSupabaseConfigModal } from './modals.js';
import { checkAndSeedInitialData } from '../db/seed.js';
import { navForRole, crumbFor } from './navigation.js';
import { ROLES, roleLabel, normalizeRole } from '../services/permissions.js';
import { escapeHtml } from './html.js';

/** Sync line: offline, waiting uploads, or changes the server refused (pure). */
export function renderSyncStatus(syncStatus = {}) {
  const { online = true, pending = 0, problems = 0, isSyncing = false } = syncStatus;
  if (problems > 0) return `<span class="sync-bad">⚠ ${problems} could not upload</span>`;
  if (!online) return `<b>● Offline${pending ? ` · ${pending} waiting` : ''}</b>`;
  if (pending > 0) return `<b>● ${isSyncing ? 'Uploading' : `${pending} waiting to upload`}</b>`;
  return `<span class="ok">● All synced</span>`;
}

const glyph = (path, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
export const ICONS = {
  home: glyph('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  batches: glyph('<path d="M12 3C8 3 5 11 5 15a7 7 0 0 0 14 0c0-4-3-12-7-12Z"/><path d="m5 13 4 2 3-3 3 3 4-2"/>'),
  sales: glyph('<path d="M3 7h18l-1.5 9a2 2 0 0 1-2 1.7H6.5a2 2 0 0 1-2-1.7Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>'),
  costs: glyph('<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h4"/>'),
  logbook: glyph('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>'),
  team: glyph('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
  reports: glyph('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  users: glyph('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  settings: glyph('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z"/>'),
  bell: glyph('<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  menu: glyph('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  logout: glyph('<path d="M9 4H4v16h5m0-8h12m-4-4 4 4-4 4"/>'),
  chevron: glyph('<path d="m9 6 6 6-6 6"/>', 16)
};

/**
 * What the shell shows besides the page: which subtab is open, the role being
 * previewed, who is logged in, and the bell's notifications. Set by main.js
 * before each render.
 */
let shellContext = { navKey: 'home:overview', role: 'owner', user: null, notifications: [] };
export function setShellContext(ctx) {
  shellContext = { ...shellContext, ...ctx };
}

function initials(user) {
  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  return name.slice(0, 2).toUpperCase();
}

/** Sidebar with main tabs and subtabs (pure). */
export function renderSidebar(navKey, role) {
  const activeGroup = navKey.split(':')[0];
  const groups = navForRole(role).map((g) => {
    const open = g.key === activeGroup;
    const visible = g.subs.filter(s=>!s.hidden);
    // A group with one page is a plain link, not a one-item submenu
    const subs = (visible.length > 1 ? visible : []).map((s) => `<button type="button" class="cp-sub ${s.key === navKey ? 'active' : ''}" data-nav="nav:${s.key}" ${s.key === navKey ? 'aria-current="page"' : ''}>${escapeHtml(s.label)}${s.key==='logbook:corrections'&&shellContext.notifications.some(n=>n.group==='Approvals')?`<span class="rd-pill watch">${shellContext.notifications.find(n=>n.group==='Approvals').count}</span>`:''}${s.planned ? '<i class="cp-soon">soon</i>' : ''}</button>`).join('');
    return `<div class="cp-group ${open ? 'open' : ''}">
      <button type="button" class="cp-group-btn ${open ? 'active' : ''}" data-nav="nav:${g.subs[0].key}" aria-expanded="${open}">${ICONS[g.icon]}<span>${escapeHtml(g.label)}</span>${subs ? ICONS.chevron : ''}</button>
      <div class="cp-subs">${subs}</div>
    </div>`;
  }).join('');
  return `<nav class="cp-nav" aria-label="Main menu">${groups}</nav>`;
}

/** Top bar: menu button (phones), breadcrumb, role preview, bell, sync, profile (pure). */
export function renderTopbar(navKey, role, user, notifications = [], syncHtml = '') {
  const { group, page } = crumbFor(navKey);
  const bad = notifications.filter((n) => n.tone === 'bad').length;
  const count = notifications.reduce((sum,n)=>sum+(n.count||1),0);
  const items = count ? ['Alerts','Approvals','Tasks'].map(group=>{
    const notes=notifications.filter(n=>(n.group||'Alerts')===group);if(!notes.length)return '';
    return `<li class="rd-note-group">${group}</li>${notes.map(n=>`<li><button type="button" class="cp-note ${n.tone}" data-nav="${escapeHtml(n.nav)}"><b>${escapeHtml(n.title)}</b><span>${escapeHtml(n.text)}</span></button></li>`).join('')}`;
  }).join('') : '<li class="cp-note-empty">Nothing needs your attention.</li>';
  return `<header class="cp-topbar">
    <button type="button" class="cp-icon-btn cp-menu-btn" id="btn-open-menu" aria-label="Open menu" aria-controls="cp-sidebar" aria-expanded="false">${ICONS.menu}</button>
    <div class="cp-crumb"><span>${escapeHtml(group)}</span><b>${escapeHtml(page)}</b></div>
    </header><div class="cp-top-actions cp-utilities">
      ${user?.isDemo ? `<label class="cp-role" title="Preview the app as another role. Real accounts will carry their own role.">
        <span>Demo: View as</span>
        <select id="sel-preview-role" aria-label="Preview as role">${ROLES.map((r) => `<option value="${r.id}" ${r.id === role ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
      </label>` : ''}
      <button type="button" class="sync-status cp-sync" id="sidebar-sync-box" title="Sync: waiting uploads and server problems"><span id="sync-indicator-text">${syncHtml}</span></button>
      <div class="cp-bell-wrap">
        <button type="button" class="cp-icon-btn" id="btn-bell" aria-label="Notifications${count ? `: ${count}` : ''}" aria-expanded="false" aria-controls="cp-bell-panel">${ICONS.bell}${count ? `<i class="cp-badge ${bad ? 'bad' : ''}">${count}</i>` : ''}</button>
        <div class="cp-bell-panel" id="cp-bell-panel" hidden><h2>Notifications</h2><ul>${items}</ul></div>
      </div>
      <div class="cp-profile" title="${escapeHtml(user?.email || '')}"><span class="cp-avatar">${escapeHtml(initials(user))}</span><span class="cp-profile-text"><b>${escapeHtml(user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User')}</b><small>${roleLabel(role)}${user?.isDemo ? ' · Demo' : ''}</small></span></div>
    </div>`;
}

export function renderShell(activeView, contentHtml, syncStatus) {
  const { navKey, role, user, notifications, cards = [] } = shellContext;
  const r = normalizeRole(role);
  return `
    <div class="app-container flock-app cp-app role-${r} ${activeView==='concerns'?'view-concerns':''}">
      <aside class="cp-sidebar" id="cp-sidebar" aria-label="Main navigation">
        <button type="button" class="cp-brand" data-nav="nav:home:overview" aria-label="ChickPence home"><img src="/images/chickens/logo-mark.svg" alt="" width="38" height="38"/><span>ChickPence</span></button>
        ${renderSidebar(navKey, r)}
        <button type="button" class="cp-group-btn cp-logout" id="btn-shell-logout">${ICONS.logout}<span>Log out</span></button>
      </aside>
      <div class="cp-scrim" id="cp-scrim" hidden></div>
      <main class="main-content cp-main">
        ${renderTopbar(navKey, r, user, notifications, renderSyncStatus(syncStatus))}
        <nav class="rd-phone-links" aria-label="Staff pages">${navForRole(r).filter(g=>['home','batches','logbook','settings'].includes(g.key)).map(g=>`<button type="button" class="${g.key===navKey.split(':')[0]?'active':''}" data-nav="nav:${g.subs[0].key}">${g.label}</button>`).join('')}</nav>
        ${user?.isDemo && !sessionStorage.getItem('cp-demo-note-dismissed') ? '<div class="rd-demo-note"><span>Demo mode: changes are saved on this device.</span><button type="button" id="dismiss-demo-note" class="cp-icon-btn" aria-label="Dismiss demo note">×</button></div>':''}
        ${contentHtml}
        ${import.meta.env.VITE_CHICKCOUNT_API_URL ? renderChickCount() : ''}
      </main>
    </div>
  `;
}

// Pages are redrawn often; the document-wide listeners are added once and look up the current elements.
let documentListenersBound = false;
function closeOverlays() {
  const panel = document.getElementById('cp-bell-panel');
  if (panel) panel.hidden = true;
  document.getElementById('btn-bell')?.setAttribute('aria-expanded', 'false');
  document.getElementById('cp-sidebar')?.classList.remove('drawer-open');
  const scrim = document.getElementById('cp-scrim');
  if (scrim) scrim.hidden = true;
  document.getElementById('btn-open-menu')?.setAttribute('aria-expanded', 'false');
}
function bindDocumentListenersOnce() {
  if (documentListenersBound || typeof document === 'undefined') return;
  documentListenersBound = true;
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('cp-bell-panel');
    if (panel && !panel.hidden && !panel.contains(e.target) && !e.target.closest?.('#btn-bell')) {
      panel.hidden = true;
      document.getElementById('btn-bell')?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOverlays();
  });
}

export function attachShellListeners(container, onNavigate, onLogout, onReload, onSyncStatus, onRoleChange) {
  attachChickCount(container);
  container.querySelector('#dismiss-demo-note')?.addEventListener('click',e=>{sessionStorage.setItem('cp-demo-note-dismissed','yes');e.currentTarget.parentElement.remove();});
  container.querySelector('#sidebar-sync-box')?.addEventListener('click', () => onSyncStatus?.());

  container.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-nav');
      if (target) onNavigate(target);
    });
  });

  container.querySelector('#btn-shell-logout')?.addEventListener('click', onLogout);

  container.querySelector('#sel-preview-role')?.addEventListener('change', (e) => onRoleChange?.(e.target.value));

  // Phones: the sidebar slides in as a drawer
  const sidebar = container.querySelector('#cp-sidebar');
  const scrim = container.querySelector('#cp-scrim');
  const menuBtn = container.querySelector('#btn-open-menu');
  const setMenu = (open) => {
    sidebar?.classList.toggle('drawer-open', open);
    if (scrim) scrim.hidden = !open;
    menuBtn?.setAttribute('aria-expanded', String(open));
  };
  menuBtn?.addEventListener('click', () => setMenu(!sidebar.classList.contains('drawer-open')));
  scrim?.addEventListener('click', () => setMenu(false));

  // Bell panel
  const bell = container.querySelector('#btn-bell');
  const panel = container.querySelector('#cp-bell-panel');
  const setPanel = (open) => {
    if (!panel) return;
    panel.hidden = !open;
    bell.setAttribute('aria-expanded', String(open));
  };
  bell?.addEventListener('click', (e) => {
    e.stopPropagation();
    setPanel(panel.hidden);
  });
  bindDocumentListenersOnce();

  container.querySelector('#btn-toggle-net')?.addEventListener('click', () => syncEngine.toggleSimulatedOffline());
  container.querySelector('#btn-open-cloud-config')?.addEventListener('click', () => openSupabaseConfigModal(onReload));
  container.querySelector('#btn-reset-demo')?.addEventListener('click', async () => {
    if (!confirm('Reset all demo data? This clears IndexedDB and reloads the seed batches.')) return;
    await checkAndSeedInitialData(true);
    onReload();
  });
}
