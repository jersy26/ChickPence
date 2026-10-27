import { describe, it, expect } from 'vitest';
import {
  normalizeDrafts,
  validateDraft,
  draftToSave,
  matchBatch,
  localToday,
  LOW_CONFIDENCE
} from '../src/services/aiParseService.js';
import { renderImportReviewModal, escapeHtml } from '../src/ui/importReviewModal.js';
import { renderScanActions } from '../src/ui/batchesView.js';

const openBatches = [
  { batch_id: 'b1', batch_name: 'Batch 2026-08' },
  { batch_id: 'b2', batch_name: 'Batch 2026-09' }
];

const base = {
  date: '2026-10-27', batch_hint: null,
  feed_amount: null, other_amount: null, quantity_kg: null, count: null,
  buyer_name: null, quantity_sold: null, weight_kg: null, price_per_kg: null,
  source_text: '', confidence: 0.9, uncertain_fields: []
};

describe('normalizeDrafts', () => {
  it('matches batch hints to open batches', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'mortality', count: 3, batch_hint: 'batch 2026-09' }], openBatches);
    expect(d.batch_id).toBe('b2');
    expect(d.uncertain.size).toBe(0);
  });

  it('flags the batch when it cannot be matched', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'feed', quantity_kg: 50 }], openBatches);
    expect(d.batch_id).toBeNull();
    expect(d.uncertain.has('batch_id')).toBe(true);
  });

  it('defaults to the only open batch', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'feed', quantity_kg: 50 }], [openBatches[0]]);
    expect(d.batch_id).toBe('b1');
  });

  it('flags missing required fields and keeps AI-flagged ones', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'sale', batch_hint: 'Batch 2026-08', buyer_name: 'Aling Nena', quantity_sold: 200, weight_kg: null, price_per_kg: 120, uncertain_fields: ['quantity_sold'] }], openBatches);
    expect(d.uncertain.has('weight_kg')).toBe(true);
    expect(d.uncertain.has('quantity_sold')).toBe(true);
    expect(d.uncertain.has('price_per_kg')).toBe(false);
  });

  it('drops unknown types and invalid dates', () => {
    const drafts = normalizeDrafts([{ ...base, type: 'vaccine' }, { ...base, type: 'expense', other_amount: 500, date: '27/10' }], openBatches);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].date).toBeNull();
    expect(drafts[0].uncertain.has('date')).toBe(true);
  });

  it('never assigns a batch to expenses (they are allocated)', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'expense', feed_amount: 1500, batch_hint: 'Batch 2026-08' }], openBatches);
    expect(d.batch_id).toBeNull();
    expect(d.uncertain.size).toBe(0);
  });

  it('handles a missing entries array', () => {
    expect(normalizeDrafts(undefined, openBatches)).toEqual([]);
  });
});

describe('validateDraft / draftToSave', () => {
  it('requires a positive amount on expenses', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'expense' }], openBatches);
    expect(validateDraft(d)).toContain('feed or other amount');
    d.other_amount = 250;
    expect(validateDraft(d)).toEqual([]);
    expect(draftToSave(d)).toEqual(['saveExpense', { entry_date: '2026-10-27', feed_amount: 0, other_amount: 250 }]);
  });

  it('maps a sale to Repository.saveSale arguments', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'sale', batch_hint: 'Batch 2026-08', buyer_name: 'Mang Jose', quantity_sold: 100, weight_kg: 210.5, price_per_kg: 118 }], openBatches);
    expect(validateDraft(d)).toEqual([]);
    expect(draftToSave(d)).toEqual(['saveSale', {
      batch_id: 'b1', sale_date: '2026-10-27', buyer_name: 'Mang Jose',
      quantity_sold: 100, weight_kg: 210.5, price_per_kg: 118
    }]);
  });

  it('accepts zero deaths but rejects fractions', () => {
    const [d] = normalizeDrafts([{ ...base, type: 'mortality', batch_hint: 'Batch 2026-08', count: 0 }], openBatches);
    expect(validateDraft(d)).toEqual([]);
    d.count = 1.5;
    expect(validateDraft(d)).toContain('death count');
  });
});

describe('helpers', () => {
  it('matchBatch returns null without a hint', () => {
    expect(matchBatch(null, openBatches)).toBeNull();
  });

  it('localToday uses the local calendar date', () => {
    expect(localToday(new Date(2026, 0, 5, 7, 30))).toBe('2026-01-05');
  });
});

describe('Import review modal', () => {
  it('highlights uncertain fields and low confidence', () => {
    const drafts = normalizeDrafts([{ ...base, type: 'feed', quantity_kg: 50, confidence: LOW_CONFIDENCE - 0.1 }], openBatches);
    const html = renderImportReviewModal(drafts, openBatches);
    expect(html).toContain('is-uncertain');
    expect(html).toContain('import-confidence low');
    expect(html).toContain('Choose batch…');
    expect(html).toContain('Save selected');
  });

  it('escapes AI text before rendering it', () => {
    const drafts = normalizeDrafts([{ ...base, type: 'sale', buyer_name: '<img src=x onerror=alert(1)>', source_text: '<b>x</b>' }], openBatches);
    const html = renderImportReviewModal(drafts, openBatches, '<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(escapeHtml('"a"&')).toBe('&quot;a&quot;&amp;');
  });

  it('says so when nothing was found', () => {
    const html = renderImportReviewModal([], openBatches);
    expect(html).toContain('could not find any entries');
    expect(html).not.toContain('btn-confirm-import');
  });
});

describe('Scan logbook action', () => {
  it('is disabled with the reason in Demo Mode', () => {
    const html = renderScanActions({ unavailableReason: 'Needs Supabase', queued: 0, ready: 0 });
    expect(html).toContain('is-disabled');
    expect(html).toContain('title="Needs Supabase"');
    expect(html).not.toContain('btn-review-scans');
  });

  it('shows waiting and ready scans', () => {
    const html = renderScanActions({ unavailableReason: null, queued: 3, ready: 1 });
    expect(html).toContain('Review scanned (1)');
    expect(html).toContain('(2 waiting)');
  });

  it('renders nothing without import state', () => {
    expect(renderScanActions(null)).toBe('');
  });
});
