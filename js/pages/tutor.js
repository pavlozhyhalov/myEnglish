// AI-вчитель: режими, текстовий чат зі стрімінгом, підсумок сесії, історія
import { h, ic, emo, fmtMin } from '../ui/dom.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { md } from '../ui/md.js';
import { tutor, tutorStream, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { speak, recognize, canRecognize } from '../speech.js';
import { activityTimer, addMistake, deleteChat } from '../stats.js';
import { confirmSheet } from '../ui/sheet.js';
import { scenarios as loadScenarios } from '../data.js';
import { runExercises } from '../ui/exercises.js';
import { toast } from '../ui/toast.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { go } from '../router.js';

export const MODES = [
  { id: 'chat', emoji: 'speech', title: 'Вільна розмова', desc: 'Текстом, на будь-яку тему' },
  { id: 'voice', emoji: 'mic', title: 'Голосова розмова', desc: 'У реальному часі' },
  { id: 'scenario', emoji: 'theater', title: 'Сценарій', desc: 'Рольова гра', href: '#/scenarios' },
  { id: 'check', emoji: 'writing', title: 'Перевір мій текст', desc: 'Лист → виправлення' },
  { id: 'explain', emoji: 'bulb', title: 'Поясни', desc: 'Правило + 5 вправ' },
  { id: 'drill', emoji: 'target', title: 'Слабке місце', desc: 'Міні-урок на помилку' },
];

export default async function tutorPage(view, r) {
  const q = r.query;
  if (q.mode === 'voice') {
    const { voiceSession } = await import('../live/voice.js');
    return voiceSession(view, { scenario: q.scenario, topic: q.topic });
  }
  if (q.chat) return openChat(view, q.chat);
  if (q.mode === 'check') return checkMode(view, q);
  if (q.mode || q.ask || q.scenario) return chat(view, { mode: q.mode || (q.scenario ? 'scenario' : 'chat'), scenario: q.scenario, type: q.type, ask: q.ask, topic: q.topic });
  return overview(view);
}

function needLoginCard() {
  if (user()) return null;
  return h('section.card.accent.stack',
    h('div.row', emo('key'), h('div.grow', h('div', { style: { fontWeight: 600 } }, 'Вчитель працює після входу'), h('div.xs.dim', 'Gemini викликається через захищений бекенд, тому потрібен акаунт.'))),
    h('a.btn.primary', { href: '#/auth' }, 'Увійти'));
}

function overview(view) {
  const st = store.settings();
  const chats = store.all('tutor_chats').sort((a, b) => b.created_at.localeCompare(a.created_at));
  view.replaceChildren(h('div.stack-lg',
    h('section.row', h('div.emoji-circle', emo('teacher')), h('div.grow', h('h1', st.tutorName), h('div.small.dim', 'Ваш AI-вчитель англійської'))),
    needLoginCard(),
    h('div.grid2', MODES.map(m => h('a.tile', { href: m.href || `#/tutor?mode=${m.id}` },
      h('div.emoji-circle', emo(m.emoji)), h('div', h('div.name', m.title), h('div.status', m.desc))))),
    history(view, chats)));
}

/** Історія розмов: відкрити, видалити одну або кілька (разом із часом і помилками в статистиці) */
function history(view, chats) {
  const box = h('section.stack', { style: { gap: '8px' } });
  let selecting = false;
  const picked = new Set();
  const draw = () => {
    const list = store.all('tutor_chats').sort((a, b) => b.created_at.localeCompare(a.created_at));
    const head = h('div.row', h('div.section-title.grow', `Історія${list.length ? ` · ${list.length}` : ''}`),
      list.length ? h('button.btn.sm.ghost', { type: 'button', onclick: () => { selecting = !selecting; picked.clear(); draw(); } }, selecting ? 'Скасувати' : 'Вибрати') : null);
    if (!list.length) { box.replaceChildren(head, h('div.empty', emo('speech', 'xl'), h('p', 'Поки що розмов немає. Почніть з вільної розмови або голосу.'))); return; }
    const rows = list.slice(0, 60).map(c => {
      const info = [h('div', { style: { fontWeight: 600 } }, c.title || 'Розмова'),
        h('div.sub', `${new Date(c.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} · ${fmtMin(c.seconds || 0)}${c.summary ? '' : ' · без підсумку'}`)];
      const icon = emo(c.mode === 'voice' ? 'mic' : c.mode === 'check' ? 'writing' : c.mode === 'scenario' ? 'theater' : 'speech');
      if (selecting) {
        const cb = h('input.check', { type: 'checkbox', checked: picked.has(c.id), 'aria-label': `Вибрати: ${c.title || 'Розмова'}`, onchange: (e) => { e.target.checked ? picked.add(c.id) : picked.delete(c.id); draw(); } });
        return h('label.list-row', cb, icon, h('div.grow', info));
      }
      return h('div.list-row', { style: { paddingRight: '6px' } },
        h('a.row.grow', { href: `#/tutor?chat=${encodeURIComponent(c.id)}`, style: { textDecoration: 'none', color: 'inherit', minWidth: 0 } }, icon, h('div.grow', info)),
        h('button.icon-btn', { type: 'button', 'aria-label': `Видалити: ${c.title || 'Розмова'}`, onclick: () => remove([c.id]) }, ic('trash', { size: 20 })));
    });
    box.replaceChildren(head, h('div.list', rows),
      selecting ? h('div.row',
        h('button.btn.soft.grow', { type: 'button', onclick: () => { list.forEach(c => picked.add(c.id)); draw(); } }, 'Вибрати всі'),
        h('button.btn.danger.grow', { type: 'button', disabled: !picked.size, onclick: () => remove([...picked]) }, ic('trash', { size: 18 }), `Видалити (${picked.size})`)) : null);
  };
  async function remove(ids) {
    const n = ids.length;
    const ok = await confirmSheet(n > 1 ? `Видалити ${n} розмов?` : 'Видалити розмову?',
      'Разом із розмовою зі статистики приберуться її час і помилки з її підсумку. Слова, які ви додали в картки, залишаться.', 'Видалити', { danger: true });
    if (!ok) return;
    ids.forEach(deleteChat);
    selecting = false; picked.clear();
    toast(n > 1 ? `Видалено розмов: ${n}` : 'Розмову видалено');
    draw();
  }
  draw();
  return box;
}

// ---------- Розбір відповіді: текст + блок виправлень ----------
const FIX = '---FIX---';
export function parseReply(text) {
  const i = text.indexOf(FIX);
  if (i < 0) {
    // під час стрімінгу ховаємо початок маркера
    const tail = text.match(/\n?-{1,3}F?I?X?-{0,3}$/);
    return { body: tail ? text.slice(0, tail.index) : text, fixes: [] };
  }
  const body = text.slice(0, i).trim();
  const fixes = text.slice(i + FIX.length).split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean)
    .map(l => {
      const m = l.match(/^(.*?)\s*(?:→|->)\s*(.*?)(?:\s+[—–-]\s+(.*))?$/);
      return m ? { wrong: m[1].replace(/^["«]|["»]$/g, ''), right: m[2].replace(/^["«]|["»]$/g, ''), why: m[3] || '' } : { wrong: '', right: l, why: '' };
    }).filter(f => f.right && !/^none$/i.test(f.right));
  return { body, fixes };
}

