/**
 * system.test.js
 * V-Model system level (thesis Table 20, TC-S-01 to TC-S-12): whole flows from
 * an entry saved through the Repository to what the screens render, on a real
 * IndexedDB (fake-indexeddb). TC-S-13/14 are in sharingAndLeftovers.test.js.
 * TC-S-11 checks the PWA setup; installing it on a phone stays a manual check.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
const { renderOpenBatches, renderCompare, healthStrip } = await import('../src/ui/operationsView.js');
const { renderSummary } = await import('../src/ui/summaryView.js');
const { buildLogRows, renderLogbook } = await import('../src/ui/logbookView.js');
const { renderPriceCheck, priceCheck, priceCheckBasis } = await import('../src/ui/priceCheckView.js');

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const newBatch = (name, start, chicks, extra = {}) =>
  Repository.createBatch({ batch_name: name, start_date: start, initial_chick_count: chicks, chick_cost: 0, ...extra });
const details = (batch) => Repository.getBatchFullDetails(batch.batch_id);
const tableCounts = async () => Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.count()])));

/** Let a save's scheduled upload (changed() → syncNow after 300 ms) run to its end. */
async function settleSync() {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await (syncEngine.running || Promise.resolve());
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  syncEngine.isSimulatedOffline = true;
  server.supabase = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TC-S-01: create two batches', () => {
  it('both open batches show on the Open batches screen', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    const b = await newBatch('Batch B', '2026-01-20', 2000);
    const items = await Promise.all((await Repository.getOpenBatches()).map(details));
    const html = renderOpenBatches(items, { selectedId: b.batch_id });
    expect(items.map((i) => i.batch.batch_id)).toEqual([a.batch_id, b.batch_id]);
    expect(html).toContain('Batch A');
    expect(html).toContain('Batch B');
    // The chosen open batch's provisional summary opens from its ⋯ menu (FR-18)
    expect(html).toContain(`data-batch-summary="${b.batch_id}">View summary</button>`);
  });
});

describe('TC-S-02: no active batch message', () => {
  it('an expense dated before any batch is refused with a message and not stored', async () => {
    await newBatch('Batch A', '2026-01-01', 1000);
    await expect(Repository.saveExpense({ entry_date: '2025-12-31', feed_amount: 500, other_amount: 0 }))
      .rejects.toThrow('No batch is active on 2025-12-31. Expense cannot be allocated.');
    expect(await db.expenses.count()).toBe(0);
  });
});

describe('TC-S-03: feed entry', () => {
  it('a feed entry shows in the logbook in kilograms', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    await Repository.saveFeedLog({ batch_id: a.batch_id, entry_date: '2026-01-04', quantity_kg: '12.5' });
    const rows = buildLogRows([await details(a)], await Repository.getAllExpenses());
    expect(rows).toMatchObject([{ type: 'Feed', date: '2026-01-04', change: '+12.50 kg', batch: 'Batch A' }]);
    expect(renderLogbook(rows, [a])).toContain('+12.50 kg');
  });
});

describe('TC-S-04: void an expense', () => {
  it('deleting an expense takes it out of the batch cost and the logbook', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000, { chick_cost: 1000 });
    const e = await Repository.saveExpense({ entry_date: '2026-01-05', feed_amount: 500, other_amount: 0 });
    expect(renderSummary(await details(a))).toContain('₱1,500.00');

    await Repository.deleteRecord('expenses', e.expense_id);
    const expenses = await Repository.getAllExpenses();
    expect(expenses).toEqual([]);
    expect(renderSummary(await details(a))).toContain('₱1,000.00');
    expect(buildLogRows([await details(a)], expenses).filter((r) => r.type === 'Expense')).toEqual([]);
  });
});

