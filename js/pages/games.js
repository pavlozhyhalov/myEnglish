// Ігри: «Слово дня» (Wordle), «Швидкий переклад», «Збери речення» — слова й речення мого рівня;
// мовні: «Поясни слово», «Хвилина без "uh"» (AI слухає), «Детектив помилок» (з ваших реальних помилок).
import { h } from '../ui/dom.js';
import { myLevel, levelTag } from '../level.js';
import { today } from '../stats.js';
import { gameState, muteButton } from '../games/common.js';
import { tx, txPrimary, txGrid, txGroup, txPill } from '../ui/tiles.js';

const GAMES = {
  wordle: () => import('../games/wordle.js'),
  rush: () => import('../games/rush.js'),
  build: () => import('../games/build.js'),
  explain: () => import('../games/explain.js'),
  minute: () => import('../games/minute.js'),
  detective: () => import('../games/detective.js'),
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
  // плитка гри: опис + стан (рекорд, спроба) пігулкою під текстом
  const game = (href, icon, title, desc, status, o = {}) => tx({ href, icon, label: title, sub: desc, extra: status ? txPill(status, 'accent') : null, cls: 'g-tile', ...o });
  view.replaceChildren(h('div.stack-lg.games',
    h('div.row.g-hub-head', h('p.xs.dim.grow', { style: { margin: 0 } }, 'Слова, речення й мовлення вашого рівня. Час у грі зараховується в навчання.'), levelTag(lv), muteButton()),
    txGroup('Слова й речення', [
      txPrimary({ href: '#/games/wordle', icon: 'text-aa', label: 'Слово дня', sub: `${wordleStatus} · 5 літер, 6 спроб` }),
      txGrid([
        game('#/games/rush', 'lightning', 'Швидкий переклад', '60 секунд: оберіть переклад, поки не скінчився час', best('rush4') || best('rushtf') ? `Рекорд: ${Math.max(best('rush4'), best('rushtf'))}` : null),
        game('#/games/build', 'puzzle-piece', 'Збери речення', 'Складіть речення з перемішаних слів на швидкість', best('build') ? `Рекорд: ${best('build')}` : null),
      ], 2),
      tx({ href: '#/games/wordle?mode=practice', icon: 'arrow-clockwise', label: 'Тренування «Слова дня»', sub: 'Без обмежень — скільки завгодно слів', wide: true }),
    ]),
    txGroup('Говоріння й помилки', txGrid([
      game('#/games/explain', 'chat-circle-dots', 'Поясни слово', 'Поясніть англійською слово з ваших карток — AI вгадує', best('explain') ? `Рекорд: ${best('explain')} з 15` : null),
      game('#/games/minute', 'timer', 'Хвилина без «uh»', 'Говоріть хвилину на тему — три заминки, і ви вибули', best('minute') ? `Рекорд: ${best('minute')} с` : null),
      game('#/games/detective', 'magnifying-glass', 'Детектив помилок', 'Знайдіть помилку за 5 секунд — з ваших реальних помилок', best('detective') ? `Рекорд: ${best('detective')}` : null, { wide: true, full: true }),
    ], 2))));
}
