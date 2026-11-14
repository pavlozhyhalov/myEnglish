// «Знайомство» (#/welcome): один крок — один екран, крапки прогресу, кожен крок можна пропустити, «Назад».
// Повне (новий учень): ім'я → цілі → час на день → рівень (швидкий тест або вибір) → перша розмова.
// Коротке (?short=1 — у учня вже є історія): ім'я → цілі. Коли показувати — welcomeMode()/welcomeRedirect() у js/start.js.
import { h, ic } from '../ui/dom.js';
import * as store from '../store.js';
import { user } from '../supa.js';
import { toast } from '../ui/toast.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { tx, txGrid, txRow, txRows } from '../ui/tiles.js';
import { LEVELS, LEVEL_NAME, LEVEL_DESC, myLevel, setLevel } from '../level.js';
import { GOAL_OPTIONS, goalTags, saveGoals, markOnboarded, beginStart, firstTalkHref } from '../start.js';

const FULL = ['name', 'goals', 'time', 'level', 'talk'];
const SHORT = ['name', 'goals'];
const TIMES = [
  { v: 5, sub: 'Легкий старт' },
  { v: 10, sub: 'Звичка' },
  { v: 15, sub: 'Рекомендуємо' },
  { v: 20, sub: 'Інтенсивно' },
];
const LIM = { name: 40, address: 40 };

