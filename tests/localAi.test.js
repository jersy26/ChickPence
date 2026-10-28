import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseRecord, parseRecords, parseDate, parseBatch } from '../src/services/logbookParser.js';
import { splitRecords, buildExtractPrompt, extractEntries, extractFromRecords, checkLocalLlm, setLlmSettings } from '../src/services/localLlm.js';
import { renderLocalAiModal } from '../src/ui/localAiModal.js';

const today = '2026-10-28';
const batches = ['Batch 2026-07', 'Batch 2026-09'];
const ctx = { today, batches };

// What glm-ocr returned for a test page (note "Ok+" for "Okt" and "Ø" for "@")
const OCR_TEXT = `Ok+ 26 Batch 2026-09 patay 4
Ok+ 26 feeds 5 sako P12,500
Ok+ 26 vitamins + kuryente P850
Ok+ 27 Batch 2026-07 benta Aling Nena
120 hds 245.5 kg Ø118/kg
Ok+ 27 Batch 2026-09 patuka 150 kg
Ok+ 27 patay 2 (B-07)`;

describe('splitRecords', () => {
  it('joins continuation lines to the record above', () => {
    const records = splitRecords(OCR_TEXT);
    expect(records).toHaveLength(6);
    expect(records[3]).toBe('Ok+ 27 Batch 2026-07 benta Aling Nena 120 hds 245.5 kg Ø118/kg');
  });

  it('skips blank lines', () => {
    expect(splitRecords('\n\nOkt 1 patay 2\n\n')).toEqual(['Okt 1 patay 2']);
  });
});

describe('logbookParser', () => {
  it('reads the whole OCR page correctly', () => {
    const { entries, unparsed } = parseRecords(splitRecords(OCR_TEXT), ctx);
    expect(unparsed).toEqual([]);
    const pick = (e) => {
      const out = { line: e.line, type: e.type, date: e.date, batch: e.batch_hint };
      for (const k of ['feed_amount', 'other_amount', 'quantity_kg', 'count', 'buyer_name', 'quantity_sold', 'weight_kg', 'price_per_kg']) {
        if (e[k] != null) out[k] = e[k];
      }
      return out;
    };
    expect(entries.map(pick)).toEqual([
      { line: 1, type: 'mortality', date: '2026-10-26', batch: 'Batch 2026-09', count: 4 },
      { line: 2, type: 'expense', date: '2026-10-26', batch: null, feed_amount: 12500 },
      { line: 3, type: 'expense', date: '2026-10-26', batch: null, other_amount: 850 },
      { line: 4, type: 'sale', date: '2026-10-27', batch: 'Batch 2026-07', buyer_name: 'Aling Nena', quantity_sold: 120, weight_kg: 245.5, price_per_kg: 118 },
      { line: 5, type: 'feed', date: '2026-10-27', batch: 'Batch 2026-09', quantity_kg: 150 },
      { line: 6, type: 'mortality', date: '2026-10-27', batch: 'Batch 2026-07', count: 2 }
    ]);
    expect(entries.every((e) => e.uncertain_fields.length === 0)).toBe(true);
  });

  it('dates: months in Filipino and English, M/D, kahapon, and no future dates', () => {
    expect(parseDate('Set 3 patay 1', today)).toBe('2026-09-03');
    expect(parseDate('Nov 2 patay 1', today)).toBe('2025-11-02'); // would be in the future
    expect(parseDate('10/27 benta', today)).toBe('2026-10-27');
    expect(parseDate('kahapon patay 3', today)).toBe('2026-10-27');
    expect(parseDate('may 3 patay', today)).toBe('2026-05-03');
    expect(parseDate('Okt 27 may 3 patay', today)).toBe('2026-10-27');
    expect(parseDate('patay 3', today)).toBeNull();
  });

  it('batches: full names, short forms, and ambiguity', () => {
    expect(parseBatch('Batch 2026-09 patay 4', batches)).toBe('Batch 2026-09');
    expect(parseBatch('patay 2 (B-07)', batches)).toBe('Batch 2026-07');
    expect(parseBatch('batch 9 patuka 100 kg', batches)).toBe('Batch 2026-09');
    expect(parseBatch('B-07', ['Batch 2025-07', 'Batch 2026-07'])).toBeNull();
    expect(parseBatch('patay 2', batches)).toBeNull();
  });

  it('inherits the date from the line above', () => {
    const { entries } = parseRecords(['Okt 26 patay 2', 'vitamins P300'], ctx);
    expect(entries[1].date).toBe('2026-10-26');
    expect(entries[1].uncertain_fields).toEqual([]);
  });

  it('converts sacks to kg and flags it', () => {
    const e = parseRecord('Okt 27 B-09 patuka 3 sako', ctx);
    expect(e).toMatchObject({ type: 'feed', quantity_kg: 150, uncertain_fields: ['quantity_kg'] });
  });

  it('flags missing sale fields and lowers confidence', () => {
    const e = parseRecord('Okt 27 B-07 benta Mang Jose 50 hds', ctx);
    expect(e.type).toBe('sale');
    expect(e.uncertain_fields).toEqual(['weight_kg', 'price_per_kg']);
    expect(e.confidence).toBeLessThan(0.7);
  });

  it('returns null for lines it does not recognise', () => {
    expect(parseRecord('Okt 27 nilinis ang kulungan', ctx)).toBeNull();
  });
});

