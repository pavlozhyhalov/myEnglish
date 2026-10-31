// Чисті функції для відповіді вчителя: відокремлення блоку ---FIX--- під час стрімінгу,
// перевірка виправлень, очищення meta (підказки, слова, пам'ять). Без залежностей — покриті reply_test.ts.

export const FIX = '---FIX---';

/** Маркер блоку виправлень, зокрема зіпсовані варіанти: «--- FIX ---», «**---FIX---**», «---FIXES---», «—FIX—», також посеред рядка */
const MARKER = /[*_`]*[ \t]*[-—–]{2,}[ \t]*fix(?:es)?[ \t]*[-—–]{2,}[ \t]*[*_`]*/i;
/** Кінець незавершеного рядка, що ще може стати маркером, — притримуємо його до наступного шматка */
const TAIL = /(?:[*_`]+\s*|[*_`]*\s*[-—–]+\s*(?:f(?:i(?:x(?:e(?:s)?)?)?)?)?\s*[-—–]*\s*[*_`]*)$/i;

/**
 * Розділювач потоку: текст відповіді віддається одразу (крім кінця рядка, схожого на початок маркера),
 * усе після маркера накопичується і повертається в end() для перевірки.
 */
export class FixSplitter {
  private held = '';      // притриманий кінець тексту
  private inFix = false;
  private fixRaw = '';
  body = '';              // увесь відданий текст відповіді

  push(chunk: string): string {
    if (this.inFix) { this.fixRaw += chunk; return ''; }
    const s = this.held + chunk;
    this.held = '';
    const m = MARKER.exec(s);
    if (m) {
      this.inFix = true;
      this.fixRaw = s.slice(m.index + m[0].length);
      return this.emit(s.slice(0, m.index).replace(/\s+$/, ''));
    }
    // притримуємо лише хвіст останнього рядка
    const nl = s.lastIndexOf('\n');
    const last = s.slice(nl + 1);
    const t = TAIL.exec(last);
    if (t && t[0].trim()) { this.held = last.slice(t.index); return this.emit(s.slice(0, nl + 1 + t.index)); }
    return this.emit(s);
  }

  private emit(out: string) { this.body += out; return out; }

  /** Чи вже почався блок виправлень (текст відповіді завершено) */
  get inFixBlock() { return this.inFix; }

  /** Кінець потоку: залишок тексту відповіді (якщо був притриманий) і сирий блок виправлень (null — блоку не було) */
  end(): { tail: string; fixRaw: string | null } {
    if (this.inFix) { this.body = this.body.replace(/\s+$/, ''); return { tail: '', fixRaw: this.fixRaw.replace(/^[-—–*_`]+/, '') }; }
    const l = this.held; this.held = '';
    this.body += l;
    return { tail: l, fixRaw: null };
  }
}

/** Розбити повний текст (нестрімінговий режим) на відповідь і сирий блок */
export function splitReply(text: string): { body: string; fixRaw: string | null } {
  const sp = new FixSplitter();
  sp.push(text);
  const { fixRaw } = sp.end();
  return { body: sp.body.trim(), fixRaw };
}

export type Fix = { wrong: string; right: string; why: string };

