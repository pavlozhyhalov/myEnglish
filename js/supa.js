import { createClient } from '../vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'me-auth' },
});

let session = null;
const listeners = new Set();
export function currentSession() { return session; }
export function user() { return session?.user || null; }
export function onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function initAuth() {
  const { data } = await supa.auth.getSession();
  session = data.session;
  supa.auth.onAuthStateChange((_ev, s) => {
    const changed = (s?.user?.id || null) !== (session?.user?.id || null);
    session = s;
    if (changed) listeners.forEach(fn => fn(s));
  });
  return session;
}

export async function signIn(email, password) {
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signUp(email, password) {
  const { data, error } = await supa.auth.signUp({
    email, password, options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  return data;
}
export async function signOut() { await supa.auth.signOut(); }

export async function accessToken() {
  const { data } = await supa.auth.getSession();
  return data.session?.access_token || null;
}
