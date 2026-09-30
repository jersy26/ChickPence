/**
 * allocationEngine.js
 * Pure functions for multi-batch allocation, live head count, and batch metrics.
 * No Dexie, no UI. Import and test freely.
 */

// ---------------------------------------------------------------------------
// 1. LIVE HEAD COUNT
// ---------------------------------------------------------------------------

/**
 * Returns the live head count of a batch on a given date.
 * Live = initial_chick_count − deaths with entry_date < date − birds sold with sale_date < date
 * (Strict less-than so the date itself is not yet consumed.)
 *
 * @param {object} batch         – batch record (must have initial_chick_count)
 * @param {object[]} mortalityLogs – all non-deleted mortality rows for this batch
 * @param {object[]} sales         – all non-deleted sales rows for this batch
 * @param {string} date            – ISO date "YYYY-MM-DD"
 * @returns {number} live head count (clamped ≥ 0)
 */
export function liveHeadCount(batch, mortalityLogs, sales, date) {
  const initial = Number(batch.initial_chick_count) || 0;

  const deaths = mortalityLogs
    .filter((m) => !m.deleted_at && m.entry_date < date)
    .reduce((sum, m) => sum + (Number(m.count) || 0), 0);

  const sold = sales
    .filter((s) => !s.deleted_at && s.sale_date < date)
    .reduce((sum, s) => sum + (Number(s.quantity_sold) || 0), 0);

  return Math.max(0, initial - deaths - sold);
}

// ---------------------------------------------------------------------------
// 2. BATCH ACTIVE ON DATE
// ---------------------------------------------------------------------------

/**
 * A batch is "active on a date" iff start_date ≤ date AND live head count on that date > 0.
 *
 * @param {object}   batch
 * @param {object[]} mortalityLogs
 * @param {object[]} sales
 * @param {string}   date  ISO "YYYY-MM-DD"
 * @returns {boolean}
 */
export function isBatchActiveOnDate(batch, mortalityLogs, sales, date) {
  if (!batch || !date) return false;
  if (batch.start_date > date) return false;
  return liveHeadCount(batch, mortalityLogs, sales, date) > 0;
}

// ---------------------------------------------------------------------------
// 3. LARGEST-REMAINDER ALLOCATION (centavos)
// ---------------------------------------------------------------------------

/**
 * Split an integer centavo total among batches in proportion to their head counts,
 * using the largest-remainder method.  Ties (equal fractional parts) are broken by
 * lower batch_id (lexicographic) getting priority – so the result is deterministic.
 *
 * @param {number}   totalCentavos  – integer amount to split
 * @param {{ batchId: string, heads: number }[]} slots – active batches with head counts
 * @returns {{ batchId: string, shareCentavos: number }[]}
 */
export function largestRemainderSplit(totalCentavos, slots) {
  if (!slots.length || totalCentavos <= 0) {
    return slots.map((s) => ({ batchId: s.batchId, shareCentavos: 0 }));
  }

  const totalHeads = slots.reduce((s, x) => s + x.heads, 0);
  if (totalHeads === 0) {
    return slots.map((s) => ({ batchId: s.batchId, shareCentavos: 0 }));
  }

  // Exact (real) share for each slot
  const exact = slots.map((s) => ({
    batchId: s.batchId,
    heads: s.heads,
    real: (s.heads / totalHeads) * totalCentavos
  }));

  // Floor shares
  const floored = exact.map((x) => ({ ...x, floor: Math.floor(x.real), frac: x.real - Math.floor(x.real) }));

  const totalFloor = floored.reduce((s, x) => s + x.floor, 0);
  let remainder = totalCentavos - totalFloor; // ≥ 0 and < slots.length

  // Sort by descending frac, then ascending batchId (tie-break)
  const sorted = [...floored].sort((a, b) => {
    if (Math.abs(b.frac - a.frac) > 1e-10) return b.frac - a.frac;
    return a.batchId < b.batchId ? -1 : 1;
  });

  const extra = new Set();
  for (let i = 0; i < remainder; i++) {
    extra.add(sorted[i].batchId);
  }

  return floored.map((x) => ({
    batchId: x.batchId,
    shareCentavos: x.floor + (extra.has(x.batchId) ? 1 : 0)
  }));
}

// ---------------------------------------------------------------------------
// 4. COMPUTE ALLOCATIONS FOR ONE EXPENSE
// ---------------------------------------------------------------------------

/**
 * Given a farm-level expense and a full picture of all batches, returns allocation rows.
 * Returns null if no batch is active on the expense date (caller should reject).
 *
 * @param {object}   expense       – { expense_id, entry_date, feed_centavos, other_centavos }
 * @param {object[]} batches       – all non-deleted batches
 * @param {object[]} mortalityLogs – all non-deleted mortality logs (all batches)
 * @param {object[]} sales         – all non-deleted sales (all batches)
 * @returns {{ rows: AllocationRow[], activeBatchCount: number } | null}
 */
