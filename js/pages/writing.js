// Письмо: завдання, шаблони фраз, перевірка вчителем
import { plural } from '../strings.js';
import { h, ic, emo } from '../ui/dom.js';
import { writingTasks } from '../data.js';
import * as store from '../store.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { setTitle } from '../ui/shell.js';
import { activityTimer } from '../stats.js';
import { byFit, levelTag, myLevel, levelChips, levelCounts, levelPick, filterByLevel, fallbackNote, pickOfDay } from '../level.js';
import { tx, txPrimary, txGroup, txRow, txRows } from '../ui/tiles.js';

/** Іконка з мапи emo() у квадратику плитки (дані завдань зберігають назви emo) */
const sqEmo = (el, name) => { const e = emo(name); e.setAttribute('width', 18); e.setAttribute('height', 18); el.querySelector('.tx-sq')?.replaceChildren(e); return el; };

const DRAFT_KEY = (id) => `me:wdraft:${id}`;

export default async function writing(view, r) {
  const all = await writingTasks();
  // робочі завдання — лише коли увімкнено «Професійний контекст» (фокус курсу — загальна англійська)
  const tasks = store.settings().workFocus ? all : all.filter(t => t.group !== 'work');
  if (r.parts[0]) {
    const t = all.find(x => x.id === r.parts[0]);
    if (t) return taskView(view, t);
  }
  const list = h('div.stack');
  const draw = () => {
    const { items, fallback } = filterByLevel(tasks, levelPick('writing'));
    list.replaceChildren(fallbackNote(fallback), txRows(byFit(items).map(t => sqEmo(txRow({ icon: 'envelope-simple', label: t.title, sub: `${t.kindLabel} · ${t.words} слів`,
      href: `#/writing/${t.id}`, end: levelTag(t.level) }), t.emoji || 'envelope'))));
  };
  // завдання дня — те саме, що в «Завданнях рівня» на головній
  const day = pickOfDay(filterByLevel(all.filter(x => x.group !== 'work'), 'mine').items, 'writing');
  view.replaceChildren(h('div.stack-lg',
    day ? sqEmo(txPrimary({ icon: 'envelope-simple', label: day.title, sub: `Завдання дня · ${day.kindLabel} · ${day.words} слів`, href: `#/writing/${day.id}` }), day.emoji || 'envelope') : null,
    txGroup(`Листи, повідомлення й есе · ваш рівень ${myLevel()}`, levelChips('writing', levelCounts(tasks), draw)), list,
    txGroup('Свій текст', tx({ icon: 'sparkle', label: 'Перевірити довільний текст', sub: 'Лист чи повідомлення — вчитель виправить і пояснить', wide: true, href: '#/tutor?mode=check' }))));
  draw();
}

function taskView(view, t) {
  setTitle(t.title);
  const timer = activityTimer('writing');
  let saved = '';
  try { saved = localStorage.getItem(DRAFT_KEY(t.id)) || ''; } catch { /* */ }
  const ta = h('textarea.input', { rows: 12, placeholder: t.placeholder || 'Write your text here…', 'aria-label': 'Ваш текст', value: saved, spellcheck: 'true', lang: 'en' });
  const wc = h('span.xs.dim');
  const upd = () => {
    const n = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
    wc.textContent = `${n} ${plural(n, 'слово', 'слова', 'слів')}${t.words ? ` · рекомендовано ${t.words}` : ''}`;
    try { localStorage.setItem(DRAFT_KEY(t.id), ta.value); } catch { /* */ }
  };
  ta.addEventListener('input', upd); upd();
  const insert = (text) => {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    const before = ta.value.slice(0, s), after = ta.value.slice(e);
    const sep = before && !/\s$/.test(before) ? (text.startsWith('\n') ? '' : ' ') : '';
    ta.value = before + sep + text + after;
    const pos = (before + sep + text).length;
    ta.focus(); ta.setSelectionRange(pos, pos);
    upd(); toast('Вставлено');
  };
  view.replaceChildren(h('div.stack-lg',
    h('div.row', h('a.icon-btn', { href: '#/writing', 'aria-label': 'Назад' }, ic('arrow-left')), h('div.grow', h('div.xs.dim', t.kindLabel), h('h1', { style: { margin: 0 } }, t.title))),
    h('section.card.accent.stack', h('div.section-title', 'Завдання'), h('div', t.task), t.context ? h('div.small.dim', t.context) : null),
    h('section.stack', { style: { gap: '8px' } }, h('div.section-title', 'Шаблони фраз — торкніться, щоб вставити'),
      t.phrases.map(g => h('details.card', { open: g === t.phrases[0] ? true : null },
        h('summary.small', g.group),
        h('div.chips', { style: { marginTop: '10px' } }, g.items.map(p => h('button.chip', { type: 'button', style: { whiteSpace: 'normal', textAlign: 'left', background: 'var(--surface-2)' }, onclick: () => insert(p) }, p)))))),
    h('section.stack', { style: { gap: '6px' } }, ta, wc),
    h('button.btn.primary.lg.block', { type: 'button', onclick: () => {
      if (ta.value.trim().length < 20) { toast('Напишіть хоча б кілька речень'); return; }
      try { sessionStorage.setItem('me:draft', ta.value); } catch { /* */ }
      timer.stop();
      go(`/tutor?mode=check&kind=${t.kind}&task=${encodeURIComponent(t.task)}`);
    } }, ic('sparkle', { fill: true }), 'Перевірити у вчителя'),
    t.sample ? h('details.card', h('summary.small.dim', 'Зразок відповіді'), h('div.small', { style: { whiteSpace: 'pre-wrap', marginTop: '8px' } }, t.sample)) : null));
  return () => timer.stop();
}
