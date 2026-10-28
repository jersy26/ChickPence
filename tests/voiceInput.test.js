import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeSpoken, parseRecord, parseRecords } from '../src/services/logbookParser.js';
import { parseSpokenEntry, draftToFormPrefill, normalizeDrafts } from '../src/services/aiParseService.js';
import { setLlmSettings } from '../src/services/localLlm.js';
import { startDictation, speechErrorMessage, isSpeechSupported } from '../src/services/speechInput.js';
import { renderBatches, renderVoiceBar } from '../src/ui/batchesView.js';

const today = '2026-10-28';
const batches = ['Batch 2026-08', 'Batch 2026-09'];
const spoken = (s) => parseRecord(normalizeSpoken(s), { today, batches, previousDate: today });

describe('normalizeSpoken', () => {
  it('turns Filipino and English number words into digits', () => {
    expect(normalizeSpoken('tatlong patay')).toBe('3 patay');
    expect(normalizeSpoken('isang daan at limampung kilo')).toBe('150 kg');
    expect(normalizeSpoken('dalawang libo limang daan')).toBe('2500');
    expect(normalizeSpoken("dalawampu't lima")).toBe('25');
    expect(normalizeSpoken('labing-dalawa')).toBe('12');
    expect(normalizeSpoken('apat na raan')).toBe('400');
    expect(normalizeSpoken('one hundred twenty heads')).toBe('120 heads');
    expect(normalizeSpoken('12k')).toBe('12000');
  });

  it('rewrites prices, pesos and spoken dates into logbook wording', () => {
    expect(normalizeSpoken('118 pesos per kilo')).toBe('118/kg');
    expect(normalizeSpoken('tig 118')).toBe('@118');
    expect(normalizeSpoken('850 pesos')).toBe('₱850');
    expect(normalizeSpoken('12,500 piso')).toBe('₱12500');
    expect(normalizeSpoken('ika-26 ng Oktubre')).toBe('Oktubre 26');
    expect(normalizeSpoken('October 26th')).toBe('October 26');
    expect(normalizeSpoken('batch 2026 9')).toBe('Batch 2026-09');
  });

  it('does not read a spoken "may 3 patay" as May 3', () => {
    expect(normalizeSpoken('May tatlong patay')).toBe('meron 3 patay');
  });

  it('does not join a weight and a "1 kg" price into one number', () => {
    expect(normalizeSpoken('2451 kg')).toBe('2451 kg');
  });
});

describe('spoken entries through the rules', () => {
  it('reads mortality in Filipino word order', () => {
    expect(spoken('May tatlong patay sa batch 9 kahapon')).toMatchObject({ type: 'mortality', count: 3, date: '2026-10-27', batch_hint: 'Batch 2026-09' });
    expect(spoken('tatlo ang namatay sa batch nine')).toMatchObject({ type: 'mortality', count: 3, date: today });
    expect(spoken('patay sa batch 8 ay lima')).toMatchObject({ type: 'mortality', count: 5, batch_hint: 'Batch 2026-08' });
    expect(spoken('October 26th, 4 chickens died in batch 8')).toMatchObject({ type: 'mortality', count: 4, date: '2026-10-26' });
  });

  it('never counts the batch number as deaths', () => {
    expect(spoken('batch 9 patay')).toMatchObject({ type: 'mortality', count: null, uncertain_fields: ['count'] });
  });

  it('reads feed eaten, including sacks', () => {
    expect(spoken('nagpakain ng isang daan at limampung kilo sa batch 2026 09')).toMatchObject({ type: 'feed', quantity_kg: 150, batch_hint: 'Batch 2026-09' });
    expect(spoken('kumain ang batch 8 ng tatlong sako')).toMatchObject({ type: 'feed', quantity_kg: 150, uncertain_fields: ['quantity_kg'] });
  });

  it('reads costs with and without the word pesos', () => {
    expect(spoken('bumili ng vitamins 850 pesos')).toMatchObject({ type: 'expense', other_amount: 850, feed_amount: null });
    expect(spoken('nagbayad ng kuryente dalawang libo limang daan')).toMatchObject({ type: 'expense', other_amount: 2500 });
    expect(spoken('feeds 12,500 pesos kahapon')).toMatchObject({ type: 'expense', feed_amount: 12500, date: '2026-10-27' });
    expect(spoken('bought feeds 5 sacks 12500')).toMatchObject({ type: 'expense', feed_amount: 12500 });
  });

  it('reads sales where "at" means "and"', () => {
    expect(spoken('nagbenta kay Aling Nena ng 120 heads at 245 kilos, 118 pesos per kilo, batch 9')).toMatchObject({
      type: 'sale', buyer_name: 'Aling Nena', quantity_sold: 120, weight_kg: 245, price_per_kg: 118, batch_hint: 'Batch 2026-09'
    });
    expect(spoken('sold 80 birds to Mang Jose 160 kilos at 120 per kilo')).toMatchObject({
      type: 'sale', buyer_name: 'Mang Jose', quantity_sold: 80, weight_kg: 160, price_per_kg: 120
    });
    expect(spoken('ika-26 ng Oktubre benta kay Ka Berto isang daang ulo 200 kilo tig 118')).toMatchObject({
      type: 'sale', date: '2026-10-26', buyer_name: 'Ka Berto', quantity_sold: 100, weight_kg: 200, price_per_kg: 118
    });
  });

  it('returns null for something that is not an entry', () => {
    expect(spoken('hello there')).toBeNull();
  });

  it('still reads written logbook lines the same way', () => {
    const { entries, unparsed } = parseRecords(
      ['Okt 27  B-07  benta Aling Nena 120 hds 245.5 kg @118/kg', 'Batch 2026-09  patay 4', 'Okt 26 vitamins + kuryente P850'],
      { today, batches: ['Batch 2026-07', 'Batch 2026-09'] }
    );
    expect(unparsed).toEqual([]);
    expect(entries[0]).toMatchObject({ type: 'sale', buyer_name: 'Aling Nena', quantity_sold: 120, weight_kg: 245.5, price_per_kg: 118 });
    expect(entries[1]).toMatchObject({ type: 'mortality', count: 4 });
    expect(entries[2]).toMatchObject({ type: 'expense', other_amount: 850 });
  });
});