const norm = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();
const unquote = (s: string) => s.trim().replace(/^[*_`"«“„']+|[*_`"»”']+$/g, '').trim();
const CYR = /[Ѐ-ӿ]/;

/** Відмінність лише в британському/американському написанні (colour/color, realise/realize, centre/center, travelled/traveled) */
export function spellingVariant(a: string, b: string) {
  const canon = (s: string) => norm(s)
    .replace(/our\b/g, 'or').replace(/is(e|ed|es|ing|ation)\b/g, 'iz$1').replace(/yse\b/g, 'yze')
    .replace(/tre\b/g, 'ter').replace(/ll(ed|ing|er)\b/g, 'l$1').replace(/ogue\b/g, 'og').replace(/ence\b/g, 'ense');
  return norm(a) !== norm(b) && canon(a) === canon(b);
}

/** Фрагмент справді є в повідомленні учня (точно або більшість слів по порядку не важливо) */
export function foundIn(fragment: string, message: string) {
  const f = norm(fragment), m = norm(message);
  if (!f) return false;
  if (m.includes(f)) return true;
  const words = new Set(m.split(' '));
  const fw = f.split(' ');
  const hit = fw.filter(w => words.has(w)).length;
  return fw.length >= 2 && hit / fw.length >= 0.6;
}

/**
 * Рядки блоку виправлень → перевірені виправлення. Відкидаємо: биті рядки, «None», фрагменти, яких немає в повідомленні учня,
 * виправлення без зміни (для strictness 'important' — також лише регістр/пунктуація), британське ↔ американське написання, кирилицю.
 */
export function cleanFixes(raw: string, studentMsg: string, strictness: 'important' | 'all' = 'important', max = 5): Fix[] {
  const out: Fix[] = [];
  const seen = new Set<string>();
  for (let line of String(raw || '').split('\n')) {
    line = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!line) continue;
    const m = line.match(/^(.*?)\s*(?:→|->|=>|⟶)\s*(.*?)(?:\s+[—–-]{1,2}\s+(.*))?$/);
    if (!m) continue;
    let right0 = m[2], why0 = m[3] || '';
    // пояснення без « — »: «I go → I went (минулий час)», «I go → I went: минулий час»
    const tail = !why0 && CYR.test(right0) ? right0.match(/^(.*?[^\s(:;,])\s*(?:\(|:|;|,)\s*([«"]?[Ѐ-ӿ][^]*?)\)?$/) : null;
    if (tail && !CYR.test(tail[1])) { right0 = tail[1]; why0 = tail[2]; }
    const wrong = unquote(m[1]), right = unquote(right0), why = why0.trim();
    if (!wrong || !right || /^(none|no mistakes?|n\/a|—|-)$/i.test(right)) continue;
    if (CYR.test(wrong) || CYR.test(right)) continue;
    if (wrong === right) continue;
    if (strictness === 'important' && norm(wrong) === norm(right)) continue;
    if (spellingVariant(wrong, right)) continue;
    if (studentMsg && !foundIn(wrong, studentMsg)) continue;
    const key = norm(wrong) + '|' + norm(right);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ wrong: wrong.slice(0, 160), right: right.slice(0, 160), why: why.replace(/\s+/g, ' ').slice(0, 300) });
    if (out.length >= max) break;
  }
  return out;
}

/** Блок у форматі, який розбирає клієнт (parseReply у js/pages/tutor.js) */
export function formatFixes(fixes: Fix[]) {
  if (!fixes.length) return '';
  return `\n\n${FIX}\n` + fixes.map(f => `- ${f.wrong} → ${f.right}${f.why ? ` — ${f.why}` : ''}`).join('\n');
}

// ---------- meta ----------
export type Meta = { suggestions?: string[]; words?: Array<{ en: string; uk: string }>; memory?: string[]; plan?: string[] };

/** Чутливі категорії не запам'ятовуємо (здоров'я, релігія, політика, гроші, документи, контакти) */
const SENSITIVE = /\b(diagnos|illness|disease|cancer|depress|anxiety disorder|medication|pregnan|hiv|therapy|therapist|disabilit|religio|church|mosque|pray|atheis|politic|vote[ds]?\b|party member|salary|debt|loan|income|passport|password|phone number|address is|\d{5,}|\+\d{2,}|\d{3}[ -]\d{2,3}[ -]\d{2,}|@\w+\.|sexual|gay|lesbian|bisexual|transgender)/i;

/** Відносний час у факті пам'яті швидко застаріває — такі факти не зберігаємо (модель має писати абсолютні дати) */
const RELATIVE_TIME = /\b(yesterday|today|tonight|tomorrow|recently|soon|lately|ago|(?:next|last|this|coming) (?:week(?:end)?|month|year|summer|winter|spring|autumn|fall|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
/** Не «нові слова»: службова лексика граматики й шаблонні похвали */
const NOT_WORDS = /\b(noun|verb|tenses?|articles?|adjective|adverb|preposition|(?:un)?countable|plural|singular|infinitive|gerund|clause|conditional|passive|participle|auxiliary|modal|past simple|present perfect|continuous)\b|^(spot on|well done|great job|good job|exactly|correct|nice try|perfect|excellent)$/i;

const nk = (s: string) => norm(s).replace(/\b(the|a|an|is|are|has|have|student|they|he|she)\b/g, '').replace(/\s+/g, ' ').trim();

/** Нові факти про учня: обрізання, без чутливого, без дублікатів відомого (включно з частковим збігом) */
export function cleanMemory(list: unknown, known: string[] = [], max = 3): string[] {
  const have = known.map(nk).filter(Boolean);
  const out: string[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const t = (typeof x === 'string' ? x : (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string') ? (x as { text: string }).text : '')
      .replace(/\s+/g, ' ').trim().replace(/^[-*•]\s*/, '');
    if (t.length < 4 || t.length > 160 || SENSITIVE.test(t) || RELATIVE_TIME.test(t)) continue;
    const k = nk(t);
    if (!k || have.some(h => h === k || h.includes(k) || (k.includes(h) && h.length > 12))) continue;
    have.push(k);
    out.push(t.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}

/** meta від моделі → безпечний формат; порожні поля не повертаємо; null — нічого корисного */
export function cleanMeta(r: unknown, o: { reply: string; learning?: string[]; memory?: string[]; plan?: boolean }): Meta | null {
  const j = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const meta: Meta = {};
  const sug: string[] = [];
  for (const x of Array.isArray(j.suggestions) ? j.suggestions : []) {
    const t = (typeof x === 'string' ? x : '').replace(/\s+/g, ' ').trim().replace(/^(?:\d+[.)]|[-*•])\s*/, '').replace(/^["«“]+|["»”]+$/g, '');
    if (!t || t.length > 140 || CYR.test(t) || !/[a-z]/i.test(t)) continue;
    if (sug.some(s => norm(s) === norm(t))) continue;
    sug.push(t);
    if (sug.length >= 3) break;
  }
  if (sug.length >= 2) meta.suggestions = sug;

  const reply = norm(o.reply);
  const learning = new Set((o.learning || []).map(norm));
  const words: Array<{ en: string; uk: string }> = [];
  for (const x of Array.isArray(j.words) ? j.words : []) {
    if (!x || typeof x !== 'object') continue;
    const en = String((x as Record<string, unknown>).en || '').replace(/\s+/g, ' ').trim().replace(/^["«“]+|["»”.!?]+$/g, '');
    const uk = String((x as Record<string, unknown>).uk || '').replace(/\s+/g, ' ').trim();
    if (!en || en.length > 60 || CYR.test(en) || !/[a-z]/i.test(en) || !uk || uk.length > 80 || !CYR.test(uk)) continue;
    const ne = norm(en);
    if (learning.has(ne) || words.some(w => norm(w.en) === ne) || NOT_WORDS.test(en)) continue;
    // слово має бути з відповіді вчителя (допускаємо іншу форму: перші 4 літери кожного значущого слова)
    const stems = ne.split(' ').filter(w => w.length >= 3 && !['the', 'and', 'for', 'sth', 'someone', 'something', 'smb'].includes(w)).map(w => w.slice(0, 4));
    if (!reply.includes(ne) && !(stems.length && stems.every(s => reply.includes(s)))) continue;
    words.push({ en, uk });
    if (words.length >= 3) break;
  }
  if (words.length) meta.words = words;

  const mem = cleanMemory(j.memory, o.memory || []);
  if (mem.length) meta.memory = mem;

  if (o.plan) {
    const plan = (Array.isArray(j.plan) ? j.plan : []).map(x => (typeof x === 'string' ? x : '').replace(/\s+/g, ' ').trim().replace(/^(?:\d+[.)]|[-*•])\s*/, ''))
      .filter(t => t && t.length <= 120 && !/[[\]{}<>]/.test(t)).slice(0, 4);
    if (plan.length >= 2) meta.plan = plan;
  }
  return Object.keys(meta).length ? meta : null;
}

/** Останнє повідомлення учня (без підказок застосунку в дужках) */
export function lastStudentText(messages: Array<{ role?: string; text?: unknown; cue?: unknown }>) {
  const arr = Array.isArray(messages) ? messages : [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i]?.role !== 'user') continue;
    const t = String(arr[i]?.text || '').trim();
    // підказка застосунку (cue: true або весь текст у дужках) — не англійська учня: без виправлень, пам'яті й слів
    if (arr[i]?.cue === true || /^\(.*\)$/s.test(t)) return '';
    return t.slice(0, 6000);
  }
  return '';
}

/** Повідомлення чату для Gemini: роль лишається 'user', а підказка застосунку (cue) явно позначена, якщо вона ще не в дужках */
export function cueText(m: { role?: string; text?: unknown; cue?: unknown }) {
  const t = String(m?.text ?? '');
  if (m?.role !== 'user' || m?.cue !== true || !t.trim() || /^\s*\(/.test(t)) return t;
  return `(App cue, not the student's words — follow it as the tutor; no corrections block:) ${t}`;
}

/** Текст для дії translate: обрізаний, без зайвих пробілів; '' — нічого перекладати */
export function translateInput(v: unknown, max = 4000) {
  return (typeof v === 'string' ? v : '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max).trim();
}

// ---------- Підсумок сесії ----------
const MISTAKE_TYPES = ['articles', 'tenses', 'prepositions', 'word_order', 'vocabulary', 'pronunciation', 'other'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const tx = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\r/g, '').trim().slice(0, max);

/** Підсумок від моделі → безпечний формат (старі поля як були; нові — focus_review, practised_words, memory) */
// deno-lint-ignore no-explicit-any
const CRITERIA = ['range', 'accuracy', 'fluency', 'interaction', 'coherence'];
/** Обґрунтування оцінки рівня: критерії CEFR з прикладами, причини, що показало б наступний рівень */
// deno-lint-ignore no-explicit-any
export function cleanAssessment(a: any) {
  if (!a || typeof a !== 'object') return null;
  const seen = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const criteria = (Array.isArray(a.criteria) ? a.criteria : []).filter((c: any) => c && CRITERIA.includes(c.name) && LEVELS.includes(c.level) && !seen.has(c.name) && seen.add(c.name))
    // deno-lint-ignore no-explicit-any
    .map((c: any) => ({ name: c.name, level: c.level, note_uk: tx(c.note_uk, 300) }));
  return {
    enough_data: a.enough_data !== false,
    sublevel: ['low', 'mid', 'high'].includes(a.sublevel) ? a.sublevel : 'mid',
    confidence: ['low', 'medium', 'high'].includes(a.confidence) ? a.confidence : 'medium',
    criteria,
    reasons_uk: (Array.isArray(a.reasons_uk) ? a.reasons_uk : []).map((r: unknown) => tx(r, 400)).filter(Boolean).slice(0, 4),
    to_next_uk: tx(a.to_next_uk, 300),
  };
}

export function cleanSummary(r: any, st: { words: string[]; memory: string[]; level: string }) {
  const o = r && typeof r === 'object' ? r : {};
  const seen = new Set<string>();
  const mistakes = [];
  for (const m of Array.isArray(o.mistakes) ? o.mistakes : []) {
    if (!m || typeof m !== 'object') continue;
    const wrong = unquote(tx(m.wrong, 200)), right = unquote(tx(m.right, 200));
    const key = norm(wrong) + '|' + norm(right);
    if (!wrong || !right || norm(wrong) === norm(right) || spellingVariant(wrong, right) || seen.has(key)) continue;
    seen.add(key);
    mistakes.push({ wrong, right, type: MISTAKE_TYPES.includes(m.type) ? m.type : 'other', explanation_uk: tx(m.explanation_uk, 300) });
    if (mistakes.length >= 10) break;
  }
  const learning = new Map(st.words.map(w => [w.toLowerCase(), w]));
  const practised = [...new Set((Array.isArray(o.practised_words) ? o.practised_words : [])
    .map((w: unknown) => learning.get(tx(w, 80).toLowerCase())).filter(Boolean))] as string[];
  const new_words = (Array.isArray(o.new_words) ? o.new_words : [])
    // deno-lint-ignore no-explicit-any
    .filter((w: any) => w && typeof w === 'object' && tx(w.en, 80) && tx(w.uk, 120)).slice(0, 8)
    // deno-lint-ignore no-explicit-any
    .map((w: any) => ({ en: tx(w.en, 80), uk: tx(w.uk, 120), example: tx(w.example, 300) }));
  return {
    summary: tx(o.summary, 1500),
    mistakes,
    new_words,
    level_signal: LEVELS.includes(o.level_signal) ? o.level_signal : (LEVELS.includes(st.level) ? st.level : 'B1'),
    level_assessment: cleanAssessment(o.level_assessment),
    next_focus: tx(o.next_focus, 300),
    focus_review: tx(o.focus_review, 500),
    practised_words: practised,
    memory: cleanMemory(o.memory, st.memory, 5),
  };
}

// ---------- SSE для чату ----------
/**
 * Потік відповіді вчителя для клієнта: data: {"t"} — текст (блок ---FIX--- притримується, перевіряється fixBlock і
 * надсилається одним шматком наприкінці), {"end":true} — текст завершено, {"meta":{…}} — необов'язково, {"done":true}.
 * Обрив потоку моделі → {"error":{"code":"overloaded"}}.
 */
/** Продовження обрізаної відповіді без повтору вже надісланого: зрізаємо перекриття з кінцем partial */
export function joinContinuation(partial: string, more: string) {
  if (!more) return '';
  const p = partial.trimEnd();
  if (p && more.trimStart().startsWith(p)) return more.trimStart().slice(p.length);
  // перекриття — щонайменше 5 символів і з початку слова в partial (щоб не зрізати випадковий збіг літер)
  for (let k = Math.min(300, more.length, p.length); k >= 5; k--) {
    if (p.endsWith(more.slice(0, k)) && (k === p.length || /\s/.test(p[p.length - k - 1])) && /^\S/.test(more)) return more.slice(k);
  }
  return more;
}

/**
 * recover(partial): якщо модель обрізала відповідь (MAX_TOKENS) до блоку виправлень або відповіла порожньо —
 * один раз дописуємо продовження (порожньо — повна відповідь). Старі клієнти просто отримують ще шматки {"t"}.
 */
export function replyStream(it: AsyncGenerator<string> & { info?: { finishReason: string } }, fixBlock: (raw: string | null) => string, meta: ((body: string) => Promise<Meta | null>) | null,
  recover: ((partial: string) => Promise<string>) | null = null) {
  const enc = new TextEncoder();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: unknown) => {
        if (closed) return false;
        try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); return true; } catch { closed = true; return false; }
      };
      const close = () => { if (!closed) { closed = true; try { ctrl.close(); } catch { /* */ } } };
      const sp = new FixSplitter();
      let last = '', raw = '';
      try {
        for await (const chunk of it) {
          raw += chunk;
          const out = sp.push(chunk);
          if (out) last = out;
          if (out && !send({ t: out })) return;
          if (closed) return;
        }
      } catch {
        send({ error: { code: 'overloaded' } }); close(); return;
      }
      const truncated = it.info?.finishReason === 'MAX_TOKENS';
      if ((truncated && !sp.inFixBlock) || !raw.trim()) {
        let more = '';
        try { more = recover ? joinContinuation(raw, await recover(raw)) : ''; } catch { /* нижче */ }
        if (!raw.trim() && !more.trim()) { send({ error: { code: 'empty' } }); close(); return; }
        const out = sp.push(more);
        if (out) { last = out; if (!send({ t: out })) return; }
      }
      const ended = sp.end();
      const tail = ended.tail;
      // обрізаний посеред блоку — останній рядок виправлення неповний
      const fixRaw = truncated && ended.fixRaw ? ended.fixRaw.replace(/\n?[^\n]*$/, '') : ended.fixRaw;
      let fix = fixBlock(fixRaw);
      if (fix && /\n$/.test(last + tail)) fix = fix.replace(/^\n/, '');
      if (tail || fix) send({ t: tail + fix });
      send({ end: true });
      if (meta && !closed) {
        const m = await meta(sp.body.trim()).catch(() => null);
        if (m) send({ meta: m });
      }
      send({ done: true });
      close();
    },
    cancel() { closed = true; it.return(undefined).catch(() => {}); },
  });
}
