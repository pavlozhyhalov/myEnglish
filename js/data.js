// Статичний контент (працює офлайн через service worker)
import { BUILD } from './config.js';

const cache = new Map();
export async function json(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(`${path}?v=${BUILD}`).then(r => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}

export const deckIndex = () => json('data/decks/index.json');
export const deck = (id) => json(`data/decks/${id}.json`);
export async function allDecks() {
  const idx = await deckIndex();
  const decks = await Promise.all(idx.map(d => deck(d.id)));
  return idx.map((d, i) => ({ ...d, cards: decks[i].cards }));
}
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
