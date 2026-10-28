import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderDashboard } from '../src/ui/dashboardView.js';
import { renderBatches } from '../src/ui/batchesView.js';
import { renderHistory } from '../src/ui/historyView.js';
import { renderSummary } from '../src/ui/summaryView.js';
import { renderExportModal } from '../src/ui/exportMenu.js';
import { escapeHtml } from '../src/ui/importReviewModal.js';
import { localToday } from '../src/services/calculations.js';

// Batch and buyer names reach the page from other devices (sync), imported
// files and the local AI, so markup in them must show as text, never run.
const evil = '<img src=x onerror="alert(1)">';
const batch = {
  batch_id: 'b1',
  batch_name: `Batch ${evil}`,
  start_date: '2026-10-01',
  initial_chick_count: 1000,
  chick_cost: 55000,
  mortality_threshold_pct: 5,
  status: 'Open'
};
const sale = {
  sale_id: 's1',
  batch_id: 'b1',
  sale_date: '2026-10-20',
  buyer_name: evil,
  quantity_sold: 10,
  weight_kg: 20,
  price_per_kg: 100,
  total_amount: 2000
};
const batchData = { batch, feed: [], mortality: [{ mortality_id: 'm1', batch_id: 'b1', entry_date: '2026-10-02', count: 90 }], sales: [sale], allocations: [] };

const noMarkupFromData = (html) => {
  expect(html).not.toContain('<img');
  expect(html).not.toMatch(/onerror="alert/);
};

describe('names from records are escaped', () => {
  it('Dashboard: batch cards and mortality warnings', () => {
    const html = renderDashboard([batchData], [{ ...batchData, batch: { ...batch, batch_id: 'b2', status: 'Closed' } }], new Set());
    noMarkupFromData(html);
    expect(html).toContain('Batch &lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('Open Batches: batch cards, batch picker and the sales table', () => {
    noMarkupFromData(renderBatches([batchData], [], 'b1', 'Sales', null, null));
  });

  it('Open Batches: editing a sale puts the buyer name in a value attribute, escaped', () => {
    const html = renderBatches([batchData], [], 'b1', 'Sales', sale, null);
    noMarkupFromData(html);
    expect(html).toContain('value="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"');
  });

  it('Open Batches: allocation preview rows', () => {
    const preview = { rows: [{ batchName: batch.batch_name, feedShare: 10, otherShare: 2 }], values: { entry_date: '2026-10-20', feed_centavos: 1000, other_centavos: 200 } };
    noMarkupFromData(renderBatches([batchData], [], 'b1', 'Expenses', null, preview));
  });

  it('History: batch names and the search text', () => {
    const html = renderHistory([batchData], '"><img src=x>', 'All');
    expect(html).not.toContain('<img');
    expect(html).toContain('value="&quot;&gt;&lt;img src=x&gt;"');
  });

  it('Batch Summary: title and sales table', () => {
    noMarkupFromData(renderSummary(batchData));
  });

  it('Export: batch picker', () => {
    noMarkupFromData(renderExportModal([batch], 'b1'));
  });

  it('escapeHtml is still importable from the review modal', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('entry form dates', () => {
  afterEach(() => vi.useRealTimers());

  it('today is the date on this device, not the UTC date (still yesterday before 8 AM here)', () => {
    const morning = new Date(2026, 9, 29, 6, 30); // 6:30 AM on Oct 29, local time
    expect(morning.toISOString().slice(0, 10)).toBe('2026-10-28');
    expect(localToday(morning)).toBe('2026-10-29');
  });

  it('new entries and new batches start on today’s local date, read when the page is drawn', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29, 6, 30));
    const html = renderBatches([batchData], [], 'b1', 'Mortality', null, null);
    expect(html).toMatch(/id="input-mort-date"[^>]*value="2026-10-29"/);
    expect(html).toMatch(/id="new-batch-start"[^>]*value="2026-10-29"/);

    // Left open past midnight: the next drawing uses the new day
    vi.setSystemTime(new Date(2026, 9, 30, 0, 5));
    expect(renderBatches([batchData], [], 'b1', 'Mortality', null, null)).toMatch(/id="input-mort-date"[^>]*value="2026-10-30"/);
  });
});

describe('expense allocation preview', () => {
  const values = { entry_date: '2026-10-20', feed_centavos: 50000, other_centavos: 10000 };

  it('the redrawn form keeps the date and amounts the preview was made for', () => {
    const html = renderBatches([batchData], [], 'b1', 'Expenses', null, { rows: [{ batchName: 'Batch A', feedShare: 500, otherShare: 100 }], values });
    expect(html).toMatch(/id="input-exp-date"[^>]*value="2026-10-20"/);
    expect(html).toMatch(/id="input-exp-feed"[^>]*value="500.00"/);
    expect(html).toMatch(/id="input-exp-other"[^>]*value="100.00"/);
    expect(html).toMatch(/id="btn-save-expense"[^>]*>\s*Save Expense/);
    expect(html).not.toMatch(/id="btn-save-expense"[^>]*disabled/);
  });

  it('with no batch active that day, the values stay but Save stays off', () => {
    const html = renderBatches([batchData], [], 'b1', 'Expenses', null, { rows: null, values });
    expect(html).toMatch(/id="input-exp-feed"[^>]*value="500.00"/);
    expect(html).toMatch(/id="btn-save-expense"[^>]*disabled/);
  });
});
