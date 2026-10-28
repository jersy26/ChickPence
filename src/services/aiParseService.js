/**
 * aiParseService.js
 * Logbook scanning with the local AI (see localLlm.js): photo resizing,
 * turning raw output into reviewable drafts, and the queue of photos waiting
 * for the local AI.
 *
 * AI never writes records. Everything here produces drafts; the review modal
 * saves confirmed drafts through Repository.save* like the manual form does.
 */

import { db } from '../db/dexie.js';
import { checkLocalLlm, transcribeImage, extractEntries } from './localLlm.js';
import { normalizeSpoken, parseRecord } from './logbookParser.js';
import { localToday } from './calculations.js';

export { localToday };

export const DRAFT_TYPES = ['expense', 'feed', 'mortality', 'sale'];
export const LOW_CONFIDENCE = 0.7;
const MAX_IMAGE_SIDE = 1600;

/** Required fields per draft type (what Repository.save* needs to succeed). */
export const REQUIRED_FIELDS = {
  expense: ['date'],
  feed: ['date', 'batch_id', 'quantity_kg'],
  mortality: ['date', 'batch_id', 'count'],
  sale: ['date', 'batch_id', 'buyer_name', 'quantity_sold', 'weight_kg', 'price_per_kg']
};

/**
 * Why the local AI cannot scan right now (Ollama not running, model missing),
 * or null when it can. Photos can still be taken; they wait in the queue.
 */
export async function aiUnavailableReason(opts) {
  return (await checkLocalLlm(opts)).reason;
}

// ---------------------------------------------------------------------------
// DRAFT NORMALIZATION (pure)
// ---------------------------------------------------------------------------

const toNumber = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

/** Match the AI's batch_hint to an open batch: exact name first, then case-insensitive substring. */
export function matchBatch(hint, openBatches) {
  if (!hint) return null;
  const h = String(hint).trim().toLowerCase();
  return (
    openBatches.find((b) => b.batch_name.toLowerCase() === h) ||
    openBatches.find((b) => b.batch_name.toLowerCase().includes(h) || h.includes(b.batch_name.toLowerCase())) ||
    null
  );
}

/**
 * Turn the Edge Function's raw entries into editable drafts.
 * Each draft: { key, type, date, batch_id, ...fields, confidence, uncertain: Set, source_text, include }
 * A field is "uncertain" when the AI said so, when it is required but missing,
 * or (for batch_id) when the batch had to be guessed.
 */
export function normalizeDrafts(entries, openBatches) {
  const onlyBatch = openBatches.length === 1 ? openBatches[0] : null;

  return (Array.isArray(entries) ? entries : [])
    .filter((e) => e && DRAFT_TYPES.includes(e.type))
    .map((e, i) => {
      // Small models sometimes flag every field; keep only fields this type uses
      const relevant = new Set(['date', ...REQUIRED_FIELDS[e.type], ...(e.type === 'expense' ? ['feed_amount', 'other_amount'] : [])]);
      const uncertain = new Set((Array.isArray(e.uncertain_fields) ? e.uncertain_fields : [])
        .map((f) => (f === 'batch_hint' ? 'batch_id' : f))
        .filter((f) => relevant.has(f)));
      const confidence = Math.min(1, Math.max(0, toNumber(e.confidence) ?? 0));

      const draft = {
        key: `d${i}`,
        type: e.type,
        date: isIsoDate(e.date) ? e.date : null,
        batch_id: null,
        feed_amount: toNumber(e.feed_amount),
        other_amount: toNumber(e.other_amount),
        quantity_kg: toNumber(e.quantity_kg),
        count: toNumber(e.count),
        buyer_name: typeof e.buyer_name === 'string' ? e.buyer_name.trim() || null : null,
        quantity_sold: toNumber(e.quantity_sold),
        weight_kg: toNumber(e.weight_kg),
        price_per_kg: toNumber(e.price_per_kg),
        source_text: typeof e.source_text === 'string' ? e.source_text : '',
        confidence,
        uncertain,
        include: true
      };

      if (draft.type !== 'expense') {
        const matched = matchBatch(e.batch_hint, openBatches);
        if (matched) {
          draft.batch_id = matched.batch_id;
        } else if (onlyBatch) {
          draft.batch_id = onlyBatch.batch_id;
          if (e.batch_hint) uncertain.add('batch_id');
        } else {
          uncertain.add('batch_id');
        }
      }

      for (const f of REQUIRED_FIELDS[draft.type]) {
        if (draft[f] === null) uncertain.add(f);
      }
      if (draft.type === 'expense' && !draft.feed_amount && !draft.other_amount) {
        uncertain.add('feed_amount');
        uncertain.add('other_amount');
      }

      return draft;
    });
}

