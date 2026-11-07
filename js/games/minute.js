// «Хвилина без "uh"»: говоріть на тему до 60 секунд; три життя — кожна заминка (uh, um, er) чи повтор забирає одне.
// Наприкінці — ОДИН виклик tutor 'transcribe' з hint 'fluency' (дослівно, із заминками), потім драматичний повтор:
// текст з'являється слово за словом, заминки й повтори розбивають серця. Очки — секунди, які ви «протрималися».
import { h, ic } from '../ui/dom.js';
import { myLevel } from '../level.js';
import { activityTimer } from '../stats.js';
import { tutor, aiErrorText } from '../ai.js';
import { speak, stop as stopSpeech, blobToBase64 } from '../speech.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { user } from '../supa.js';
import { onLeave } from '../router.js';
import { plural } from '../strings.js';
import { canRecord, createMic, recordRound, micErrorKind, markup, analyze, isFiller, normWord, TOPICS, GAMBITS, interestTopics } from '../fluency.js';
import { bestUpdate } from './logic.js';
import { gameState, saveGameState, beep, buzz, reducedMotion, gameHead, gameLoginCard, micErrorCard, countdownRing, levelMeter, gameIntro, startTile, gameResult } from './common.js';
import { tx, txGroup, txPrimary } from '../ui/tiles.js';

/** Налаштування гри (об'єкт, щоб тести могли скоротити тривалість) */
export const MINUTE = { sec: 60, lives: 3, minMs: 3000, minWords: 5, stepMs: 70, hitPauseMs: 520, maxReplayMs: 7000 };

/** Ще побутові теми B1 (до тем тренажера плавності) */
export const EXTRA_TOPICS = [
  { id: 'm-morning', icon: 'sun-horizon', en: 'How I start my morning', uk: 'Як я починаю ранок', hints: ['What do you do first?', 'Coffee or tea?', 'Your perfect morning'] },
  { id: 'm-gift', icon: 'package', en: 'The best gift I\'ve ever got', uk: 'Найкращий подарунок', hints: ['What was it?', 'Who gave it to you?', 'Why do you remember it?'] },
  { id: 'm-childhood', icon: 'plant', en: 'A happy childhood memory', uk: 'Щасливий спогад з дитинства', hints: ['How old were you?', 'Where were you?', 'Why was it happy?'] },
  { id: 'm-home', icon: 'house', en: 'My favourite place at home', uk: 'Улюблене місце вдома', hints: ['Where is it?', 'What do you do there?', 'What does it look like?'] },
  { id: 'm-weather', icon: 'sun', en: 'Today\'s weather and my mood', uk: 'Погода сьогодні й мій настрій', hints: ['What is it like outside?', 'How does it change your mood?', 'Your ideal weather'] },
  { id: 'm-skill', icon: 'lightbulb', en: 'Something I can do well', uk: 'Що я вмію робити добре', hints: ['What is it?', 'How did you learn it?', 'Can you teach it?'] },
  { id: 'm-cafe', icon: 'coffee', en: 'My favourite café or restaurant', uk: 'Улюблене кафе чи ресторан', hints: ['Where is it?', 'What do you order?', 'Who do you go with?'] },
  { id: 'm-sport', icon: 'barbell', en: 'Sport and staying active', uk: 'Спорт і рух', hints: ['What do you do?', 'How often?', 'What would you like to try?'] },
  { id: 'm-book', icon: 'book-open', en: 'A book or podcast I enjoyed', uk: 'Книжка чи подкаст, що сподобались', hints: ['What is it about?', 'What did you learn?', 'Who would like it?'] },
  { id: 'm-holiday', icon: 'confetti', en: 'My favourite holiday', uk: 'Улюблене свято', hints: ['How do you celebrate?', 'What do you eat?', 'Who are you with?'] },
  { id: 'm-pet', icon: 'heart', en: 'Animals and pets', uk: 'Тварини й улюбленці', hints: ['Do you have a pet?', 'Which animal would you like?', 'A funny animal story'] },
  { id: 'm-english', icon: 'graduation-cap', en: 'Why I\'m learning English', uk: 'Навіщо я вчу англійську', hints: ['When did you start?', 'What is hard?', 'What will you do with it?'] },
  { id: 'm-neighbours', icon: 'users-three', en: 'My neighbours', uk: 'Мої сусіди', hints: ['Who lives next door?', 'Do you talk often?', 'A story about them'] },
  { id: 'm-change', icon: 'arrow-clockwise', en: 'One thing I\'d like to change', uk: 'Що я хотів(-ла) б змінити', hints: ['In your life or your town?', 'Why?', 'What is the first step?'] },
];