describe('extractEntries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not call the model when the rules read every line', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await extractEntries(OCR_TEXT, ctx);
    expect(result.entries).toHaveLength(6);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only unrecognised lines to the local model, keeping their numbers', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.format).toBeTruthy();
      expect(body.think).toBe(false);
      expect(body.messages[1].content).toContain('2. Okt 27 tatlong manok ang nawala');
      expect(body.messages[1].content).not.toContain('1. Okt 27 patay 2');
      return {
        ok: true,
        json: async () => ({ message: { content: JSON.stringify({
          entries: [{ line: 2, type: 'mortality', date: '2026-10-27', batch_hint: null, count: 3, confidence: 0.6, uncertain_fields: ['count'] }],
          notes: ''
        }) } })
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await extractEntries('Okt 27 patay 2\nOkt 27 tatlong manok ang nawala', ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.entries.map((e) => [e.line, e.type, e.count])).toEqual([[1, 'mortality', 2], [2, 'mortality', 3]]);
    expect(result.entries[1].source_text).toBe('Okt 27 tatlong manok ang nawala');
  });

  it('keeps spreadsheet rows apart (no date needed to start a record)', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.messages[1].content).toContain('1. nilinis ang kulungan');
      expect(body.messages[1].content).toContain('2. tatlong manok ang nawala sa batch 9');
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({
        entries: [{ line: 2, type: 'mortality', date: null, batch_hint: 'Batch 2026-09', count: 3, confidence: 0.6, uncertain_fields: ['date'] }],
        notes: ''
      }) } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await extractFromRecords(['nilinis ang kulungan', 'tatlong manok ang nawala sa batch 9'], ctx);
    expect(result.records).toHaveLength(2);
    expect(result.entries.map((e) => [e.line, e.type, e.source_text])).toEqual([[2, 'mortality', 'tatlong manok ang nawala sa batch 9']]);
    expect(result.notes).toContain('"nilinis ang kulungan"');
  });

  it('lists lines neither the rules nor the model could use', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ message: { content: '{"entries":[],"notes":""}' } }) })));
    const result = await extractEntries('Okt 27 nilinis ang kulungan', ctx);
    expect(result.entries).toEqual([]);
    expect(result.notes).toContain('nilinis ang kulungan');
  });
});

describe('checkLocalLlm', () => {
  afterEach(() => { vi.unstubAllGlobals(); setLlmSettings(null); });

  it('reports a missing model with the pull command', async () => {
    setLlmSettings({ url: 'http://localhost:11434', ocrModel: 'glm-ocr', textModel: 'qwen3.5:4b' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'glm-ocr:latest' }] }) })));
    const r = await checkLocalLlm({ force: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ollama pull qwen3.5:4b');
  });

  it('reports when Ollama is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const r = await checkLocalLlm({ force: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('not running');
  });
});

describe('prompts and settings modal', () => {
  it('buildExtractPrompt keeps original numbering when filtering', () => {
    const p = buildExtractPrompt(['a', 'b', 'c'], ctx, [3]);
    expect(p).toContain('3. c');
    expect(p).not.toContain('1. a');
    expect(p).toContain('- Batch 2026-09');
  });

  it('renders model dropdowns once models are known', () => {
    const s = { url: 'http://localhost:11434', ocrModel: 'glm-ocr', textModel: 'qwen3.5:4b' };
    expect(renderLocalAiModal(s)).toContain('id="input-llm-ocr" type="text"');
    const html = renderLocalAiModal(s, ['glm-ocr:latest', 'qwen3.5:4b']);
    expect(html).toMatch(/<option value="glm-ocr:latest" selected>/);
    expect(html).toMatch(/<option value="qwen3.5:4b" selected>/);
  });

  it('lets the user pick the Whisper model for voice typing', () => {
    const s = { url: 'http://localhost:11434', ocrModel: 'glm-ocr', textModel: 'qwen3.5:4b' };
    expect(renderLocalAiModal(s)).toMatch(/<option value="onnx-community\/whisper-small" selected>/);
    const html = renderLocalAiModal(s, null, 'onnx-community/whisper-base');
    expect(html).toMatch(/<option value="onnx-community\/whisper-base" selected>/);
    expect(html).toContain('never leaves the device');
    expect(renderLocalAiModal(s, null, undefined, 'manual')).toMatch(/<option value="manual" selected>/);
    expect(renderLocalAiModal(s)).toMatch(/<option value="auto" selected>/);
  });
});
