import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// In-memory stand-in for the Dexie ai_insights table
const store = new Map();
vi.mock('../src/db/dexie.js', () => ({
  db: {
    ai_insights: {
      get: async (k) => store.get(k),
      put: async (r) => { store.set(r.scope, r); }
    }
  }
}));

const {
  mortalityTrend,
  compareWith,
  trendCheck,
  suggestableFacts,
  buildDashboardFacts,
  buildBatchFacts,
  factsHash,
  buildInsightsSchema,
  buildInsightsPrompt,
  normalizeSuggestions,
  generateSuggestions,
  getSuggestionsMode,
  setSuggestionsMode,
  loadInsights,
  onInsightsChange
} = await import('../src/services/insightsService.js');
const { setLlmSettings } = await import('../src/services/localLlm.js');
const { renderInsightsCard } = await import('../src/ui/insightsCard.js');

const today = '2026-10-28';

function batchData(id, name, { status = 'Closed', start, end = null, chicks = 1000, chickCost = 40000, feedKg = 3000, deaths = [], sales = [], feedPeso = 90000, otherPeso = 10000 }) {
  return {
    batch: { batch_id: id, batch_name: name, status, start_date: start, end_date: end, initial_chick_count: chicks, chick_cost: chickCost, mortality_threshold_pct: 5 },
    feed: [{ feed_log_id: `${id}-f`, batch_id: id, entry_date: start, quantity_g: feedKg * 1000 }],
    mortality: deaths.map(([entry_date, count], i) => ({ mortality_id: `${id}-m${i}`, batch_id: id, entry_date, count })),
    sales: sales.map(([sale_date, quantity_sold, weight_kg, total_amount], i) => ({ sale_id: `${id}-s${i}`, batch_id: id, buyer_name: 'Aling Nena', sale_date, quantity_sold, weight_kg, total_amount })),
    allocations: [{ expense_id: `${id}-e`, batch_id: id, feed_centavos: feedPeso * 100, other_centavos: otherPeso * 100 }]
  };
}

const closedA = batchData('a', 'Batch 2026-05', { start: '2026-05-01', end: '2026-06-10', deaths: [['2026-05-10', 40]], sales: [['2026-06-10', 960, 1900, 228000]] });
const closedB = batchData('b', 'Batch 2026-07', { start: '2026-07-01', end: '2026-08-12', feedKg: 3400, deaths: [['2026-07-09', 60]], sales: [['2026-08-12', 940, 1880, 216200]] });
const open = batchData('c', 'Batch 2026-09', {
  status: 'Open', start: '2026-09-25', feedPeso: 50000, otherPeso: 5000,
  deaths: [['2026-10-12', 3], ['2026-10-20', 4], ['2026-10-26', 6], ['2026-10-28', 2]]
});

const byId = (facts) => Object.fromEntries(facts.map((f) => [f.id, f]));

