import { describe, it, expect } from 'vitest';
import { priceCheck } from '../src/ui/priceCheckView.js';
import { buildLogRows, filterLogRows, logRowsToCsv } from '../src/ui/logbookView.js';
import { navForRole, findSub, defaultSubFor } from '../src/ui/navigation.js';
import { userCounts, filterUsers } from '../src/ui/usersView.js';
import { renderSidebar } from '../src/ui/shell.js';
import { renderGuidedCards, renderTodo, mascotState } from '../src/ui/homeWidgets.js';

describe('priceCheck', () => {
  it('gives the birds sold their share of the unrecovered cost and compares it with the sale', () => {
    // 100,000 still to recover over 1,000 birds; selling 500 birds (1,000 kg)
    const r = priceCheck({ totalCost: 150000, revenue: 50000, live: 1000, heads: 500, kg: 1000, price: 120 });
    expect(r.share).toBe(50000);
    expect(r.breakEven).toBe(50);
    expect(r.saleRevenue).toBe(120000);
    expect(r.verdict).toBe('profit');
    expect(priceCheck({ totalCost: 150000, revenue: 50000, live: 1000, heads: 500, kg: 1000, price: 40 }).verdict).toBe('loss');
  });

  it('waits for a price, and never sells more birds than are alive', () => {
    expect(priceCheck({ totalCost: 10, revenue: 0, live: 10, heads: 10, kg: 20, price: '' }).verdict).toBe('incomplete');
    expect(priceCheck({ totalCost: 10, revenue: 0, live: 10, heads: 99, kg: 20, price: 5 }).heads).toBe(10);
  });
});

describe('logbook rows', () => {
  const data = [{
    batch: { batch_id: 'b1', batch_name: 'Batch <A>', status: 'Open' },
    feed: [{ feed_log_id: 'f1', entry_date: '2026-11-01', quantity_g: 2500, updated_at: '2026-11-01T08:00:00Z' }],
    mortality: [
      { mortality_id: 'm1', entry_date: '2026-11-02', count: 0, updated_at: '2026-11-02T08:00:00Z' },
      { mortality_id: 'm2', entry_date: '2026-11-03', count: 4, updated_at: '2026-11-03T08:00:00Z', deleted_at: 'x' }
    ],
    sales: [{ sale_id: 's1', sale_date: '2026-11-03', quantity_sold: 10, weight_kg: 20, total_amount: 2400, buyer_name: 'Aling, "Nena"', updated_at: '2026-11-03T09:00:00Z' }]
  }];
  const expenses = [{ expense_id: 'e1', entry_date: '2026-11-02', feed_centavos: 100000, other_centavos: 5050, updated_at: '2026-11-02T10:00:00Z' }];

  it('lists active entries of every type, newest change first', () => {
    const rows = buildLogRows(data, expenses);
    expect(rows.map((r) => r.id)).toEqual(['s1', 'e1', 'm1', 'f1']);
    expect(rows.find((r) => r.id === 'm1').change).toBe('No deaths');
    expect(rows.find((r) => r.id === 'e1').csv).toBeCloseTo(1050.5, 6);
  });

  it('filters by batch, farm expenses, type and dates, and quotes CSV cells', () => {
    const rows = buildLogRows(data, expenses);
    expect(filterLogRows(rows, { batchId: 'farm' }).map((r) => r.id)).toEqual(['e1']);
    expect(filterLogRows(rows, { type: 'Feed' }).map((r) => r.id)).toEqual(['f1']);
    expect(filterLogRows(rows, { from: '2026-11-03' }).map((r) => r.id)).toEqual(['s1']);
    expect(logRowsToCsv(rows)).toContain('"Aling, ""Nena"""');
  });
});

describe('navigation by role', () => {
  it('hides money, team and user pages from staff', () => {
    const groups = navForRole('staff').map((g) => g.key);
    expect(groups).toEqual(['home', 'batches', 'logbook', 'settings']);
    expect(navForRole('staff').find((g) => g.key === 'home').subs.map((s) => s.key)).not.toContain('home:calendar');
  });

  it('keeps payroll for the owner only', () => {
    const subs = (role) => navForRole(role, true).flatMap((g) => g.subs.map((s) => s.key));
    expect(subs('owner')).toContain('team:payroll');
    expect(subs('admin')).not.toContain('team:payroll');
    expect(subs('admin')).toContain('logbook:corrections');
    expect(defaultSubFor('approvals')).toBe('logbook:corrections');
  });

  it('maps pages opened by buttons back to a subtab', () => {
    expect(defaultSubFor('sales-record')).toBe('sales:record');
    expect(defaultSubFor('history', { status: 'Closed' })).toBe('batches:closed');
    expect(defaultSubFor('planned', { planned: 'payroll' })).toBe('team:payroll');
    expect(findSub('sales:price').view).toBe('price-check');
  });

  it('opens only the active group in the sidebar', () => {
    const html = renderSidebar('logbook:all', 'owner');
    expect(html.match(/cp-group open/g)).toHaveLength(1);
    expect(html).toContain('aria-current="page"');
  });
});

