import { db } from '../db/dexie.js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { recomputeAllAllocations } from './allocationService.js';
import { AuthService } from './auth.js';
import { DEMO_OWNER } from '../db/localData.js';

/** Synced Dexie tables: primary key and Supabase table name. */
const TABLES = {
  batches: { pk: 'batch_id', remote: 'batch' },
  expenses: { pk: 'expense_id', remote: 'expense' },
  feed_logs: { pk: 'feed_log_id', remote: 'feed_log' },
  mortality_logs: { pk: 'mortality_id', remote: 'mortality_log' },
  sales: { pk: 'sale_id', remote: 'sale' }
};

// PostgREST returns at most max_rows rows per request (1000 by default)
const PULL_PAGE = 1000;

class SyncEngine {
  constructor() {
    this.isSimulatedOffline = false;
    this.isSyncing = false;
    this.running = null; // the sync in progress, if any
    this.rerun = false;  // syncNow() was called during it: run once more when it ends
    this.listeners = new Set();
    this.watchedClients = new WeakSet();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange());
      window.addEventListener('offline', () => this.handleNetworkChange());
    }
  }

  isOnline() {
    const navOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return navOnline && !this.isSimulatedOffline;
  }

  toggleSimulatedOffline() {
    this.isSimulatedOffline = !this.isSimulatedOffline;
    this.notifyStatus();
    if (this.isOnline()) {
      this.syncNow();
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyStatus() {
    this.getSyncStatus().then((status) => {
      this.listeners.forEach((fn) => fn(status));
    });
  }

  async getPendingCount() {
    return await db.outbox.count();
  }

  async getSyncStatus() {
    const pending = await this.getPendingCount();
    const problems = await db.outbox.filter((i) => !!i.last_error).count();
    const online = this.isOnline();
    return {
      online,
      isSimulatedOffline: this.isSimulatedOffline,
      pending,
      problems,
      isSyncing: this.isSyncing,
      isSupabaseConnected: isSupabaseConfigured()
    };
  }

  /**
   * Throw away a change the server keeps refusing (see discardChange), then
   * recompute cost sharing and sync, which brings back the server's version
   * of the record if there is one. Returns how many records were removed.
   */
  async discard(item) {
    const removed = await discardChange(item);
    await recomputeAllAllocations();
    this.notifyStatus();
    if (this.isOnline()) this.syncNow();
    return removed;
  }

  handleNetworkChange() {
    this.notifyStatus();
    if (this.isOnline()) {
      this.syncNow();
    }
  }

  /**
   * Save a record locally and queue its upload (allocations are never synced).
   * Call it inside a transaction that includes the record's table and
   * db.outbox, so a record is never saved without its upload being queued (or
   * the other way round), and call changed() after the transaction.
   */
  async writeUpsert(tableName, record) {
    const now = new Date().toISOString();
    const updatedRecord = { ...record, updated_at: now };
    await db[tableName].put(updatedRecord);
    await db.outbox.add({
      table_name: tableName,
      record_id: updatedRecord[this.getPrimaryKeyField(tableName)],
      action: 'UPSERT',
      payload: updatedRecord,
      updated_at: now
    });
    return updatedRecord;
  }

  /** Soft delete a record locally and queue it; same rules as writeUpsert. */
  async writeSoftDelete(tableName, recordId) {
    const existing = await db[tableName].get(recordId);
    if (!existing) return;
    const now = new Date().toISOString();
    const deleted = { ...existing, deleted_at: now, updated_at: now };
    await db[tableName].put(deleted);
    await db.outbox.add({
      table_name: tableName,
      record_id: recordId,
      action: 'SOFT_DELETE',
      payload: deleted,
      updated_at: now
    });
  }

  /** A local change was saved: show it in the sync status and upload it soon. */
  changed() {
    this.notifyStatus();
    if (this.isOnline()) {
      setTimeout(() => this.syncNow(), 300);
    }
  }

  // Save or update an entity locally and queue for sync
  async queueUpsert(tableName, record) {
    const saved = await db.transaction('rw', db[tableName], db.outbox, () => this.writeUpsert(tableName, record));
    this.changed();
    return saved;
  }

  // Soft delete a record locally and queue for sync
  async queueSoftDelete(tableName, recordId) {
    await db.transaction('rw', db[tableName], db.outbox, () => this.writeSoftDelete(tableName, recordId));
    this.changed();
  }

  getPrimaryKeyField(tableName) {
    if (tableName === 'daily_costs') return 'cost_id'; // v1 table, kept for the Dexie upgrade
    return TABLES[tableName]?.pk || 'id';
  }

  getSupabaseTableName(dexieTable) {
    return TABLES[dexieTable]?.remote || dexieTable;
  }

  /**
   * Make sure the Supabase login is valid, renewing it if needed. After being
   * offline, getSession() can still be holding a renewal that failed while the
   * server was unreachable, so ask for a fresh one once before giving up.
   */
  async ensureSession(supabase) {
    const { data } = await supabase.auth.getSession();
    if (data?.session) return true;
    const { data: refreshed } = await supabase.auth.refreshSession();
    return Boolean(refreshed?.session);
  }

  /** Sync as soon as the login is (re)established, e.g. right after reconnecting. */
  watchAuth(supabase) {
    if (this.watchedClients.has(supabase)) return;
    this.watchedClients.add(supabase);
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        // Outside the auth callback: supabase-js holds a lock while it runs
        setTimeout(() => this.syncNow(), 0);
      }
    });
  }

  /**
   * Upload what is waiting and download the latest records. A call while a
   * sync is running joins it, and that sync then runs once more: whatever was
   * saved meanwhile was not in its upload, and would otherwise wait for the
   * next change or reconnect. Resolves when everything is done.
   */
  syncNow() {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      this.isSyncing = true;
      this.notifyStatus();
      try {
        let result;
        do {
          this.rerun = false;
          result = await this.syncOnce();
        } while (this.rerun);
        return result;
      } finally {
        this.running = null;
        this.isSyncing = false;
        this.notifyStatus();
      }
    })();
    return this.running;
  }

  async syncOnce() {
    try {
      const supabase = getSupabase();
      const user = AuthService.getUser();

      // Demo Mode: simulate sync by clearing the outbox. Demo records are never
      // uploaded, even when Supabase is configured. Only while the records here
      // are the demo's: an account's changes that are not uploaded yet stay.
      if (user?.isDemo) {
        const owner = await db.app_state.get('data_owner');
        if (owner?.value !== DEMO_OWNER) return { success: false, count: 0, reason: 'not-demo-data' };
        const count = await db.outbox.count();
        if (count > 0) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          await db.outbox.clear();
        }
        return { success: true, count };
      }

      // Logged out: keep anything not uploaded yet for the next login
      if (!user) return { success: false, count: 0, reason: 'signed-out' };
      // No Supabase settings (they were removed): keep it all until they are back
      if (!supabase) return { success: false, count: 0, reason: 'no-server' };

      // Supabase mode. Never upload without the user's login: the database
      // would refuse it (row-level security) and the items would look broken.
      this.watchAuth(supabase);
      if (!(await this.ensureSession(supabase))) {
        return { success: false, count: 0, reason: 'no-session' };
      }

      const outboxItems = await db.outbox.orderBy('id').toArray();
      if (!outboxItems.length) {
        // Downloaded expenses, sales or deaths change how costs are shared between batches
        if (await this.pullFromSupabase()) await recomputeAllAllocations();
        return { success: true, count: 0 };
      }

      const { synced, failed } = await pushOutbox(outboxItems, async (item) => {
        const sbTable = this.getSupabaseTableName(item.table_name);
        const { error } = await supabase
          .from(sbTable)
          .upsert(item.payload, { onConflict: this.getPrimaryKeyField(item.table_name) });
        if (error) console.error(`Sync error on ${sbTable}:`, error);
        return error;
      });

      if (synced.length) {
        await db.outbox.bulkDelete(synced);
      }
      // Failed items stay queued for the next sync, with the reason kept on the item
      for (const { item, error } of failed) {
        await db.outbox.update(item.id, { attempts: (item.attempts || 0) + 1, last_error: error });
      }

      // Pull latest remote records
      const changed = await this.pullFromSupabase();

      // Recompute allocations if any source record changed
      if (changed) {
        await recomputeAllAllocations();
      }

      return { success: failed.length === 0, count: synced.length, failed: failed.length };
    } catch (err) {
      console.error('Sync failure:', err);
      return { success: false, error: err };
    }
  }

  /**
   * Pull from Supabase. Returns true if any record was updated.
   */
  async pullFromSupabase() {
    const supabase = getSupabase();
    if (!supabase) return false;

    let anyChanged = false;
    for (const [dexieTable, { pk, remote }] of Object.entries(TABLES)) {
      let rows;
      try {
        rows = await fetchAllRows(supabase, remote, pk);
      } catch (error) {
        console.error(`Pull error on ${remote}:`, error);
        continue;
      }
      if (!rows.length) continue;

      const changed = await db.transaction('rw', db[dexieTable], async () => {
        const local = await db[dexieTable].bulkGet(rows.map((row) => row[pk]));
        const replacing = rows.filter((row, i) => replacesLocal(row, local[i]));
        if (replacing.length) await db[dexieTable].bulkPut(replacing);
        return replacing.length > 0;
      });
      anyChanged = anyChanged || changed;
    }
    return anyChanged;
  }
}

