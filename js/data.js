// Статичний контент (працює офлайн через service worker)
import { BUILD } from './config.js';
import { lang, isBase, localize, addDict } from './i18n.js';

const cache = new Map();
/** Переклад змісту для мови учня: data/l10n/<lang>/<шлях без data/> — словник «укр. рядок → переклад» (js/i18n.js); немає — базовий текст */
function overlay(path) {
  if (isBase() || !path.startsWith('data/')) return Promise.resolve(null);
  return fetch(`data/l10n/${lang()}/${path.slice(5)}?v=${BUILD}`).then(r => r.ok ? r.json() : null).catch(() => null);
}
export async function json(path) {
  if (cache.has(path)) return cache.get(path);
  const p = Promise.all([fetch(`${path}?v=${BUILD}`).then(r => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }), overlay(path)]).then(([data, map]) => { if (!map) return data; addDict(map); return localize(data, map); });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}

export const deckIndex = () => json('data/decks/index.json');
export const deck = (id) => json(`data/decks/${id}.json`);
/** Колоди з картками — вантажаться лише файли переданих колод (записи з deckIndex або srs.decks) */
export async function withCards(metas) {
  const decks = await Promise.all(metas.map(d => deck(d.id)));
  return metas.map((d, i) => ({ ...d, cards: decks[i].cards }));
}
/** Усі 48 колод (~0,5 МБ) — лише там, де справді потрібні всі слова (словник, пошук) */
export async function allDecks() { return withCards(await deckIndex()); }
export const grammarIndex = () => json('data/grammar/index.json');
export const lesson = (id) => json(`data/grammar/${id}.json`);
export const scenarios = () => json('data/scenarios.json');
export const writingTasks = () => json('data/writing.json');
export const listening = () => json('data/listening.json');
export const pronunciation = () => json('data/pronunciation.json');
export const placement = () => json('data/placement.json');

export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
}
