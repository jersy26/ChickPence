/**
 * integration.test.js
 * V-Model integration level (thesis Table 20, TC-I-01 to TC-I-14): the
 * Repository, Dexie tables, cost sharing and the sync engine working
 * together on a real IndexedDB (fake-indexeddb), not stubs.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSupabase } from './support/fakeSupabase.js';

const server = vi.hoisted(() => ({ supabase: null }));
vi.mock('../src/services/supabaseClient.js', () => ({
  getSupabase: () => server.supabase,
  isSupabaseConfigured: () => Boolean(server.supabase)
}));

const { db } = await import('../src/db/dexie.js');
const { Repository } = await import('../src/services/repository.js');
const { syncEngine } = await import('../src/services/syncEngine.js');
const { AuthService } = await import('../src/services/auth.js');
const { calcBatchMetrics } = await import('../src/services/allocationEngine.js');
const { renderCompare } = await import('../src/ui/operationsView.js');
const { renderSummary } = await import('../src/ui/summaryView.js');
const { formatPeso, formatPercent } = await import('../src/services/calculations.js');

const newBatch = (name, start, chicks, extra = {}) =>
  Repository.createBatch({ batch_name: name, start_date: start, initial_chick_count: chicks, chick_cost: 0, ...extra });

/** Each batch's share of one expense: { batch_id: { feed, other, basis, total } } */
async function sharesOf(expenseId) {
  const rows = await db.allocations.where('expense_id').equals(expenseId).toArray();
  return Object.fromEntries(rows.map((r) => [r.batch_id, { feed: r.feed_centavos, other: r.other_centavos, basis: r.basis_heads, total: r.total_heads }]));
}

const metricsOf = async (batchId) => {
  const d = await Repository.getBatchFullDetails(batchId);
  return calcBatchMetrics(d.batch, d.allocations, d.sales, d.mortality, d.feed);
};

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  syncEngine.isSimulatedOffline = true; // no background uploads while saving
  server.supabase = null;
});

afterEach(() => vi.restoreAllMocks());

describe('TC-I-01: batch persisted', () => {
  it('stores every field, queues the upload, and counts the chick cost once', async () => {
    const saved = await newBatch('Batch A', '2026-01-01', 1000, { chick_cost: 45000, mortality_threshold_pct: '5' });
    const stored = await db.batches.get(saved.batch_id);
    expect(stored).toMatchObject({
      batch_name: 'Batch A', start_date: '2026-01-01', initial_chick_count: 1000, chick_cost: 45000,
      mortality_threshold_pct: 5, status: 'Open', end_date: null, deleted_at: null
    });
    expect(stored.updated_at).toBeTruthy();
    expect(await db.outbox.toArray()).toMatchObject([{ table_name: 'batches', record_id: saved.batch_id, action: 'UPSERT' }]);
    expect((await metricsOf(saved.batch_id)).totalCost).toBe(45000);
  });
});

describe('TC-I-02: two open batches', () => {
  it('both stay open and each keeps its own records', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    const b = await newBatch('Batch B', '2026-01-20', 2000);
    await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-25', count: 7 });

    expect((await Repository.getOpenBatches()).map((x) => x.batch_name)).toEqual(['Batch A', 'Batch B']);
    expect(await Repository.getBatchMortality(a.batch_id)).toHaveLength(1);
    expect(await Repository.getBatchMortality(b.batch_id)).toEqual([]);
  });
});

describe('TC-I-03: expense persisted', () => {
  it('stores whole centavos, shares it, and queues it', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    const e = await Repository.saveExpense({ entry_date: '2026-01-05', feed_amount: '123.45', other_amount: '0.10' });

    expect(await db.expenses.get(e.expense_id)).toMatchObject({ entry_date: '2026-01-05', feed_centavos: 12345, other_centavos: 10 });
    expect(await sharesOf(e.expense_id)).toEqual({ [a.batch_id]: { feed: 12345, other: 10, basis: 1000, total: 1000 } });
    expect((await db.outbox.toArray()).map((o) => o.table_name)).toEqual(['batches', 'expenses']);
  });
});

describe('TC-I-04: basis stored', () => {
  it('each share keeps the head counts it was divided by (Table 17)', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 3000);
    const b = await newBatch('Batch B', '2026-01-02', 9000);
    const e = await Repository.saveExpense({ entry_date: '2026-01-10', feed_amount: 12345.67, other_amount: 1000.01 });

    expect(await sharesOf(e.expense_id)).toEqual({
      [a.batch_id]: { feed: 308642, other: 25000, basis: 3000, total: 12000 },
      [b.batch_id]: { feed: 925925, other: 75001, basis: 9000, total: 12000 }
    });
  });
});

