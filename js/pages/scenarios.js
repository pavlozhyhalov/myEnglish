// Розмовні сценарії: рольові ігри з вчителем (текст або голос)
import { h, ic, emo } from '../ui/dom.js';
import { scenarios as load } from '../data.js';
import { speak } from '../speech.js';
import { setTitle } from '../ui/shell.js';
import * as store from '../store.js';
import { savePhrases, guessSituation, hasPhrase, situation as phraseSit } from '../phrases.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { byFit, levelTag, myLevel, levelChips, levelCounts, levelPick, filterByLevel, fallbackNote, pickOfDay } from '../level.js';
import { txPrimary, txGroup, txRow, txRows } from '../ui/tiles.js';

/** Іконка з мапи emo() у квадратику плитки (дані сценаріїв зберігають назви emo) */
const sqEmo = (el, name) => { const e = emo(name); e.setAttribute('width', 18); e.setAttribute('height', 18); el.querySelector('.tx-sq')?.replaceChildren(e); return el; };

export default async function scenarios(view, r) {
  const list = await load();
  const s = r.parts[0] && list.find(x => x.id === r.parts[0]);
  if (s) return detail(view, s);
  const played = new Set(store.all('tutor_chats').map(c => c.scenario).filter(Boolean));
  const groups = [['life', 'Повсякдення'], ['travel', 'Подорожі'], ['work', 'Робота']];
  const body = h('div.stack-lg');
  // сценарії вибраного рівня (за замовчуванням — мого): зміна рівня змінює набір завдань
  const draw = () => {
    const { items, fallback } = filterByLevel(list, levelPick('scenarios'));
    body.replaceChildren(fallbackNote(fallback), ...groups.map(([g, name]) => {
      const rows = byFit(items.filter(x => x.group === g));
      if (!rows.length) return null;
      return txGroup(name, txRows(rows.map(x => sqEmo(txRow({ icon: 'users-three', label: x.title, sub: x.short, href: `#/scenarios/${x.id}`,
        pill: played.has(x.id) ? { text: 'пройдено', tone: 'good' } : null, end: levelTag(x.level) }), x.emoji || 'theater'))));
    }).filter(Boolean));
  };
  // сценарій дня — той самий, що в «Завданнях рівня» на головній
  const day = pickOfDay(filterByLevel(list.filter(x => x.group !== 'work'), 'mine').items, 'scen');
  view.replaceChildren(h('div.stack-lg',
    day ? sqEmo(txPrimary({ icon: 'users-three', label: day.title, sub: `Сценарій дня · ${day.short || `рівень ${day.level}`}`, href: `#/scenarios/${day.id}` }), day.emoji || 'theater') : null,
    txGroup(`Рольові ігри із вчителем · ваш рівень ${myLevel()}`, levelChips('scenarios', levelCounts(list), draw)), body));
  draw();
}

function detail(view, s) {
  setTitle(s.title);
  view.replaceChildren(h('div.stack-lg',
    h('div.row', h('a.icon-btn', { href: '#/scenarios', 'aria-label': 'Назад' }, ic('arrow-left')), h('div.emoji-circle', emo(s.emoji || 'theater')), h('h1.grow', { style: { margin: 0 } }, s.title)),
    h('section.card.stack',
      h('div', h('div.section-title', 'Ситуація'), h('div', s.situation)),
      h('div', h('div.section-title', 'Ваша роль'), h('div', s.myRole)),
      h('div', h('div.section-title', 'Вчитель грає'), h('div', s.tutorRole)),
      h('div', h('div.section-title', 'Мета'), h('div', s.goal))),
    h('section.card', h('div.section-title', 'Ключові фрази — прослухайте перед початком'),
      s.phrases.map(p => h('div.example', h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(p) }, ic('speaker-high', { size: 20 })), h('div.grow', { lang: 'en' }, p))),
      s.phrases.length ? saveBtn(s) : null),
    h('div.stack',
      h('a.btn.primary.lg.block', { href: `#/tutor?mode=voice&scenario=${s.id}` }, ic('microphone', { fill: true }), 'Почати голосом'),
      h('a.btn.soft.lg.block', { href: `#/tutor?scenario=${s.id}` }, ic('chat-circle-dots'), 'Почати текстом'))));
}

/** «Фрази сцени у фразник»: ситуація — за назвою й описом сценарію */
function saveBtn(s) {
  const b = h('button.btn.sm.soft', { type: 'button', style: { marginTop: '10px' } });
  const paint = (busy = false) => {
    const all = s.phrases.every(hasPhrase);
    b.disabled = busy || all;
    b.replaceChildren(ic(busy ? 'hourglass' : all ? 'check' : 'plus', { size: 16 }), busy ? 'Зберігаю…' : all ? 'Фрази сцени у фразнику' : 'Фрази сцени у фразник');
  };
  paint();
  b.addEventListener('click', async () => {
    const sit = guessSituation(`${s.title} ${s.short || ''} ${s.situation} ${s.tutorRole || ''}`);
    paint(true);
    const r = await savePhrases(s.phrases.map(en => ({ en })), { situation: sit, source: 'scenario' }).catch(() => null);
    paint();
    if (!r) { toast('Не вдалося зберегти фрази'); return; }
    toast(r.added ? `У фразнику: +${r.added} · ${phraseSit(sit).uk}` : 'Ці фрази вже є у ваших картках', { action: 'Відкрити', onAction: () => go(`/phrases/${sit}`) });
  });
  return b;
}