/** Problems that would stop a draft from saving, as user-facing text. Empty when valid. */
export function validateDraft(d) {
  const errors = [];
  if (!isIsoDate(d.date)) errors.push('date');
  if (d.type === 'expense') {
    if (!((d.feed_amount || 0) > 0) && !((d.other_amount || 0) > 0)) errors.push('feed or other amount');
    return errors;
  }
  if (!d.batch_id) errors.push('batch');
  if (d.type === 'feed' && !(d.quantity_kg > 0)) errors.push('quantity (kg)');
  if (d.type === 'mortality' && !(Number.isInteger(d.count) && d.count >= 0)) errors.push('death count');
  if (d.type === 'sale') {
    if (!d.buyer_name) errors.push('buyer');
    if (!(d.quantity_sold > 0)) errors.push('heads sold');
    if (!(d.weight_kg > 0)) errors.push('weight (kg)');
    if (!(d.price_per_kg > 0)) errors.push('price per kg');
  }
  return errors;
}

/** Repository call arguments for a confirmed draft. */
export function draftToSave(d) {
  switch (d.type) {
    case 'expense':
      return ['saveExpense', { entry_date: d.date, feed_amount: d.feed_amount || 0, other_amount: d.other_amount || 0 }];
    case 'feed':
      return ['saveFeedLog', { batch_id: d.batch_id, entry_date: d.date, quantity_kg: d.quantity_kg }];
    case 'mortality':
      return ['saveMortalityLog', { batch_id: d.batch_id, entry_date: d.date, count: d.count }];
    case 'sale':
      return ['saveSale', {
        batch_id: d.batch_id,
        sale_date: d.date,
        buyer_name: d.buyer_name,
        quantity_sold: d.quantity_sold,
        weight_kg: d.weight_kg,
        price_per_kg: d.price_per_kg
      }];
    default:
      throw new Error(`Unknown draft type ${d.type}`);
  }
}

// ---------------------------------------------------------------------------
// PHOTO + LOCAL AI (browser)
// ---------------------------------------------------------------------------

/** Downscale a photo to ≤1600px on the long side and return base64 JPEG (no data: prefix). */
export async function resizeImage(file, maxSide = MAX_IMAGE_SIDE) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

/**
 * Photo → { entries, notes, transcript }.
 * onProgress(message) reports each step; signal cancels.
 */
export async function parseImage(imageBase64, batchNames, { signal, onProgress } = {}) {
  onProgress?.('Reading the photo with the local AI…');
  const transcript = await transcribeImage(imageBase64, { signal });
  onProgress?.('Sorting the lines into entries…');
  const result = await extractEntries(transcript, { today: localToday(), batches: batchNames, signal, onProgress });
  return { entries: result.entries, notes: result.notes, transcript };
}

/** Transcript (voice input, Phase 3) → { entries, notes }. */
export async function parseText(text, batchNames, { signal, onProgress } = {}) {
  const result = await extractEntries(text, { today: localToday(), batches: batchNames, signal, onProgress });
  return { entries: result.entries, notes: result.notes };
}

// ---------------------------------------------------------------------------
// VOICE INPUT (one spoken entry → the entry form)
// ---------------------------------------------------------------------------

/**
 * One spoken sentence → { entry, notes, source }. The rules read it instantly;
 * only when they cannot does it go to the local text model (slow on CPU).
 * A sentence with no date means today. entry is null when nothing was understood.
 */
