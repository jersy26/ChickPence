import { describe, it, expect } from 'vitest';
import { renderBatches, renderBatchToggleIcon } from '../src/ui/batchesView.js';
import { renderDashboard } from '../src/ui/dashboardView.js';

describe('Minimize / Maximize Batch Toggle', () => {
  const mockBatch = {
    batch_id: 'test-batch-1',
    batch_name: 'Batch 2026-07',
    start_date: '2026-07-01',
    initial_chick_count: 10000,
    chick_cost: 550000,
    status: 'Open'
  };

  const mockBatchData = [
    {
      batch: mockBatch,
      feed: [],
      mortality: [],
      sales: [],
      allocations: []
    }
  ];

  it('renders minus icon for minimize when not collapsed, and plus icon for maximize when collapsed', () => {
    const minIcon = renderBatchToggleIcon(false);
    const maxIcon = renderBatchToggleIcon(true);

    expect(minIcon).toContain('<svg');
    expect(minIcon).toContain('<line x1="5" y1="12" x2="19" y2="12"');
    // plus icon has two lines (horizontal and vertical)
    expect(maxIcon).toContain('<line x1="12" y1="5" x2="12" y2="19"');
    expect(maxIcon).toContain('<line x1="5" y1="12" x2="19" y2="12"');
  });

  it('renders minimize button before batch name in Open Batches view when expanded', () => {
    const html = renderBatches(mockBatchData, [], 'test-batch-1', 'Expenses', null, null, new Set());

    // Button exists with data-action and correct attributes
    expect(html).toContain('data-action="toggle-batch-collapse"');
    expect(html).toContain('data-batch-id="test-batch-1"');
    expect(html).toContain('title="Minimize"');
    expect(html).toContain('aria-expanded="true"');

    // Button is positioned before batch name
    const buttonPos = html.indexOf('data-action="toggle-batch-collapse"');
    const namePos = html.indexOf('Batch 2026-07');
    expect(buttonPos).toBeGreaterThan(-1);
    expect(namePos).toBeGreaterThan(-1);
    expect(buttonPos).toBeLessThan(namePos);

    // Body is visible
    expect(html).toContain('id="batch-body-test-batch-1"');
    expect(html).not.toContain('id="batch-body-test-batch-1" style="display: none;"');
  });

  it('renders maximize button before batch name in Open Batches view when collapsed', () => {
    const collapsedSet = new Set(['test-batch-1']);
    const html = renderBatches(mockBatchData, [], 'test-batch-1', 'Expenses', null, null, collapsedSet);

    expect(html).toContain('data-action="toggle-batch-collapse"');
    expect(html).toContain('data-batch-id="test-batch-1"');
    expect(html).toContain('title="Maximize"');
    expect(html).toContain('aria-expanded="false"');

    // Body is hidden with display: none
    expect(html).toContain('id="batch-body-test-batch-1" style="display: none;"');
  });

  it('renders minimize button before batch name in Dashboard Open Batches card', () => {
    const html = renderDashboard(mockBatchData, [], new Set());

    expect(html).toContain('data-action="toggle-dash-batch-collapse"');
    expect(html).toContain('data-batch-id="test-batch-1"');
    expect(html).toContain('title="Minimize"');
    expect(html).toContain('aria-expanded="true"');

    // Button is positioned before the batch name heading within its own card
    // (searched from the button's position, since the Dashboard may also
    // mention the batch name earlier on the page, e.g. in a warnings panel)
    const buttonPos = html.indexOf('data-action="toggle-dash-batch-collapse"');
    const namePos = html.indexOf('Batch 2026-07', buttonPos);
    expect(buttonPos).toBeLessThan(namePos);
  });
});
