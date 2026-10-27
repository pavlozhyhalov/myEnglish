// Вимова: shadowing, мінімальні пари, проблемні звуки
import { h, ic, emo, seg, progress } from '../ui/dom.js';
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
    view.replaceChildren(h('div.stack-lg', h('p.small.dim', { style: { margin: '0 2px' } }, 'Звуки, які найважче даються україномовним: як їх вимовляти, приклади і тренування.'), body));
    sounds(body, data, timer);
    return () => { cancelRecordings(); stopSpeech(); timer.stop(); };
  }
  let tab = r.query.tab === 'pairs' ? 'pairs' : 'shadowing';
  wantTopic = r.query.topic || null;   // посилання з головної відкриває конкретну тему
  view.replaceChildren(h('div.stack-lg', seg([['shadowing', 'Повтор фраз'], ['pairs', 'Пари слів']], tab, v => { tab = v; draw(); }), body));
  const draw = () => { cancelRecordings(); stopSpeech(); ({ shadowing, pairs })[tab](body, data, timer); };
  draw();
  return () => { cancelRecordings(); stopSpeech(); timer.stop(); };
}

/** AI-оцінка доступна: вхід, мережа, запис аудіо */
export const aiReady = () => !!user() && navigator.onLine && canRecord();

/** Тривалість запису за довжиною фрази: 5–15 с */
const maxMsFor = (text) => Math.min(15000, Math.max(5000, 3000 + text.split(/\s+/).length * 900));

const WSTYLE = {
  ok: { icon: 'check-circle', color: 'var(--good)', bg: 'var(--good-soft)', label: 'правильно' },
  minor: { icon: 'warning-circle', color: 'var(--warn)', bg: 'var(--warn-soft)', label: 'майже' },
  wrong: { icon: 'x-circle', color: 'var(--bad)', bg: 'var(--bad-soft)', label: 'помилка' },
  missed: { icon: 'x-circle', color: 'var(--bad)', bg: 'var(--bad-soft)', label: 'пропущено' },
};
const scoreClass = (n) => (n >= 80 ? 'good' : n >= 55 ? 'warn' : 'bad');
const scoreLabel = (n) => (n >= 90 ? 'Відмінно' : n >= 80 ? 'Дуже добре' : n >= 65 ? 'Добре' : n >= 45 ? 'Є над чим попрацювати' : 'Спробуйте ще раз');

/** Слово з кольором і значком (колір — не єдина ознака: значок + підпис для читачів екрана) */
function wordChip(w) {
  const st = WSTYLE[w.status] || WSTYLE.ok;
  return h('span.pron-word', {
    style: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 6px', margin: '2px', borderRadius: '8px', background: st.bg, color: st.color, fontWeight: 600, textDecoration: w.status === 'missed' ? 'line-through' : 'none' },
    dataset: { status: w.status },
  }, ic(st.icon, { size: 16 }), w.word, h('span.sr-only', `, ${st.label}`));
}

/**
 * Відмалювати результат AI-оцінки. Текст від AI — лише текстовими вузлами (h → textContent).
 * compact — для карток: оцінка, слова й одна порада.
 */
