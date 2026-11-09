// Реєстр розділів: id, адреса, іконка Phosphor (вона ж — значок у плашках), категорія бокового меню.
// Меню — MENU нижче (рішення власника 2026-11-05): три головні плитки, три групи плиток, «Я» — у картці профілю.
import { S } from './strings.js';

export const SECTIONS = [
  { id: 'home', icon: 'house', href: '#/', group: null },
  { id: 'today', icon: 'sun-horizon', href: '#/today', group: null },
  { id: 'tutor', icon: 'chat-circle-dots', href: '#/tutor', group: null },
  // Вивчати
  { id: 'cards', icon: 'cards', href: '#/cards', group: 'learn' },
  { id: 'vocab', icon: 'book-open-text', href: '#/vocab', group: 'learn' },
  { id: 'phrases', icon: 'quotes', href: '#/phrases', group: 'learn' },
  { id: 'games', icon: 'game-controller', href: '#/games', group: 'learn' },
  { id: 'grammar', icon: 'puzzle-piece', href: '#/grammar', group: 'learn' },
  { id: 'exgrammar', icon: 'lightning', href: '#/exercises/grammar', group: 'learn' },
  { id: 'sounds', icon: 'ear', href: '#/pronunciation/sounds', group: 'learn' },
  { id: 'pronunciation', icon: 'waveform', href: '#/pronunciation', group: 'learn' },
  // Практикувати
  { id: 'voice', icon: 'microphone', href: '#/tutor?mode=voice', group: 'practice', label: 'Голосом', long: 'Розмова голосом' },
  { id: 'scenarios', icon: 'users-three', href: '#/scenarios', group: 'practice' },
  { id: 'fluency', icon: 'timer', href: '#/fluency', group: 'practice' },
  { id: 'listening', icon: 'headphones', href: '#/listening', group: 'practice' },
  { id: 'listengo', icon: 'speaker-high', href: '#/listen-go', group: 'practice' },
  { id: 'reading', icon: 'book-open', href: '#/reading', group: 'practice' },
  { id: 'writing', icon: 'pencil-line', href: '#/writing', group: 'practice' },
  { id: 'diary', icon: 'notebook', href: '#/diary', group: 'practice' },
  // Контроль і прогрес
  { id: 'mistakes', icon: 'warning-circle', href: '#/mistakes', group: 'check' },
  { id: 'tests', icon: 'exam', href: '#/tests', group: 'check' },
  { id: 'progress', icon: 'chart-line-up', href: '#/progress', group: 'check' },
  { id: 'analysis', icon: 'chart-pie-slice', href: '#/analysis', group: 'check' },
  { id: 'report', icon: 'calendar-blank', href: '#/report', group: 'check', label: 'Звіт', long: 'Звіт за місяць' },
  // Я
  { id: 'profile', icon: 'user', href: '#/profile', group: 'me' },
  { id: 'friends', icon: 'users', href: '#/friends', group: 'me' },
  { id: 'settings', icon: 'gear-six', href: '#/settings', group: 'me' },
].map(s => ({ ...s, emoji: s.icon, label: s.label || S.nav[s.id], long: s.long || S.navLong[s.id] || S.nav[s.id] }));

/**
 * Бокове меню (рішення 2026-11-05, замінює розкривні категорії): зверху три головні плитки (TOP),
 * далі три групи по дві плитки в ряд — усе видно без гортання. Пункт може вести в розділ із вкладками (ids — усі його розділи):
 * «Слова» = Картки + Словник, «Граматика» = Правила + Вправи тощо; вкладки — TABSETS нижче (js/ui/subnav.js).
 * «Я» (профіль, друзі, налаштування) — у картці профілю внизу меню.
 */
export const TOP = ['home', 'today', 'tutor'];
export const MENU = [
  { id: 'learn', label: 'Вивчати', items: [
    { id: 'words', label: 'Слова', icon: 'cards', href: '#/cards', ids: ['cards', 'vocab'] },
    { id: 'phrases', label: 'Фразник', icon: 'quotes', href: '#/phrases', ids: ['phrases'] },
    { id: 'grammar', label: 'Граматика', icon: 'puzzle-piece', href: '#/grammar', ids: ['grammar', 'exgrammar'] },
    { id: 'pron', label: 'Вимова', icon: 'waveform', href: '#/pronunciation/sounds', ids: ['sounds', 'pronunciation'] },
    { id: 'games', label: 'Ігри', icon: 'game-controller', href: '#/games', ids: ['games'] },
  ] },
  { id: 'practice', label: 'Практикувати', items: [
    { id: 'voice', label: 'Розмова голосом', icon: 'microphone', href: '#/tutor?mode=voice', ids: ['voice'] },
    { id: 'scenarios', label: 'Сценарії', icon: 'users-three', href: '#/scenarios', ids: ['scenarios'] },
    { id: 'fluency', label: 'Плавність', icon: 'timer', href: '#/fluency', ids: ['fluency'] },
    { id: 'listenread', label: 'Слухання й читання', icon: 'headphones', href: '#/listening', ids: ['listening', 'reading', 'listengo'] },
    { id: 'write', label: 'Письмо й щоденник', icon: 'pencil-line', href: '#/writing', ids: ['writing', 'diary'] },
  ] },
  { id: 'progress', label: 'Прогрес', items: [
    { id: 'mistakes', label: 'Мої помилки', icon: 'warning-circle', href: '#/mistakes', ids: ['mistakes'] },
    { id: 'tests', label: 'Тести', icon: 'exam', href: '#/tests', ids: ['tests'] },
    { id: 'stats', label: 'Статистика', icon: 'chart-line-up', href: '#/progress', ids: ['progress', 'analysis', 'report'] },
  ] },
];
/** Пункт меню для розділу (Картки й Словник — обидва в «Слова») */
export const menuItemOf = (sectionId) => MENU.flatMap(g => g.items).find(it => it.ids.includes(sectionId)) || null;

/** Вкладки вгорі сторінки для розділів, об'єднаних в один пункт меню (показуються лише на головних сторінках цих розділів) */
export const TABSETS = [
  [['cards', 'Картки'], ['vocab', 'Словник']],
  [['grammar', 'Правила'], ['exgrammar', 'Вправи']],
  [['sounds', 'Звуки'], ['pronunciation', 'Вправи']],
  [['listening', 'Аудіювання'], ['reading', 'Читання']],
  [['writing', 'Письмо'], ['diary', 'Щоденник']],
  [['progress', 'Прогрес'], ['analysis', 'Аналіз'], ['report', 'Звіт']],
];
export const tabsetOf = (sectionId) => TABSETS.find(t => t.some(([id]) => id === sectionId)) || null;

/** Сторінка «Вправи» (#/exercises): усі розділи практики */
export const PRACTICE_IDS = ['cards', 'exgrammar', 'voice', 'scenarios', 'fluency', 'listening', 'reading', 'pronunciation', 'writing', 'diary', 'mistakes', 'tests', 'games'];

export const byId = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

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
