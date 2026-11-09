// Ігри: «Слово дня» (Wordle), «Швидкий переклад», «Збери речення» — слова й речення мого рівня;
// «Артиклі на швидкість», «Те саме слово?» — граматика й слова, які плутають (з ваших помилок першими);
// мовні: «Поясни слово», «Хвилина без "uh"» (AI слухає), «Детектив помилок» (з ваших реальних помилок).
import { h, ic } from '../ui/dom.js';
import { myLevel } from '../level.js';
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
  articles: () => import('../games/articles.js'),
  same: () => import('../games/samewords.js'),
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
  const wordleStatus = daily?.done ? (daily.won ? `розгадано за ${daily.rows.length} з 6` : 'завтра нове слово') : daily?.rows?.length ? `спроба ${daily.rows.length + 1} з 6` : '5 літер, 6 спроб';
  const best = (k) => st.best?.[k]?.[lv] || 0;
  // плитка гри: коротка суть + рекорд пігулкою під текстом
  const game = (href, icon, title, desc, status, o = {}) => tx({ href, icon, label: title, sub: desc, extra: status ? txPill(status, 'accent') : null, cls: 'g-tile', ...o });
  view.replaceChildren(h('div.stack-lg.games',
    txPrimary({ href: '#/games/wordle', icon: 'text-aa', label: 'Слово дня', sub: `${wordleStatus} · рівень ${lv}` }),
    txGroup('Слова й речення', txGrid([
      game('#/games/rush', 'lightning', 'Швидкий переклад', 'на швидкість · 60 с', best('rush4') || best('rushtf') ? `Рекорд: ${Math.max(best('rush4'), best('rushtf'))}` : null),
      game('#/games/build', 'puzzle-piece', 'Збери речення', 'з перемішаних слів', best('build') ? `Рекорд: ${best('build')}` : null),
      game('#/games/articles', 'hourglass', 'Артиклі на швидкість', 'a, an, the чи — · 60 с', best('articles') ? `Рекорд: ${best('articles')}` : null),
      game('#/games/same', 'swap', 'Те саме слово?', 'make чи do, say чи tell', best('same') ? `Рекорд: ${best('same')}` : null),
    ], 2)),
    txGroup('Говоріння й помилки', txGrid([
      game('#/games/explain', 'chat-circle-dots', 'Поясни слово', 'голосом — AI вгадує', best('explain') ? `Рекорд: ${best('explain')} з 15` : null),
      game('#/games/minute', 'timer', 'Хвилина без «uh»', 'три заминки — і вибули', best('minute') ? `Рекорд: ${best('minute')} с` : null),
      game('#/games/detective', 'magnifying-glass', 'Детектив помилок', 'знайдіть помилку за 5 с', best('detective') ? `Рекорд: ${best('detective')}` : null, { wide: true, full: true }),
    ], 2)),
    h('div.row.g-hub-foot',
      h('a.g-foot-link.grow', { href: '#/games/wordle?mode=practice' }, ic('arrow-clockwise', { size: 18 }), 'Слово дня без обмежень'),
      muteButton())));
}