export function renderAssessment(res, { compact = false } = {}) {
  const bad = res.words.filter(w => w.status !== 'ok' && (w.issue_uk || w.tip_uk));
  return h('div.stack.pron-result', { style: { gap: '10px' } },
    h('div.row', { style: { alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
      h('b.num', { class: scoreClass(res.score), style: { fontSize: compact ? 'var(--fs-lg)' : 'var(--fs-2xl)' }, 'aria-label': `Оцінка ${res.score} зі 100` }, String(res.score)),
      h('span.dim', '/100'), h('span', { class: scoreClass(res.score), style: { fontWeight: 600 } }, res.no_speech ? 'Мовлення не почуто' : scoreLabel(res.score))),
    h('div', { style: { fontSize: compact ? '' : 'var(--fs-lg)', lineHeight: 1.7 } }, res.words.map(wordChip)),
    res.heard ? h('div.xs.dim', `Почуто: «${res.heard}»`) : null,
    !compact && bad.length ? h('ul.stack', { style: { margin: 0, paddingLeft: 0, listStyle: 'none', gap: '6px' } },
      bad.map(w => h('li.small', h('b', { style: { color: WSTYLE[w.status].color } }, w.word), w.issue_uk ? ` — ${w.issue_uk}` : '', w.tip_uk ? h('div.dim', w.tip_uk) : null))) : null,
    h('div.stack', { style: { gap: '6px' } }, (compact ? res.tips.slice(0, 1) : res.tips).map(t =>
      h('div.row.small', { style: { alignItems: 'flex-start', gap: '6px' } }, h('span', { style: { color: 'var(--accent-ink)', flex: 'none' } }, ic('lightbulb', { size: 18 })), h('span', t)))));
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
  const out = h('div.small', { 'aria-live': 'polite' });
  let ctrl = null;
  const actions = h('div.row.wrap');
  const setIdle = () => {
    ctrl = null;
    rec.disabled = false; rec.classList.remove('danger');
    rec.replaceChildren(ic('microphone', { fill: true }), 'Записати себе');
    rec.removeAttribute('aria-pressed');
  };
  const again = () => h('div.row.wrap',
    h('button.btn.soft', { type: 'button', onclick: () => speak(text) }, ic('speaker-high'), 'Прослухати еталон'),
    h('button.btn.soft', { type: 'button', onclick: () => start() }, ic('arrow-clockwise'), 'Ще раз'));

  // Безкоштовна перевірка: розпізнавання браузера (або транскрипція) + порівняння слів
  const free = async () => {
    rec.disabled = true; out.textContent = 'Слухаю… говоріть';
    try {
      const res = await listen(t => { out.textContent = t; });
      const cmp = compareWords(text, res.text);
      timer.poke();
      out.replaceChildren(
        h('div', { style: { fontSize: 'var(--fs-lg)' } }, cmp.words.map(w => [h('span', { class: w.ok ? 'word-ok' : 'word-no' }, w.raw), ' '])),
        h('div', h('b', { class: cmp.pct >= 80 ? 'good' : cmp.pct >= 50 ? 'warn' : 'bad' }, `${cmp.pct}%`), h('span.dim', ` · почуто: «${res.text || '—'}»`)));
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
          rec.disabled = false; rec.classList.add('danger'); rec.setAttribute('aria-pressed', 'true');
          rec.replaceChildren(ic('stop', { fill: true }), 'Готово');
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

  const rec = h('button.btn.primary', { type: 'button', onclick: () => {
    if (ctrl) { rec.disabled = true; ctrl.abort(); return; }   // «Готово»: запис зупиняється й іде на оцінку
    start();
  } }, ic('microphone', { fill: true }), 'Записати себе');
  actions.append(
    h('button.btn.soft', { type: 'button', onclick: () => speak(text) }, ic('speaker-high'), 'Прослухати'),
    h('button.btn.soft', { type: 'button', onclick: () => speak(text, { rate: 0.7 }) }, ic('speaker-high'), 'Повільно'),
    rec);
  return h('div.card.stack',
    h('div.row', h('div.grow', h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 } }, text), uk ? h('div.xs.dim', uk) : null)),
    actions, out);
}

function shadowing(box, data, timer) {
  // теми вибраного рівня (за замовчуванням — мого); зміна рівня змінює набір фраз
  const lvOf = (g) => data.shadowing.find(s => s.topic === g)?.level;
  const allTopics = [...new Set(data.shadowing.map(s => s.topic))];
  const list = h('div.stack');
  const topicsBox = h('div.stack');
  let topic = null;
  const drawList = () => cancelRecordings() || list.replaceChildren(...data.shadowing.filter(s => s.topic === topic).map(s => practiceBlock(s.en, timer, { uk: s.uk })));
  const drawTopics = () => {
    const { items, fallback } = filterByLevel(allTopics, levelPick('shadowing'), lvOf);
    const groups = byFit(items, lvOf);
    if (wantTopic && allTopics.includes(wantTopic)) { topic = wantTopic; wantTopic = null; if (!groups.includes(topic)) groups.unshift(topic); }
    if (!groups.includes(topic)) topic = groups[0] || null;
    topicsBox.replaceChildren(fallbackNote(fallback),
      h('div.chips.scroll', groups.map(g => h('button.chip', { type: 'button', 'aria-pressed': String(g === topic), onclick: (e) => { topic = g; e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget))); drawList(); } }, lvOf(g) ? `${g} · ${lvOf(g)}` : g))));
    drawList();
  };
  const counts = levelCounts(allTopics, lvOf);
  box.replaceChildren(h('div.stack',
    h('p.small.dim', aiReady() ? 'Прослухайте фразу й повторіть з тією самою інтонацією і в тому самому темпі. AI оцінить вимову кожного слова й підкаже, що виправити.' : 'Прослухайте фразу й повторіть з тією самою інтонацією і в тому самому темпі. Зелене — збіг, червоне — розпізнано інакше. Після входу — детальна AI-оцінка вимови.'),
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
      box.replaceChildren(h('div.hero', emo(right >= 8 ? 'trophy' : 'ear', 'xl'), h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, `${right}/${all.length}`), h('p.dim', 'Правильно розпізнано на слух'),
        h('button.btn.primary', { type: 'button', onclick: () => pairs(box, data, timer) }, 'Ще раунд')));
      return;
    }
    const p = all[i];
    const target = Math.random() < 0.5 ? 'a' : 'b';
    const word = p[target];
    const fb = h('div');
    const sayBox = h('div');
    const choose = (k) => {
      if (fb.firstChild) return;
      const ok = k === target;
      if (ok) right++; else addMistake({ wrong: p[k], right: word, type: 'pronunciation', explanation_uk: `Мінімальна пара ${p.a}/${p.b}: ${p.tip || ''}`, source: 'exercise' });
      btnA.classList.add(target === 'a' ? 'right' : 'wrong'); btnB.classList.add(target === 'b' ? 'right' : 'wrong');
      if (k === target) (k === 'a' ? btnB : btnA).classList.remove('wrong');
      fb.replaceChildren(h('div.feedback.' + (ok ? 'ok' : 'no'), ok ? 'Правильно!' : `Звучало: ${word}`, p.tip ? h('div.dim', p.tip) : null));
      sayBox.replaceChildren(h('div.section-title', 'Тепер скажіть самі'),
        h('div.stack', practiceBlock(p.a, timer, { uk: p.ipaA }), practiceBlock(p.b, timer, { uk: p.ipaB })),
        h('button.btn.primary.block', { type: 'button', onclick: () => { i++; step(); } }, 'Далі'));
    };
    const btnA = h('button.opt', { type: 'button', onclick: () => choose('a') }, h('b.grow', p.a), h('span.ipa.small', p.ipaA || ''));
    const btnB = h('button.opt', { type: 'button', onclick: () => choose('b') }, h('b.grow', p.b), h('span.ipa.small', p.ipaB || ''));
    box.replaceChildren(h('div.stack',
      h('div.row', h('div.grow', progress(i / all.length * 100, 'Пройдено фраз')), h('span.xs.dim', `${i + 1}/${all.length}`)),
      h('div.center.stack', h('div.small.dim', `Звук: ${p.sound}`),
        h('button.icon-btn.soft', { type: 'button', style: { width: '88px', height: '88px', borderRadius: '50%', margin: '0 auto' }, 'aria-label': 'Прослухати', onclick: () => speak(word) }, ic('speaker-high', { size: 40 })),
        h('div.small.dim', 'Що ви почули?')),
      btnA, btnB, fb, sayBox));
    setTimeout(() => speak(word), 300);
  };
  step();
}

function sounds(box, data, timer) {
  box.replaceChildren(h('div.stack', data.sounds.map(s => h('details.card',
    h('summary.row', h('div.emoji-circle', { style: { minWidth: '48px', width: 'auto', padding: '0 8px', height: '48px', fontFamily: 'var(--font-ipa)', fontSize: s.symbol.length > 2 ? '16px' : '22px', fontWeight: 600, color: 'var(--accent-ink)' } }, s.symbol),
      h('div.grow', h('div', { style: { fontWeight: 600 } }, s.title), h('div.xs.dim', s.short)), ic('caret-down', { size: 18 })),
    h('div.stack', { style: { marginTop: '12px' } },
      h('div.small', s.tip),
      h('div.chips', s.words.map(w => h('button.chip', { type: 'button', onclick: () => speak(w) }, ic('speaker-high', { size: 16 }), w))),
      practiceBlock(s.sentence, timer))))));
}
