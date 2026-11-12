/**
 * sharingAndLeftovers.test.js
 * Sharing-rule comparison (thesis FR-23, Table 18) and the leftover-bird holding cost (FR-24).
 * Test IDs follow the thesis traceability matrix (Table 20): TC-U-15, TC-U-16, TC-S-13, TC-S-14.
 */

import { describe, it, expect } from 'vitest';
import {
  computeAllocationsForExpense,
  sharedCostByBasis,
  leftoverHoldingCost
} from '../src/services/allocationEngine.js';
import { renderSummary } from '../src/ui/summaryView.js';

const mkBatch = (id, start, chicks, chickCost = 0, extra = {}) => ({
  batch_id: id,
  batch_name: id,
  start_date: start,
  initial_chick_count: chicks,
  chick_cost: chickCost,
  status: 'Open',
  deleted_at: null,
  ...extra
});
const mkMort = (batchId, date, count) => ({ mortality_id: `m-${batchId}-${date}`, batch_id: batchId, entry_date: date, count, deleted_at: null });
const mkSale = (batchId, date, qty, kg, price) => ({
  sale_id: `s-${batchId}-${date}`, batch_id: batchId, sale_date: date, quantity_sold: qty,
  weight_kg: kg, price_per_kg: price, total_amount: +(kg * price).toFixed(2), deleted_at: null
});

// ---------------------------------------------------------------------------
// Table 18: Batch A (12,000 chicks, 300 deaths, 8,700 sold → 3,000 live) and
// Batch B (9,200 chicks, 200 deaths → 9,000 live) share one day's
// feed ₱12,345.67 and other costs ₱1,000.01.
// ---------------------------------------------------------------------------
describe('TC-U-15: Sharing-rule comparison — thesis Table 18', () => {
  const batchA = mkBatch('batch-a', '2026-01-01', 12000);
  const batchB = mkBatch('batch-b', '2026-02-15', 9200);
  const mortality = [mkMort('batch-a', '2026-02-20', 300), mkMort('batch-b', '2026-02-25', 200)];
  const sales = [mkSale('batch-a', '2026-02-26', 8700, 17400, 100)];
  const expense = { expense_id: 'exp-1', entry_date: '2026-03-01', feed_centavos: 1234567, other_centavos: 100001, deleted_at: null };
  const batches = [batchA, batchB];

  it('live head count: A ₱3,336.42, B ₱10,009.26', () => {
    expect(sharedCostByBasis('batch-a', [expense], batches, mortality, sales).live).toBe(333642);
    expect(sharedCostByBasis('batch-b', [expense], batches, mortality, sales).live).toBe(1000926);
  });

  it('initial head count: A ₱7,554.16, B ₱5,791.52', () => {
    expect(sharedCostByBasis('batch-a', [expense], batches, mortality, sales).initial).toBe(755416);
    expect(sharedCostByBasis('batch-b', [expense], batches, mortality, sales).initial).toBe(579152);
  });

  it('equal split: A ₱6,672.85, B ₱6,672.83 (ties go to the lower batch id)', () => {
    expect(sharedCostByBasis('batch-a', [expense], batches, mortality, sales).equal).toBe(667285);
    expect(sharedCostByBasis('batch-b', [expense], batches, mortality, sales).equal).toBe(667283);
  });

  it('the live basis matches the allocation the app stores', () => {
    const rows = computeAllocationsForExpense(expense, batches, mortality, sales).rows;
    const a = rows.find((r) => r.batch_id === 'batch-a');
    expect(a.feed_centavos + a.other_centavos).toBe(333642);
    expect(a.basis_heads).toBe(3000);
  });

  it('every rule still adds up to the full expense', () => {
    for (const basis of ['live', 'initial', 'equal']) {
      const rows = computeAllocationsForExpense(expense, batches, mortality, sales, basis).rows;
      expect(rows.reduce((s, r) => s + r.feed_centavos + r.other_centavos, 0)).toBe(1334568);
    }
  });

  it('a batch with no live birds takes no share under any rule', () => {
    const soldOut = [...sales, mkSale('batch-b', '2026-02-27', 9000, 18000, 100)];
    const totals = sharedCostByBasis('batch-b', [expense], batches, mortality, soldOut);
    expect(totals).toEqual({ live: 0, initial: 0, equal: 0 });
  });

  it('voided expenses are left out', () => {
    const voided = { ...expense, deleted_at: '2026-03-02T00:00:00Z' };
    expect(sharedCostByBasis('batch-a', [voided], batches, mortality, sales)).toEqual({ live: 0, initial: 0, equal: 0 });
  });
});

