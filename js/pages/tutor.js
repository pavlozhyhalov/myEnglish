// AI-вчитель: режими, текстовий чат зі стрімінгом, підсумок сесії, історія
import { h, ic, emo, fmtMin } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { md, mdInline } from '../ui/md.js';
import { tappable, lookupDeck } from '../ui/wordtap.js';
import { ai, tutor, tutorStream, pron, aiErrorText, AiError } from '../ai.js';
import { user } from '../supa.js';
import { speak, stop as stopSpeech, recognize, canRecognize } from '../speech.js';
import { activityTimer, addMistake, deleteChat, mistakeHit, ruleHit, disputeFix, isDisputed, today as localDay } from '../stats.js';
import { ruleLabel } from '../rules.js';
import { confirmSheet } from '../ui/sheet.js';
import { scenarios as loadScenarios } from '../data.js';
import { runExercises } from '../ui/exercises.js';
import { toast } from '../ui/toast.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { go } from '../router.js';
import { about, rememberFacts, undoRemember } from './profile.js';
import { tx, txPrimary, txGrid, txGroup, txRows, txRow, txKpis, txPill, txDots } from '../ui/tiles.js';
import { savePhrases, guessSituation, hasPhrase, situation as phraseSit } from '../phrases.js';
import { markUsedWords, MIN_CHATS } from '../usage.js';

export const MODES = [
  { id: 'chat', emoji: 'speech', icon: 'chat-circle-dots', title: 'Вільна розмова', desc: 'Текстом, на будь-яку тему' },
  { id: 'voice', emoji: 'mic', icon: 'microphone', title: 'Голосова розмова', desc: 'У реальному часі' },
  { id: 'scenario', emoji: 'theater', icon: 'users-three', title: 'Сценарій', desc: 'Рольова гра', href: '#/scenarios' },
  { id: 'check', emoji: 'writing', icon: 'pencil-line', title: 'Перевір мій текст', desc: 'Лист → виправлення' },
  { id: 'explain', emoji: 'bulb', icon: 'lightbulb', title: 'Поясни', desc: 'Правило + 5 вправ' },
  { id: 'drill', emoji: 'target', icon: 'target', title: 'Слабке місце', desc: 'Міні-урок на помилку' },
];

// Консультація про власні результати (режим 'coach'): розділи, вступ і перші питання (без запиту до AI)
const COACH_SECTIONS = { overview: 'загальний прогрес', placement: 'рівень за навичками', speaking: 'говоріння', writing: 'письмо', vocabulary: 'слова', grammar: 'граматика', mistakes: 'помилки', habits: 'звички й час' };
const COACH_INTRO = {
  overview: 'Я бачу ваші результати в застосунку: тест, розмови, картки, уроки, помилки й час. Запитайте, що вас цікавить, — відповім за вашими даними.',
  placement: 'Поговорімо про рівень ваших навичок за тестом: чому він саме такий і як підтягнути найслабшу навичку.',
  speaking: 'Поговорімо про ваше говоріння: оцінки після розмов, критерії CEFR і що їх стримує.',
  writing: 'Поговорімо про ваше письмо: щоденник, перевірені тексти й типові помилки.',
  vocabulary: 'Поговорімо про ваші слова: скільки запам\'ятовується, що забувається і як повторювати ефективніше.',
  grammar: 'Поговорімо про граматику: пройдені уроки, бали й прогалини.',
  mistakes: 'Поговорімо про ваші помилки: що повторюється, що вже виправлено і як позбутися решти.',
  habits: 'Поговорімо про ваші звички: скільки й коли ви вчитеся і як зробити заняття регулярнішими.',
};
const COACH_STARTERS = {
  overview: ['Що в мене виходить найкраще?', 'Що найбільше стримує мій прогрес?', 'Який план на тиждень мені підійде?'],
  placement: ['Чому в мене саме такий рівень?', 'Яка навичка найслабша і що з нею робити?', 'Коли варто перепройти тест?'],
  speaking: ['Чому моє говоріння оцінено саме так?', 'Який критерій найслабший?', 'Як підготуватися до наступного рівня?'],
  writing: ['Які помилки я роблю в письмі найчастіше?', 'Як писати складніше для свого рівня?', 'Скільки писати на тиждень?'],
  vocabulary: ['Чи добре я запам\'ятовую слова?', 'Скільки нових слів мені брати на день?', 'Що робити зі словами, які забуваю?'],
  grammar: ['Які теми мені варто повторити?', 'Де в мене прогалини нижче мого рівня?', 'Який урок пройти наступним?'],
  mistakes: ['Яка моя найчастіша помилка?', 'Чому я повторюю ті самі помилки?', 'Що потренувати першим?'],
  habits: ['Чи достатньо я займаюся?', 'Як не пропускати дні?', 'Скільки хвилин на день мені треба?'],
};

export default async function tutorPage(view, r) {
  const q = r.query;
  // місія з життя: сценарій без id, лежить у sessionStorage (див. missionsBlock)
  const mission = q.mission ? readMission() : null;
  if (q.mission && !mission) {
    view.replaceChildren(h('div.empty', emo('flag', 'xl'), h('p', 'Місію не знайдено — складіть нові на сторінці вчителя.'), h('a.btn.soft', { href: '#/tutor' }, 'До вчителя')));
    return;
  }
  if (q.mode === 'voice') {
    const { voiceSession } = await import('../live/voice.js');
    return voiceSession(view, { scenario: q.scenario, topic: q.topic, label: q.label, mission });
  }
  if (q.chat) return openChat(view, q.chat);
  if (q.mode === 'check') return checkMode(view, q);
  if (q.mode || q.ask || q.scenario) return chat(view, { mode: q.mode || (q.scenario ? 'scenario' : 'chat'), scenario: q.scenario, type: q.type, ask: q.ask, topic: q.topic, section: q.section, mission });
  return overview(view);
}

// ---------- Місії з життя: 3 рольові ігри з профілю учня (дія mission) ----------
const MISSION_KEY = 'me:mission', MISSIONS_KEY = 'me:missions';
const ssGet = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* приватний режим */ } };
/** Місія у формі сценарію (без id) або null, якщо дані неповні */
export function cleanMission(m) {
  if (!m || typeof m !== 'object') return null;
  const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const x = { id: null, title: t(m.title, 80), why_uk: t(m.why_uk, 240), situation: t(m.situation, 600), myRole: t(m.myRole, 120), tutorRole: t(m.tutorRole, 120), goal: t(m.goal, 300),
    phrases: (Array.isArray(m.phrases) ? m.phrases : []).map(p => t(p, 160)).filter(Boolean).slice(0, 8) };
  return x.title && x.situation && x.myRole && x.tutorRole && x.goal ? x : null;
}
function readMission() { return cleanMission(ssGet(MISSION_KEY)); }
function startMission(m, how) {
  ssSet(MISSION_KEY, m);
  go(how === 'voice' ? '/tutor?mode=voice&mission=1' : '/tutor?mode=scenario&mission=1');
}

function missionsBlock() {
  const list = h('div.mission-list');
  const status = h('div.mission-status', { 'aria-live': 'polite' });
  // плитка-кнопка (не синя: головна дія сторінки — голосова розмова)
  const btn = tx({ icon: 'sparkle', label: 'Скласти місії', sub: ' ', wide: true, onclick: load, cls: 'mission-btn' });
  const paintBtn = (busy, has) => {
    btn.disabled = busy;
    btn.querySelector('.tx-sq').replaceChildren(ic(busy ? 'hourglass' : has ? 'arrow-clockwise' : 'flag', { size: 20 }));
    btn.querySelector('.tx-l').textContent = busy ? 'Складаю місії…' : has ? 'Інші місії' : 'Скласти місії';
    btn.querySelector('.tx-s').textContent = has ? 'Нові 3 ситуації з вашого профілю й планів' : 'Вчитель складе 3 ситуації за вашим профілем і планами — дзвінок, візит, розмова з сусідом';
  };
  const render = (missions) => {
    list.replaceChildren(...missions.map(missionCard));
    paintBtn(false, missions.length > 0);
  };
  async function load() {
    if (!user()) { toast(S.err.needLogin); return; }
    paintBtn(true, false);
    status.textContent = 'Вчитель переглядає ваш профіль і плани — це займе кілька секунд.';
    try {
      const res = await tutor('mission', {});
      const missions = (res?.missions || []).map(cleanMission).filter(Boolean).slice(0, 3);
      if (!missions.length) throw new AiError('empty', S.err.aiFailed);
      ssSet(MISSIONS_KEY, { ts: Date.now(), missions });
      status.textContent = '';
      render(missions);
    } catch (e) {
      status.textContent = aiErrorText(e) || S.err.generic;
      const cached = ssGet(MISSIONS_KEY);
      paintBtn(false, !!cached?.missions?.length);
    }
  }
  const cached = ssGet(MISSIONS_KEY);
  const missions = (cached?.missions || []).map(cleanMission).filter(Boolean);
  render(missions);
  return txGroup('Місії з вашого життя', [list, status, btn]);
}

function missionCard(m) {
  return h('article.mission-card.tu-mission',
    h('div.tu-mhead', h('span.tx-sq', ic('flag', { size: 20 })),
      h('div.tx-body', h('span.mission-title', m.title), m.why_uk ? h('span.mission-why', m.why_uk) : null)),
    h('div.mission-sit', m.situation),
    h('div.tu-facts',
      tuFact('user', 'Ви', m.myRole),
      tuFact('chalkboard-teacher', 'Співрозмовник', m.tutorRole),
      tuFact('target', 'Мета', m.goal)),
    m.phrases.length ? h('details.mission-phrases',
      h('summary', h('span.tx-sq', ic('chat-centered-text', { size: 16 })), h('span.grow', `Корисні фрази · ${m.phrases.length}`), ic('caret-down', { size: 16 })),
      h('ul', { lang: 'en' }, m.phrases.map(p => h('li', h('button.mission-phrase', { type: 'button', 'aria-label': `Прослухати: ${p}`, onclick: () => speak(p) }, ic('speaker-high', { size: 14 }), h('span', p)))))) : null,
    m.phrases.length ? missionSaveBtn(m) : null,
    h('div.tx-grid.c2.mission-acts',
      tx({ icon: 'microphone', label: 'Голосом', sub: 'у реальному часі', onclick: () => startMission(m, 'voice') }),
      tx({ icon: 'chat-circle-dots', label: 'Текстом', sub: 'у чаті', onclick: () => startMission(m, 'text') })));
}
/** Рядок факту в плитці (роль, мета): іконка в квадратику + підпис великими літерами + текст */
export const tuFact = (icon, label, text) => h('div.tu-fact', h('span.tx-sq', ic(icon, { size: 16 })),
  h('div.tx-body', h('span.tu-fact-k', label), h('span.tu-fact-v', text)));