describe('facts', () => {
  it('mortality trend: last 7 days vs the 7 before', () => {
    expect(mortalityTrend(open.mortality, today)).toEqual({ last7: 8, prev7: 4 });
  });

  it('dashboard facts: open batch, farm averages and the last closed batch', () => {
    const f = byId(buildDashboardFacts([open], [closedA, closedB], today));
    expect(f['open1.age_days'].text).toBe('33 days');
    expect(f['open1.live_heads'].value).toBe(1000 - 13); // today's deaths are not counted yet
    expect(f['open1.mortality_rate']).toMatchObject({ text: '1.5%', note: "under the farmer's limit of 5.0%" });
    expect(f['open1.mortality_rate'].attention).toBeUndefined();
    expect(f['open1.deaths_last_7_days']).toMatchObject({ value: 8, note: 'up from 4 in the 7 days before', attention: true });
    expect(f['open1.total_cost'].text).toBe('₱95,000.00');
    // Numbers that only mean something for a finished batch are left out
    expect(f['open1.feed_cost_share']).toBeUndefined();
    expect(f['open1.net_profit']).toBeUndefined();
    expect(f['open1.fcr']).toBeUndefined();

    expect(f['farm.batches_compared'].value).toBe(2);
    expect(f['farm.avg_fcr'].text).toBe(((3000 / 1900 + 3400 / 1880) / 2).toFixed(2));
    expect(f['farm.avg_mortality_rate'].text).toBe('5.0%');
    expect(f['farm.avg_net_profit'].text).toBe('₱82,100.00');
    expect(f['last_closed.net_profit']).toMatchObject({ note: 'lower than the farm average (₱82,100.00): worse', attention: true });
    expect(f['last_closed.net_profit'].label).toContain('Batch 2026-07');
    expect(f['last_closed.price_per_kg']).toMatchObject({ text: '₱115.00', note: 'about the same as the farm average (₱117.51)' });
    expect(f['last_closed.mortality_rate']).toMatchObject({ note: "above the farmer's limit of 5.0%", attention: true });
  });

  it('comparison notes say higher/lower and better/worse', () => {
    const fcr = compareWith(1.6, (v) => v.toFixed(2), { higherIsBetter: false });
    expect(fcr(1.9)).toEqual({ note: 'higher than the farm average (1.60): worse', attention: true });
    expect(fcr(1.4)).toEqual({ note: 'lower than the farm average (1.60): better', attention: false });
    expect(fcr(1.62)).toEqual({ note: 'about the same as the farm average (1.60)', neutral: true });
    expect(compareWith('N/A', String, { higherIsBetter: true })(1)).toBeNull();

    expect(trendCheck(4)(28)).toMatchObject({ attention: true });
    expect(trendCheck(0)(3).attention).toBeUndefined(); // too few to call a rise
    expect(trendCheck(10)(6)).toEqual({ note: 'down from 10 in the 7 days before: better' });
  });

  it('an open batch near its limit or above a whole batch\'s average needs attention', () => {
    const near = batchData('n', 'Batch N', { status: 'Open', start: '2026-10-01', deaths: [['2026-10-05', 42]] });
    expect(byId(buildDashboardFacts([near], [], today))['open1.mortality_rate']).toMatchObject({ note: "close to the farmer's limit of 5.0%", attention: true });
    near.batch.mortality_threshold_pct = null;
    const f = byId(buildDashboardFacts([near], [closedA], today));
    expect(f['open1.mortality_rate']).toMatchObject({ note: 'already above the farm average for a whole batch (4.0%)', attention: true });
  });

  it('batch facts compare with the other closed batches only', () => {
    const f = byId(buildBatchFacts(closedB, [closedA, closedB], today));
    expect(f['batch.fcr']).toMatchObject({ text: '1.81', note: 'higher than the farm average (1.58): worse', attention: true });
    expect(f['batch.age_days'].text).toBe('42 days');
    expect(f['batch.live_heads']).toBeUndefined();
    expect(f['farm.batches_compared'].value).toBe(1);
    expect(f['farm.avg_fcr'].text).toBe('1.58');
  });

  it('never puts buyer names in the prompt', () => {
    const facts = buildDashboardFacts([open], [closedA, closedB], today);
    const prompt = buildInsightsPrompt(facts, today);
    expect(prompt).not.toContain('Aling Nena');
    expect(prompt).toContain("open1.mortality_rate | Batch 2026-09: mortality rate | 1.5% | under the farmer's limit of 5.0%");
  });

  it('lists the facts that need attention first', () => {
    const lines = buildInsightsPrompt(buildDashboardFacts([open], [closedA, closedB], today), today).split('\n').slice(2);
    const firstPlain = lines.findIndex((l) => !l.includes('ATTENTION'));
    expect(firstPlain).toBeGreaterThan(0);
    expect(lines.slice(firstPlain).some((l) => l.includes('ATTENTION'))).toBe(false);
    expect(lines[0]).toContain('ATTENTION: ');
  });

  it('hash changes only when a shown number or the model changes', () => {
    const facts = buildDashboardFacts([open], [closedA], today);
    const same = buildDashboardFacts([open], [closedA], today);
    expect(factsHash(facts, 'm')).toBe(factsHash(same, 'm'));
    expect(factsHash(facts, 'm')).not.toBe(factsHash(facts, 'other'));
    const more = { ...open, mortality: [...open.mortality, { mortality_id: 'x', batch_id: 'c', entry_date: '2026-10-27', count: 9 }] };
    expect(factsHash(buildDashboardFacts([more], [closedA], today), 'm')).not.toBe(factsHash(facts, 'm'));
  });

  it('schema only allows real fact ids', () => {
    const facts = buildBatchFacts(closedA, [], today);
    const schema = buildInsightsSchema(facts);
    expect(schema.properties.suggestions.items.properties.fact_id.enum).toEqual(facts.map((x) => x.id));
    expect(schema.properties.suggestions.maxItems).toBe(5);
  });

  it('only facts with a note can be suggested about when there are enough', () => {
    const facts = buildDashboardFacts([open], [closedA, closedB], today);
    const allowed = buildInsightsSchema(facts).properties.suggestions.items.properties.fact_id.enum;
    expect(allowed).toContain('open1.deaths_last_7_days');
    expect(allowed).not.toContain('open1.live_heads');
    expect(allowed).not.toContain('farm.avg_fcr');
    expect(normalizeSuggestions({ suggestions: [{ fact_id: 'open1.live_heads', title: 'Filler', detail: 'Plain total.' }] }, facts)).toEqual([]);
    // "About the same" numbers are left out too, and the list may be shorter than 5
    expect(allowed).not.toContain('last_closed.price_per_kg');
    expect(suggestableFacts(facts).every((f) => f.note && !f.neutral)).toBe(true);
    expect(buildInsightsSchema(facts).properties.suggestions.maxItems).toBe(Math.min(5, allowed.length));
  });

  it('falls back to all noted facts, then all facts, when there are few clear findings', () => {
    const fact = (id, extra = {}) => ({ id, label: id, value: 1, text: '1', ...extra });
    const neutral = [fact('a', { note: 'same', neutral: true }), fact('b', { note: 'same', neutral: true }), fact('c', { note: 'under the limit' }), fact('d')];
    expect(suggestableFacts(neutral).map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(suggestableFacts([fact('a', { note: 'x', neutral: true }), fact('d')]).map((f) => f.id)).toEqual(['a', 'd']);
  });
});

describe('normalizeSuggestions', () => {
  const facts = buildBatchFacts(closedB, [closedA, closedB], today);

  it('keeps suggestions tied to a real fact, with the farm\'s own number', () => {
    const out = normalizeSuggestions({
      suggestions: [
        { fact_id: 'batch.fcr', title: 'Feed use was high', detail: 'FCR was 9.99, above the farm average.' },
        { fact_id: 'made.up', title: 'Ghost', detail: 'Not a fact.' },
        { fact_id: 'batch.mortality_rate', title: '  ', detail: 'No title.' },
        { fact_id: 'batch.margin', title: 'Feed use was HIGH', detail: 'Duplicate title.' },
        { fact_id: 'batch.fcr', title: 'Same fact again', detail: 'One suggestion per fact.' }
      ]
    }, facts);
    expect(out).toEqual([{
      title: 'Feed use was high',
      detail: 'FCR was 9.99, above the farm average.',
      fact_id: 'batch.fcr',
      basis: { label: 'Batch 2026-07: FCR (kg feed per kg sold)', text: '1.81', note: 'higher than the farm average (1.58): worse' },
      attention: true
    }]);
  });

  it('caps at 5 and clips long text', () => {
    const noted = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, label: `L${i}`, value: i, text: String(i), note: 'worse', attention: true }));
    const many = noted.map((f, i) => ({ fact_id: f.id, title: `T${i}`, detail: 'x'.repeat(500) }));
    const out = normalizeSuggestions({ suggestions: many }, noted);
    expect(out).toHaveLength(5);
    expect(out[0].detail.length).toBe(320);
    expect(normalizeSuggestions(null, facts)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Local AI calls (mocked fetch)
// ---------------------------------------------------------------------------

function mockOllama({ models = ['qwen3.5:4b', 'glm-ocr:latest'], answer, delay = 0 } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (url.endsWith('/api/tags')) {
      return { ok: true, json: async () => ({ models: models.map((name) => ({ name })) }) };
    }
    const body = JSON.parse(init.body);
    calls.push(body);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(answer(body)) } }) };
  }));
  return calls;
}

