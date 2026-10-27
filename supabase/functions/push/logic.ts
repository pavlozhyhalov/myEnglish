// Чиста логіка нагадувань (без мережі й бази) — покрита тестами в logic_test.ts

export const ACTIVE_DAY_SEC = 5 * 60;     // день зараховується в стрік від 5 хв (як js/stats.js)
export const WINDOW_MIN = 120;            // нагадування надсилається протягом 2 год після обраного часу (cron — кожні 15 хв)

/** Локальні дата (YYYY-MM-DD) і хвилини від півночі в часовому поясі tz */
export function localParts(now: Date, tz: string): { day: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    return localParts(now, 'Europe/Kyiv');
  }
  const g = (t: string) => parts.find(p => p.type === t)?.value || '0';
  return { day: `${g('year')}-${g('month')}-${g('day')}`, minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}

/** '19:00' або '19:00:00' → хвилини від півночі. Пізніше 23:45 — 23:45: вікно не переходить через північ, а cron іде кожні 15 хв */
export function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return 19 * 60;
  return Math.min(23 * 60 + 45, Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])));
}

/** Чи настав час надіслати: обраний час щойно минув (у межах вікна) і сьогодні ще не надсилали */
export function isDue(now: Date, sub: { tz: string; remind_at: string; last_sent_day: string | null }) {
  const { day, minutes } = localParts(now, sub.tz);
  const diff = minutes - timeToMinutes(sub.remind_at);
  return { due: diff >= 0 && diff < WINDOW_MIN && sub.last_sent_day !== day, day };
}

const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);

/** Стрік за сумами секунд по днях (як streak() у js/stats.js): сьогодні ще не зараховано — рахуємо від учора */
export function streakFrom(secByDay: Map<string, number>, today: string): number {
  const byNum = new Map<number, number>();
  for (const [d, s] of secByDay) byNum.set(dayNum(d), (byNum.get(dayNum(d)) || 0) + s);
  let n = dayNum(today);
  if ((byNum.get(n) || 0) < ACTIVE_DAY_SEC) n--;
  let streak = 0;
  while ((byNum.get(n) || 0) >= ACTIVE_DAY_SEC) { streak++; n--; }
  return streak;
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export type Kinds = { cards?: boolean; streak?: boolean };
export type Message = { title: string; body: string; url: string; tag: string };

/** Текст нагадування або null, якщо нагадувати нема про що */
export function buildMessage({ due, todaySec, streak, kinds }: { due: number; todaySec: number; streak: number; kinds: Kinds }): Message | null {
  const wantCards = kinds.cards !== false && due > 0;
  const wantStreak = kinds.streak !== false && todaySec < ACTIVE_DAY_SEC;
  if (!wantCards && !wantStreak) return null;
  const cardsLine = `${due} ${plural(due, 'картка чекає', 'картки чекають', 'карток чекають')} на повторення.`;
  const left = Math.max(1, Math.ceil((ACTIVE_DAY_SEC - todaySec) / 60));
  const leftTxt = `${left} ${plural(left, 'хвилину', 'хвилини', 'хвилин')}`;
  let title: string, body: string;
  if (wantStreak && streak > 0) {
    title = 'Стрік під загрозою';
    body = `Ваш стрік — ${streak} ${plural(streak, 'день', 'дні', 'днів')}. Позаймайтеся ще ${leftTxt}, щоб його зберегти.`;
    if (wantCards) body += ' ' + cardsLine;
  } else if (wantCards) {
    title = 'Час повторити картки';
    body = cardsLine + (wantStreak ? ` Ще ${leftTxt} практики — і день зарахується в стрік.` : '');
  } else {
    title = 'Час для англійської';
    body = `Ще ${leftTxt} практики — і сьогоднішній день зарахується в стрік.`;
  }
  return { title, body, url: wantCards ? '#/cards/review' : '#/', tag: 'myenglish-reminder' };
}

/** Порівняння секретів без витоку через час виконання */
export function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
