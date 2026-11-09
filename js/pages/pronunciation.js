// Вимова: shadowing, мінімальні пари, проблемні звуки
import { h, ic, seg, progress } from '../ui/dom.js';
import { plural } from '../strings.js';
import { txKpis, txPrimary, txRow, txResult } from '../ui/tiles.js';
import { moreRows } from './grammar.js';
import { pronunciation as loadData } from '../data.js';
import { speak, stop as stopSpeech, recognize, canRecognize, recordAndTranscribe, compareWords, canRecord, recordAudio } from '../speech.js';
import { pron, aiErrorText } from '../ai.js';
import * as store from '../store.js';
import { activityTimer, addMistake } from '../stats.js';
import { byFit, levelChips, levelCounts, levelPick, filterByLevel, fallbackNote } from '../level.js';
import { user } from '../supa.js';

async function listen(onInterim) {
  if (canRecognize()) return recognize({ onInterim });
  if (!user()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  return recordAndTranscribe({ maxMs: 8000 });
}
function errText(e) {
  if (e.code === 'mic' || e.name === 'NotAllowedError') return 'Немає доступу до мікрофона';
  if (e.code === 'unsupported') return 'Розпізнавання недоступне: потрібен Chrome/Edge або вхід в акаунт (транскрипція Gemini)';
  return 'Не вдалося розпізнати. Спробуйте ще раз.';
}

let wantTopic = null;
// активні записи: при виході зі сторінки зупиняються без відправлення
const active = new Set();
function cancelRecordings() { active.forEach(c => { c.cancelled = true; c.abort(); }); active.clear(); }

export default async function pronunciation(view, r) {
  const data = await loadData();
  const timer = activityTimer('pronunciation');
  const body = h('div');
  // Теорія: звуки з підказками артикуляції — окрема сторінка #/pronunciation/sounds
  if (r.parts[0] === 'sounds') {
    view.replaceChildren(h('div.stack-lg.pr', body));
    sounds(body, data, timer);
    return () => { cancelRecordings(); stopSpeech(); timer.stop(); };
  }
  let tab = r.query.tab === 'pairs' ? 'pairs' : 'shadowing';
  wantTopic = r.query.topic || null;   // посилання з головної відкриває конкретну тему
  view.replaceChildren(h('div.stack-lg.pr', seg([['shadowing', 'Повтор фраз'], ['pairs', 'Пари слів']], tab, v => { tab = v; draw(); }), body));
  const draw = () => { cancelRecordings(); stopSpeech(); ({ shadowing, pairs })[tab](body, data, timer); };
  draw();
  return () => { cancelRecordings(); stopSpeech(); timer.stop(); };
}

/** AI-оцінка доступна: вхід, мережа, запис аудіо */
export const aiReady = () => !!user() && navigator.onLine && canRecord();

/** Тривалість запису за довжиною фрази: 5–15 с */
const maxMsFor = (text) => Math.min(15000, Math.max(5000, 3000 + text.split(/\s+/).length * 900));

const WSTYLE = {
  ok: { icon: 'check-circle', label: 'правильно' },
  minor: { icon: 'warning-circle', label: 'майже' },
  wrong: { icon: 'x-circle', label: 'помилка' },
  missed: { icon: 'x-circle', label: 'пропущено' },
};
const scoreClass = (n) => (n >= 80 ? 'good' : n >= 55 ? 'warn' : 'bad');
const scoreLabel = (n) => (n >= 90 ? 'Відмінно' : n >= 80 ? 'Дуже добре' : n >= 65 ? 'Добре' : n >= 45 ? 'Є над чим попрацювати' : 'Спробуйте ще раз');

/** Слово з кольором і значком (колір — не єдина ознака: значок + підпис для читачів екрана). Стилі — css/p-practice.css */
function wordChip(w) {
  const key = WSTYLE[w.status] ? w.status : 'ok';
  const st = WSTYLE[key];
  return h('span.pron-word.' + key, { dataset: { status: w.status } }, ic(st.icon, { size: 15, fill: key === 'ok' }), w.word, h('span.sr-only', `, ${st.label}`));
}

/**
 * Відмалювати результат AI-оцінки. Текст від AI — лише текстовими вузлами (h → textContent).
 * compact — для карток: оцінка, слова й одна порада.
 */
export function renderAssessment(res, { compact = false } = {}) {
  const bad = res.words.filter(w => w.status !== 'ok' && (w.issue_uk || w.tip_uk));
  const tone = scoreClass(res.score);
  return h('div.stack.pron-result' + (compact ? '.compact' : ''),
    h('div.pron-score',
      h('b.pron-n.' + tone, { 'aria-label': `Оцінка ${res.score} зі 100` }, String(res.score), h('small', { 'aria-hidden': 'true' }, '/100')),
      h('span.tx-pill.' + tone, res.no_speech ? 'Мовлення не почуто' : scoreLabel(res.score))),
    h('div.pron-words', { lang: 'en' }, res.words.map(wordChip)),
    res.heard ? h('div.xs.dim', 'Почуто: ', h('span', { lang: 'en' }, `«${res.heard}»`)) : null,
    !compact && bad.length ? h('ul.pron-issues', bad.map(w => {
      const key = WSTYLE[w.status] ? w.status : 'wrong';
      return h('li.pron-issue',
        h('b.pron-iw.' + key, { lang: 'en' }, w.word),
        h('div.pron-it', w.issue_uk ? h('div', w.issue_uk) : null, w.tip_uk ? h('div.dim', w.tip_uk) : null));
    })) : null,
    (compact ? res.tips.slice(0, 1) : res.tips).length ? h('div.pron-tips', (compact ? res.tips.slice(0, 1) : res.tips).map(t =>
      h('div.pron-tip', ic('lightbulb', { size: 18 }), h('span', t)))) : null);
}

/**
 * Запис фрази й AI-оцінка: signal — зупинити запис раніше («Готово»), cancelled() — скасувати без відправлення.
 */
export async function assessPhrase(text, { onRecording, onRecorded, signal, cancelled } = {}) {
  const rec = await recordAudio({ maxMs: maxMsFor(text), signal, onStart: onRecording });
  if (cancelled?.()) throw new DOMException('cancelled', 'AbortError');   // користувач пішов зі сторінки — не витрачаємо ліміт
  if (rec.ms < 400) throw Object.assign(new Error('short'), { code: 'short' });
  onRecorded?.();
  return pron('assess', { audio: rec.audio, mime: rec.mime, text, accent: store.settings().accent === 'US' ? 'US' : 'UK' });
}

/** Блок: еталон → запис → оцінка (AI після входу; без входу/офлайн — розпізнавання браузера) */
function practiceBlock(text, timer, { uk, onResult } = {}) {
  const out = h('div.small.pr-out', { 'aria-live': 'polite' });
  let ctrl = null;
  // дії — міні-плитки: «Прослухати», «Повільно» і «Записати себе» на всю ширину (нейтральні, як квадратики плиток; без синьої кнопки в кожному блоці)
  const act = (icon, label, onclick, cls = '', aria = null) => h('button.pr-act' + cls, { type: 'button', onclick, 'aria-label': aria }, ic(icon, { size: 18 }), h('span', label));
  const actions = h('div.pr-acts');
  const setIdle = () => {
    ctrl = null;
    rec.disabled = false; rec.classList.remove('live');
    rec.replaceChildren(ic('microphone', { size: 18, fill: true }), h('span', 'Записати себе'));
    rec.removeAttribute('aria-pressed');
  };
  const again = () => h('div.pr-acts.pr-again',
    act('speaker-high', 'Еталон', () => speak(text), '', 'Прослухати еталон'),
    act('arrow-clockwise', 'Ще раз', () => start()));

  // Безкоштовна перевірка: розпізнавання браузера (або транскрипція) + порівняння слів
  const free = async () => {
    rec.disabled = true; out.textContent = 'Слухаю… говоріть';
    try {
      const res = await listen(t => { out.textContent = t; });
      const cmp = compareWords(text, res.text);
      timer.poke();
      out.replaceChildren(h('div.stack.pron-result',
        h('div.pron-score', h('b.pron-n.' + scoreClass(cmp.pct), `${cmp.pct}`, h('small', '%')), h('span.xs.dim', `почуто: «${res.text || '—'}»`)),
        h('div.pron-free', { lang: 'en' }, cmp.words.map(w => [h('span', { class: w.ok ? 'word-ok' : 'word-no' }, w.raw), ' ']))));
      onResult?.(cmp, res);
    } catch (e) { out.textContent = errText(e); }
    finally { setIdle(); }
  };

  const ai = async () => {
    const c = ctrl = new AbortController();
    active.add(c);
    rec.disabled = true;
    out.textContent = 'Вмикаю мікрофон…';
    try {
      const res = await assessPhrase(text, {
        signal: c.signal,
        cancelled: () => c.cancelled,
        onRecorded: () => { rec.disabled = true; out.textContent = 'Оцінюю вимову…'; },
        onRecording: () => {
          rec.disabled = false; rec.classList.add('live'); rec.setAttribute('aria-pressed', 'true');
          rec.replaceChildren(ic('stop', { size: 18, fill: true }), h('span', 'Готово'));
          out.textContent = 'Запис… прочитайте фразу й натисніть «Готово»';
        },
      });
      timer.poke();
      out.replaceChildren(renderAssessment(res), again());
      onResult?.({ pct: res.score, words: res.words }, { text: res.heard, ai: res });
      active.delete(c); setIdle();
    } catch (e) {
      active.delete(c);
      setIdle();
      if (c.cancelled) return;
      if (e.code === 'mic' || e.name === 'NotAllowedError') { out.textContent = 'Немає доступу до мікрофона'; return; }
      const msg = e.code === 'short' ? 'Запис надто короткий. Натисніть і прочитайте фразу.' : (aiErrorText(e) || 'Не вдалося оцінити вимову.');
      out.replaceChildren(h('div', msg), canRecognize()
        ? h('button.btn.ghost.sm', { type: 'button', onclick: () => free() }, 'Перевірити без AI (розпізнавання браузера)') : null);
    }
  };
  const start = () => { stopSpeech(); return aiReady() ? ai() : free(); };

  const rec = act('microphone', 'Записати себе', () => {
    if (ctrl) { rec.disabled = true; ctrl.abort(); return; }   // «Готово»: запис зупиняється й іде на оцінку
    start();
  }, '.rec');
  rec.firstChild.replaceWith(ic('microphone', { size: 18, fill: true }));
  actions.append(
    act('speaker-high', 'Слухати', () => speak(text)),
    act('timer', 'Повільно', () => speak(text, { rate: 0.7 })),
    rec);
  return h('div.gx-card.stack.pr-block',
    h('div', h('div.ex-prompt', { lang: 'en' }, text), uk ? h('div.xs.dim', uk) : null),
    actions, out);
}

function shadowing(box, data, timer) {
  // теми вибраного рівня (за замовчуванням — мого); зміна рівня змінює набір фраз
  const lvOf = (g) => data.shadowing.find(s => s.topic === g)?.level;
  const allTopics = [...new Set(data.shadowing.map(s => s.topic))];
  const list = h('div.stack');
  const topicsBox = h('div.stack');
  let topic = null;
  // одна фраза розгорнута (еталон, повільно, запис), решта — компактні рядки: дотик розгортає
  let active = 0;
  const drawList = () => {
    cancelRecordings(); stopSpeech();
    const items = data.shadowing.filter(s => s.topic === topic);
    if (active >= items.length) active = 0;
    list.replaceChildren(...items.map((s, i) => i === active ? practiceBlock(s.en, timer, { uk: s.uk })
      : txRow({ no: i + 1, label: h('span', { lang: 'en' }, s.en), sub: s.uk, cls: 'pr-row', chevron: false, attrs: { 'aria-expanded': 'false' },
        onclick: () => { active = i; drawList(); list.children[i]?.querySelector('button')?.focus({ preventScroll: true }); } })));
  };
  const drawTopics = () => {
    const { items, fallback } = filterByLevel(allTopics, levelPick('shadowing'), lvOf);
    const groups = byFit(items, lvOf);
    if (wantTopic && allTopics.includes(wantTopic)) { topic = wantTopic; wantTopic = null; if (!groups.includes(topic)) groups.unshift(topic); }
    if (!groups.includes(topic)) topic = groups[0] || null;
    topicsBox.replaceChildren(fallbackNote(fallback),
      h('div.chips.scroll', groups.map(g => h('button.chip', { type: 'button', 'aria-pressed': String(g === topic), onclick: (e) => { topic = g; active = 0; e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget))); drawList(); } }, lvOf(g) ? `${g} · ${lvOf(g)}` : g))));
    drawList();
  };
  const counts = levelCounts(allTopics, lvOf);
  box.replaceChildren(h('div.stack',
    levelChips('shadowing', counts, drawTopics), topicsBox, list));
  drawTopics();
}

