import { db } from '../db/dexie.js';
import { syncEngine } from './syncEngine.js';
import { DEMO_USER_ID } from '../db/seed.js';
import { recomputeAllocations, recomputeAllocationsForExpenseIds, recomputeAllAllocations } from './allocationService.js';
import { computeAllocationsForExpense } from './allocationEngine.js';

export const Repository = {
  // ---------------------------------------------------------------------------
  // BATCH QUERIES
  // ---------------------------------------------------------------------------

  /** All non-deleted open batches */
  async getOpenBatches() {
    const batches = await db.batches
      .filter((b) => b.status === 'Open' && !b.deleted_at)
      .toArray();
    return batches.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  },

  async getBatchById(batchId) {
    const batch = await db.batches.get(batchId);
    return batch && !batch.deleted_at ? batch : null;
  },

  async getAllBatches() {
    const batches = await db.batches.filter((b) => !b.deleted_at).toArray();
    return batches.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  },

  async getBatchFeed(batchId) {
    const logs = await db.feed_logs
      .filter((f) => f.batch_id === batchId && !f.deleted_at)
      .toArray();
    return logs.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  },

  async getBatchMortality(batchId) {
    const logs = await db.mortality_logs
      .filter((m) => m.batch_id === batchId && !m.deleted_at)
      .toArray();
    return logs.sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
  },

  async getBatchSales(batchId) {
    const sales = await db.sales
      .filter((s) => s.batch_id === batchId && !s.deleted_at)
      .toArray();
    return sales.sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1));
  },

  async getBatchAllocations(batchId) {
    return await db.allocations
      .where('batch_id').equals(batchId)
      .toArray();
  },

  async getBatchFullDetails(batchId) {
    const batch = await this.getBatchById(batchId);
    if (!batch) return null;

    const [feed, mortality, sales, allocations] = await Promise.all([
      this.getBatchFeed(batchId),
      this.getBatchMortality(batchId),
      this.getBatchSales(batchId),
      this.getBatchAllocations(batchId)
    ]);

    return { batch, feed, mortality, sales, allocations };
  },

  async getClosedBatchesWithData() {
    const closed = await db.batches
      .filter((b) => b.status === 'Closed' && !b.deleted_at)
      .toArray();

    const results = [];
    for (const b of closed) {
      const [sales, allocations, mortality, feed] = await Promise.all([
        this.getBatchSales(b.batch_id),
        this.getBatchAllocations(b.batch_id),
        this.getBatchMortality(b.batch_id),
        this.getBatchFeed(b.batch_id)
      ]);
      results.push({ batch: b, sales, allocations, mortality, feed });
    }
    return results.sort((a, b) => (a.batch.start_date < b.batch.start_date ? -1 : 1));
  },

  // ---------------------------------------------------------------------------
  // EXPENSE QUERIES
  // ---------------------------------------------------------------------------

  async getAllExpenses() {
    const exp = await db.expenses.filter((e) => !e.deleted_at).toArray();
    return exp.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  },

  async getExpenseById(expenseId) {
    const e = await db.expenses.get(expenseId);
    return e && !e.deleted_at ? e : null;
  },

  // ---------------------------------------------------------------------------
  // BATCH MUTATIONS
  // ---------------------------------------------------------------------------

  async createBatch({ batch_name, start_date, initial_chick_count, chick_cost, mortality_threshold_pct, user_id }) {
    // No single-batch guard — multiple open batches are allowed
    const batch = {
      batch_id: crypto.randomUUID(),
      user_id: user_id || DEMO_USER_ID,
      batch_name,
      start_date,
      end_date: null,
      initial_chick_count: Number(initial_chick_count),
      chick_cost: Number(chick_cost) || 0,
      mortality_threshold_pct:
        mortality_threshold_pct != null && mortality_threshold_pct !== ''
          ? Number(mortality_threshold_pct)
          : null,
      status: 'Open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null
    };

    return await syncEngine.queueUpsert('batches', batch);
  },

  async updateBatchThresholds(batchId, { mortality_threshold_pct }) {
    const batch = await db.batches.get(batchId);
    if (!batch) throw new Error('Batch not found');

    const updated = {
      ...batch,
      mortality_threshold_pct:
        mortality_threshold_pct != null && mortality_threshold_pct !== ''
          ? Number(mortality_threshold_pct)
          : null
    };

    return await syncEngine.queueUpsert('batches', updated);
  },

  async closeBatch(batchId, endDate = new Date().toISOString().slice(0, 10)) {
    const batch = await db.batches.get(batchId);
    if (!batch) throw new Error('Batch not found');

    const updated = {
      ...batch,
      status: 'Closed',
      end_date: endDate
    };

    return await syncEngine.queueUpsert('batches', updated);
  },

  // ---------------------------------------------------------------------------
  // EXPENSE MUTATIONS (farm-level)
  // ---------------------------------------------------------------------------

  /**
   * Save a farm-level expense.  Validates that at least one batch is active on
   * that date before committing.  Returns the saved expense or throws.
   */
  async saveExpense(expense) {
    const feedPeso = Number(expense.feed_amount) || 0;
    const otherPeso = Number(expense.other_amount) || 0;

    if (feedPeso === 0 && otherPeso === 0) {
      throw new Error('At least one of Feed or Other costs must be greater than zero.');
    }

    const feedCentavos = Math.round(feedPeso * 100);
    const otherCentavos = Math.round(otherPeso * 100);

    const record = {
      expense_id: expense.expense_id || crypto.randomUUID(),
      entry_date: expense.entry_date,
      feed_centavos: feedCentavos,
      other_centavos: otherCentavos,
      updated_at: new Date().toISOString(),
      deleted_at: null
    };

    // Validate: at least one active batch on this date
    const [allBatches, allMort, allSales] = await Promise.all([
      db.batches.filter((b) => !b.deleted_at).toArray(),
      db.mortality_logs.filter((m) => !m.deleted_at).toArray(),
      db.sales.filter((s) => !s.deleted_at).toArray()
    ]);

    const testResult = computeAllocationsForExpense(record, allBatches, allMort, allSales);
    if (!testResult) {
      throw new Error(`No batch is active on ${expense.entry_date}. Expense cannot be allocated.`);
    }

    // Save and recompute in one transaction
    await db.transaction(
      'rw',
      [db.expenses, db.allocations, db.batches, db.mortality_logs, db.sales],
      async (tx) => {
        await tx.table('expenses').put(record);
        await recomputeAllocations(tx, [record.expense_id]);
      }
    );

    await syncEngine.queueUpsert('expenses', record);
    return record;
  },

  async voidExpense(expenseId) {
    const expense = await db.expenses.get(expenseId);
    if (!expense) throw new Error('Expense not found');

    const voided = {
      ...expense,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await db.transaction(
      'rw',
      [db.expenses, db.allocations, db.batches, db.mortality_logs, db.sales],
      async (tx) => {
        await tx.table('expenses').put(voided);
        // Remove allocations for this expense
        await tx.table('allocations').where('expense_id').equals(expenseId).delete();
      }
    );

    await syncEngine.queueUpsert('expenses', voided);
  },

  // ---------------------------------------------------------------------------
  // FEED LOG MUTATIONS (batch-scoped)
  // ---------------------------------------------------------------------------

  async saveFeedLog(log) {
    const record = {
      feed_log_id: log.feed_log_id || crypto.randomUUID(),
      batch_id: log.batch_id,
      entry_date: log.entry_date,
      quantity_kg: Number(log.quantity_kg) || 0,
      updated_at: new Date().toISOString(),
      deleted_at: null
    };
    return await syncEngine.queueUpsert('feed_logs', record);
  },

  // ---------------------------------------------------------------------------
  // MORTALITY LOG MUTATIONS
  // ---------------------------------------------------------------------------

  async saveMortalityLog(log) {
    const record = {
      mortality_id: log.mortality_id || crypto.randomUUID(),
      batch_id: log.batch_id,
      entry_date: log.entry_date,
      count: Number(log.count) || 0,
      updated_at: new Date().toISOString(),
      deleted_at: null
    };

    // Save mortality and recompute allocations (backdated deaths affect allocation basis)
    await db.transaction(
      'rw',
      [db.mortality_logs, db.expenses, db.allocations, db.batches, db.sales],
      async (tx) => {
        await tx.table('mortality_logs').put(record);
        // Recompute ALL allocations since any date after this mortality may be affected
        await recomputeAllocations(tx);
      }
    );

    await syncEngine.queueUpsert('mortality_logs', record);
    return record;
  },

  // ---------------------------------------------------------------------------
  // SALES MUTATIONS
  // ---------------------------------------------------------------------------

  async saveSale(sale) {
    const qty = Number(sale.quantity_sold) || 0;
    const kg = Number(sale.weight_kg) || 0;
    const ppk = Number(sale.price_per_kg) || 0;
    const total = +(kg * ppk).toFixed(2);

    const record = {
      sale_id: sale.sale_id || crypto.randomUUID(),
      batch_id: sale.batch_id,
      sale_date: sale.sale_date,
      buyer_name: sale.buyer_name,
      quantity_sold: qty,
      weight_kg: kg,
      price_per_kg: ppk,
      total_amount: total,
      updated_at: new Date().toISOString(),
      deleted_at: null
    };

    // Save sale and recompute allocations (backdated sales affect head count)
    await db.transaction(
      'rw',
      [db.sales, db.expenses, db.allocations, db.batches, db.mortality_logs],
      async (tx) => {
        await tx.table('sales').put(record);
        await recomputeAllocations(tx);
      }
    );

    await syncEngine.queueUpsert('sales', record);
    return record;
  },

  // ---------------------------------------------------------------------------
  // GENERIC SOFT DELETE
  // ---------------------------------------------------------------------------

  async deleteRecord(table, recordId) {
    await syncEngine.queueSoftDelete(table, recordId);

    // After any deletion that could affect allocation sources, recompute
    if (['mortality_logs', 'sales', 'expenses'].includes(table)) {
      await recomputeAllAllocations();
    }
  }
};
