import Dexie from 'dexie';

export class ChickPenceDatabase extends Dexie {
  constructor() {
    super('ChickPenceDB');

    // v1 – original schema
    this.version(1).stores({
      batches: 'batch_id, user_id, batch_name, start_date, status, updated_at, deleted_at',
      daily_costs: 'cost_id, batch_id, entry_date, updated_at, deleted_at',
      feed_logs: 'feed_log_id, batch_id, entry_date, updated_at, deleted_at',
      mortality_logs: 'mortality_id, batch_id, entry_date, updated_at, deleted_at',
      sales: 'sale_id, batch_id, sale_date, updated_at, deleted_at',
      outbox: '++id, table_name, record_id, action, updated_at',
      app_state: 'key'
    });

    // v2 – multi-batch: farm-level expenses, allocations, status rename Open/Closed
    this.version(2)
      .stores({
        batches: 'batch_id, user_id, batch_name, start_date, status, updated_at, deleted_at',
        // daily_costs kept for upgrade migration; will be cleared after migration
        daily_costs: 'cost_id, batch_id, entry_date, updated_at, deleted_at',
        feed_logs: 'feed_log_id, batch_id, entry_date, updated_at, deleted_at',
        mortality_logs: 'mortality_id, batch_id, entry_date, updated_at, deleted_at',
        sales: 'sale_id, batch_id, sale_date, updated_at, deleted_at',
        // NEW: farm-level expenses (replace daily_costs conceptually)
        expenses: 'expense_id, entry_date, updated_at, deleted_at',
        // NEW: derived allocation rows – NOT synced; recomputed locally
        allocations: '[expense_id+batch_id], expense_id, batch_id',
        outbox: '++id, table_name, record_id, action, updated_at',
        app_state: 'key'
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();

        // 1. Rename batch statuses: Active → Open, Completed → Closed
        await tx.table('batches').toCollection().modify((b) => {
          if (b.status === 'Active') b.status = 'Open';
          else if (b.status === 'Completed') b.status = 'Closed';
          // Remove deprecated fields
          delete b.cost_budget;
        });

        // 2. Migrate daily_costs → expenses (one expense per cost row, 100% to original batch)
        const allCosts = await tx.table('daily_costs').toArray();

        for (const c of allCosts) {
          if (c.deleted_at) continue; // skip soft-deleted

          const feedCentavos = Math.round((Number(c.feed_cost) || 0) * 100);
          const otherCentavos = Math.round(
            ((Number(c.medicine_cost) || 0) +
              (Number(c.utilities_cost) || 0) +
              (Number(c.labor_cost) || 0) +
              (Number(c.transport_cost) || 0) +
              (Number(c.other_cost) || 0)) *
              100
          );

          // Skip if both zero
          if (feedCentavos === 0 && otherCentavos === 0) continue;

          const expenseId = c.cost_id; // reuse same UUID → idempotent if run twice
          const expense = {
            expense_id: expenseId,
            entry_date: c.entry_date,
            feed_centavos: feedCentavos,
            other_centavos: otherCentavos,
            updated_at: c.updated_at || now,
            deleted_at: null,
            // Store the original batch_id for migration-only allocation
            _migrated_batch_id: c.batch_id
          };

          await tx.table('expenses').put(expense);

          // Write allocation: 100% to original batch (basis_heads = 1, total_heads = 1)
          await tx.table('allocations').put({
            expense_id: expenseId,
            batch_id: c.batch_id,
            feed_centavos: feedCentavos,
            other_centavos: otherCentavos,
            basis_heads: 1,
            total_heads: 1
          });
        }
      });
  }
}

export const db = new ChickPenceDatabase();