/** «У фразник»: фрази місії — у фразник (ситуація — за назвою й описом місії) */
function missionSaveBtn(m) {
  const b = h('button.tx-row.mission-save', { type: 'button' });
  const paint = (busy = false) => {
    const all = m.phrases.every(hasPhrase);
    b.disabled = busy || all;
    b.replaceChildren(h('span.tx-sq', ic(busy ? 'hourglass' : all ? 'check' : 'plus', { size: 18 })), h('span.tx-l', busy ? 'Зберігаю…' : all ? 'Фрази у фразнику' : `У фразник · ${m.phrases.length}`));
  };
  paint();
  b.addEventListener('click', async () => {
    const sit = guessSituation(`${m.title} ${m.situation} ${m.goal}`);
    paint(true);
    const r = await savePhrases(m.phrases.map(en => ({ en })), { situation: sit, source: 'mission' }).catch(() => null);
    paint();
    phraseSaved(r, sit);
  });
  return b;
}
/** Сповіщення після збереження у фразник: з переходом до ситуації */
export function phraseSaved(r, sit) {
  if (!r) { toast('Не вдалося зберегти фрази'); return; }
  toast(r.added ? `У фразнику: +${r.added} · ${phraseSit(sit).uk}` : 'Ці фрази вже є у ваших картках',
    { action: 'Відкрити', onAction: () => go(`/phrases/${sit}`) });
}

function needLoginCard() {
  if (user()) return null;
  return tx({ icon: 'key', label: 'Вчитель працює після входу', sub: 'AI працює через захищений сервер, тому потрібен акаунт.', wide: true, tone: 'warn', href: '#/auth',
    end: h('span.btn.sm.soft', 'Увійти') });
}

function overview(view) {
  const st = store.settings();
  const chats = store.all('tutor_chats').filter(c => c.mode !== 'diary').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const voice = MODES.find(m => m.id === 'voice');
  view.replaceChildren(h('div.stack-lg.tt-home',
    needLoginCard(),
    txGroup(`${st.tutorName} · ваш AI-вчитель`, [
      txPrimary({ icon: voice.icon, label: 'Розмова голосом', sub: 'У реальному часі — вчитель слухає й відповідає', href: '#/tutor?mode=voice' }),
      Object.assign(txGrid(MODES.filter(m => m.id !== 'voice').map(m => tx({ icon: m.icon, label: m.title, sub: m.desc, href: m.href || `#/tutor?mode=${m.id}` }))), { className: 'tx-grid tt-modes' }),
    ]),
    missionsBlock(),
    history(view, chats)));
}

/** Історія розмов: відкрити, видалити одну або кілька (разом із часом і помилками в статистиці) */
function history(view, chats) {
  const box = h('section.tx-group.tt-hist');
  let selecting = false;
  const picked = new Set();
  const modeIcon = (c) => c.mode === 'voice' ? 'microphone' : c.mode === 'check' ? 'pencil-line' : c.mode === 'scenario' ? 'users-three' : c.mode === 'coach' ? 'chart-pie-slice' : 'chat-circle-dots';
  const draw = () => {
    const list = store.all('tutor_chats').filter(c => c.mode !== 'diary').sort((a, b) => b.created_at.localeCompare(a.created_at));
    const head = h('div.tx-label-row', h('h2.tx-label', `Історія${list.length ? ` · ${list.length}` : ''}`),
      list.length ? h('button.tx-more', { type: 'button', onclick: () => { selecting = !selecting; picked.clear(); draw(); } }, selecting ? 'Скасувати' : 'Вибрати') : null);
    if (!list.length) { box.replaceChildren(head, h('div.tx-row.tt-empty', h('span.tx-sq', ic('chat-circle-dots', { size: 18 })), h('span.tx-body', h('span.tx-s', 'Поки що розмов немає. Почніть з вільної або голосової розмови.')))); return; }
    const rows = list.slice(0, 60).map(c => {
      const title = c.title || 'Розмова';
      const sub = `${new Date(c.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}${c.mode === 'coach' ? ' · консультація' : ` · ${fmtMin(c.seconds || 0)}${c.summary && !c.summary.partial ? '' : ' · без підсумку'}`}`;
      const sq = h('span.tx-sq', ic(modeIcon(c), { size: 18 }));
      const body = h('span.tx-body', h('span.tx-l', title), h('span.tx-s', sub));
      if (selecting) {
        const cb = h('input.check', { type: 'checkbox', checked: picked.has(c.id), 'aria-label': `Вибрати: ${title}`, onchange: (e) => { e.target.checked ? picked.add(c.id) : picked.delete(c.id); draw(); } });
        return h('label.tx-row' + (picked.has(c.id) ? '.on' : ''), cb, sq, body);
      }
      return h('div.tx-row.pp-hrow',
        h('a.pp-hlink', { href: `#/tutor?chat=${encodeURIComponent(c.id)}` }, sq, body),
        h('button.icon-btn', { type: 'button', 'aria-label': `Видалити: ${title}`, onclick: () => remove([c.id]) }, ic('trash', { size: 20 })));
    });
    box.replaceChildren(head, txRows(rows),
      selecting ? h('div.row',
        h('button.btn.soft.grow', { type: 'button', onclick: () => { list.forEach(c => picked.add(c.id)); draw(); } }, 'Вибрати всі'),
        h('button.btn.danger.grow', { type: 'button', disabled: !picked.size, onclick: () => remove([...picked]) }, ic('trash', { size: 18 }), `Видалити (${picked.size})`)) : '');
  };
  async function remove(ids) {
    const n = ids.length;
    const ok = await confirmSheet(n > 1 ? `Видалити ${n} ${plural(n, 'розмову', 'розмови', 'розмов')}?` : 'Видалити розмову?',
      n > 1 ? 'Разом із ними зі статистики приберуться їхній час і помилки з підсумків. Слова, які ви додали в картки, залишаться.'
        : 'Разом із розмовою зі статистики приберуться її час і помилки з її підсумку. Слова, які ви додали в картки, залишаться.', 'Видалити', { danger: true });
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
    }).filter(f => f.right && !/^(none|no corrections?)\.?$/i.test(f.right) && !/^-+$/.test(f.right));
  return { body, fixes };
}

/** meta з останньої SSE-події: обрізані рядки, обмежена кількість, сміття відкинуте (старий сервер meta не шле — усе порожнє) */
export function cleanMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const arr = (v) => Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n+/) : v ? [v] : [];
  const txt = (x) => typeof x === 'string' ? x : x?.text || x?.step || '';
  return {
    suggestions: arr(m.suggestions).map(x => s(txt(x), 160).replace(/^\d+[.)]\s*/, '')).filter(Boolean).slice(0, 3),
    words: arr(m.words).map(w => ({ en: s(w?.en, 80), uk: s(w?.uk, 120), example: s(w?.example, 200) })).filter(w => w.en && w.uk && /[A-Za-z]/.test(w.en)).slice(0, 3),
    memory: arr(m.memory).map(x => s(txt(x), 120)).filter(x => x.length >= 3).slice(0, 3),
    plan: arr(m.plan).map(x => s(txt(x), 160).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')).filter(Boolean).slice(0, 5),
  };
}

/** Відповідь дії hint («1) … 2) … 3) …») → варіанти реплік */
export function parseHint(text) {
  return String(text || '').split('\n').map(l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').replace(/^["«]|["»]$/g, '').replace(/\*\*/g, '').trim())
    .filter(l => l && /[A-Za-z]/.test(l)).slice(0, 3);
}

// ---------- Слова в картки (той самий шлях, що й у wordtap: слово ввімкненої колоди — та сама картка, без дубля) ----------
const wnorm = (s) => String(s || '').toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim().replace(/^to /, '');
export const wordKnown = (en) => { const k = wnorm(en); return store.all('cards').some(c => wnorm(c.en) === k); };
/**
 * Слово в картки. Повертає 'created' | 'starter' | 'exists'.
 * opts.tags — додаткові теги картки (напр. 'auto'); opts.out — сюди записується id картки (щоб її можна було прибрати).
 */
export async function addWord(w, { tags = [], out = null } = {}) {
  if (wordKnown(w.en)) return 'exists';
  const extraTags = (Array.isArray(tags) ? tags : []).filter(t => typeof t === 'string' && t);
  try {
    const { hit } = await lookupDeck(w.en);
    if (hit?.deckId && hit.card && wnorm(hit.en) === wnorm(w.en)) {
      const id = srs.starterId(hit.deckId, hit.card.en);
      if (store.get('cards', id)) return 'exists';
      const deck = (await srs.decks()).find(d => d.id === hit.deckId);
      if (deck?.enabled) {
        const rowS = srs.rowFromStarter(hit.deckId, hit.card);
        if (extraTags.length) rowS.tags = [...new Set([...(rowS.tags || []), ...extraTags])];
        store.put('cards', rowS);
        if (out) out.id = rowS.id;
        return 'starter';
      }
    }
  } catch { /* колоди не завантажились — додаємо власну картку */ }
  const r = srs.addCard({ en: w.en, uk: w.uk, examples: w.example ? [{ en: w.example, uk: '' }] : [], tags: ['tutor', ...extraTags], extra: { source: 'tutor' } });
  if (out && r.created) out.id = r.row.id;
  return r.created ? 'created' : 'exists';
}

// ---------- Слова з розмов — у картки автоматично ----------
// Після підсумку голосової, текстової розмови чи сценарію до 5 найкращих нових слів одразу йдуть у картки (тег 'auto'),
// не більше 10 на день (лічильник — localStorage 'me:auto-words' = { day, n }). Що саме додано — summary.auto_words (синхронізується з розмовою),
// тож «Прибрати» на екрані підсумку видаляє лише картки, створені автододаванням.
const AUTO_MODES = new Set(['voice', 'chat', 'scenario']);
// слова, про які учень сам питав (asked: true — точно незнайомі), додаються першими й понад звичайний ліміт: до 10 за розмову, 20 на день
const AUTO_PER_CHAT = 5, AUTO_PER_DAY = 10, ASKED_PER_CHAT = 10, ASKED_PER_DAY = 20, AUTO_KEY = 'me:auto-words';
let autoMem = null;
function autoToday() {
  try {
    const v = JSON.parse(localStorage.getItem(AUTO_KEY) || 'null');
    if (v && v.day === localDay()) return Number(v.n) || 0;
    if (v) return 0;
  } catch { /* приватний режим */ }
  return autoMem && autoMem.day === localDay() ? autoMem.n : 0;
}
function autoCount(n) {
  autoMem = { day: localDay(), n };
  try { localStorage.setItem(AUTO_KEY, JSON.stringify(autoMem)); } catch { /* лишається в пам'яті */ }
}
/** Найкращі кандидати: слово чи коротка фраза (≤ 4 слів) з перекладом; з прикладом — вище; порядок сервера — за важливістю */
export function pickAutoWords(words, n = AUTO_PER_CHAT) {
  const seen = new Set();
  return (Array.isArray(words) ? words : [])
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => {
      const en = String(w?.en || '').trim(), uk = String(w?.uk || '').trim();
      if (!en || !uk || !/[a-z]/i.test(en) || en.split(/\s+/).length > 4 || en.length > 60) return false;
      const k = wnorm(en);
      if (seen.has(k) || wordKnown(en)) return false;
      seen.add(k); return true;
    })
    .sort((a, b) => (b.w.asked ? 1 : 0) - (a.w.asked ? 1 : 0) || (b.w.example ? 1 : 0) - (a.w.example ? 1 : 0) || a.i - b.i)
    .slice(0, n).map(x => x.w);
}
/** Додати слова з підсумку в картки (одна розмова — не більше 5 за всі її підсумки). Повертає список доданих або null, якщо вимкнено */
async function autoAddWords(row) {
  const s = row.summary;
  if (!s || !AUTO_MODES.has(row.mode) || store.settings().autoWords === false) return null;
  const prev = Array.isArray(s.auto_words) ? s.auto_words : [];
  const room = Math.min(AUTO_PER_CHAT - prev.length, AUTO_PER_DAY - autoToday());
  const askedRoom = Math.min(ASKED_PER_CHAT - prev.length, ASKED_PER_DAY - autoToday());
  const asked = pickAutoWords((s.new_words || []).filter(w => w?.asked), Math.max(0, askedRoom));
  const added = [];
  if (room > 0 || asked.length) {
    const rest = room > asked.length ? pickAutoWords((s.new_words || []).filter(w => !w?.asked), room - asked.length) : [];
    for (const w of [...asked, ...rest]) {
      const out = {};
      const r = await addWord(w, { tags: ['auto'], out }).catch(() => 'error');
      if ((r === 'created' || r === 'starter') && out.id) added.push({ en: String(w.en).trim(), id: out.id, at: new Date().toISOString() });
    }
    if (added.length) autoCount(autoToday() + added.length);
  }
  s.auto_words = [...prev, ...added];
  // ліміт дня вичерпано, а цікаві слова лишились — підсумок про це скаже
  s.auto_limit = s.auto_words.length < AUTO_PER_CHAT && autoToday() >= AUTO_PER_DAY && pickAutoWords(s.new_words, 1).length > 0;
  return s.auto_words;
}
const wordsBlock = (words) => h('div.msg-words', h('div.tx-label', 'Корисні слова — у картки дотиком'), h('div.tu-wrows', words.map(wordChip)));
/** Кнопка «+ слово»: стан «уже в картках» перевіряється при показі */
function wordChip(w) {
  const b = h('button.word-chip.tu-wrow', { type: 'button' });
  const paint = (on) => { b.disabled = on; b.classList.toggle('is-on', on); b.setAttribute('aria-label', on ? `${w.en} — уже в картках` : `Додати в картки: ${w.en} — ${w.uk}`); b.replaceChildren(h('span.tu-wsq', ic(on ? 'check' : 'plus', { size: 14 })), h('span.tu-wt', h('b', { lang: 'en' }, w.en), h('span.dim', w.uk))); };
  paint(wordKnown(w.en));
  b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await addWord(w).catch(() => 'error');
    if (r === 'error') { toast('Не вдалося додати слово'); paint(false); return; }
    toast(r === 'exists' ? 'Таке слово вже є в картках' : r === 'starter' ? 'Слово є у ваших колодах — додано першим серед нових' : `Додано в картки: ${w.en}`);
    paint(true);
  });
  return b;
}

