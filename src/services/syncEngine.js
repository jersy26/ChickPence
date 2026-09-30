import { db } from '../db/dexie.js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { recomputeAllAllocations } from './allocationService.js';

class SyncEngine {
  constructor() {
    this.isSimulatedOffline = false;
    this.isSyncing = false;
    this.listeners = new Set();

    window.addEventListener('online', () => this.handleNetworkChange());
    window.addEventListener('offline', () => this.handleNetworkChange());
  }

  isOnline() {
    return navigator.onLine && !this.isSimulatedOffline;
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

  async syncNow() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.notifyStatus();

    try {
      const supabase = getSupabase();

      // Demo/Local mode: simulate sync by clearing outbox
      if (!supabase) {
        const outboxItems = await db.outbox.toArray();
        if (outboxItems.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          await db.outbox.clear();
        }
        return { success: true, count: outboxItems.length };
      }

      // Supabase mode
      const outboxItems = await db.outbox.orderBy('id').toArray();
      if (!outboxItems.length) {
        await this.pullFromSupabase();
        return { success: true, count: 0 };
      }

      // Parents (batches) first, then children
      const batchEntries = outboxItems.filter((i) => i.table_name === 'batches');
      const childEntries = outboxItems.filter((i) => i.table_name !== 'batches');

      const orderedItems = [...batchEntries, ...childEntries];
      const successfullySyncedIds = [];

      for (const item of orderedItems) {
        const sbTable = this.getSupabaseTableName(item.table_name);
        const { error } = await supabase
          .from(sbTable)
          .upsert(item.payload, { onConflict: this.getPrimaryKeyField(item.table_name) });

        if (error) {
          console.error(`Sync error on ${sbTable}:`, error);
          break;
        } else {
          successfullySyncedIds.push(item.id);
        }
      }

      if (successfullySyncedIds.length) {
        await db.outbox.bulkDelete(successfullySyncedIds);
      }

      // Pull latest remote records
      const changed = await this.pullFromSupabase();

      // Recompute allocations if any source record changed
      if (changed) {
        await recomputeAllAllocations();
      }

      return { success: true, count: successfullySyncedIds.length };
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