export async function parseSpokenEntry(transcript, batchNames, { signal, onProgress, today = localToday() } = {}) {
  const text = normalizeSpoken(transcript);
  if (!text) return { entry: null, notes: 'Nothing was heard.', source: 'rules' };

  const ruled = parseRecord(text, { today, batches: batchNames, previousDate: today });
  if (ruled) return { entry: { ...ruled, source_text: transcript }, notes: '', source: 'rules' };

  const reason = await aiUnavailableReason();
  if (reason) {
    return { entry: null, notes: `Could not tell what kind of entry that is. ${reason}`, source: 'rules' };
  }
  onProgress?.('Reading what you said with the local AI…');
  const { entries, notes } = await extractEntries(text, { today, batches: batchNames, signal });
  const [first] = entries;
  if (!first) return { entry: null, notes: notes || 'Could not tell what kind of entry that is.', source: 'ai' };
  return {
    entry: { ...first, date: first.date || today, source_text: transcript },
    notes: entries.length > 1 ? 'Only the first entry was used. Say one entry at a time.' : '',
    source: 'ai'
  };
}

const TAB_BY_TYPE = { expense: 'Expenses', feed: 'Feed', mortality: 'Mortality', sale: 'Sales' };

/**
 * A normalized draft → what the entry form needs: the tab to open, the batch
 * to select, values shaped like the stored record (so the form shows them like
 * an edit), and the fields to check.
 */
export function draftToFormPrefill(draft) {
  const base = { tab: TAB_BY_TYPE[draft.type], batch_id: draft.batch_id, uncertain: [...draft.uncertain] };
  const toCentavos = (peso) => (peso ? Math.round(peso * 100) : null);
  switch (draft.type) {
    case 'expense':
      return { ...base, values: { entry_date: draft.date, feed_centavos: toCentavos(draft.feed_amount), other_centavos: toCentavos(draft.other_amount) } };
    case 'feed':
      return { ...base, values: { entry_date: draft.date, quantity_kg: draft.quantity_kg } };
    case 'mortality':
      return { ...base, values: { entry_date: draft.date, count: draft.count } };
    case 'sale':
      return {
        ...base,
        values: {
          sale_date: draft.date,
          buyer_name: draft.buyer_name,
          quantity_sold: draft.quantity_sold,
          weight_kg: draft.weight_kg,
          price_per_kg: draft.price_per_kg
        }
      };
    default:
      throw new Error(`Unknown draft type ${draft.type}`);
  }
}

// ---------------------------------------------------------------------------
// OFFLINE QUEUE (import_jobs)
// status: 'queued' → 'ready' (drafts stored) | 'failed' (error stored)
// ---------------------------------------------------------------------------

/** Store a photo for later. Pass { error } to keep a photo whose live scan just failed. */
export async function queueImageJob(imageBase64, { error = null } = {}) {
  return db.import_jobs.add({
    status: error ? 'failed' : 'queued',
    image: imageBase64,
    created_at: new Date().toISOString(),
    result: null,
    error
  });
}

export async function retryJob(id) {
  return db.import_jobs.update(id, { status: 'queued', error: null });
}

export async function getReadyJobs() {
  return db.import_jobs.where('status').anyOf('ready', 'failed').sortBy('created_at');
}

export async function countPendingJobs() {
  return db.import_jobs.count();
}

export async function deleteJob(id) {
  return db.import_jobs.delete(id);
}

let processing = false;

/**
 * Scan queued photos with the local AI. Results stay in the job until the
 * user reviews them. Returns how many jobs finished (ready or failed).
 */
export async function processQueuedJobs(batchNames) {
  if (processing) return 0;
  processing = true;
  let finished = 0;
  try {
    const queued = await db.import_jobs.where('status').equals('queued').sortBy('created_at');
    for (const job of queued) {
      if (await aiUnavailableReason({ force: true })) break;
      try {
        const result = await parseImage(job.image, batchNames);
        await db.import_jobs.update(job.id, { status: 'ready', result, image: null });
      } catch (err) {
        await db.import_jobs.update(job.id, { status: 'failed', error: err.message });
      }
      finished++;
    }
  } finally {
    processing = false;
  }
  return finished;
}