describe('parseSpokenEntry', () => {
  afterEach(() => { vi.unstubAllGlobals(); setLlmSettings(null); });

  it('uses the rules without calling the local AI', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await parseSpokenEntry('may tatlong patay kahapon', batches, { today });
    expect(result.source).toBe('rules');
    expect(result.entry).toMatchObject({ type: 'mortality', count: 3, date: '2026-10-27', source_text: 'may tatlong patay kahapon' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says why when the rules fail and the local AI is off', async () => {
    setLlmSettings({ url: 'http://localhost:11434', ocrModel: 'glm-ocr', textModel: 'qwen3.5:4b' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const result = await parseSpokenEntry('nawala ang tatlong manok', batches, { today });
    expect(result.entry).toBeNull();
    expect(result.notes).toContain('not running');
  });

  it('falls back to the local AI, keeps one entry and dates it today', async () => {
    setLlmSettings({ url: 'http://localhost:11434', ocrModel: 'glm-ocr', textModel: 'qwen3.5:4b' });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'glm-ocr:latest' }, { name: 'qwen3.5:4b' }] }) };
      return {
        ok: true,
        json: async () => ({ message: { content: JSON.stringify({
          entries: [
            { line: 1, type: 'mortality', date: null, batch_hint: null, count: 3, confidence: 0.6, uncertain_fields: [] },
            { line: 1, type: 'feed', date: null, batch_hint: null, quantity_kg: 5, confidence: 0.6, uncertain_fields: [] }
          ],
          notes: ''
        }) } })
      };
    }));
    const result = await parseSpokenEntry('nawala ang tatlong manok', batches, { today });
    expect(result.source).toBe('ai');
    expect(result.entry).toMatchObject({ type: 'mortality', count: 3, date: today });
    expect(result.notes).toContain('Only the first entry');
  });
});

describe('draftToFormPrefill', () => {
  const openBatches = [{ batch_id: 'b8', batch_name: 'Batch 2026-08' }, { batch_id: 'b9', batch_name: 'Batch 2026-09' }];
  const prefillFor = (s) => draftToFormPrefill(normalizeDrafts([spoken(s)], openBatches)[0]);

  it('maps each entry type to its tab and stored-record fields', () => {
    expect(prefillFor('feeds 12,500 pesos')).toMatchObject({ tab: 'Expenses', values: { entry_date: today, feed_centavos: 1250000, other_centavos: null } });
    expect(prefillFor('nagpakain ng 150 kilo sa batch 9')).toMatchObject({ tab: 'Feed', batch_id: 'b9', values: { quantity_kg: 150 } });
    expect(prefillFor('3 patay sa batch 8')).toMatchObject({ tab: 'Mortality', batch_id: 'b8', values: { count: 3 }, uncertain: [] });
    expect(prefillFor('sold 80 birds to Mang Jose 160 kilos at 120 per kilo batch 9')).toMatchObject({
      tab: 'Sales', batch_id: 'b9',
      values: { sale_date: today, buyer_name: 'Mang Jose', quantity_sold: 80, weight_kg: 160, price_per_kg: 120 }
    });
  });

  it('flags the batch when it was not said and several are open', () => {
    expect(prefillFor('3 patay')).toMatchObject({ batch_id: null, uncertain: ['batch_id'] });
  });
});

