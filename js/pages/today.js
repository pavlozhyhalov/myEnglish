// «Мій день за 15 хвилин»: кільце прогресу, три кроки по черзі й одна головна кнопка
import { h, ic, emo, ring } from '../ui/dom.js';
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
  return h('header.td-head',
    h('span.eyebrow', date.charAt(0).toUpperCase() + date.slice(1)),
    h('h1', 'Мій день'),
    h('p.dim.small', 'Три кроки по черзі — нічого не треба обирати.'));
}

function skeletonPage() {
  return h('div.stack-lg.td', { role: 'status', 'aria-label': 'Завантаження плану' },
    header(),
    h('section.card.td-summary', skel({ w: '150px', ht: 150, r: '50%' }), h('div.grow.stack', { style: { gap: '10px' } }, skel({ w: '70%', ht: 18 }), skelLines(2))),
    h('div.td-steps', [0, 1, 2].map(() => h('div.td-step.skel-step', skel({ w: '32px', ht: 32, r: '50%' }), h('div.grow.stack', { style: { gap: '8px' } }, skel({ w: '45%', ht: 14 }), skel({ w: '80%', ht: 10 }))))),
    skel({ ht: 56, r: 'var(--radius)' }));
}

function render(view, plan) {
  const pct = Math.round(plan.progress * 100);
  const counted = plan.steps.filter(s => !s.skipped);
  const doneN = counted.filter(s => s.done).length;
  const leftMin = Math.max(0, Math.ceil(plan.totalMin - plan.doneMin));
  const label = plan.allDone
    ? h('span.td-ring-label', ic('check', { size: 44 }), h('span.sr-only', 'Виконано'))
    : h('span.td-ring-label', h('b.num', `${pct}%`), h('span.xs', `${Math.round(plan.doneMin)} з ${Math.round(plan.totalMin)} хв`));

  const summary = h('section.card.td-summary' + (plan.allDone ? '.is-done' : ''),
    planRing(pct, { size: 148, stroke: 12, label, done: plan.allDone }),
    h('div.grow.stack', { style: { gap: '6px' } },
      plan.allDone
        ? [h('h2.td-title', 'День зараховано'), h('p.small.dim', `${Math.round(todaySeconds() / 60)} хв практики сьогодні · ${streakText()}`)]
        : [h('h2.td-title', counted.length ? (doneN ? `Готово ${doneN} з ${counted.length}` : `${counted.length} ${plural(counted.length, 'крок', 'кроки', 'кроків')} на сьогодні`) : 'План дня'),
          h('p.small.dim', leftMin ? `Залишилось ≈${leftMin} ${plural(leftMin, 'хвилина', 'хвилини', 'хвилин')}` : 'Майже готово')]));

  let n = 0;
  const steps = h('ol.td-steps', plan.steps.map(s => {
    const state = s.skipped ? 'skipped' : s.done ? 'done' : s === plan.next ? 'next' : 'later';
    if (!s.skipped) n++;
    const mark = h('span.td-mark', s.done ? ic('check', { size: 18 }) : s.skipped ? ic('user', { size: 16 }) : h('span.num', String(n)));
    const meta = h('span.td-min', s.done ? 'готово' : s.skipped ? 'після входу' : `${s.id === 'voice' ? '5–7' : s.minutes} хв`);
    const partial = !s.done && !s.skipped && s.progress > 0
      ? h('div.td-prog', { role: 'progressbar', 'aria-label': `${s.title}: виконано`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(s.progress * 100) }, h('i', { style: { width: `${Math.round(s.progress * 100)}%` } }))
      : null;
    return h('li.td-step.' + state,
      h('a.td-link', { href: s.href, onclick: s.skipped ? null : () => markStarted(), 'aria-current': state === 'next' ? 'step' : null },
        mark,
        h('div.grow',
          h('div.td-step-title', h('span', s.title), state === 'next' ? h('span.tag.accent', 'Далі') : null),
          h('div.td-desc', s.desc),
          partial),
        meta,
        s.done ? null : ic('caret-right', { size: 18 })));
  }));

  const blocks = [header(), summary, steps];
  if (plan.allDone) {
    blocks.push(h('section.td-more.stack', { style: { gap: '8px' } },
      h('div.section-title', 'Хочеться ще?'),
      h('div.list',
        more('chat-circle-dots', 'Вільна розмова з вчителем', 'Будь-яка тема, голосом або текстом', '#/tutor'),
        more('book-open', 'Читання', 'Короткий текст вашого рівня', '#/reading'),
        more('game-controller', 'Ігри', 'Слово дня, швидкий переклад', '#/games'))));
  } else if (plan.next) {
    blocks.push(h('button.btn.primary.lg.block.td-go', { type: 'button', onclick: () => startNext(plan) },
      ic(plan.next.icon === 'microphone' ? 'microphone' : 'play', { fill: true, size: 20 }), startLabel(plan)));
  } else {
    // усі кроки, що лишились, потребують входу
    blocks.push(h('a.btn.primary.lg.block', { href: '#/auth' }, 'Увійти, щоб поговорити з вчителем'));
  }
  blocks.push(h('p.xs.dim.center.td-alt', 'Хочете все поспіль на одному екрані? ', h('a', { href: '#/session' }, 'Кероване заняття')));

  const wasDone = view.querySelector('.td-summary.is-done');
  view.replaceChildren(h('div.stack-lg.td', blocks));
  // свято — лише в момент, коли день щойно зараховано (не при кожному відкритті)
  if (plan.allDone && !wasDone && !reduced()) celebrate(view.querySelector('.td-summary'));
}

function streakText() { const k = streak(); return `стрік ${k} ${plural(k, 'день', 'дні', 'днів')}`; }

function more(icon, title, sub, href) {
  return h('a.list-row', { href }, h('span.tile-ico', emo(icon)), h('div.grow', h('div', { style: { fontWeight: 600 } }, title), h('div.sub', sub)), ic('caret-right', { size: 18 }));
}

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
