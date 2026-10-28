import { db } from '../db/dexie.js';
import { computeAllocationsForExpense } from './allocationEngine.js';

/**
 * Recompute all allocation rows for a set of expense_ids (or all expenses if none given).
 * Must be called inside a Dexie transaction that includes expenses, allocations,
 * batches, mortality_logs, and sales.
 *
 * Allocations are derived data (never synced), so they are rebuilt rather than
 * patched: rows of an expense that was deleted (here or on another device) or
 * discarded go too, instead of staying in its batches' costs.
 *
 * Pass tx = the Dexie transaction object.
 */
export async function recomputeAllocations(tx, expenseIds = null) {
  // Load source data
  const [allBatches, allMort, allSales] = await Promise.all([
    tx.table('batches').filter((b) => !b.deleted_at).toArray(),
    tx.table('mortality_logs').filter((m) => !m.deleted_at).toArray(),
    tx.table('sales').filter((s) => !s.deleted_at).toArray()
  ]);

  let expensesToProcess;
  if (expenseIds && expenseIds.length) {
    await tx.table('allocations').where('expense_id').anyOf(expenseIds).delete();
    expensesToProcess = (await tx.table('expenses').bulkGet(expenseIds)).filter((e) => e && !e.deleted_at);
  } else {
    await tx.table('allocations').clear();
    expensesToProcess = await tx.table('expenses').filter((e) => !e.deleted_at).toArray();
  }

  for (const expense of expensesToProcess) {
    const result = computeAllocationsForExpense(expense, allBatches, allMort, allSales);
    if (result) await tx.table('allocations').bulkPut(result.rows);
  }
}

/**
 * Convenience: recompute in a fresh transaction (for use after pulls).
 */
export async function recomputeAllAllocations() {
  await db.transaction(
    'rw',
    [db.expenses, db.allocations, db.batches, db.mortality_logs, db.sales],
    async (tx) => {
      await recomputeAllocations(tx);
    }
  );
}