describe('TC-S-05: mortality flag displayed', () => {
  it('shows the flag above the alert level and not at it', async () => {
    const over = await newBatch('Over', '2026-01-01', 1000, { mortality_threshold_pct: 5 });
    const at = await newBatch('At', '2026-01-01', 1000, { mortality_threshold_pct: 5 });
    await Repository.saveMortalityLog({ batch_id: over.batch_id, entry_date: '2026-01-05', count: 51 });
    await Repository.saveMortalityLog({ batch_id: at.batch_id, entry_date: '2026-01-05', count: 50 });

    const flagged = healthStrip(await details(over), 35, '2026-01-06');
    const level = healthStrip(await details(at), 35, '2026-01-06');
    expect(flagged).toContain('<b class="text-bad">5.1% mortality</b>');
    expect(flagged).toContain('rd-meter mortality urgent');
    expect(level).toContain('<b class="">5.0% mortality</b>');
    expect(level).not.toContain('rd-meter mortality urgent');
  });
});

describe('TC-S-06: close batch', () => {
  it('a closed batch leaves the open list and its results read Final', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000);
    expect(renderSummary(await details(a))).toContain('Provisional — batch still open');

    await Repository.closeBatch(a.batch_id, '2026-02-20');
    expect(await db.batches.get(a.batch_id)).toMatchObject({ status: 'Closed', end_date: '2026-02-20' });
    expect(await Repository.getOpenBatches()).toEqual([]);
    expect((await Repository.getClosedBatchesWithData()).map((c) => c.batch.batch_id)).toEqual([a.batch_id]);
    const summary = renderSummary(await details(a));
    expect(summary).toContain('Final</div>');
    expect(summary).not.toContain('Provisional — batch still open');
  });
});

describe('TC-S-07: summary equals the unit values (Batch H, Table 19)', () => {
  it('entered through the app, Batch H shows every hand-calculated measure', async () => {
    const h = await newBatch('Batch H', '2026-01-01', 1000, { chick_cost: 45000 });
    await Repository.saveExpense({ entry_date: '2026-01-02', feed_amount: 75000, other_amount: 6000 });
    await Repository.saveMortalityLog({ batch_id: h.batch_id, entry_date: '2026-01-10', count: 40 });
    await Repository.saveFeedLog({ batch_id: h.batch_id, entry_date: '2026-01-15', quantity_kg: 3920 });
    await Repository.saveSale({ batch_id: h.batch_id, sale_date: '2026-02-05', buyer_name: 'Buyer', quantity_sold: 600, weight_kg: 1260, price_per_kg: 95 });
    await Repository.saveSale({ batch_id: h.batch_id, sale_date: '2026-02-12', buyer_name: 'Buyer', quantity_sold: 320, weight_kg: 700, price_per_kg: 90 });

    const html = renderSummary(await details(h));
    for (const value of ['₱126,000.00', '₱182,700.00', '₱56,700.00', '31.03%', '₱64.29', '₱28.93', '4.00%', '2.00', '45.00%', 'Provisional']) {
      expect(html).toContain(value);
    }
  });
});

describe('TC-S-08: compare batches', () => {
  it('asks for a second batch, then shows every chosen batch side by side', async () => {
    const batches = [await newBatch('Batch A', '2026-01-01', 1000), await newBatch('Batch B', '2026-01-10', 900), await newBatch('Batch C', '2026-01-20', 800)];
    const items = await Promise.all(batches.map(details));

    expect(renderCompare(items, [batches[0].batch_id])).toContain('Select at least two batches above.');
    const html = renderCompare(items, batches.map((b) => b.batch_id));
    expect(html).toContain('Total recorded cost');
    for (const name of ['Batch A', 'Batch B', 'Batch C']) expect(html).toContain(`<th scope="col">${name}</th>`);
    expect(html).not.toContain('disabled'); // no limit on how many batches are chosen
  });
});

