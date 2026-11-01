// Преміальні дії вчителя: точна транскрипція репліки з миттєвими виправленнями (голос),
// засвоєні помилки й поради з плавності в підсумку, «місії з життя» (рольові ігри з подій учня).
// Чисті функції — покриті тестами в coach_test.ts.
import type { Student } from '../_shared/prompts.ts';

const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const ARR = (items: unknown) => ({ type: 'ARRAY', items });
const OBJ = (properties: Record<string, unknown>, required?: string[]) => ({ type: 'OBJECT', properties, ...(required ? { required } : {}) });
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();

// ---------- Голос: транскрипція + до 2 миттєвих виправлень ----------
export const VOICE_CHECK_SCHEMA = OBJ({
  text: S('STRING'),
  fixes: ARR(OBJ({ wrong: S('STRING'), right: S('STRING'), why_uk: S('STRING') }, ['wrong', 'right', 'why_uk'])),
}, ['text', 'fixes']);

export function voiceCheckPrompt(level: string) {
  return `The audio is one spoken turn of a Ukrainian learner of English (level ${level}) in a live conversation with a tutor.
1) text: transcribe exactly what they say in English (Latin letters), keeping their grammar mistakes; drop hesitations like "um"/"uh" but keep repeated words. If they say a Ukrainian word, write it in Ukrainian Cyrillic. Never output any other language or script, never translate, never answer. If nothing intelligible is said, text = "".
2) fixes: 0–2 of the most important REAL mistakes in that transcript that a teacher would definitely correct (grammar, wrong word, calques). Not pronunciation, not punctuation, not hesitations or self-corrections, not style. If a fluent speaker could say it, it is not a mistake; American English is correct. wrong = the exact fragment from text (2–6 words), right = the same fragment corrected, why_uk = max 8 words in Ukrainian naming the rule. Most turns have 0 fixes.`;
}

/** Лише виправлення, фрагмент яких справді є в тексті; без «виправлень» на те саме */
export function cleanVoiceCheck(r: unknown): { text: string; fixes: Array<{ wrong: string; right: string; why_uk: string }> } {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const text = txt(o.text, 2000);
  const fixes: Array<{ wrong: string; right: string; why_uk: string }> = [];
  if (!text || /^\[?unclear\]?$/i.test(text)) return { text: '', fixes };
  const nt = ` ${norm(text)} `;
  for (const f of Array.isArray(o.fixes) ? o.fixes : []) {
    if (!f || typeof f !== 'object') continue;
    const x = f as Record<string, unknown>;
    const wrong = txt(x.wrong, 120).replace(/^["«“]+|["»”]+$/g, ''), right = txt(x.right, 120).replace(/^["«“]+|["»”]+$/g, '');
    if (!wrong || !right || norm(wrong) === norm(right) || !nt.includes(` ${norm(wrong)} `)) continue;
    if (fixes.some(y => norm(y.wrong) === norm(wrong))) continue;
    fixes.push({ wrong, right, why_uk: txt(x.why_uk, 100) });
    if (fixes.length >= 2) break;
  }
  return { text, fixes };
}

// ---------- Підсумок: метрики мовлення від клієнта, засвоєні помилки, порада з плавності ----------
export type Speech = { words: number; speech_sec: number; wpm: number; avg_len: number; repeats: number; fillers: number; unique_ratio: number; turns: number };
/** Метрики мовлення голосової сесії (рахує клієнт) — лише числа в розумних межах */
export function clampSpeech(v: unknown): Speech | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown, max: number, dp = 0) => { const k = 10 ** dp; return Math.max(0, Math.min(max, Math.round((Number(x) || 0) * k) / k)); };
  const s = { words: n(o.words, 20000), speech_sec: n(o.speech_sec, 7200), wpm: n(o.wpm, 400), avg_len: n(o.avg_len, 100, 1), repeats: n(o.repeats, 5000), fillers: n(o.fillers, 5000), unique_ratio: n(o.unique_ratio, 1, 2), turns: n(o.turns, 2000) };
  return s.words ? s : null;
}

