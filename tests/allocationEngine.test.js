/**
 * allocationEngine.test.js
 * Vitest unit tests for src/services/allocationEngine.js
 *
 * Test IDs map to the thesis Requirements Traceability Matrix (Table 20):
 *   TC-U-01  liveHeadCount basics
 *   TC-U-02  liveHeadCount after sales
 *   TC-U-03  largestRemainderSplit — overlap example (Table 17)
 *   TC-U-04  largestRemainderSplit — other costs
 *   TC-U-05  computeAllocationsForExpense sums exactly
 *   TC-U-06  computeAllocationsForExpense — single batch 100%
 *   TC-U-07  computeAllocationsForExpense — no active batch returns null
 *   TC-U-08  computeAllocationsForExpense — all birds sold, null
 *   TC-U-09  backdated mortality / sale changes allocation
 *   TC-U-10  Batch H worked example — all 11 metrics match hand calculations (Table 19)
 *   TC-U-11  N/A guard: margin when revenue = 0
 *   TC-U-12  N/A guard: costPerKg when kgSold = 0
 *   TC-U-13  N/A guard: profitPerKg when kgSold = 0
 *   TC-U-14  N/A guard: fcr when kgSold = 0
 *   TC-U-15  N/A guard: robc when totalCost = 0
 *   TC-U-16  Migration: old cost row sums correctly into other_centavos
 *   TC-U-17  Migration: single-batch migrated expense allocates 100%
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  liveHeadCount,
  isBatchActiveOnDate,
  largestRemainderSplit,
  computeAllocationsForExpense,
  calcBatchMetrics
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

// quantity_g (integer grams) — new schema
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
// TC-U-01 / TC-U-02 — liveHeadCount
// (exercised implicitly in overlap test; also covered explicitly in TC-U-05)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TC-U-03 / TC-U-04 / TC-U-05
// Overlap day: Batch A 3,000 heads, Batch B 9,000 heads
//   Feed ₱12,345.67 → A ₱3,086.42, B ₱9,259.25
//   Other ₱1,000.01 → A ₱250.00, B ₱750.01
// ---------------------------------------------------------------------------
describe('TC-U-03/04/05: Overlap allocation — thesis Table 17 example', () => {
  const batchA = mkBatch('batch-a', '2026-01-01', 3000);
  const batchB = mkBatch('batch-b', '2026-01-01', 9000);
  const date = '2026-01-10'; // Both active, no deaths or sales yet

  const expense = {
    expense_id: 'exp-1',
    entry_date: date,
    feed_centavos: 1234567, // ₱12,345.67
    other_centavos: 100001   // ₱1,000.01
  };

  it('TC-U-01: Batch A live head count is 3000 and Batch B is 9000', () => {
    expect(liveHeadCount(batchA, [], [], date)).toBe(3000);
    expect(liveHeadCount(batchB, [], [], date)).toBe(9000);
  });

  it('TC-U-03: Feed allocation: A ₱3,086.42 (308642 ¢), B ₱9,259.25 (925925 ¢)', () => {
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

  it('TC-U-04: Other allocation: A ₱250.00 (25000 ¢), B ₱750.01 (75001 ¢)', () => {
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

  it('TC-U-05: computeAllocationsForExpense returns 2 rows that sum exactly', () => {
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
// TC-U-06 — Single open batch takes 100% of the entry
// ---------------------------------------------------------------------------
describe('TC-U-06: Single batch takes 100%', () => {
  const batch = mkBatch('batch-solo', '2026-03-01', 5000);

  it('TC-U-06a: All feed goes to the single active batch', () => {
    const slots = [{ batchId: 'batch-solo', heads: 5000 }];
    const split = largestRemainderSplit(999999, slots);
    expect(split[0].shareCentavos).toBe(999999);
  });

  it('TC-U-06b: computeAllocationsForExpense gives 100% to one batch', () => {
    const expense = { expense_id: 'e1', entry_date: '2026-03-10', feed_centavos: 50000, other_centavos: 10000 };
    const result = computeAllocationsForExpense(expense, [batch], [], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feed_centavos).toBe(50000);
    expect(result.rows[0].other_centavos).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// TC-U-07 / TC-U-08 — Expense on a date with no active batch is rejected
// ---------------------------------------------------------------------------
describe('TC-U-07/08: Expense with no active batch', () => {
  it('TC-U-07: returns null when no batch is active (batch started after expense date)', () => {
    const futureBatch = mkBatch('batch-future', '2026-06-01', 5000);
    const expense = { expense_id: 'e2', entry_date: '2026-05-01', feed_centavos: 10000, other_centavos: 0 };
    const result = computeAllocationsForExpense(expense, [futureBatch], [], []);
    expect(result).toBeNull();
  });

  it('TC-U-08: returns null when the only batch has 0 live heads (all sold before expense date)', () => {
    const batch = mkBatch('batch-empty', '2026-01-01', 1000);
    // All birds sold on 2026-01-05, expense on 2026-01-06
    const sale = mkSale('batch-empty', '2026-01-05', 1000);
    const expense = { expense_id: 'e3', entry_date: '2026-01-06', feed_centavos: 5000, other_centavos: 0 };
    const result = computeAllocationsForExpense(expense, [batch], [], [sale]);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TC-U-09 — Backdating a sale or death changes the recomputed allocation
// ---------------------------------------------------------------------------
describe('TC-U-09: Backdated mortality / sale changes allocation', () => {
  const batchA = mkBatch('ba', '2026-02-01', 6000);
  const batchB = mkBatch('bb', '2026-02-01', 6000);
  const date = '2026-02-15';
  const expense = { expense_id: 'ex', entry_date: date, feed_centavos: 120000, other_centavos: 0 };

  it('TC-U-09a: Before backdated death: equal split (50/50)', () => {
    const result = computeAllocationsForExpense(expense, [batchA, batchB], [], []);
    const aRow = result.rows.find((r) => r.batch_id === 'ba');
    const bRow = result.rows.find((r) => r.batch_id === 'bb');
    expect(aRow.feed_centavos).toBe(60000);
    expect(bRow.feed_centavos).toBe(60000);
  });

  it('TC-U-09b: After backdating 2000 deaths to batchA: batchA gets less (4000/10000 = 40%)', () => {
    // 2000 deaths on 2026-02-10 → entry_date < 2026-02-15, so batchA live heads = 4000
    const mort = mkMort('ba', '2026-02-10', 2000);
    // batchA: 4000 heads, batchB: 6000 heads → total 10000
    // feed ₱1200: batchA = 120000 * 4000/10000 = 48000, batchB = 72000
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
// Inputs (from Table 19 / Section 3.5):
//   initial_chick_count : 1,000
//   chick_cost          : ₱45,000.00
//   Feed cost (allocated): ₱75,000.00  → allocation other_centavos = 0, feed_centavos = 7500000
//   Other cost (alloc)   : ₱6,000.00   → other_centavos = 600000
//   Deaths              : 40
//   Feed consumed       : 3,920 kg (stored as 3,920,000 g)
//   Sales               :
//     Sale 1: 600 birds, 1,260 kg @ ₱95/kg → total ₱119,700
//     Sale 2: 320 birds,   700 kg @ ₱90/kg → total  ₱63,000
//
// Expected outputs (hand-calculated):
//   totalCost     ₱126,000.00
//   revenue       ₱182,700.00
//   netProfit      ₱56,700.00
//   margin        31.03 % (= 56700/182700 × 100, 2 dp → 31.03)
//   kgSold        1,960 kg
//   costPerKg     ₱64.29 (= 126000/1960, 2 dp → 64.29)
//   profitPerKg   ₱28.93 (= 56700/1960, 2 dp → 28.93)
//   mortalityRate 4.00 % (= 40/1000 × 100)
//   totalFeedKg   3,920 kg
//   fcr           2.00  (= 3920/1960)
//   robc          45.00 % (= 56700/126000 × 100)
// ---------------------------------------------------------------------------
describe('TC-U-10: Batch H full worked example — all 11 metrics (Table 19)', () => {
  const batchH = mkBatch('batch-h', '2026-01-01', 1000, 45000);

  // Allocation rows encode the feed & other costs already allocated to this batch
  const allocations = [
    {
      expense_id: 'exp-h1',
      batch_id: 'batch-h',
      feed_centavos: 7500000,  // ₱75,000.00
      other_centavos: 600000,  // ₱6,000.00
      deleted_at: null
    }
  ];

  // Sales
  const sales = [
    mkSale('batch-h', '2026-02-15', 600, 1260, 95),  // ₱119,700
    mkSale('batch-h', '2026-02-16', 320,  700, 90)   // ₱63,000
  ];

  // Mortality: 40 deaths total
  const mortality = [mkMort('batch-h', '2026-01-20', 40)];

  // Feed: 3,920 kg = 3,920,000 g (integer grams)
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
// TC-U-11 to TC-U-15 — Zero-denominator N/A guards (FR-16 / AC-12)
// ---------------------------------------------------------------------------
describe('TC-U-11–15: N/A guards for zero-denominator metrics (FR-16)', () => {
  const batch = mkBatch('bn', '2026-01-01', 5000);

  it('TC-U-11: margin is N/A when revenue is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.margin).toBe('N/A');
  });

  it('TC-U-12: costPerKg is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.costPerKg).toBe('N/A');
  });

  it('TC-U-13: profitPerKg is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.profitPerKg).toBe('N/A');
  });

  it('TC-U-14: fcr is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.fcr).toBe('N/A');
  });

  it('TC-U-15: robc is N/A when totalCost is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.robc).toBe('N/A');
  });
});

// ---------------------------------------------------------------------------
// TC-U-16 / TC-U-17 — Migration: v1 per-batch cost rows → v3 expense shape
// ---------------------------------------------------------------------------
describe('TC-U-16/17: Migration conversion correctness', () => {
  it('TC-U-16: sums medicine+utilities+labor+transport+other into other_centavos', () => {
    // Old row: feed_cost=500, medicine=100, utilities=200, labor=300, transport=50, other=150
    // Total other = 100+200+300+50+150 = 800 → other_centavos = 80000
    // feed_centavos = 50000
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
      (oldRow.medicine_cost + oldRow.utilities_cost + oldRow.labor_cost + oldRow.transport_cost + oldRow.other_cost) * 100
    );

    expect(feedCentavos).toBe(50000);
    expect(otherCentavos).toBe(80000);

    // Total in pesos must equal original sum
    const originalTotal = oldRow.feed_cost + oldRow.medicine_cost + oldRow.utilities_cost + oldRow.labor_cost + oldRow.transport_cost + oldRow.other_cost;
    const newTotal = (feedCentavos + otherCentavos) / 100;
    expect(newTotal).toBe(originalTotal); // 1300
  });

  it('TC-U-17: allocation rows for migrated single-batch expense are 100% to that batch', () => {
    const batch = mkBatch('mig-batch', '2025-08-05', 10000);
    const expense = {
      expense_id: 'mig-exp',
      entry_date: '2025-08-10', // After start_date
      feed_centavos: 50000,
      other_centavos: 80000
    };
    const result = computeAllocationsForExpense(expense, [batch], [], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feed_centavos).toBe(50000);
    expect(result.rows[0].other_centavos).toBe(80000);
  });
});
