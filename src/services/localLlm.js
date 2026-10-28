/**
 * localLlm.js
 * Talks to a local Ollama server (default http://localhost:11434) instead of a
 * cloud API. Nothing leaves the farm computer, and it works without internet.
 *
 * A logbook photo is read in two steps, so small CPU-friendly models can do it:
 *   1. OCR model (vision)  : photo → plain text
 *   2. logbookParser rules : text  → draft entries; only lines the rules do not
 *      recognise go to the text model (JSON, schema-constrained)
 * On a CPU-only PC with 7 GB RAM, glm-ocr reads a page in about 1–1.5 minutes,
 * while a 4B text model needed ~10 minutes for a full page and misread dates
 * and amounts, so the model is only a fallback.
 * Voice input (Phase 3) will reuse step 2 with the transcript.
 */

import { parseRecords } from './logbookParser.js';

const DEFAULTS = {
  url: import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434',
  ocrModel: import.meta.env?.VITE_OLLAMA_OCR_MODEL || 'glm-ocr',
  textModel: import.meta.env?.VITE_OLLAMA_TEXT_MODEL || 'qwen3.5:4b'
};

const STORAGE_KEY = 'chickpence_local_llm';

// CPU-only machines can take minutes per photo
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export function getLlmSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      url: (saved.url || DEFAULTS.url).replace(/\/+$/, ''),
      ocrModel: saved.ocrModel || DEFAULTS.ocrModel,
      textModel: saved.textModel || DEFAULTS.textModel
    };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export function setLlmSettings(settings) {
  try {
    if (settings) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    else localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
  lastCheck = null;
}

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------

let lastCheck = null; // { at, result }
const CHECK_TTL_MS = 15000;

/** Models installed on the Ollama server; throws when it cannot be reached. */
export async function listModels(url = getLlmSettings().url) {
  const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const { models = [] } = await res.json();
  // Leave out embedding-only models (they cannot read or sort anything)
  return models
    .filter((m) => !Array.isArray(m.capabilities) || m.capabilities.includes('completion'))
    .map((m) => m.name);
}

export const hasModel = (installed, name) =>
  installed.includes(name) || installed.includes(`${name}:latest`);

/**
 * Is the local AI ready? Returns { ok, reason, installed }.
 * Cached for a few seconds because the Batches page checks on every render.
 */
export async function checkLocalLlm({ force = false } = {}) {
  if (!force && lastCheck && Date.now() - lastCheck.at < CHECK_TTL_MS) return lastCheck.result;

  const { url, ocrModel, textModel } = getLlmSettings();
  let result;
  try {
    const installed = await listModels(url);
    const missing = [ocrModel, textModel].filter((m) => !hasModel(installed, m));
    result = missing.length
      ? { ok: false, installed, reason: `Local AI is missing ${missing.join(' and ')}. Run: ollama pull ${missing[0]}` }
      : { ok: true, installed, reason: null };
  } catch (_) {
    result = { ok: false, installed: [], reason: `Local AI (Ollama) is not running at ${url}.` };
  }
  lastCheck = { at: Date.now(), result };
  return result;
}

// ---------------------------------------------------------------------------
// PROMPTS
// ---------------------------------------------------------------------------

const nullable = (type) => ({ type: [type, 'null'] });

export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['entries', 'notes'],
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'line', 'type', 'date', 'batch_hint',
          'feed_amount', 'other_amount',
          'quantity_kg', 'count',
          'buyer_name', 'quantity_sold', 'weight_kg', 'price_per_kg',
          'confidence', 'uncertain_fields'
        ],
        properties: {
          line: { type: 'integer' },
          type: { type: 'string', enum: ['expense', 'feed', 'mortality', 'sale'] },
          date: nullable('string'),
          batch_hint: nullable('string'),
          feed_amount: nullable('number'),
          other_amount: nullable('number'),
          quantity_kg: nullable('number'),
          count: nullable('integer'),
          buyer_name: nullable('string'),
          quantity_sold: nullable('integer'),
          weight_kg: nullable('number'),
          price_per_kg: nullable('number'),
          confidence: { type: 'number' },
          uncertain_fields: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    notes: { type: 'string' }
  }
};

export const EXTRACT_SYSTEM_PROMPT = `You turn poultry-farm records from a broiler farm in the Philippines (English, Filipino or Taglish) into draft log entries.

Entry types and their fields (every other field is null):
- "expense": a farm cost paid in pesos. feed_amount = pesos for feed; other_amount = pesos for anything else (medicine, vitamins, kuryente/electricity, labor, transport). batch_hint is null. A feed line with a peso amount is an expense.
- "feed": feed eaten by a batch, in kg (quantity_kg). Words: patuka, pakain, feeds consumed. 1 sako (sack) = 50 kg; when you convert sacks, add "quantity_kg" to uncertain_fields.
- "mortality": birds that died (count). Words: patay, namatay, dead.
- "sale": birds sold. buyer_name, quantity_sold (heads, "hds"), weight_kg (total kg), price_per_kg (pesos). Words: benta, nabenta, sold.

Rules:
- The records are numbered. Make one entry per record and set "line" to its number. Do not skip records.
- date is YYYY-MM-DD. Okt/Oct = October, Set/Sep = September, Nob/Nov = November, Dis/Dec = December. Use the year of today's date unless that puts the date in the future. kahapon = yesterday, ngayon = today.
- batch_hint: the batch name copied exactly from the open batches list when the record names it, even in short form (e.g. "B-07" or "batch 07" means "Batch 2026-07"). Otherwise null.
- Amounts are plain numbers, no peso sign or commas.
- Never guess a value you cannot read: use null and add the field name to uncertain_fields.
- confidence is 0 to 1.
- notes: one short sentence about records you could not use, or "".`;

