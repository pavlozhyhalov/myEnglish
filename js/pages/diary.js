// Щоденник: щоденний запис про свій день (голосом або текстом) → виправлення, природніша версія, помилки, корисні слова.
// Записи зберігаються в tutor_chats (mode 'diary'): синхронізація, історія і deleteChat (час і помилки) — як у розмов.
// Текст запису й результат лежать у summary (messages сервер чистить через 30 днів, summary — ні).
import { h, ic, emo, fmtMin } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { md } from '../ui/md.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { speak, recognize, canRecognize, recordAndTranscribe } from '../speech.js';
import { activityTimer, addMistake, deleteChat, dayKey } from '../stats.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { setTitle } from '../ui/shell.js';
import { go } from '../router.js';
import { myLevel, pickOfDay } from '../level.js';

const DRAFT_KEY = 'me:diary:draft';
/** Орієнтовна довжина запису (слів) — так само в _shared/prompts.ts (DIARY_WORDS) */
const WORDS = { A1: [20, 50], A2: [40, 80], B1: [70, 130], B2: [110, 180], C1: [150, 250] };

/** Питання дня: загальні життєві теми, мова — за рівнем. Персоналізує відповідь лише сервер (профіль). */
export const PROMPTS = {
  A1: [
    'What did you do today?', 'What did you eat today?', 'Where are you now? What can you see?', 'Who did you talk to today?',
    'What is the weather like today?', 'What do you usually do in the evening?', 'What is your favourite day of the week? Why?',
    'Describe your room.', 'What did you buy this week?', 'What do you like doing at the weekend?', 'Tell me about a friend.',
    'What time did you get up today? What did you do next?',
  ],
  A2: [
    'What was the best part of your day?', 'What did you do last weekend?', 'Describe your morning routine.', 'What are your plans for tomorrow?',
    'Tell me about a meal you enjoyed recently.', 'What did you do yesterday evening?', 'Describe a place in your town you like.',
    'What was the last film or series you watched? Did you like it?', 'Did anything make you laugh today?', 'What are you going to do this weekend?',
    'Tell me about a person you saw today.', 'What did you learn today?',
  ],
  B1: [
    'What was the most interesting thing that happened to you today?', 'Has anything surprised you this week? What happened?',
    'What is something you are looking forward to, and why?', 'Describe a small problem you had today and how you dealt with it.',
    'If you could change one thing about today, what would it be?', 'What have you been reading, watching or listening to lately?',
    'Tell me about a conversation you had recently.', 'What made you feel good today?', 'What is a habit you would like to start or stop?',
    'Describe your perfect day off.', 'Have you tried anything new recently? How was it?', 'What did you spend most of your time on today?',
  ],
  B2: [
    'What is something you changed your mind about recently, and what made you reconsider?', 'Describe a moment today when you felt really focused or completely distracted.',
    'What would you tell your younger self about a situation you faced this week?', 'What is a piece of news that caught your attention lately, and how do you feel about it?',
    'Which of your everyday habits would you like to get rid of, and what stops you?', 'Describe someone who has influenced the way you think, and how.',
    'If you had an extra hour every day, how would you spend it and why?', 'What has been the biggest challenge of your week so far?',
    'Tell me about a decision you made recently. Are you happy with it?', 'What is something people often get wrong about where you live?',
    'Describe a place that means a lot to you.', 'What did today teach you about yourself?',
  ],
  C1: [
    'Reflect on a recent experience that challenged one of your assumptions.', 'What does a genuinely well-spent day look like to you, and how close was today?',
    'Describe a conversation that stayed with you, and explain why it struck a chord.', 'Which trend in everyday life do you find hard to get used to, and why?',
    'Write about a small, ordinary moment today that you might otherwise forget.', 'How has the way you spend your free time changed over the past few years?',
    'What is a skill you are quietly proud of, and how did you develop it?', 'Weigh up a choice you are facing at the moment: what are the trade-offs?',
    'Describe the mood of your day as if it were the weather.', 'What would you like to be remembered for by the people around you?',
    'Is there anything you have been putting off lately? What lies behind it?', 'What have you noticed about yourself this week?',
  ],
};

