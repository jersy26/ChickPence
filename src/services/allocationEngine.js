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
 * using the largest-remainder method. Quotas are kept as whole numbers
 * (heads × total ÷ total heads, with its remainder), so equal remainders are
 * exactly equal. Ties go to the batch that started earlier, then to the lower
 * batch_id, so the result is deterministic.
 *
 * @param {number}   totalCentavos  – integer amount to split
 * @param {{ batchId: string, heads: number, start?: string }[]} slots – active batches with head counts
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

  // Whole part of each quota and what is left over, in whole numbers
  const floored = slots.map((s) => {
    const quota = s.heads * totalCentavos;
    return { batchId: s.batchId, start: s.start || '', floor: Math.floor(quota / totalHeads), rest: quota % totalHeads };
  });

  const totalFloor = floored.reduce((s, x) => s + x.floor, 0);
  let remainder = totalCentavos - totalFloor; // ≥ 0 and < slots.length

  // Largest leftover first; ties to the earlier start date, then the lower batchId
  const sorted = [...floored].sort((a, b) => {
    if (b.rest !== a.rest) return b.rest - a.rest;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
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
 * @param {'live'|'initial'|'equal'} [basis] – what the active batches are weighted by:
 *   live head count (the rule the app uses), initial chick count, or an equal split
 * @returns {{ rows: AllocationRow[], activeBatchCount: number } | null}
 */
export function computeAllocationsForExpense(expense, batches, mortalityLogs, sales, basis = 'live') {
  return allocate(expense, batches, groupByBatch(mortalityLogs), groupByBatch(sales), basis);
}

/** Rows of each batch, so a batch's deaths and sales are found once instead of filtered from the whole farm. */
function groupByBatch(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.batch_id)) groups.set(r.batch_id, []);
    groups.get(r.batch_id).push(r);
  }
  return groups;
}

