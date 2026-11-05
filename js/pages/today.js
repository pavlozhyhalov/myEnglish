// «Мій день за 15 хвилин» у мові плиток: кільце прогресу, показники, три кроки-рядки по черзі й одна головна синя дія
import { h, ic, ring } from '../ui/dom.js';
import { tx, txPrimary, txKpis, txGrid, txGroup, txRow, txBar } from '../ui/tiles.js';
import { plural } from '../strings.js';
import { streak, todaySeconds } from '../stats.js';
import { buildPlan, markStarted } from '../daily.js';
import { skel, skelLines } from '../ui/skeleton.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Кільце прогресу дня: стартує з нуля й плавно доходить до значення (без анімації — одразу) */
export function planRing(pct, { size = 176, stroke = 14, label, done = false } = {}) {
  const el = ring(pct, 100, { size, stroke, label });
  el.classList.add('plan-ring');
  if (done) el.classList.add('is-done');
  el.setAttribute('aria-label', `План дня виконано на ${pct}%`);
  const bar = el.querySelector('.bar');
  if (bar && !reduced() && pct > 0) {
    const target = bar.getAttribute('stroke-dashoffset');
    bar.setAttribute('stroke-dashoffset', bar.getAttribute('stroke-dasharray'));
    requestAnimationFrame(() => requestAnimationFrame(() => bar.setAttribute('stroke-dashoffset', target)));
  }
  return el;
}

/** Підпис головної кнопки: «Почати» → «Продовжити: крок» */
export function startLabel(plan) {
  if (!plan.next) return null;
  const any = plan.steps.some(s => !s.skipped && s.progress > 0);
  return any || plan.started ? `Продовжити: ${plan.next.title}` : `Почати · ${Math.round(plan.totalMin)} хв`;
}

/** Почати або продовжити план: позначка «розпочато» → наступний крок */
export function startNext(plan) {
  if (!plan.next) return;
  markStarted();
  location.hash = plan.next.href;
}

export default async function today(view) {
  const tok = view.__tok = (view.__tok || 0) + 1;
  view.replaceChildren(skeletonPage());
  const plan = await buildPlan();
  if (view.__tok !== tok) return;
  render(view, plan);
  // повернулися на вкладку (наприклад, після голосу в іншій вкладці) — план міг змінитися
  const onVis = () => { if (!document.hidden && view.isConnected) buildPlan().then(p => { if (view.isConnected && view.__tok === tok) render(view, p); }); };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}

function header() {
  const date = new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  // назва сторінки вже в шапці — тут дата й підказка (заголовок — для читачів екрана)
  return h('header.td-head',
    h('h1.sr-only', 'Мій день'),
    h('span.tx-label.td-date', date.charAt(0).toUpperCase() + date.slice(1)),
    h('p.dim.small', 'Три кроки по черзі — нічого не треба обирати.'));
}

function skeletonPage() {
  return h('div.stack-lg.td', { role: 'status', 'aria-label': 'Завантаження плану' },
    header(),
    h('section.tx.td-summary.td-static', skel({ w: '112px', ht: 112, r: '50%' }), h('div.grow.stack', { style: { gap: '10px' } }, skel({ w: '70%', ht: 18 }), skelLines(2))),
    h('div.tx-rows', [0, 1, 2].map(() => h('div.tx-row', skel({ w: '34px', ht: 34, r: '10px' }), h('div.grow.stack', { style: { gap: '8px' } }, skel({ w: '45%', ht: 14 }), skel({ w: '80%', ht: 10 }))))),
    skel({ ht: 64, r: '16px' }));
}