describe('TC-I-05 / TC-I-06: backdated entries', () => {
  let a, b, e;
  beforeEach(async () => {
    a = await newBatch('Batch A', '2026-02-01', 6000);
    b = await newBatch('Batch B', '2026-02-01', 6000);
    e = await Repository.saveExpense({ entry_date: '2026-02-15', feed_amount: 1200, other_amount: 0 });
    expect((await sharesOf(e.expense_id))[a.batch_id].feed).toBe(60000);
  });

  it('TC-I-05: a backdated death re-shares the expense', async () => {
    await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-02-10', count: 2000 });
    const s = await sharesOf(e.expense_id);
    expect([s[a.batch_id].feed, s[b.batch_id].feed]).toEqual([48000, 72000]);
    expect(s[a.batch_id].basis).toBe(4000);
  });

  it('TC-I-06: a backdated sale re-shares the expense', async () => {
    await Repository.saveSale({ batch_id: a.batch_id, sale_date: '2026-02-10', buyer_name: 'Buyer', quantity_sold: 2000, weight_kg: 4000, price_per_kg: 100 });
    const s = await sharesOf(e.expense_id);
    expect([s[a.batch_id].feed, s[b.batch_id].feed]).toEqual([48000, 72000]);
  });

  it('a death or sale dated on the expense day does not change that day', async () => {
    await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-02-15', count: 2000 });
    expect((await sharesOf(e.expense_id))[a.batch_id].feed).toBe(60000);
  });
});

describe('TC-I-07: mortality persisted', () => {
  it('stores the deaths, and refuses more deaths than birds left without storing anything', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 100);
    await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-03', count: 10 });
    await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-04', count: 0 }); // checked, none died

    await expect(Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-05', count: 91 })).rejects.toThrow('only 90 birds left');
    expect((await Repository.getBatchMortality(a.batch_id)).map((m) => m.count)).toEqual([10, 0]);
  });
});

describe('TC-I-08: feed has no link to expenses', () => {
  it('stores grams on its batch and leaves expenses and their shares alone', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    const e = await Repository.saveExpense({ entry_date: '2026-01-05', feed_amount: 500, other_amount: 0 });
    const before = await sharesOf(e.expense_id);

    const f = await Repository.saveFeedLog({ batch_id: a.batch_id, entry_date: '2026-01-05', quantity_kg: '12.5' });
    const stored = await db.feed_logs.get(f.feed_log_id);
    expect(stored).toMatchObject({ batch_id: a.batch_id, quantity_g: 12500 });
    expect(Object.keys(stored).some((k) => k.startsWith('expense'))).toBe(false);
    expect(await db.expenses.count()).toBe(1);
    expect(await sharesOf(e.expense_id)).toEqual(before);
  });
});

describe('TC-I-09: several sales', () => {
  it('stores each sale with its computed amount and refuses birds the batch does not have', async () => {
    const h = await newBatch('Batch H', '2026-01-01', 1000);
    await Repository.saveSale({ batch_id: h.batch_id, sale_date: '2026-02-05', buyer_name: 'Buyer', quantity_sold: 600, weight_kg: 1260, price_per_kg: 95 });
    await Repository.saveSale({ batch_id: h.batch_id, sale_date: '2026-02-12', buyer_name: 'Buyer', quantity_sold: 320, weight_kg: 700, price_per_kg: 90 });

    expect((await Repository.getBatchSales(h.batch_id)).map((s) => s.total_amount).sort()).toEqual([119700, 63000].sort());
    expect((await metricsOf(h.batch_id)).revenue).toBe(182700);
    await expect(
      Repository.saveSale({ batch_id: h.batch_id, sale_date: '2026-02-20', buyer_name: 'Buyer', quantity_sold: 81, weight_kg: 160, price_per_kg: 90 })
    ).rejects.toThrow('only 80 birds left');
  });
});

describe('TC-I-10: correction recomputes', () => {
  it('editing an expense or a death, and deleting an expense, re-share and recompute', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    const b = await newBatch('Batch B', '2026-01-01', 1000);
    const e = await Repository.saveExpense({ entry_date: '2026-01-10', feed_amount: 1000, other_amount: 0 });
    const feedOf = async () => { const s = await sharesOf(e.expense_id); return [s[a.batch_id]?.feed, s[b.batch_id]?.feed]; };
    expect(await feedOf()).toEqual([50000, 50000]);

    await Repository.saveExpense({ expense_id: e.expense_id, entry_date: '2026-01-10', feed_amount: 2000, other_amount: 0 });
    expect(await feedOf()).toEqual([100000, 100000]);

    const death = await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-05', count: 500 });
    expect(await feedOf()).toEqual([66667, 133333]);
    await Repository.saveMortalityLog({ mortality_id: death.mortality_id, batch_id: a.batch_id, entry_date: '2026-01-05', count: 0 });
    expect(await feedOf()).toEqual([100000, 100000]);

    await Repository.deleteRecord('expenses', e.expense_id);
    expect(await sharesOf(e.expense_id)).toEqual({});
    expect((await metricsOf(a.batch_id)).totalCost).toBe(0);
  });
});