/**
 * Split OCR text or a transcript into numbered records. A line that does not
 * start with a date-like word continues the record above it (e.g. the second
 * line of a sale).
 */
export function splitRecords(text) {
  const startsRecord = /^\s*(\d{1,2}[/-]\d{1,2}|(okt|ok\+|oct|set|sep|nob|nov|dis|dec|ene|jan|peb|feb|mar|abr|apr|may|hun|jun|hul|jul|ago|aug)\w*\.?\s*\d{1,2}|\d{4}-\d{2}-\d{2}|kahapon|ngayon)/i;
  const records = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (records.length && !startsRecord.test(line)) records[records.length - 1] += ` ${line}`;
    else records.push(line);
  }
  return records;
}

/** Prompt with only the given 1-based record numbers (all when omitted), numbering kept. */
export function buildExtractPrompt(records, { today, batches }, only = null) {
  const batchList = batches.length ? batches.map((b) => `- ${b}`).join('\n') : '(none)';
  const numbered = records
    .map((r, i) => [i + 1, r])
    .filter(([n]) => !only || only.includes(n))
    .map(([n, r]) => `${n}. ${r}`)
    .join('\n');
  return `Today is ${today}.\nOpen batches:\n${batchList}\n\nRecords:\n${numbered}`;
}

// ---------------------------------------------------------------------------
// OLLAMA CALLS
// ---------------------------------------------------------------------------

async function chat(body, signal) {
  const { url } = getLlmSettings();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: false, ...body, options: { temperature: 0, ...body.options } }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
  } catch (err) {
    if (signal?.aborted) throw new Error('Cancelled.');
    if (timeout.aborted) throw new Error('The local AI took too long. Try a photo with fewer lines.');
    throw new Error(`Cannot reach the local AI at ${url}. Is Ollama running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Local AI error ${res.status}`);
  return data.message?.content ?? '';
}

/**
 * Ask the text model for JSON that matches `schema`. Returns the parsed object.
 * Used by the AI suggestions (insightsService.js).
 */
export async function askTextModelJson({ system, user, schema, signal, options }) {
  const { textModel } = getLlmSettings();
  const content = await chat({
    model: textModel,
    think: false,
    format: schema,
    options,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }, signal);
  try {
    return JSON.parse(content);
  } catch (_) {
    throw new Error('The local AI returned an unreadable answer. Try again.');
  }
}

/** Step 1: read the photo into plain text, one logbook line per line. */
export async function transcribeImage(imageBase64, { signal } = {}) {
  const { ocrModel } = getLlmSettings();
  const text = await chat({
    model: ocrModel,
    messages: [{ role: 'user', content: 'Text Recognition:', images: [imageBase64] }]
  }, signal);
  return text.trim();
}

/**
 * Step 2: turn text into draft entries. Returns { entries, notes, records }.
 * The rule-based parser reads the usual logbook lines instantly; only lines it
 * does not recognise go to the text model (slow on CPU, so as few as possible).
 */
export async function extractEntries(text, options = {}) {
  return extractFromRecords(splitRecords(text), options);
}

/**
 * Same as extractEntries for records that are already one entry each (e.g.
 * spreadsheet rows the import could not read), so lines are not joined.
 */
export async function extractFromRecords(records, { today, batches, signal, onProgress } = {}) {
  if (!records.length) return { entries: [], notes: 'No text was found.', records };

  const { entries, unparsed } = parseRecords(records, { today, batches });
  if (!unparsed.length) return { entries, notes: '', records };

  const { textModel } = getLlmSettings();
  onProgress?.(`Sorting ${unparsed.length} unclear ${unparsed.length === 1 ? 'line' : 'lines'} with the local AI…`);
  const content = await chat({
    model: textModel,
    think: false, // reasoning is far too slow on CPU; the schema keeps output valid
    format: DRAFT_SCHEMA,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: buildExtractPrompt(records, { today, batches }, unparsed) }
    ]
  }, signal);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error('The local AI returned an unreadable answer. Try again.');
  }
  const fromModel = (parsed.entries || [])
    .filter((e) => unparsed.includes(e.line))
    .map((e) => ({ ...e, source_text: records[e.line - 1] }));

  const all = [...entries, ...fromModel].sort((a, b) => a.line - b.line);
  const missed = unparsed.filter((n) => !fromModel.some((e) => e.line === n));
  const notes = [
    parsed.notes,
    missed.length ? `Not turned into entries: ${missed.map((n) => `"${records[n - 1]}"`).join(', ')}` : ''
  ].filter(Boolean).join(' ');
  return { entries: all, notes, records };
}
