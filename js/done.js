// Єдине джерело «пройдено / готово сьогодні» для плиток-завдань (2026-11-23, власник: «щоб в майбутньому у всіх все працювало коректно» —
// сценарій дня на головній не ставав зеленим, бо кожен екран рахував «виконано» по-своєму або не рахував зовсім).
// Нова плитка, що веде на завдання (сценарій, розмова на тему), бере «готово» звідси, а не пише власну перевірку.
import * as store from './store.js';
import { dayKey, today } from './stats.js';
import { pickOfDay } from './level.js';

/** Скільки власних (не службових) реплік учня в розмові */
export const ownLines = (c) => (Array.isArray(c?.messages) ? c.messages : [])
  .filter(m => m && m.role === 'user' && !m.cue && !m.hidden && String(m.text || '').trim()).length;
/** Розмова справді відбулась: щонайменше 2 власні репліки (відкрив і вийшов — не рахується) */
export const spoke = (c, min = 2) => ownLines(c) >= min;
const isToday = (c) => dayKey(c.created_at || c.updated_at || '') === today();
const chats = () => store.all('tutor_chats').filter(c => !c.deleted);

/** Сценарій зіграно колись (голосом чи текстом) */
export const scenarioPlayed = (id) => !!id && chats().some(c => c.scenario === id && spoke(c));
/** Сценарій зіграно сьогодні */
export const scenarioDoneToday = (id) => !!id && chats().some(c => c.scenario === id && isToday(c) && spoke(c));
/** Голосова розмова на тему з підписом (`#/tutor?mode=voice&label=…` → назва «Голос: …») сьогодні */
export const talkDoneToday = (label) => !!label && chats().some(c => c.title === `Голос: ${label}` && isToday(c) && spoke(c));

/** Завдання «Письма» перевірено вчителем (`summary.writing` = id завдання) колись / сьогодні */
const writingChats = (id) => chats().filter(c => c.mode === 'check' && c.summary?.writing === id);
export const writingWritten = (id) => !!id && writingChats(id).length > 0;
export const writingDoneToday = (id) => !!id && writingChats(id).some(isToday);

/**
 * Сценарій дня з набору: зіграний сьогодні лишається (показується зеленим «готово»), інакше — непройдений
 * (пройдене не пропонується знову, як діалоги й тексти з 2026-11-19), а коли пройдено все — будь-який. Стабільний протягом дня.
 */
export function scenarioOfDay(items, salt = '') {
  return taskOfDay(items, salt, scenarioPlayed, scenarioDoneToday);
}

/** Те саме для будь-якого набору завдань: played(id) — пройдено колись, doneToday(id) — сьогодні */
export function taskOfDay(items, salt, played, doneToday) {
  if (!items?.length) return null;
  const doneNow = items.find(x => doneToday(x.id));
  if (doneNow) return doneNow;
  // вибір дня запам'ятовується: сценарій, зіграний деінде, не підміняє плитку посеред дня
  const key = `me:day-pick:${salt}`;
  let memo = null;
  try { memo = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* */ }
  const kept = memo?.day === today() && items.find(x => x.id === memo.id);
  if (kept) return kept;
  const fresh = items.filter(x => !played(x.id));
  const pick = pickOfDay(fresh.length ? fresh : items, salt);
  try { if (pick) localStorage.setItem(key, JSON.stringify({ day: today(), id: pick.id })); } catch { /* */ }
  return pick;
}
