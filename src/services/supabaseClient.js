import { createClient } from '@supabase/supabase-js';

let supabaseInstance = null;

export function getSupabaseCredentials() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const storedUrl = localStorage.getItem('chickpence_supabase_url');
  const storedKey = localStorage.getItem('chickpence_supabase_key');

  const url = storedUrl || envUrl;
  const key = storedKey || envKey;

  return {
    url: url && url.trim().length > 0 ? url.trim() : null,
    key: key && key.trim().length > 0 ? key.trim() : null
  };
}

export function isSupabaseConfigured() {
  const { url, key } = getSupabaseCredentials();
  return Boolean(url && key);
}

export function getSupabase() {
  if (supabaseInstance) return supabaseInstance;

  const { url, key } = getSupabaseCredentials();
  if (url && key) {
    try {
      supabaseInstance = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      });
      return supabaseInstance;
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e);
      return null;
    }
  }
  return null;
}

export function setSupabaseCredentials(url, key) {
  if (url && key) {
    localStorage.setItem('chickpence_supabase_url', url.trim());
    localStorage.setItem('chickpence_supabase_key', key.trim());
  } else {
    localStorage.removeItem('chickpence_supabase_url');
    localStorage.removeItem('chickpence_supabase_key');
  }
  supabaseInstance = null;
  return getSupabase();
}
