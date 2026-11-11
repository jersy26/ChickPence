/**
 * Stand-in for the supabase-js client the sync engine uses: a login session,
 * upserts (recorded, not stored) and paged selects from `rowsByTable`.
 * `calls` lists every request, so a test can show nothing was sent.
 */
export function fakeSupabase(rowsByTable = {}, { session = true } = {}) {
  const calls = [];
  const upserts = [];
  return {
    calls,
    upserts,
    auth: {
      getSession: async () => { calls.push('auth.getSession'); return { data: { session: session ? { user: { id: 'u1' } } : null } }; },
      refreshSession: async () => { calls.push('auth.refreshSession'); return { data: { session: null } }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    from(table) {
      const q = { after: null, order: null, limit: Infinity };
      const builder = {
        upsert: async (payload) => { calls.push(`upsert ${table}`); upserts.push({ table, payload }); return { error: null }; },
        select() { return builder; },
        order(col) { q.order = col; return builder; },
        limit(n) { q.limit = n; return builder; },
        gt(col, value) { q.after = [col, value]; return builder; },
        then(resolve, reject) {
          calls.push(`select ${table}`);
          let rows = [...(rowsByTable[table] || [])].sort((a, b) => (a[q.order] < b[q.order] ? -1 : 1));
          if (q.after) rows = rows.filter((r) => r[q.after[0]] > q.after[1]);
          return Promise.resolve({ data: rows.slice(0, q.limit), error: null, count: rows.length }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}