describe('TC-S-09: every flow works in airplane mode', () => {
  it('records, corrects, computes and reports with no network call', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchSpy);
    syncEngine.isSimulatedOffline = false; // offline because the device says so
    server.supabase = fakeSupabase();
    vi.spyOn(AuthService, 'getUser').mockReturnValue({ id: 'u1', isDemo: false });

    const a = await newBatch('Batch A', '2026-01-01', 1000, { chick_cost: 30000, mortality_threshold_pct: 5 });
    const b = await newBatch('Batch B', '2026-01-10', 500);
    const e = await Repository.saveExpense({ entry_date: '2026-01-12', feed_amount: 800, other_amount: 100 });
    await Repository.saveExpense({ expense_id: e.expense_id, entry_date: '2026-01-12', feed_amount: 900, other_amount: 100 });
    const death = await Repository.saveMortalityLog({ batch_id: a.batch_id, entry_date: '2026-01-11', count: 12 });
    await Repository.deleteRecord('mortality_logs', death.mortality_id);
    await Repository.saveFeedLog({ batch_id: a.batch_id, entry_date: '2026-01-12', quantity_kg: 50 });
    await Repository.saveSale({ batch_id: a.batch_id, sale_date: '2026-02-01', buyer_name: 'Buyer', quantity_sold: 300, weight_kg: 600, price_per_kg: 120 });
    await Repository.closeBatch(b.batch_id, '2026-02-02');
    const items = await Promise.all([a, b].map(details));
    renderSummary(items[0]);
    renderCompare(items, [a.batch_id, b.batch_id]);
    renderPriceCheck([items[0]], [], '2026-02-03', { price: 120 });
    await settleSync();

    expect(await db.outbox.count()).toBeGreaterThan(0); // waiting for a connection
    expect(server.supabase.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('TC-S-10: sync runs only while signed in', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    syncEngine.isSimulatedOffline = false;
    server.supabase = fakeSupabase();
  });

  it('signed out: a saved entry stays on the device and nothing is sent', async () => {
    vi.spyOn(AuthService, 'getUser').mockReturnValue(null);
    await newBatch('Batch A', '2026-01-01', 1000);
    await settleSync();
    expect(server.supabase.calls).toEqual([]);
    expect(await db.outbox.count()).toBe(1);
  });

  it('signed in and online: the entry is uploaded shortly after it is saved', async () => {
    vi.spyOn(AuthService, 'getUser').mockReturnValue({ id: 'u1', isDemo: false });
    await newBatch('Batch A', '2026-01-01', 1000);
    await settleSync();
    expect(server.supabase.upserts.map((u) => u.table)).toEqual(['batch']);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('TC-S-11: PWA installation and caching', () => {
  const config = readFileSync(root('vite.config.js'), 'utf8');
  const html = readFileSync(root('index.html'), 'utf8');

  it('the page links the manifest and the app registers as a standalone PWA', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(config).toContain('VitePWA(');
    expect(config).toContain("display: 'standalone'");
    expect(config).toContain("start_url: '/'");
  });

  it('every icon and asset the manifest names exists', () => {
    const files = [...config.matchAll(/src: '([^']+)'/g)].map((m) => m[1]);
    const assets = config.match(/includeAssets: \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    expect(files.length).toBeGreaterThan(0);
    for (const file of [...files, ...assets]) expect(existsSync(root(`public/${file}`)), file).toBe(true);
  });

  it('the service worker precaches the app shell for offline use', () => {
    const patterns = config.match(/globPatterns: \['([^']+)'\]/)[1];
    for (const ext of ['js', 'css', 'html', 'svg', 'woff2']) expect(patterns).toContain(ext);
  });
});

describe('TC-S-12: the price check stores nothing', () => {
  it('testing an offer leaves every table as it was', async () => {
    const a = await newBatch('Batch A', '2026-01-01', 1000, { chick_cost: 30000 });
    await Repository.saveExpense({ entry_date: '2026-01-05', feed_amount: 20000, other_amount: 0 });
    const before = await tableCounts();

    const item = await details(a);
    const html = renderPriceCheck([item], [], '2026-02-01', { batchId: a.batch_id, heads: 500, kg: 1000, price: 60 });
    const r = priceCheck({ ...priceCheckBasis(item, [], '2026-02-01'), heads: 500, kg: 1000, price: 60 });
    expect(r).toMatchObject({ share: 25000, breakEven: 25, verdict: 'profit' });
    expect(html).toContain('Nothing is saved.');
    expect(await tableCounts()).toEqual(before);
  });
});
