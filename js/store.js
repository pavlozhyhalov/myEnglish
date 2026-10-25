// Локальний стан (IndexedDB) + синхронізація з Supabase (last-write-wins за updated_at).
// Локальна копія — кеш і черга офлайн-змін; Supabase — джерело правди після входу.
import { DEFAULTS, LIMITS } from './config.js';

export const TABLES = ['decks', 'cards', 'reviews', 'lessons_progress', 'mistakes', 'sessions', 'tutor_chats', 'tests'];

// Колонки таблиць у БД — на сервер відправляємо лише їх
const COLUMNS = {
  decks: ['id', 'name', 'enabled', 'builtin', 'updated_at', 'deleted'],
  cards: ['id', 'deck_id', 'en', 'uk', 'ipa', 'pos', 'examples', 'tags', 'extra', 'due', 'stability', 'difficulty',
    'elapsed_days', 'scheduled_days', 'learning_steps', 'reps', 'lapses', 'state', 'last_review', 'created_at', 'updated_at', 'deleted'],
  reviews: ['id', 'card_id', 'rating', 'state', 'ts', 'elapsed', 'updated_at'],
  lessons_progress: ['id', 'best', 'last_score', 'attempts', 'completed_at', 'next_review', 'review_stage', 'updated_at'],
  mistakes: ['id', 'wrong', 'right', 'type', 'explanation_uk', 'source', 'count', 'streak', 'resolved', 'ref', 'created_at', 'updated_at', 'deleted'],
  sessions: ['id', 'type', 'seconds', 'xp', 'day', 'ts', 'ref', 'updated_at'],
  tutor_chats: ['id', 'mode', 'scenario', 'title', 'messages', 'summary', 'seconds', 'created_at', 'updated_at', 'deleted'],
  tests: ['id', 'type', 'ref', 'scores', 'details', 'created_at', 'updated_at'],
};
// Скільки днів історії тримати локально (решта — лише на сервері)
const LOCAL_KEEP_DAYS = { reviews: 120, sessions: 400 };

const data = Object.fromEntries(TABLES.map(t => [t, new Map()]));
let profile = { data: {}, updated_at: null };
let dirty = new Set();            // "table|id" або "profile"
let meta = { lastPull: {}, userId: null };
const listeners = new Set();

// ---------- IndexedDB (key-value) ----------
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open('myenglish', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
async function kvGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const rq = db.transaction('kv').objectStore('kv').get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  } catch { try { return JSON.parse(localStorage.getItem('me:' + key)); } catch { return undefined; } }
}
async function kvSet(key, val) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { try { localStorage.setItem('me:' + key, JSON.stringify(val)); } catch { /* квота */ } }
}