function msgView(m, { onSpeak = true } = {}) {
  if (m.role === 'user') return h('div.msg.me', m.text);
  const { body, fixes } = m.fixes ? { body: m.text, fixes: m.fixes } : parseReply(m.text);
  const el = h('div.msg.ai', md(body));
  if (fixes.length) el.append(h('details.fix', h('summary', ic('pencil-simple', { size: 16 }), `Виправлення (${fixes.length})`),
    h('ul', fixes.map(f => h('li', f.wrong ? [h('s.bad', f.wrong), ' → ', h('b.good', f.right)] : h('b', f.right), f.why ? h('div.xs.dim', f.why) : null)))));
  if (onSpeak) el.append(h('div.tools', h('button.icon-btn', { type: 'button', 'aria-label': 'Озвучити', onclick: () => speak(stripForSpeech(body)) }, ic('speaker-high', { size: 18 }))));
  return el;
}
function stripForSpeech(t) { return t.replace(/[*_`#>]/g, '').replace(/\[[^\]]*\]/g, ''); }

// ---------- Текстовий чат ----------
async function chat(view, opts) {
  const st = store.settings();
  let scenario = null;
  if (opts.scenario) scenario = (await loadScenarios()).find(s => s.id === opts.scenario);
  const typeLabel = opts.type ? (S.mistakeTypes[opts.type] || opts.type) : null;
  const title = scenario ? scenario.title : opts.mode === 'drill' ? `Тренування: ${typeLabel || 'слабке місце'}` : opts.mode === 'explain' ? 'Поясни' : opts.ask ? `Слово: ${opts.ask}` : 'Вільна розмова';
  const row = { mode: opts.mode, scenario: opts.scenario || null, title, messages: [], summary: null, seconds: 0, meta: { type: opts.type || null } };
  return chatUI(view, row, { scenario, ask: opts.ask, topic: opts.topic });
}

async function openChat(view, id) {
  const row = store.get('tutor_chats', id);
  if (!row) { view.replaceChildren(h('div.empty', h('p', 'Розмову не знайдено'), h('a.btn.soft', { href: '#/tutor' }, 'До вчителя'))); return; }
  if (row.mode === 'check') return checkResultView(view, row);
  if (!row.messages?.length) return summaryView(view, row);
  let scenario = null;
  if (row.scenario) scenario = (await loadScenarios()).find(s => s.id === row.scenario);
  return chatUI(view, row, { scenario, resumed: true });
}

function chatUI(view, row, { scenario, ask, topic, resumed } = {}) {
  setTitle(row.title);
  const st = store.settings();
  const timer = activityTimer('tutor');
  const list = h('div.chat', { 'aria-live': 'polite' });
  const ta = h('textarea', { rows: 1, placeholder: 'Напишіть англійською…', 'aria-label': 'Повідомлення', enterkeyhint: 'send' });
  const sendBtn = h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Надіслати', onclick: () => send() }, ic('paper-plane-right', { fill: true }));
  const micBtn = canRecognize() ? h('button.icon-btn', { type: 'button', 'aria-label': 'Надиктувати', onclick: dictate }, ic('microphone')) : null;
  const finishBtn = h('button.btn.sm.soft', { type: 'button', onclick: finish }, 'Завершити');
  const extra = h('div');
  let busy = false, abort = null;

  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); } });

  const intro = scenario ? h('section.card.soft.stack',
    h('div.row', emo(scenario.emoji || 'theater'), h('div.grow', h('b', scenario.title), h('div.xs.dim', `Ваша роль: ${scenario.myRole}`))),
    h('div.small', scenario.situation), h('div.small', h('b', 'Мета: '), scenario.goal)) : null;

  view.replaceChildren(h('div.stack',
    h('div.row.tutor-head', h('a.icon-btn', { href: '#/tutor', 'aria-label': 'Назад' }, ic('arrow-left')),
      h('span.avatar', { 'aria-hidden': 'true' }, (st.tutorName || 'A').charAt(0).toUpperCase()),
      h('div.grow', h('div.name', st.tutorName), h('div.xs.dim', MODES.find(m => m.id === row.mode)?.title || 'Розмова')), finishBtn),
    needLoginCard(), intro, list, extra,
    h('div.composer', micBtn, ta, sendBtn)));

  for (const m of row.messages) list.append(msgView(m));

  function persist() {
    row.seconds = (row.seconds || 0);
    // у історію потрапляє лише розмова, де учень щось сказав (не лише привітання вчителя)
    if (row.messages.some(m => m.role === 'user')) store.put('tutor_chats', row);
  }

  async function send(textOverride, { hidden = false } = {}) {
    const text = (textOverride ?? ta.value).trim();
    if (busy || (!text && !hidden)) return;
    if (!user()) { toast(S.err.needLogin); return; }
    busy = true; sendBtn.disabled = true; timer.poke();
    if (text && !hidden) { row.messages.push({ role: 'user', text }); list.append(msgView({ role: 'user', text })); ta.value = ''; ta.style.height = 'auto'; }
    const bubble = h('div.msg.ai', h('span.typing', h('i'), h('i'), h('i')));
    list.append(bubble); bubble.scrollIntoView({ block: 'end', behavior: 'smooth' });
    abort = new AbortController();
    try {
      const payload = { mode: row.mode, scenario: row.scenario, scenarioData: scenario || null, drillType: row.meta?.type, topic, messages: row.messages.map(m => ({ role: m.role, text: m.text })) };
      if (hidden && text) payload.messages.push({ role: 'user', text });
      let lastPaint = 0;
      const full = await tutorStream(payload, (acc) => {
        const now = performance.now();
        if (now - lastPaint < 60) return; lastPaint = now;
        bubble.replaceChildren(md(parseReply(acc).body));
      }, { signal: abort.signal });
      const msg = { role: 'model', text: full };
      const parsed = parseReply(full);
      msg.text = parsed.body; msg.fixes = parsed.fixes;
      row.messages.push(msg);
      bubble.replaceWith(msgView(msg));
      persist();
      list.lastChild.scrollIntoView({ block: 'end', behavior: 'smooth' });
      afterReply();
    } catch (e) {
      bubble.replaceWith(h('div.msg.sys', aiErrorText(e) || 'Скасовано'));
    } finally { busy = false; sendBtn.disabled = false; abort = null; }
  }

  function afterReply() {
    // кнопка вправ у режимах «Поясни» і «Слабке місце»
    if ((row.mode === 'explain' || row.mode === 'drill') && !extra.firstChild && row.messages.filter(m => m.role === 'model').length >= 1) {
      extra.append(h('button.btn.soft.block', { type: 'button', onclick: practice }, ic('lightning', { fill: true }), row.mode === 'drill' ? '10 вправ на цю тему' : '5 вправ на це правило'));
    }
  }

  async function practice() {
    const n = row.mode === 'drill' ? 10 : 5;
    extra.replaceChildren(h('div.card.center.dim', 'Вчитель готує вправи…'));
    try {
      const topicText = row.mode === 'drill' ? (S.mistakeTypes[row.meta?.type] || row.meta?.type) : row.messages.find(m => m.role === 'user')?.text;
      const examples = row.mode === 'drill' ? store.all('mistakes').filter(m => m.type === row.meta?.type && !m.resolved).slice(0, 8).map(m => ({ wrong: m.wrong, right: m.right })) : [];
      const res = await tutor('exercises', { topic: topicText, count: n, examples });
      const box = h('div.card');
      extra.replaceChildren(box);
      runExercises(box, res.exercises || [], {
        onMistake: (ex, given) => addMistake({ wrong: given, right: ex.answerText || String(Array.isArray(ex.answer) ? ex.answer[0] : (typeof ex.answer === 'number' ? ex.options[ex.answer] : ex.answer)), type: row.meta?.type || ex.mistakeType || 'other', explanation_uk: ex.explanation, source: 'exercise' }),
        onDone: (r) => {
          timer.poke();
          // правильні застосування для групи помилок
          if (row.mode === 'drill' && r.score >= 80) for (const m of store.all('mistakes').filter(m => m.type === row.meta?.type && !m.resolved)) { m.streak = (m.streak || 0) + 1; m.resolved = m.streak >= 3; store.put('mistakes', m); }
        },
      });
    } catch (e) { extra.replaceChildren(h('div.feedback.no', aiErrorText(e))); }
  }

  async function dictate() {
    micBtn.classList.add('active');
    try {
      const res = await recognize({ onInterim: t => { ta.placeholder = t || 'Слухаю…'; } });
      if (res.text) { ta.value = (ta.value ? ta.value + ' ' : '') + res.text; ta.dispatchEvent(new Event('input')); }
    } catch (e) { toast(e.code === 'mic' ? S.err.mic : S.err.speechUnsupported); }
    finally { micBtn.classList.remove('active'); ta.placeholder = 'Напишіть англійською…'; }
  }

  async function finish() {
    const userTurns = row.messages.filter(m => m.role === 'user').length;
    cleanup();
    if (userTurns < 1) { go('/tutor', { replace: true }); return; }
    await summarize(view, row);
  }

  let cleaned = false;
  function cleanup() {
    if (cleaned) return; cleaned = true;
    abort?.abort();
    if (row.id) timer.setRef(row.id);
    const s = timer.stop();
    row.seconds = (row.seconds || 0) + (s?.seconds || 0);
    persist();
  }

  // Старт: вчитель відкриває розмову сам
  if (!resumed && user()) {
    if (ask) send(`Please explain the word or phrase "${ask}": meaning, how and when to use it in everyday situations, 3 natural examples, common collocations and mistakes Ukrainian speakers make with it.`);
    else if (row.mode === 'explain') list.append(msgView({ role: 'model', text: 'Що пояснити? Наприклад: **Чим Present Perfect відрізняється від Past Simple?** Напишіть питання українською або англійською.' }, { onSpeak: false }));
    else send('', { hidden: true });
  }
  return cleanup;
}

// ---------- Підсумок сесії ----------
export async function summarize(view, row, { voice = false } = {}) {
  setFocus(false);
  view.replaceChildren(h('div.hero', emo('hourglass', 'xl'), h('h2', 'Вчитель готує підсумок…'), h('p.dim.small', 'Помилки, нові слова, рекомендація')));
  try {
    const res = await tutor('summary', { mode: row.mode, messages: (row.messages || []).map(m => ({ role: m.role, text: m.text })) });
    // повторний підсумок продовженої розмови не дублює вже зараховані помилки
    const key = (m) => `${m.wrong}|${m.right}`.toLowerCase().trim();
    const before = new Set((row.summary?.mistakes || []).map(key));
    row.summary = res;
    store.put('tutor_chats', row);
    for (const m of res.mistakes || []) if (!before.has(key(m))) addMistake({ ...m, source: 'tutor', ref: row.id });
    store.setProf({ lastFocus: res.next_focus || null });
  } catch (e) {
    view.replaceChildren(h('div.hero', emo('warning', 'xl'), h('p', aiErrorText(e)),
      h('div.row', h('a.btn.soft', { href: '#/tutor' }, 'До вчителя'), h('button.btn.primary', { type: 'button', onclick: () => summarize(view, row, { voice }) }, 'Спробувати ще'))));
    return;
  }
  return summaryView(view, row);
}

export function summaryView(view, row) {
  const s = row.summary;
  if (!s) {
    view.replaceChildren(h('div.hero', h('p', 'Підсумку ще немає.'), h('button.btn.primary', { type: 'button', onclick: () => summarize(view, row) }, 'Зробити підсумок')));
    return;
  }
  const words = s.new_words || [];
  const checks = words.map(w => h('input.check', { type: 'checkbox', checked: !store.all('cards').some(c => c.en.toLowerCase() === w.en.toLowerCase()), 'aria-label': `Додати ${w.en}` }));
  const addBtn = h('button.btn.primary.block', { type: 'button', onclick: () => {
    let n = 0;
    words.forEach((w, i) => { if (checks[i].checked) { const r = srs.addCard({ en: w.en, uk: w.uk, examples: w.example ? [{ en: w.example, uk: '' }] : [], tags: ['tutor'] }); if (r.created) n++; checks[i].checked = false; checks[i].disabled = true; } });
    toast(n ? `Додано в картки: ${n}` : 'Ці слова вже є в картках');
  } }, ic('plus'), 'Додати в картки');

  view.replaceChildren(h('div.stack-lg',
    h('div.hero', emo('sparkles', 'xl'), h('h1', 'Підсумок розмови'), h('p.dim', `${row.title || ''} · ${fmtMin(row.seconds || 0)}`), s.level_signal ? h('span.tag.accent', `Рівень у розмові: ${s.level_signal}`) : null),
    h('section.card', md(s.summary || '')),
    (s.mistakes || []).length ? h('section.card.stack', h('div.section-title', `Помилки (${s.mistakes.length})`),
      s.mistakes.map(m => {
        const exp = h('div.xs.dim', { hidden: true }, m.explanation_uk || '');
        return h('div.stack', { style: { gap: '4px' } },
          h('div.row', h('div.grow', h('s.bad', m.wrong), ' → ', h('b.good', m.right)),
            h('button.btn.sm.ghost', { type: 'button', onclick: (e) => { exp.hidden = !exp.hidden; e.currentTarget.textContent = exp.hidden ? 'Розібрати' : 'Сховати'; } }, 'Розібрати')),
          h('span.tag', S.mistakeTypes[m.type] || m.type), exp);
      })) : h('section.card.row', emo('check'), h('div', 'Помилок не помічено. Так тримати!')),
    words.length ? h('section.card.stack', h('div.section-title', `Нові слова (${words.length})`),
      words.map((w, i) => h('label.row', { style: { alignItems: 'flex-start' } }, checks[i],
        h('div.grow', h('div', h('b', w.en), ' — ', w.uk), w.example ? h('div.xs.dim', w.example) : null)))
      , addBtn) : null,
    s.next_focus ? h('section.card.accent.stack', h('div.section-title', 'Наступного разу'), h('div', s.next_focus)) : null,
    h('div.row', h('a.btn.soft.grow', { href: '#/' }, 'На головну'), h('a.btn.primary.grow', { href: '#/tutor' }, 'Нова розмова')),
    deleteButton(row)));
}

/** «Видалити розмову» — на екранах підсумку й перевірки тексту */
function deleteButton(row) {
  return h('button.btn.ghost.block', { type: 'button', style: { color: 'var(--bad)' }, onclick: async () => {
    if (!row.id) { go('/tutor', { replace: true }); return; }
    if (!await confirmSheet('Видалити розмову?', 'Разом із нею зі статистики приберуться її час і помилки з підсумку.', 'Видалити', { danger: true })) return;
    deleteChat(row.id);
    toast('Розмову видалено');
    go('/tutor', { replace: true });
  } }, ic('trash', { size: 18 }), 'Видалити розмову');
}

// ---------- Перевір мій текст ----------
const KINDS = [
  ['email', 'Лист'], ['teams', 'Повідомлення в Teams'], ['report', 'Звіт'], ['other', 'Інше'],
];
function checkMode(view, q) {
  let draft = '';
  try { draft = sessionStorage.getItem('me:draft') || ''; sessionStorage.removeItem('me:draft'); } catch { /* приватний режим */ }
  let kind = q.kind || 'email';
  const ta = h('textarea.input', { rows: 10, placeholder: 'Вставте лист або текст англійською…', 'aria-label': 'Текст', value: draft });
  const btn = h('button.btn.primary.block.lg', { type: 'button', onclick: run }, ic('sparkle', { fill: true }), 'Перевірити');
  const chips = h('div.chips', KINDS.map(([v, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(v === kind), onclick: (e) => { kind = v; chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, t)));
  view.replaceChildren(h('div.stack',
    h('div.row', h('a.icon-btn', { href: '#/tutor', 'aria-label': 'Назад' }, ic('arrow-left')), h('h1.grow', { style: { margin: 0 } }, 'Перевір мій текст')),
    needLoginCard(), chips, ta, btn,
    q.task ? h('p.xs.dim', `Завдання: ${q.task}`) : null));
  const timer = activityTimer('writing');
  async function run() {
    const text = ta.value.trim();
    if (text.length < 10) { toast('Додайте текст хоча б з одного речення'); return; }
    btn.disabled = true; btn.textContent = 'Вчитель читає…';
    try {
      const res = await tutor('check_text', { text, kind, task: q.task || null });
      const row = store.put('tutor_chats', { mode: 'check', title: `Перевірка: ${text.slice(0, 40)}…`, messages: [{ role: 'user', text }], summary: res, seconds: Math.round(timer.seconds()) });
      for (const c of res.corrections || []) addMistake({ wrong: c.wrong, right: c.right, type: c.type, explanation_uk: c.explanation_uk, source: 'tutor', ref: row.id });
      timer.poke();
      timer.setRef(row.id);
      timer.stop();
      checkResultView(view, row);
    } catch (e) { toast(aiErrorText(e), { kind: 'bad' }); btn.disabled = false; btn.textContent = 'Перевірити'; }
  }
  return () => timer.stop();
}

function checkResultView(view, row) {
  const r = row.summary || {};
  const sc = r.scores || {};
  const label = { grammar: 'Граматика', vocabulary: 'Лексика', tone: 'Тон', structure: 'Структура' };
  view.replaceChildren(h('div.stack-lg',
    h('div.row', h('a.icon-btn', { href: '#/tutor', 'aria-label': 'Назад' }, ic('arrow-left')), h('h1.grow', { style: { margin: 0 } }, 'Результат перевірки')),
    h('section.card.grid2', Object.keys(label).map(k => h('div.stat', h('b', `${sc[k] ?? '—'}/10`), h('span', label[k])))),
    r.comment_uk ? h('section.card', md(r.comment_uk)) : null,
    (r.corrections || []).length ? h('section.card.stack', h('div.section-title', 'Виправлення'),
      r.corrections.map(c => h('div.stack', { style: { gap: '2px' } }, h('div', h('s.bad', c.wrong), ' → ', h('b.good', c.right)), c.explanation_uk ? h('div.xs.dim', c.explanation_uk) : null))) : null,
    r.improved ? h('section.card.stack', h('div.row', h('div.section-title.grow', 'Покращена версія'),
      h('button.btn.sm.soft', { type: 'button', onclick: () => { navigator.clipboard?.writeText(r.improved); toast('Скопійовано'); } }, ic('copy', { size: 16 }), 'Копіювати')),
    h('div', { style: { whiteSpace: 'pre-wrap' } }, r.improved)) : null,
    row.messages?.[0] ? h('details.card', h('summary.small.dim', 'Оригінал'), h('div.small', { style: { whiteSpace: 'pre-wrap', marginTop: '8px' } }, row.messages[0].text)) : null,
    h('a.btn.primary.block', { href: '#/tutor?mode=check', onclick: (e) => { e.preventDefault(); go('/tutor?mode=check'); } }, 'Перевірити інший текст'),
    deleteButton(row)));
}

