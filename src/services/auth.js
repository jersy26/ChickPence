import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { DEMO_USER_ID } from '../db/seed.js';

let currentUser = null;

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
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          currentUser = {
            id: session.user.id,
            email: session.user.email,
            isDemo: false
          };
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
        await supabase.auth.signOut();
      }
    }
    currentUser = null;
    localStorage.removeItem('chickpence_demo_session');
  }
};