const entries = () => store.all('tutor_chats').filter(c => c.mode === 'diary').sort((a, b) => b.created_at.localeCompare(a.created_at));
const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const fmtDate = (iso, opts = { day: 'numeric', month: 'long' }) => new Date(iso).toLocaleDateString('uk-UA', opts);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function diary(view, r) {
  if (r.parts[0]) return entryView(view, r.parts[0]);
  return editor(view);
}

// ---------- Новий запис ----------
function editor(view) {
  const lvl = myLevel();
  const list = PROMPTS[lvl] || PROMPTS.B1;
  const base = list.indexOf(pickOfDay(list, 'diary'));
  let shift = 0;
  const question = () => list[(base + shift) % list.length];
  const [lo, hi] = WORDS[lvl] || WORDS.B1;
  const timer = activityTimer('diary');
  let saved = '';
  try { saved = localStorage.getItem(DRAFT_KEY) || ''; } catch { /* */ }

  const qText = h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 }, lang: 'en' }, question());
  const qBtns = h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } },
    h('button.btn.sm.ghost', { type: 'button', onclick: () => speak(question()) }, ic('speaker-high', { size: 16 }), 'Прослухати'),
    h('button.btn.sm.ghost', { type: 'button', onclick: () => { shift = (shift + 1) % list.length; qText.textContent = question(); } }, ic('arrow-clockwise', { size: 16 }), 'Інше питання'));
  const ta = h('textarea.input', { rows: 9, placeholder: 'Today I…', 'aria-label': 'Ваш запис англійською', value: saved, spellcheck: 'true', lang: 'en', maxlength: 6000 });
  const info = h('span.xs.dim.grow');
  const clock = h('span.xs.dim.num', { 'aria-hidden': 'true' });
  const status = h('div.small.dim', { role: 'status', 'aria-live': 'polite' });
  const upd = () => {
    const n = wordCount(ta.value);
    info.textContent = `${n} ${plural(n, 'слово', 'слова', 'слів')} · для ${lvl} — приблизно ${lo}–${hi}`;
    try { localStorage.setItem(DRAFT_KEY, ta.value); } catch { /* */ }
  };
  ta.addEventListener('input', upd); upd();
  const tick = setInterval(() => { clock.textContent = mmss(timer.seconds()); }, 1000);
  clock.textContent = mmss(0);

  // ---- диктування: Web Speech API фразами, поки не зупините; інакше — запис і транскрипція на сервері ----
  let rec = null;   // { stop(), done }
  const micBtn = h('button.btn.soft', { type: 'button', 'aria-pressed': 'false', onclick: () => (rec ? rec.stop() : dictate()) }, ic('microphone'), 'Надиктувати');
  const setMic = (on) => {
    micBtn.setAttribute('aria-pressed', String(on));
    micBtn.replaceChildren(ic(on ? 'stop-circle' : 'microphone'), on ? 'Зупинити' : 'Надиктувати');
    micBtn.classList.toggle('danger', on); micBtn.classList.toggle('soft', !on);
  };
  const append = (t) => {
    t = (t || '').trim();
    if (!t) return;
    const sep = ta.value && !/\s$/.test(ta.value) ? ' ' : '';
    ta.value += sep + t.charAt(0).toUpperCase() + t.slice(1);
    ta.dispatchEvent(new Event('input'));
  };
  async function dictate() {
    timer.poke();
    const ctrl = new AbortController();
    let active = true;
    let finish;
    rec = { stop() { active = false; ctrl.abort(); }, done: new Promise(r => { finish = r; }) };
    setMic(true);
    try {
      if (canRecognize()) {
        status.textContent = 'Слухаю… Говоріть англійською, паузи не страшні.';
        while (active) {
          const res = await recognize({ signal: ctrl.signal, onInterim: (t) => { status.textContent = t ? `… ${t}` : 'Слухаю…'; } });
          if (res.text) { const t = res.text.trim(); append(/[.?!]$/.test(t) ? t : t + '.'); }
          // кілька порожніх фраз поспіль (тиша) — не крутимося безкінечно
          if (!res.text) { if ((rec.empty = (rec.empty || 0) + 1) >= 3) break; } else rec.empty = 0;
        }
      } else if (user() && typeof MediaRecorder !== 'undefined') {
        status.textContent = 'Запис іде (до 3 хвилин). Торкніться «Зупинити», коли закінчите.';
        const res = await recordAndTranscribe({ maxMs: 180000, signal: ctrl.signal });
        status.textContent = 'Розпізнаю…';
        append(res.text);
      } else {
        toast(user() ? S.err.speechUnsupported : 'Цей браузер не розпізнає мовлення. Запис голосом працює після входу.');
      }
    } catch (e) {
      toast(e?.code === 'mic' || e?.name === 'NotAllowedError' ? S.err.mic : e?.name === 'NotFoundError' ? S.err.micMissing : (aiErrorText(e) || S.err.generic), { kind: 'bad' });
    } finally {
      finish(); rec = null; setMic(false); status.textContent = '';
      ta.focus({ preventScroll: true });
    }
  }

  // ---- перевірка / збереження ----
  let abort = null;
  const checkBtn = h('button.btn.primary.lg.block', { type: 'button', onclick: () => submit(true) }, ic('sparkle', { fill: true }), 'Перевірити у вчителя');
  const saveBtn = h('button.btn.ghost.block', { type: 'button', onclick: () => submit(false) }, 'Зберегти без перевірки');
  async function submit(check) {
    // остання фраза диктування ще розпізнається — дочекатися її, щоб не загубити і не лишити в чернетці вже збережений текст
    if (rec) { const d = rec.done; rec.stop(); await d; if (!view.isConnected) return; }
    const text = ta.value.trim();
    if (wordCount(text) < 3) { toast('Напишіть хоча б кілька речень'); ta.focus(); return; }
    if (check && !user()) { toast(S.err.needLogin); return; }
    let res = null;
    if (check) {
      checkBtn.disabled = saveBtn.disabled = true;
      checkBtn.replaceChildren(ic('hourglass'), 'Вчитель перевіряє…');
      abort = new AbortController();
      try { res = await tutor('diary', { text, question: question() }, { signal: abort.signal }); }
      catch (e) {
        const msg = aiErrorText(e);
        if (msg) toast(msg, { kind: 'bad' });
        if (!view.isConnected) return;
        checkBtn.disabled = saveBtn.disabled = false;
        checkBtn.replaceChildren(ic('sparkle', { fill: true }), 'Перевірити у вчителя');
        return;
      }
    }
    const row = saveEntry({ text, question: question(), res, seconds: Math.round(timer.seconds()) });
    timer.setRef(row.id);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
    go(`/diary/${encodeURIComponent(row.id)}`);
  }

  const today = entries().filter(c => dayKey(new Date(c.created_at)) === dayKey());
  view.replaceChildren(h('div.stack-lg',
    h('section.row', h('div.emoji-circle', emo('notebook')), h('div.grow', h('h1', { style: { margin: 0 } }, S.nav.diary), h('div.small.dim', `2–3 хвилини про ваш день — голосом або текстом · рівень ${lvl}`))),
    today.length ? h('a.card.row', { href: `#/diary/${encodeURIComponent(today[0].id)}`, style: { textDecoration: 'none', color: 'inherit' } },
      emo('check'), h('div.grow', h('div', { style: { fontWeight: 600 } }, 'Сьогоднішній запис уже є'), h('div.xs.dim', 'Відкрити розбір — або напишіть ще один нижче')), ic('caret-right', { size: 18 })) : '',
    h('section.card.accent.stack', h('div.section-title', 'Питання дня'), qText, qBtns),
    h('section.stack', { style: { gap: '8px' } },
      ta,
      h('div.row', info, h('span.xs.dim', 'час'), clock),
      h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, micBtn),
      status),
    checkBtn,
    user() ? saveBtn : h('div.stack', { style: { gap: '8px' } }, h('div.xs.dim.center', 'Перевірка вчителем працює після входу. Запис можна зберегти й перевірити пізніше.'), saveBtn),
    historyBox()));
  return () => { clearInterval(tick); rec?.stop(); abort?.abort(); timer.stop(); };
}

