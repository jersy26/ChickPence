import { db } from './dexie.js';
import { recomputeAllAllocations } from '../services/allocationService.js';

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
export const PLACEHOLDER_BUYER = 'Buyer (placeholder)';

const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const rng = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Generate batch record + feed logs + mortality logs + sales.
 * Does NOT generate expenses (those are farm-level).
 */
function generateBatchData(o) {
  const r = rng(o.seed);
  const rf = rng(o.seed + 999);
  const now = new Date().toISOString();
  const batchId = o.id || crypto.randomUUID();

  const batch = {
    batch_id: batchId,
    user_id: DEMO_USER_ID,
    batch_name: o.name,
    start_date: o.start,
    end_date: o.closed ? addDays(o.start, o.days) : null,
    initial_chick_count: o.chicks,
    chick_cost: o.chicks * 55,
    mortality_threshold_pct: o.mt ?? null,
    status: o.closed ? 'Closed' : 'Open',
    created_at: now,
    updated_at: now,
    deleted_at: null
  };

  const mortalityLogs = [];
  const feedLogs = [];
  const sales = [];

  for (let i = 0; i < o.days; i++) {
    const d = addDays(o.start, i);

    mortalityLogs.push({
      mortality_id: crypto.randomUUID(),
      batch_id: batchId,
      entry_date: d,
      count: Math.round(((o.chicks * o.mp) / o.days) * (0.4 + r() * 1.2)),
      updated_at: now,
      deleted_at: null
    });

    feedLogs.push({
      feed_log_id: crypto.randomUUID(),
      batch_id: batchId,
      entry_date: d,
      quantity_kg: Math.round(o.chicks * (0.015 + (i / o.days) * 0.13) * (0.95 + rf() * 0.1)),
      updated_at: now,
      deleted_at: null
    });
  }

  const totalDeaths = mortalityLogs.reduce((acc, m) => acc + m.count, 0);
  const surviving = o.chicks - totalDeaths;

  if (o.closed) {
    // Three tranches of sales at end
    const parts = [0.4, 0.35, 0.25];
    let left = surviving;
    parts.forEach((fraction, i) => {
      const qty = i === 2 ? left : Math.round(surviving * fraction);
      left -= qty;
      const kg = +(qty * (1.9 + r() * 0.3)).toFixed(2);
      const ppk = +(o.price * (0.97 + r() * 0.06)).toFixed(2);
      sales.push({
        sale_id: crypto.randomUUID(),
        batch_id: batchId,
        sale_date: addDays(o.start, o.days - 2 + i),
        buyer_name: PLACEHOLDER_BUYER,
        quantity_sold: qty,
        weight_kg: kg,
        price_per_kg: ppk,
        total_amount: +(kg * ppk).toFixed(2),
        updated_at: now,
        deleted_at: null
      });
    });
  } else {
    // Open batch: one partial sale mid-cycle
    const qty = Math.round(surviving * 0.25);
    const kg = +(qty * (1.8 + r() * 0.3)).toFixed(2);
    const ppk = +(o.price * (0.97 + r() * 0.06)).toFixed(2);
    sales.push({
      sale_id: crypto.randomUUID(),
      batch_id: batchId,
      sale_date: addDays(o.start, Math.floor(o.days * 0.7)),
      buyer_name: PLACEHOLDER_BUYER,
      quantity_sold: qty,
      weight_kg: kg,
      price_per_kg: ppk,
      total_amount: +(kg * ppk).toFixed(2),
      updated_at: now,
      deleted_at: null
    });
  }

  return { batch, mortalityLogs, feedLogs, sales };
}

/**
 * Generate farm-level expenses covering a date range.
 * Expenses are shared across whichever batches are active on each day.
 */
function generateExpenses(startDate, days, seed, dailyFeedBase, dailyOtherBase) {
  const r = rng(seed);
  const now = new Date().toISOString();
  const expenses = [];

  for (let i = 0; i < days; i++) {
    const d = addDays(startDate, i);
    const feedCentavos = Math.round((dailyFeedBase * (0.9 + r() * 0.2)) * 100);
    const otherCentavos = Math.round((dailyOtherBase * (0.7 + r() * 0.6)) * 100);

    if (feedCentavos > 0 || otherCentavos > 0) {
      expenses.push({
        expense_id: crypto.randomUUID(),
        entry_date: d,
        feed_centavos: feedCentavos,
        other_centavos: otherCentavos,
        updated_at: now,
        deleted_at: null
      });
    }
  }

  return expenses;
}

