/**
 * insightsService.js
 * AI suggestions (Phase 4): the local text model (localLlm.js) reads the
 * farm's computed numbers and writes 3–5 short suggestions, each tied to one
 * of those numbers.
 *
 * Only computed metrics go into the prompt (costs, FCR, mortality trend,
 * margins, farm averages); no buyer names or individual records. The result is
 * advice only: nothing here writes farm records, and the rule-based warning
 * flags stay as they are.
 *
 * Generation takes minutes on a CPU, so it runs in the background, one at a
 * time, and only when the numbers changed. Results are cached per scope in
 * Dexie (`ai_insights`, local only, not synced):
 *   'dashboard'        – open batches + averages of the last 5 closed batches
 *   'batch:<batch_id>' – one batch compared with the farm averages
 */

import { db } from '../db/dexie.js';
import { calcBatchMetrics, liveHeadCount } from './allocationEngine.js';
import { calcDashboardAverages, formatPeso } from './calculations.js';
import { askTextModelJson, checkLocalLlm, getLlmSettings, hasModel } from './localLlm.js';

/** Bump when the prompt or facts change, so cached suggestions are rewritten. */
const PROMPT_VERSION = 2;
const MAX_SUGGESTIONS = 5;
const COMPARE_LAST = 5;

// ---------------------------------------------------------------------------
// FACTS (pure)
// ---------------------------------------------------------------------------

const NA = 'N/A';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const fmt = {
  peso: (v) => formatPeso(v),
  pct: (v) => `${round(v, 1).toFixed(1)}%`,
  dec: (v) => round(v, 2).toFixed(2),
  int: (v) => Math.round(v).toLocaleString('en-PH'),
  kg: (v) => `${round(v, 2).toLocaleString('en-PH')} kg`,
  kgPerBird: (v) => `${round(v, 2).toFixed(2)} kg`,
  days: (v) => `${Math.round(v)} days`
};

/** Days between two YYYY-MM-DD dates. */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** Deaths in the last 7 days (today included) and the 7 days before that. */
export function mortalityTrend(mortality, today) {
  const weekStart = addDays(today, -6);
  const prevStart = addDays(today, -13);
  let last7 = 0;
  let prev7 = 0;
  for (const m of mortality.filter((x) => !x.deleted_at)) {
    const n = Number(m.count) || 0;
    if (m.entry_date >= weekStart && m.entry_date <= today) last7 += n;
    else if (m.entry_date >= prevStart && m.entry_date < weekStart) prev7 += n;
  }
  return { last7, prev7 };
}

/** Metrics of one batch, with the numbers the prompt needs. */
function batchFigures(item, today) {
  const { batch, allocations, sales, mortality, feed } = item;
  const m = calcBatchMetrics(batch, allocations, sales, mortality, feed);
  const isOpen = batch.status !== 'Closed';
  const headsSold = sales.filter((s) => !s.deleted_at).reduce((s, x) => s + (Number(x.quantity_sold) || 0), 0);
  const liveHeads = isOpen ? liveHeadCount(batch, mortality, sales, today) : 0;
  return {
    ...m,
    name: batch.batch_name,
    isOpen,
    days: daysBetween(batch.start_date, isOpen || !batch.end_date ? today : batch.end_date),
    initialChicks: Number(batch.initial_chick_count) || 0,
    liveHeads,
    threshold: batch.mortality_threshold_pct != null ? Number(batch.mortality_threshold_pct) : null,
    pricePerKg: m.kgSold > 0 ? m.revenue / m.kgSold : NA,
    kgPerHeadSold: headsSold > 0 ? m.kgSold / headsSold : NA,
    feedKgPerLiveBird: liveHeads > 0 ? m.totalFeedKg / liveHeads : NA,
    share: (part) => (m.totalCost > 0 ? (part / m.totalCost) * 100 : NA),
    trend: isOpen ? mortalityTrend(mortality, today) : null
  };
}

/**
 * Collects facts; values that are N/A or missing are left out. `check` adds a
 * rule-based note ("higher than the farm average (1.69): worse"), so the small
 * model only has to put it into words instead of working out comparisons,
 * which it got wrong in testing. `attention` marks a problem.
 */
function factList() {
  const facts = [];
  const add = (id, label, value, format, check = null) => {
    if (!isNum(value)) return;
    const fact = { id, label, value: round(value, 4), text: format(value) };
    const result = check?.(value);
    if (result?.note) fact.note = result.note;
    if (result?.attention) fact.attention = true;
    if (result?.neutral) fact.neutral = true;
    facts.push(fact);
  };
  return { facts, add };
}

