import { describe, it, expect, vi } from 'vitest';
import { pushOutbox, discardChange, outboxProblems } from '../src/services/syncEngine.js';
import { renderSyncStatus } from '../src/ui/shell.js';
import { renderSyncProblems, describeChange } from '../src/ui/syncProblemsModal.js';
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

describe('refused uploads', () => {
  /** In-memory stand-in for the Dexie tables discardChange uses */
  function fakeDb(outbox, tables) {
    const store = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, new Map(rows.map((r) => [r.id, r]))]));
    return {
      outbox: {
        rows: [...outbox],
        async toArray() { return this.rows; },
        async bulkDelete(ids) { this.rows = this.rows.filter((r) => !ids.includes(r.id)); }
      },
      ...Object.fromEntries(Object.entries(store).map(([t, map]) => [t, { map, async delete(id) { map.delete(id); } }]))
    };
  }

  it('discards a refused record: its queued uploads and the local copy', async () => {
    const refused = { ...item(2, 'sales', 's1', { batch_id: 'b1' }), last_error: 'violates check constraint' };
    const db = fakeDb(
      [item(1, 'sales', 's1', { batch_id: 'b1' }), refused, item(3, 'feed_logs', 'f1', { batch_id: 'b1' })],
      { sales: [{ id: 's1' }, { id: 's2' }], feed_logs: [{ id: 'f1' }] }
    );
    expect(await discardChange(refused, db)).toBe(1);
    expect(db.outbox.rows.map((r) => r.id)).toEqual([3]);
    expect([...db.sales.map.keys()]).toEqual(['s2']);
    expect([...db.feed_logs.map.keys()]).toEqual(['f1']);
  });

  it('discarding a batch takes its waiting records with it', async () => {
    const batch = { ...item(1, 'batches', 'b1', { batch_name: 'Batch X' }), last_error: 'duplicate key' };
    const db = fakeDb(
      [batch, { ...item(2, 'feed_logs', 'f1', { batch_id: 'b1' }), last_error: 'Waiting for its batch to upload.' }, item(3, 'sales', 's9', { batch_id: 'b2' })],
      { batches: [{ id: 'b1' }], feed_logs: [{ id: 'f1' }], sales: [{ id: 's9' }] }
    );
    expect(await discardChange(batch, db)).toBe(2);
    expect(db.outbox.rows.map((r) => r.id)).toEqual([3]);
    expect(db.batches.map.size).toBe(0);
    expect(db.feed_logs.map.size).toBe(0);
    expect(db.sales.map.size).toBe(1);
  });

  it('sidebar line: refused changes first, then offline, waiting, all synced', () => {
    expect(renderSyncStatus({ online: true, pending: 3, problems: 2 })).toContain('2 could not upload');
    expect(renderSyncStatus({ online: false, pending: 3 })).toContain('Offline · 3 waiting');
    expect(renderSyncStatus({ online: true, pending: 3 })).toContain('3 waiting to upload');
    expect(renderSyncStatus({ online: true, pending: 0 })).toContain('All synced');
  });

  it('Sync screen lists refused changes with the reason, escaped, and a discard button', () => {
    const items = [
      { ...item(1, 'sales', 's1', { sale_date: '2026-10-28', buyer_name: 'Aling <Nena>', quantity_sold: 120, weight_kg: 245.5, batch_id: 'b9' }), last_error: 'new row violates <policy>', attempts: 3 },
      item(2, 'feed_logs', 'f1', { entry_date: '2026-10-27', quantity_g: 150000, batch_id: 'b9' })
    ];
    expect(outboxProblems(items).map((i) => i.id)).toEqual([1]);
    const html = renderSyncProblems(items, { online: true, batchNames: new Map([['b9', 'Batch 2026-09']]) });
    expect(html).toContain('1 change is waiting to upload');
    expect(html).toContain('The server refused 1 change');
    expect(html).toContain('Aling &lt;Nena&gt;, 120 heads, 245.5 kg · Batch 2026-09');
    expect(html).toContain('new row violates &lt;policy&gt;');
    expect(html).toContain('Tried 3 times');
    expect(html).toContain('data-discard="1"');
    expect(html).toContain('btn-sync-retry');
    expect(renderSyncProblems([], { online: true })).toContain('Everything on this device is uploaded');
    expect(renderSyncProblems(items, { online: false })).not.toContain('btn-sync-retry');
    expect(describeChange(item(5, 'expenses', 'e1', { entry_date: '2026-10-26', feed_centavos: 1250000, other_centavos: 0 })))
      .toBe('2026-10-26: feed ₱12,500.00, other ₱0.00');
  });
});
