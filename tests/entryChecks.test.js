/**
 * entryChecks.test.js
 * Birds left for a death or sale (FR-10, FR-12; AC-07, AC-09), sale amounts in
 * whole centavos (FR-13, NFR-04) and the largest-remainder tie-break (FR-06).
 */

import { describe, it, expect } from 'vitest';
import {
  remainingBirds,
  saleAmountCentavos,
  largestRemainderSplit,
  calcBatchMetrics
} from '../src/services/allocationEngine.js';

const batch = { batch_id: 'b1', start_date: '2026-01-01', initial_chick_count: 1000, chick_cost: 0 };
const mort = (id, date, count) => ({ mortality_id: id, batch_id: 'b1', entry_date: date, count, deleted_at: null });
const sale = (id, date, qty, kg = 1, price = 100) => ({ sale_id: id, batch_id: 'b1', sale_date: date, quantity_sold: qty, weight_kg: kg, price_per_kg: price, deleted_at: null });

describe('Birds left for a new or corrected death or sale', () => {
  const deaths = [mort('m1', '2026-01-20', 100)];
  const sales = [sale('s1', '2026-02-08', 600)];

  it('takes every other death and sale off the initial count', () => {
    expect(remainingBirds(batch, deaths, sales)).toBe(300);
  });

  it('leaves out the entry being edited', () => {
    expect(remainingBirds(batch, deaths, sales, { saleId: 's1' })).toBe(900);
    expect(remainingBirds(batch, deaths, sales, { mortalityId: 'm1' })).toBe(400);
  });

  it('counts later-dated entries too, so a backdated death cannot leave a later sale short', () => {
    const soldOut = [sale('s1', '2026-02-10', 900)];
    expect(remainingBirds(batch, deaths, soldOut)).toBe(0); // one more death on any date is refused
  });

  it('ignores deleted entries', () => {
    expect(remainingBirds(batch, [{ ...deaths[0], deleted_at: '2026-02-01T00:00:00Z' }], sales)).toBe(400);
  });
});

describe('Sale amount in whole centavos', () => {
  it('1,260 kg at ₱95.00 = ₱119,700.00', () => {
    expect(saleAmountCentavos({ weight_kg: 1260, price_per_kg: 95 })).toBe(11970000);
  });

  it('rounds half up to the centavo: 0.333 kg at ₱1.50 = ₱0.50', () => {
    expect(saleAmountCentavos({ weight_kg: 0.333, price_per_kg: 1.5 })).toBe(50);
  });

  it('revenue comes from weight and price, not from a stored total', () => {
    const stale = { ...sale('s1', '2026-02-08', 10, 20, 100), total_amount: 1 };
    expect(calcBatchMetrics(batch, [], [stale], [], []).revenue).toBe(2000);
  });

  it('sums decimal entries exactly: 3 sales of 0.1 kg at ₱0.10', () => {
    const sales = [sale('a', '2026-02-01', 1, 0.1, 0.1), sale('b', '2026-02-02', 1, 0.1, 0.1), sale('c', '2026-02-03', 1, 0.1, 0.1)];
    const m = calcBatchMetrics({ ...batch, chick_cost: 0.3 }, [], sales, [], []);
    expect(m.revenue).toBe(0.03);
    expect(m.kgSold).toBe(0.3);
    expect(m.totalCost).toBe(0.3);
  });
});

describe('Largest remainder tie-break', () => {
  it('a tied centavo goes to the batch that started earlier, whatever its id', () => {
    const split = largestRemainderSplit(1, [
      { batchId: 'batch-a', heads: 1, start: '2026-02-01' },
      { batchId: 'batch-z', heads: 1, start: '2026-01-01' }
    ]);
    expect(split.find((s) => s.batchId === 'batch-z').shareCentavos).toBe(1);
  });

  it('same start date: the lower id', () => {
    const split = largestRemainderSplit(1, [
      { batchId: 'batch-b', heads: 1, start: '2026-01-01' },
      { batchId: 'batch-a', heads: 1, start: '2026-01-01' }
    ]);
    expect(split.find((s) => s.batchId === 'batch-a').shareCentavos).toBe(1);
  });

  it('shares always add up to the amount', () => {
    const slots = [{ batchId: 'a', heads: 3333 }, { batchId: 'b', heads: 3333 }, { batchId: 'c', heads: 3334 }];
    expect(largestRemainderSplit(1234567, slots).reduce((s, x) => s + x.shareCentavos, 0)).toBe(1234567);
  });
});