/** Зберегти запис (з результатом перевірки або без) і додати помилки в «Мої помилки» */
function saveEntry({ text, question, res, seconds }) {
  const row = store.put('tutor_chats', {
    mode: 'diary', scenario: null, title: `Щоденник · ${fmtDate(new Date().toISOString())}`,
    messages: [{ role: 'user', text }], seconds: seconds || 0,
    summary: { kind: 'diary', question, entry: text, checked: !!res, ...(res || {}) },
  });
  if (res) applyMistakes(row);
  return row;
}
function applyMistakes(row) {
  for (const m of row.summary?.mistakes || []) addMistake({ ...m, source: 'diary', ref: row.id });
}

// ---------- Історія ----------
function historyBox() {
  const box = h('section.stack', { style: { gap: '8px' } });
  const draw = () => {
    const list = entries();
    if (!list.length) { box.replaceChildren(h('div.section-title', 'Мої записи'), h('div.small.dim', 'Тут з\'являтимуться ваші записи з розбором.')); return; }
    const weekAgo = Date.now() - 7 * 864e5;
    const week = list.filter(c => Date.parse(c.created_at) >= weekAgo).length;
    box.replaceChildren(
      h('div.row', h('div.section-title.grow', `Мої записи · ${list.length}`), h('span.xs.dim', `за 7 днів: ${week}`)),
      h('div.list', list.slice(0, 60).map(c => {
        const s = c.summary || {};
        const text = s.entry || c.messages?.[0]?.text || '';
        const n = (s.mistakes || []).length;
        return h('div.list-row', { style: { paddingRight: '6px' } },
          h('a.row.grow', { href: `#/diary/${encodeURIComponent(c.id)}`, style: { textDecoration: 'none', color: 'inherit', minWidth: 0 } },
            h('div.grow', { style: { minWidth: 0 } },
              h('div', { style: { fontWeight: 600 } }, fmtDate(c.created_at, { weekday: 'short', day: 'numeric', month: 'short' })),
              h('div.sub', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, text.slice(0, 120)),
              h('div.sub', s.checked ? (n ? `${n} ${plural(n, 'виправлення', 'виправлення', 'виправлень')}` : 'без помилок') : 'не перевірено', ` · ${fmtMin(c.seconds || 0)}`))),
          h('button.icon-btn', { type: 'button', 'aria-label': `Видалити запис за ${fmtDate(c.created_at)}`, onclick: async () => { if (await removeEntry(c.id)) draw(); } }, ic('trash', { size: 20 })));
      })));
  };
  draw();
  return box;
}
async function removeEntry(id) {
  const ok = await confirmSheet('Видалити запис?', 'Разом із записом зі статистики приберуться його час і помилки з розбору. Слова, які ви додали в картки, залишаться.', 'Видалити', { danger: true });
  if (!ok) return false;
  deleteChat(id);
  toast('Запис видалено');
  return true;
}

