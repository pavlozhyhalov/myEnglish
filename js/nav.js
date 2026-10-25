// Реєстр розділів: id, адреса, іконка Phosphor (вона ж — значок у плашках), група бокового меню.
// Меню поділене на «Теорію» (читати й розбиратися) і «Вправи» (практика).
import { S } from './strings.js';

export const SECTIONS = [
  { id: 'home', icon: 'house', href: '#/', group: null },
  { id: 'tutor', icon: 'chat-circle-dots', href: '#/tutor', group: null },
  // Теорія
  { id: 'grammar', icon: 'puzzle-piece', href: '#/grammar', group: 'theory' },
  { id: 'vocab', icon: 'book-open-text', href: '#/vocab', group: 'theory' },
  { id: 'sounds', icon: 'ear', href: '#/pronunciation/sounds', group: 'theory' },
  // Вправи
  { id: 'cards', icon: 'cards', href: '#/cards', group: 'practice' },
  { id: 'exgrammar', icon: 'lightning', href: '#/exercises/grammar', group: 'practice' },
  { id: 'listening', icon: 'headphones', href: '#/listening', group: 'practice' },
  { id: 'pronunciation', icon: 'waveform', href: '#/pronunciation', group: 'practice' },
  { id: 'writing', icon: 'pencil-line', href: '#/writing', group: 'practice' },
  { id: 'scenarios', icon: 'users-three', href: '#/scenarios', group: 'practice' },
  { id: 'tests', icon: 'exam', href: '#/tests', group: 'practice' },
  { id: 'mistakes', icon: 'warning-circle', href: '#/mistakes', group: 'practice' },
  // Я
  { id: 'progress', icon: 'chart-line-up', href: '#/progress', group: 'me' },
  { id: 'settings', icon: 'gear-six', href: '#/settings', group: 'me' },
].map(s => ({ ...s, emoji: s.icon, label: S.nav[s.id], long: S.navLong[s.id] || S.nav[s.id] }));

export const byId = Object.fromEntries(SECTIONS.map(s => [s.id, s]));
export const GROUPS = ['theory', 'practice', 'me'];

/** Розділ для поточної адреси: найдовший збіг href (#/pronunciation/sounds раніше за #/pronunciation) */
export function sectionFor(path) {
  const p = '#' + (path || '/');
  let best = null;
  for (const s of SECTIONS) {
    const href = s.href;
    const hit = href === '#/' ? p === '#/' || p === '#/home' : (p === href || p.startsWith(href + '/'));
    if (hit && (!best || href.length > best.href.length)) best = s;
  }
  return best;
}