describe('speechInput', () => {
  class FakeRecognition {
    static last = null;
    constructor() { FakeRecognition.last = this; this.started = false; }
    start() { this.started = true; }
    stop() { this.onend?.(); }
    say(pieces) {
      // pieces: [[text, isFinal], ...]
      const results = pieces.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
      this.onresult?.({ results });
    }
  }
  const win = { webkitSpeechRecognition: FakeRecognition };

  it('detects support', () => {
    expect(isSpeechSupported(win)).toBe(true);
    expect(isSpeechSupported({})).toBe(false);
  });

  it('reports interim text and the final transcript', () => {
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    startDictation({ lang: 'fil-PH', onInterim, onFinal, win });
    const rec = FakeRecognition.last;
    expect(rec.started).toBe(true);
    expect(rec.lang).toBe('fil-PH');
    rec.say([['may tatlong', false]]);
    rec.say([['may tatlong patay', true]]);
    rec.onend();
    expect(onInterim).toHaveBeenLastCalledWith('may tatlong patay');
    expect(onFinal).toHaveBeenCalledWith('may tatlong patay');
  });

  it('keeps interim words when stopped early', () => {
    const onFinal = vi.fn();
    const { stop } = startDictation({ onFinal, win });
    FakeRecognition.last.say([['benta kay Nena', false]]);
    stop();
    expect(onFinal).toHaveBeenCalledWith('benta kay Nena');
  });

  it('reports errors once and stays quiet on abort', () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    startDictation({ onError, onEnd, win });
    FakeRecognition.last.onerror({ error: 'network' });
    FakeRecognition.last.onend();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('needs internet'));
    expect(onEnd).not.toHaveBeenCalled();
    expect(speechErrorMessage('aborted')).toBeNull();
  });

  it('says so when the browser has no speech recognition', () => {
    const onError = vi.fn();
    startDictation({ onError, win: {} });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });
});

describe('voice bar and prefilled form', () => {
  const batchData = [{
    batch: { batch_id: 'b9', batch_name: 'Batch 2026-09', start_date: '2026-09-01', initial_chick_count: 10000, chick_cost: 0, status: 'Open' },
    feed: [], mortality: [], sales: [], allocations: []
  }];

  it('hides the mic without speech support but keeps the typed sentence', () => {
    const html = renderVoiceBar(null, { supported: false });
    expect(html).not.toContain('btn-voice"');
    expect(html).toContain('id="voice-transcript"');
    expect(renderVoiceBar(null, { supported: true })).toContain('id="btn-voice"');
  });

  it('disables the mic offline', () => {
    expect(renderVoiceBar(null, { supported: true, online: false })).toMatch(/id="btn-voice"[^>]*disabled/);
  });

  it('escapes the transcript and message', () => {
    const html = renderVoiceBar({ transcript: '"><img src=x>', message: '<b>hi</b>' }, { supported: false });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>hi');
  });

  it('prefills the form as a new entry and highlights fields to check', () => {
    const voice = {
      transcript: 'benta kay Nena',
      prefill: { tab: 'Sales', batch_id: 'b9', uncertain: ['quantity_sold'], values: { sale_date: today, buyer_name: 'Nena', quantity_sold: null, weight_kg: 245, price_per_kg: 118 } }
    };
    const html = renderBatches(batchData, [], 'b9', 'Sales', null, null, new Set(), 15, null, voice);
    expect(html).toContain('New Sale');
    expect(html).not.toContain('Editing entry');
    expect(html).toMatch(/id="input-sale-buyer"[^>]*value="Nena"/);
    expect(html).toMatch(/id="input-sale-kg"[^>]*value="245"/);
    expect(html).toMatch(/id="input-sale-qty" type="number" class="is-uncertain"/);
    expect(html).toMatch(/id="input-sale-qty"[^>]*value=""/);
  });

  it('ignores a prefill made for another tab, and hides voice while editing', () => {
    const voice = { prefill: { tab: 'Sales', batch_id: 'b9', uncertain: [], values: { buyer_name: 'Nena' } } };
    expect(renderBatches(batchData, [], 'b9', 'Feed', null, null, new Set(), 15, null, voice)).not.toContain('value="Nena"');
    const editing = { feed_log_id: 'f1', entry_date: today, quantity_g: 5000 };
    const html = renderBatches(batchData, [], 'b9', 'Feed', editing, null, new Set(), 15, null, voice);
    expect(html).not.toContain('voice-bar');
    expect(html).toMatch(/id="input-feed-kg"[^>]*value="5.000"/);
  });
});