/** Compare with a reference value; differences under 5% count as "about the same". */
export function compareWith(ref, format, { higherIsBetter, what = 'the farm average', tolerance = 0.05 }) {
  return (value) => {
    if (!isNum(ref) || ref === 0) return null;
    const diff = (value - ref) / Math.abs(ref);
    if (Math.abs(diff) < tolerance) return { note: `about the same as ${what} (${format(ref)})`, neutral: true };
    const higher = diff > 0;
    const better = higher === higherIsBetter;
    return { note: `${higher ? 'higher' : 'lower'} than ${what} (${format(ref)}): ${better ? 'better' : 'worse'}`, attention: !better };
  };
}

/** Mortality against the farmer's limit, then the farm average. */
function mortalityCheck(f, avg) {
  const limit = f.threshold;
  return (rate) => {
    if (limit != null && rate > limit) return { note: `above the farmer's limit of ${fmt.pct(limit)}`, attention: true };
    if (limit != null && f.isOpen && rate >= 0.8 * limit) return { note: `close to the farmer's limit of ${fmt.pct(limit)}`, attention: true };
    if (!f.isOpen) return compareWith(avg?.mortalityRate, fmt.pct, { higherIsBetter: false })(rate);
    // An open batch is not finished, so only a rate already above a whole batch's average says something
    if (isNum(avg?.mortalityRate) && rate > avg.mortalityRate) {
      return { note: `already above the farm average for a whole batch (${fmt.pct(avg.mortalityRate)})`, attention: true };
    }
    return limit != null ? { note: `under the farmer's limit of ${fmt.pct(limit)}` } : null;
  };
}

/** Deaths this week against the week before. */
export function trendCheck(prev7) {
  return (last7) => {
    if (last7 >= 5 && last7 >= 2 * Math.max(prev7, 1)) return { note: `up from ${prev7} in the 7 days before`, attention: true };
    if (last7 < prev7) return { note: `down from ${prev7} in the 7 days before: better` };
    return { note: `${prev7} in the 7 days before`, neutral: true };
  };
}

/**
 * Facts of one batch. An open batch leaves out numbers that only mean
 * something for a finished batch (cost shares, FCR, cost per kg, margin),
 * because comparing them with closed batches misled the model.
 */
function addBatchFacts(add, p, f, avg = null) {
  const n = f.name;
  const vs = (key, format, higherIsBetter) => compareWith(avg?.[key], format, { higherIsBetter });
  add(`${p}.age_days`, `${n}: ${f.isOpen ? 'age (still open)' : 'length of the batch'}`, f.days, fmt.days);
  add(`${p}.initial_chicks`, `${n}: chicks at start`, f.initialChicks, fmt.int);
  if (f.isOpen) add(`${p}.live_heads`, `${n}: birds alive now`, f.liveHeads, fmt.int);
  add(`${p}.mortality_rate`, `${n}: mortality rate`, f.mortalityRate, fmt.pct, mortalityCheck(f, avg));
  if (f.trend) add(`${p}.deaths_last_7_days`, `${n}: deaths in the last 7 days`, f.trend.last7, fmt.int, trendCheck(f.trend.prev7));
  add(`${p}.total_cost`, `${n}: cost${f.isOpen ? ' to date' : ''}`, f.totalCost, fmt.peso);

  if (f.isOpen) {
    if (f.revenue > 0) {
      add(`${p}.revenue`, `${n}: sales so far (batch still open)`, f.revenue, fmt.peso);
      add(`${p}.price_per_kg`, `${n}: average selling price per kg so far`, f.pricePerKg, fmt.peso, vs('pricePerKg', fmt.peso, true));
      add(`${p}.weight_per_head`, `${n}: average weight per bird sold so far`, f.kgPerHeadSold, fmt.kgPerBird, vs('kgPerHeadSold', fmt.kgPerBird, true));
    }
    return;
  }
  add(`${p}.chick_cost_share`, `${n}: chicks as share of cost`, f.share(f.chickCost), fmt.pct);
  add(`${p}.feed_cost_share`, `${n}: feed as share of cost`, f.share(f.allocFeedPeso), fmt.pct);
  add(`${p}.other_cost_share`, `${n}: other costs (medicine, power, labor…) as share of cost`, f.share(f.allocOtherPeso), fmt.pct);
  add(`${p}.feed_used`, `${n}: feed used`, f.totalFeedKg, fmt.kg);
  add(`${p}.revenue`, `${n}: sales`, f.revenue, fmt.peso);
  add(`${p}.net_profit`, `${n}: net profit`, f.netProfit, fmt.peso, vs('netProfit', fmt.peso, true));
  add(`${p}.margin`, `${n}: profit margin`, f.margin, fmt.pct, vs('margin', fmt.pct, true));
  add(`${p}.cost_per_kg`, `${n}: cost per kg sold`, f.costPerKg, fmt.peso, vs('costPerKg', fmt.peso, false));
  add(`${p}.price_per_kg`, `${n}: average selling price per kg`, f.pricePerKg, fmt.peso, vs('pricePerKg', fmt.peso, true));
  add(`${p}.weight_per_head`, `${n}: average weight per bird sold`, f.kgPerHeadSold, fmt.kgPerBird, vs('kgPerHeadSold', fmt.kgPerBird, true));
  add(`${p}.fcr`, `${n}: FCR (kg feed per kg sold)`, f.fcr, fmt.dec, vs('fcr', fmt.dec, false));
}

