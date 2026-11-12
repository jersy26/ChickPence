/**
 * allocationEngine.test.js
 * Vitest unit tests for src/services/allocationEngine.js
 *
 * Test IDs are those of the thesis traceability matrix (Table 20):
 *   TC-U-01  chick cost counted once
 *   TC-U-02  active batch rule (live head count)
 *   TC-U-03  shares add up (Table 17), single batch
 *   TC-U-04  three batches
 *   TC-U-05  no active batch
 *   TC-U-09  mortality flag at, above and below the alert level
 *   TC-U-10  Batch H worked example — all 11 metrics match hand calculations (Table 19)
 *   TC-U-11  zero denominators show N/A
 *   TC-U-13  business logic separate from the UI and database
 * TC-U-06/07/08/12 are in entryChecks.test.js, TC-U-14 in uiPages.test.js,
 * TC-U-15/16 in sharingAndLeftovers.test.js. The migration checks have no ID.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  liveHeadCount,
  isBatchActiveOnDate,
  largestRemainderSplit,
  computeAllocationsForExpense,
  calcBatchMetrics,
  evalMortalityWarning
} from '../src/services/allocationEngine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mkBatch = (id, start, chicks, chickCost = 0) => ({
  batch_id: id,
  start_date: start,
  initial_chick_count: chicks,
  chick_cost: chickCost,
  deleted_at: null
});

const mkMort = (batchId, date, count) => ({
  mortality_id: `m-${batchId}-${date}`,
  batch_id: batchId,
  entry_date: date,
  count,
  deleted_at: null
});

/** Feed log using integer grams (quantity_g) — v3 schema */
const mkFeed = (batchId, date, grams) => ({
  feed_log_id: `f-${batchId}-${date}`,
  batch_id: batchId,
  entry_date: date,
  quantity_g: grams,
  deleted_at: null
});

const mkSale = (batchId, date, qty, weightKg = null, pricePerKg = 100) => {
  const kg = weightKg ?? qty * 2;
  return {
    sale_id: `s-${batchId}-${date}`,
    batch_id: batchId,
    sale_date: date,
    quantity_sold: qty,
    weight_kg: kg,
    price_per_kg: pricePerKg,
    total_amount: +(kg * pricePerKg).toFixed(2),
    deleted_at: null
  };
};

// ---------------------------------------------------------------------------
// TC-U-02 / TC-U-03
// Overlap day: Batch A 3,000 heads, Batch B 9,000 heads
//   Feed ₱12,345.67 → A ₱3,086.42 (308642 ¢), B ₱9,259.25 (925925 ¢)
//   Other ₱1,000.01 → A ₱250.00  (25000 ¢),  B ₱750.01  (75001 ¢)
// ---------------------------------------------------------------------------
describe('TC-U-03: Shares add up — thesis Table 17 example', () => {
  const batchA = mkBatch('batch-a', '2026-01-01', 3000);
  const batchB = mkBatch('batch-b', '2026-01-01', 9000);
  const date = '2026-01-10'; // Both active, no deaths or sales yet

  const expense = {
    expense_id: 'exp-1',
    entry_date: date,
    feed_centavos: 1234567, // ₱12,345.67
    other_centavos: 100001  // ₱1,000.01
  };

  it('TC-U-02: Batch A live head count is 3000 and Batch B is 9000', () => {
    expect(liveHeadCount(batchA, [], [], date)).toBe(3000);
    expect(liveHeadCount(batchB, [], [], date)).toBe(9000);
  });

  it('TC-U-03a: Feed allocation: A ₱3,086.42 (308642 ¢), B ₱9,259.25 (925925 ¢)', () => {
    const slots = [
      { batchId: 'batch-a', heads: 3000 },
      { batchId: 'batch-b', heads: 9000 }
    ];
    const split = largestRemainderSplit(1234567, slots);
    const aShare = split.find((x) => x.batchId === 'batch-a').shareCentavos;
    const bShare = split.find((x) => x.batchId === 'batch-b').shareCentavos;

    expect(aShare).toBe(308642); // ₱3,086.42
    expect(bShare).toBe(925925); // ₱9,259.25
    expect(aShare + bShare).toBe(1234567); // sums exactly
  });

  it('TC-U-03b: Other allocation: A ₱250.00 (25000 ¢), B ₱750.01 (75001 ¢)', () => {
    const slots = [
      { batchId: 'batch-a', heads: 3000 },
      { batchId: 'batch-b', heads: 9000 }
    ];
    const split = largestRemainderSplit(100001, slots);
    const aShare = split.find((x) => x.batchId === 'batch-a').shareCentavos;
    const bShare = split.find((x) => x.batchId === 'batch-b').shareCentavos;

    expect(aShare).toBe(25000); // ₱250.00
    expect(bShare).toBe(75001); // ₱750.01
    expect(aShare + bShare).toBe(100001); // sums exactly
  });

  it('TC-U-03c: computeAllocationsForExpense returns 2 rows that sum exactly', () => {
    const result = computeAllocationsForExpense(expense, [batchA, batchB], [], []);
    expect(result).not.toBeNull();
    expect(result.rows).toHaveLength(2);

    const totalFeed = result.rows.reduce((s, r) => s + r.feed_centavos, 0);
    const totalOther = result.rows.reduce((s, r) => s + r.other_centavos, 0);
    expect(totalFeed).toBe(1234567);
    expect(totalOther).toBe(100001);
  });
});

