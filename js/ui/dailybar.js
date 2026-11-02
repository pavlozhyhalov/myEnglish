// Плашка «Далі за планом»: після старту «Мого дня» над нижньою панеллю видно наступний крок.
// Прихована на головній і #/today (там план і так видно), на сторінці самого кроку, у голосовій сесії й режимі фокусу (CSS).
import { h, ic } from './dom.js';
import { onRoute, parse } from '../router.js';
import * as store from '../store.js';
import { buildPlan, isStarted, markStarted, hideBarToday, barHiddenToday } from '../daily.js';

let bar = null, seq = 0, timer = 0;

export function initDailyBar() {
  if (bar) return;
  bar = h('div.dailybar', { hidden: true });
  document.body.append(bar);
  onRoute(() => schedule(0));
  store.on((t) => { if (t === 'reviews' || t === 'sessions' || t === 'mistakes' || t === 'profile') schedule(600); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
}

function schedule(ms) { clearTimeout(timer); timer = setTimeout(update, ms); }

/** Сторінка кроку: та сама адреса й ті самі ключові параметри (режим голосу, практика помилок) */
function onStepPage(r, href) {
  const s = parse(href);
  return r.path === s.path && (s.query.mode || '') === (r.query.mode || '') && (s.query.practice || '') === (r.query.practice || '');
}

async function update() {
  const my = ++seq;
  const r = parse();
  if (!isStarted() || barHiddenToday() || r.name === 'home' || r.name === 'today') return hide();
  let plan;
  try { plan = await buildPlan(); } catch (e) { console.warn('dailybar', e); return hide(); }
  if (my !== seq) return;
  const next = plan.next;
  if (!next || plan.allDone || onStepPage(parse(), next.href)) return hide();
  const min = next.id === 'voice' ? '5–7' : String(next.minutes);
  bar.replaceChildren(
    h('a.dailybar-go', { href: next.href, onclick: () => markStarted(), 'aria-label': `Далі за планом дня: ${next.title}, ${min} хвилин` },
      h('span.dailybar-ico', ic(next.icon || 'play', { size: 18 })),
      h('span.dailybar-t', h('span.dim', 'Далі: '), next.title, h('span.dim', ` · ${min} хв`)),
      ic('arrow-right', { size: 18 })),
    h('button.dailybar-x', { type: 'button', 'aria-label': 'Сховати до завтра', onclick: () => { hideBarToday(); hide(); } }, ic('x', { size: 16 })));
  if (bar.hidden) {
    bar.hidden = false;
    document.body.classList.add('has-dailybar');
  }
}

function hide() {
  seq++;
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  document.body.classList.remove('has-dailybar');
}
