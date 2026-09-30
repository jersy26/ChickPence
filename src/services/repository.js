import { db } from '../db/dexie.js';
import { syncEngine } from './syncEngine.js';
import { DEMO_USER_ID } from '../db/seed.js';

export const Repository = {
  // Batch queries
  async getActiveBatch() {
    const batches = await db.batches
      .filter((b) => b.status === 'Active' && !b.deleted_at)
      .toArray();
    return batches[0] || null;
  },

  async getBatchById(batchId) {
    const batch = await db.batches.get(batchId);
    return batch && !batch.deleted_at ? batch : null;
  },

  async getAllBatches() {
    const batches = await db.batches
      .filter((b) => !b.deleted_at)
      .toArray();
    return batches.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  },

  async getBatchCosts(batchId) {
    const costs = await db.daily_costs
      .filter((c) => c.batch_id === batchId && !c.deleted_at)
      .toArray();
    return costs.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
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

  async getBatchFullDetails(batchId) {
    const batch = await this.getBatchById(batchId);
    if (!batch) return null;

    const [costs, feed, mortality, sales] = await Promise.all([
      this.getBatchCosts(batchId),
      this.getBatchFeed(batchId),
      this.getBatchMortality(batchId),
      this.getBatchSales(batchId)
    ]);

    return {
      batch,
      costs,
      feed,
      mortality,
      sales
    };
  },

  async getCompletedBatchesWithData() {
    const completed = await db.batches
      .filter((b) => b.status === 'Completed' && !b.deleted_at)
      .toArray();

    const results = [];
    for (const b of completed) {
      const [costs, sales] = await Promise.all([
        this.getBatchCosts(b.batch_id),
        this.getBatchSales(b.batch_id)
      ]);
      const totalCost = (Number(b.chick_cost) || 0) + costs.reduce((s, c) =>
        s + (Number(c.feed_cost) || 0) + (Number(c.medicine_cost) || 0) + (Number(c.utilities_cost) || 0) +
        (Number(c.labor_cost) || 0) + (Number(c.transport_cost) || 0) + (Number(c.other_cost) || 0), 0);
      const totalRevenue = sales.reduce((s, x) => s + (Number(x.total_amount) || 0), 0);
      const netProfit = totalRevenue - totalCost;

      results.push({
        batch: b,
        costs,
        sales,
        totalCost,
        totalRevenue,
        netProfit
      });
    }

    return results.sort((a, b) => (a.batch.start_date < b.batch.start_date ? -1 : 1));
  },

  // Mutations
  async createBatch({ batch_name, start_date, initial_chick_count, chick_cost, mortality_threshold_pct, cost_budget, user_id }) {
    // Check if an active batch already exists
    const existingActive = await this.getActiveBatch();
    if (existingActive) {
      throw new Error('A batch is already Active. Only one active batch is allowed at a time.');
    }

    const batch = {
      batch_id: crypto.randomUUID(),
      user_id: user_id || DEMO_USER_ID,
      batch_name,
      start_date,
      end_date: null,
      initial_chick_count: Number(initial_chick_count),
      chick_cost: Number(chick_cost) || 0,
      mortality_threshold_pct: mortality_threshold_pct != null && mortality_threshold_pct !== '' ? Number(mortality_threshold_pct) : null,
      cost_budget: cost_budget != null && cost_budget !== '' ? Number(cost_budget) : null,
      status: 'Active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null
    };

    return await syncEngine.queueUpsert('batches', batch);
  },

  async updateBatchThresholds(batchId, { mortality_threshold_pct, cost_budget }) {
    const batch = await db.batches.get(batchId);
    if (!batch) throw new Error('Batch not found');

    const updated = {
      ...batch,
      mortality_threshold_pct: mortality_threshold_pct != null && mortality_threshold_pct !== '' ? Number(mortality_threshold_pct) : null,
      cost_budget: cost_budget != null && cost_budget !== '' ? Number(cost_budget) : null
    };

    return await syncEngine.queueUpsert('batches', updated);
  },

  async completeBatch(batchId, endDate = new Date().toISOString().slice(0, 10)) {
    const batch = await db.batches.get(batchId);
    if (!batch) throw new Error('Batch not found');

    const updated = {
      ...batch,
      status: 'Completed',
      end_date: endDate
    };

    return await syncEngine.queueUpsert('batches', updated);
  },

  async saveDailyCost(cost) {
    const record = {
      cost_id: cost.cost_id || crypto.randomUUID(),
      batch_id: cost.batch_id,
      entry_date: cost.entry_date,
      feed_cost: Number(cost.feed_cost) || 0,
      medicine_cost: Number(cost.medicine_cost) || 0,
      utilities_cost: Number(cost.utilities_cost) || 0,
      labor_cost: Number(cost.labor_cost) || 0,
      transport_cost: Number(cost.transport_cost) || 0,
      other_cost: Number(cost.other_cost) || 0,
      deleted_at: null
    };
    return await syncEngine.queueUpsert('daily_costs', record);
  },

  async saveFeedLog(log) {
    const record = {
      feed_log_id: log.feed_log_id || crypto.randomUUID(),
      batch_id: log.batch_id,
      entry_date: log.entry_date,
      feed_type: log.feed_type,
      quantity_kg: Number(log.quantity_kg) || 0,
      deleted_at: null
    };
    return await syncEngine.queueUpsert('feed_logs', record);
  },

  async saveMortalityLog(log) {
    const record = {
      mortality_id: log.mortality_id || crypto.randomUUID(),
      batch_id: log.batch_id,
      entry_date: log.entry_date,
      count: Number(log.count) || 0,
      deleted_at: null
    };
    return await syncEngine.queueUpsert('mortality_logs', record);
  },

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
      deleted_at: null
    };
    return await syncEngine.queueUpsert('sales', record);
  },

  async deleteRecord(table, recordId) {
    return await syncEngine.queueSoftDelete(table, recordId);
  }
};