const average = (list, key) => {
  const values = list.map((f) => f[key]).filter(isNum);
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : NA;
};

/** Averages of the last 5 closed batches (by start date), like the Dashboard. null when there are none. */
function farmAverages(closedBatchesWithData, today, excludeBatchId = null) {
  const others = closedBatchesWithData.filter((c) => c.batch.batch_id !== excludeBatchId);
  const withProfit = others.map((c) => ({ ...c, netProfit: calcBatchMetrics(c.batch, c.allocations, c.sales, c.mortality, c.feed).netProfit }));
  const { last5, avgNetProfit, avgSellingPricePerKg } = calcDashboardAverages(withProfit);
  if (!last5.length) return null;

  const figures = last5.map((c) => batchFigures(c, today));
  const avg = {
    netProfit: avgNetProfit,
    pricePerKg: avgSellingPricePerKg || NA,
    margin: average(figures, 'margin'),
    costPerKg: average(figures, 'costPerKg'),
    fcr: average(figures, 'fcr'),
    mortalityRate: average(figures, 'mortalityRate'),
    days: average(figures, 'days'),
    kgPerHeadSold: average(figures, 'kgPerHeadSold')
  };
  return { figures, avg };
}

function addFarmFacts(add, { figures, avg }) {
  const of = `last ${figures.length} closed ${figures.length === 1 ? 'batch' : 'batches'}`;
  add('farm.batches_compared', 'closed batches in the farm averages', figures.length, fmt.int);
  add('farm.avg_net_profit', `average net profit, ${of}`, avg.netProfit, fmt.peso);
  add('farm.avg_price_per_kg', `average selling price per kg, ${of}`, avg.pricePerKg, fmt.peso);
  add('farm.avg_margin', `average profit margin, ${of}`, avg.margin, fmt.pct);
  add('farm.avg_cost_per_kg', `average cost per kg sold, ${of}`, avg.costPerKg, fmt.peso);
  add('farm.avg_fcr', `average FCR, ${of}`, avg.fcr, fmt.dec);
  add('farm.avg_mortality_rate', `average mortality rate, ${of}`, avg.mortalityRate, fmt.pct);
  add('farm.avg_days', `average length of a batch, ${of}`, avg.days, fmt.days);
  add('farm.avg_weight_per_head', `average weight per bird sold, ${of}`, avg.kgPerHeadSold, fmt.kgPerBird);
}

/**
 * Facts for the Dashboard: every open batch, the farm averages and the last
 * closed batch. Returns [{ id, label, value, text, note?, attention? }].
 */
export function buildDashboardFacts(openBatchesData = [], closedBatchesWithData = [], today) {
  const { facts, add } = factList();
  const farm = farmAverages(closedBatchesWithData, today);
  const open = [...openBatchesData].sort((a, b) => (a.batch.start_date < b.batch.start_date ? -1 : 1));
  open.forEach((item, i) => addBatchFacts(add, `open${i + 1}`, batchFigures(item, today), farm?.avg));

  if (farm) {
    addFarmFacts(add, farm);
    addBatchFacts(add, 'last_closed', farm.figures[farm.figures.length - 1], farm.avg);
  }
  return facts;
}

/** Facts for one batch's Summary page, compared with the other closed batches. */
export function buildBatchFacts(batchData, closedBatchesWithData = [], today) {
  const { facts, add } = factList();
  if (!batchData?.batch) return facts;
  const farm = farmAverages(closedBatchesWithData, today, batchData.batch.batch_id);
  addBatchFacts(add, 'batch', batchFigures(batchData, today), farm?.avg);
  if (farm) addFarmFacts(add, farm);
  return facts;
}

