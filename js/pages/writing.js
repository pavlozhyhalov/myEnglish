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
  // завдання дня — те саме, що в «Завданнях рівня» на головній
  const day = pickOfDay(filterByLevel(all.filter(x => x.group !== 'work'), 'mine').items, 'writing');
  // завдання вибраного рівня: до 6, решта — «Показати всі»
  const list = h('div.stack');
  let open = false;
  const draw = () => {
    const sel = levelPick('writing');
    const { items, fallback } = filterByLevel(tasks, sel);
    const sorted = byFit(items);
    const rest = sorted.filter(t => t !== day);   // завдання дня — головна дія вгорі
    const shown = open ? sorted : rest.slice(0, 6);
    list.replaceChildren(fallbackNote(fallback), txRows([...shown.map(t => sqEmo(txRow({ icon: 'envelope-simple', label: t.title, sub: `${t.kindLabel} · ${t.words} слів`,
      href: `#/writing/${t.id}`, end: sel === 'all' || fallback ? levelTag(t.level) : null }), t.emoji || 'envelope')),
      !open && rest.length > 6 ? txRow({ icon: 'caret-down', label: `Показати всі · ${sorted.length}`, chevron: false, cls: 'tx-showall', onclick: () => { open = true; draw(); } }) : null]));
  };
  view.replaceChildren(h('div.stack-lg',
    day ? sqEmo(txPrimary({ icon: 'envelope-simple', label: day.title, sub: `Завдання дня · ${day.kindLabel} · ${day.words} слів`, href: `#/writing/${day.id}` }), day.emoji || 'envelope') : null,
    txGroup('Листи, повідомлення й есе', [levelChips('writing', levelCounts(tasks), () => { open = false; draw(); }), list]),
    txGroup('Свій текст', tx({ icon: 'sparkle', label: 'Перевірити довільний текст', sub: 'Вчитель виправить і пояснить', wide: true, href: '#/tutor?mode=check' }))));
  draw();
}

function taskView(view, t) {
  setTitle('Письмо');   // назва завдання — один раз, у шапці сторінки нижче
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
  view.replaceChildren(h('div.stack-lg.wr',
    h('div.gx-lhead', h('a.icon-btn', { href: '#/writing', 'aria-label': 'До завдань' }, ic('arrow-left')),
      h('div.grow', h('div.tx-label.gx-eyebrow', `${t.level ? t.level + ' · ' : ''}${t.kindLabel}`), h('h2.gx-lh1', t.title))),
    txGroup('Завдання', h('section.gx-card.stack.wr-task', h('div', t.task), t.context ? h('div.small.dim', t.context) : null)),
    txGroup('Шаблони фраз · торкніться, щоб вставити', h('div.stack.wr-phr',
      t.phrases.map(g => h('details.wr-gl', { open: g === t.phrases[0] ? true : null },
        h('summary.wr-gl-head', h('span.tx-sq', ic('quotes', { size: 18 })), h('span.tx-body', h('span.tx-l', g.group), h('span.tx-s', `${g.items.length} ${plural(g.items.length, 'фраза', 'фрази', 'фраз')}`)), ic('caret-down', { size: 18 })),
        h('div.chips.wr-chips', g.items.map(p => h('button.chip.wr-chip', { type: 'button', lang: 'en', onclick: () => insert(p) }, p))))))),
    txGroup('Ваш текст', [ta, h('div.wr-wc', wc)]),
    txPrimary({ icon: 'sparkle', label: 'Перевірити у вчителя', sub: 'Виправлення, пояснення і природніша версія', onclick: () => {
      if (ta.value.trim().length < 20) { toast('Напишіть хоча б кілька речень'); return; }
      try { sessionStorage.setItem('me:draft', ta.value); } catch { /* */ }
      timer.stop();
      go(`/tutor?mode=check&kind=${t.kind}&task=${encodeURIComponent(t.task)}`);
    } }),
    t.sample ? h('details.wr-gl.wr-sample',
      h('summary.wr-gl-head', h('span.tx-sq', ic('eye', { size: 18 })), h('span.tx-body', h('span.tx-l', 'Зразок відповіді'), h('span.tx-s', 'Подивіться після власної спроби')), ic('caret-down', { size: 18 })),
      h('div.gx-card.small.wr-sample-t', { lang: 'en' }, t.sample)) : null));
  return () => timer.stop();
}
