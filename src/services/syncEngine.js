import { db } from '../db/dexie.js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { recomputeAllAllocations } from './allocationService.js';
import { AuthService } from './auth.js';

class SyncEngine {
  constructor() {
    this.isSimulatedOffline = false;
    this.isSyncing = false;
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
    const online = this.isOnline();
    return {
      online,
      isSimulatedOffline: this.isSimulatedOffline,
      pending,
      isSyncing: this.isSyncing,
      isSupabaseConnected: isSupabaseConfigured()
    };
  }

  handleNetworkChange() {
    this.notifyStatus();
    if (this.isOnline()) {
      this.syncNow();
    }
  }

  // Save or update an entity locally and queue for sync
  async queueUpsert(tableName, record) {
    const now = new Date().toISOString();
    const updatedRecord = {
      ...record,
      updated_at: now
    };

    // 1. Write to local Dexie table immediately
    const table = db[tableName];
    if (table) {
      await table.put(updatedRecord);
    }

    // 2. Queue in outbox (allocations are NOT synced)
    if (tableName !== 'allocations') {
      const primaryKeyField = this.getPrimaryKeyField(tableName);
      const recordId = updatedRecord[primaryKeyField];

      await db.outbox.add({
        table_name: tableName,
        record_id: recordId,
        action: 'UPSERT',
        payload: updatedRecord,
        updated_at: now
      });
    }

    this.notifyStatus();

    // 3. Attempt immediate sync if online
    if (this.isOnline()) {
      setTimeout(() => this.syncNow(), 300);
    }

    return updatedRecord;
  }

  // Soft delete a record locally and queue for sync
  async queueSoftDelete(tableName, recordId) {
    const now = new Date().toISOString();
    const table = db[tableName];
    const primaryKeyField = this.getPrimaryKeyField(tableName);

    if (table) {
      const existing = await table.get(recordId);
      if (existing) {
        existing.deleted_at = now;
        existing.updated_at = now;
        await table.put(existing);

        if (tableName !== 'allocations') {
          await db.outbox.add({
            table_name: tableName,
            record_id: recordId,
            action: 'SOFT_DELETE',
            payload: existing,
            updated_at: now
          });
        }
      }
    }

    this.notifyStatus();

    if (this.isOnline()) {
      setTimeout(() => this.syncNow(), 300);
    }
  }

  getPrimaryKeyField(tableName) {
    switch (tableName) {
      case 'batches':
        return 'batch_id';
      case 'daily_costs':
        return 'cost_id';
      case 'expenses':
        return 'expense_id';
      case 'feed_logs':
        return 'feed_log_id';
      case 'mortality_logs':
        return 'mortality_id';
      case 'sales':
        return 'sale_id';
      default:
        return 'id';
    }
  }

  getSupabaseTableName(dexieTable) {
    switch (dexieTable) {
      case 'batches':
        return 'batch';
      case 'expenses':
        return 'expense';
      case 'feed_logs':
        return 'feed_log';
      case 'mortality_logs':
        return 'mortality_log';
      case 'sales':
        return 'sale';
      default:
        return dexieTable;
    }
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

  async syncNow() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.notifyStatus();

    try {
      const supabase = getSupabase();
      const user = AuthService.getUser();

      // Demo/Local mode: simulate sync by clearing outbox. Demo records are
      // never uploaded, even when Supabase is configured.
      if (!supabase || user?.isDemo) {
        const outboxItems = await db.outbox.toArray();
        if (outboxItems.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          await db.outbox.clear();
        }
        return { success: true, count: outboxItems.length };
      }

      // Logged out: keep anything not uploaded yet for the next login
      if (!user) return { success: false, count: 0, reason: 'signed-out' };

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
    } finally {
      this.isSyncing = false;
      this.notifyStatus();
    }
  }

  /**
   * Pull from Supabase. Returns true if any record was updated.
   */
  async pullFromSupabase() {
    const supabase = getSupabase();
    if (!supabase) return false;

    let anyChanged = false;

    try {
      const tables = ['batch', 'expense', 'feed_log', 'mortality_log', 'sale'];
      for (const t of tables) {
        const { data, error } = await supabase.from(t).select('*');
        if (error) {
          console.error(`Pull error on ${t}:`, error);
          continue;
        }
        if (data && data.length) {
          const dexieTable =
            t === 'batch'
              ? 'batches'
              : t === 'expense'
              ? 'expenses'
              : t === 'feed_log'
              ? 'feed_logs'
              : t === 'mortality_log'
              ? 'mortality_logs'
              : 'sales';

          await db.transaction('rw', db[dexieTable], async () => {
            for (const row of data) {
              const pk = this.getPrimaryKeyField(dexieTable);
              const local = await db[dexieTable].get(row[pk]);
              if (!local || new Date(row.updated_at) >= new Date(local.updated_at)) {
                await db[dexieTable].put(row);
                anyChanged = true;
              }
            }
          });
        }
      }
    } catch (err) {
      console.error('Pull from Supabase failed:', err);
    }

    return anyChanged;
  }
}

export const syncEngine = new SyncEngine();

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