/** Changes whenever a shown number, the model or the prompt changes (FNV-1a). */
export function factsHash(facts, model = '') {
  const input = JSON.stringify([PROMPT_VERSION, model, facts.map((f) => [f.id, f.text, f.note || ''])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ---------------------------------------------------------------------------
// PROMPT (pure)
// ---------------------------------------------------------------------------

export const INSIGHTS_SYSTEM_PROMPT = `You are a farm adviser for a small broiler (meat chicken) farm in the Philippines. You get the farm's own numbers as facts, one per line: id | what it is | value | note.
The note, when there is one, is already worked out for you: it says whether the number is higher or lower than a reference, and whether that is better or worse. ATTENTION marks a problem.

Write up to 5 suggestions that could raise profit or cut losses. A few useful suggestions are better than filler.
Rules:
- Write about the ATTENTION facts first, the most serious first, then about other facts that have a note. Facts without a note are background: use them for context, but do not write a suggestion about them alone.
- Each suggestion is about a different fact. Put that fact's id in "fact_id", exactly as written.
- Use only the numbers in the facts and notes. Never make up a number. Say higher, lower, better or worse only as the note says. Never compare two facts that measure different things.
- title: at most 8 words. detail: one or two short sentences (at most 40 words): what the number shows and one practical thing to do or check.
- Plain, simple English. For bird health problems, suggest checking with a veterinarian; do not diagnose.
- A batch that is still open is not finished: do not call its profit a loss.
- If nothing needs attention, say what is going well and how to keep it that way.`;

/**
 * Facts a suggestion may be about. In testing the model padded its list with
 * plain totals ("birds alive now") and "about the same" numbers (it advised
 * lowering a normal selling price), so those are left out when there are
 * enough clear findings: better/worse first, then any note, then everything.
 */
export function suggestableFacts(facts) {
  const clear = facts.filter((f) => f.note && !f.neutral);
  if (clear.length >= 2) return clear;
  const noted = facts.filter((f) => f.note);
  return noted.length >= 3 ? noted : facts;
}

export function buildInsightsSchema(facts) {
  const allowed = suggestableFacts(facts);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        minItems: 1,
        maxItems: Math.min(MAX_SUGGESTIONS, allowed.length),
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['fact_id', 'title', 'detail'],
          properties: {
            fact_id: { type: 'string', enum: allowed.map((f) => f.id) },
            title: { type: 'string' },
            detail: { type: 'string' }
          }
        }
      }
    }
  };
}

const rank = (f) => (f.attention ? 0 : f.note ? 1 : 2);

/** Facts that need attention come first, so a small model does not miss them. */
export function buildInsightsPrompt(facts, today) {
  const lines = [...facts]
    .sort((a, b) => rank(a) - rank(b))
    .map((f) => `${f.id} | ${f.label} | ${f.text}${f.note ? ` | ${f.attention ? 'ATTENTION: ' : ''}${f.note}` : ''}`);
  return `Today is ${today}.\nFacts:\n${lines.join('\n')}`;
}

const clip = (s, max) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * Keep the model's suggestions that name a real fact, with that fact's own
 * label and value attached (shown as "Based on"), so the number on screen
 * always comes from the farm's data, not from the model.
 */
