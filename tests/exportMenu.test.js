import { describe, it, expect } from 'vitest';
import { renderExportModal, renderExportButton } from '../src/ui/exportMenu.js';
import { renderHistory } from '../src/ui/historyView.js';

const batches = [
  { batch_id: 'b3', batch_name: 'Batch 2026-09', status: 'Open', start_date: '2026-09-01' },
  { batch_id: 'b2', batch_name: 'Batch 2026-06', status: 'Closed', start_date: '2026-06-01' },
  { batch_id: 'b1', batch_name: 'Batch 2026-04', status: 'Closed', start_date: '2026-04-02' }
];

describe('Export modal', () => {
  it('offers a detailed batch report and the whole history', () => {
    const html = renderExportModal(batches);
    expect(html).toContain('value="batch" checked');
    expect(html).toContain('Detailed batch report');
    expect(html).toContain('value="history"');
    expect(html).toContain('All 3 batches');
  });

  it('lists every batch in the picker and preselects the newest by default', () => {
    const html = renderExportModal(batches);
    expect(html.match(/<option /g)).toHaveLength(3);
    expect(html).toMatch(/value="b3" selected/);
  });

  it('preselects the batch being viewed', () => {
    const html = renderExportModal(batches, 'b2');
    expect(html).toMatch(/value="b2" selected/);
    expect(html).not.toMatch(/value="b3" selected/);
  });

  it('offers Excel, PDF and CSV with Excel as the default', () => {
    const html = renderExportModal(batches);
    expect(html).toContain('value="xlsx" checked');
    expect(html).toContain('value="pdf"');
    expect(html).toContain('value="csv"');
  });
});

describe('Export button', () => {
  it('renders one Export button per scope', () => {
    expect(renderExportButton('history')).toContain('data-export-open="history"');
  });

  it('shows on History even when the filter hides every batch', () => {
    const data = [{ batch: { ...batches[1], initial_chick_count: 1000, chick_cost: 0 }, feed: [], mortality: [], sales: [], allocations: [] }];
    const html = renderHistory(data, 'no-match', 'All');
    expect(html).toContain('data-export-open="history"');
  });

  it('is hidden when there are no batches at all', () => {
    expect(renderHistory([], '', 'All')).not.toContain('data-export-open');
  });
});
