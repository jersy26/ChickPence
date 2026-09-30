import { db } from './dexie.js';

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

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

const BUYERS = [
  'Aling Nena Dressing Plant',
  'Santos Meat Shop',
  'Metro Poultry Trading',
  'Kuya Ben Manok'
];

function generateMockBatch(o) {
  const r = rng(o.seed);
  const rf = rng(o.seed + 999);
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();

  const batch = {
    batch_id: batchId,
    user_id: DEMO_USER_ID,
    batch_name: o.name,
    start_date: o.start,
    end_date: o.done ? addDays(o.start, o.days) : null,
    initial_chick_count: o.chicks,
    chick_cost: o.chicks * 55,
    mortality_threshold_pct: o.mt ?? null,
    cost_budget: o.cb ?? null,
    status: o.done ? 'Completed' : 'Active',
    created_at: now,
    updated_at: now,
    deleted_at: null
  };

  const dailyCosts = [];
  const feedLogs = [];
  const mortalityLogs = [];
  const sales = [];

  for (let i = 0; i < o.days; i++) {
    const d = addDays(o.start, i);

    dailyCosts.push({
      cost_id: crypto.randomUUID(),
      batch_id: batchId,
      entry_date: d,
      feed_cost: Math.round(o.chicks * (1 + (i / o.days) * 2.4) * (0.95 + r() * 0.1)),
      medicine_cost: Math.round(o.chicks * 0.12 * r() * (i < 10 ? 1.5 : 0.7)),
      utilities_cost: Math.round(1100 + r() * 600),
      labor_cost: 1500,
      transport_cost: r() < 0.15 ? Math.round(1500 + r() * 1500) : 0,
      other_cost: r() < 0.2 ? Math.round(200 + r() * 500) : 0,
      updated_at: now,
      deleted_at: null
    });

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
      feed_type: i < 14 ? 'Starter' : i < 28 ? 'Grower' : 'Finisher',
      quantity_kg: Math.round(o.chicks * (0.015 + (i / o.days) * 0.13) * (0.95 + rf() * 0.1)),
      updated_at: now,
      deleted_at: null
    });
  }

  const totalDeaths = mortalityLogs.reduce((acc, m) => acc + m.count, 0);
  const surviving = o.chicks - totalDeaths;
  const parts = o.done ? [[0.4, -2], [0.35, -1], [0.25, 0]] : [[0, -2]];
  let left = surviving;

  parts.forEach(([fraction, dayOffset], i) => {
    const qty = o.done ? (i === 2 ? left : Math.round(surviving * fraction)) : 1200;
    left -= qty;
    const kg = +(qty * (1.9 + r() * 0.3)).toFixed(2);
    const ppk = +(o.price * (0.97 + r() * 0.06)).toFixed(2);

    sales.push({
      sale_id: crypto.randomUUID(),
      batch_id: batchId,
      sale_date: addDays(o.start, o.days + dayOffset),
      buyer_name: BUYERS[(i + o.seed) % 4],
      quantity_sold: qty,
      weight_kg: kg,
      price_per_kg: ppk,
      total_amount: +(kg * ppk).toFixed(2),
      updated_at: now,
      deleted_at: null
    });
  });

  return { batch, dailyCosts, feedLogs, mortalityLogs, sales };
}

export async function checkAndSeedInitialData(force = false) {
  const count = await db.batches.count();
  if (count > 0 && !force) {
    return false;
  }

  if (force) {
    await db.batches.clear();
    await db.daily_costs.clear();
    await db.feed_logs.clear();
    await db.mortality_logs.clear();
    await db.sales.clear();
    await db.outbox.clear();
  }

  const definitions = [
    { name: 'Batch 2025-08', start: '2025-08-05', days: 44, chicks: 10000, seed: 11, mp: 0.035, price: 98, done: 1, mt: 5, cb: 1800000 },
    { name: 'Batch 2025-10', start: '2025-10-04', days: 45, chicks: 12000, seed: 22, mp: 0.042, price: 102, done: 1, mt: 5, cb: 2100000 },
    { name: 'Batch 2025-12', start: '2025-12-03', days: 46, chicks: 10500, seed: 33, mp: 0.081, price: 94, done: 1, mt: 6, cb: 1900000 },
    { name: 'Batch 2026-02', start: '2026-02-01', days: 44, chicks: 13000, seed: 44, mp: 0.03, price: 98, done: 1, mt: 5, cb: 2300000 },
    { name: 'Batch 2026-04', start: '2026-04-02', days: 45, chicks: 15000, seed: 55, mp: 0.09, price: 84, done: 1, mt: 6, cb: 2400000 },
    { name: 'Batch 2026-06', start: '2026-06-01', days: 45, chicks: 11000, seed: 66, mp: 0.038, price: 101, done: 1, mt: 5, cb: 2000000 },
    { name: 'Batch 2026-08', start: '2026-08-20', days: 41, chicks: 10000, seed: 77, mp: 0.062, price: 98, done: 0, mt: 5, cb: 1700000 }
  ];

  await db.transaction('rw', [db.batches, db.daily_costs, db.feed_logs, db.mortality_logs, db.sales], async () => {
    for (const def of definitions) {
      const { batch, dailyCosts, feedLogs, mortalityLogs, sales } = generateMockBatch(def);
      await db.batches.add(batch);
      await db.daily_costs.bulkAdd(dailyCosts);
      await db.feed_logs.bulkAdd(feedLogs);
      await db.mortality_logs.bulkAdd(mortalityLogs);
      await db.sales.bulkAdd(sales);
    }
  });

  return true;
}