export function computeAllocationsForExpense(expense, batches, mortalityLogs, sales) {
  const date = expense.entry_date;

  // Gather active batches and their live head counts on the expense date
  const slots = [];
  for (const b of batches) {
    if (b.deleted_at) continue;
    const bMort = mortalityLogs.filter((m) => m.batch_id === b.batch_id);
    const bSales = sales.filter((s) => s.batch_id === b.batch_id);
    if (isBatchActiveOnDate(b, bMort, bSales, date)) {
      slots.push({
        batchId: b.batch_id,
        heads: liveHeadCount(b, bMort, bSales, date)
      });
    }
  }

  if (!slots.length) return null;

  const totalHeads = slots.reduce((s, x) => s + x.heads, 0);

  const feedSplit = largestRemainderSplit(expense.feed_centavos, slots);
  const otherSplit = largestRemainderSplit(expense.other_centavos, slots);

  const feedMap = Object.fromEntries(feedSplit.map((x) => [x.batchId, x.shareCentavos]));
  const otherMap = Object.fromEntries(otherSplit.map((x) => [x.batchId, x.shareCentavos]));

  const rows = slots.map((s) => ({
    expense_id: expense.expense_id,
    batch_id: s.batchId,
    feed_centavos: feedMap[s.batchId] ?? 0,
    other_centavos: otherMap[s.batchId] ?? 0,
    basis_heads: s.heads,
    total_heads: totalHeads
  }));

  return { rows, activeBatchCount: slots.length };
}

// ---------------------------------------------------------------------------
// 5. BATCH METRICS (pure)
// ---------------------------------------------------------------------------

const NA = 'N/A';

/** Convert integer centavos to peso float */
export const centavosToFloat = (c) => (Number(c) || 0) / 100;

/**
 * Compute all thesis metrics for a single batch.
 * All monetary inputs expected as integer centavos.
 *
 * @param {object}   batch
 * @param {object[]} allocations   – allocation rows for this batch
 * @param {object[]} sales         – non-deleted sales for this batch
 * @param {object[]} mortalityLogs – non-deleted mortality logs for this batch
 * @param {object[]} feedLogs      – non-deleted feed logs for this batch
 * @returns {object} metrics object
 */
export function calcBatchMetrics(batch, allocations, sales, mortalityLogs, feedLogs) {
  // --- Costs (centavos → peso) ---
  const activeAllocs = allocations.filter((a) => !a.deleted_at);

  const allocFeedPeso = centavosToFloat(activeAllocs.reduce((s, a) => s + (Number(a.feed_centavos) || 0), 0));
  const allocOtherPeso = centavosToFloat(activeAllocs.reduce((s, a) => s + (Number(a.other_centavos) || 0), 0));
  const chickCost = Number(batch.chick_cost) || 0;

  const totalCost = chickCost + allocFeedPeso + allocOtherPeso;

  // --- Revenue ---
  const activeSales = sales.filter((s) => !s.deleted_at);
  const revenue = activeSales.reduce((s, x) => s + (Number(x.total_amount) || 0), 0);

  // --- Net profit & margin ---
  const netProfit = revenue - totalCost;
  const margin = revenue > 0 ? (netProfit / revenue) * 100 : NA;

  // --- Kg sold ---
  const kgSold = activeSales.reduce((s, x) => s + (Number(x.weight_kg) || 0), 0);

  // --- Cost per kg ---
  const costPerKg = kgSold > 0 ? totalCost / kgSold : NA;

  // --- Profit per kg ---
  const profitPerKg = kgSold > 0 ? netProfit / kgSold : NA;

  // --- Mortality rate ---
  const initialChicks = Number(batch.initial_chick_count) || 1;
  const activeMort = mortalityLogs.filter((m) => !m.deleted_at);
  const totalDeaths = activeMort.reduce((s, m) => s + (Number(m.count) || 0), 0);
  const mortalityRate = (totalDeaths / initialChicks) * 100;

  // --- FCR ---
  const activeFeed = feedLogs.filter((f) => !f.deleted_at);
  const totalFeedKg = activeFeed.reduce((s, f) => s + (Number(f.quantity_kg) || 0), 0);
  const fcr = kgSold > 0 ? totalFeedKg / kgSold : NA;

  // --- ROBC ---
  const robc = totalCost > 0 ? (netProfit / totalCost) * 100 : NA;

  return {
    chickCost,
    allocFeedPeso,
    allocOtherPeso,
    totalCost,
    revenue,
    netProfit,
    margin,
    kgSold,
    costPerKg,
    profitPerKg,
    totalDeaths,
    mortalityRate,
    totalFeedKg,
    fcr,
    robc
  };
}

// ---------------------------------------------------------------------------
// 6. MORTALITY WARNING EVAL (pure, replaces evaluateBatchWarnings)
// ---------------------------------------------------------------------------
export function evalMortalityWarning(batch, mortalityLogs) {
  const initialChicks = Number(batch.initial_chick_count) || 1;
  const activeMort = mortalityLogs.filter((m) => !m.deleted_at);
  const totalDeaths = activeMort.reduce((s, m) => s + (Number(m.count) || 0), 0);
  const mortalityRate = (totalDeaths / initialChicks) * 100;
  const mortalityFlag =
    batch.mortality_threshold_pct != null && mortalityRate > Number(batch.mortality_threshold_pct);
  return { totalDeaths, mortalityRate, mortalityFlag, mortalityThreshold: batch.mortality_threshold_pct };
}
