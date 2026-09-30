import Dexie from 'dexie';

export class ChickPenceDatabase extends Dexie {
  constructor() {
    super('ChickPenceDB');
    this.version(1).stores({
      batches: 'batch_id, user_id, batch_name, start_date, status, updated_at, deleted_at',
      daily_costs: 'cost_id, batch_id, entry_date, updated_at, deleted_at',
      feed_logs: 'feed_log_id, batch_id, entry_date, updated_at, deleted_at',
      mortality_logs: 'mortality_id, batch_id, entry_date, updated_at, deleted_at',
      sales: 'sale_id, batch_id, sale_date, updated_at, deleted_at',
      outbox: '++id, table_name, record_id, action, updated_at',
      app_state: 'key'
    });
  }
}

export const db = new ChickPenceDatabase();
