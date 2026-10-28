import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/services/supabaseClient.js', () => ({
  getSupabase: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true)
}));

const { getSupabase } = await import('../src/services/supabaseClient.js');
const { AuthService } = await import('../src/services/auth.js');

function fakeStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

const KEY = 'sb-127-auth-token';
let storage;

beforeEach(() => {
  storage = fakeStorage({ [KEY]: '{"refresh_token":"r","user":{"id":"u1"}}', chickpence_demo_session: '{}' });
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('logout', () => {
  it('signs out this device only, not every device of the account', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    getSupabase.mockReturnValue({ auth: { storageKey: KEY, signOut } });
    await AuthService.logout();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(AuthService.isLoggedIn()).toBe(false);
  });

  it('offline with an expired login, the saved login is removed so the next start does not open the account', async () => {
    // What supabase-js returns when it cannot renew the login to sign it out: it keeps it saved
    const signOut = vi.fn(async () => ({ error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }) }));
    getSupabase.mockReturnValue({ auth: { storageKey: KEY, signOut } });
    await AuthService.logout();
    expect(storage.getItem(KEY)).toBeNull();
    expect(storage.getItem('chickpence_demo_session')).toBeNull();
  });

  it('a sign-out that throws still logs out', async () => {
    getSupabase.mockReturnValue({ auth: { storageKey: KEY, signOut: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) } });
    await AuthService.logout();
    expect(storage.getItem(KEY)).toBeNull();
    expect(AuthService.isLoggedIn()).toBe(false);
  });
});