// ---------- Розбір запису ----------
function entryView(view, id) {
  const row = store.get('tutor_chats', id);
  if (!row || row.mode !== 'diary') {
    view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Запис не знайдено'), h('a.btn.soft', { href: '#/diary' }, 'До щоденника')));
    return;
  }
  setTitle(row.title || S.nav.diary);
  const timer = activityTimer('diary');
  timer.setRef(row.id);
  let abort = null;
  const draw = () => {
    const s = row.summary || {};
    const text = s.entry || row.messages?.[0]?.text || '';
    const blocks = [
      h('div.row', h('a.icon-btn', { href: '#/diary', 'aria-label': 'Назад' }, ic('arrow-left')),
        h('div.grow', h('div.xs.dim', fmtDate(row.created_at, { weekday: 'long', day: 'numeric', month: 'long' })), h('h1', { style: { margin: 0 } }, S.nav.diary)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Видалити запис', onclick: async () => { if (await removeEntry(row.id)) go('/diary', { replace: true }); } }, ic('trash'))),
      s.question ? h('section.card.accent.stack', { style: { gap: '4px' } }, h('div.xs.dim', 'Питання дня'), h('div', { lang: 'en', style: { fontWeight: 600 } }, s.question)) : '',
    ];
    if (!s.checked) {
      const btn = h('button.btn.primary.block', { type: 'button', onclick: check }, ic('sparkle', { fill: true }), 'Перевірити у вчителя');
      async function check() {
        if (!user()) { toast(S.err.needLogin); return; }
        btn.disabled = true; btn.replaceChildren(ic('hourglass'), 'Вчитель перевіряє…');
        abort = new AbortController();
        try {
          const res = await tutor('diary', { text, question: s.question || '' }, { signal: abort.signal });
          row.summary = { ...s, ...res, checked: true };
          store.put('tutor_chats', row);
          applyMistakes(row);
          if (view.isConnected) draw();
        } catch (e) {
          const msg = aiErrorText(e); if (msg) toast(msg, { kind: 'bad' });
          btn.disabled = false; btn.replaceChildren(ic('sparkle', { fill: true }), 'Перевірити у вчителя');
        }
      }
      blocks.push(h('section.card.stack', h('div.section-title', 'Ваш запис'), h('div', { lang: 'en', style: { whiteSpace: 'pre-wrap' } }, text)), btn);
      view.replaceChildren(h('div.stack-lg', blocks));
      return;
    }
    if (s.feedback_uk) blocks.push(h('section.card.stack', h('div.row', emo('teacher'), h('div.section-title.grow', 'Відгук вчителя')), md(s.feedback_uk)));
    blocks.push(correctionCard(text, s.corrected || text, (s.mistakes || []).length));
    if (s.natural) blocks.push(h('section.card.stack',
      h('div.row', h('div.section-title.grow', 'Як написав би носій мови'), h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(s.natural) }, ic('speaker-high', { size: 20 }))),
      h('div', { lang: 'en', style: { whiteSpace: 'pre-wrap' } }, s.natural)));
    if ((s.mistakes || []).length) blocks.push(h('section.stack', { style: { gap: '8px' } },
      h('div.row', h('div.section-title.grow', `Помилки · ${s.mistakes.length}`), h('a.btn.sm.ghost', { href: '#/mistakes' }, 'Мої помилки')),
      h('div.list', s.mistakes.map(m => h('div.list-row', { style: { alignItems: 'flex-start' } },
        h('div.grow.stack', { style: { gap: '2px' } },
          h('div', { lang: 'en' }, h('s.bad', m.wrong), ' → ', h('b.good', m.right)),
          m.explanation_uk ? h('div.xs.dim', m.explanation_uk) : null,
          h('div.xs.dim', S.mistakeTypes[m.type] || m.type))))),
      h('div.xs.dim', 'Помилки додано в «Мої помилки» — їх можна потренувати там.')));
    if ((s.words || []).length) blocks.push(wordsCard(s.words));
    blocks.push(h('a.btn.soft.block', { href: '#/diary' }, ic('notebook'), 'До щоденника'));
    view.replaceChildren(h('div.stack-lg', blocks));
  };
  draw();
  return () => { abort?.abort(); timer.stop(); };
}