const goodAnswer = () => ({
  suggestions: [{ fact_id: 'batch.mortality_rate', title: 'Mortality above the farm average', detail: 'Check brooding heat in week 1.' }]
});

describe('generateSuggestions', () => {
  beforeEach(() => setLlmSettings(null));
  afterEach(() => vi.unstubAllGlobals());

  it('asks the text model with the schema, without thinking', async () => {
    const calls = mockOllama({ answer: goodAnswer });
    const facts = buildBatchFacts(closedB, [closedA, closedB], today);
    const out = await generateSuggestions(facts, { today });
    expect(out[0].basis.text).toBe('6.0%');
    expect(calls[0].model).toBe('qwen3.5:4b');
    expect(calls[0].think).toBe(false);
    expect(calls[0].format.properties.suggestions.items.properties.fact_id.enum).toContain('batch.fcr');
    expect(calls[0].messages[1].content).toContain('Today is 2026-10-28.');
  });

  it('fails when nothing usable came back', async () => {
    mockOllama({ answer: () => ({ suggestions: [{ fact_id: 'nope', title: 'x', detail: 'y' }] }) });
    await expect(generateSuggestions(buildBatchFacts(closedA, [], today), { today })).rejects.toThrow('no usable suggestions');
  });
});

describe('loadInsights (background + cache)', () => {
  beforeEach(() => { store.clear(); setLlmSettings(null); });
  afterEach(() => vi.unstubAllGlobals());

  const finished = (scope) => new Promise((resolve) => {
    const off = onInsightsChange((s) => { if (s === scope) { off(); resolve(); } });
  });

  it('writes once, then serves the cache until the numbers change', async () => {
    const calls = mockOllama({ answer: goodAnswer, delay: 5 });
    const facts = buildBatchFacts(closedB, [closedA, closedB], today);

    const done = finished('batch:b');
    const first = await loadInsights('batch:b', facts, today);
    expect(first.status).toBe('working');
    // Asking again while it runs does not start a second request
    expect((await loadInsights('batch:b', facts, today)).status).toBe('working');
    await done;
    expect(calls).toHaveLength(1);

    const ready = await loadInsights('batch:b', facts, today);
    expect(ready.status).toBe('ready');
    expect(ready.stale).toBe(false);
    expect(ready.suggestions[0].title).toBe('Mortality above the farm average');
    expect(calls).toHaveLength(1);

    // New numbers: the old suggestions are shown as stale while new ones are written
    const done2 = finished('batch:b');
    const changed = buildBatchFacts(batchData('b', 'Batch 2026-07', { start: '2026-07-01', end: '2026-08-12', deaths: [['2026-07-09', 80]], sales: [['2026-08-12', 920, 1840, 211600]] }), [closedA], today);
    const working = await loadInsights('batch:b', changed, today);
    expect(working).toMatchObject({ status: 'working', stale: true });
    expect(working.suggestions).toHaveLength(1);
    await done2;
    expect(calls).toHaveLength(2);
  });

  it('says why when the text model is missing, without calling it', async () => {
    const calls = mockOllama({ models: ['glm-ocr'], answer: goodAnswer });
    const out = await loadInsights('dashboard', buildDashboardFacts([open], [], today), today);
    expect(out.status).toBe('off');
    expect(out.reason).toContain('ollama pull qwen3.5:4b');
    expect(calls).toHaveLength(0);
  });

  it('does not need the OCR model', async () => {
    mockOllama({ models: ['qwen3.5:4b'], answer: () => ({ suggestions: [{ fact_id: 'open1.mortality_rate', title: 'Watch deaths', detail: 'Deaths doubled this week.' }] }) });
    const done = finished('dashboard');
    expect((await loadInsights('dashboard', buildDashboardFacts([open], [], today), today)).status).toBe('working');
    await done;
    expect((await loadInsights('dashboard', buildDashboardFacts([open], [], today), today)).status).toBe('ready');
  });

  it('a failure keeps the last good suggestions and is not retried by itself', async () => {
    const facts = buildBatchFacts(closedA, [], today);
    store.set('batch:a', { scope: 'batch:a', hash: 'old', status: 'ready', suggestions: [{ title: 'Old', detail: 'd', basis: { label: 'l', text: '1' } }], created_at: '2026-10-01T00:00:00Z' });
    const calls = mockOllama({ answer: () => ({ suggestions: [] }) });
    const done = finished('batch:a');
    await loadInsights('batch:a', facts, today);
    await done;

    const failed = await loadInsights('batch:a', facts, today);
    expect(failed).toMatchObject({ status: 'failed', stale: true, error: 'The local AI gave no usable suggestions.' });
    expect(failed.suggestions[0].title).toBe('Old');
    expect(calls).toHaveLength(1);
  });

  it('manual mode never starts the model by itself, but Write suggestions does', async () => {
    const calls = mockOllama({ answer: goodAnswer });
    const facts = buildBatchFacts(closedB, [closedA, closedB], today);
    const paused = await loadInsights('batch:b', facts, today, { mode: 'manual' });
    expect(paused).toMatchObject({ status: 'paused', suggestions: [] });
    expect(calls).toHaveLength(0);

    const done = finished('batch:b');
    expect((await loadInsights('batch:b', facts, today, { mode: 'manual', force: true })).status).toBe('working');
    await done;
    expect(calls).toHaveLength(1);
    // Up to date: shown as ready, still without calling the model again
    expect((await loadInsights('batch:b', facts, today, { mode: 'manual' })).status).toBe('ready');
    expect(calls).toHaveLength(1);
  });

  it('remembers the mode', () => {
    expect(getSuggestionsMode()).toBe('auto');
    setSuggestionsMode('nonsense');
    expect(getSuggestionsMode()).toBe('auto');
  });

  it('empty when there are no numbers yet', async () => {
    expect(await loadInsights('dashboard', [], today)).toEqual({ status: 'empty', suggestions: [] });
  });
});

