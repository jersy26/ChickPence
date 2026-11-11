/**
 * navigation.js
 * The seller-center style menu (thesis audit, section 14): main tabs with
 * subtabs, filtered by role. Each subtab says which page it opens and how
 * (batch entry tab, history filter, section to scroll to, planned page).
 */

import { can } from '../services/permissions.js';

/**
 * Sub fields:
 *   view     page to render (main.js routes it)
 *   tab      Batches entry tab to open (Expenses, Feed, Mortality, Sales)
 *   status   History filter (All, Open, Closed)
 *   anchor   element id to scroll to after the page draws
 *   planned  id of a planned page (see plannedView.js)
 *   action   special action instead of a page (export)
 *   perm     permission needed (permissions.js)
 *   labs     device-only or planned page, in the menu only when VITE_LABS=true
 */

/** Unfinished pages stay out of the menu unless the build turns them on. */
export const LABS = import.meta.env?.VITE_LABS === 'true';
export const NAV = [
  {
    key: 'home', label: 'Home', icon: 'home',
    subs: [
      { key: 'home:overview', label: 'Overview', view: 'dashboard' },
      { key: 'home:insights', label: 'Today’s Questions', view: 'dashboard', anchor: 'home-insights', hidden: true }
    ]
  },
  {
    key: 'batches', label: 'Batches', icon: 'batches',
    subs: [
      { key: 'batches:open', label: 'Open batches', view: 'batches', tab: 'Feed' },
      { key: 'batches:closed', label: 'Closed batches', view: 'history', status: 'Closed', perm: 'report.view' },
      { key: 'batches:compare', label: 'Compare batches', view: 'history', status: 'All', perm: 'report.view' }
    ]
  },
  {
    key: 'sales', label: 'Sales & Buyers', icon: 'sales', perm: 'sale.record',
    subs: [
      { key: 'sales:record', label: 'Record a sale', view: 'sales-record', perm: 'sale.record' },
      { key: 'sales:price', label: 'Price check', view: 'price-check', perm: 'sale.price' },
      { key: 'sales:history', label: 'Sales history', view: 'sales-history', perm: 'sale.record' },
      { key: 'sales:buyers', label: 'Buyers / Markets', view: 'planned', planned: 'buyers', perm: 'sale.buyers', labs: true }
    ]
  },
  { key: 'costs', label: 'Costs', icon: 'costs', perm: 'report.view', subs: [
    { key: 'costs:daily', label: 'Daily expenses', view: 'costs' },
    { key: 'costs:recurring', label: 'Recurring costs', view: 'costs', labs: true },
    { key: 'costs:sharing', label: 'Cost sharing', view: 'costs' }
  ] },
  {
    key: 'logbook', label: 'Logbook', icon: 'logbook',
    subs: [
      { key: 'logbook:daily', label: 'Daily entry', view: 'daily-entry' },
      { key: 'logbook:waiting', label: 'Waiting to upload', view: 'logbook' },
      { key: 'logbook:all', label: 'All entries', view: 'logbook' },
      { key: 'logbook:corrections', label: 'Correction requests', view: 'corrections', labs: true },
      { key: 'logbook:concerns', label: 'My concerns', view: 'concerns', staffOnly: true, labs: true }
    ]
  },
  {
    key: 'team', label: 'Team', icon: 'team', perm: 'team.board',
    subs: [
      { key: 'team:tasks', label: 'Task board', view: 'team' },
      { key: 'team:activity', label: 'Activity', view: 'team-activity' },
      { key: 'team:concerns', label: 'Concerns', view: 'concerns', labs: true },
      { key: 'team:payroll', label: 'Payroll', view: 'planned', planned: 'payroll', perm: 'pay.run', labs: true }
    ]
  },
  {
    key: 'reports', label: 'Reports', icon: 'reports', perm: 'report.view',
    subs: [
      { key: 'reports:summaries', label: 'Reports', view: 'reports' },
      { key: 'reports:breakdown', label: 'Profit breakdown', view: 'reports', hidden: true, labs: true }
    ]
  },
  {
    key: 'users', label: 'User Management', icon: 'users', perm: 'team.staff',
    subs: [
      { key: 'users:list', label: 'Users', view: 'users', labs: true },
      { key: 'users:roles', label: 'Roles', view: 'roles', labs: true }
    ]
  },
  {
    key: 'settings', label: 'Settings', icon: 'settings',
    subs: [
      { key: 'settings:farm', label: 'Farm', view: 'settings', perm: 'settings.farm' },
      { key: 'settings:profile', label: 'Profile & language', view: 'settings' },
      { key: 'settings:data', label: 'Data & sync', view: 'settings', perm: 'settings.data' }
    ]
  }
];

const ALL_SUBS = NAV.flatMap((g) => g.subs.map((s) => ({ ...s, group: g.key })));

/** The menu a role may see: groups and subtabs it has no permission for are left out. */
export function navForRole(role, labs = LABS) {
  return NAV
    .filter((g) => !g.perm || can(role, g.perm))
    .map((g) => ({ ...g, subs: g.subs.filter((s) => (labs || !s.labs) && (!s.staffOnly || role==='staff') && (!s.perm || can(role, s.perm))).map(s=>role==='staff'&&s.key==='logbook:all'?{...s,label:'My entries'}:s) }))
    .filter((g) => g.subs.length);
}

export function findSub(key) {
  return ALL_SUBS.find((s) => s.key === key) || null;
}

/** The subtab to highlight when a page is opened some other way (a button, a link). */
export function defaultSubFor(view, { tab, status, planned } = {}) {
  if (view === 'batches') return 'batches:open';
  if (view === 'history' || view === 'summary') return status === 'Closed' ? 'batches:closed' : 'batches:compare';
  if (view === 'approvals') return 'logbook:corrections';
  if (view === 'planned') return ALL_SUBS.find((s) => s.planned === planned)?.key || 'home:overview';
  return ALL_SUBS.find((s) => s.view === view)?.key || 'home:overview';
}

/** Title and breadcrumb for the top bar. */
export function crumbFor(key) {
  const sub = findSub(key);
  if (!sub) return { group: 'Home', page: 'Overview' };
  return { group: NAV.find((g) => g.key === sub.group).label, page: sub.label };
}