// ---------- Переклад повідомлення ----------
// Дія translate — нова на сервері; поки її немає (старий сервер відповідає 400 «Unknown action» до списання ліміту), перекладаємо через chat без стрімінгу
// Відповідь «немає такої дії» запам'ятовуємо на добу, щоб не питати сервер щоразу
const TR_KEY = 'me:tr-none';
let hasTranslate = (() => { try { return Date.now() - Number(localStorage.getItem(TR_KEY) || 0) < 864e5 ? false : null; } catch { return null; } })();
async function translateText(text) {
  if (hasTranslate !== false) {
    try {
      const r = await tutor('translate', { text, to: 'uk' });
      const uk = String(r?.uk || r?.text || '').trim();
      if (uk) { hasTranslate = true; return uk; }
    } catch (e) {
      if (e?.code !== 'bad_request' || !/unknown action/i.test(e?.message || '')) throw e;
      hasTranslate = false;
      try { localStorage.setItem(TR_KEY, String(Date.now())); } catch { /* */ }
    }
  }
  const r = await ai('tutor', 'chat', { stream: false, meta: false, mode: 'chat', messages: [{ role: 'user', cue: true, text: `(App request, not a chat turn.) Translate the English text below into natural literary Ukrainian. Reply with the Ukrainian translation only: no English, no comments, no corrections block.\n\n${text}` }] });
  return parseReply(String(r?.text || '')).body.trim();
}