export async function checkAndSeedInitialData(force = false) {
  const count = await db.batches.count();
  const openCount = await db.batches.filter((b) => b.status === 'Open' && !b.deleted_at).count();

  // Skip only if we already have data AND at least 2 open batches (happy state)
  if (count > 0 && openCount >= 2 && !force) {
    return false;
  }

  // Always do a full clear before seeding to avoid duplicate-key conflicts
  await db.batches.clear();
  await db.feed_logs.clear();
  await db.mortality_logs.clear();
  await db.sales.clear();
  await db.expenses.clear();
  await db.allocations.clear();
  await db.outbox.clear();

  /**
   * Batch definitions.
   * OVERLAP WINDOW: Batch 2026-06 runs Jun 1 – Jul 15 (45 days).
   *                 Batch 2026-07 starts Jul 1 (Open), so Jul 1–Jul 15 both are active.
   *                 This satisfies the overlap requirement.
   */
  const batchDefs = [
    { name: 'Batch 2025-08', start: '2025-08-05', days: 44, chicks: 10000, seed: 11, mp: 0.035, price: 98, closed: true, mt: 5 },
    { name: 'Batch 2025-10', start: '2025-10-04', days: 45, chicks: 12000, seed: 22, mp: 0.042, price: 102, closed: true, mt: 5 },
    { name: 'Batch 2025-12', start: '2025-12-03', days: 46, chicks: 10500, seed: 33, mp: 0.081, price: 94, closed: true, mt: 6 },
    { name: 'Batch 2026-02', start: '2026-02-01', days: 44, chicks: 13000, seed: 44, mp: 0.03, price: 98, closed: true, mt: 5 },
    { name: 'Batch 2026-04', start: '2026-04-02', days: 45, chicks: 15000, seed: 55, mp: 0.09, price: 84, closed: true, mt: 6 },
    {
      name: 'Batch 2026-06',
      start: '2026-06-01',
      days: 45, // ends 2026-07-15 (Closed)
      chicks: 11000,
      seed: 66,
      mp: 0.038,
      price: 101,
      closed: true,
      mt: 5
    },
    {
      name: 'Batch 2026-07',
      start: '2026-07-01', // Starts Jul 1 — overlaps with 2026-06 until Jul 15
      days: 61,           // ~2 months running (still Open)
      chicks: 10000,
      seed: 77,
      mp: 0.062,
      price: 98,
      closed: false,
      mt: 5
    },
    {
      name: 'Batch 2026-09',
      start: '2026-09-01',  // 2nd open batch — started September
      days: 30,
      chicks: 8000,
      seed: 88,
      mp: 0.045,
      price: 105,
      closed: false,
      mt: 5
    }
  ];

  // Build all batch data
  const allBatchData = batchDefs.map((def) => generateBatchData(def));

  // Find the overall date range for expenses
  const allStarts = batchDefs.map((d) => d.start);
  const farmStart = allStarts.reduce((min, s) => (s < min ? s : min), allStarts[0]);
  const today = new Date().toISOString().slice(0, 10);
  const farmDays = Math.ceil(
    (new Date(today + 'T00:00:00Z') - new Date(farmStart + 'T00:00:00Z')) / (1000 * 60 * 60 * 24)
  ) + 1;

  // Generate farm-level expenses covering the full period
  const allExpenses = generateExpenses(farmStart, farmDays, 999, 45000, 8000);

  await db.transaction(
    'rw',
    [db.batches, db.feed_logs, db.mortality_logs, db.sales, db.expenses, db.allocations],
    async () => {
      for (const { batch, mortalityLogs, feedLogs, sales } of allBatchData) {
        await db.batches.add(batch);
        await db.mortality_logs.bulkAdd(mortalityLogs);
        await db.feed_logs.bulkAdd(feedLogs);
        await db.sales.bulkAdd(sales);
      }
      await db.expenses.bulkAdd(allExpenses);
    }
  );

  // Recompute allocations for all seeded expenses
  await recomputeAllAllocations();

  return true;
}