/** Виправлення у вигляді різниці по словах: закреслене — ваше, виділене — виправлене */
function correctionCard(orig, fixed, n) {
  const box = h('div', { lang: 'en', style: { lineHeight: 1.7, overflowWrap: 'anywhere' } });
  let mode = 'diff';
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Показ тексту' });
  const drawSeg = () => seg.replaceChildren(...[['diff', 'Виправлення'], ['orig', 'Ваш текст'], ['fixed', 'Чистовик']].map(([v, t]) =>
    h('button', { type: 'button', 'aria-pressed': String(mode === v), onclick: () => { mode = v; drawSeg(); drawBox(); } }, t)));
  const drawBox = () => {
    if (mode === 'orig') return box.replaceChildren(h('span', { style: { whiteSpace: 'pre-wrap' } }, orig));
    if (mode === 'fixed') return box.replaceChildren(h('span', { style: { whiteSpace: 'pre-wrap' } }, fixed));
    box.replaceChildren(...diffNodes(orig, fixed));
  };
  drawSeg(); drawBox();
  return h('section.card.stack',
    h('div.row', h('div.section-title.grow', n ? 'Виправлений текст' : 'Ваш текст'), n ? null : h('span.tag.good', 'без помилок')),
    seg, box,
    h('div.xs.dim', 'Закреслено — як було, виділено — як правильно.'));
}