export const syncEngine = new SyncEngine();

/**
 * Every row of a Supabase table. One plain select stops at the server's
 * max_rows (1000 by default), which silently left out the rest, so rows are
 * read in pages keyed on the primary key (rows added meanwhile do not shift
 * the pages). `count` is how many rows were left to read, so a page that
 * holds them all ends the table without one more request.
 */
export async function fetchAllRows(supabase, table, pk, pageSize = PULL_PAGE) {
  const rows = [];
  let after = null;
  for (;;) {
    let query = supabase.from(table).select('*', { count: 'exact' }).order(pk, { ascending: true }).limit(pageSize);
    if (after !== null) query = query.gt(pk, after);
    const { data, error, count } = await query;
    if (error) throw error;
    rows.push(...data);
    if (!data.length || (count != null && data.length >= count)) return rows;
    after = data[data.length - 1][pk];
  }
}

/**
 * Does a downloaded row replace the local copy? The newer one wins (as by
 * updated_at). At the same time it is the same change, e.g. this device's own
 * upload coming back: the server's copy only replaces it when it differs (the
 * database rounds decimals), so unchanged rows are not rewritten and cost
 * sharing is not recomputed after every sync.
 */
export function replacesLocal(remote, local) {
  if (!local) return true;
  const remoteTime = Date.parse(remote.updated_at);
  const localTime = Date.parse(local.updated_at);
  if (Number.isNaN(localTime)) return true;
  if (remoteTime !== localTime) return remoteTime > localTime;
  return Object.keys(remote).some((key) => !sameValue(key, remote[key], local[key]));
}