function render(view, plan) {
  const pct = Math.round(plan.progress * 100);
  const counted = plan.steps.filter(s => !s.skipped);
  const doneN = counted.filter(s => s.done).length;
  const leftMin = Math.max(0, Math.ceil(plan.totalMin - plan.doneMin));
  const label = plan.allDone
    ? h('span.td-ring-label', ic('check', { size: 36 }), h('span.sr-only', 'Виконано'))
    : h('span.td-ring-label', h('b.num', `${pct}%`), h('span.xs', `${Math.round(plan.doneMin)} з ${Math.round(plan.totalMin)} хв`));

  const summary = h('section.tx.td-summary.td-static' + (plan.allDone ? '.is-done' : ''),
    planRing(pct, { size: innerWidth < 360 ? 92 : 116, stroke: innerWidth < 360 ? 9 : 10, label, done: plan.allDone }),
    h('div.grow.stack', { style: { gap: '6px' } },
      plan.allDone
        ? [h('h2.td-title', 'День зараховано'), h('p.small.dim', `${Math.round(todaySeconds() / 60)} хв практики сьогодні · ${streakText()}`)]
        : [h('h2.td-title', counted.length ? (doneN ? `Готово ${doneN} з ${counted.length}` : `${counted.length} ${plural(counted.length, 'крок', 'кроки', 'кроків')} на сьогодні`) : 'План дня'),
          h('p.small.dim', leftMin ? `Залишилось ≈${leftMin} ${plural(leftMin, 'хвилина', 'хвилини', 'хвилин')}` : 'Майже готово')]));

  const k = streak();
  const mins = Math.round(todaySeconds() / 60);
  const kpis = txKpis([
    { value: mins, unit: 'хв', label: 'сьогодні' },
    { value: k, label: plural(k, 'день поспіль', 'дні поспіль', 'днів поспіль'), tone: k ? 'good' : '' },
    { value: `${doneN}/${counted.length}`, label: 'кроків готово', tone: plan.allDone ? 'good' : '' },
  ]);

  let n = 0;
  const steps = h('ol.tx-rows.td-steps', plan.steps.map(s => {
    const state = s.skipped ? 'skipped' : s.done ? 'done' : s === plan.next ? 'next' : 'later';
    if (!s.skipped) n++;
    const min = `${s.id === 'voice' ? '5–7' : s.minutes} хв`;
    const pill = s.done ? { text: 'готово', tone: 'good' } : s.skipped ? { text: 'після входу' } : state === 'next' ? { text: `Далі · ${min}`, tone: 'accent' } : { text: min };
    const row = txRow({
      ...(s.done ? { icon: 'check' } : s.skipped ? { icon: 'user' } : { no: n }),
      label: s.title, sub: s.desc, pill, href: s.href, on: state === 'next', cls: 'td-step-row.' + state, chevron: !s.done,
      onclick: s.skipped ? null : () => markStarted(),
      attrs: { 'aria-current': state === 'next' ? 'step' : null },
    });
    if (!s.done && !s.skipped && s.progress > 0) {
      const bar = txBar(s.progress, true);
      bar.setAttribute('role', 'progressbar');
      bar.removeAttribute('aria-label');
      Object.entries({ 'aria-label': `${s.title}: виконано`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(s.progress * 100) }).forEach(([a, v]) => bar.setAttribute(a, String(v)));
      row.querySelector('.tx-body')?.append(bar);
    }
    return h('li.td-step.' + state, row);
  }));

  const blocks = [header(), summary, kpis, txGroup('Кроки', steps)];
  if (plan.allDone) {
    blocks.push(txGroup('Хочеться ще?', txGrid([
      tx({ icon: 'chat-circle-dots', label: 'Вільна розмова з вчителем', sub: 'Будь-яка тема, голосом або текстом', href: '#/tutor' }),
      tx({ icon: 'book-open', label: 'Читання', sub: 'Короткий текст вашого рівня', href: '#/reading' }),
      tx({ icon: 'game-controller', label: 'Ігри', sub: 'Слово дня, швидкий переклад', href: '#/games' }),
    ])));
  } else if (plan.next) {
    blocks.push(txPrimary({ icon: plan.next.icon === 'microphone' ? 'microphone' : 'play', label: startLabel(plan),
      sub: startLabel(plan).startsWith('Почати') ? `Перший крок: ${plan.next.title}` : (leftMin ? `≈${leftMin} хв до кінця плану` : null), onclick: () => startNext(plan), cls: 'td-go' }));
  } else {
    // усі кроки, що лишились, потребують входу
    blocks.push(txPrimary({ icon: 'user', label: 'Увійти, щоб поговорити з вчителем', href: '#/auth' }));
  }
  blocks.push(h('p.xs.dim.center.td-alt', 'Хочете все поспіль на одному екрані? ', h('a', { href: '#/session' }, 'Кероване заняття')));

  const wasDone = view.querySelector('.td-summary.is-done');
  view.replaceChildren(h('div.stack-lg.td', blocks));
  // свято — лише в момент, коли день щойно зараховано (не при кожному відкритті)
  if (plan.allDone && !wasDone && !reduced()) celebrate(view.querySelector('.td-summary'));
}

function streakText() { const k = streak(); return `стрік ${k} ${plural(k, 'день', 'дні', 'днів')}`; }

/** Легке «конфеті» навколо кільця: кілька крапок розлітаються й зникають (лише раз за день) */
function celebrate(box) {
  if (!box) return;
  const k = `me:daily-cheer:${new Date().toDateString()}`;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch { /* */ }
  box.classList.add('cheer');
  const burst = h('div.td-burst', { 'aria-hidden': 'true' });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const d = 70 + (i % 3) * 18;
    burst.append(h('i', { style: `--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d)}px;--d:${(i % 4) * 40}ms` }));
  }
  box.querySelector('.plan-ring')?.append(burst);
  setTimeout(() => { burst.remove(); box.classList.remove('cheer'); }, 1400);
}
