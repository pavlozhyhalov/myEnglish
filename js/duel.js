// Дуелі в чатах друзів (міграція 0025): «Детектив помилок» і «Швидкий переклад» з однаковими раундами для всіх учасників.
// Адреса гри: #/games/<game>?duel=<id>&seed=<n>&lv=<рівень>&room=<чат>. Зараховується перша спроба кожного; 24 год на гру.
import { h, ic } from './ui/dom.js';
import { tx, txGroup, txRows, txPill } from './ui/tiles.js';
import { rpc } from './chat.js';
import { lvLabel } from './level.js';
import { plural } from './strings.js';

export const GAMES = {
  detective: { label: 'Детектив помилок', icon: 'magnifying-glass', sub: '15 речень · знайдіть помилку за 5 с' },
  rush: { label: 'Швидкий переклад', icon: 'lightning', sub: '60 секунд · чотири варіанти' },
};
const UUID = /^[0-9a-f-]{36}$/i;
const LVS = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1'];

/** Параметри дуелі з адреси або null */
export function duelOf(r) {
  const q = r?.query || {};
  if (!UUID.test(q.duel || '') || !UUID.test(q.room || '')) return null;
  const seed = Number(q.seed);
  if (!Number.isFinite(seed)) return null;
  return { id: q.duel, room: q.room, seed: Math.floor(seed), level: LVS.includes(q.lv) ? q.lv : 'B1' };
}
export const duelHref = (game, d, room) => `#/games/${game}?duel=${d.duel_id || d.id}&seed=${d.seed}&lv=${d.level}&room=${room}`;

/** Детермінований генератор (mulberry32): однакові раунди в усіх учасників */
export function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const createDuel = (room, game, level) => rpc('chat_duel_create', { p_room: room, p_game: game, p_level: level });
export const duels = (room) => rpc('chat_duels_list', { p_room: room });
export const submitDuel = (duel, score, hits, total) => rpc('chat_duel_submit', { p_duel: duel, p_score: score, p_hits: hits, p_total: total });

/** Плитка над стартом гри: «Дуель у чаті» */
export function duelNote(d) {
  return tx({ icon: 'sword', wide: true, cls: 'dl-note', label: 'Дуель у чаті', sub: `Ті самі завдання для всіх · рівень ${lvLabel(d.level)} · зараховується перша спроба` });
}

/** Таблиця результатів дуелі */
export function duelTable(results, { unit = (n) => plural(n, 'очко', 'очки', 'очок') } = {}) {
  const played = results.filter(p => p.score != null);
  return txRows(results.map((p, i) => h('div.tx-row.dl-row' + (p.me ? '.on' : ''),
    h('span.tx-no' + (p.score != null && i === 0 && played.length > 1 ? '.dl-win' : ''), p.score != null && i === 0 && played.length > 1 ? ic('trophy', { size: 16, fill: true }) : String(i + 1)),
    h('span.tx-body', h('span.tx-l', p.me ? `${p.name} (ви)` : p.name), p.total ? h('span.tx-s', `${p.hits} з ${p.total}`) : null),
    p.score != null ? h('span.dl-score', `${p.score}`, h('small', ` ${unit(p.score)}`)) : txPill('ще не грав(-ла)'))));
}

/** Після гри: надіслати результат і показати таблицю (секція для gameResult) */
export function finishDuel(d, score, hits, total) {
  const box = h('div', txGroup('Дуель', txRows([h('div.tx-row', h('span.tx-s', 'Надсилаю результат…'))])));
  submitDuel(d.id, score, hits, total).then((r) => {
    box.replaceChildren(txGroup(r?.first ? 'Дуель · ваш результат у чаті' : 'Дуель · зараховано першу спробу', [
      duelTable(r?.results || [])]));
  }).catch((e) => {
    const over = String(e?.message || '').includes('duel_over');
    box.replaceChildren(txGroup('Дуель', tx({ icon: 'warning-circle', wide: true, label: over ? 'Час дуелі минув — результат не зараховано' : 'Не вдалося надіслати результат', sub: over ? 'Дуель триває 24 години' : 'Перевірте з\'єднання', href: `#/friends/chat/${d.room}` })));
  });
  return box;
}