// ---------------------------------------------------------------------------
// TC-U-03 — Single open batch takes 100% of the entry
// ---------------------------------------------------------------------------
describe('TC-U-03: Single batch takes 100%', () => {
  const batch = mkBatch('batch-solo', '2026-03-01', 5000);

  it('TC-U-03d: All feed goes to the single active batch', () => {
    const slots = [{ batchId: 'batch-solo', heads: 5000 }];
    const split = largestRemainderSplit(999999, slots);
    expect(split[0].shareCentavos).toBe(999999);
  });

  it('TC-U-03e: computeAllocationsForExpense gives 100% to one batch', () => {
    const expense = { expense_id: 'e1', entry_date: '2026-03-10', feed_centavos: 50000, other_centavos: 10000 };
    const result = computeAllocationsForExpense(expense, [batch], [], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feed_centavos).toBe(50000);
    expect(result.rows[0].other_centavos).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// TC-U-02 / TC-U-05 — Expense on a date with no active batch is rejected
// ---------------------------------------------------------------------------
describe('TC-U-02/05: Expense with no active batch', () => {
  it('TC-U-05a: returns null when no batch is active (batch started after expense date)', () => {
    const futureBatch = mkBatch('batch-future', '2026-06-01', 5000);
    const expense = { expense_id: 'e2', entry_date: '2026-05-01', feed_centavos: 10000, other_centavos: 0 };
    const result = computeAllocationsForExpense(expense, [futureBatch], [], []);
    expect(result).toBeNull();
  });

  it('TC-U-05b: returns null when the only batch has 0 live heads (all sold before expense date)', () => {
    const batch = mkBatch('batch-empty', '2026-01-01', 1000);
    const sale = mkSale('batch-empty', '2026-01-05', 1000);
    const expense = { expense_id: 'e3', entry_date: '2026-01-06', feed_centavos: 5000, other_centavos: 0 };
    const result = computeAllocationsForExpense(expense, [batch], [], [sale]);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Backdating a death changes the recomputed allocation (the rule behind TC-I-05/06)
// ---------------------------------------------------------------------------
describe('Backdated mortality / sale changes allocation', () => {
  const batchA = mkBatch('ba', '2026-02-01', 6000);
  const batchB = mkBatch('bb', '2026-02-01', 6000);
  const date = '2026-02-15';
  const expense = { expense_id: 'ex', entry_date: date, feed_centavos: 120000, other_centavos: 0 };

  it('Before backdated death: equal split (50/50)', () => {
    const result = computeAllocationsForExpense(expense, [batchA, batchB], [], []);
    const aRow = result.rows.find((r) => r.batch_id === 'ba');
    const bRow = result.rows.find((r) => r.batch_id === 'bb');
    expect(aRow.feed_centavos).toBe(60000);
    expect(bRow.feed_centavos).toBe(60000);
  });

  it('After backdating 2000 deaths to batchA: batchA gets 40% (4000/10000)', () => {
    const mort = mkMort('ba', '2026-02-10', 2000);
    const result = computeAllocationsForExpense(expense, [batchA, batchB], [mort], []);
    const aRow = result.rows.find((r) => r.batch_id === 'ba');
    const bRow = result.rows.find((r) => r.batch_id === 'bb');
    expect(aRow.feed_centavos).toBe(48000);
    expect(bRow.feed_centavos).toBe(72000);
    expect(aRow.feed_centavos + bRow.feed_centavos).toBe(120000);
  });
});

// ---------------------------------------------------------------------------
// TC-U-10 — Batch H full worked example (thesis Table 19)
//
// Inputs:
//   initial_chick_count : 1,000
//   chick_cost          : ₱45,000.00
//   Feed (allocated)    : ₱75,000.00  → feed_centavos  = 7,500,000
//   Other (allocated)   : ₱6,000.00   → other_centavos =   600,000
//   Deaths              : 40
//   Feed consumed       : 3,920 kg stored as 3,920,000 g (integer grams)
//   Sale 1: 600 birds, 1,260 kg @ ₱95/kg → ₱119,700
//   Sale 2: 320 birds,   700 kg @ ₱90/kg →  ₱63,000
//
// Expected outputs (hand-calculated, Table 19):
//   totalCost     ₱126,000.00
//   revenue       ₱182,700.00
//   netProfit      ₱56,700.00
//   margin             31.03 %
//   kgSold         1,960 kg
//   costPerKg         ₱64.29
//   profitPerKg       ₱28.93
//   mortalityRate       4.00 %
//   totalFeedKg    3,920 kg
//   fcr                 2.00
//   robc              45.00 %
// ---------------------------------------------------------------------------
describe('TC-U-10: Batch H full worked example — all 11 metrics (Table 19)', () => {
  const batchH = mkBatch('batch-h', '2026-01-01', 1000, 45000);

  const allocations = [
    {
      expense_id: 'exp-h1',
      batch_id: 'batch-h',
      feed_centavos: 7500000,  // ₱75,000.00
      other_centavos: 600000,  // ₱6,000.00
      deleted_at: null
    }
  ];

  const sales = [
    mkSale('batch-h', '2026-02-15', 600, 1260, 95),  // ₱119,700
    mkSale('batch-h', '2026-02-16', 320,  700, 90)   // ₱63,000
  ];

  const mortality = [mkMort('batch-h', '2026-01-20', 40)];

  // 3,920 kg = 3,920,000 g — stored as integer grams per NFR-04
  const feedLogs = [mkFeed('batch-h', '2026-02-01', 3920000)];

  const m = calcBatchMetrics(batchH, allocations, sales, mortality, feedLogs);

  it('TC-U-10a: totalCost = ₱126,000.00', () => {
    expect(m.totalCost).toBeCloseTo(126000, 2);
  });

  it('TC-U-10b: revenue = ₱182,700.00', () => {
    expect(m.revenue).toBeCloseTo(182700, 2);
  });

  it('TC-U-10c: netProfit = ₱56,700.00', () => {
    expect(m.netProfit).toBeCloseTo(56700, 2);
  });

  it('TC-U-10d: margin = 31.03%', () => {
    expect(Number(m.margin).toFixed(2)).toBe('31.03');
  });

  it('TC-U-10e: kgSold = 1,960 kg', () => {
    expect(m.kgSold).toBeCloseTo(1960, 2);
  });

  it('TC-U-10f: costPerKg = ₱64.29', () => {
    expect(Number(m.costPerKg).toFixed(2)).toBe('64.29');
  });

  it('TC-U-10g: profitPerKg = ₱28.93', () => {
    expect(Number(m.profitPerKg).toFixed(2)).toBe('28.93');
  });

  it('TC-U-10h: mortalityRate = 4.00%', () => {
    expect(Number(m.mortalityRate).toFixed(2)).toBe('4.00');
  });

  it('TC-U-10i: totalFeedKg = 3,920 kg (converted from 3,920,000 g)', () => {
    expect(m.totalFeedKg).toBeCloseTo(3920, 3);
  });

  it('TC-U-10j: FCR = 2.00', () => {
    expect(Number(m.fcr).toFixed(2)).toBe('2.00');
  });

  it('TC-U-10k: ROBC = 45.00%', () => {
    expect(Number(m.robc).toFixed(2)).toBe('45.00');
  });
});

// ---------------------------------------------------------------------------
// TC-U-11 — Zero-denominator N/A guards (FR-16 / AC-12)
// ---------------------------------------------------------------------------
describe('TC-U-11: N/A guards for zero-denominator metrics (FR-16)', () => {
  const batch = mkBatch('bn', '2026-01-01', 5000);

  it('TC-U-11a: margin is N/A when revenue is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.margin).toBe('N/A');
  });

  it('TC-U-11b: costPerKg is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.costPerKg).toBe('N/A');
  });

  it('TC-U-11c: profitPerKg is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.profitPerKg).toBe('N/A');
  });

  it('TC-U-11d: fcr is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.fcr).toBe('N/A');
  });

  it('TC-U-11e: robc is N/A when totalCost is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.robc).toBe('N/A');
  });
});

// ---------------------------------------------------------------------------
// Migration: v1 per-batch cost rows → v3 expense shape
// ---------------------------------------------------------------------------
describe('Migration conversion correctness', () => {
  it('sums medicine+utilities+labor+transport+other into other_centavos', () => {
    const oldRow = {
      feed_cost: 500,
      medicine_cost: 100,
      utilities_cost: 200,
      labor_cost: 300,
      transport_cost: 50,
      other_cost: 150
    };

    const feedCentavos = Math.round(oldRow.feed_cost * 100);
    const otherCentavos = Math.round(
      (oldRow.medicine_cost + oldRow.utilities_cost + oldRow.labor_cost +
       oldRow.transport_cost + oldRow.other_cost) * 100
    );

    expect(feedCentavos).toBe(50000);
    expect(otherCentavos).toBe(80000);

    const originalTotal = oldRow.feed_cost + oldRow.medicine_cost + oldRow.utilities_cost +
                          oldRow.labor_cost + oldRow.transport_cost + oldRow.other_cost;
    const newTotal = (feedCentavos + otherCentavos) / 100;
    expect(newTotal).toBe(originalTotal); // 1300
  });

  it('allocation rows for migrated single-batch expense are 100% to that batch', () => {
    const batch = mkBatch('mig-batch', '2025-08-05', 10000);
    const expense = {
      expense_id: 'mig-exp',
      entry_date: '2025-08-10',
      feed_centavos: 50000,
      other_centavos: 80000
    };
    const result = computeAllocationsForExpense(expense, [batch], [], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feed_centavos).toBe(50000);
    expect(result.rows[0].other_centavos).toBe(80000);
  });
});

// ---------------------------------------------------------------------------
// TC-U-01 — Chick cost is counted once, on its own batch, and never shared
// ---------------------------------------------------------------------------
describe('TC-U-01: Chick cost counted once', () => {
  it('appears once in total cost and in no other batch', () => {
    const a = mkBatch('a', '2026-01-01', 1000, 45000);
    const b = mkBatch('b', '2026-01-01', 1000, 0);
    const expense = { expense_id: 'e', entry_date: '2026-01-05', feed_centavos: 200000, other_centavos: 0 };
    const rows = computeAllocationsForExpense(expense, [a, b], [], []).rows;
    expect(calcBatchMetrics(a, rows.filter((r) => r.batch_id === 'a'), [], [], []).totalCost).toBe(46000);
    expect(calcBatchMetrics(b, rows.filter((r) => r.batch_id === 'b'), [], [], []).totalCost).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// TC-U-04 — Three batches on one day
// ---------------------------------------------------------------------------
describe('TC-U-04: Three batches', () => {
  it('shares ₱100.00 by 1,000 / 2,000 / 3,000 live birds and adds up exactly', () => {
    const batches = [mkBatch('a', '2026-01-01', 1000), mkBatch('b', '2026-01-02', 2000), mkBatch('c', '2026-01-03', 3000)];
    const expense = { expense_id: 'e', entry_date: '2026-01-10', feed_centavos: 10000, other_centavos: 1 };
    const rows = computeAllocationsForExpense(expense, batches, [], []).rows;
    expect(rows.map((r) => r.feed_centavos)).toEqual([1667, 3333, 5000]);
    expect(rows.reduce((s, r) => s + r.feed_centavos, 0)).toBe(10000);
    // One centavo, three equal-looking claims: the largest remainder (batch c, 0.5) gets it
    expect(rows.map((r) => r.other_centavos)).toEqual([0, 0, 1]);
    expect(rows.map((r) => r.total_heads)).toEqual([6000, 6000, 6000]);
  });
});

// ---------------------------------------------------------------------------
// TC-U-09 — Mortality flag at, above and below the alert level (FR-15, AC-11)
// ---------------------------------------------------------------------------
describe('TC-U-09: Mortality flag', () => {
  const batch = { ...mkBatch('f', '2026-01-01', 1000), mortality_threshold_pct: 5 };
  const flagAt = (deaths) => evalMortalityWarning(batch, [mkMort('f', '2026-01-05', deaths)]).mortalityFlag;

  it('is not shown below the level (4.9%)', () => expect(flagAt(49)).toBe(false));
  it('is not shown at the level (5.0%)', () => expect(flagAt(50)).toBe(false));
  it('is shown above the level (5.1%)', () => expect(flagAt(51)).toBe(true));
  it('is never shown when no level is set', () => {
    expect(evalMortalityWarning({ ...batch, mortality_threshold_pct: null }, [mkMort('f', '2026-01-05', 900)]).mortalityFlag).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-U-13 — Business rules are kept apart from the UI and the database (NFR-08)
// ---------------------------------------------------------------------------
describe('TC-U-13: Business logic in isolation', () => {
  it('allocationEngine.js imports nothing, so its rules run without the UI or Dexie', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/services/allocationEngine.js', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
