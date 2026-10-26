// Вимова: shadowing, мінімальні пари, проблемні звуки
import { h, ic, emo, seg, progress } from '../ui/dom.js';
import { pronunciation as loadData } from '../data.js';
import { speak, stop as stopSpeech, recognize, canRecognize, recordAndTranscribe, compareWords } from '../speech.js';
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

export default async function pronunciation(view, r) {
  const data = await loadData();
  const timer = activityTimer('pronunciation');
  const body = h('div');
  // Теорія: звуки з підказками артикуляції — окрема сторінка #/pronunciation/sounds
  if (r.parts[0] === 'sounds') {
    view.replaceChildren(h('div.stack-lg', h('p.small.dim', { style: { margin: '0 2px' } }, 'Звуки, які найважче даються україномовним: як їх вимовляти, приклади і тренування.'), body));
    sounds(body, data, timer);
    return () => { stopSpeech(); timer.stop(); };
  }
  let tab = r.query.tab === 'pairs' ? 'pairs' : 'shadowing';
  wantTopic = r.query.topic || null;   // посилання з головної відкриває конкретну тему
  view.replaceChildren(h('div.stack-lg', seg([['shadowing', 'Повтор фраз'], ['pairs', 'Пари слів']], tab, v => { tab = v; draw(); }), body));
  const draw = () => { stopSpeech(); ({ shadowing, pairs })[tab](body, data, timer); };
  draw();
  return () => { stopSpeech(); timer.stop(); };
}

/** Блок: еталон → запис → результат по словах */
function practiceBlock(text, timer, { uk, onResult } = {}) {
  const out = h('div.small');
  const rec = h('button.btn.primary', { type: 'button', onclick: async () => {
    stopSpeech();
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
    finally { rec.disabled = false; }
  } }, ic('microphone', { fill: true }), 'Записати себе');
  return h('div.card.stack',
    h('div.row', h('div.grow', h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 } }, text), uk ? h('div.xs.dim', uk) : null)),
    h('div.row.wrap',
      h('button.btn.soft', { type: 'button', onclick: () => speak(text) }, ic('speaker-high'), 'Прослухати'),
      h('button.btn.soft', { type: 'button', onclick: () => speak(text, { rate: 0.7 }) }, ic('speaker-high'), 'Повільно'),
      rec),
    out);
}

function shadowing(box, data, timer) {
  // теми вибраного рівня (за замовчуванням — мого); зміна рівня змінює набір фраз
  const lvOf = (g) => data.shadowing.find(s => s.topic === g)?.level;
  const allTopics = [...new Set(data.shadowing.map(s => s.topic))];
  const list = h('div.stack');
  const topicsBox = h('div.stack');
  let topic = null;
  const drawList = () => list.replaceChildren(...data.shadowing.filter(s => s.topic === topic).map(s => practiceBlock(s.en, timer, { uk: s.uk })));
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
    h('p.small.dim', 'Прослухайте фразу й повторіть з тією самою інтонацією і в тому самому темпі. Зелене — збіг, червоне — розпізнано інакше.'),
    levelChips('shadowing', counts, drawTopics), topicsBox, list));
  drawTopics();
}

function pairs(box, data, timer) {
  const all = data.pairs.slice().sort(() => Math.random() - 0.5).slice(0, 10);
  let i = 0, right = 0;
  const step = () => {
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
        h('div.row', practiceBlock(p.a, timer, { uk: p.ipaA }), practiceBlock(p.b, timer, { uk: p.ipaB })),
        h('button.btn.primary.block', { type: 'button', onclick: () => { i++; step(); } }, 'Далі'));
      sayBox.querySelector('.row').style.alignItems = 'stretch';
      sayBox.querySelectorAll('.row > .card').forEach(c => { c.style.flex = '1'; c.style.minWidth = '0'; });
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