function stripForSpeech(t) { return t.replace(/[*_`#>~]/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(); }

/** «Запитати вчителя» зі слова в чаті: питання підставляється в поле вводу (не надсилається і не витрачає ліміт AI без згоди) */
function askInChat(word) {
  const ta = document.querySelector('.composer textarea');
  if (!ta) { location.hash = `#/tutor?ask=${encodeURIComponent(word)}`; return; }
  const q = `What does "${word}" mean here?`;
  ta.value = ta.value.trim() ? `${ta.value.trimEnd()}\n${q}` : q;   // чернетку не затираємо
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

/** Тема «мої помилки» — для тексту й голосу (≤300 символів: сервер обрізає тему) */
export const MISTAKES_TOPIC = { label: 'Мої помилки', topic: 'Work on the student\'s own mistakes: name 2 of their most frequent recent mistakes (wrong → right), then keep a natural conversation that makes them use the correct forms; notice when they get it right.' };
export const focusTopic = (focus) => ({ label: 'Порада вчителя', topic: `Focus recommended after the last session (practise it naturally in conversation): ${focus}`.slice(0, 300) });

/** Ідеї тем для старту: інтереси з профілю + побутові теми */
export function topicIdeas() {
  const st = store.settings();
  const mine = String(about().interests || '').split(/[,;\n/]|\s+(?:і|й|та|and)\s+/).map(x => x.replace(/[.!]+$/, '').trim()).filter(x => x.length >= 2 && x.length <= 40).slice(0, 4)
    .map(x => ({ label: x.charAt(0).toUpperCase() + x.slice(1), topic: `One of the student's interests: «${x}». Talk with them about it.` }));
  const base = [
    { label: 'Мій день', topic: 'The student\'s day: what they did today and their plans for tomorrow.' },
    { label: 'Вихідні', topic: 'Weekends: how the student usually spends them and their plans for the next one.' },
    { label: 'Подорожі', topic: 'Travel: places the student has been to or would like to visit.' },
    { label: 'Їжа й готування', topic: 'Food and cooking: favourite dishes, eating out, cooking at home.' },
    { label: 'Фільми й серіали', topic: 'Films and TV series the student has watched recently or likes.' },
    st.workFocus ? { label: 'Робота', topic: 'The student\'s work: their tasks, colleagues and a typical working day.' } : null,
  ].filter(Boolean);
  const seen = new Set();
  return [...mine, ...base].filter(t => { const k = t.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
}

/** Іконка теми розмови (плитки «Про що поговоримо?» у чаті й голосі) */
const TOPIC_ICON = { 'Мої помилки': 'warning-circle', 'Порада вчителя': 'target', 'Мій день': 'sun', 'Вихідні': 'calendar-blank', 'Подорожі': 'airplane-tilt', 'Їжа й готування': 'fork-knife', 'Фільми й серіали': 'play', 'Робота': 'briefcase' };
export const topicIcon = (t) => TOPIC_ICON[t?.label] || 'heart';

// ---------- Текстовий чат ----------
async function chat(view, opts) {
  let scenario = null;
  if (opts.mission) scenario = opts.mission;
  else if (opts.scenario) scenario = (await loadScenarios()).find(s => s.id === opts.scenario);
  const typeLabel = opts.type ? (S.mistakeTypes[opts.type] || opts.type) : null;
  if (opts.mode === 'coach') {
    const section = Object.hasOwn(COACH_SECTIONS, opts.section || '') ? opts.section : 'overview';
    const row = { mode: 'coach', scenario: null, title: `Консультація: ${COACH_SECTIONS[section]}`, messages: [], summary: null, seconds: 0, meta: { section, topicLabel: `Консультація · ${COACH_SECTIONS[section]}` } };
    return chatUI(view, row, {});
  }
  if (opts.mission) {
    const row = { mode: 'scenario', scenario: null, title: `Місія: ${scenario.title}`, messages: [], summary: null, seconds: 0, meta: { type: null, topic: null, mission: opts.mission, topicLabel: `Місія · ${scenario.title}` } };
    return chatUI(view, row, { scenario });
  }
  const title = scenario ? scenario.title : opts.mode === 'drill' ? `Тренування: ${typeLabel || 'слабке місце'}` : opts.mode === 'explain' ? 'Поясни' : opts.ask ? `Слово: ${opts.ask}` : 'Вільна розмова';
  const row = { mode: opts.mode, scenario: opts.scenario || null, title, messages: [], summary: null, seconds: 0, meta: { type: opts.type || null, topic: opts.topic || null } };
  return chatUI(view, row, { scenario, ask: opts.ask, topic: opts.topic });
}

async function openChat(view, id) {
  const row = store.get('tutor_chats', id);
  if (!row) { view.replaceChildren(h('div.empty', h('p', 'Розмову не знайдено'), h('a.btn.soft', { href: '#/tutor' }, 'До вчителя'))); return; }
  // записи щоденника живуть у tutor_chats (mode 'diary'), але відкриваються на своїй сторінці
  if (row.mode === 'diary') { go('/diary/' + encodeURIComponent(id), { replace: true }); return; }
  if (row.mode === 'check') return checkResultView(view, row);
  // консультація без тексту (повний текст розмов зберігається 30 днів) — підсумку в неї немає
  if (row.mode === 'coach' && !row.messages?.length) { view.replaceChildren(h('div.empty', emo('chart-pie-slice', 'xl'), h('p', 'Текст цієї консультації вже не зберігається.'), h('a.btn.soft', { href: `#/tutor?mode=coach&section=${encodeURIComponent(row.meta?.section || 'overview')}` }, 'Нова консультація'))); return; }
  if (!row.messages?.length) return summaryView(view, row);
  let scenario = null;
  if (row.scenario) scenario = (await loadScenarios()).find(s => s.id === row.scenario);
  // місія (сценарій без id) — з локальної копії розмови (meta не синхронізується)
  if (!scenario && row.meta?.mission) scenario = cleanMission(row.meta.mission);
  return chatUI(view, row, { scenario, topic: row.meta?.topic || null, resumed: true });
}

const mkey = (m) => `${m.wrong}|${m.right}`.toLowerCase().replace(/\s+/g, ' ').trim();
const fmtDay = (iso) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

function chatUI(view, row, { scenario, ask, topic, resumed } = {}) {
  setTitle(row.title);
  const st = store.settings();
  row.meta = row.meta || {};
  // консультація (mode 'coach'): розмова українською про власні результати — без виправлень, перекладу й підказок англійською,
  // час не зараховується як практика англійської; із запитами йде зведення результатів (js/analysis.js, рахується раз на розмову)
  const coach = row.mode === 'coach';
  // meta не синхронізується (немає в COLUMNS) — на іншому пристрої розділ відновлюється з назви розмови
  const section = !coach ? null : Object.hasOwn(COACH_SECTIONS, row.meta.section || '') ? row.meta.section
    : Object.keys(COACH_SECTIONS).find(k => row.title === `Консультація: ${COACH_SECTIONS[k]}`) || 'overview';
  if (coach) row.meta.topicLabel ||= `Консультація · ${COACH_SECTIONS[section]}`;
  let digestP = null;
  const coachDigest = () => (digestP ||= import('../analysis.js').then(m => m.compute().then(A => m.digest(A, section))).catch(() => { digestP = null; return null; }));
  const timer = coach ? { setRef() {}, poke() {}, seconds: () => 0, stop: () => null } : activityTimer('tutor');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const PH = coach ? 'Запитайте про свої результати…' : 'Напишіть англійською…';
  const list = h('div.chat', { 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const ta = h('textarea', { rows: 1, placeholder: PH, 'aria-label': 'Повідомлення', enterkeyhint: coarse ? 'enter' : 'send' });
  // поки вчитель відповідає, кнопка стає «Зупинити»: відповідь можна перервати й одразу написати нову (інакше ввід «зависав»)
  let current = null;
  const sendBtn = h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Надіслати', onclick: () => (busy && current ? current.abort('stop') : send()) }, ic('paper-plane-right', { fill: true }));
  // iPhone: тап по кнопці спершу знімав фокус із поля — клавіатура ховалась, панель з'їжджала, і «click» не потрапляв у кнопку.
  // Не даємо кнопці забрати фокус: клавіатура лишається, натискання спрацьовує завжди.
  sendBtn.addEventListener('pointerdown', (e) => { if (document.activeElement === ta) e.preventDefault(); });
  sendBtn.addEventListener('mousedown', (e) => { if (document.activeElement === ta) e.preventDefault(); });
  const setBusy = (on) => {
    busy = on;
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', on ? 'Зупинити відповідь' : 'Надіслати');
    sendBtn.replaceChildren(ic(on ? 'stop' : 'paper-plane-right', { fill: true }));
  };
  // диктування розпізнає англійську — у консультації (українською) його немає
  const micBtn = canRecognize() && !coach ? h('button.icon-btn', { type: 'button', 'aria-label': 'Надиктувати', onclick: dictate }, ic('microphone')) : null;
  const finishBtn = h('button.btn.sm.soft', { type: 'button', onclick: finish }, 'Завершити');
  const hintBtn = h('button.chip.hint-chip', { type: 'button', onclick: hint }, ic('lightbulb', { size: 16 }), 'Підказка');
  const sugg = h('div.sugg', { role: 'group', 'aria-label': 'Що відповісти' });
  const jumpBtn = h('button.jump', { type: 'button', hidden: true, 'aria-label': 'До нових повідомлень', onclick: () => { pinned = true; jumpBtn.hidden = true; toBottom(true); } }, ic('caret-down', { size: 20 }));
  const dock = h('div.tutor-dock', jumpBtn, sugg, h('div.composer', micBtn, ta, sendBtn));
  const extra = h('div');
  const planBox = h('div');
  let busy = false, startPanel = null, suggestions = [];

  // ---------- чернетка: окремо для кожної розмови (нова — за режимом/сценарієм) ----------
  const saved = () => !!(row.id && store.get('tutor_chats', row.id));
  const draftKey = () => `me:tdraft:${saved() ? row.id : `new:${row.mode}:${row.scenario || ''}:${ask || ''}`}`;
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* приватний режим */ } };
  ta.value = lsGet(draftKey());
  // чернетки видалених розмов (і тих, що зникли з локальної копії) не накопичуються
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('me:tdraft:') && !k.startsWith('me:tdraft:new:') && !store.get('tutor_chats', k.slice(10))) localStorage.removeItem(k);
    }
  } catch { /* приватний режим */ }

  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', () => { grow(); lsSet(draftKey(), ta.value.trim() ? ta.value : ''); });
  // Enter — надіслати на комп'ютері; на телефоні — новий рядок (надсилає кнопка). Ctrl/⌘+Enter — надіслати будь-де.
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.ctrlKey || e.metaKey || (!e.shiftKey && !coarse)) { e.preventDefault(); send(); }
  });

  // ---------- прокрутка: стежимо за новим текстом, лише поки учень унизу ----------
  const se = () => document.scrollingElement || document.documentElement;
  const nearBottom = () => se().scrollHeight - (window.scrollY + window.innerHeight) < 160;
  let pinned = true;
  const toBottom = (smooth) => window.scrollTo({ top: se().scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  const follow = () => { if (pinned) toBottom(false); else jumpBtn.hidden = false; };
  const onScroll = () => { pinned = nearBottom(); if (pinned) jumpBtn.hidden = true; };
  window.addEventListener('scroll', onScroll, { passive: true });

  // ---------- клавіатура iOS: панель вводу над клавіатурою (visualViewport) ----------
  const vv = window.visualViewport;
  const onVV = () => {
    if (cleaned) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.body.style.setProperty('--kb', kb + 'px');
    const open = kb > 80 && document.activeElement === ta;   // масштабування на комп'ютері/Android без клавіатури — не клавіатура
    if (open !== document.body.classList.contains('kb-open')) { document.body.classList.toggle('kb-open', open); if (open && pinned) requestAnimationFrame(() => toBottom(false)); }
  };
  vv?.addEventListener('resize', onVV); vv?.addEventListener('scroll', onVV);
  if (vv) { ta.addEventListener('focus', onVV); ta.addEventListener('blur', onVV); }

  const intro = scenario ? h('section.tu-intro',
    h('div.tu-mhead', h('span.tx-sq', scenario.emoji ? emo(scenario.emoji) : ic('flag', { size: 20 })), h('div.tx-body', h('span.tx-l', scenario.title), h('span.tx-s', `Ваша роль: ${scenario.myRole}`))),
    h('div.small', scenario.situation), tuFact('target', 'Мета', scenario.goal)) : null;

  view.replaceChildren(h('div.stack.tutor-chat',
    h('div.row.tutor-head', h('a.icon-btn', { href: coach ? '#/analysis' : '#/tutor', 'aria-label': 'Назад' }, ic('arrow-left')),
      h('span.avatar', { 'aria-hidden': 'true' }, (st.tutorName || 'A').charAt(0).toUpperCase()),
      h('div.grow', h('div.name', st.tutorName), h('div.xs.dim', row.meta.topicLabel || MODES.find(m => m.id === row.mode)?.title || 'Розмова')), finishBtn),
    needLoginCard(), intro, planBox, list, extra, dock));
  grow();

  // ---------- повідомлення ----------
  function fixCard(m, open) {
    const added = new Set(row.meta.fixAdded || []);
    const addBtn = (f) => {
      if (!f.wrong) return null;
      const on = added.has(mkey(f));
      return h('button.btn.sm.ghost.fix-add', { type: 'button', disabled: on, onclick: (e) => { recordFix(f); const b = e.currentTarget; b.disabled = true; b.replaceChildren(ic('check', { size: 14 }), 'У помилках'); toast('Додано в «Мої помилки»'); } },
        ic(on ? 'check' : 'plus', { size: 14 }), on ? 'У помилках' : 'У помилки');
    };
    const first = m.fixes[0];
    return h('details.fixcard', { open: !!open },
      h('summary', h('span.tu-fsq', ic('pencil-simple', { size: 16 })), h('span.fix-title', `Виправлення${m.fixes.length > 1 ? ` · ${m.fixes.length}` : ''}`),
        h('span.fix-peek', first.wrong ? [h('s', first.wrong), ' → ', h('b', first.right)] : h('b', first.right)), ic('caret-down', { size: 16 })),
      h('ul', m.fixes.map(f => h('li',
        h('div.fix-line', f.wrong ? [h('s.bad', f.wrong), h('span.arrow', { 'aria-label': 'правильно:' }, ' → '), h('b.good', f.right)] : h('b.good', f.right)),
        f.why ? h('div.xs.dim', mdInline(f.why)) : null,
        h('div.row.wrap.fix-acts', addBtn(f), f.wrong ? h('button.btn.sm.ghost.disagree', { type: 'button', disabled: isDisputed(f.wrong, f.right), onclick: (e) => {
          disputeFix(f, row.summary?.mistakes ? row : null);
          const b = e.currentTarget; b.disabled = true; b.replaceChildren(ic('check', { size: 14 }), 'Більше не виправлятиме');
          b.closest('li')?.classList.add('disputed');
        } }, ic('x-circle', { size: 14 }), isDisputed(f.wrong, f.right) ? 'Більше не виправлятиме' : 'Не згоден') : null)))));
  }
  function recordFix(f) {
    persist(true);
    const m = { wrong: f.wrong, right: f.right, type: 'other', explanation_uk: f.why || '' };
    row.meta.fixAdded = [...new Set([...(row.meta.fixAdded || []), mkey(f)])];
    // помилка потрапляє в список розмови: deleteChat() прибере її разом із розмовою, а підсумок не зарахує вдруге
    if (!row.summary) row.summary = { partial: true, mistakes: [] };
    // та сама помилка з іншої репліки (або вже з підсумку) не рахується вдруге — інакше deleteChat() не зняв би зайве
    if ((row.summary.mistakes || []).some(x => mkey(x) === mkey(m))) { store.put('tutor_chats', row); return; }
    row.summary.mistakes = [...(row.summary.mistakes || []), m];
    addMistake({ ...m, source: 'tutor', ref: row.id });
    store.put('tutor_chats', row);
  }

  let playing = null;
  function actBtn(icon, label, aria, onclick) {
    return h('button.mact', { type: 'button', 'aria-label': aria || label, onclick }, icon ? ic(icon, { size: 16 }) : null, label ? h('span', label) : null);
  }
  function renderModel(m, { actions = true } = {}) {
    const parsed = m.fixes ? { body: m.text, fixes: m.fixes } : parseReply(m.text);
    const out = [];
    if (parsed.fixes.length) out.push(fixCard({ fixes: parsed.fixes }, false));
    // англійські слова відповіді вчителя перекладаються дотиком (лише готові повідомлення, не під час стрімінгу)
    const bubble = h('div.msg.ai', m.kind === 'simpler' ? h('div.msg-label', ic('text-aa', { size: 14 }), 'Простіше') : null,
      tappable(h('div.msg-body', md(parsed.body)), { onAsk: askInChat }));
    if (m.words?.length) bubble.append(wordsBlock(m.words));
    if (actions && !coach) {
      const text = stripForSpeech(parsed.body);
      let tr = null;
      const listen = (rate) => async (e) => {
        const b = e.currentTarget;
        if (playing === b) { stopSpeech(); return; }
        playing?.setAttribute('aria-pressed', 'false');
        playing = b; b.setAttribute('aria-pressed', 'true');
        try { await speak(text, { rate }); } finally { if (playing === b) { b.setAttribute('aria-pressed', 'false'); playing = null; } }
      };
      const trBtn = actBtn('translate', 'Переклад', null, async () => {
        if (tr) { tr.hidden = !tr.hidden; trBtn.setAttribute('aria-expanded', String(!tr.hidden)); return; }
        if (!user()) { toast(S.err.needLogin); return; }
        tr = h('div.msg-tr', { lang: 'uk' }, h('span.dim', 'Перекладаю…'));
        bubble.insertBefore(tr, acts);
        trBtn.setAttribute('aria-expanded', 'true');
        try {
          if (!m.uk) { m.uk = await translateText(parsed.body); if (row.messages.includes(m)) persist(); }
          tr.replaceChildren(md(m.uk));
        } catch (e) { tr.remove(); tr = null; trBtn.setAttribute('aria-expanded', 'false'); toast(aiErrorText(e) || S.err.generic, { kind: 'bad' }); }
      });
      trBtn.setAttribute('aria-expanded', 'false');
      const acts = h('div.msg-acts', { role: 'group', 'aria-label': 'Дії з повідомленням' },
        actBtn('speaker-high', '', 'Прослухати', listen(undefined)),
        actBtn(null, '0.8×', 'Прослухати повільніше', listen(0.8)),
        trBtn,
        row.messages.includes(m) ? actBtn('text-aa', 'Простіше', 'Сказати простіше', () => simpler(parsed.body)) : null);
      bubble.append(acts);
    }
    out.push(bubble);
    return out;
  }
  function render(m) { return m.role === 'user' ? [h('div.msg.me', m.text)] : renderModel(m); }

  function showPlan() {
    const plan = row.meta.plan;
    if (!plan?.length) { planBox.replaceChildren(); return; }
    planBox.replaceChildren(h('details.plan.tu-plan', { open: !resumed },
      h('summary', h('span.tx-sq', ic('target', { size: 18 })), h('span.tx-body', h('span.tx-l', 'План заняття'), h('span.tx-s', `${plan.length} ${plural(plan.length, 'крок', 'кроки', 'кроків')}`)), ic('caret-down', { size: 16 })),
      h('ol', plan.map(p => h('li', mdInline(p))))));
  }

  function setSuggestions(list2) {
    suggestions = list2 || [];
    const chips = suggestions.map(s => h('button.chip.sugg-chip', { type: 'button', lang: coach ? 'uk' : 'en', 'aria-label': coach ? `Підставити питання: ${s}` : `Підставити відповідь: ${s}`, onclick: () => {
      ta.value = s; ta.dispatchEvent(new Event('input')); ta.focus();
      try { ta.setSelectionRange(s.length, s.length); } catch { /* */ }
    } }, s));
    sugg.replaceChildren(...(chips.length ? [h('span.sugg-ic', { 'aria-hidden': 'true' }, ic('lightbulb', { size: 16 })), ...chips] : coach ? [] : [hintBtn]));
    sugg.hidden = busy || (!coach && !row.messages.some(m => m.role === 'model')) || !user() || (coach && !chips.length);
  }

  for (const m of row.messages) if (!m.hidden) list.append(...render(m));
  showPlan();
  setSuggestions([]);
  // продовжена розмова відкривається на останньому повідомленні
  if (row.messages.length > 2) requestAnimationFrame(() => setTimeout(() => toBottom(false), 50));

  function persist(force = false) {
    const before = draftKey();
    // у історію потрапляє лише розмова, де учень щось сказав (не лише привітання вчителя)
    if (force || row.messages.some(m => m.role === 'user' && !m.hidden)) store.put('tutor_chats', row);
    const after = draftKey();
    if (before !== after) { lsSet(after, lsGet(before)); lsSet(before, ''); }
  }

  const streams = new Set();
  async function send(textOverride, { hidden = false, kind = null } = {}) {
    const text = (textOverride ?? ta.value).trim();
    if (busy || (!text && !hidden)) return;
    if (!user()) { toast(S.err.needLogin); return; }
    if (startPanel) { startPanel.remove(); startPanel = null; }
    setBusy(true); sugg.hidden = true; timer.poke();
    if (text && !hidden) {
      row.messages.push({ role: 'user', text }); list.append(h('div.msg.me', text));
      ta.value = ''; grow(); lsSet(draftKey(), '');
      pinned = true;
    }
    // службова репліка застосунку (напр. «Простіше»): іде в історію для моделі, але не показується і не є англійською учня
    if (text && hidden) row.messages.push({ role: 'user', text, hidden: true });
    const bubble = h('div.msg.ai.pending', h('span.typing', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span.sr-only', 'Вчитель пише…'));
    list.append(bubble); follow();
    const ac = new AbortController();
    streams.add(ac); current = ac;
    // сторож: якщо від сервера нічого не приходить 45 с — перериваємо (зависле з'єднання на мобільному)
    let lastData = Date.now();
    const watchdog = setInterval(() => { if (!done && Date.now() - lastData > 45000) ac.abort('timeout'); }, 5000);
    let done = false, msg = null, els = null, meta = null, metaDone = false;
    // відповідь готова (подія end нового сервера або кінець потоку): показуємо її й розблоковуємо ввід, meta може прийти згодом
    const finalize = (full) => {
      if (done) return;
      const parsed = parseReply(full);
      if (!parsed.body.trim()) return;
      done = true;
      streams.delete(ac);   // відповідь уже є: вихід зі сторінки не скасовує meta (пам'ять, слова)
      msg = { role: 'model', text: parsed.body, fixes: parsed.fixes };
      if (kind) msg.kind = kind;
      row.messages.push(msg);
      els = renderModel(msg);
      bubble.replaceWith(...els);
      persist();
      setBusy(false); current = null;
      setSuggestions([]);
      follow();
      afterReply();
    };
    const applyMeta = () => {
      if (!msg || !meta || metaDone) return;
      metaDone = true;
      const bub = els[els.length - 1];
      if (meta.words.length) {
        msg.words = meta.words; persist();
        bub.insertBefore(wordsBlock(msg.words), bub.querySelector('.msg-acts'));
      }
      if (meta.plan.length && !row.meta.plan) { row.meta.plan = meta.plan; persist(); showPlan(); }
      if (meta.memory.length && user()) {
        const added = rememberFacts(meta.memory);
        if (added.length && !cleaned) bub.after(memNote(added));
      }
      if (cleaned) return;   // учень уже пішов зі сторінки — без підказок і прокрутки
      // підказки — лише якщо учень ще не пішов далі
      if (!busy && row.messages[row.messages.length - 1] === msg) setSuggestions(meta.suggestions);
      follow();
    };
    try {
      const extraP = coach ? { section, coachDigest: await coachDigest() } : {};
      const payload = { ...extraP, mode: row.mode, scenario: row.scenario, scenarioData: scenario || null, drillType: row.meta?.type, topic, messages: row.messages.map(m => (m.hidden ? { role: m.role, text: m.text, cue: true } : { role: m.role, text: m.text })) };
      let lastPaint = 0, body = null;
      const full = await tutorStream(payload, (acc) => {
        lastData = Date.now();
        if (done) return;
        const now = performance.now();
        if (now - lastPaint < 60) return; lastPaint = now;
        const b = parseReply(acc).body;
        if (!b.trim()) return;
        if (!body) { body = h('div.msg-body', { 'aria-hidden': 'true' }); bubble.classList.remove('pending'); bubble.replaceChildren(body, h('span.typing.inline', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))); }
        body.replaceChildren(md(b));
        follow();
      }, { signal: ac.signal, onEnd: finalize, onMeta: (x) => { meta = cleanMeta(x); applyMeta(); } });
      finalize(full);
      if (!done) throw new AiError('empty', S.err.aiFailed);
      applyMeta();
    } catch (e) {
      if (done) return;   // збій уже після відповіді (очікування meta) — відповідь лишається
      if (text && hidden) row.messages.pop();
      const why = ac.signal.reason === 'stop' ? 'Відповідь зупинено.' : ac.signal.reason === 'timeout' ? 'Вчитель не відповідає — перевірте з\'єднання і спробуйте ще раз.' : (aiErrorText(e) || 'Скасовано');
      bubble.replaceWith(h('div.msg.sys', why));
    } finally {
      clearInterval(watchdog);
      streams.delete(ac);
      if (current === ac) current = null;
      if (!done) { setBusy(false); setSuggestions(suggestions); }
    }
  }

  function memNote(added) {
    const note = h('div.mem-note', { role: 'status' }, ic('brain', { size: 14 }),
      h('span.grow', h('span.dim', 'Запам\'ятав: '), added.map(a => a.text).join('; ')));
    note.append(h('button.mem-undo', { type: 'button', onclick: () => { undoRemember(added); note.replaceChildren(ic('brain', { size: 14 }), h('span.grow.dim', 'Гаразд, не запам\'ятовую.')); } }, 'Скасувати'));
    return note;
  }

  function simpler(text) {
    send(`(App cue — the student tapped «Simpler» under this message of yours: «${text.slice(0, 900)}». Say the same again in simpler English: shorter sentences, everyday words, one idea at a time. Keep the meaning; keep any question you asked. This cue is not the student's English — no corrections block.)`, { hidden: true, kind: 'simpler' });
  }

  async function hint() {
    if (busy) return;
    if (!user()) { toast(S.err.needLogin); return; }
    hintBtn.disabled = true; hintBtn.replaceChildren(ic('lightbulb', { size: 16 }), 'Думаю…');
    try {
      const r = await tutor('hint', { messages: row.messages.filter(m => !m.hidden).map(m => ({ role: m.role, text: m.text })) });
      const opts = parseHint(r.text);
      if (!opts.length) throw new AiError('empty', S.err.aiFailed);
      setSuggestions(opts);
    } catch (e) { toast(aiErrorText(e) || S.err.generic, { kind: 'bad' }); }
    finally { hintBtn.disabled = false; hintBtn.replaceChildren(ic('lightbulb', { size: 16 }), 'Підказка'); }
  }

  function afterReply() {
    // кнопка вправ у режимах «Поясни» і «Слабке місце»
    if ((row.mode === 'explain' || row.mode === 'drill') && !extra.firstChild && row.messages.filter(m => m.role === 'model').length >= 1) {
      extra.append(tx({ icon: 'lightning', wide: true, onclick: practice, label: row.mode === 'drill' ? '10 вправ на цю тему' : '5 вправ на це правило', sub: 'Вчитель складе вправи за цією розмовою' }));
    }
  }

  async function practice() {
    const n = row.mode === 'drill' ? 10 : 5;
    extra.replaceChildren(h('div.card.center.dim', 'Вчитель готує вправи…'));
    try {
      const topicText = row.mode === 'drill' ? (S.mistakeTypes[row.meta?.type] || row.meta?.type) : row.messages.find(m => m.role === 'user' && !m.hidden)?.text;
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
    finally { micBtn.classList.remove('active'); ta.placeholder = PH; }
  }

  async function finish() {
    const userTurns = row.messages.filter(m => m.role === 'user' && !m.hidden).length;
    cleanup();
    if (coach) { go('/analysis', { replace: true }); return; }
    if (userTurns < 1) { go('/tutor', { replace: true }); return; }
    await summarize(view, row);
  }

  let cleaned = false;
  function cleanup() {
    if (cleaned) return; cleaned = true;
    streams.forEach(c => c.abort());
    stopSpeech();
    window.removeEventListener('scroll', onScroll);
    vv?.removeEventListener('resize', onVV); vv?.removeEventListener('scroll', onVV);
    document.body.classList.remove('kb-open'); document.body.style.removeProperty('--kb');
    if (saved()) timer.setRef(row.id);
    const s = timer.stop();
    row.seconds = (row.seconds || 0) + (s?.seconds || 0);
    persist();
  }

  // ---------- старт ----------
  function begin(t) {
    if (t) {
      topic = t.topic; row.meta.topic = t.topic; row.meta.topicLabel = t.label;
      row.title = `Розмова: ${t.label}`; setTitle(row.title);
      const sub = view.querySelector('.tutor-head .xs.dim'); if (sub) sub.textContent = t.label;
    }
    send('', { hidden: true });
  }
  function buildStart() {
    const prev = store.all('tutor_chats').filter(c => c.mode === 'chat' && c.messages?.some(m => m.role === 'user' && !m.hidden))
      .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0];
    const focus = store.prof().lastFocus;
    const ideas = topicIdeas();
    return h('div.stack-lg.tutor-start.tu-start',
      txGroup('Про що поговоримо?', txGrid([MISTAKES_TOPIC, ...ideas].map(t => tx({ icon: topicIcon(t), label: t.label, cls: 'tu-topic', onclick: () => begin(t) })))),
      focus ? txGroup('Порада з минулого разу', tx({ icon: 'target', label: focus, wide: true, cls: 'start-focus', onclick: () => begin(focusTopic(focus)) })) : null,
      txPrimary({ icon: 'sparkle', label: 'Нехай вчитель почне', sub: 'Або просто напишіть перше повідомлення внизу', onclick: () => begin(null) }),
      prev ? txRows([txRow({ icon: 'arrow-clockwise', label: 'Продовжити минулу розмову', sub: `${prev.title || 'Розмова'} · ${fmtDay(prev.updated_at || prev.created_at)}`, href: `#/tutor?chat=${encodeURIComponent(prev.id)}`, cls: 'start-prev' })]) : null);
  }
  if (coach && !resumed) {
    list.append(...renderModel({ role: 'model', text: COACH_INTRO[section] }, { actions: false }));
    if (user()) setSuggestions(COACH_STARTERS[section]);
  } else if (!resumed && user()) {
    if (ask) send(`Please explain the word or phrase "${ask}": meaning, how and when to use it in everyday situations, 3 natural examples, common collocations and mistakes Ukrainian speakers make with it.`);
    else if (row.mode === 'explain') list.append(...renderModel({ role: 'model', text: 'Що пояснити? Наприклад: **Чим Present Perfect відрізняється від Past Simple?** Напишіть питання українською або англійською.' }, { actions: false }));
    else if (row.mode === 'chat' && !topic) { startPanel = buildStart(); list.before(startPanel); }
    else send('', { hidden: true });
  }
  return cleanup;
}

// ---------- Підсумок сесії ----------
// Підсумок рахує Pro-модель — до хвилини: текст очікування змінюється, щоб екран не здавався завислим
const SUMMARY_STEPS = ['Перечитую розмову…', 'Перевіряю ваші репліки…', 'Шукаю помилки, які повторюються…', 'Оцінюю рівень за критеріями CEFR…', 'Добираю нові слова…', 'Готую пораду на наступний раз…', 'Майже готово — докладний розбір займає до хвилини…'];
const SPEECH_KEYS = ['words', 'speech_sec', 'wpm', 'avg_len', 'repeats', 'fillers', 'unique_ratio', 'turns'];

/** opts.voice — голосова сесія; opts.pronTurns — репліки з аудіо для оцінки вимови (лише одразу після голосу, у пам'яті) */
export async function summarize(view, row, { voice = false, pronTurns = null } = {}) {
  setFocus(false);
  const stepEl = h('p.dim.small.sum-wait', { 'aria-live': 'polite' }, SUMMARY_STEPS[0]);
  view.replaceChildren(h('div.hero', emo('hourglass', 'xl'), h('h2', 'Вчитель готує підсумок…'), stepEl,
    h('div.sum-wait-bar', { 'aria-hidden': 'true' }, h('i'))));
  let step = 0;
  const tick = setInterval(() => {
    if (!stepEl.isConnected) { clearInterval(tick); return; }
    step = Math.min(SUMMARY_STEPS.length - 1, step + 1);
    stepEl.textContent = SUMMARY_STEPS[step];
  }, 8000);
  try {
    const prev = row.summary || null;
    const payload = { mode: row.mode, messages: (row.messages || []).filter(m => !m.hidden).map(m => ({ role: m.role, text: m.text })) };
    // виправлення, вже показані під час розмови (картки в чаті, підказки під репліками в голосі), — сервер гарантує їх у підсумку
    const turnFixes = (row.messages || []).flatMap(m => (Array.isArray(m.fixes) ? m.fixes : [])).filter(f => f?.wrong && f?.right)
      .map(f => ({ wrong: f.wrong, right: f.right, why: f.why || f.why_uk || '' })).slice(0, 30);
    if (turnFixes.length) payload.turn_fixes = turnFixes;
    // метрики мовлення голосової сесії (рахує voice.js); без виміряного часу мовлення (режим «рація») — не надсилаємо
    const sp = prev?.speech;
    if (row.mode === 'voice' && sp?.words && sp.speech_sec >= 5) payload.speech = Object.fromEntries(SPEECH_KEYS.map(k => [k, Number(sp[k]) || 0]));
    const res = await tutor('summary', payload);
    // повторний підсумок продовженої розмови (і помилки, вже додані з виправлень) не зараховуються вдруге
    const prevList = prev?.mistakes || [];
    const before = new Set(prevList.map(mkey));
    const mistakes = [...(res.mistakes || [])];
    // помилки, додані з карток виправлень, лишаються в списку розмови (для deleteChat)
    for (const m of prevList) if (!mistakes.some(x => mkey(x) === mkey(m))) mistakes.push(m);
    // засвоєні помилки: правильне вживання зараховується один раз на розмову (повторний підсумок не рахує вдруге)
    const applied = new Set(Array.isArray(prev?.mastered_applied) ? prev.mastered_applied : []);
    const mastered = [...new Set((Array.isArray(res.mastered) ? res.mastered : []).map(String))].slice(0, 5);
    for (const id of mastered) {
      if (applied.has(id)) continue;
      const m = store.get('mistakes', id);
      if (!m || m.deleted) continue;
      if (!m.resolved) mistakeHit(m, true);
      applied.add(id);
      // правильне вживання правила зараховується й іншим відкритим помилкам цього правила
      const done = new Set([...applied]);
      ruleHit(m.rule, done);
      for (const x of done) applied.add(x);
    }
    const next = { ...res, mistakes, mastered };
    if (applied.size) next.mastered_applied = [...applied];
    if (prev?.speech) next.speech = prev.speech;
    // запис репліки міг завантажитись раніше за підсумок (або завантажиться пізніше — voice.js допише сам)
    if (row.summary?.clip) next.clip = row.summary.clip;
    // слова, вже додані автоматично попереднім підсумком цієї розмови, — лишаються за нею
    if (Array.isArray(prev?.auto_words)) next.auto_words = prev.auto_words;
    row.summary = next;
    await autoAddWords(row).catch(e => console.warn('auto words', e));
    if (Array.isArray(prev?.used_known)) next.used_known = prev.used_known;
    store.put('tutor_chats', row);
    // слова, які учень правильно вжив і в цій, і в попередніх розмовах, — «вивчено» (js/usage.js)
    const used = await markUsedWords({ onlyChat: row.id }).catch(e => { console.warn('used words', e); return []; });
    if (used.length) { row.summary.used_known = [...(row.summary.used_known || []), ...used.map(u => ({ id: u.id, en: u.en, uk: u.uk }))]; store.put('tutor_chats', row); }
    for (const m of res.mistakes || []) if (!before.has(mkey(m))) addMistake({ ...m, source: 'tutor', ref: row.id });
    store.setProf({ lastFocus: res.next_focus || null });
    // новий сервер повертає й факти про учня з усієї розмови
    if (Array.isArray(res.memory) && res.memory.length) rememberFacts(res.memory);
  } catch (e) {
    view.replaceChildren(h('div.hero', emo('warning', 'xl'), h('p', aiErrorText(e) || S.err.generic),
      h('div.row', h('a.btn.soft', { href: '#/tutor' }, 'До вчителя'), h('button.btn.primary', { type: 'button', onclick: () => summarize(view, row, { voice, pronTurns }) }, 'Спробувати ще раз'))));
    return;
  } finally { clearInterval(tick); }
  return summaryView(view, row, { pronTurns });
}

/** Плитка-дія, яку можна перемалювати (іконка, назва, підпис) — кнопки підсумку змінюють стан після дотику */
function repaintTx(el, icon, label, sub = '') {
  el.querySelector('.tx-sq')?.replaceChildren(ic(icon, { size: 20 }));
  const l = el.querySelector('.tx-l'); if (l) l.textContent = label;
  const s = el.querySelector('.tx-s'); if (s) { s.textContent = sub; s.hidden = !sub; }
}
/** Кнопка «прослухати» у квадратику рядка-плитки */
const sayBtn = (en) => h('button.tx-sq.tu-say', { type: 'button', 'aria-label': `Прослухати: ${en}`, onclick: () => speak(en) }, ic('speaker-high', { size: 18 }));
const fixLine = (m) => h('div.fix-line', h('s.bad', m.wrong), h('span.arrow', { 'aria-label': 'правильно:' }, ' → '), h('b.good', m.right));
const note = (...kids) => h('p.tu-note', ...kids);

/** Слова, які вчитель позначив вивченими: учень правильно вжив їх у цій і попередніх розмовах */
function usedKnownCard(s) {
  const list = (Array.isArray(s.used_known) ? s.used_known : []).filter(u => u?.id);
  if (!list.length) return null;
  const chip = (u) => {
    const b = h('button.chip', { type: 'button' });
    const paint = () => {
      const c = store.get('cards', u.id);
      const on = !!c && srs.isLearned(c);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? `${u.en} — вивчено. Повернути до вивчення` : `${u.en} — повернуто до вивчення`);
      b.replaceChildren(ic(on ? 'check-circle' : 'arrow-clockwise', { size: 14, fill: on }), h('b', u.en), u.uk ? h('span.dim', ` · ${u.uk}`) : null);
    };
    b.addEventListener('click', () => {
      const c = store.get('cards', u.id);
      if (!c) return;
      if (srs.isLearned(c)) { srs.relearn(c); toast(`«${u.en}» повернуто до вивчення`); }
      else { srs.markKnown(c, { source: 'usage' }); toast(`«${u.en}» — знову вивчено`); }
      paint();
    });
    paint();
    return b;
  };
  return txGroup(`Ви вже вживаєте ці слова · ${list.length}`, h('div.tu-panel.stack',
    h('div.tu-mhead', h('span.tx-sq.tu-good', ic('seal-check', { size: 20 })),
      h('span.tx-s', `Правильно вжито щонайменше у ${MIN_CHATS} розмовах — позначено вивченими в словнику. Якщо слово ще непевне — торкніться, щоб повернути до вивчення.`)),
    h('div.chips.used-chips', list.map(chip))));
}

export function summaryView(view, row, { pronTurns = null } = {}) {
  const s = row.summary;
  if (!s || s.partial) {
    view.replaceChildren(h('div.hero', h('p', 'Підсумку ще немає.'), h('button.btn.primary', { type: 'button', onclick: () => summarize(view, row, { voice: row.mode === 'voice' }) }, 'Зробити підсумок')));
    return;
  }
  const words = (s.new_words || []).filter(w => w?.en);
  const mistakes = s.mistakes || [];
  const turns = (row.messages || []).filter(m => m.role === 'user' && !m.hidden).length;
  // слова, додані автоматично (summary.auto_words): «Прибрати» видаляє лише ці картки
  const autoList = Array.isArray(s.auto_words) ? s.auto_words : [];
  const autoOf = (w) => autoList.find(a => wnorm(a.en) === wnorm(w.en));
  const autoLive = (a) => !!(a && !a.removed && store.get('cards', a.id));
  const addAll = tx({ icon: 'plus', label: ' ', sub: ' ', wide: true, cls: 'sum-addall', onclick: async () => {
    addAll.disabled = true;
    let n = 0;
    for (const w of words) if (!wordKnown(w.en)) { const r = await addWord(w).catch(() => 'error'); if (r === 'created' || r === 'starter') n++; }
    toast(n ? `Додано в картки: ${n}` : 'Ці слова вже є в картках');
    wordsBox.replaceChildren(...words.map(wordRow));
    paintAll();
  } });
  const autoNote = h('div.tx-row.sum-auto');
  const trainBtn = tx({ icon: 'play', label: 'Повторити зараз', sub: 'нові слова — у тренуванні слів', wide: true, href: '#/cards/train', cls: 'sum-train' });
  const paintAll = () => {
    const left = words.filter(w => !wordKnown(w.en)).length;
    const nAuto = autoList.filter(autoLive).length;
    addAll.hidden = !!nAuto && !left;
    addAll.disabled = !left;
    repaintTx(addAll, left ? 'plus' : 'check', left ? (left === words.length ? `Додати всі в картки (${left})` : `Додати решту в картки (${left})`) : 'Усі слова вже в картках');
    autoNote.hidden = !nAuto;
    autoNote.replaceChildren(h('span.tx-sq.tu-accent', ic('sparkle', { size: 18, fill: true })),
      h('div.tx-body', h('span.tx-l.sum-auto-t', `Додано в картки автоматично: ${nAuto}`),
        h('span.tx-s', 'З\'являться серед нових у тренуванні слів. Зайве — «Прибрати».')));
    trainBtn.hidden = !nAuto;
  };
  /** Прибрати автододане слово: м'яке видалення лише картки, створеної автододаванням */
  const removeAuto = (a, w) => {
    const card = store.get('cards', a.id);
    if (card && (card.tags || []).includes('auto')) store.remove('cards', a.id);
    a.removed = true;
    store.put('tutor_chats', row);
    toast(`Прибрано з карток: ${w.en}`);
    wordsBox.replaceChildren(...words.map(wordRow));
    paintAll();
  };
  const wordRow = (w) => {
    const a = autoOf(w);
    const auto = autoLive(a);
    return h('div.tx-row.sum-word' + (auto ? '.is-auto' : ''),
      sayBtn(w.en),
      h('div.tx-body', h('span.tx-l', h('b', { lang: 'en' }, w.en), ' — ', w.uk), w.example ? h('span.tx-s', { lang: 'en' }, w.example) : null),
      auto
        ? h('button.btn.sm.ghost.sum-unadd', { type: 'button', 'aria-label': `Прибрати з карток: ${w.en}`, onclick: () => removeAuto(a, w) }, 'Прибрати')
        : (() => {
          const on = wordKnown(w.en);
          const b = h('button.icon-btn' + (on ? '' : '.soft'), { type: 'button', disabled: on, 'aria-label': on ? `${w.en} — уже в картках` : `Додати в картки: ${w.en}` }, ic(on ? 'check' : 'plus', { size: 18 }));
          b.addEventListener('click', async () => { b.disabled = true; const r = await addWord(w).catch(() => 'error'); toast(r === 'error' ? 'Не вдалося додати слово' : r === 'exists' ? 'Таке слово вже є в картках' : `Додано в картки: ${w.en}`); wordsBox.replaceChildren(...words.map(wordRow)); paintAll(); });
          return b;
        })());
  };
  const wordsBox = h('div.tx-rows', words.map(wordRow));
  paintAll();
  // найчастіший тип помилок розмови → міні-урок на нього
  const byType = {};
  for (const m of mistakes) if (m.type && m.type !== 'other' && S.mistakeTypes[m.type]) byType[m.type] = (byType[m.type] || 0) + 1;
  const topType = Object.keys(byType).sort((a, b) => byType[b] - byType[a])[0];

  const min = Math.round((row.seconds || 0) / 60);
  const kpis = txKpis([
    s.level_signal ? { value: levelLabel(s), label: 'рівень у розмові', tone: 'accent' } : { value: turns, label: plural(turns, 'репліка', 'репліки', 'реплік') },
    { value: min || '<1', unit: 'хв', label: 'тривалість', ariaLabel: `Тривалість: ${fmtMin(row.seconds || 0)}` },
    { value: mistakes.length, label: plural(mistakes.length, 'помилка', 'помилки', 'помилок'), tone: mistakes.length ? 'warn' : 'good' },
  ]);
  const mistakeActs = [
    tx({ icon: 'warning-circle', label: 'Мої помилки', sub: 'усі помилки й правила', href: '#/mistakes' }),
    topType ? tx({ icon: 'target', label: 'Міні-урок', sub: S.mistakeTypes[topType] || topType, href: `#/tutor?mode=drill&type=${encodeURIComponent(topType)}` }) : null,
  ].filter(Boolean);
  if (mistakeActs.length === 1) mistakeActs[0].classList.add('wide', 'full');
  const nextHref = s.next_focus ? `#/tutor?mode=chat&topic=${encodeURIComponent(`Focus recommended after the last session (practise it naturally in conversation): ${s.next_focus}`)}` : null;

  view.replaceChildren(h('div.stack-lg.tutor-summary',
    h('div.tu-sumhead', h('span.tx-sq', ic('sparkle', { size: 26, fill: true })),
      h('div.tx-body', h('h1.tu-sumh1', 'Підсумок розмови'),
        h('span.tx-s', [row.title || '', s.level_signal && turns ? `${turns} ${plural(turns, 'репліка', 'репліки', 'реплік')}` : ''].filter(Boolean).join(' · ')))),
    kpis,
    assessmentCard(s),
    s.summary || s.practised_words?.length ? txGroup('Що ви практикували', h('div.tu-panel.stack', s.summary ? h('div.tu-md', md(s.summary)) : null,
      s.practised_words?.length ? h('div.stack', { style: { gap: '6px' } }, h('div.xs.dim', 'Слова, які ви вчите й ужили в розмові'), h('div.chips', s.practised_words.map(w => h('span.tag.good', { lang: 'en' }, w)))) : null,
      s.focus_review ? h('div.small', h('b', 'Фокус заняття: '), mdInline(s.focus_review)) : null)) : null,
    mistakes.length ? txGroup(`Помилки · ${mistakes.length}`, [
      txRows(mistakes.map((m, i) => h('div.tx-row.sum-mistake',
        h('span.tx-no', String(i + 1)),
        h('div.tx-body', fixLine(m),
          m.explanation_uk ? h('span.tx-s', mdInline(m.explanation_uk)) : null,
          h('div.row.wrap.sum-mistake-foot',
            ruleLabel(m.rule) && m.rule !== 'other' ? txPill(ruleLabel(m.rule)) : m.type && S.mistakeTypes[m.type] ? txPill(S.mistakeTypes[m.type]) : null,
            disagreeBtn(m, row, () => summaryView(view, row, { pronTurns }))))))),
      txGrid(mistakeActs, 2)])
      : tx({ icon: 'check-circle', tone: 'good', wide: true, label: 'Помилок не помічено', sub: 'Так тримати!' }),
    masteredCard(s),
    usedKnownCard(s),
    row.mode === 'voice' ? speechCard(s) : null,
    pronTurns?.length ? pronCard(pronTurns) : null,
    words.length ? txGroup(`Нові слова · ${words.length}`, [autoNote, wordsBox,
      s.auto_limit && words.some(w => !wordKnown(w.en)) ? note(`Сьогодні вже додано ${AUTO_PER_DAY} слів автоматично — решту можна додати вручну.`) : null,
      trainBtn, addAll]) : null,
    phrasesCard(row, s),
    nextHref ? txGroup('Наступного разу', txPrimary({ icon: 'arrow-right', label: 'Почати з цього', sub: s.next_focus, href: nextHref })) : null,
    // головна дія — «Почати з цього»; без поради на наступний раз — «Нова розмова»
    ...(nextHref ? [txGrid([tx({ icon: 'house', label: 'На головну', href: '#/' }), tx({ icon: 'chat-circle-dots', label: 'Нова розмова', href: '#/tutor' })], 2)]
      : [txPrimary({ icon: 'chat-circle-dots', label: 'Нова розмова', href: '#/tutor' }), tx({ icon: 'house', label: 'На головну', href: '#/', wide: true })]),
    deleteButton(row)));
}

/** «Фрази з розмови»: виправлені фрагменти (≥ 2 слів) і нові вирази — у фразник */
function phrasesCard(row, s) {
  const words2 = (t) => String(t || '').trim().split(/\s+/).filter(w => /[a-z]/i.test(w)).length >= 2;
  const seen = new Set();
  const items = [
    ...(s.mistakes || []).filter(m => words2(m.right)).map(m => ({ en: String(m.right).trim(), uk: '', from: 'fix' })),
    ...(s.new_words || []).filter(w => w?.en && words2(w.en)).map(w => ({ en: String(w.en).trim(), uk: String(w.uk || '').trim(), from: 'word' })),
  ].filter(x => { const k = x.en.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, ''); return !seen.has(k) && seen.add(k); }).slice(0, 12);
  if (!items.length) return null;
  const scen = row.scenario ? row.title : '';
  const sit = guessSituation([row.meta?.mission?.title, row.meta?.mission?.situation, scen, row.meta?.topicLabel, row.meta?.topic, row.title].filter(Boolean).join(' '));
  const all = tx({ icon: 'plus', label: ' ', wide: true, cls: 'sum-phall', onclick: async () => {
    paintAll(true);
    const r = await savePhrases(items.filter(x => !hasPhrase(x.en)), { situation: sit, source: 'summary' }).catch(() => null);
    phraseSaved(r, sit);
    list.replaceChildren(...items.map(pick));
    paintAll();
  } });
  const paintAll = (busy = false) => {
    const left = items.filter(x => !hasPhrase(x.en)).length;
    all.disabled = busy || !left;
    repaintTx(all, busy ? 'hourglass' : left ? 'plus' : 'check', busy ? 'Зберігаю…' : left ? `Зберегти всі${left < items.length ? ' решту' : ''} (${left})` : 'Усі фрази у фразнику');
  };
  const pick = (x) => {
    const on = hasPhrase(x.en);
    const b = h('button.icon-btn' + (on ? '' : '.soft'), { type: 'button', disabled: on, 'aria-label': on ? `${x.en} — уже у фразнику` : `У фразник: ${x.en}` }, ic(on ? 'check' : 'plus', { size: 18 }));
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await savePhrases([x], { situation: sit, source: 'summary' }).catch(() => null);
      phraseSaved(r, sit);
      el.replaceWith(pick(x));
      paintAll();
    });
    const el = h('div.tx-row.ph-pick', sayBtn(x.en),
      h('div.tx-body', h('span.tx-l', { lang: 'en' }, x.en), x.uk ? h('span.tx-s', x.uk) : x.from === 'fix' ? h('span.tx-s', 'виправлений варіант') : null), b);
    return el;
  };
  const list = h('div.tx-rows', items.map(pick));
  paintAll();
  return txGroup(`Фрази з розмови · ${items.length}`, [
    note('Збережіть у фразник, щоб сказати правильно наступного разу. Ситуація: ', h('b', phraseSit(sit).uk)), list, all]);
}

