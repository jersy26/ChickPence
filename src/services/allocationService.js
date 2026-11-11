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
 *
 * keepShared: refuse (throw, so the transaction rolls back) a change that
 * leaves an expense which had batches to share it with none, e.g. a backdated
 * sale of a batch's last birds. Otherwise that cost would drop out of every
 * batch's total (FR-08). Off for rebuilds after a pull from the cloud.
 */
export async function recomputeAllocations(tx, expenseIds = null, { keepShared = false } = {}) {
  // Load source data
  const [allBatches, allMort, allSales] = await Promise.all([
    tx.table('batches').filter((b) => !b.deleted_at).toArray(),
    tx.table('mortality_logs').filter((m) => !m.deleted_at).toArray(),
    tx.table('sales').filter((s) => !s.deleted_at).toArray()
  ]);

  // Expenses shared before this change; one already without a batch is left as it is
  const sharedBefore = keepShared
    ? new Set((await (expenseIds && expenseIds.length
        ? tx.table('allocations').where('expense_id').anyOf(expenseIds).toArray()
        : tx.table('allocations').toArray())).map((a) => a.expense_id))
    : null;

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
    else if (sharedBefore?.has(expense.expense_id)) {
      throw new Error(
        `This would leave no batch with live birds on ${expense.entry_date}, so that day's expense would belong to no batch. Edit or delete that expense first.`
      );
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
