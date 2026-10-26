import type { Ctx } from './auth.ts';

export type Student = {
  level: string;
  tutorName: string;
  tutorTone: string;
  explainLang: 'uk' | 'en' | 'mix';
  strictness: 'important' | 'all';
  voice: string;
  workFocus: boolean;
  weak: Array<{ type: string; count: number; examples: string[] }>;
  words: string[];
  lastFocus: string | null;
  about: About;
};

/** Дані, які учень вказав у профілі (#/profile) — усе необов'язкове, довжини обмежені */
export type About = {
  name: string; pronoun: 'he' | 'she' | 'they'; nativeLang: string; otherLangs: string; location: string; age: string;
  occupation: string; family: string; interests: string; goals: string[]; avoid: string; notes: string;
};
const GOALS_EN: Record<string, string> = {
  travel: 'travelling', people: 'talking with people / making friends', work: 'work and career', moving: 'living abroad / moving',
  exam: 'passing an exam', kids: 'helping their children', media: 'films, books, music and the internet in English', self: 'self-development',
};
// назви мов, які учень пише українською, — англійською для промпту
const LANG_EN: Record<string, string> = { 'українська': 'Ukrainian', 'російська': 'Russian', 'польська': 'Polish', 'англійська': 'English', 'німецька': 'German', 'білоруська': 'Belarusian', 'іспанська': 'Spanish', 'французька': 'French', 'італійська': 'Italian', 'чеська': 'Czech' };
const langEn = (s: string) => LANG_EN[s.toLowerCase()] || s;
const cut = (v: unknown, n: number) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, n);
function readAbout(a: Record<string, unknown> = {}): About {
  const pr = a.pronoun === 'he' || a.pronoun === 'she' ? a.pronoun : 'they';
  return {
    name: cut(a.name, 40), pronoun: pr, nativeLang: langEn(cut(a.nativeLang, 40)) || 'Ukrainian', otherLangs: cut(a.otherLangs, 120),
    location: cut(a.location, 80), age: cut(a.age, 20), occupation: cut(a.occupation, 120), family: cut(a.family, 200),
    interests: cut(a.interests, 300), goals: (Array.isArray(a.goals) ? a.goals : []).filter((g): g is string => typeof g === 'string' && g in GOALS_EN).slice(0, 8),
    avoid: cut(a.avoid, 200), notes: cut(a.notes, 500),
  };
}
/** Займенники учня для промптів */
export function pron(st: Student) {
  const p = st.about.pronoun;
  return p === 'he' ? { s: 'he', o: 'him', p: 'his' } : p === 'she' ? { s: 'she', o: 'her', p: 'her' } : { s: 'they', o: 'them', p: 'their' };
}
/** Блок STUDENT із профілю: лише заповнені поля */
function studentBlock(st: Student) {
  const a = st.about, P = pron(st);
  const lines = [
    a.name ? `- Name: ${a.name} — address the student by this name. Refer to the student as "${P.s}".` : `- Refer to the student as "${P.s}". If you don't know their name, you may ask once.`,
    `- Native language: ${a.nativeLang}${a.otherLangs ? `. Also speaks: ${a.otherLangs}` : ''}. Expect typical mistakes of ${a.nativeLang} speakers.`,
    a.location && `- Lives in: ${a.location}`,
    a.age && `- Age: ${a.age}`,
    a.occupation && `- Occupation: ${a.occupation}`,
    a.family && `- Family: ${a.family}`,
    a.interests && `- Interests and hobbies: ${a.interests} — use them for topics and examples.`,
    a.goals.length && `- Learns English for: ${a.goals.map(g => GOALS_EN[g]).join(', ')}.`,
    a.avoid && `- Topics to AVOID: ${a.avoid}`,
    a.notes && `- Notes from the student: ${a.notes}`,
  ];
  return lines.filter(Boolean).join('\n');
}

const TYPE_EN: Record<string, string> = {
  articles: 'articles (a/an/the/zero article)', tenses: 'verb tenses', prepositions: 'prepositions',
  word_order: 'word order (questions, adverbs)', vocabulary: 'word choice / vocabulary', pronunciation: 'pronunciation', other: 'other grammar',
};