/** Різниця по словах (LCS). Повертає [{t, op: '=', '-', '+'}]. Для дуже довгих текстів — лише заміна цілком. */
export function wordDiff(a, b) {
  const A = String(a || '').split(/\s+/).filter(Boolean), B = String(b || '').split(/\s+/).filter(Boolean);
  if (A.length * B.length > 2000000) return [...A.map(t => ({ t, op: '-' })), ...B.map(t => ({ t, op: '+' }))];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: A[i], op: '=' }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: A[i++], op: '-' });
    else out.push({ t: B[j++], op: '+' });
  }
  while (i < n) out.push({ t: A[i++], op: '-' });
  while (j < m) out.push({ t: B[j++], op: '+' });
  // спершу всі видалення, потім вставки в межах одного блоку змін — так читається як «було → стало»
  const res = [];
  for (let k = 0; k < out.length;) {
    if (out[k].op === '=') { res.push(out[k++]); continue; }
    const del = [], ins = [];
    while (k < out.length && out[k].op !== '=') (out[k].op === '-' ? del : ins).push(out[k++]);
    if (del.length) res.push({ t: del.map(x => x.t).join(' '), op: '-' });
    if (ins.length) res.push({ t: ins.map(x => x.t).join(' '), op: '+' });
  }
  return res;
}
function diffNodes(a, b) {
  const nodes = [];
  for (const d of wordDiff(a, b)) {
    if (nodes.length) nodes.push(' ');
    if (d.op === '=') nodes.push(d.t);
    else if (d.op === '-') nodes.push(h('del', { style: { color: 'var(--bad)', background: 'var(--bad-soft)', borderRadius: '4px', padding: '0 3px' }, 'aria-label': `було: ${d.t}` }, d.t));
    else nodes.push(h('ins', { style: { color: 'var(--good)', background: 'var(--good-soft)', borderRadius: '4px', padding: '0 3px', textDecoration: 'none', fontWeight: 600 }, 'aria-label': `стало: ${d.t}` }, d.t));
  }
  return nodes;
}

/** Корисні слова → «Мої слова» (srs.addCard, як у розборі розмови) */
function wordsCard(words) {
  const has = (en) => store.all('cards').some(c => c.en.trim().toLowerCase() === en.trim().toLowerCase());
  const box = h('section.stack', { style: { gap: '8px' } });
  const draw = () => {
    const left = words.filter(w => !has(w.en));
    box.replaceChildren(
      h('div.row', h('div.section-title.grow', 'Корисні слова'),
        left.length > 1 ? h('button.btn.sm.soft', { type: 'button', onclick: () => { let n = 0; for (const w of left) if (srs.addCard({ en: w.en, uk: w.uk, tags: ['diary'] }).created) n++; toast(`Додано в картки: ${n}`); draw(); } }, ic('plus', { size: 16 }), 'Додати всі') : null),
      h('div.list', words.map(w => h('div.list-row',
        h('button.icon-btn', { type: 'button', 'aria-label': `Прослухати: ${w.en}`, onclick: () => speak(w.en) }, ic('speaker-high', { size: 18 })),
        h('div.grow', h('div', { lang: 'en', style: { fontWeight: 600 } }, w.en), h('div.sub', w.uk)),
        has(w.en) ? h('span.tag.good', 'у картках')
          : h('button.btn.sm.soft', { type: 'button', 'aria-label': `Додати в картки: ${w.en}`, onclick: () => { srs.addCard({ en: w.en, uk: w.uk, tags: ['diary'] }); toast('Додано в «Мої слова»'); draw(); } }, ic('plus', { size: 16 }), 'Додати в картки')))));
  };
  draw();
  return box;
}