/** Усі теми: інтереси з профілю першими, далі — побутові */
export function allTopics() {
  let mine = [];
  try { mine = interestTopics(); } catch { /* профіль ще не завантажено */ }
  return [...mine, ...TOPICS, ...EXTRA_TOPICS];
}

// ---------- Логіка (чиста) ----------
/**
 * Скільки секунд учень «протримався»: позиція 3-ї заминки/повтору в тексті × тривалість мовлення.
 * rec: { ms, spokenSec, firstVoiceMs }. → { sec, approx, hits: [індекси в markup], cut: індекс 3-ї (або -1), full, words, fillers, repeats, per100 }
 */
export function survival(text, rec, { maxSec = MINUTE.sec, lives = MINUTE.lives } = {}) {
  const m = markup(text);
  const countable = [];
  m.forEach((x, k) => { if (x.kind === 'word' || x.kind === 'filler' || x.kind === 'repeat') countable.push(k); });
  const hits = countable.filter(k => m[k].kind !== 'word');
  const durSec = Math.min(maxSec, Math.max(0, (rec?.ms || 0) / 1000));
  const a = analyze(text, rec?.spokenSec || durSec || 1);
  const base = { hits, words: a.words, fillers: a.fillers, repeats: a.repeats, per100: a.per100, wpm: a.wpm, markup: m };
  if (hits.length < lives) {
    const full = durSec >= maxSec - 0.75;
    return { ...base, sec: full ? maxSec : Math.round(durSec), approx: false, cut: -1, full };
  }
  const cut = hits[lives - 1];
  const pos = countable.indexOf(cut);
  const frac = countable.length ? (pos + 0.5) / countable.length : 0;
  const lead = Math.max(0, Math.min(durSec, (rec?.firstVoiceMs || 0) / 1000));
  const spoken = Math.max(0, Math.min(durSec - lead, rec?.spokenSec || durSec));
  const sec = Math.max(1, Math.min(Math.round(durSec), Math.round(lead + frac * spoken)));
  return { ...base, sec, approx: true, cut, full: false };
}

/** Службові позначки моделі («[unclear]», «(laughs)») прибираємо; заминка в дужках лишається заминкою */
export function cleanTranscript(s) {
  return String(s || '').replace(/\[[^\]]*\]|\(([^)]*)\)/g, (all, inner) => (inner != null && isFiller(normWord(inner)) ? ` ${inner} ` : ' '))
    .replace(/^\s*unclear\s*$/i, '').replace(/\s+/g, ' ').trim();
}

/** Дві фрази «замість uh» для поради: одна — щоб подумати, друга — будь-яка інша */
export function tipGambits(rng = Math.random) {
  const think = GAMBITS.filter(g => g.group === 'think');
  const other = GAMBITS.filter(g => g.group !== 'think');
  return [think[Math.floor(rng() * think.length)], other[Math.floor(rng() * other.length)]];
}

const nSec = (s) => `${s} ${plural(s, 'секунда', 'секунди', 'секунд')}`;

