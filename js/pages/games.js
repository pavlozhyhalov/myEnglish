// Ігри: «Слово дня» (Wordle), «Швидкий переклад», «Збери речення» — слова й речення мого рівня.
import { h, ic } from '../ui/dom.js';
import { myLevel, levelTag } from '../level.js';
import { today } from '../stats.js';
import { gameState, muteButton } from '../games/common.js';

const GAMES = {
  wordle: () => import('../games/wordle.js'),
  rush: () => import('../games/rush.js'),
  build: () => import('../games/build.js'),
};

export default async function games(view, r) {
  const load = GAMES[r.parts[0]];
  if (load) return (await load()).default(view, r);
  hub(view);
}

function hub(view) {
  const lv = myLevel();
  const st = gameState();
  const daily = st.wordleDay?.[`${today()}|${lv}`];
  const wordleStatus = daily?.done ? (daily.won ? `Розгадано за ${daily.rows.length} з 6` : 'Сьогодні не вдалося — завтра нове слово') : daily?.rows?.length ? `Спроба ${daily.rows.length + 1} з 6 — продовжуйте` : 'Нове слово щодня';
  const best = (k) => st.best?.[k]?.[lv] || 0;
  const tile = (href, icon, title, desc, status) => h('a.card.row.g-tile', { href },
    h('div.tile-ico', ic(icon)),
    h('div.grow', h('div.name', title), h('div.xs.dim', desc), status ? h('div.xs.g-status', status) : null),
    ic('caret-right', { size: 18 }));
  view.replaceChildren(h('div.stack-lg.games',
    h('div.row', h('p.dim.grow', { style: { margin: 0 } }, 'Слова й речення вашого рівня. Час у грі зараховується в навчання.'), levelTag(lv), muteButton()),
    h('div.stack',
      tile('#/games/wordle', 'text-aa', 'Слово дня', 'Вгадайте англійське слово з 5 літер за 6 спроб', wordleStatus),
      tile('#/games/rush', 'lightning', 'Швидкий переклад', '60 секунд: оберіть переклад, поки не скінчився час', best('rush4') || best('rushtf') ? `Рекорд: ${Math.max(best('rush4'), best('rushtf'))}` : null),
      tile('#/games/build', 'puzzle-piece', 'Збери речення', 'Складіть речення з перемішаних слів на швидкість', best('build') ? `Рекорд: ${best('build')}` : null)),
    h('a.btn.ghost', { href: '#/games/wordle?mode=practice' }, ic('arrow-clockwise', { size: 18 }), 'Тренування «Слова дня» без обмежень')));
}