/** Контекст учня з БД (RLS — лише його рядки) */
export async function loadStudent(ctx: Ctx): Promise<Student> {
  const [prof, mistakes, cards] = await Promise.all([
    ctx.db.from('profiles').select('data').maybeSingle(),
    ctx.db.from('mistakes').select('wrong,right,type,count').eq('resolved', false).eq('deleted', false).order('count', { ascending: false }).limit(40),
    ctx.db.from('cards').select('en,stability,last_review').eq('deleted', false).gt('reps', 0).lt('stability', 21).order('last_review', { ascending: false }).limit(15),
  ]);
  const d = (prof.data?.data || {}) as Record<string, any>;
  const s = (d.settings || {}) as Record<string, any>;
  const byType = new Map<string, { type: string; count: number; examples: string[] }>();
  for (const m of mistakes.data || []) {
    const e = byType.get(m.type) || { type: m.type, count: 0, examples: [] as string[] };
    e.count += m.count || 1;
    if (e.examples.length < 2) e.examples.push(`"${m.wrong}" → "${m.right}"`);
    byType.set(m.type, e);
  }
  return {
    level: d.level || s.level || 'B1',
    tutorName: s.tutorName || 'Alex',
    tutorTone: s.tutorTone || 'friendly but demanding',
    explainLang: s.explainLang || 'uk',
    strictness: s.strictness || 'important',
    voice: s.voice || 'Puck',
    workFocus: !!s.workFocus,
    weak: [...byType.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    words: (cards.data || []).map(c => c.en),
    lastFocus: d.lastFocus || null,
    about: readAbout((d.about || {}) as Record<string, unknown>),
  };
}

const LANG = { uk: 'Ukrainian', en: 'simple English', mix: 'Ukrainian with key terms in English' };
const NEXT: Record<string, string> = { A1: 'A2', A2: 'B1', B1: 'B2', B2: 'C1', C1: 'C2' };
/** Як говорити з учнем цього рівня — рівень обирає учень (тест або вручну), тож він має реально змінювати мову вчителя */
const LEVEL_STYLE: Record<string, string> = {
  A1: 'Use very short, simple sentences (Present Simple, to be, can, there is), the 500 most common words, and speak slowly. Ask simple yes/no or either/or questions. If the student is stuck, offer the words they need. A short hint in their native language is fine when they are clearly lost.',
  A2: 'Use short sentences and everyday vocabulary; Past Simple, going to, basic modals. Avoid idioms and phrasal verbs except the most common ones (get up, look for). Paraphrase anything harder.',
  B1: 'Use natural everyday English with common phrasal verbs and a few easy idioms; mix tenses naturally. Explain a new expression briefly when you use it.',
  B2: 'Speak naturally as with a fluent non-native colleague: idioms, phrasal verbs, conditionals, nuance. Push the student to justify opinions and to use more precise vocabulary.',
  C1: 'Speak as with an educated native speaker: rich vocabulary, idiomatic and register-appropriate language, complex structures (inversion, cleft sentences, mixed conditionals). Challenge the student on precision, style and nuance, not just correctness.',
};

export function basePrompt(st: Student) {
  const weak = st.weak.length
    ? st.weak.map(w => `- ${TYPE_EN[w.type] || w.type}: ${w.count} mistakes, e.g. ${w.examples.join('; ')}`).join('\n')
    : '- (no data yet — observe and note typical mistakes)';
  const work = st.workFocus
    ? `- Professional focus is ON: regularly bring in workplace topics (${st.about.occupation ? `their job: ${st.about.occupation}` : 'their job'}, colleagues, meetings), but keep everyday topics too.`
    : '- Main goal: general, everyday English for communicating anywhere — travel, daily life, people, hobbies, news, opinions, culture. Do NOT steer the conversation to the student\'s job unless they bring it up themselves.';
  return `You are ${st.tutorName}, a personal English tutor. Your tone: ${st.tutorTone}.

STUDENT
${studentBlock(st)}
- Current English level: ${st.level}. Next target: ${NEXT[st.level] || 'B2'}. Overall goal: confident, natural English for communicating everywhere: with people in everyday life, while travelling, online, socially, and at work when needed.
${work}

WEAK POINTS — create natural opportunities to practise these, without lecturing:
${weak}

WORDS THE STUDENT IS LEARNING NOW — use some of them naturally and invite the student to use them:
${st.words.length ? st.words.join(', ') : '(none yet)'}
${st.lastFocus ? `\nFOCUS RECOMMENDED LAST TIME: ${st.lastFocus}\n` : ''}
GENERAL RULES
- LEVEL ${st.level}: ${LEVEL_STYLE[st.level] || LEVEL_STYLE.B1}
- Speak English slightly above the student's level (i+1): natural, clear, concise. Use real-life situations and natural spoken expressions, phrasal verbs and idioms that native speakers actually use.
- Grammar explanations: in ${LANG[st.explainLang]}, short, only when the student asks or when the same mistake repeats.
- Keep the conversation going: usually end your turn with one question.
- Do not use emoji. Use light Markdown only (bold, short lists).`;
}

function fixRules(st: Student) {
  const what = st.strictness === 'all'
    ? 'any mistakes, including small style, article and punctuation issues and unnatural phrasing'
    : 'mistakes that matter: grammar errors, wrong words, and phrasing that sounds unnatural or changes the meaning (ignore punctuation and capitalisation)';
  return `
CORRECTIONS (text chat)
After your reply, check ONLY the student's last message for ${what}.
If there are such mistakes, append exactly one line "---FIX---" and then one line per mistake in this format:
- <wrong fragment> → <corrected fragment> — <коротке пояснення українською>
If there are no mistakes, do not add the block at all. Never mention this block in the reply itself, and do not correct the student inside the reply text.`;
}

export type Scenario = { title?: string; situation?: string; myRole?: string; tutorRole?: string; goal?: string; phrases?: string[] };

export function modePrompt(mode: string, st: Student, opts: { scenario?: Scenario | null; drillType?: string | null; topic?: string | null; voice?: boolean }) {
  const parts = [basePrompt(st)];
  const voice = !!opts.voice;
  if (mode === 'scenario' && opts.scenario) {
    const s = opts.scenario;
    parts.push(`
MODE: ROLE-PLAY
Situation: ${s.situation}
You play: ${s.tutorRole}. The student plays: ${s.myRole}.
Student's goal: ${s.goal}
Useful phrases the student prepared: ${(s.phrases || []).join(' | ')}
Stay in character, react realistically (raise small complications, ask follow-up questions). Start the scene yourself with your first line.
When the goal is reached or after about 12 exchanges, step out of the role with "— Scenario complete —" and give 2–3 sentences of feedback.`);
  } else if (mode === 'drill') {
    const t = TYPE_EN[opts.drillType || ''] || opts.drillType || 'the student\'s most frequent mistake type';
    parts.push(`
MODE: WEAK POINT TRAINING — ${t}
Build a mini-lesson: (1) a short explanation in ${LANG[st.explainLang]} (max 6 lines) based on the student's actual mistakes listed above; (2) a compact rule/formula; (3) 3 examples from everyday life; (4) then give ONE practice sentence at a time to complete or correct, check the answer, and continue. Keep it interactive.`);
  } else if (mode === 'explain') {
    parts.push(`
MODE: EXPLAIN
The student asks about grammar or vocabulary. Give: a clear explanation in ${LANG[st.explainLang]} (no longer than one phone screen), a formula or comparison, 4–5 natural everyday examples (English with short Ukrainian translation), and the typical mistakes of ${st.about.nativeLang} speakers. Then ask if they want exercises.`);
  } else {
    parts.push(`
MODE: FREE CONVERSATION${opts.topic ? ` — topic: ${opts.topic}` : ''}
If this is the start, greet the student briefly${st.about.name ? ` by name (${st.about.name})` : ''} and suggest 2–3 concrete, interesting everyday topics (e.g. their weekend, travel, food, films${st.about.interests ? `, their interests: ${st.about.interests}` : ''}${st.about.location ? `, life in ${st.about.location}` : ''}, plans, a news story${st.workFocus ? ', their work' : ''}) or continue the recommended focus.`);
  }
  if (voice) {
    parts.push(`
VOICE MODE
- You are speaking out loud in real time. Keep replies short: 1–3 sentences. Ask more than you talk.
- No Markdown, no lists, no emoji.
- When the student makes a mistake, do not interrupt their thought and do not explain: simply recast the correct version naturally in your reply (e.g. "Ah, so you went to the mountains last weekend — great!"). A detailed review happens after the session.
- If the student asks to slow down, speak slower and use simpler words. If they ask for a hint, give 3 short options of how they could answer.
- If the student speaks their native language, answer in English and help them say it in English.`);
  } else {
    parts.push(fixRules(st));
  }
  return parts.join('\n');
}
