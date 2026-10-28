/**
 * localData.js
 * Keeps each account's records apart in the browser's IndexedDB.
 *
 * The demo batches are only for Demo Mode. When a real Supabase account
 * logs in on a browser that holds demo data (or another account's data),
 * the local tables are cleared and the account's own records are downloaded
 * by the sync engine. Records still waiting to upload are never cleared.
 */

import { db } from './dexie.js';
import { checkAndSeedInitialData } from './seed.js';

export const DEMO_OWNER = 'demo';

/** Tables holding farm records, or suggestions written from them (not the scan queue or app settings). */
const RECORD_TABLES = ['batches', 'feed_logs', 'mortality_logs', 'sales', 'expenses', 'allocations', 'outbox', 'ai_insights'];

/**
 * What to do with the local records when `target` logs in (pure).
 * @param {object} p
 * @param {string|null} p.owner        – who the local records belong to; null when unknown
 *                                       (new browser, or an install from before this was tracked,
 *                                       which may hold demo and real records mixed)
 * @param {string} p.target            – DEMO_OWNER or the Supabase user id
 * @param {number} p.unsynced          – items still in the outbox
 * @returns {'keep'|'seed'|'clear'|'clear-and-seed'|'keep-unsynced'}
 */
export function planLocalData({ owner, target, unsynced }) {
  const isDemo = target === DEMO_OWNER;

  if (owner === target) return isDemo ? 'seed' : 'keep'; // 'seed' only re-seeds when the seed version changed
  // Demo Mode's simulated sync empties the outbox, so leftovers belong to a real account
  if (unsynced > 0) return 'keep-unsynced';
  // Unknown or different owner: start clean (a real account downloads its records again)
  return isDemo ? 'clear-and-seed' : 'clear';
}

/**
 * Make the local records match the user who just logged in.
 * Returns the action taken (see planLocalData).
 */
export async function prepareLocalDataFor(user) {
  if (!user) return 'keep';
  const target = user.isDemo ? DEMO_OWNER : user.id;
  const [ownerRow, unsynced] = await Promise.all([
    db.app_state.get('data_owner'),
    db.outbox.count()
  ]);
  const action = planLocalData({ owner: ownerRow?.value ?? null, target, unsynced });

  if (action === 'keep-unsynced') {
    console.warn(`Kept local records of ${ownerRow?.value ?? 'a previous account'}: ${unsynced} not uploaded yet.`);
    return action;
  }

  if (action === 'clear' || action === 'clear-and-seed') {
    await db.transaction('rw', [...RECORD_TABLES.map((t) => db[t]), db.app_state], async () => {
      for (const t of RECORD_TABLES) await db[t].clear();
      await db.app_state.delete('seed_version');
    });
  }
  if (action === 'seed' || action === 'clear-and-seed') {
    await checkAndSeedInitialData(action === 'clear-and-seed');
  }
  await db.app_state.put({ key: 'data_owner', value: target });
  return action;
}
