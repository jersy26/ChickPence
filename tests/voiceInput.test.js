import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeSpoken, parseRecord, parseRecords } from '../src/services/logbookParser.js';
import { parseSpokenEntry, draftToFormPrefill, normalizeDrafts } from '../src/services/aiParseService.js';
import { setLlmSettings } from '../src/services/localLlm.js';
import { startDictation, isSpeechSupported, micErrorMessage, createSilenceDetector, cleanTranscript, isVoiceModelCached, SILENCE, buildVoicePrompt, stripPrompt } from '../src/services/speechInput.js';
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

  it('reads the spellings Whisper writes for Filipino numbers', () => {
    // o/u spellings, split and joined words, digits mixed with words
    expect(normalizeSpoken('May tatlung patay')).toBe('meron 3 patay');
    expect(normalizeSpoken('isang daan at limampong kilo')).toBe('150 kg');
    expect(normalizeSpoken('limang pung kilo')).toBe('50 kg');
    expect(normalizeSpoken('walung daan at limampong piso')).toBe('₱850');
    expect(normalizeSpoken('walungdaan piso')).toBe('₱800');
    expect(normalizeSpoken('isang daan at 20 ulo')).toBe('120 ulo');
    expect(normalizeSpoken('2 daan at apatnaput limang kilo')).toBe('245 kg');
    expect(normalizeSpoken('dalawang daan at apat na put limang kilo')).toBe('245 kg');
    expect(normalizeSpoken('tig isang daan at labing walo kada kilo')).toBe('@118/kg');
    expect(normalizeSpoken('sampong sako')).toBe('10 sako');
    // -ng said as -m before p/b, as Whisper wrote it through the microphone
    expect(normalizeSpoken('May tatlumpatay sa batch siyam kahapon')).toBe('meron 3 patay sa batch 9 kahapon');
    expect(normalizeSpoken('limam piso')).toBe('₱5');
    expect(normalizeSpoken('limampung piso')).toBe('₱50');
    expect(normalizeSpoken('tatlumpu')).toBe('30');
  });

  it('keeps a polite "po", "wala" and separate amounts as they are', () => {
    expect(normalizeSpoken('apat na po ang patay')).toBe('4 na po ang patay');
    expect(normalizeSpoken('wala pong patay')).toBe('wala pong patay');
    expect(normalizeSpoken('120 heads at 245 kg')).toBe('120 heads at 245 kg');
    expect(normalizeSpoken('150 at 20')).toBe('150 at 20');
  });

  it('splits "kay" off the words Whisper joins it to', () => {
    expect(normalizeSpoken('Nagbentakay Aling Nena')).toBe('Nagbenta kay Aling Nena');
    expect(normalizeSpoken('nagbenta kayaling Nena')).toBe('nagbenta kay aling Nena');
    expect(normalizeSpoken('5 na matay')).toBe('5 namatay');
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

describe('speechInput (Whisper on this device)', () => {
  afterEach(() => vi.useRealTimers());

  /** Fake browser pieces: mic levels per 100 ms tick, a recorder, decode and Whisper. */
  function fakeMedia({ levels = [], text = 'may tatlong patay', failMic = null, failTranscribe = false } = {}) {
    let clock = 0;
    const calls = { transcribe: [], decode: 0, preload: 0, tracksStopped: 0, meterClosed: 0 };
    class Recorder {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable({ data: new Blob(['x']) });
        this.onstop();
      }
    }
    const media = {
      getUserMedia: async () => {
        if (failMic) throw Object.assign(new Error('denied'), { name: failMic });
        return { getTracks: () => [{ stop: () => calls.tracksStopped++ }] };
      },
      MediaRecorder: Recorder,
      levelMeter: () => ({ level: () => (levels.length ? levels.shift() : 0), close: () => calls.meterClosed++ }),
      decode: async () => { calls.decode++; return new Float32Array(16000); },
      transcribe: async (audio, opts) => {
        calls.transcribe.push(opts);
        if (failTranscribe) throw new Error('model failed');
        return text;
      },
      preload: () => calls.preload++,
      now: () => (clock += 100)
    };
    return { media, calls };
  }

  const speech = (ticks) => Array(ticks).fill(0.08);
  const quiet = (ticks) => Array(ticks).fill(0.002);

  function record(options) {
    vi.useFakeTimers();
    const handlers = { onStatus: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
    const { media, calls } = fakeMedia(options);
    const dictation = startDictation({ lang: 'fil-PH', media, ...handlers });
    return { ...handlers, calls, dictation };
  }

  it('detects support only where the browser can record', () => {
    const win = { navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {}, AudioContext() {}, Worker() {} };
    expect(isSpeechSupported(win)).toBe(true);
    expect(isSpeechSupported({ ...win, navigator: {} })).toBe(false); // plain http on a LAN address has no mediaDevices
    expect(isSpeechSupported({})).toBe(false);
  });

  it('stops by itself after speech and a pause, then reads it on the device', async () => {
    const r = record({ levels: [...quiet(3), ...speech(12), ...quiet(30)] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.onStatus).toHaveBeenCalledWith('Listening… say one entry, then pause.', 'listening');
    expect(r.onStatus).toHaveBeenCalledWith('Turning your voice into text on this device…', 'transcribing');
    expect(r.calls.preload).toBe(1);
    expect(r.calls.decode).toBe(1);
    expect(r.calls.transcribe[0].lang).toBe('fil-PH');
    expect(r.onFinal).toHaveBeenCalledWith('may tatlong patay');
    expect(r.calls.tracksStopped).toBe(1); // the mic is released
    expect(r.calls.meterClosed).toBe(1);
  });

  it('gives up without calling Whisper when nothing is said', async () => {
    const r = record({ levels: quiet(200) });
    await vi.advanceTimersByTimeAsync(SILENCE.noSpeechMs + 500);
    expect(r.onEnd).toHaveBeenCalledTimes(1);
    expect(r.calls.transcribe).toHaveLength(0);
    expect(r.onFinal).not.toHaveBeenCalled();
  });

  it('Stop reads what was recorded, even if it sounded quiet', async () => {
    const r = record({ levels: quiet(200) });
    await vi.advanceTimersByTimeAsync(1000);
    r.dictation.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(r.calls.transcribe).toHaveLength(1);
    expect(r.onFinal).toHaveBeenCalledWith('may tatlong patay');
  });

  it('abort throws the recording away', async () => {
    const r = record({ levels: speech(200) });
    await vi.advanceTimersByTimeAsync(500);
    r.dictation.abort();
    await vi.advanceTimersByTimeAsync(500);
    expect(r.calls.transcribe).toHaveLength(0);
    expect(r.onFinal).not.toHaveBeenCalled();
    expect(r.onEnd).not.toHaveBeenCalled();
    expect(r.calls.tracksStopped).toBe(1);
  });

  it('reports a blocked microphone and a failed model', async () => {
    const blocked = record({ failMic: 'NotAllowedError' });
    await vi.advanceTimersByTimeAsync(100);
    expect(blocked.onError).toHaveBeenCalledWith(expect.stringContaining('Microphone access was blocked'));

    const failed = record({ levels: [...speech(10), ...quiet(30)], failTranscribe: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(failed.onError).toHaveBeenCalledWith('Could not turn the recording into text: model failed');
  });

  it('error messages for missing or busy microphones', () => {
    expect(micErrorMessage({ name: 'NotFoundError' })).toBe('No microphone was found.');
    expect(micErrorMessage({ name: 'NotReadableError' })).toContain('another app');
    expect(micErrorMessage({ name: 'Weird', message: 'x' })).toBe('Could not start the microphone: x');
  });

  it('silence detector: waits for speech, then for a pause; caps long recordings', () => {
    const d = createSilenceDetector({ startLevel: 0.02, endLevel: 0.01, endSilenceMs: 300, noSpeechMs: 1000, maxMs: 2000 });
    expect(d.push(0.001, 0)).toBe('continue');
    expect(d.push(0.05, 100)).toBe('continue');
    expect(d.heard).toBe(true);
    expect(d.push(0.015, 200)).toBe('continue'); // between the levels: still talking
    expect(d.push(0.005, 300)).toBe('continue');
    expect(d.push(0.005, 500)).toBe('continue');
    expect(d.push(0.005, 600)).toBe('stop');

    const never = createSilenceDetector({ startLevel: 0.02, endLevel: 0.01, endSilenceMs: 300, noSpeechMs: 1000, maxMs: 2000 });
    expect(never.push(0, 0)).toBe('continue');
    expect(never.push(0, 1000)).toBe('no-speech');

    const long = createSilenceDetector({ startLevel: 0.02, endLevel: 0.01, endSilenceMs: 300, noSpeechMs: 1000, maxMs: 2000 });
    long.push(0.05, 0);
    expect(long.push(0.05, 2000)).toBe('stop');
  });

  it('cleans Whisper output before the rules read it', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] 3 dead in batch 9 yesterday. ')).toBe('3 dead in batch 9 yesterday');
    expect(cleanTranscript('(music)')).toBe('');
    expect(cleanTranscript('3-Dead in batch 9 yesterday')).toBe('3 Dead in batch 9 yesterday');
    expect(cleanTranscript('ika-26 ng Oktubre, Batch 2026-09')).toBe('ika-26 ng Oktubre, Batch 2026-09');
  });

  it('reads what Whisper wrote for test recordings', async () => {
    // Real whisper-base output for Windows text-to-speech recordings
    const sale = await parseSpokenEntry(cleanTranscript('Sold 120 heads to Alingnina, 245 kilos at 118 pesos per kilo, Batch 9.'), batches, { today });
    expect(sale.entry).toMatchObject({ type: 'sale', quantity_sold: 120, weight_kg: 245, price_per_kg: 118, batch_hint: 'Batch 2026-09', buyer_name: 'Alingnina' });
    const dead = await parseSpokenEntry(cleanTranscript('3 dead in batch 9 yesterday.'), batches, { today });
    expect(dead.entry).toMatchObject({ type: 'mortality', count: 3, date: '2026-10-27', batch_hint: 'Batch 2026-09' });
    // The same sentence as the in-browser run wrote it
    const browser = await parseSpokenEntry(cleanTranscript('3-Dead in batch 9 yesterday'), batches, { today });
    expect(browser.entry).toMatchObject({ type: 'mortality', count: 3, date: '2026-10-27', batch_hint: 'Batch 2026-09' });
  });

  it('gives Whisper a farm-word prompt with the open batches, and strips it from the answer', () => {
    const fil = buildVoicePrompt('fil-PH', ['Batch 2026-07', 'Batch 2026-09', 'Batch 2026-12']);
    expect(fil).toContain('batch pito, batch siyam, batch 12.');
    expect(fil).toContain('kahapon');
    expect(fil).not.toMatch(/Nena|\d{3}/); // no buyers or amounts that could leak into an entry
    expect(buildVoicePrompt('en-PH', ['Batch 2026-09'])).toContain('batch nine.');
    expect(buildVoicePrompt('fil-PH', [])).toMatch(/^Talaan ng manukan\. Namatay/);

    expect(stripPrompt(`${fil} May tatlong patay.`, fil)).toBe('May tatlong patay.');
    expect(stripPrompt(`Talaan ng manukan,${fil.slice(18)} 5 patay`, fil)).toBe('5 patay'); // small changes at the start
    expect(stripPrompt('5 patay', fil)).toBe('5 patay');
    // What whisper-small wrote for silence, hiss and hum: an echo of the prompt, so nothing was said
    expect(stripPrompt(`${fil} Talaan ng manukan.`, fil)).toBe('');
    expect(stripPrompt('Talaan ng manukan', fil)).toBe('');
    expect(stripPrompt('patay', fil)).toBe(''); // a single prompt word alone is not an entry either
  });

  it('passes the open batches through to Whisper', async () => {
    vi.useFakeTimers();
    const { media, calls } = fakeMedia({ levels: [...speech(10), ...quiet(30)] });
    startDictation({ lang: 'fil-PH', batchNames: ['Batch 2026-09'], media, onFinal: () => {} });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.transcribe[0]).toMatchObject({ lang: 'fil-PH', batchNames: ['Batch 2026-09'] });
  });

  it('knows whether the voice model is already downloaded', async () => {
    const win = (urls) => ({ caches: { open: async () => ({ keys: async () => urls.map((url) => ({ url })) }) } });
    const base = 'https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/decoder_model_merged_quantized.onnx';
    expect(await isVoiceModelCached('onnx-community/whisper-base', win([base]))).toBe(true);
    expect(await isVoiceModelCached('onnx-community/whisper-small', win([base]))).toBe(false);
    expect(await isVoiceModelCached('onnx-community/whisper-base', {})).toBe(false);
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

  it('works offline once the voice model is downloaded', () => {
    const offlineNoModel = renderVoiceBar(null, { supported: true, online: false, modelReady: false });
    expect(offlineNoModel).toMatch(/id="btn-voice"[^>]*disabled/);
    expect(offlineNoModel).toContain('after the voice model has been downloaded once');
    expect(renderVoiceBar(null, { supported: true, online: false, modelReady: true })).not.toMatch(/id="btn-voice"[^>]*disabled/);
  });

  it('says the recording stays on the device, and mentions the first download', () => {
    const first = renderVoiceBar(null, { supported: true, online: true, modelReady: false });
    expect(first).toContain('never sent anywhere');
    expect(first).toContain('about 240 MB');
    expect(first).not.toContain('Google');
    expect(renderVoiceBar(null, { supported: true, online: true, modelReady: true })).not.toContain('240 MB');
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