// ---------- Сторінка ----------
export default function minute(view) {
  setTitle('Хвилина без «uh»');
  const lv = myLevel();
  const live = h('div.sr-only', { 'aria-live': 'polite', role: 'status' });
  const body = h('div.stack');
  const fill = (...kids) => body.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  view.replaceChildren(h('div.stack.games.gm', gameHead(h('span.tag', lv)), body, live));
  if (!user()) { fill(gameLoginCard('Ваше мовлення дослівно розпізнає AI — з усіма «uh» і повторами, щоб їх порахувати. Це працює після входу.')); return; }

  const timer = activityTimer('game');
  const mic = createMic();
  const timers = new Set();
  let disposed = false, ctrl = null, ac = null, busy = false, skipReplay = null;
  const topics = allTopics();
  const lastId = gameState().minuteTopic;
  let ti = Math.floor(Math.random() * topics.length);
  if (topics[ti]?.id === lastId) ti = (ti + 1) % topics.length;
  const topic = () => topics[ti];
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); return t; };
  const clearLater = () => { timers.forEach(clearTimeout); timers.clear(); skipReplay = null; };

  onLeave(view, () => {
    if (disposed) return;
    disposed = true;
    clearLater();
    ctrl?.cancel(); ctrl = null;
    ac?.abort(); ac = null;
    mic.close();
    stopSpeech();
    setFocus(false);
    timer.stop();
  });

  const hearts = (n, broken = 0) => h('div.g-hearts.gm-hearts', { role: 'img', 'aria-label': `Життя: ${n - broken} з ${n}` },
    Array.from({ length: n }, (_, k) => h('span.gm-heart' + (k >= n - broken ? '.broken' : ''), ic(k >= n - broken ? 'heart-break' : 'heart', { size: 26, fill: k < n - broken }))));

  function topicCard({ compact = false } = {}) {
    const t = topic();
    return h('div.card.gm-topic' + (compact ? '.compact' : ''),
      h('div.row', { style: { gap: '12px', alignItems: 'flex-start' } },
        h('span.tx-sq', ic(t.icon || 'chat-circle-dots', { size: 20 })),
        h('div.grow', { style: { minWidth: 0 } },
          h('div.gm-eyebrow', 'Тема'),
          h('div.gm-ten', { lang: 'en' }, t.en),
          t.uk && t.uk !== t.en ? h('div.small.dim', t.uk) : null)),
      h('ul.gm-hints', { lang: 'en' }, (t.hints || []).map(x => h('li', x))));
  }

  // ---------- Вступ ----------
  function intro() {
    setFocus(false);
    clearLater();
    const best = gameState().best?.minute?.[lv] || 0;
    const start = startTile({ icon: 'microphone', label: 'Старт', sub: `до ${MINUTE.sec} секунд · ${MINUTE.lives} життя`, onclick: startRec });
    const other = tx({ icon: 'shuffle', label: 'Інша тема', wide: true, cls: 'gm-other', onclick: () => { ti = (ti + 1 + Math.floor(Math.random() * (topics.length - 1))) % topics.length; intro(); body.querySelector('.gm-other')?.focus({ preventScroll: true }); } });
    fill(
      h('div.stack.gm-pick', topicCard(), other),
      gameIntro({
        icon: 'timer',
        text: `Говоріть до ${MINUTE.sec} секунд. Кожне «uh», «um» чи повтор слова — мінус життя.`,
        rules: ['Три життя: третя заминка — і хвилина для вас скінчилась', 'Очки — скільки секунд ви протрималися', 'Перевірка — після запису: AI розпізнає мовлення дослівно'],
        extra: [canRecord() ? null : micErrorCard('unsupported')],
        best: best ? { label: `Рекорд рівня ${lv}`, value: nSec(best) } : null,
        start: canRecord() ? start : null,
      }));
    if (canRecord()) start.focus({ preventScroll: true });
  }

  // ---------- Запис ----------
  function startRec() {
    if (busy) return;
    busy = true;
    stopSpeech();
    saveGameState({ minuteTopic: topic().id });
    // iOS: getUserMedia — синхронно в обробнику тапу (усередині ensure, до першого await)
    mic.ensure().then(() => { busy = false; if (!disposed) recording(); }, (e) => {
      busy = false;
      if (disposed) return;
      setFocus(false);
      fill(topicCard({ compact: true }), micErrorCard(micErrorKind(e), startRec),
        tx({ icon: 'arrow-left', label: 'Назад до теми', wide: true, onclick: intro, cls: 'g-quiet' }));
    });
  }

  function recording(note) {
    const total = MINUTE.sec * 1000;
    const ring = countdownRing(196, 12);
    const meter = levelMeter();
    ring.set(total, total);
    setFocus(true);
    const stopBtn = txPrimary({ icon: 'stop', label: 'Стоп', sub: 'перевірити запис', onclick: () => ctrl?.stop() });
    const cheat = GAMBITS.filter(g => ['think', 'start'].includes(g.group)).slice(0, 6);
    fill(
      topicCard({ compact: true }),
      h('div.gm-stage', ring.el, h('div.row.gm-mid', hearts(MINUTE.lives), h('div.gx-live', h('span.gx-dot'), 'Запис')), meter.el),
      note || null,
      h('div.gm-cheat', txGroup('Замість «uh» скажіть',
        h('div.chips', cheat.slice(0, 4).map(g => h('span.chip.static', { lang: 'en' }, g.en))))),
      stopBtn,
      tx({ icon: 'x', label: 'Скасувати', wide: true, cls: 'g-quiet', onclick: () => { ctrl?.cancel(); ctrl = null; mic.close(); intro(); } }));
    live.textContent = 'Запис почався. Говоріть на тему.';
    stopBtn.focus({ preventScroll: true });
    try {
      ctrl = recordRound(mic, { maxMs: total, onTick: ({ left, level, voiced }) => { ring.set(left, total); meter.push(level, voiced); } });
    } catch (e) {
      setFocus(false);
      fill(micErrorCard(micErrorKind(e), startRec));
      return;
    }
    const c = ctrl;
    c.done.then((rec) => {
      if (ctrl === c) ctrl = null;
      if (!rec || disposed) return;
      if (rec.ms < MINUTE.minMs) { setFocus(false); return tooShort('Запис закороткий — спробуйте говорити довше.'); }
      check(rec);
    });
  }

  function tooShort(msg) {
    mic.close();
    fill(topicCard({ compact: true }),
      tx({ icon: 'warning', label: msg, wide: true, tone: 'bad', attrs: { role: 'alert' } }),
      txPrimary({ icon: 'microphone', label: 'Спробувати ще раз', onclick: startRec }),
      tx({ icon: 'arrow-left', label: 'Назад до теми', wide: true, onclick: intro, cls: 'g-quiet' }));
  }

  // ---------- Перевірка ----------
  async function check(rec) {
    mic.close();   // мікрофон більше не потрібен: індикатор запису в Safari гасне
    setFocus(true);
    fill(topicCard({ compact: true }),
      h('div.card.gx-think', { 'aria-busy': 'true' }, h('span.gx-thinkdots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', 'Слухаємо кожне слово…')));
    live.textContent = 'Перевіряємо запис';
    ac = new AbortController();
    const my = ac;
    let text;
    try {
      const audio = await blobToBase64(rec.blob);
      if (disposed || my.signal.aborted) return;
      const res = await tutor('transcribe', { audio, mime: rec.mime, hint: 'fluency', context: { tutor: topic().en } }, { signal: my.signal });
      text = cleanTranscript(res?.text);
    } catch (e) {
      if (disposed || e?.name === 'AbortError') return;
      setFocus(false);
      fill(topicCard({ compact: true }),
        tx({ icon: 'warning', label: 'Не вдалося розпізнати запис', sub: aiErrorText(e) || 'Спробуйте ще раз.', wide: true, tone: 'bad', attrs: { role: 'alert' } }),
        txPrimary({ icon: 'arrow-clockwise', label: 'Надіслати ще раз', onclick: () => check(rec) }),
        tx({ icon: 'arrow-left', label: 'Назад до теми', wide: true, onclick: intro, cls: 'g-quiet' }));
      return;
    } finally { if (ac === my) ac = null; }
    if (disposed) return;
    const s = survival(text, rec);
    if (s.words < MINUTE.minWords) { setFocus(false); return tooShort('Майже нічого не почули. Говоріть голосніше й ближче до мікрофона.'); }
    replay(text, s);
  }

  // ---------- Драматичний повтор ----------
  function replay(text, s) {
    const m = s.markup;
    const box = h('p.gm-replay', { lang: 'en', 'aria-hidden': 'true' });
    const lives = MINUTE.lives;
    let broken = 0, k = 0, finished = false;
    const heartRow = hearts(lives);
    const clock = h('b.num.gm-clock', '0');
    const words = m.filter(x => x.kind !== 'space' && x.kind !== 'punct').length;
    const skipBtn = tx({ icon: 'arrow-right', label: 'Показати одразу', wide: true, cls: 'g-quiet', onclick: () => skipReplay?.() });
    const stage = h('div.card.stack.gm-replay-card', { onclick: () => skipReplay?.() },
      h('div.row', heartRow, h('div.grow'), h('div.gm-clockwrap', h('span.dim.xs', s.approx ? '≈ ' : ''), clock, h('span.dim.xs', ' с'))),
      box);
    fill(topicCard({ compact: true }), stage, skipBtn);
    live.textContent = 'Повтор вашої хвилини';
    const isTok = (x) => x.kind === 'word' || x.kind === 'filler' || x.kind === 'repeat';
    // годинник іде до моменту 3-ї заминки (або до кінця запису)
    const span = (s.cut >= 0 ? m.slice(0, s.cut + 1) : m).filter(isTok).length || 1;
    let shown = 0;

    const breakHeart = (animate) => {
      broken++;
      const el = heartRow.children[lives - broken];
      if (el) { el.classList.add('broken'); el.replaceChildren(ic('heart-break', { size: 26 })); if (animate && !reducedMotion()) el.classList.add('crack'); }
      heartRow.setAttribute('aria-label', `Життя: ${lives - broken} з ${lives}`);
    };
    const nodeFor = (x) => {
      if (x.kind === 'filler') return h('mark.gm-f', x.text);
      if (x.kind === 'repeat') return h('mark.gm-r', x.text);
      return document.createTextNode(x.text);
    };
    const put = (idx, animate) => {
      const x = m[idx];
      let node = nodeFor(x);
      if (s.cut >= 0 && idx > s.cut && x.kind !== 'space') node = h('span.gm-gone', node);
      box.append(node);
      if (isTok(x)) {
        shown++;
        if (broken < lives) clock.textContent = String(Math.min(s.sec, Math.round(s.sec * shown / span)));
      }
      if ((x.kind === 'filler' || x.kind === 'repeat') && broken < lives) {
        breakHeart(animate);
        if (animate) { beep('bad'); buzz(50); }
        if (idx === s.cut) { clock.textContent = String(s.sec); box.append(h('span.gm-out', { 'aria-hidden': 'true' }, ic('heart-break', { size: 14 }), ` ${s.sec} с`)); }
        return animate ? MINUTE.hitPauseMs : 0;
      }
      return 0;
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearLater();
      while (k < m.length) put(k++, false);
      clock.textContent = String(s.sec);
      result(text, s, stage);
      skipBtn.remove();
    };
    skipReplay = finish;
    if (reducedMotion() || MINUTE.stepMs <= 0) return finish();
    const step = Math.max(18, Math.min(MINUTE.stepMs, MINUTE.maxReplayMs / Math.max(1, words)));
    const tick = () => {
      if (finished) return;
      let pause = 0;
      // пробіли й розділові — разом із наступним словом
      while (k < m.length) {
        const x = m[k];
        pause = put(k++, true);
        if (x.kind !== 'space' && x.kind !== 'punct') break;
      }
      if (k >= m.length) return later(finish, 350);
      const fast = s.cut >= 0 && k > s.cut;
      later(tick, pause || (fast ? Math.max(12, step / 3) : step));
    };
    later(tick, 300);
  }

  // ---------- Результат ----------
  function result(text, s, stage) {
    skipReplay = null;
    setFocus(false);
    const st = gameState();
    const upd = bestUpdate(st.best?.minute, lv, s.sec);
    saveGameState({ best: { ...(st.best || {}), minute: upd.best } });
    upd.record ? (beep('win'), buzz([30, 40, 30])) : s.full ? beep('win') : beep('lose');
    stage.onclick = null;
    stage.querySelector('.gm-replay')?.removeAttribute('aria-hidden');
    const head = s.full ? 'Хвилину пережито!' : s.cut >= 0 ? `Третя заминка — на ≈ ${s.sec} с` : `Без трьох заминок — ${nSec(s.sec)}`;
    const tips = tipGambits();
    const out = gameResult({
      icon: s.full ? 'trophy' : 'timer', record: upd.record,
      score: [s.approx ? h('span.gm-approx', '≈') : null, String(s.sec)], unit: ' с', sub: head,
      kpis: [{ value: s.words, label: plural(s.words, 'слово', 'слова', 'слів') }, { value: String(s.per100).replace('.', ','), label: 'заминок на 100 слів', tone: s.per100 > 6 ? 'warn' : '' }, { value: s.repeats, label: plural(s.repeats, 'повтор', 'повтори', 'повторів') }],
      note: upd.prev && !upd.record ? `Рекорд рівня ${lv}: ${nSec(upd.prev)}` : null,
      sections: [
        h('div.fl-legend.gm-legend', h('span', h('i.gm-f'), 'заминка'), h('span', h('i.gm-r'), 'повтор'), s.cut >= 0 ? h('span', h('i.gm-g'), 'після третьої') : null),
        txGroup('Замість «uh» — фраза, що дає час подумати', [
          h('div.chips.gm-tip', tips.map(g => h('button.chip', { type: 'button', lang: 'en', 'aria-label': `Прослухати: ${g.en.replace(/…/g, '')} — ${g.uk}`, onclick: () => speak(g.en.replace(/…/g, '')) },
            ic('speaker-high', { size: 16 }), g.en))),
          tx({ icon: 'waveform', label: 'Тренажер плавності', sub: 'більше фраз і вправа 4-3-2', href: '#/fluency', wide: true })])],
      primary: { icon: 'arrow-clockwise', label: 'Ще раз', sub: 'та сама тема', onclick: startRec },
      more: [{ icon: 'shuffle', label: 'Нова тема', onclick: () => { ti = (ti + 1 + Math.floor(Math.random() * (topics.length - 1))) % topics.length; intro(); } },
        { icon: 'game-controller', label: 'Усі ігри', href: '#/games' }],
    });
    out.classList.add('gm-result');
    stage.after(out);
    live.textContent = `${head}. Слів: ${s.words}. Заминок на 100 слів: ${s.per100}.` + (upd.record ? ' Новий рекорд!' : '');
    out.querySelector('.g-again')?.focus({ preventScroll: true });
  }

  intro();
}