export default function welcome(view, r) {
  const short = r.query.short === '1';
  const steps = short ? SHORT : FULL;
  const step = steps.includes(r.query.step) ? r.query.step : steps[0];
  const i = steps.indexOf(step);
  setTitle(short ? 'Про вас' : 'Знайомство');
  setFocus(true);
  if (!short) beginStart();

  const q = (s) => `#/welcome?step=${s}${short ? '&short=1' : ''}`;
  const next = () => { if (i < steps.length - 1) location.hash = q(steps[i + 1]); else finish(); };
  const finish = (to = '#/') => {
    markOnboarded(short ? { short: true } : {});
    if (short && to === '#/') toast('Дякуємо! Вчитель урахує це в розмовах');
    location.hash = to;
  };

  // верх: «Назад», крапки кроків, «Пропустити»
  const top = h('div.wl-top',
    i > 0 ? h('a.icon-btn.wl-back', { href: q(steps[i - 1]), 'aria-label': 'Назад' }, ic('arrow-left')) : h('span.wl-back-sp'),
    h('div.wl-dots', { role: 'img', 'aria-label': `Крок ${i + 1} з ${steps.length}` },
      steps.map((s, k) => h('i' + (k < i ? '.done' : k === i ? '.on' : '')))),
    h('button.wl-skip', { type: 'button', onclick: () => (step === 'talk' ? finish() : next()) }, 'Пропустити'));

  const head = (icon, title, sub) => h('div.wl-head',
    h('span.wl-ic', { 'aria-hidden': 'true' }, ic(icon, { size: 28 })),
    h('h1.wl-h', title), sub ? h('p.wl-sub', sub) : null);

  const body = ({ name: stepName, goals: stepGoals, time: stepTime, level: stepLevel, talk: stepTalk })[step]();
  view.replaceChildren(h('div.wl', top, body));
  // фокус на першому полі — лише на комп'ютері (на телефоні клавіатура закрила б половину екрана)
  const first = view.querySelector('input');
  if (first && matchMedia('(hover:hover) and (pointer:fine)').matches) first.focus();

  // пішли зі «Знайомства» в інший розділ — більше не перенаправляємо (позначка partial; завершення її замінить)
  return () => {
    setFocus(false);
    if (!/^#\/welcome/.test(location.hash)) markOnboarded({ partial: true, ...(short ? { short: true } : {}) });
  };

  // ---------- а) звертання ----------
  function stepName() {
    const a = store.prof().about || {};
    const field = (key, label, placeholder, hint) => {
      const id = `wl-${key}`;
      return h('div.field.wl-field', h('label', { for: id }, label),
        h('input.input', { id, type: 'text', value: a[key] || '', placeholder, maxlength: LIM[key], autocomplete: key === 'name' ? 'given-name' : 'off', autocapitalize: 'words', enterkeyhint: 'next', 'aria-describedby': hint ? `${id}-h` : null }),
        hint ? h('div.xs.dim', { id: `${id}-h` }, hint) : null);
    };
    const name = field('name', 'Ім\'я латиницею', 'Наприклад: Olena', 'Так вас називатиме вчитель англійською');
    const addr = field('address', 'Звертання українською', 'Наприклад: Олено', 'Для привітання на головній');
    const save = () => {
      const about = { ...(store.prof().about || {}) };
      about.name = name.querySelector('input').value.trim().slice(0, LIM.name);
      about.address = addr.querySelector('input').value.trim().slice(0, LIM.address);
      store.setProf({ about });
    };
    const form = h('form.wl-form', { onsubmit: (e) => { e.preventDefault(); save(); next(); } },
      head('hand-waving', 'Як до вас звертатися?'),
      h('div.wl-card', name, addr),
      h('button.btn.primary.block.wl-go', { type: 'submit' }, 'Далі', ic('arrow-right', { size: 18 })));
    name.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addr.querySelector('input').focus(); } });
    return form;
  }

  // ---------- б) цілі ----------
  function stepGoals() {
    const sel = new Set(goalTags());
    const go = h('button.btn.primary.block.wl-go', { type: 'button', onclick: () => { saveGoals([...sel]); next(); } });
    const upd = () => go.replaceChildren(sel.size ? 'Далі' : 'Далі без цілі', ic('arrow-right', { size: 18 }));
    upd();
    const tiles = GOAL_OPTIONS.map(g => {
      const t = tx({ icon: g.icon, label: g.label, cls: 'wl-opt', on: sel.has(g.tag), attrs: { 'aria-pressed': String(sel.has(g.tag)) }, onclick: () => {
        sel.has(g.tag) ? sel.delete(g.tag) : sel.add(g.tag);
        const on = sel.has(g.tag);
        t.classList.toggle('on', on); t.setAttribute('aria-pressed', String(on));
        t.querySelector('.tx-sq').replaceChildren(ic(g.icon, { size: 20, fill: on }));
        upd();
      } });
      return t;
    });
    return h('div.wl-form',
      head('target', 'Навіщо вам англійська?', 'Можна кілька — під них вчитель добиратиме теми'),
      h('div.wl-grid', { role: 'group', 'aria-label': 'Цілі' }, txGrid(tiles, 2)),
      go);
  }

  // ---------- в) час на день ----------
  function stepTime() {
    const own = store.prof().settings?.dailyGoal;
    const tiles = TIMES.map(t => tx({ label: `${t.v} хв`, sub: t.sub, cls: 'wl-opt wl-time', on: own === t.v, attrs: { 'aria-pressed': String(own === t.v) }, onclick: () => {
      store.setSetting('dailyGoal', t.v);
      tiles.forEach(x => { const on = x === tiles[TIMES.indexOf(t)]; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      setTimeout(next, 180);
    } }));
    return h('div.wl-form',
      head('clock', 'Скільки часу на день?', 'Мета дня — її завжди можна змінити в «Налаштуваннях»'),
      h('div.wl-grid', { role: 'group', 'aria-label': 'Хвилин на день' }, txGrid(tiles, 2)));
  }

  // ---------- г) рівень ----------
  function stepLevel() {
    const p = store.prof();
    const quickDone = store.all('tests').some(t => t.type === 'placement');
    const known = !!p.levelSource;
    const list = h('div.wl-levels', { hidden: true });
    const lv = myLevel();
    list.append(txRows(LEVELS.map(l => txRow({ icon: null, no: l, label: LEVEL_NAME[l], sub: LEVEL_DESC[l], on: known && lv === l, cls: 'wl-lvl', chevron: false,
      onclick: () => { setLevel(l, 'manual'); toast(`Рівень ${l}: план підлаштовано`); next(); } }))));
    const pick = tx({ wide: true, icon: 'list', label: 'Я знаю свій рівень', sub: 'A1–C1 · оберу сам', attrs: { 'aria-expanded': 'false' }, end: ic('caret-down', { size: 16 }), onclick: () => {
      list.hidden = !list.hidden; pick.setAttribute('aria-expanded', String(!list.hidden));
      if (!list.hidden) list.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } });
    return h('div.wl-form',
      head('graduation-cap', 'Ваш рівень', known ? `Зараз: ${lv} · ${LEVEL_NAME[lv]}` : 'Від нього залежать уроки, слова й мова вчителя'),
      tx({ wide: true, primary: true, on: true, icon: 'lightning', label: quickDone ? 'Пройти швидкий тест ще раз' : 'Швидкий тест · ~10 хв', sub: 'Граматика, слова й читання', href: '#/tests/placement?quick=1&from=welcome' }),
      pick, list,
      known ? h('button.btn.soft.block.wl-go', { type: 'button', onclick: next }, `Лишити ${lv}`, ic('arrow-right', { size: 18 })) : null);
  }

  // ---------- ґ) перша розмова ----------
  function stepTalk() {
    const u = user();
    const primary = u
      ? tx({ wide: true, primary: true, on: true, icon: 'microphone', label: 'Поговорити з вчителем · 3 хв', sub: 'Тема: розкажіть про себе', onclick: () => finish(firstTalkHref()) })
      : tx({ wide: true, primary: true, on: true, icon: 'key', label: 'Увійти й поговорити', sub: 'Вчитель працює після входу · безкоштовно', onclick: () => finish('#/auth?tab=up') });
    return h('div.wl-form',
      head('chat-circle-dots', 'Перша розмова', 'Вчитель познайомиться з вами й підбере план'),
      primary,
      h('button.btn.ghost.block.wl-go', { type: 'button', onclick: () => finish('#/') }, 'Пізніше'));
  }
}