/** «Засвоєно»: помилки, які учень цього разу вжив правильно (3 рази поспіль — закрито) */
function masteredCard(s) {
  const items = (Array.isArray(s.mastered) ? s.mastered : []).map(id => store.get('mistakes', String(id))).filter(m => m && !m.deleted);
  if (!items.length) return null;
  return txGroup(`Засвоєно · ${items.length}`, [note('Цього разу ви сказали правильно те, що раніше було помилкою.'),
    txRows(items.map(m => {
      const n = Math.min(3, m.streak || 0);
      return h('div.tx-row.sum-mastered-row', h('span.tx-sq.tu-good', ic('check-circle', { size: 18 })),
        h('div.tx-body', fixLine(m)),
        m.resolved ? txPill('закрито', 'good') : h('span.tu-dots', { role: 'img', 'aria-label': `Правильно поспіль: ${n} з 3` }, txDots(n)));
    }))]);
}

/** Метрики мовлення голосової сесії + порада з плавності */
function speechCard(s) {
  const sp = s.speech;
  const tip = String(s.fluency_tip_uk || '').trim();
  if (!sp?.words && !tip) return null;
  const stats = sp?.words ? [
    sp.wpm > 0 ? { value: String(sp.wpm), label: 'темп, слів/хв' } : null,
    { value: String(sp.avg_len), label: 'середня репліка, слів' },
    { value: String(sp.repeats || 0), label: 'повтори («I I»)', tone: sp.repeats > 5 ? 'warn' : '' },
    { value: `${Math.round((sp.unique_ratio || 0) * 100)}%`, label: 'різноманітність словника' },
  ].filter(Boolean) : [];
  return txGroup('Як ви говорили', [
    stats.length ? txKpis(stats, 2) : null,
    sp?.words ? note(`${sp.words} ${plural(sp.words, 'слово', 'слова', 'слів')} за ${sp.turns} ${plural(sp.turns, 'репліку', 'репліки', 'реплік')}${sp.fillers ? ` · «е-е»: ${sp.fillers}` : ''}. Для тих, хто вчить мову, типово 60–110 слів/хв, вільне мовлення — 120–160.`) : null,
    tip ? h('div.tx-row.sum-tip', h('span.tx-sq.tu-accent', ic('lightbulb', { size: 18 })), h('div.tx-body', h('span.tx-l', 'Порада з плавності'), h('span.tx-s', mdInline(tip)))) : null]);
}

