// «Слухати в дорозі» (#/listen-go): аудіосесія без рук — для прогулянки чи дороги.
// Кожен пункт: англійською → пауза → українською → пауза → англійською повільніше (0,85×) → наступний.
// Джерела: мої слова (до повтору / ті, що вчаться), фрази фразника, відкриті помилки (правильний варіант).
// Картки НЕ оцінюються (прослуховування — не повтор FSRS); «Знаю — пропустити» лише прибирає пункт з цієї сесії.
import { h, ic } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import { decks } from '../srs.js';
import { isPhrase } from '../phrases.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { activityTimer } from '../stats.js';
import { setFocus } from '../ui/shell.js';
import { keepAwake } from '../ui/wakelock.js';
import { onLeave } from '../router.js';
import { tx, txPrimary, txGroup, txGrid, txKpis, txRow, txRows, txBar, txPill, txResult } from '../ui/tiles.js';

const PREFS_KEY = 'me:listengo';
const SOURCES = [
  { id: 'words', label: 'Мої слова', icon: 'cards', kind: 'Слово' },
  { id: 'phrases', label: 'Фрази', icon: 'quotes', kind: 'Фраза' },
  { id: 'fixes', label: 'Виправлення', icon: 'warning-circle', kind: 'Виправлення' },
];
const DURATIONS = [5, 10, 15];
const PAUSE_MS = 1500, AFTER_MS = 900, SLOW = 0.85;
const PER_SOURCE = 40;

const synth = window.speechSynthesis;

function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p && typeof p === 'object') return { src: { words: true, phrases: true, fixes: true, ...(p.src || {}) }, min: DURATIONS.includes(p.min) ? p.min : 10 };
  } catch { /* приватний режим */ }
  return { src: { words: true, phrases: true, fixes: true }, min: 10 };
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* */ } }

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const key = (s) => String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '');
/** Коротке пояснення для озвучення: перше речення, до 140 символів */
function shortUk(t) {
  const s = String(t || '').replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const first = s.match(/^.+?[.!?](\s|$)/)?.[0]?.trim() || s;
  return first.length > 140 ? first.slice(0, 137).replace(/\s+\S*$/, '') + '…' : first;
}

/** Пункти кожного джерела (найважливіші першими) */
async function collect() {
  const now = Date.now();
  const enabled = new Set((await decks()).filter(d => d.enabled).map(d => d.id));
  const cards = store.all('cards').filter(c => c.en && c.uk);
  const dueAt = (c) => (c.due ? new Date(c.due).getTime() : Infinity);
  // слова: до повтору → у процесі вивчення (етапи навчання FSRS або стабільність < 21 дн.)
  const words = cards
    .filter(c => !isPhrase(c) && enabled.has(c.deck_id) && c.reps > 0 && !c.extra?.known
      && (dueAt(c) <= now || c.state === 1 || c.state === 3 || (c.stability || 0) < 21))
    .sort((a, b) => (dueAt(a) <= now ? 0 : 1) - (dueAt(b) <= now ? 0 : 1) || (a.stability || 0) - (b.stability || 0))
    .slice(0, PER_SOURCE)
    .map(c => ({ src: 'words', id: c.id, en: c.en, uk: c.uk }));
  // фрази: ще не вивчені першими
  const phrases = cards.filter(isPhrase)
    .sort((a, b) => (a.stability || 0) - (b.stability || 0))
    .slice(0, PER_SOURCE)
    .map(c => ({ src: 'phrases', id: c.id, en: c.en, uk: c.uk }));
  // відкриті помилки: правильний варіант англійською, коротке пояснення українською
  const fixes = store.all('mistakes').filter(m => !m.resolved && m.right && m.wrong)
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, PER_SOURCE)
    .map(m => ({ src: 'fixes', id: m.id, en: m.right, uk: shortUk(m.explanation_uk), wrong: m.wrong }));
  return { words, phrases, fixes };
}

