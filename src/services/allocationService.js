import { db } from '../db/dexie.js';
import { computeAllocationsForExpense } from './allocationEngine.js';

/**
 * Recompute all allocation rows for a set of expense_ids (or all expenses if none given).
 * Must be called inside a Dexie transaction that includes expenses, allocations,
 * batches, mortality_logs, and sales.
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
    expensesToProcess = await Promise.all(expenseIds.map((id) => tx.table('expenses').get(id)));
    expensesToProcess = expensesToProcess.filter(Boolean).filter((e) => !e.deleted_at);
  } else {
    expensesToProcess = await tx.table('expenses').filter((e) => !e.deleted_at).toArray();
  }

  for (const expense of expensesToProcess) {
    // Delete existing allocation rows for this expense
    await tx.table('allocations').where('expense_id').equals(expense.expense_id).delete();

    const result = computeAllocationsForExpense(expense, allBatches, allMort, allSales);
    if (result) {
      for (const row of result.rows) {
        await tx.table('allocations').put(row);
      }
    }
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

/**
 * Recompute allocations for expenses on a specific set of dates or a single expense.
 */
export async function recomputeAllocationsForExpenseIds(expenseIds) {
  if (!expenseIds.length) return;
  await db.transaction(
    'rw',
    [db.expenses, db.allocations, db.batches, db.mortality_logs, db.sales],
    async (tx) => {
      await recomputeAllocations(tx, expenseIds);
    }
  );
}