function sameValue(key, a, b) {
  // created_at is a TIMESTAMP without time zone on the server, so it reads back in another form
  if (key === 'created_at') return true;
  if (key === 'updated_at' || key === 'deleted_at') return (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);
  return a === b || (a == null && b == null);
}

/** Outbox items the server refused at least once, oldest first. */
export const outboxProblems = (items) => items.filter((i) => i.last_error).sort((a, b) => a.id - b.id);

/**
 * Remove a refused change from this device: its queued uploads and the local
 * record. A batch takes its own records with it (they cannot upload without
 * it). If the server has an earlier version of a record, the next download
 * puts it back. Returns the number of records removed.
 * @param {object} item – an outbox item
 * @param {object} database – Dexie db (tests pass a stand-in)
 */
export async function discardChange(item, database = db) {
  const all = await database.outbox.toArray();
  const keys = new Map([[`${item.table_name}:${item.record_id}`, [item.table_name, item.record_id]]]);
  if (item.table_name === 'batches') {
    for (const i of all) {
      if (i.payload?.batch_id === item.record_id) keys.set(`${i.table_name}:${i.record_id}`, [i.table_name, i.record_id]);
    }
  }
  await database.outbox.bulkDelete(all.filter((i) => keys.has(`${i.table_name}:${i.record_id}`)).map((i) => i.id));
  for (const [table, id] of keys.values()) await database[table]?.delete(id);
  return keys.size;
}

/**
 * Upload outbox items, batches first. One failure does not stop the rest;
 * only items that depend on a failed one wait for the next sync:
 *   - records of a batch whose upload failed (they would break its foreign key)
 *   - later edits of a record whose earlier edit failed (order must be kept,
 *     or an old value could overwrite a newer one)
 *
 * @param {object[]} items – outbox rows in queue order
 * @param {(item) => Promise<object|null>} upsert – returns an error or null
 * @returns {Promise<{synced: number[], failed: {item, error: string}[]}>}
 */
export async function pushOutbox(items, upsert) {
  const ordered = [
    ...items.filter((i) => i.table_name === 'batches'),
    ...items.filter((i) => i.table_name !== 'batches')
  ];
  const failedBatchIds = new Set();
  const failedRecords = new Set();
  const synced = [];
  const failed = [];

  for (const item of ordered) {
    const recordKey = `${item.table_name}:${item.record_id}`;
    const parentId = item.table_name === 'batches' ? null : item.payload?.batch_id;

    let error = null;
    if (failedRecords.has(recordKey)) {
      error = 'Waiting for an earlier change to this record to upload.';
    } else if (parentId && failedBatchIds.has(parentId)) {
      error = 'Waiting for its batch to upload.';
    } else {
      try {
        const result = await upsert(item);
        if (result) error = result.message || String(result);
      } catch (err) {
        error = err?.message || String(err);
      }
    }

    if (error) {
      failed.push({ item, error });
      failedRecords.add(recordKey);
      if (item.table_name === 'batches') failedBatchIds.add(item.record_id);
    } else {
      synced.push(item.id);
    }
  }
  return { synced, failed };
}
