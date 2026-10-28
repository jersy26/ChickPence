import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { DEMO_USER_ID } from '../db/seed.js';

let currentUser = null;

// How long start-up waits for Supabase before opening a saved login offline
const OFFLINE_LOGIN_WAIT_MS = 3000;

/** The user of the login supabase-js saved in localStorage (kept until logout). */
function savedSupabaseUser(supabase) {
  try {
    const saved = JSON.parse(localStorage.getItem(supabase.auth.storageKey) || 'null');
    return saved?.refresh_token && saved.user?.id ? saved.user : null;
  } catch (_) {
    return null;
  }
}

export const AuthService = {
  async init() {
    const savedDemoUser = localStorage.getItem('chickpence_demo_session');
    if (savedDemoUser) {
      try {
        currentUser = JSON.parse(savedDemoUser);
      } catch {
        currentUser = null;
      }
    }

    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        const saved = savedSupabaseUser(supabase);
        // With an expired access token and no server, getSession() keeps retrying
        // the renewal for ~30 s; don't keep the app blank that long.
        const result = !saved
          ? await supabase.auth.getSession()
          : typeof navigator !== 'undefined' && !navigator.onLine
            ? { offline: true }
            : await Promise.race([
                supabase.auth.getSession(),
                new Promise((resolve) => setTimeout(() => resolve({ offline: true }), OFFLINE_LOGIN_WAIT_MS))
              ]);

        const session = result.data?.session;
        if (session?.user) {
          currentUser = {
            id: session.user.id,
            email: session.user.email,
            isDemo: false
          };
        } else if (saved && (result.offline || isAuthRetryableFetchError(result.error))) {
          // Offline: the login can't be renewed until the server is reachable,
          // but it is still saved on this device. Open the local records;
          // supabase-js renews the login by itself once the server is back.
          currentUser = { id: saved.id, email: saved.email, isDemo: false, offline: true };
        }
      }
    }

    return currentUser;
  },

  getUser() {
    return currentUser;
  },

  isLoggedIn() {
    return Boolean(currentUser);
  },

  async login(email, password) {
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (error) {
          throw error;
        }
        currentUser = {
          id: data.user.id,
          email: data.user.email,
          isDemo: false
        };
        localStorage.removeItem('chickpence_demo_session');
        return currentUser;
      }
    }

    // Demo Mode login fallback
    currentUser = {
      id: DEMO_USER_ID,
      email: email?.trim() || 'encoder@chickpence.ph',
      isDemo: true
    };
    localStorage.setItem('chickpence_demo_session', JSON.stringify(currentUser));
    return currentUser;
  },

  async loginDemo() {
    currentUser = {
      id: DEMO_USER_ID,
      email: 'demo@chickpence.ph',
      isDemo: true
    };
    localStorage.setItem('chickpence_demo_session', JSON.stringify(currentUser));
    return currentUser;
  },

  async logout() {
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        // 'local': this device only. The default ('global') also ends the login on every
        // other phone or PC of this account, and they cannot log in again while offline.
        let failed;
        try {
          ({ error: failed } = await supabase.auth.signOut({ scope: 'local' }));
        } catch (err) {
          failed = err;
        }
        // Offline with an expired login, supabase-js gives up without removing it, and
        // the next start would open the account again: remove the saved login here.
        if (failed) {
          localStorage.removeItem(supabase.auth.storageKey);
          localStorage.removeItem(`${supabase.auth.storageKey}-code-verifier`);
        }
      }
    }
    currentUser = null;
    localStorage.removeItem('chickpence_demo_session');
  }
};
