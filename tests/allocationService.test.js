import { describe, it, expect } from 'vitest';
import { recomputeAllocations } from '../src/services/allocationService.js';

/** In-memory stand-in for the Dexie transaction recomputeAllocations uses */
function fakeTx(tables) {
  const keyOf = {
    expenses: (r) => r.expense_id,
    allocations: (r) => `${r.expense_id}|${r.batch_id}`
  };
  const store = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, [...rows]]));
  const table = (name) => ({
    filter: (fn) => ({ toArray: async () => store[name].filter(fn) }),
    where: (field) => ({
      anyOf: (values) => ({ delete: async () => { store[name] = store[name].filter((r) => !values.includes(r[field])); } }),
      equals: (value) => ({ delete: async () => { store[name] = store[name].filter((r) => r[field] !== value); } })
    }),
    clear: async () => { store[name] = []; },
    bulkGet: async (ids) => ids.map((id) => store[name].find((r) => keyOf[name](r) === id)),
    bulkPut: async (rows) => {
      for (const row of rows) {
        store[name] = [...store[name].filter((r) => keyOf[name](r) !== keyOf[name](row)), row];
      }
    },
    put: async (row) => table(name).bulkPut([row])
  });
  return { table, store };
}

const batches = [
  { batch_id: 'b1', start_date: '2026-09-01', initial_chick_count: 300 },
  { batch_id: 'b2', start_date: '2026-09-01', initial_chick_count: 100 }
];
const expense = (expense_id, extra = {}) => ({ expense_id, entry_date: '2026-10-01', feed_centavos: 4000, other_centavos: 0, ...extra });
const rowsFor = (tx, id) => tx.store.allocations.filter((a) => a.expense_id === id);

describe('recomputeAllocations', () => {
  it('shares each live expense by head count', async () => {
    const tx = fakeTx({ batches, mortality_logs: [], sales: [], expenses: [expense('e1')], allocations: [] });
    await recomputeAllocations(tx);
    expect(rowsFor(tx, 'e1').map((a) => [a.batch_id, a.feed_centavos])).toEqual([['b1', 3000], ['b2', 1000]]);
  });

  it('a full recompute drops the shares of an expense deleted on another device', async () => {
    const tx = fakeTx({
      batches, mortality_logs: [], sales: [],
      expenses: [expense('e1'), expense('e2', { deleted_at: '2026-10-28T10:00:00Z' })],
      allocations: [{ expense_id: 'e2', batch_id: 'b1', feed_centavos: 3000, other_centavos: 0 }]
    });
    await recomputeAllocations(tx);
    expect(rowsFor(tx, 'e2')).toEqual([]);
    expect(rowsFor(tx, 'e1')).toHaveLength(2);
  });

  it('a full recompute drops the shares of an expense discarded from this device', async () => {
    const tx = fakeTx({
      batches, mortality_logs: [], sales: [], expenses: [],
      allocations: [{ expense_id: 'gone', batch_id: 'b2', feed_centavos: 1000, other_centavos: 0 }]
    });
    await recomputeAllocations(tx);
    expect(tx.store.allocations).toEqual([]);
  });

  it('recomputing a voided expense removes its shares', async () => {
    const tx = fakeTx({
      batches, mortality_logs: [], sales: [],
      expenses: [expense('e1', { deleted_at: '2026-10-28T10:00:00Z' }), expense('e9')],
      allocations: [
        { expense_id: 'e1', batch_id: 'b1', feed_centavos: 3000, other_centavos: 0 },
        { expense_id: 'e9', batch_id: 'b1', feed_centavos: 1, other_centavos: 0 }
      ]
    });
    await recomputeAllocations(tx, ['e1']);
    expect(rowsFor(tx, 'e1')).toEqual([]);
    expect(rowsFor(tx, 'e9')).toHaveLength(1); // other expenses are left as they are
  });
});
