/**
 * compareView.test.js
 * Compare batches shows every summary measure for each batch (FR-20, AC-14).
 */

import { describe, it, expect } from 'vitest';
import { renderCompare } from '../src/ui/operationsView.js';

const item = (id, status, sales = []) => ({
  batch: { batch_id: id, batch_name: id, start_date: '2026-01-01', end_date: status === 'Closed' ? '2026-03-01' : null, status, initial_chick_count: 1000, chick_cost: 45000 },
  allocations: [{ expense_id: 'e1', batch_id: id, feed_centavos: 7500000, other_centavos: 600000 }],
  sales,
  mortality: [{ mortality_id: `${id}-m`, batch_id: id, entry_date: '2026-01-20', count: 40 }],
  feed: [{ feed_log_id: `${id}-f`, batch_id: id, entry_date: '2026-02-01', quantity_g: 3920000 }]
});

describe('Compare batches', () => {
  const closedH = item('Batch H', 'Closed', [
    { sale_id: 's1', batch_id: 'Batch H', sale_date: '2026-02-15', quantity_sold: 600, weight_kg: 1260, price_per_kg: 95 },
    { sale_id: 's2', batch_id: 'Batch H', sale_date: '2026-02-16', quantity_sold: 320, weight_kg: 700, price_per_kg: 90 }
  ]);
  const openNoSales = item('Batch J', 'Open');
  const html = renderCompare([closedH, openNoSales], ['Batch H', 'Batch J']);

  it('lists every measure of the batch summary', () => {
    for (const label of ['Total recorded cost', 'Revenue', 'Net profit or loss', 'Profit margin', 'Cost per kg',
      'Profit per kg', 'Mortality rate', 'Sales-based FCR', 'Return on batch cost']) {
      expect(html).toContain(label);
    }
  });

  it('matches the Batch H hand calculation (Table 19)', () => {
    expect(html).toContain('31.03%');
    expect(html).toContain('45.00%');
    expect(html).toContain('4.00%');
    expect(html).toContain('2.00');
  });

  it('labels each batch final or provisional', () => {
    expect(html).toContain('Final');
    expect(html).toContain('Provisional');
  });

  it('shows "Not available" where a batch has no sales, never 0.0%', () => {
    expect(html).toContain('Not available');
    expect(html).not.toContain('0.0%');
  });
});
