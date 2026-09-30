// ChickPence Relational Calculations Service
// Strictly implements computed values from ChickPence ERD v1.2 and PRD v1.5

export const filterActive = (rows = []) => rows.filter((r) => !r.deleted_at);

export const sumField = (arr = [], key) => arr.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);

export const calcDailyCostRowTotal = (c) => {
  return (
    (Number(c.feed_cost) || 0) +
    (Number(c.medicine_cost) || 0) +
    (Number(c.utilities_cost) || 0) +
    (Number(c.labor_cost) || 0) +
    (Number(c.transport_cost) || 0) +
    (Number(c.other_cost) || 0)
  );
};

export const calcCostBreakdown = (batch, dailyCosts = []) => {
  const activeCosts = filterActive(dailyCosts);
  return {
    Chicks: Number(batch?.chick_cost) || 0,
    Feed: sumField(activeCosts, 'feed_cost'),
    Medicine: sumField(activeCosts, 'medicine_cost'),
    Utilities: sumField(activeCosts, 'utilities_cost'),
    Labor: sumField(activeCosts, 'labor_cost'),
    Transport: sumField(activeCosts, 'transport_cost'),
    Other: sumField(activeCosts, 'other_cost')
  };
};

export const calcTotalProductionCost = (batch, dailyCosts = []) => {
  const breakdown = calcCostBreakdown(batch, dailyCosts);
  return Object.values(breakdown).reduce((a, b) => a + b, 0);
};

export const calcHighestCostCategory = (breakdown) => {
  const entries = Object.entries(breakdown);
  if (!entries.length) return { category: 'None', amount: 0 };
  return entries.reduce(
    (max, cur) => (cur[1] > max.amount ? { category: cur[0], amount: cur[1] } : max),
    { category: entries[0][0], amount: entries[0][1] }
  );
};

export const calcTotalRevenue = (sales = []) => {
  const activeSales = filterActive(sales);
  return sumField(activeSales, 'total_amount');
};

export const calcNetProfit = (revenue, totalCost) => {
  return revenue - totalCost;
};

export const calcProfitMargin = (netProfit, revenue) => {
  if (!revenue || revenue <= 0) return 0;
  return (netProfit / revenue) * 100;
};

export const calcTotalFeedConsumed = (feedLogs = []) => {
  const activeFeed = filterActive(feedLogs);
  return sumField(activeFeed, 'quantity_kg');
};

export const calcMortalityMetrics = (batch, mortalityLogs = []) => {
  const activeLogs = filterActive(mortalityLogs);
  const totalDeaths = sumField(activeLogs, 'count');
  const initialChicks = Number(batch?.initial_chick_count) || 1;
  const rate = (totalDeaths / initialChicks) * 100;
  return {
    totalDeaths,
    mortalityRate: rate
  };
};

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

export const evaluateBatchWarnings = (batch, dailyCosts = [], mortalityLogs = []) => {
  const totalCost = calcTotalProductionCost(batch, dailyCosts);
  const { mortalityRate } = calcMortalityMetrics(batch, mortalityLogs);

  const mortalityFlag =
    batch?.mortality_threshold_pct != null && mortalityRate > Number(batch.mortality_threshold_pct);

  const costFlag =
    batch?.cost_budget != null && totalCost > Number(batch.cost_budget);

  return {
    totalCost,
    mortalityRate,
    mortalityFlag,
    costFlag,
    mortalityThreshold: batch?.mortality_threshold_pct,
    costBudget: batch?.cost_budget
  };
};

export const calcDashboardAverages = (completedBatchesWithData = []) => {
  // Take up to 5 most recent completed batches by start_date
  const sorted = [...completedBatchesWithData].sort((a, b) =>
    a.batch.start_date < b.batch.start_date ? -1 : 1
  );
  const last5 = sorted.slice(-5);

  if (!last5.length) {
    return {
      last5,
      avgNetProfit: 0,
      avgSellingPricePerKg: 0
    };
  }

  const totalProfits = last5.reduce((sum, item) => sum + item.netProfit, 0);
  const avgNetProfit = totalProfits / last5.length;

  let totalSalesAmount = 0;
  let totalSalesWeight = 0;

  last5.forEach((item) => {
    const activeSales = filterActive(item.sales);
    totalSalesAmount += sumField(activeSales, 'total_amount');
    totalSalesWeight += sumField(activeSales, 'weight_kg');
  });

  const avgSellingPricePerKg =
    totalSalesWeight > 0 ? totalSalesAmount / totalSalesWeight : 0;

  return {
    last5,
    avgNetProfit,
    avgSellingPricePerKg
  };
};

// Formatting helpers
export const formatPeso = (val) => {
  const n = Number(val) || 0;
  const isNegative = n < 0;
  const formatted = Math.abs(Math.round(n)).toLocaleString('en-US');
  return `${isNegative ? '-' : ''}₱${formatted}`;
};

export const formatPercent = (val) => {
  const n = Number(val) || 0;
  return `${n.toFixed(1)}%`;
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