function allocate(expense, batches, mortByBatch, salesByBatch, basis) {
  const date = expense.entry_date;

  // Gather active batches and their weights on the expense date. Which batches
  // are active never depends on the basis: only birds alive that day count.
  const slots = [];
  for (const b of batches) {
    if (b.deleted_at) continue;
    const bMort = mortByBatch.get(b.batch_id) || [];
    const bSales = salesByBatch.get(b.batch_id) || [];
    if (isBatchActiveOnDate(b, bMort, bSales, date)) {
      const live = liveHeadCount(b, bMort, bSales, date);
      slots.push({
        batchId: b.batch_id,
        start: b.start_date,
        heads: basis === 'initial' ? Number(b.initial_chick_count) || 0 : basis === 'equal' ? 1 : live
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
// 4b. SHARING-RULE COMPARISON (sensitivity, thesis Table 18)
// ---------------------------------------------------------------------------

/** The sharing rules compared: the one the app uses first. */
export const SHARING_BASES = ['live', 'initial', 'equal'];

/**
 * What one batch's share of the farm's expenses comes to under each sharing
 * rule, in centavos. Only the split changes: the same batches are active on
 * the same days, and every expense still adds up to its full amount.
 *
 * @param {string}   batchId
 * @param {object[]} expenses      – all farm expenses
 * @param {object[]} batches       – all non-deleted batches
 * @param {object[]} mortalityLogs – all non-deleted mortality logs (all batches)
 * @param {object[]} sales         – all non-deleted sales (all batches)
 * @returns {{ live: number, initial: number, equal: number }}
 */
export function sharedCostByBasis(batchId, expenses, batches, mortalityLogs, sales) {
  const mortByBatch = groupByBatch(mortalityLogs);
  const salesByBatch = groupByBatch(sales);
  const totals = { live: 0, initial: 0, equal: 0 };
  for (const expense of expenses) {
    if (expense.deleted_at) continue;
    for (const basis of SHARING_BASES) {
      const row = allocate(expense, batches, mortByBatch, salesByBatch, basis)?.rows.find((r) => r.batch_id === batchId);
      if (row) totals[basis] += row.feed_centavos + row.other_centavos;
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// 4c. LEFTOVER-BIRD HOLDING COST
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" plus n days (UTC, so no time zone shifts the date). */
function shiftDate(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;

/**
 * What an older batch's leftover birds cost the farm once a newer batch is on
 * it: the shared costs this batch took on from the day the next batch started,
 * what it takes on per day lately, and how much of its cost each live bird
 * still has to earn back. Recorded figures only, no forecast.
 *
 * @param {object}   batch
 * @param {object}   farm
 * @param {object[]} farm.batches     – all non-deleted batches
 * @param {object[]} farm.expenses    – all non-deleted farm expenses
 * @param {object[]} farm.allocations – this batch's allocation rows
 * @param {object[]} farm.mortality   – this batch's non-deleted mortality logs
 * @param {object[]} farm.sales       – this batch's non-deleted sales
 * @param {object[]} [farm.feed]      – this batch's feed logs
 * @param {string}   farm.today       – "YYYY-MM-DD"
 * @returns {null | {
 *   since: string, newerBatchName: string, days: number,
 *   holdingCentavos: number, perDayCentavos: number,
 *   liveBirds: number, unrecoveredCentavos: number, perBirdCentavos: number | null
 * }} null while no later batch has started
 */
export function leftoverHoldingCost(batch, { batches, expenses, allocations, mortality, sales, feed = [], today }) {
  const newer = batches
    .filter((b) => !b.deleted_at && b.batch_id !== batch.batch_id && b.start_date > batch.start_date && b.start_date <= today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
  if (!newer) return null;

  const since = newer.start_date;
  const end = batch.status === 'Closed' && batch.end_date && batch.end_date < today ? batch.end_date : today;
  const weekStart = shiftDate(end, -6);
  const dateOf = new Map(expenses.filter((e) => !e.deleted_at).map((e) => [e.expense_id, e.entry_date]));

  let holding = 0;
  let lastWeek = 0;
  for (const a of allocations) {
    const date = dateOf.get(a.expense_id);
    if (!date || date < since || date > end) continue;
    const share = (Number(a.feed_centavos) || 0) + (Number(a.other_centavos) || 0);
    holding += share;
    if (date >= weekStart) lastWeek += share;
  }

  // Birds still alive after today's entries; what they have left to earn back
  const liveBirds = liveHeadCount(batch, mortality, sales, shiftDate(today, 1));
  const m = calcBatchMetrics(batch, allocations, sales, mortality, feed);
  const unrecovered = Math.max(0, Math.round((m.totalCost - m.revenue) * 100));

  return {
    since,
    newerBatchName: newer.batch_name,
    days: Math.max(0, dayNumber(end) - dayNumber(since) + 1),
    holdingCentavos: holding,
    perDayCentavos: Math.round(lastWeek / 7),
    liveBirds,
    unrecoveredCentavos: unrecovered,
    perBirdCentavos: liveBirds > 0 ? Math.round(unrecovered / liveBirds) : null
  };
}

// ---------------------------------------------------------------------------
// 5. BATCH METRICS (pure)
// ---------------------------------------------------------------------------

const NA = 'N/A';

/** Convert integer centavos to peso float */
export const centavosToFloat = (c) => (Number(c) || 0) / 100;

/** A peso amount entered with up to two decimals, as whole centavos. */
export const toCentavos = (pesos) => Math.round((Number(pesos) || 0) * 100);

/** A weight entered in kg with up to three decimals, as whole grams. */
export const toGrams = (kg) => Math.round((Number(kg) || 0) * 1000);

/**
 * A sale's amount in centavos: grams × centavos per kg ÷ 1,000, rounded half up.
 * Computed from the sale's weight and price, never from a stored total.
 */
export function saleAmountCentavos(sale) {
  return Math.floor((toGrams(sale.weight_kg) * toCentavos(sale.price_per_kg) + 500) / 1000);
}

/**
 * Birds a batch has left once all its other recorded deaths and sales are
 * taken off, whatever their dates. A new or corrected death or sale may not
 * be larger than this, so no later record is left with fewer than zero birds.
 *
 * @param {object}   batch
 * @param {object[]} mortalityLogs – this batch's mortality logs
 * @param {object[]} sales         – this batch's sales
 * @param {{ mortalityId?: string, saleId?: string }} [exclude] – the entry being edited
 * @returns {number}
 */
export function remainingBirds(batch, mortalityLogs, sales, exclude = {}) {
  const deaths = mortalityLogs
    .filter((m) => !m.deleted_at && m.mortality_id !== exclude.mortalityId)
    .reduce((s, m) => s + (Number(m.count) || 0), 0);
  const sold = sales
    .filter((s) => !s.deleted_at && s.sale_id !== exclude.saleId)
    .reduce((s, x) => s + (Number(x.quantity_sold) || 0), 0);
  return (Number(batch.initial_chick_count) || 0) - deaths - sold;
}

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
  // Every amount is summed in whole centavos and grams; results are returned in pesos and kg.
  // --- Costs ---
  const activeAllocs = allocations.filter((a) => !a.deleted_at);

  const allocFeedCents = activeAllocs.reduce((s, a) => s + (Number(a.feed_centavos) || 0), 0);
  const allocOtherCents = activeAllocs.reduce((s, a) => s + (Number(a.other_centavos) || 0), 0);
  const chickCents = toCentavos(batch.chick_cost);
  const totalCents = chickCents + allocFeedCents + allocOtherCents;

  const allocFeedPeso = centavosToFloat(allocFeedCents);
  const allocOtherPeso = centavosToFloat(allocOtherCents);
  const chickCost = centavosToFloat(chickCents);
  const totalCost = centavosToFloat(totalCents);

  // --- Revenue: each sale is weight × price, rounded half up to the centavo ---
  const activeSales = sales.filter((s) => !s.deleted_at);
  const revenueCents = activeSales.reduce((s, x) => s + saleAmountCentavos(x), 0);
  const revenue = centavosToFloat(revenueCents);

  // --- Net profit & margin ---
  const netCents = revenueCents - totalCents;
  const netProfit = centavosToFloat(netCents);
  const margin = revenueCents > 0 ? (netCents / revenueCents) * 100 : NA;

  // --- Kg sold ---
  const gramsSold = activeSales.reduce((s, x) => s + toGrams(x.weight_kg), 0);
  const kgSold = gramsSold / 1000;

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
  // Feed is stored as integer grams (quantity_g). Divide by 1000 to get kg
  // for FCR computation. Falls back to quantity_kg for any pre-migration rows.
  const activeFeed = feedLogs.filter((f) => !f.deleted_at);
  const totalFeedKg = activeFeed.reduce((s, f) => {
    if (f.quantity_g !== undefined) return s + (Number(f.quantity_g) || 0) / 1000;
    return s + (Number(f.quantity_kg) || 0); // legacy fallback
  }, 0);
  const fcr = kgSold > 0 ? totalFeedKg / kgSold : NA;

  // --- ROBC ---
  const robc = totalCents > 0 ? (netCents / totalCents) * 100 : NA;

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