function pairs(box, data, timer) {
  const all = data.pairs.slice().sort(() => Math.random() - 0.5).slice(0, 10);
  let i = 0, right = 0;
  const step = () => {
    cancelRecordings();
    if (i >= all.length) {
      timer.poke();
      const tone = right >= 8 ? 'good' : right >= 5 ? 'warn' : 'bad';
      box.replaceChildren(h('div.stack-lg.gx.pr',
        h('section.tx-group',
          txResult({ icon: right >= 8 ? 'trophy' : 'ear', tone, label: 'Пари слів · результат', title: right >= 8 ? 'Чудовий слух!' : right >= 5 ? 'Непогано — ще трохи практики' : 'Варто потренуватися ще' }),
          txKpis([
            { value: right, unit: `/${all.length}`, label: 'розпізнано на слух', tone, ariaLabel: `Правильно розпізнано на слух: ${right} з ${all.length}` },
            { value: all.length - right, label: plural(all.length - right, 'помилка', 'помилки', 'помилок'), tone: all.length - right ? 'bad' : 'good' },
          ], 2)),
        txPrimary({ icon: 'arrow-clockwise', label: 'Ще раунд', sub: '10 нових пар слів', onclick: () => pairs(box, data, timer) })));
      return;
    }
    const p = all[i];
    const target = Math.random() < 0.5 ? 'a' : 'b';
    const word = p[target];
    const fb = h('div');
    const sayBox = h('div');
    const choose = (k) => {
      if (fb.firstChild) return;
      document.removeEventListener('keydown', onKey);
      const ok = k === target;
      if (ok) right++; else addMistake({ wrong: p[k], right: word, type: 'pronunciation', explanation_uk: `Мінімальна пара ${p.a}/${p.b}${p.tip ? `: ${p.tip}` : ''}`, source: 'exercise' });
      btnA.classList.add(target === 'a' ? 'right' : 'wrong'); btnB.classList.add(target === 'b' ? 'right' : 'wrong');
      if (k === target) (k === 'a' ? btnB : btnA).classList.remove('wrong');
      fb.replaceChildren(h('div.feedback.ex-fb.' + (ok ? 'ok' : 'no'),
        h('span.ex-fb-ic', ic(ok ? 'check-circle' : 'x-circle', { size: 20, fill: true })),
        h('div.ex-fb-t', h('b', ok ? 'Правильно!' : `Звучало: ${word}`), p.tip ? h('div.dim', p.tip) : null)));
      sayBox.replaceChildren(h('h2.tx-label.pr-say', 'Тепер скажіть самі'),
        h('div.stack', practiceBlock(p.a, timer, { uk: p.ipaA }), practiceBlock(p.b, timer, { uk: p.ipaB })),
        h('button.btn.primary.block', { type: 'button', onclick: () => { i++; step(); } }, 'Далі'));
    };
    const btnA = h('button.opt.ex-opt', { type: 'button', onclick: () => choose('a') }, h('span.ex-key', { 'aria-hidden': 'true' }, '1'), h('b.grow', p.a), h('span.ipa.small', p.ipaA || ''));
    const btnB = h('button.opt.ex-opt', { type: 'button', onclick: () => choose('b') }, h('span.ex-key', { 'aria-hidden': 'true' }, '2'), h('b.grow', p.b), h('span.ipa.small', p.ipaB || ''));
    box.replaceChildren(h('div.stack',
      h('div.ex-head', h('div.ex-head-t', h('h2.tx-label', 'Пари слів'), h('span.tx-pill.accent.num', `${i + 1}/${all.length}`)), progress(i / all.length * 100, 'Пройдено пар')),
      h('div.center.stack.pr-listen',
        h('div.small.dim', `Звук: ${p.sound}`),
        h('button.pr-big', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(word) }, ic('speaker-high', { size: 40 })),
        h('div.small.dim', 'Що ви почули?')),
      h('div.ex-opts', btnA, btnB), fb, sayBox));
    // клавіші 1 / 2 — вибір варіанта; слухач знімається, щойно пара зникла з екрана
    const onKey = (e) => {
      if (!btnA.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (fb.firstChild || e.ctrlKey || e.metaKey || e.altKey || btnA.closest('[inert]') || e.target?.closest?.('input,textarea,select')) return;
      if (e.key === '1' || e.key === '2') { e.preventDefault(); choose(e.key === '1' ? 'a' : 'b'); }
    };
    document.addEventListener('keydown', onKey);
    setTimeout(() => speak(word), 300);
  };
  step();
}

function sounds(box, data, timer) {
  // кожен звук — плитка: символ МФА в квадратику, назва, підказка; розгортається з поясненням і тренуванням
  // 6 звуків на виду, решта — «Показати всі»
  box.replaceChildren(moreRows(data.sounds.map(s => h('details.gx-sound',
    h('summary.gx-sound-head',
      h('span.gx-ipa', { style: { fontSize: s.symbol.length > 2 ? '14px' : '19px' } }, s.symbol),
      h('span.tx-body', h('span.tx-l', s.title), h('span.tx-s', s.short)),
      ic('caret-down', { size: 16 })),
    h('div.stack.gx-sound-body',
      h('div.small', s.tip),
      h('div.chips', s.words.map(w => h('button.chip', { type: 'button', onclick: () => speak(w) }, ic('speaker-high', { size: 16 }), w))),
      practiceBlock(s.sentence, timer))))));
}
