import { describe,it,expect } from 'vitest';
import { flockCompanion } from '../src/services/flockCompanion.js';
import { assignedItems } from '../src/ui/previewState.js';
import { navForRole } from '../src/ui/navigation.js';
import { renderOpenBatches, renderCosts, renderDailyEntry } from '../src/ui/operationsView.js';
import { renderUsers } from '../src/ui/usersView.js';
import { renderReports } from '../src/ui/reportsView.js';
import { presetRange } from '../src/ui/redesignKit.js';
import { renderTopbar } from '../src/ui/shell.js';
const day='2026-11-09';
const item={batch:{batch_id:'a',batch_name:'Flock A',start_date:'2026-11-01',initial_chick_count:100,mortality_threshold_pct:5,chick_cost:1000,status:'Open'},feed:[],mortality:[],sales:[],allocations:[]};
describe('redesigned role and preview boundaries',()=>{
 it('prioritizes mortality, urgent alerts, overdue tasks, monthly loss and completion',()=>{
  const context={role:'owner',tasks:{total:2,done:2,overdue:0},monthNetCentavos:-100};
  expect(flockCompanion([item],day,35,context).mood).toBe('sad');
  expect(flockCompanion([item],day,35,{...context,role:'staff'}).mood).toBe('happy');
  expect(flockCompanion([item],day,35,{...context,tasks:{total:2,done:0,overdue:1}}).mood).toBe('annoyed');
  expect(flockCompanion([item],day,35,{...context,urgentCount:3}).mood).toBe('alerted');
  expect(flockCompanion([{...item,mortality:[{entry_date:'2026-11-01',count:6}]}],day,35,context).mood).toBe('alerted');
 });
 it('limits staff to active assigned batches; no assignment exposes no batches',()=>{
  expect(assignedItems([item],null)).toEqual([]);
  expect(assignedItems([item],{status:'active',batches:'Other flock'})).toEqual([]);
  expect(assignedItems([item],{status:'active',batches:'Flock A'})).toEqual([item]);
  expect(assignedItems([item],{status:'deactivated',batches:'All'})).toEqual([]);
 });
 it('shows exactly four staff sections and keeps Data & sync Owner-only',()=>{
  expect(navForRole('staff').map(g=>g.key)).toEqual(['home','batches','logbook','settings']);
  expect(navForRole('admin').find(g=>g.key==='settings').subs.map(s=>s.key)).not.toContain('settings:data');
  expect(navForRole('owner',true).map(g=>g.key)).toHaveLength(9);
 });
 it('keeps device-only and planned pages out of the menu unless Labs is on',()=>{
  const subs=(role,labs)=>navForRole(role,labs).flatMap(g=>g.subs.map(s=>s.key));
  for(const key of ['team:concerns','logbook:corrections','users:list','users:roles','costs:recurring','team:payroll','reports:breakdown'])expect(subs('owner',false)).not.toContain(key);
  expect(navForRole('owner',false).map(g=>g.key)).not.toContain('users');
  expect(subs('owner',true)).toContain('logbook:corrections');
 });
 it('hides money and sales from staff batches by default',()=>{
  const html=renderOpenBatches([item],{role:'staff'});
  expect(html).not.toContain('₱');expect(html).not.toContain('data-batch-section="Sales"');expect(html).not.toContain('data-batch-close');
 });
 it('renders user menus without making role changes directly from a select',()=>{
  const html=renderUsers([{id:'s',name:'Ana',login:'ana',role:'staff',status:'active',batches:'Flock A',joined:'2026-11-01'}],{},'admin');
  expect(html).toContain('data-edit-user="s"');expect(html).not.toContain('data-user-role');expect(html).toContain('Device-only user preview');
 });
 it('labels unconnected financial views as previews',()=>{
  expect(renderCosts([item],[],{tab:'recurring'})).toContain('do not post expenses');
  expect(renderReports([item],[],{tab:'breakdown'})).toContain('not calculated from your farm');
 });
 it('uses correct prior-month boundaries across a year and leap year',()=>{
  expect(presetRange('last-month','2027-01-10')).toEqual({from:'2026-12-01',to:'2026-12-31'});
  expect(presetRange('last-month','2024-03-10')).toEqual({from:'2024-02-01',to:'2024-02-29'});
 });
 it('does not enable day submission before all assigned daily tasks are saved',()=>{
  const html=renderDailyEntry([item],{tasks:[{batchId:'a',type:'feed',done:false,due:'18:00'}]},{role:'staff'});
  expect(html).toMatch(/data-submit-day="[^"]+" disabled/);expect(html).toContain('Saved entries and farm review behavior stay unchanged');
 });
});
describe('role preview switcher',()=>{
 it('shows only for demo accounts, never for a real login',()=>{
  expect(renderTopbar('home:overview','owner',{id:'d',email:'demo',isDemo:true})).toContain('sel-preview-role');
  expect(renderTopbar('home:overview','owner',{id:'u',email:'farmer@example.com',isDemo:false})).not.toContain('sel-preview-role');
 });
});