/** Вимова у вашій розмові: AI-оцінка кількох реплік (кожна — 1 запит AI, тому за кнопкою) */
function pronCard(turns) {
  let player = null;
  const play = (t) => {
    // власний запис репліки: WAV у пам'яті → тимчасове посилання (звільняється після відтворення)
    let url;
    try {
      const bin = atob(t.audio), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      url = URL.createObjectURL(new Blob([u8], { type: 'audio/wav' }));
    } catch { return; }
    stopSpeech();
    try { player?.pause(); } catch { /* */ }
    const a = player = new Audio(url);
    const free = () => URL.revokeObjectURL(url);
    a.addEventListener('ended', free, { once: true }); a.addEventListener('error', free, { once: true }); a.addEventListener('pause', free, { once: true });
    a.play().catch(free);
  };
  const rows = turns.map(t => {
    const out = h('div', { 'aria-live': 'polite' });
    const el = h('div.tu-panel.pron-turn',
      h('div.tu-mhead', h('button.tx-sq.tu-say', { type: 'button', 'aria-label': 'Прослухати свій запис', onclick: () => play(t) }, ic('play', { size: 18 })),
        h('div.grow.small', { lang: 'en' }, `«${t.text}»`)),
      out);
    return { t, out, el };
  });
  const btn = tx({ icon: 'waveform', wide: true, label: `Перевірити вимову (${turns.length} ${plural(turns.length, 'репліка', 'репліки', 'реплік')})`, sub: 'по одному запиту AI на репліку', onclick: async () => {
    if (!user()) { toast(S.err.needLogin); return; }
    btn.disabled = true;
    repaintTx(btn, 'hourglass', 'Оцінюю вимову…');
    let renderAssessment = null;
    try { ({ renderAssessment } = await import('./pronunciation.js')); } catch { /* компактний запасний вигляд нижче */ }
    let failed = 0;
    for (const r of rows) {
      if (r.done) continue;
      r.out.replaceChildren(h('div.xs.dim', 'Оцінюю…'));
      try {
        const res = await pron('assess', { text: r.t.text, audio: r.t.audio, mime: 'audio/wav', accent: store.settings().accent === 'US' ? 'US' : 'UK' });
        r.done = true;
        r.out.replaceChildren(renderAssessment ? renderAssessment(res, { compact: true }) : h('div.small', h('b', `${res.score}/100`),
          (res.words || []).filter(w => w.status !== 'ok').length ? ` · слова: ${(res.words || []).filter(w => w.status !== 'ok').map(w => w.word).join(', ')}` : ''));
      } catch (e) {
        failed++;
        r.out.replaceChildren(h('div.xs', { style: { color: 'var(--bad)' } }, aiErrorText(e) || 'Не вдалося оцінити вимову.'));
        if (e?.code === 'quota' || e?.code === 'need_login' || e?.code === 'offline') break;
      }
    }
    if (failed) { btn.disabled = false; repaintTx(btn, 'arrow-clockwise', 'Спробувати ще раз'); }
    else btn.replaceWith(tx({ icon: 'waveform', wide: true, label: 'Тренувати вимову', sub: 'звуки й фрази', href: '#/pronunciation' }));
  } });
  return txGroup('Вимова у вашій розмові', [
    note('Кілька ваших найдовших реплік з цієї розмови. AI оцінить вимову кожного слова.'),
    h('div.tx-rows.sum-pron', rows.map(r => r.el)), btn]);
}