export function normalizeSuggestions(parsed, facts) {
  const byId = new Map(suggestableFacts(facts).map((f) => [f.id, f]));
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(parsed?.suggestions) ? parsed.suggestions : []) {
    const fact = byId.get(s?.fact_id);
    const title = clip(s?.title, 80);
    const detail = clip(s?.detail, 320);
    const key = title.toLowerCase();
    if (!fact || !title || !detail || seen.has(key) || seen.has(fact.id)) continue;
    seen.add(key);
    seen.add(fact.id);
    out.push({
      title,
      detail,
      fact_id: fact.id,
      basis: { label: fact.label, text: fact.text, ...(fact.note ? { note: fact.note } : {}) },
      ...(fact.attention ? { attention: true } : {})
    });
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

/** One model call: facts → suggestions. Throws when nothing usable came back. */
export async function generateSuggestions(facts, { today, signal } = {}) {
  const parsed = await askTextModelJson({
    system: INSIGHTS_SYSTEM_PROMPT,
    user: buildInsightsPrompt(facts, today),
    schema: buildInsightsSchema(facts),
    options: { temperature: 0.2 },
    signal
  });
  const suggestions = normalizeSuggestions(parsed, facts);
  if (!suggestions.length) throw new Error('The local AI gave no usable suggestions.');
  return suggestions;
}

// ---------------------------------------------------------------------------
// BACKGROUND GENERATION + CACHE
// ---------------------------------------------------------------------------

/** Suggestions only need the text model, not the OCR model. */
export async function insightsUnavailableReason() {
  const check = await checkLocalLlm();
  if (check.ok) return null;
  const { textModel, url } = getLlmSettings();
  if (!check.installed.length) return `Local AI (Ollama) is not running at ${url}.`;
  return hasModel(check.installed, textModel) ? null : `Local AI is missing ${textModel}. Run: ollama pull ${textModel}`;
}

const queue = new Map(); // scope → { facts, hash, today }
let running = null;      // { scope, hash, startedAt }
const listeners = new Set();

/** Called with the scope whenever its suggestions finished (or failed). */
export function onInsightsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function work() {
  if (running) return;
  while (queue.size) {
    const [scope, job] = queue.entries().next().value;
    queue.delete(scope);
    running = { scope, hash: job.hash, startedAt: Date.now() };
    const { textModel } = getLlmSettings();
    let record;
    try {
      const suggestions = await generateSuggestions(job.facts, { today: job.today });
      record = { scope, hash: job.hash, status: 'ready', suggestions, model: textModel, created_at: new Date().toISOString() };
    } catch (err) {
      console.error('AI suggestions failed', err);
      // Keep the last good suggestions so they can still be shown as older ones
      const keep = lastReady(await db.ai_insights.get(scope));
      record = { scope, hash: job.hash, status: 'failed', error: err.message, model: textModel, created_at: new Date().toISOString(), last_ready: keep };
    }
    await db.ai_insights.put(record);
    running = null;
    listeners.forEach((l) => l(scope));
  }
}

function enqueue(scope, facts, hash, today) {
  if (running?.scope === scope && running.hash === hash) return;
  queue.set(scope, { facts, hash, today });
  work();
}

const lastReady = (rec) => (rec?.status === 'ready' ? rec : rec?.last_ready || null);

/**
 * What the Suggestions card shows for `scope`, and starts writing new
 * suggestions in the background when the numbers changed since the cached ones.
 * Returns { status: 'empty'|'off'|'working'|'ready'|'failed', suggestions,
 *           createdAt, stale, reason, error, startedAt }.
 */
// ---------------------------------------------------------------------------
// SETTING: when suggestions are written
// ---------------------------------------------------------------------------

const MODE_KEY = 'chickpence_ai_suggestions';

/** 'auto' (when the numbers change), 'manual' (only on "Write suggestions") or 'off' (card hidden). */
export const SUGGESTION_MODES = [
  { id: 'auto', label: 'Write them automatically when the numbers change' },
  { id: 'manual', label: 'Only when I tap "Write suggestions" (for a slow computer)' },
  { id: 'off', label: 'Off: hide the Suggestions card' }
];

export function getSuggestionsMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (SUGGESTION_MODES.some((m) => m.id === saved)) return saved;
  } catch (_) {}
  return 'auto';
}

export function setSuggestionsMode(mode) {
  try {
    if (mode && mode !== 'auto') localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch (_) {}
}

export async function loadInsights(scope, facts, today, { force = false, mode = getSuggestionsMode() } = {}) {
  if (!facts.length) return { status: 'empty', suggestions: [] };

  const hash = factsHash(facts, getLlmSettings().textModel);
  const cached = await db.ai_insights.get(scope);
  const ready = lastReady(cached);
  const shown = (extra) => ({
    suggestions: ready?.suggestions || [],
    createdAt: ready?.created_at || null,
    stale: !!ready && ready.hash !== hash,
    ...extra
  });

  const isBusy = (running?.scope === scope && running.hash === hash) || queue.get(scope)?.hash === hash;
  if (isBusy) return shown({ status: 'working', startedAt: running?.scope === scope ? running.startedAt : null });

  if (!force && cached?.hash === hash) {
    return cached.status === 'ready' ? shown({ status: 'ready' }) : shown({ status: 'failed', error: cached.error });
  }

  // Manual mode: never start the (slow) model by itself
  if (!force && mode === 'manual') return shown({ status: 'paused' });

  const reason = await insightsUnavailableReason();
  if (reason) return shown({ status: 'off', reason });

  enqueue(scope, facts, hash, today);
  return shown({ status: 'working', startedAt: running?.scope === scope ? running.startedAt : null });
}
