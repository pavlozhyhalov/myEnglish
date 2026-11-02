// Реєстр розділів: id, адреса, іконка Phosphor (вона ж — значок у плашках), категорія бокового меню.
// Меню (рішення власника 2026-11-02): зверху — Головна, Мій день, Вчитель; далі розкривні категорії
// «Вивчати», «Практикувати», «Контроль і прогрес», «Я» з підкатегоріями (CATEGORIES нижче).
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
 * Бокове меню: категорія (розкривається) → підкатегорія (підпис) → розділи.
 * menu — коротша назва пункту в контексті підкатегорії (у шапці сторінки й нижній панелі лишається звичайна).
 */
export const CATEGORIES = [
  { id: 'learn', label: 'Вивчати', icon: 'graduation-cap', subs: [
    { label: 'Слова', items: [['cards', 'Картки'], ['vocab', 'Слова й фрази'], ['phrases', 'Фразник'], ['games', 'Ігри зі словами']] },
    { label: 'Граматика', items: [['grammar', 'Правила'], ['exgrammar', 'Вправи']] },
    { label: 'Вимова', items: [['sounds', 'Звуки'], ['pronunciation', 'Вправи на вимову']] },
  ] },
  { id: 'practice', label: 'Практикувати', icon: 'barbell', subs: [
    { label: 'Говоріння', items: [['voice', 'Розмова голосом'], ['scenarios', 'Сценарії'], ['fluency', 'Тренажер плавності']] },
    { label: 'Слухання й читання', items: [['listening', 'Аудіювання'], ['reading', 'Читання']] },
    { label: 'Письмо', items: [['writing', 'Письмо'], ['diary', 'Щоденник']] },
  ] },
  { id: 'check', label: 'Контроль і прогрес', icon: 'chart-line-up', subs: [
    { label: 'Перевірка', items: [['mistakes', 'Мої помилки'], ['tests', 'Тести']] },
    { label: 'Статистика', items: [['progress', 'Прогрес'], ['analysis', 'Аналіз'], ['report', 'Звіт за місяць']] },
  ] },
  { id: 'me', label: 'Я', icon: 'user', subs: [
    { label: null, items: [['profile', 'Профіль'], ['friends', 'Друзі'], ['settings', 'Налаштування']] },
  ] },
];
/** Сторінка «Вправи» (#/exercises): усі розділи практики */
export const PRACTICE_IDS = ['cards', 'exgrammar', 'voice', 'scenarios', 'fluency', 'listening', 'reading', 'pronunciation', 'writing', 'diary', 'mistakes', 'tests', 'games'];

export const byId = Object.fromEntries(SECTIONS.map(s => [s.id, s]));
export const GROUPS = CATEGORIES.map(c => c.id);
/** Категорія меню, у якій розділ */
export const categoryOf = (id) => CATEGORIES.find(c => c.subs.some(sb => sb.items.some(([x]) => x === id)))?.id || null;

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
