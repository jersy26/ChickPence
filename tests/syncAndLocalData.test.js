import { describe, it, expect, vi } from 'vitest';
import { pushOutbox } from '../src/services/syncEngine.js';
import { planLocalData, DEMO_OWNER } from '../src/db/localData.js';

const item = (id, table_name, record_id, payload = {}) => ({ id, table_name, record_id, payload });

describe('pushOutbox', () => {
  it('keeps going after a failed upload', async () => {
    const items = [
      item(1, 'mortality_logs', 'm1', { batch_id: 'b1' }),
      item(2, 'feed_logs', 'f1', { batch_id: 'b1' }),
      item(3, 'sales', 's1', { batch_id: 'b1' })
    ];
    const upsert = vi.fn(async (i) => (i.record_id === 'f1' ? { message: "Could not find the 'quantity_g' column" } : null));
    const { synced, failed } = await pushOutbox(items, upsert);
    expect(synced).toEqual([1, 3]);
    expect(failed.map((f) => [f.item.id, f.error])).toEqual([[2, "Could not find the 'quantity_g' column"]]);
  });

  it('uploads batches first', async () => {
    const order = [];
    await pushOutbox(
      [item(1, 'sales', 's1', { batch_id: 'b1' }), item(2, 'batches', 'b1')],
      async (i) => { order.push(i.table_name); return null; }
    );
    expect(order).toEqual(['batches', 'sales']);
  });

  it('holds back records of a batch that failed, but not other batches', async () => {
    const items = [
      item(1, 'batches', 'b1'),
      item(2, 'batches', 'b2'),
      item(3, 'feed_logs', 'f1', { batch_id: 'b1' }),
      item(4, 'feed_logs', 'f2', { batch_id: 'b2' }),
      item(5, 'expenses', 'e1', {})
    ];
    const upsert = vi.fn(async (i) => (i.record_id === 'b1' ? { message: 'violates foreign key constraint "batch_user_id_fkey"' } : null));
    const { synced, failed } = await pushOutbox(items, upsert);
    expect(synced).toEqual([2, 4, 5]);
    expect(failed.map((f) => f.item.id)).toEqual([1, 3]);
    expect(failed[1].error).toBe('Waiting for its batch to upload.');
    expect(upsert).not.toHaveBeenCalledWith(items[2]); // never sent
  });

  it('keeps edits of one record in order when an earlier edit failed', async () => {
    const items = [
      item(1, 'sales', 's1', { batch_id: 'b1', price_per_kg: 100 }),
      item(2, 'sales', 's1', { batch_id: 'b1', price_per_kg: 120 })
    ];
    let calls = 0;
    const { synced, failed } = await pushOutbox(items, async () => (++calls === 1 ? { message: 'timeout' } : null));
    expect(calls).toBe(1);
    expect(synced).toEqual([]);
    expect(failed.map((f) => f.error)).toEqual(['timeout', 'Waiting for an earlier change to this record to upload.']);
  });

  it('treats a thrown error like a failed upload', async () => {
    const { synced, failed } = await pushOutbox([item(1, 'expenses', 'e1')], async () => { throw new TypeError('Failed to fetch'); });
    expect(synced).toEqual([]);
    expect(failed[0].error).toBe('Failed to fetch');
  });
});

describe('planLocalData', () => {
  const user = 'ceba3d24-a757-40f0-b5d0-639c5bc9f9ba';

  it('seeds demo data only for Demo Mode', () => {
    expect(planLocalData({ owner: null, target: DEMO_OWNER, unsynced: 0 })).toBe('clear-and-seed');
    expect(planLocalData({ owner: DEMO_OWNER, target: DEMO_OWNER, unsynced: 0 })).toBe('seed');
  });

  it('clears demo data when a real account logs in', () => {
    expect(planLocalData({ owner: DEMO_OWNER, target: user, unsynced: 0 })).toBe('clear');
  });

  it('starts clean when it is unknown whose records are in the browser (older installs mixed demo and real)', () => {
    expect(planLocalData({ owner: null, target: user, unsynced: 0 })).toBe('clear');
    expect(planLocalData({ owner: null, target: DEMO_OWNER, unsynced: 0 })).toBe('clear-and-seed');
  });

  it('keeps the same account’s records', () => {
    expect(planLocalData({ owner: user, target: user, unsynced: 3 })).toBe('keep');
  });

  it('never clears records that are not uploaded yet', () => {
    expect(planLocalData({ owner: 'other-user', target: user, unsynced: 2 })).toBe('keep-unsynced');
    expect(planLocalData({ owner: null, target: DEMO_OWNER, unsynced: 2 })).toBe('keep-unsynced');
    expect(planLocalData({ owner: 'other-user', target: user, unsynced: 0 })).toBe('clear');
  });
});