const pendingSave = new Set();
let saveTimer = null;
function scheduleSave(key) {
  pendingSave.add(key);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
export async function flush() {
  clearTimeout(saveTimer);
  const keys = [...pendingSave]; pendingSave.clear();
  for (const k of keys) {
    if (k === 'profile') await kvSet('profile', profile);
    else if (k === 'dirty') await kvSet('dirty', [...dirty]);
    else if (k === 'meta') await kvSet('meta', meta);
    else await kvSet('t:' + k, [...data[k].values()]);
  }
}
window.addEventListener('pagehide', () => { flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

// ---------- Завантаження ----------
export async function load() {
  const [p, d, m, ...tables] = await Promise.all([kvGet('profile'), kvGet('dirty'), kvGet('meta'), ...TABLES.map(t => kvGet('t:' + t))]);
  if (p) profile = p;
  if (d) dirty = new Set(d);
  if (m) meta = { lastPull: {}, ...m };
  TABLES.forEach((t, i) => { for (const row of tables[i] || []) data[t].set(row.id, row); });
  housekeeping();
}

function housekeeping() {
  const now = Date.now();
  for (const [t, days] of Object.entries(LOCAL_KEEP_DAYS)) {
    const cut = now - days * 864e5;
    for (const [id, r] of data[t]) if (Date.parse(r.ts) < cut && !dirty.has(t + '|' + id)) data[t].delete(id);
  }
  // Повний текст розмов — 30 днів, далі лише підсумок
  const cut = now - LIMITS.chatRetentionDays * 864e5;
  for (const r of data.tutor_chats.values()) {
    if (r.messages && Date.parse(r.created_at) < cut) { r.messages = null; touch('tutor_chats', r); }
  }
}

// ---------- Події ----------
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(table) { listeners.forEach(fn => { try { fn(table); } catch (e) { console.error(e); } }); }

// ---------- CRUD ----------
const T = (s) => (s ? Date.parse(s) || 0 : 0);
export const nowIso = () => new Date().toISOString();
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function get(table, id) { const r = data[table].get(id); return r && !r.deleted ? r : undefined; }
export function all(table) { return [...data[table].values()].filter(r => !r.deleted); }
export function count(table) { let n = 0; for (const r of data[table].values()) if (!r.deleted) n++; return n; }

function touch(table, row) {
  row.updated_at = nowIso();
  data[table].set(row.id, row);
  dirty.add(table + '|' + row.id);
  scheduleSave(table); scheduleSave('dirty');
}

export function put(table, row) {
  if (!row.id) row.id = uid();
  if (!row.created_at && COLUMNS[table].includes('created_at')) row.created_at = nowIso();
  touch(table, row);
  emit(table);
  queueSync();
  return row;
}
export function putMany(table, rows) {
  for (const row of rows) {
    if (!row.id) row.id = uid();
    if (!row.created_at && COLUMNS[table].includes('created_at')) row.created_at = nowIso();
    touch(table, row);
  }
  emit(table); queueSync();
}
export function remove(table, id) {
  const r = data[table].get(id);
  if (!r) return;
  if (COLUMNS[table].includes('deleted')) { r.deleted = true; touch(table, r); }
  else { data[table].delete(id); dirty.add(table + '|' + id + '|del'); scheduleSave(table); scheduleSave('dirty'); }
  emit(table); queueSync();
}

// ---------- Профіль і налаштування ----------
export function prof() { return profile.data; }
export function setProf(patch) {
  Object.assign(profile.data, patch);
  profile.updated_at = nowIso();
  dirty.add('profile');
  scheduleSave('profile'); scheduleSave('dirty');
  emit('profile'); queueSync();
}
export function settings() { return { ...DEFAULTS, ...(profile.data.settings || {}) }; }
export function setSetting(k, v) { setProf({ settings: { ...(profile.data.settings || {}), [k]: v } }); }

// ---------- Синхронізація ----------
let supa = null, syncing = false, syncAgain = false, syncTimer = null;
export function attachSupabase(client) { supa = client; }
export function pendingCount() { return dirty.size; }

export function queueSync(delay = 1500) {
  if (!supa) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch(e => console.warn('sync', e)), delay);
}

export async function sync() {
  if (!supa || !navigator.onLine) return false;
  const { data: { session } } = await supa.auth.getSession();
  if (!session) return false;
  if (syncing) { syncAgain = true; return false; }
  syncing = true;
  try {
    const userId = session.user.id;
    if (meta.userId && meta.userId !== userId) {
      // інший акаунт на цьому пристрої — тягнемо все заново
      meta.lastPull = {};
    }
    meta.userId = userId;
    await push(userId);
    const changed = await pull();
    scheduleSave('meta'); await flush();
    if (changed.length) changed.forEach(emit);
    return true;
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; queueSync(200); }
  }
}

async function push(userId) {
  const items = [...dirty];
  if (!items.length) return;
  const byTable = {};
  const deletes = {};
  for (const key of items) {
    if (key === 'profile') continue;
    const [t, id, del] = key.split('|');
    if (del) { (deletes[t] ||= []).push(id); continue; }
    const r = data[t]?.get(id);
    if (!r) { dirty.delete(key); continue; }
    const row = { user_id: userId };
    for (const c of COLUMNS[t]) if (r[c] !== undefined) row[c] = r[c];
    (byTable[t] ||= []).push({ key, row });
  }
  if (dirty.has('profile')) {
    const { error } = await supa.from('profiles').upsert({ user_id: userId, data: profile.data, updated_at: profile.updated_at || nowIso() });
    if (error) throw error;
    dirty.delete('profile');
  }
  for (const [t, list] of Object.entries(byTable)) {
    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      const { error } = await supa.from(t).upsert(chunk.map(c => c.row), { onConflict: 'user_id,id' });
      if (error) throw error;
      chunk.forEach(c => {
        // якщо за час запиту запис змінився ще раз — лишаємо брудним
        const cur = data[t].get(c.row.id);
        if (!cur || cur.updated_at === c.row.updated_at) dirty.delete(c.key);
      });
    }
  }
  for (const [t, ids] of Object.entries(deletes)) {
    const { error } = await supa.from(t).delete().in('id', ids);
    if (error) throw error;
    ids.forEach(id => dirty.delete(t + '|' + id + '|del'));
  }
  scheduleSave('dirty');
}

