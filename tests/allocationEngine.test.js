/**
 * allocationEngine.test.js
 * Vitest unit tests for src/services/allocationEngine.js
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
const mkBatch = (id, start, chicks) => ({
  batch_id: id,
  start_date: start,
  initial_chick_count: chicks,
  chick_cost: 0,
  deleted_at: null
});

const mkMort = (batchId, date, count) => ({ mortality_id: `m-${batchId}-${date}`, batch_id: batchId, entry_date: date, count, deleted_at: null });
const mkSale = (batchId, date, qty) => ({ sale_id: `s-${batchId}-${date}`, batch_id: batchId, sale_date: date, quantity_sold: qty, weight_kg: qty * 2, price_per_kg: 100, total_amount: qty * 200, deleted_at: null });

// ---------------------------------------------------------------------------
// 1. Overlap day: Batch A 3,000 heads, Batch B 9,000 heads
//    Feed ₱12,345.67 → A ₱3,086.42, B ₱9,259.25
//    Other ₱1,000.01 → A ₱250.00, B ₱750.01
// ---------------------------------------------------------------------------
describe('Overlap allocation test (thesis example)', () => {
  const batchA = mkBatch('batch-a', '2026-01-01', 3000);
  const batchB = mkBatch('batch-b', '2026-01-01', 9000);
  const date = '2026-01-10'; // Both active, no deaths or sales yet

  const expense = {
    expense_id: 'exp-1',
    entry_date: date,
    feed_centavos: 1234567, // ₱12,345.67
    other_centavos: 100001   // ₱1,000.01
  };

  it('Batch A live head count is 3000 and Batch B is 9000', () => {
    expect(liveHeadCount(batchA, [], [], date)).toBe(3000);
    expect(liveHeadCount(batchB, [], [], date)).toBe(9000);
  });

  it('Feed allocation: A ₱3,086.42 (308642 ¢), B ₱9,259.25 (925925 ¢)', () => {
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

  it('Other allocation: A ₱250.00 (25000 ¢), B ₱750.01 (75001 ¢)', () => {
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

  it('computeAllocationsForExpense returns 2 rows that sum exactly', () => {
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
// 2. Single open batch takes 100% of the entry
// ---------------------------------------------------------------------------
describe('Single batch takes 100%', () => {
  const batch = mkBatch('batch-solo', '2026-03-01', 5000);

  it('All feed goes to the single active batch', () => {
    const slots = [{ batchId: 'batch-solo', heads: 5000 }];
    const split = largestRemainderSplit(999999, slots);
    expect(split[0].shareCentavos).toBe(999999);
  });

  it('computeAllocationsForExpense gives 100% to one batch', () => {
    const expense = { expense_id: 'e1', entry_date: '2026-03-10', feed_centavos: 50000, other_centavos: 10000 };
    const result = computeAllocationsForExpense(expense, [batch], [], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feed_centavos).toBe(50000);
    expect(result.rows[0].other_centavos).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// 3. Expense on a date with no active batch is rejected
// ---------------------------------------------------------------------------
describe('Expense with no active batch', () => {
  it('returns null when no batch is active', () => {
    // Batch started after the expense date
    const futureBatch = mkBatch('batch-future', '2026-06-01', 5000);
    const expense = { expense_id: 'e2', entry_date: '2026-05-01', feed_centavos: 10000, other_centavos: 0 };
    const result = computeAllocationsForExpense(expense, [futureBatch], [], []);
    expect(result).toBeNull();
  });

  it('returns null when the only batch has 0 live heads (all sold before expense date)', () => {
    const batch = mkBatch('batch-empty', '2026-01-01', 1000);
    // All birds sold on 2026-01-05, expense on 2026-01-06
    const sale = mkSale('batch-empty', '2026-01-05', 1000);
    const expense = { expense_id: 'e3', entry_date: '2026-01-06', feed_centavos: 5000, other_centavos: 0 };
    const result = computeAllocationsForExpense(expense, [batch], [], [sale]);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Backdating a sale or death changes the recomputed allocation
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

  it('After backdating 2000 deaths to batchA on 2026-02-10: batchA gets less', () => {
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
// 5. Batch with no sales shows N/A
// ---------------------------------------------------------------------------
describe('Metrics with no sales show N/A', () => {
  const batch = mkBatch('bn', '2026-01-01', 5000);

  it('margin is N/A when revenue is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.margin).toBe('N/A');
  });

  it('costPerKg is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.costPerKg).toBe('N/A');
  });

  it('profitPerKg is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.profitPerKg).toBe('N/A');
  });

  it('fcr is N/A when kgSold is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.fcr).toBe('N/A');
  });

  it('robc is N/A when totalCost is 0', () => {
    const metrics = calcBatchMetrics(batch, [], [], [], []);
    expect(metrics.robc).toBe('N/A');
  });
});

// ---------------------------------------------------------------------------
// 6. Migration: old per-batch cost rows → new expense shape
// ---------------------------------------------------------------------------
describe('Migration conversion correctness', () => {
  it('sums medicine+utilities+labor+transport+other into other_centavos', () => {
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

  it('allocation rows for migrated single-batch expense are 100% to that batch', () => {
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