/** «Не згоден»: вчитель більше так не виправлятиме, помилка зникає зі статистики */
function disagreeBtn(f, row, onDone) {
  return h('button.btn.sm.ghost.disagree', { type: 'button', title: 'Вчитель помилився — більше так не виправлятиме', onclick: () => {
    disputeFix(f, row);
    toast('Зрозумів: це виправлення більше не з\'явиться');
    onDone?.();
  } }, ic('x-circle', { size: 14 }), 'Не згоден');
}

const CRIT_UK = { range: 'Словник і граматика', accuracy: 'Точність', fluency: 'Плавність', interaction: 'Взаємодія', coherence: 'Зв\'язність' };
const SUB_UK = { low: 'нижня межа', mid: 'середина рівня', high: 'верхня межа' };
const CONF_UK = { low: 'приблизна оцінка', medium: 'досить упевнено', high: 'упевнено' };
function levelLabel(s) {
  const a = s.level_assessment;
  return a && a.sublevel === 'high' ? `${s.level_signal}+` : s.level_signal;
}
/** Чому саме такий рівень: критерії CEFR з прикладами з розмови */
function assessmentCard(s) {
  const a = s.level_assessment;
  if (!s.level_signal || !a) return null;
  // загальний рівень за останніми розмовами (зважено за обсягом мовлення й упевненістю) — стабільніший за одну розмову
  const rolling = h('div.tx-row.rolling-level', { hidden: true });
  import('../analysis.js').then(({ conversationLevel }) => {
    const r = conversationLevel();
    if (!r || r.sessions < 2 || !rolling.isConnected) return;
    rolling.hidden = false;
    rolling.replaceChildren(h('span.tx-no.tu-lvl', `${r.level}${r.sublevel === 'high' ? '+' : ''}`),
      h('div.tx-body', h('span.tx-l', 'Ваш рівень у розмовах'), h('span.tx-s', `за останніми ${r.sessions} ${plural(r.sessions, 'розмовою', 'розмовами', 'розмовами')} · ${SUB_UK[r.sublevel]}, ${CONF_UK[r.confidence]}`)));
  }).catch(() => {});
  return txGroup(`Оцінка рівня · ${levelLabel(s)}`, [
    h('div.tu-panel.stack.tu-assess',
      h('div.tu-mhead', h('span.tx-no.tu-lvl', levelLabel(s)),
        h('div.tx-body', h('span.tx-l', 'Ця розмова'), h('span.tx-s', `${SUB_UK[a.sublevel] || ''}${a.enough_data ? '' : ' · замало мовлення для точної оцінки — поговоріть довше'}`)),
        CONF_UK[a.confidence] ? txPill(CONF_UK[a.confidence], a.confidence === 'low' ? 'warn' : '') : null),
      a.criteria.length ? h('div.tu-crit', a.criteria.map(c => h('div.tu-crit-row',
        h('span.tx-no', c.level),
        h('div.tx-body', h('span.tx-l', CRIT_UK[c.name] || c.name), c.note_uk ? h('span.tx-s', mdInline(c.note_uk)) : null)))) : null,
      a.reasons_uk.length ? h('div.stack', { style: { gap: '4px' } }, h('div.tx-label', 'Чому так'), h('ul.small.tu-ul', a.reasons_uk.map(r => h('li', mdInline(r))))) : null,
      a.to_next_uk ? h('div.small', h('b', 'До наступного рівня: '), mdInline(a.to_next_uk)) : null),
    rolling]);
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
  ['email', 'Лист'], ['teams', 'Повідомлення в месенджері'], ['report', 'Звіт (робочий)'], ['other', 'Інше'],
];
function checkMode(view, q) {
  let draft = '';
  try { draft = sessionStorage.getItem('me:draft') || ''; sessionStorage.removeItem('me:draft'); } catch { /* приватний режим */ }
  let kind = q.kind || 'email';
  const ta = h('textarea.input', { rows: 10, placeholder: 'Вставте лист або текст англійською…', 'aria-label': 'Текст', value: draft });
  const btn = h('button.btn.primary.block.lg', { type: 'button', onclick: run }, ic('sparkle', { fill: true }), 'Перевірити');
  const chips = h('div.chips', KINDS.filter(([v]) => v !== 'report' || store.settings().workFocus).map(([v, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(v === kind), onclick: (e) => { kind = v; chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, t)));
  view.replaceChildren(h('div.stack',
    h('div.row', h('a.icon-btn', { href: '#/tutor', 'aria-label': 'Назад' }, ic('arrow-left')), h('h1.grow', { style: { margin: 0 } }, 'Перевір мій текст')),
    needLoginCard(), chips, ta, btn,
    q.task ? h('p.xs.dim', `Завдання: ${q.task}`) : null));
  const timer = activityTimer('writing');
  async function run() {
    const text = ta.value.trim();
    if (text.length < 10) { toast('Додайте текст — хоча б одне речення'); return; }
    btn.disabled = true; btn.textContent = 'Вчитель читає…';
    try {
      const res = await tutor('check_text', { text, kind, task: q.task || null });
      const row = store.put('tutor_chats', { mode: 'check', title: `Перевірка: ${text.slice(0, 40)}…`, messages: [{ role: 'user', text }], summary: res, seconds: Math.round(timer.seconds()) });
      for (const c of res.corrections || []) addMistake({ wrong: c.wrong, right: c.right, type: c.type, rule: c.rule, explanation_uk: c.explanation_uk, source: 'tutor', ref: row.id });
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
    txKpis(Object.keys(label).map(k => ({ value: sc[k] ?? '—', unit: '/10', label: label[k], tone: sc[k] >= 8 ? 'good' : sc[k] != null && sc[k] < 5 ? 'warn' : '' })), 2),
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