/** Черга: джерела чергуються, без повторів англійського тексту */
function buildQueue(pool, src) {
  const lists = SOURCES.filter(s => src[s.id]).map(s => shuffle(pool[s.id].slice()));
  const out = [], seen = new Set();
  for (let i = 0; lists.some(l => i < l.length); i++) {
    for (const l of lists) {
      const it = l[i];
      if (!it || seen.has(key(it.en))) continue;
      seen.add(key(it.en)); out.push(it);
    }
  }
  return out;
}

// ---------- Озвучення з захистом від «завислого» speechSynthesis ----------
let ukVoice = null;
function findUkVoice() {
  if (!synth) return null;
  const vs = synth.getVoices().filter(v => /^uk([-_]|$)/i.test(v.lang));
  const score = (v) => (/natural|neural|online|google|siri|premium|enhanced/i.test(v.name) ? 0 : 1);
  return vs.sort((a, b) => score(a) - score(b))[0] || null;
}
if (synth) { ukVoice = findUkVoice(); synth.addEventListener?.('voiceschanged', () => { ukVoice = findUkVoice(); }); }

/** Скільки чекати кінця репліки, перш ніж вважати синтез завислим */
const budget = (text, rate) => Math.min(30000, 4000 + String(text).length * 95 / Math.max(0.5, rate));

/** Обіцянка з таймаутом: якщо синтез не відповів — скидаємо його (cancel + resume) і йдемо далі */
function guarded(p, ms) {
  let t;
  return Promise.race([p, new Promise(res => { t = setTimeout(() => { unstick(); res(); }, ms); })]).finally(() => clearTimeout(t));
}
function unstick() {
  try { stopSpeech(); } catch { /* */ }
  try { synth?.cancel(); synth?.resume(); } catch { /* */ }
}
function prepSynth() {
  // iOS / Chrome: синтез інколи лишається на паузі після згортання — відновлюємо
  try { if (synth?.paused) synth.resume(); } catch { /* */ }
}

function speakEn(text, rate) {
  prepSynth();
  const engine = store.settings().ttsEngine;
  return guarded(speak(text, { rate }), budget(text, rate) + (engine === 'gemini' ? 10000 : 0));
}
function speakUk(text, rate) {
  if (!synth || !ukVoice || !text) return null;
  prepSynth();
  try { synth.cancel(); } catch { /* */ }
  const p = new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = ukVoice.lang || 'uk-UA';
    u.voice = ukVoice;
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    synth.speak(u);
  });
  return guarded(p, budget(text, rate));
}

