import { db } from './dexie.js';
import { recomputeAllAllocations } from '../services/allocationService.js';
import { isBatchActiveOnDate, liveHeadCount } from '../services/allocationEngine.js';

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
export const PLACEHOLDER_BUYER = 'Buyer (placeholder)';
export const SEED_VERSION = 'v2.2_realistic_poultry_data';

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

  return { def: o, batch, mortalityLogs, feedLogs, sales };
}

/**
 * Generate farm-level expenses covering the active periods.
 * Daily feed and other costs realistically scale with the total live head count on the farm
 * on that date, taking into account the age of each active batch.
 */
function generateFarmExpenses(allBatchData, startDate, today, seed = 999) {
  const r = rng(seed);
  const now = new Date().toISOString();
  const totalDays =
    Math.ceil((new Date(today + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) / 86400000) + 1;
  const expenses = [];

  for (let i = 0; i < totalDays; i++) {
    const d = addDays(startDate, i);

    // Identify which flocks are active on date d
    const activeFlocks = allBatchData.filter((b) =>
      isBatchActiveOnDate(b.batch, b.mortalityLogs, b.sales, d)
    );
    if (!activeFlocks.length) continue;

    let dayFeedCost = 0;
    let dayOtherCost = 0;

    for (const f of activeFlocks) {
      const dayIndex = Math.max(
        0,
        Math.floor((new Date(d + 'T00:00:00Z') - new Date(f.batch.start_date + 'T00:00:00Z')) / 86400000)
      );
      const heads = liveHeadCount(f.batch, f.mortalityLogs, f.sales, d);

      // Broiler feed consumption: ~15g on day 0 up to ~135g on day 42
      // Feed price ~P28.5/kg. Average feed cost per bird per day is ~P2.10
      const progress = Math.min(1, dayIndex / f.def.days);
      const feedKgPerHead = 0.015 + progress * 0.12;
      const feedCostThis = heads * feedKgPerHead * 28.5 * (0.95 + r() * 0.1);

      // Consolidated other costs: electricity, water, labor, vaccines ~P0.32 per bird/day
      const otherCostThis = heads * 0.32 * (0.9 + r() * 0.2);

      dayFeedCost += feedCostThis;
      dayOtherCost += otherCostThis;
    }

    expenses.push({
      expense_id: crypto.randomUUID(),
      entry_date: d,
      feed_centavos: Math.round(dayFeedCost * 100),
      other_centavos: Math.round(dayOtherCost * 100),
      updated_at: now,
      deleted_at: null
    });
  }

  return expenses;
}

export async function checkAndSeedInitialData(force = false) {
  const currentVersionRecord = await db.app_state.get('seed_version');
  const hasValidSeed = currentVersionRecord && currentVersionRecord.value === SEED_VERSION;

  if (hasValidSeed && !force) {
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
   * Batch definitions: 6 closed batches + 2 open batches.
   * OVERLAP WINDOW: Batch 2026-06 runs Jun 1 – Jul 15 (45 days, Closed).
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
      days: 61,           // ~2 months running (Open batch 1)
      chicks: 10000,
      seed: 77,
      mp: 0.062,
      price: 98,
      closed: false,
      mt: 5
    },
    {
      name: 'Batch 2026-09',
      start: '2026-09-01',  // Open batch 2 — started September
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

  // Generate farm-level expenses dynamically scaling with active flock live head counts
  const allExpenses = generateFarmExpenses(allBatchData, farmStart, today, 999);

  await db.transaction(
    'rw',
    [db.batches, db.feed_logs, db.mortality_logs, db.sales, db.expenses, db.allocations, db.app_state],
    async () => {
      for (const { batch, mortalityLogs, feedLogs, sales } of allBatchData) {
        await db.batches.add(batch);
        await db.mortality_logs.bulkAdd(mortalityLogs);
        await db.feed_logs.bulkAdd(feedLogs);
        await db.sales.bulkAdd(sales);
      }
      await db.expenses.bulkAdd(allExpenses);
      await db.app_state.put({ key: 'seed_version', value: SEED_VERSION });
    }
  );

  // Recompute allocations for all seeded expenses
  await recomputeAllAllocations();

  return true;
}
