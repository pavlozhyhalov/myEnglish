// Перевірка й нормалізація JSON-оцінки вимови від моделі (чиста функція — покрита deno test)

export type WordStatus = 'ok' | 'minor' | 'wrong' | 'missed';
export type WordResult = { word: string; ok: boolean; status: WordStatus; issue_uk?: string; tip_uk?: string };
export type PronResult = { score: number; heard: string; words: WordResult[]; tips: string[]; no_speech: boolean };

const STATUSES: WordStatus[] = ['ok', 'minor', 'wrong', 'missed'];
const cut = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
/** Слово без пунктуації, нижній регістр, єдиний апостроф */
export const clean = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9']/g, '');
/** Ключ для зіставлення: без апострофів (I'm = Im) */
const key = (s: string) => clean(s).replace(/'/g, '');

/** Слова еталона (як їх показує клієнт: розбиття за пробілами, без чисто пунктуаційних токенів) */
export function targetWords(text: string): string[] {
  return text.split(/\s+/).filter(w => clean(w));
}

/**
 * Нормалізує відповідь моделі: слова вирівнюються за еталоном (порядок і кількість — як у фразі),
 * невідомі поля відкидаються, рядки обрізаються, оцінка — ціле 0–100, порад 1–3.
 * Кидає Error('bad_shape'), якщо відповідь зовсім не схожа на оцінку.
 */
export function normalizeResult(raw: unknown, target: string): PronResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad_shape');
  const o = raw as Record<string, unknown>;
  const scoreN = Number(o.score);
  if (!Number.isFinite(scoreN)) throw new Error('bad_shape');
  const heard = cut(o.heard, 400);
  const noSpeech = o.no_speech === true || !clean(heard.replace(/\s/g, ''));

  // пул слів моделі: беремо перше ще не використане з тим самим «чистим» написанням
  const pool = (Array.isArray(o.words) ? o.words : []).slice(0, 80)
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map(w => ({ w, key: key(cut(w.word, 60)), used: false }));
  const words: WordResult[] = targetWords(target).slice(0, 40).map((word, i) => {
    const k = key(word);
    let hit = pool.find(p => !p.used && p.key === k);
    // запасний варіант: та сама позиція, якщо модель трохи інакше записала слово (I'm / Im)
    if (!hit && pool[i] && !pool[i].used && pool[i].key && (pool[i].key.startsWith(k.slice(0, 3)) || k.startsWith(pool[i].key.slice(0, 3)))) hit = pool[i];
    if (hit) hit.used = true;
    const m = hit?.w || {};
    let status: WordStatus = STATUSES.includes(m.status as WordStatus) ? m.status as WordStatus
      : m.ok === true ? 'ok' : m.ok === false ? 'wrong' : 'ok';
    if (noSpeech) status = 'missed';
    const r: WordResult = { word, ok: status === 'ok', status };
    if (status !== 'ok') {
      const issue = cut(m.issue_uk, 160), tip = cut(m.tip_uk, 200);
      if (issue) r.issue_uk = issue;
      if (tip) r.tip_uk = tip;
    }
    return r;
  });

  let tips = (Array.isArray(o.tips) ? o.tips : []).map(t => cut(t, 240)).filter(Boolean);
  tips = [...new Set(tips)].slice(0, 3);
  if (!tips.length) tips = [noSpeech ? 'Мовлення не почуто: говоріть ближче до мікрофона й трохи голосніше.' : 'Чудово! Повторіть фразу ще раз у природному темпі.'];

  let score = Math.round(Math.min(100, Math.max(0, scoreN)));
  if (noSpeech) score = 0;
  // оцінка не може бути високою, якщо більшість слів помилкові або пропущені
  const bad = words.filter(w => w.status === 'wrong' || w.status === 'missed').length;
  if (words.length && bad / words.length > 0.5) score = Math.min(score, 50);
  return { score, heard, words, tips, no_speech: noSpeech };
}