// ---------- Сторінка ----------
export default async function listenGo(view) {
  const prefs = readPrefs();
  let pool = await collect();
  let session = null;      // активний програвач
  let gone = false;

  const cleanup = () => {
    if (gone) return;
    gone = true;
    session?.destroy();
    session = null;
    setFocus(false);
  };
  onLeave(view, cleanup);

  setup();
  return cleanup;

  // ----- Екран вибору -----
  function setup() {
    setFocus(false);
    const st = store.settings();
    const counts = Object.fromEntries(SOURCES.map(s => [s.id, pool[s.id].length]));
    const total = SOURCES.reduce((a, s) => a + counts[s.id], 0);
    if (!total) {
      view.replaceChildren(h('div.stack-lg.lg',
        h('section.tx-group', txResult({ icon: 'headphones', tone: 'accent', label: 'Слухати в дорозі', title: 'Поки нічого слухати',
          sub: 'Тут звучатимуть ваші слова, фрази й виправлення з розмов' })),
        txGroup('З чого почати', txGrid([
          tx({ icon: 'cards', label: 'Картки', sub: 'Вивчити перші слова', href: '#/cards' }),
          tx({ icon: 'quotes', label: 'Фразник', sub: 'Зберегти фрази', href: '#/phrases' }),
          tx({ icon: 'chat-circle-dots', label: 'Вчитель', sub: 'Поговорити', href: '#/tutor' }),
        ]))));
      return;
    }
    const queueSize = () => buildQueue(pool, prefs.src).length;
    const primary = h('div');
    const drawPrimary = () => {
      const n = queueSize();
      primary.replaceChildren(txPrimary({
        icon: 'play', label: 'Почати слухати',
        sub: n ? `${prefs.min} хв · ${n} ${plural(n, 'пункт', 'пункти', 'пунктів')} по колу` : 'Оберіть, що слухати',
        onclick: n ? () => start() : null, disabled: !n, cls: n ? null : 'lg-off',
      }));
    };
    const srcTile = (s) => {
      const n = counts[s.id];
      const el = tx({
        icon: s.icon, label: s.label, sub: n ? String(n) : 'Поки немає', on: !!(prefs.src[s.id] && n),
        onclick: n ? () => {
          prefs.src[s.id] = !prefs.src[s.id]; savePrefs(prefs);
          el.classList.toggle('on', prefs.src[s.id]);
          el.querySelector('.tx-sq')?.replaceChildren(ic(s.icon, { size: 20, fill: prefs.src[s.id] }));
          el.setAttribute('aria-pressed', String(prefs.src[s.id]));
          drawPrimary();
        } : null,
        attrs: n ? { 'aria-pressed': String(!!prefs.src[s.id]) } : { 'aria-disabled': 'true' },
        cls: n ? null : 'lg-off',
      });
      return el;
    };
    drawPrimary();
    const durSeg = h('div.seg', { role: 'group', 'aria-label': 'Тривалість' }, DURATIONS.map(m => h('button', {
      type: 'button', 'aria-pressed': String(m === prefs.min),
      onclick: (e) => {
        prefs.min = m; savePrefs(prefs);
        durSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        drawPrimary();
      },
    }, `${m} хв`)));
    const voiceInfo = `Швидкість ${String(st.rate ?? 1).replace('.', ',')}× · ${st.accent === 'UK' ? 'британська' : 'американська'} вимова`;
    view.replaceChildren(h('div.stack-lg.lg',
      primary,
      txGroup('Що слухати', txGrid(SOURCES.map(srcTile))),
      txGroup('Тривалість', durSeg),
      txRows([txRow({ icon: 'gear-six', label: voiceInfo, sub: ukVoice ? 'Переклад звучить українською' : 'Переклад — на екрані (немає українського голосу)', href: '#/settings', cls: 'lg-set' })])));
  }

  // ----- Програвач -----
  function start() {
    const queue = buildQueue(pool, prefs.src);
    if (!queue.length) return;
    session?.destroy();
    session = player(queue, prefs.min);
  }

  function player(queue, minutes) {
    const st = store.settings();
    const rate = Number(st.rate) || 1;
    const target = minutes * 60000;
    let idx = 0, round = 1;
    let running = false, token = 0;
    let played = 0, runFrom = 0;
    let timer = null;
    let done = 0, skipped = 0;
    const heard = new Set();
    let phase = 0;            // 0 англ., 1 укр., 2 англ. повільніше
    let ticker = null, ended = false;

    setFocus(true);
    keepAwake(true);

    // розмітка
    const elBar = h('div.lg-bar');
    const elTime = h('span.lg-time');
    const elCount = h('span.lg-count');
    const elKind = h('div.lg-kind');
    const elEn = h('div.lg-en', { lang: 'en' });
    const elWrong = h('div.lg-wrong');
    const elUk = h('div.lg-uk', { lang: 'uk' });
    const steps = ['English', 'Українською', 'Повільніше'].map(t => h('span.lg-step', t));
    const btnPlay = h('button.lg-play', { type: 'button', onclick: () => (running ? pause() : play()) });
    const btnPrev = h('button.lg-nav', { type: 'button', 'aria-label': 'Попередня', onclick: () => jump(-1) }, ic('caret-left', { size: 26 }));
    const btnNext = h('button.lg-nav', { type: 'button', 'aria-label': 'Наступна', onclick: () => jump(1) }, ic('caret-right', { size: 26 }));
    const live = h('div.sr-only', { 'aria-live': 'polite' });

    view.replaceChildren(h('div.lg-player',
      h('div.lg-top',
        h('div.lg-meta', elTime, elCount),
        h('button.lg-end', { type: 'button', onclick: () => finish() }, 'Завершити')),
      elBar,
      h('section.lg-now', { 'aria-label': 'Зараз звучить' },
        elKind, elEn, elWrong, elUk,
        h('div.lg-steps', { 'aria-hidden': 'true' }, steps)),
      h('div.lg-ctrl', btnPrev, btnPlay, btnNext),
      tx({ wide: true, icon: 'check', label: 'Знаю — пропустити', sub: 'Більше не звучатиме в цій сесії', onclick: () => skip(), cls: 'lg-skip', end: '' }),
      live));

    const cur = () => queue[idx];

    function fmt(ms) { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    function elapsed() { return played + (running ? Date.now() - runFrom : 0); }
    function drawProgress() {
      const e = Math.min(elapsed(), target);
      elBar.replaceChildren(txBar(e / target, true));
      elTime.textContent = `${fmt(e)} з ${fmt(target)}`;
    }
    function drawItem() {
      const it = cur();
      const s = SOURCES.find(x => x.id === it.src);
      elKind.replaceChildren(txPill(s.kind + (round > 1 ? ` · коло ${round}` : ''), it.src === 'fixes' ? 'warn' : 'accent'));
      elEn.textContent = it.en;
      elWrong.replaceChildren(...(it.wrong ? [h('span', 'замість '), h('s', { lang: 'en' }, it.wrong)] : []));
      elWrong.hidden = !it.wrong;
      elUk.textContent = it.uk || '';
      elUk.hidden = !it.uk;
      elCount.textContent = `${idx + 1} з ${queue.length}`;
      drawPhase();
      media(it);
    }
    function drawPhase() {
      steps.forEach((el, k) => el.classList.toggle('on', running && k === phase));
      elEn.classList.toggle('lit', running && phase !== 1);
      elUk.classList.toggle('lit', running && phase === 1);
    }
    function drawPlay() {
      btnPlay.replaceChildren(ic(running ? 'pause' : 'play', { size: 34, fill: true }));
      btnPlay.setAttribute('aria-label', running ? 'Пауза' : 'Слухати');
      btnPlay.classList.toggle('on', running);
      if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = running ? 'playing' : 'paused'; } catch { /* */ }
      drawPhase();
    }

    // Media Session: назва на екрані блокування / в авто, кнопки гарнітури
    function media(it) {
      if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: it.en, artist: it.uk || SOURCES.find(x => x.id === it.src).kind, album: 'myEnglish · Слухати в дорозі',
          artwork: [{ src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
        });
      } catch { /* */ }
    }
    const handlers = { play: () => play(), pause: () => pause(), stop: () => pause(), nexttrack: () => jump(1), previoustrack: () => jump(-1) };
    function bindMedia(on) {
      if (!('mediaSession' in navigator)) return;
      for (const [a, fn] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(a, on ? fn : null); } catch { /* дія не підтримується */ } }
      if (!on) { try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch { /* */ } }
    }
    bindMedia(true);

    // повернулись у застосунок: iOS обриває синтез у фоні — перезапускаємо поточний пункт
    const onVis = () => { if (!document.hidden && running) { unstick(); loop(); } };
    document.addEventListener('visibilitychange', onVis);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function playItem(it, t) {
      const alive = () => t === token && running;
      phase = 0; drawPhase();
      live.textContent = it.en;
      await speakEn(it.en, rate);
      if (!alive()) return false;
      await sleep(PAUSE_MS); if (!alive()) return false;
      phase = 1; drawPhase();
      const uk = speakUk(it.uk, Math.min(1.2, rate));
      // без українського голосу — переклад лише на екрані: даємо час прочитати
      await (uk || sleep(it.uk ? Math.min(3500, 1200 + it.uk.length * 40) : 400));
      if (!alive()) return false;
      await sleep(PAUSE_MS); if (!alive()) return false;
      phase = 2; drawPhase();
      await speakEn(it.en, rate * SLOW);
      if (!alive()) return false;
      await sleep(AFTER_MS);
      return alive();
    }

    async function loop() {
      const t = ++token;
      while (running && t === token && !ended) {
        const it = cur();
        timer?.poke();
        const ok = await playItem(it, t);
        if (!ok) return;
        done++; heard.add(key(it.en));
        if (elapsed() >= target) { finish(); return; }
        advance(1);
        drawItem();
      }
    }
    function advance(d) {
      idx += d;
      if (idx >= queue.length) { idx = 0; round++; if (queue.length > 2) { const last = queue[queue.length - 1]; shuffle(queue); if (queue[0] === last) queue.push(queue.shift()); } }
      if (idx < 0) idx = 0;
    }

    function play() {
      if (ended || running) return;
      running = true; runFrom = Date.now();
      timer ||= activityTimer('listening');
      keepAwake(true);
      drawPlay();
      loop();
    }
    function pause() {
      if (!running) return;
      played += Date.now() - runFrom;
      running = false; token++;
      unstick();
      timer?.stop(); timer = null;   // пауза в дорозі може бути довгою — час заняття не йде
      phase = 0;
      drawPlay(); drawProgress();
    }
    function jump(d) {
      if (ended) return;
      token++; unstick();
      advance(d);
      drawItem();
      if (running) loop();
    }
    function skip() {
      if (ended) return;
      const it = cur();
      skipped++;
      token++; unstick();
      for (let i = queue.length - 1; i >= 0; i--) if (key(queue[i].en) === key(it.en)) { queue.splice(i, 1); if (i < idx) idx--; }
      if (!queue.length) { finish(); return; }
      if (idx >= queue.length) { idx = 0; round++; }
      drawItem();
      if (running) loop();
    }

    function stopAll() {
      if (running) played += Date.now() - runFrom;
      running = false; token++;
      unstick();
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', onVis);
      bindMedia(false);
      const r = timer?.stop(); timer = null;
      return r;
    }
    function finish() {
      if (ended) return;
      ended = true;
      stopAll();
      session = null;
      result({ done, distinct: heard.size, skipped, ms: played });
    }

    ticker = setInterval(drawProgress, 500);
    drawItem(); drawProgress(); drawPlay();
    // старт — у тому самому дотику (iOS дозволяє синтез лише з жесту користувача)
    play();

    return { destroy() { if (!ended) { ended = true; stopAll(); } } };
  }

  // ----- Підсумок -----
  function result({ done, distinct, skipped, ms }) {
    setFocus(false);
    const min = ms / 60000;
    const minLabel = min < 1 ? '<1' : String(Math.round(min));
    const good = done >= 5;
    view.replaceChildren(h('div.stack-lg.lg',
      h('section.tx-group',
        txResult({ icon: good ? 'headphones' : 'clock', tone: good ? 'good' : 'accent', label: 'Слухати в дорозі',
          title: done ? `Прослухано ${done} ${plural(done, 'пункт', 'пункти', 'пунктів')}` : 'Сесію завершено',
          sub: distinct && distinct < done ? `${distinct} різних — повтори по колу закріплюють` : null }),
        txKpis([
          { value: done, label: 'прослухано', tone: done ? 'accent' : null },
          { value: minLabel, unit: 'хв', label: 'слухання' },
          skipped ? { value: skipped, label: 'уже знаю' } : { value: distinct, label: 'різних' },
        ])),
      h('section.tx-group',
        txPrimary({ icon: 'arrow-clockwise', label: 'Ще раз', sub: `${prefs.min} хв · та сама добірка`, onclick: () => { window.scrollTo(0, 0); start(); } }),
        tx({ wide: true, icon: 'gear-six', label: 'Змінити добірку', sub: 'Що слухати й скільки', onclick: async () => { pool = await collect(); window.scrollTo(0, 0); if (!gone) setup(); } }))));
  }
}