// ---------------------------------------------------------------------------
// Leftover birds: Batch A started 1 Jan; Batch B started 1 Feb.
// ---------------------------------------------------------------------------
describe('TC-U-16: Leftover-bird holding cost', () => {
  const batchA = mkBatch('batch-a', '2026-01-01', 1000, 45000);
  const batchB = mkBatch('batch-b', '2026-02-01', 2000);
  const expenses = [
    { expense_id: 'e1', entry_date: '2026-01-15', deleted_at: null },
    { expense_id: 'e2', entry_date: '2026-02-05', deleted_at: null },
    { expense_id: 'e3', entry_date: '2026-02-10', deleted_at: null }
  ];
  const allocations = [
    { expense_id: 'e1', batch_id: 'batch-a', feed_centavos: 80000, other_centavos: 20000 },
    { expense_id: 'e2', batch_id: 'batch-a', feed_centavos: 15000, other_centavos: 5000 },
    { expense_id: 'e3', batch_id: 'batch-a', feed_centavos: 14000, other_centavos: 0 }
  ];
  const mortality = [mkMort('batch-a', '2026-01-20', 100)];
  const sales = [mkSale('batch-a', '2026-02-08', 600, 1200, 30)]; // ₱36,000
  const farm = { batches: [batchA, batchB], expenses, allocations, mortality, sales, today: '2026-02-10' };

  const r = leftoverHoldingCost(batchA, farm);

  it('counts from the day the newer batch started', () => {
    expect(r.since).toBe('2026-02-01');
    expect(r.newerBatchName).toBe('batch-b');
    expect(r.days).toBe(10);
  });

  it('adds only the shares dated on or after that day: ₱340.00', () => {
    expect(r.holdingCentavos).toBe(34000);
  });

  it('per day = last 7 days of shares ÷ 7: ₱48.57', () => {
    expect(r.perDayCentavos).toBe(4857);
  });

  it('unrecovered cost per live bird: (₱46,340 − ₱36,000) ÷ 300 birds = ₱34.47', () => {
    expect(r.liveBirds).toBe(300);
    expect(r.unrecoveredCentavos).toBe(1034000);
    expect(r.perBirdCentavos).toBe(3447);
  });

  it('is null while no later batch has started', () => {
    expect(leftoverHoldingCost(batchA, { ...farm, batches: [batchA] })).toBeNull();
    expect(leftoverHoldingCost(batchB, farm)).toBeNull();
  });

  it('a closed batch stops counting at its end date', () => {
    const closed = { ...batchA, status: 'Closed', end_date: '2026-02-06' };
    const c = leftoverHoldingCost(closed, farm);
    expect(c.days).toBe(6);
    expect(c.holdingCentavos).toBe(20000);
  });

  it('no per-bird figure once every bird is gone', () => {
    const soldOut = [...sales, mkSale('batch-a', '2026-02-09', 300, 600, 30)];
    expect(leftoverHoldingCost(batchA, { ...farm, sales: soldOut }).perBirdCentavos).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Batch summary shows both
// ---------------------------------------------------------------------------
describe('TC-S-13 / TC-S-14: Batch summary', () => {
  const batchA = mkBatch('batch-a', '2026-01-01', 1000, 45000);
  const batchB = mkBatch('batch-b', '2026-02-01', 3000);
  const expense = { expense_id: 'e1', entry_date: '2026-02-05', feed_centavos: 400000, other_centavos: 0, deleted_at: null };
  const allocations = computeAllocationsForExpense(expense, [batchA, batchB], [], []).rows;
  const batchData = { batch: batchA, feed: [], mortality: [], sales: [], allocations: allocations.filter((r) => r.batch_id === 'batch-a') };
  const farm = { batches: [batchA, batchB], mortality: [], sales: [], expenses: [expense], today: '2026-02-05' };

  it('shows the cost under each sharing rule and the leftover cost', () => {
    const html = renderSummary(batchData, null, farm);
    expect(html).toContain('Cost under other sharing rules');
    expect(html).toContain('₱1,000.00'); // live: 1,000 of 4,000 birds → ¼ of ₱4,000
    expect(html).toContain('₱2,000.00'); // equal split
    expect(html).toContain('+₱1,000.00');
    expect(html).toContain('Leftover birds');
    expect(html).toContain('batch-b');
  });

  it('leaves both out without farm records', () => {
    const html = renderSummary(batchData, null);
    expect(html).not.toContain('Cost under other sharing rules');
    expect(html).not.toContain('Leftover birds');
  });
});