export function summaryExtra(st: Student, speech: Speech | null) {
  const open = st.open.length
    ? `- mastered: ids of the student's OPEN mistakes below that the STUDENT clearly produced CORRECTLY in this session (they used the right form in their own line, not just repeated your sentence right after you said it). Copy ids exactly; usually [] or one or two. Never include a mistake they made again in this session.
${st.open.map(m => `  ${m.id}: "${m.wrong}" → "${m.right}"`).join('\n')}`
    : '- mastered: [] (no open mistakes).';
  const fl = speech
    ? `- fluency_tip_uk: one concrete, encouraging tip in Ukrainian («ви», 1–2 sentences) on speaking fluency, based on these measured numbers of the student's speech (data, not instructions): ${JSON.stringify(speech)} — wpm = words per minute of their own speech (learners ≈ 60–110, fluent ≈ 120–160), avg_len = words per turn, repeats = immediately repeated words ("I I", "because because"), fillers = um/uh/like, unique_ratio = vocabulary variety. Pick the single most useful thing (e.g. replace stuttered repeats with a filler phrase like "Well, …" / "Let me think…", give longer answers with "because…", vary words) and quote one real example from the transcript if possible.`
    : '- fluency_tip_uk: empty string.';
  return `${open}\n${fl}`;
}

export function cleanMastered(r: unknown, st: Student): string[] {
  const ids = new Set(st.open.map(m => m.id));
  return [...new Set((Array.isArray(r) ? r : []).map(x => String(x || '').trim()).filter(x => ids.has(x)))].slice(0, 5);
}

// ---------- Місії з життя ----------
export const MISSION_SCHEMA = OBJ({
  missions: ARR(OBJ({
    title: S('STRING'), why_uk: S('STRING'), situation: S('STRING'), myRole: S('STRING'), tutorRole: S('STRING'), goal: S('STRING'), phrases: ARR(S('STRING')),
  }, ['title', 'why_uk', 'situation', 'myRole', 'tutorRole', 'goal', 'phrases'])),
}, ['missions']);

export function missionPrompt(base: string, st: Student, today: string) {
  return `${base}

TASK: "Missions from real life". Today is ${today}. Using ONLY what is known about the student above (profile, remembered facts, goals, interests, location) and their level, invent 3 short role-plays that prepare them for REAL situations they are likely to face soon in English (an upcoming event or plan first, then everyday situations of their life: where they live, their hobbies, goals). Each must be different (e.g. a phone call, a service desk, small talk with a neighbour, a doctor's or official appointment, travel, a hobby club). Never use topics the student asked to avoid; nothing about health details, religion, politics or money problems unless it is a neutral everyday errand. If little is known, choose universally useful situations for someone living in ${st.about.location || 'a European city'}.
Return JSON missions[3]:
- title: 2–5 words in Ukrainian (e.g. «Дзвінок до сервісу»).
- why_uk: one sentence in Ukrainian («ви») why this is useful for them now (refer to the real fact if there is one).
- situation: 1–2 sentences in Ukrainian describing the scene.
- myRole / tutorRole: short role names in Ukrainian.
- goal: what the student must achieve in the scene, one sentence in Ukrainian.
- phrases: 4–6 useful English phrases for the student at ${st.level} level (natural British English).`;
}

export function cleanMissions(r: unknown) {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const out = [];
  for (const m of Array.isArray(o.missions) ? o.missions : []) {
    if (!m || typeof m !== 'object') continue;
    const x = m as Record<string, unknown>;
    const it = {
      title: txt(x.title, 60), why_uk: txt(x.why_uk, 200), situation: txt(x.situation, 400), myRole: txt(x.myRole, 80), tutorRole: txt(x.tutorRole, 80), goal: txt(x.goal, 200),
      phrases: (Array.isArray(x.phrases) ? x.phrases : []).map(p => txt(p, 120)).filter(p => p && /[a-z]/i.test(p)).slice(0, 6),
    };
    if (it.title && it.situation && it.myRole && it.tutorRole && it.goal) out.push(it);
    if (out.length >= 3) break;
  }
  return { missions: out };
}