describe('TC-I-11: comparison columns equal the summaries', () => {
  it('shows each batch with the same values as its own summary', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000, { chick_cost: 30000 });
    const b = await newBatch('Batch B', '2026-01-15', 500, { chick_cost: 16000 });
    await Repository.saveExpense({ entry_date: '2026-01-20', feed_amount: 9000, other_amount: 1500 });
    await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-21', count: 30 });
    await Repository.saveSale({ batch_id: a.batch_id, sale_date: '2026-02-01', buyer_name: 'Buyer', quantity_sold: 400, weight_kg: 820.5, price_per_kg: 118.25 });
    await Repository.saveSale({ batch_id: b.batch_id, sale_date: '2026-02-20', buyer_name: 'Buyer', quantity_sold: 200, weight_kg: 401, price_per_kg: 120 });

    const items = await Promise.all([a, b].map((x) => Repository.getBatchFullDetails(x.batch_id)));
    const compare = renderCompare(items, [a.batch_id, b.batch_id]);
    for (const item of items) {
      const m = calcBatchMetrics(item.batch, item.allocations, item.sales, item.mortality, item.feed);
      const summary = renderSummary(item);
      for (const value of [formatPeso(m.totalCost), formatPeso(m.revenue), formatPeso(m.netProfit), formatPercent(m.margin), formatPeso(m.costPerKg), formatPercent(m.mortalityRate), formatPercent(m.robc)]) {
        expect(summary).toContain(value);
        expect(compare).toContain(value);
      }
    }
  });
});

describe('TC-I-12: outbox queue', () => {
  it('keeps changes queued while signed out and uploads them, batches first, once signed in', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-03', count: 2 });
    expect(await db.outbox.count()).toBe(2);

    server.supabase = fakeSupabase();
    vi.spyOn(AuthService, 'getUser').mockReturnValue(null);
    expect(await syncEngine.syncOnce()).toMatchObject({ success: false, reason: 'signed-out' });
    expect(await db.outbox.count()).toBe(2);
    expect(server.supabase.upserts).toEqual([]);

    vi.spyOn(AuthService, 'getUser').mockReturnValue({ id: 'u1', isDemo: false });
    expect(await syncEngine.syncOnce()).toMatchObject({ success: true, count: 2 });
    expect(await db.outbox.count()).toBe(0);
    expect(server.supabase.upserts.map((u) => u.table)).toEqual(['batch', 'mortality_log']);
  });
});

describe('TC-I-13: transaction rollback on error', () => {
  it('a sale refused partway through its transaction leaves no sale, no queued upload and the old shares', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 100);
    const e = await Repository.saveExpense({ entry_date: '2026-01-10', feed_amount: 100, other_amount: 0 });
    const outboxBefore = await db.outbox.count();
    const sharesBefore = await sharesOf(e.expense_id);

    // Selling every bird before the expense date would leave that expense with no batch
    await expect(
      Repository.saveSale({ batch_id: a.batch_id, sale_date: '2026-01-05', buyer_name: 'Buyer', quantity_sold: 100, weight_kg: 200, price_per_kg: 100 })
    ).rejects.toThrow('2026-01-10');
    expect(await db.sales.count()).toBe(0);
    expect(await db.outbox.count()).toBe(outboxBefore);
    expect(await sharesOf(e.expense_id)).toEqual(sharesBefore);
  });
});

describe('TC-I-14: last-write-wins sync resolution', () => {
  it('a newer cloud copy replaces the local one and re-shares costs; an older one does not', async () => {
    const a = await newBatch('Batch A', '2026-03-01', 1000);
    await newBatch('Batch B', '2026-03-01', 1000);
    const e = await Repository.saveExpense({ entry_date: '2026-03-10', feed_amount: 1000, other_amount: 0 });
    const sale = await Repository.saveSale({ batch_id: a.batch_id, sale_date: '2026-03-05', buyer_name: 'Local', quantity_sold: 500, weight_kg: 1000, price_per_kg: 100 });
    await db.outbox.clear(); // only the pull is under test
    expect((await sharesOf(e.expense_id))[a.batch_id].feed).toBe(33333);

    const later = new Date(Date.parse(sale.updated_at) + 60000).toISOString();
    const earlier = new Date(Date.parse(sale.updated_at) - 60000).toISOString();
    vi.spyOn(AuthService, 'getUser').mockReturnValue({ id: 'u1', isDemo: false });

    server.supabase = fakeSupabase({ sale: [{ ...sale, buyer_name: 'Older edit', sale_date: '2026-03-12', updated_at: earlier }] });
    await syncEngine.syncOnce();
    expect((await db.sales.get(sale.sale_id)).buyer_name).toBe('Local');
    expect((await sharesOf(e.expense_id))[a.batch_id].feed).toBe(33333);

    // The newer edit moves the sale after the expense date: its 500 birds count again on 2026-03-10
    server.supabase = fakeSupabase({ sale: [{ ...sale, buyer_name: 'Newer edit', sale_date: '2026-03-12', updated_at: later }] });
    await syncEngine.syncOnce();
    expect((await db.sales.get(sale.sale_id)).buyer_name).toBe('Newer edit');
    expect((await sharesOf(e.expense_id))[a.batch_id].feed).toBe(50000);
  });
});