async function pull() {
  const changed = [];
  // профіль
  {
    const { data: rows, error } = await supa.from('profiles').select('*').limit(1);
    if (error) throw error;
    const r = rows?.[0];
    if (r && !dirty.has('profile') && T(r.updated_at) > T(profile.updated_at)) {
      profile = { data: r.data || {}, updated_at: r.updated_at };
      scheduleSave('profile'); changed.push('profile');
    }
  }
  for (const t of TABLES) {
    let since = meta.lastPull[t];
    if (!since && LOCAL_KEEP_DAYS[t]) since = new Date(Date.now() - LOCAL_KEEP_DAYS[t] * 864e5).toISOString();
    let from = 0, maxTs = meta.lastPull[t] || null, got = false;
    for (;;) {
      let q = supa.from(t).select('*').order('updated_at', { ascending: true }).range(from, from + 999);
      if (since) q = q.gt('updated_at', since);
      const { data: rows, error } = await q;
      if (error) throw error;
      for (const r of rows) {
        delete r.user_id;
        const local = data[t].get(r.id);
        const isDirty = dirty.has(t + '|' + r.id);
        if (!local || T(r.updated_at) > T(local.updated_at)) {
          data[t].set(r.id, r);
          if (isDirty) dirty.delete(t + '|' + r.id);
          got = true;
        }
        if (!maxTs || T(r.updated_at) > T(maxTs)) maxTs = r.updated_at;
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
    if (maxTs) meta.lastPull[t] = maxTs;
    if (got) { scheduleSave(t); changed.push(t); }
  }
  return changed;
}

// ---------- Експорт / імпорт ----------
export function exportJson() {
  return {
    app: 'myEnglish', version: 1, exported_at: nowIso(),
    profile: profile.data,
    ...Object.fromEntries(TABLES.map(t => [t, [...data[t].values()]])),
  };
}
export async function importJson(obj) {
  if (!obj || obj.app !== 'myEnglish') throw new Error('Це не файл експорту myEnglish');
  if (obj.profile) setProf(obj.profile);
  for (const t of TABLES) {
    for (const r of obj[t] || []) {
      const local = data[t].get(r.id);
      if (!local || T(r.updated_at) >= T(local.updated_at)) { data[t].set(r.id, r); dirty.add(t + '|' + r.id); }
    }
    scheduleSave(t);
  }
  scheduleSave('dirty'); await flush();
  TABLES.forEach(emit); queueSync(100);
}
export async function wipeLocal() {
  TABLES.forEach(t => data[t].clear());
  profile = { data: {}, updated_at: null }; dirty.clear(); meta = { lastPull: {}, userId: null };
  ['profile', 'dirty', 'meta', ...TABLES].forEach(scheduleSave);
  await flush();
}