describe('renderInsightsCard', () => {
  const suggestion = { title: '<b>Feed</b>', detail: 'Use <script>x</script>', basis: { label: 'FCR', text: '1.81' } };

  it('escapes AI text and labels it AI-generated', () => {
    const html = renderInsightsCard({ status: 'ready', suggestions: [suggestion], createdAt: '2026-10-28T02:00:00Z', stale: false });
    expect(html).toContain('AI-generated');
    expect(html).toContain('&lt;b&gt;Feed&lt;/b&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Based on: FCR: <b>1.81</b>');
    const noted = renderInsightsCard({ status: 'ready', suggestions: [{ ...suggestion, attention: true, basis: { ...suggestion.basis, note: 'higher than the farm average (1.58): worse' } }] });
    expect(noted).toContain('is-attention');
    expect(noted).toContain('<b>1.81</b> (higher than the farm average (1.58): worse)');
    expect(html).toContain('↻ Refresh');
  });

  it('shows progress, the off reason, failures and stale lists', () => {
    const working = renderInsightsCard({ status: 'working', suggestions: [suggestion], stale: true });
    expect(working).toContain('Writing suggestions');
    expect(working).toContain('from older numbers');
    expect(working).toContain('is-stale');
    expect(working).not.toContain('btn-insights-refresh');

    expect(renderInsightsCard({ status: 'off', reason: 'Local AI (Ollama) is not running.', suggestions: [] })).toContain('not running');
    expect(renderInsightsCard({ status: 'failed', error: 'boom', suggestions: [] })).toContain('Try again');
    expect(renderInsightsCard({ status: 'empty', suggestions: [] })).toContain('Add records');
    const paused = renderInsightsCard({ status: 'paused', suggestions: [] });
    expect(paused).toContain('Write suggestions');
    expect(paused).toContain('btn-insights-refresh');
    expect(renderInsightsCard({ status: 'paused', suggestions: [suggestion], stale: true })).toContain('The numbers changed since');
    expect(renderInsightsCard(null)).toBe('');
  });
});
