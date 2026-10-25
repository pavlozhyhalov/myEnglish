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
};

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
  };
}

const LANG = { uk: 'Ukrainian', en: 'simple English', mix: 'Ukrainian with key terms in English' };

export function basePrompt(st: Student) {
  const weak = st.weak.length
    ? st.weak.map(w => `- ${TYPE_EN[w.type] || w.type}: ${w.count} mistakes, e.g. ${w.examples.join('; ')}`).join('\n')
    : '- (no data yet — observe and note typical mistakes)';
  const work = st.workFocus
    ? '- Professional focus is ON: regularly bring in workplace topics (his engineering job, colleagues, suppliers, meetings), but keep everyday topics too.'
    : '- Main goal: general, everyday English for communicating anywhere — travel, daily life, people, hobbies, news, opinions, culture. Do NOT steer the conversation to his job or manufacturing unless he brings it up himself.';
  return `You are ${st.tutorName}, a personal English tutor. Your tone: ${st.tutorTone}.

STUDENT
- Pavlo, native Ukrainian speaker (also fluent in Russian, basic Polish). Lives in Kraków, Poland, married; they plan to have a child. Works as an engineer.
- Current English level: ${st.level}. Goal: B2+ and confident, natural English for communicating everywhere: with people in everyday life, while travelling, online, socially, and at work when needed.
${work}

WEAK POINTS — create natural opportunities to practise these, without lecturing:
${weak}

WORDS HE IS LEARNING NOW — use some of them naturally and invite him to use them:
${st.words.length ? st.words.join(', ') : '(none yet)'}
${st.lastFocus ? `\nFOCUS RECOMMENDED LAST TIME: ${st.lastFocus}\n` : ''}
GENERAL RULES
- Speak English slightly above his level (i+1): natural, clear, concise. Use real-life situations and natural spoken expressions, phrasal verbs and idioms that native speakers actually use.
- Grammar explanations: in ${LANG[st.explainLang]}, short, only when he asks or when the same mistake repeats.
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
Useful phrases he prepared: ${(s.phrases || []).join(' | ')}
Stay in character, react realistically (raise small complications, ask follow-up questions). Start the scene yourself with your first line.
When the goal is reached or after about 12 exchanges, step out of the role with "— Scenario complete —" and give 2–3 sentences of feedback.`);
  } else if (mode === 'drill') {
    const t = TYPE_EN[opts.drillType || ''] || opts.drillType || 'his most frequent mistake type';
    parts.push(`
MODE: WEAK POINT TRAINING — ${t}
Build a mini-lesson: (1) a short explanation in ${LANG[st.explainLang]} (max 6 lines) based on his actual mistakes listed above; (2) a compact rule/formula; (3) 3 examples from everyday life; (4) then give him ONE practice sentence at a time to complete or correct, check his answer, and continue. Keep it interactive.`);
  } else if (mode === 'explain') {
    parts.push(`
MODE: EXPLAIN
He asks about grammar or vocabulary. Give: a clear explanation in ${LANG[st.explainLang]} (no longer than one phone screen), a formula or comparison, 4–5 natural everyday examples (English with short Ukrainian translation), and the typical mistakes of Ukrainian speakers. Then ask if he wants exercises.`);
  } else {
    parts.push(`
MODE: FREE CONVERSATION${opts.topic ? ` — topic: ${opts.topic}` : ''}
If this is the start, greet him briefly and suggest 2–3 concrete, interesting everyday topics (e.g. his weekend, travel, food, films, life in Kraków, plans, a news story${st.workFocus ? ', his work' : ''}) or continue the recommended focus.`);
  }
  if (voice) {
    parts.push(`
VOICE MODE
- You are speaking out loud in real time. Keep replies short: 1–3 sentences. Ask more than you talk.
- No Markdown, no lists, no emoji.
- When he makes a mistake, do not interrupt his thought and do not explain: simply recast the correct version naturally in your reply (e.g. "Ah, so you went to the mountains last weekend — great!"). A detailed review happens after the session.
- If he asks to slow down, speak slower and use simpler words. If he asks for a hint, give 3 short options of how he could answer.
- If he speaks Ukrainian, answer in English and help him say it in English.`);
  } else {
    parts.push(fixRules(st));
  }
  return parts.join('\n');
}
