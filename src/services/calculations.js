// ChickPence calculations.js
// Formatting helpers + legacy helpers retained for History view.
// Core batch metrics now live in allocationEngine.js (pure functions).

export const filterActive = (rows = []) => rows.filter((r) => !r.deleted_at);
export const sumField = (arr = [], key) => arr.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);

// ---------------------------------------------------------------------------
// RUNNING MORTALITY LIST (used in Batches view)
// ---------------------------------------------------------------------------
export const calcRunningMortalityList = (batch, mortalityLogs = []) => {
  const activeLogs = filterActive(mortalityLogs);
  const sorted = [...activeLogs].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
  let runningCount = 0;
  const initialChicks = Number(batch?.initial_chick_count) || 1;

  return sorted.map((entry) => {
    runningCount += Number(entry.count) || 0;
    return {
      ...entry,
      runningCount,
      runningRate: (runningCount / initialChicks) * 100
    };
  });
};

// ---------------------------------------------------------------------------
// REVENUE
// ---------------------------------------------------------------------------
export const calcTotalRevenue = (sales = []) => {
  const activeSales = filterActive(sales);
  return sumField(activeSales, 'total_amount');
};

// ---------------------------------------------------------------------------
// FORMAT HELPERS
// ---------------------------------------------------------------------------

/** Format peso from a regular float (not centavos). */
export const formatPeso = (val) => {
  const n = Number(val) || 0;
  const isNegative = n < 0;
  const formatted = Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${isNegative ? '-' : ''}₱${formatted}`;
};

/** Format peso from integer centavos. */
export const formatPesoCentavos = (centavos) => formatPeso((Number(centavos) || 0) / 100);

export const formatPercent = (val) => {
  if (val === 'N/A') return 'N/A';
  const n = Number(val) || 0;
  return `${n.toFixed(1)}%`;
};

export const formatNumber = (val, decimals = 2) => {
  if (val === 'N/A') return 'N/A';
  return Number(val).toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

export const formatDate = (dateStr, includeYear = false) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
      timeZone: 'UTC'
    });
  } catch {
    return dateStr;
  }
};

// ---------------------------------------------------------------------------
// DASHBOARD AVERAGES (closed batches only)
// ---------------------------------------------------------------------------
export const calcDashboardAverages = (closedBatchesWithData = []) => {
  const sorted = [...closedBatchesWithData].sort((a, b) =>
    a.batch.start_date < b.batch.start_date ? -1 : 1
  );
  const last5 = sorted.slice(-5);

  if (!last5.length) {
    return { last5, avgNetProfit: 0, avgSellingPricePerKg: 0 };
  }

  const totalProfits = last5.reduce((sum, item) => sum + (item.netProfit || 0), 0);
  const avgNetProfit = totalProfits / last5.length;

  let totalSalesAmount = 0;
  let totalSalesWeight = 0;

  last5.forEach((item) => {
    const activeSales = filterActive(item.sales);
    totalSalesAmount += sumField(activeSales, 'total_amount');
    totalSalesWeight += sumField(activeSales, 'weight_kg');
  });

  const avgSellingPricePerKg = totalSalesWeight > 0 ? totalSalesAmount / totalSalesWeight : 0;

  return { last5, avgNetProfit, avgSellingPricePerKg };
};
