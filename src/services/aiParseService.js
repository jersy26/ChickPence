/**
 * aiParseService.js
 * Client side of the `ai-parse` Edge Function: photo resizing, the call itself,
 * turning raw AI output into reviewable drafts, and the offline photo queue.
 *
 * AI never writes records. Everything here produces drafts; the review modal
 * saves confirmed drafts through Repository.save* like the manual form does.
 */

import { db } from '../db/dexie.js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { AuthService } from './auth.js';
import { syncEngine } from './syncEngine.js';

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

/** Local (not UTC) date as YYYY-MM-DD, so "kahapon" resolves correctly before 8 AM PH time. */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Why AI import is unavailable right now, or null when it can run.
 * Offline is not a blocker for photos (they queue), so it is reported separately.
 */
export function aiUnavailableReason() {
  if (!isSupabaseConfigured()) return 'AI import needs a Supabase connection (not available in Demo Mode).';
  if (AuthService.getUser()?.isDemo) return 'AI import needs a signed-in Supabase account (not available in Demo Mode).';
  return null;
}

export function isAiOnline() {
  return aiUnavailableReason() === null && syncEngine.isOnline();
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
      const uncertain = new Set(Array.isArray(e.uncertain_fields) ? e.uncertain_fields : []);
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
// PHOTO + EDGE FUNCTION (browser)
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

async function invokeAiParse(body) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('ai-parse', { body });
  if (error) {
    // FunctionsHttpError carries the function's JSON error message in .context
    let message = error.message;
    try {
      const payload = await error.context?.json?.();
      if (payload?.error) message = payload.error;
    } catch (_) {}
    throw new Error(message);
  }
  return data; // { entries, notes }
}

export function parseImage(imageBase64, batchNames) {
  return invokeAiParse({ mode: 'image', image: imageBase64, media_type: 'image/jpeg', today: localToday(), batches: batchNames });
}

export function parseText(text, batchNames) {
  return invokeAiParse({ mode: 'text', text, today: localToday(), batches: batchNames });
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
 * Send queued photos to ai-parse. Results stay in the job until the user
 * reviews them. Returns how many jobs finished (ready or failed).
 */
export async function processQueuedJobs(batchNames) {
  if (processing || !isAiOnline()) return 0;
  processing = true;
  let finished = 0;
  try {
    const queued = await db.import_jobs.where('status').equals('queued').sortBy('created_at');
    for (const job of queued) {
      if (!syncEngine.isOnline()) break;
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