describe('user management preview', () => {
  const users = [
    { id: 1, name: 'Ana', login: 'ana', role: 'staff', status: 'active' },
    { id: 2, name: 'Mario', login: 'mario', role: 'admin', status: 'active' },
    { id: 3, name: 'Lito', login: 'lito', role: 'staff', status: 'deactivated' },
    { id: 4, name: 'Rosa', login: 'rosa', role: 'staff', status: 'pending' }
  ];
  it('counts a farm-sized team and filters it', () => {
    expect(userCounts(users)).toEqual({ staff: 1, admins: 1, pending: 1, deactivated: 1 });
    expect(filterUsers(users, { q: 'MAR' }).map((u) => u.id)).toEqual([2]);
    expect(filterUsers(users, { role: 'staff', status: 'active' }).map((u) => u.id)).toEqual([1]);
  });
});

describe('home widgets', () => {
  it('escapes record text in cards and shows at most four until expanded', () => {
    const card = (i) => ({ id: `c${i}`, icon: 'coins', tone: 'info', question: `<b>Q${i}</b>`, value: 'v', meaning: 'm', bar: { pct: 10, label: 'l' }, answer: {} });
    const cards = [1, 2, 3, 4, 5].map(card);
    const html = renderGuidedCards(cards);
    expect(html).not.toContain('<b>Q1</b>');
    expect(html.match(/data-question=/g)).toHaveLength(4);
    expect(renderGuidedCards(cards, { expanded: true }).match(/data-question=/g)).toHaveLength(5);
  });

  it('leaves the tasks card to the to-do list for owners, and has no See answer button', () => {
    const card = (id) => ({ id, icon: id === 'tasks' ? 'check' : 'coins', tone: 'info', question: id, value: 'v', meaning: 'm', answer: {} });
    const cards = [card('money:b1'), card('tasks')];
    const owner = renderGuidedCards(cards);
    expect(owner).toContain('data-question="money:b1"');
    expect(owner).not.toContain('data-question="tasks"');
    expect(owner).not.toContain('See answer');
    expect(renderGuidedCards(cards, { role: 'staff' })).toContain('data-question="tasks"');
  });

  it('groups cards under their batch, most urgent batch first, naming the batch once', () => {
    const html = renderGuidedCards([
      { id: 'money:b2', icon: 'coins', tone: 'info', question: 'Am I losing money on Batch 8?', value: 'v', meaning: 'm', answer: { batchId: 'b2' } },
      { id: 'price:b1', icon: 'tag', tone: 'bad', question: 'What price do I need for Batch 7?', value: 'v', meaning: 'm', answer: { batchId: 'b1' } }
    ], { batchNames: { b1: 'Batch 7', b2: 'Batch 8' } });
    expect(html.indexOf('<h3 class="gq-group-title">Batch 7</h3>')).toBeLessThan(html.indexOf('<h3 class="gq-group-title">Batch 8</h3>'));
    expect(html).toContain('>What price do I need?</button>');
    expect(html).toContain('aria-label="Urgent: What price do I need for Batch 7?"');
    expect(html).toContain('<span class="tone-bad">Urgent</span><span class="tone-info">For you</span>');
  });

  it('offers "No deaths today" only on tasks not done yet', () => {
    const html = renderTodo({ done: 1, total: 2, overdue: 0, tasks: [
      { id: 'a', type: 'deaths', batchId: 'b1', label: 'Record deaths', due: '18:00', done: false, canMarkNone: true },
      { id: 'b', type: 'feed', batchId: 'b1', label: 'Record feed', due: '18:00', done: true, detail: '1 entry today' }
    ] });
    expect(html.match(/data-task-none=/g)).toHaveLength(1);
  });

  it('picks the mascot stage from the newest batch age and turns sad on a daily loss', () => {
    const batches = [{ batch: { batch_id: 'old', start_date: '2026-09-01' } }, { batch: { batch_id: 'new', start_date: '2026-11-01' } }];
    expect(mascotState(batches, '2026-11-07', 36).stage).toBe('chick'); // day 6 of 36
    expect(mascotState(batches, '2026-11-20', 36).stage).toBe('growing'); // day 19
    const sad = mascotState(batches, '2026-11-07', 36, [], { dailyNetCentavos: -100 });
    expect(sad).toMatchObject({ sad: true, mood: 'sad', loss: true });
  });
});
