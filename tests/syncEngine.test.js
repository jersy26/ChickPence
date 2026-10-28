import { describe, it, expect, vi, afterEach } from 'vitest';

// No Supabase settings in these tests (the real .env may have some)
vi.mock('../src/services/supabaseClient.js', () => ({
  getSupabase: vi.fn(() => null),
  isSupabaseConfigured: vi.fn(() => false)
}));

const { syncEngine, fetchAllRows, replacesLocal } = await import('../src/services/syncEngine.js');
const { AuthService } = await import('../src/services/auth.js');
const { db } = await import('../src/db/dexie.js');
const { DEMO_OWNER } = await import('../src/db/localData.js');

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('syncNow', () => {
  it('a call during a sync joins it, and that sync runs once more for what was saved meanwhile', async () => {
    vi.spyOn(syncEngine, 'notifyStatus').mockImplementation(() => {});
    let runs = 0;
    vi.spyOn(syncEngine, 'syncOnce').mockImplementation(async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { success: true, count: runs };
    });

    const first = syncEngine.syncNow();
    expect(syncEngine.isSyncing).toBe(true);
    const second = syncEngine.syncNow(); // e.g. an entry saved while uploading
    const third = syncEngine.syncNow();
    expect(second).toBe(first);
    expect(third).toBe(first);

    expect(await first).toEqual({ success: true, count: 2 }); // resolves after the extra run
    expect(runs).toBe(2); // once more, not once per call
    expect(syncEngine.isSyncing).toBe(false);

    await syncEngine.syncNow(); // later calls start a new sync
    expect(runs).toBe(3);
  });
});

describe('syncOnce never throws away uploads it cannot make', () => {
  const demoUser = { id: 'demo', isDemo: true };

  it("Demo Mode empties only the demo's own queue", async () => {
    vi.useFakeTimers();
    vi.spyOn(AuthService, 'getUser').mockReturnValue(demoUser);
    vi.spyOn(db.app_state, 'get').mockResolvedValue({ key: 'data_owner', value: DEMO_OWNER });
    vi.spyOn(db.outbox, 'count').mockResolvedValue(2);
    const clear = vi.spyOn(db.outbox, 'clear').mockResolvedValue();

    const result = syncEngine.syncOnce();
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toEqual({ success: true, count: 2 });
    expect(clear).toHaveBeenCalled();
  });

  it("Demo Mode leaves an account's waiting changes alone", async () => {
    vi.spyOn(AuthService, 'getUser').mockReturnValue(demoUser);
    vi.spyOn(db.app_state, 'get').mockResolvedValue({ key: 'data_owner', value: 'ceba3d24-a757-40f0-b5d0-639c5bc9f9ba' });
    vi.spyOn(db.outbox, 'count').mockResolvedValue(3);
    const clear = vi.spyOn(db.outbox, 'clear').mockResolvedValue();

    expect(await syncEngine.syncOnce()).toMatchObject({ success: false, reason: 'not-demo-data' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('an account without Supabase settings keeps its queue', async () => {
    vi.spyOn(AuthService, 'getUser').mockReturnValue({ id: 'u1', isDemo: false });
    const clear = vi.spyOn(db.outbox, 'clear').mockResolvedValue();

    expect(await syncEngine.syncOnce()).toMatchObject({ success: false, reason: 'no-server' });
    expect(clear).not.toHaveBeenCalled();
  });
});

/** Stand-in for supabase.from(table).select().order().gt().limit(), returning at most maxRows per request like PostgREST */
function fakeSupabase(rowsByTable, { maxRows = 1000, failOn = null } = {}) {
  const requests = [];
  return {
    requests,
    from(table) {
      const q = { table, after: null, limit: Infinity, order: null, count: null };
      const builder = {
        select(_cols, opts) { q.count = opts?.count ?? null; return builder; },
        order(col) { q.order = col; return builder; },
        limit(n) { q.limit = n; return builder; },
        gt(col, value) { q.after = [col, value]; return builder; },
        then(resolve, reject) {
          requests.push({ ...q });
          if (failOn === requests.length) return Promise.resolve({ data: null, error: { message: 'timeout' }, count: null }).then(resolve, reject);
          let rows = [...rowsByTable[table]].sort((a, b) => (a[q.order] < b[q.order] ? -1 : 1));
          if (q.after) rows = rows.filter((r) => r[q.after[0]] > q.after[1]);
          const data = rows.slice(0, Math.min(q.limit, maxRows));
          return Promise.resolve({ data, error: null, count: q.count === 'exact' ? rows.length : null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

const logs = (n) => Array.from({ length: n }, (_, i) => ({ mortality_id: `m${String(i).padStart(5, '0')}`, count: 1 }));

describe('fetchAllRows', () => {
  it('reads past the server’s 1000-row limit', async () => {
    const supabase = fakeSupabase({ mortality_log: logs(2500) });
    const rows = await fetchAllRows(supabase, 'mortality_log', 'mortality_id');
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((r) => r.mortality_id)).size).toBe(2500);
    expect(supabase.requests).toHaveLength(3);
    expect(supabase.requests[1].after).toEqual(['mortality_id', 'm00999']);
  });

  it('a small table takes one request', async () => {
    const supabase = fakeSupabase({ mortality_log: logs(40) });
    expect(await fetchAllRows(supabase, 'mortality_log', 'mortality_id')).toHaveLength(40);
    expect(supabase.requests).toHaveLength(1);
  });

  it('still reads everything when the server returns fewer rows per request than asked', async () => {
    const supabase = fakeSupabase({ mortality_log: logs(1200) }, { maxRows: 500 });
    expect(await fetchAllRows(supabase, 'mortality_log', 'mortality_id')).toHaveLength(1200);
  });

  it('an error stops the table', async () => {
    const supabase = fakeSupabase({ mortality_log: logs(1500) }, { failOn: 2 });
    await expect(fetchAllRows(supabase, 'mortality_log', 'mortality_id')).rejects.toEqual({ message: 'timeout' });
  });
});

describe('replacesLocal', () => {
  const local = { sale_id: 's1', weight_kg: 245.5, buyer_name: 'Aling Nena', updated_at: '2026-10-28T10:00:00.000Z', deleted_at: null, created_at: '2026-10-01T00:00:00.000Z' };

  it('a new or newer row replaces the local copy; an older one does not', () => {
    expect(replacesLocal({ ...local }, undefined)).toBe(true);
    expect(replacesLocal({ ...local, updated_at: '2026-10-28T10:00:01+00:00' }, local)).toBe(true);
    expect(replacesLocal({ ...local, buyer_name: 'Old', updated_at: '2026-10-28T09:59:59+00:00' }, local)).toBe(false);
  });

  it('this device’s own upload coming back is not written again', () => {
    // Same change in the server's formats: +00:00 times, created_at without a time zone
    const remote = { ...local, updated_at: '2026-10-28T10:00:00+00:00', created_at: '2026-10-01T00:00:00' };
    expect(replacesLocal(remote, local)).toBe(false);
  });

  it('at the same time, a value the server changed (rounded) wins', () => {
    expect(replacesLocal({ ...local, weight_kg: 245.56 }, { ...local, weight_kg: 245.555 })).toBe(true);
  });

  it('a local copy without a time is replaced', () => {
    expect(replacesLocal(local, { ...local, updated_at: undefined })).toBe(true);
  });
});
