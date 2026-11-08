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
import { tx, txPrimary, txGroup, txRow, txRows } from '../ui/tiles.js';

/** Іконка з мапи emo() у квадратику плитки (дані сценаріїв зберігають назви emo) */
const sqEmo = (el, name) => { const e = emo(name); e.setAttribute('width', 18); e.setAttribute('height', 18); el.querySelector('.tx-sq')?.replaceChildren(e); return el; };

export default async function scenarios(view, r) {
  const list = await load();
  const s = r.parts[0] && list.find(x => x.id === r.parts[0]);
  if (s) return detail(view, s);
  const played = new Set(store.all('tutor_chats').map(c => c.scenario).filter(Boolean));
  const groups = [['life', 'Повсякдення'], ['travel', 'Подорожі'], ['work', 'Робота']];
  // сценарій дня — той самий, що в «Завданнях рівня» на головній
  const day = pickOfDay(filterByLevel(list.filter(x => x.group !== 'work'), 'mine').items, 'scen');
  const body = h('div.stack-lg');
  let open = false;
  const row = (x, tag) => sqEmo(txRow({ icon: 'users-three', label: x.title, sub: x.short, href: `#/scenarios/${x.id}`,
    pill: played.has(x.id) ? { text: 'пройдено', tone: 'good' } : null, end: tag ? levelTag(x.level) : null }), x.emoji || 'theater');
  // сценарії вибраного рівня (за замовчуванням — мого): спершу 6 побутових, решта й «Робота» — за «Показати всі»
  const draw = () => {
    const sel = levelPick('scenarios');
    const { items, fallback } = filterByLevel(list, sel);
    const tag = sel === 'all' || !!fallback;
    const sorted = groups.flatMap(([g]) => byFit(items.filter(x => x.group === g)));
    const first = sorted.filter(x => x.group !== 'work' && x !== day).slice(0, SHOW);
    if (!open && sorted.filter(x => x !== day).length > first.length) {
      body.replaceChildren(fallbackNote(fallback), txRows([...first.map(x => row(x, tag)),
        txRow({ icon: 'caret-down', label: `Показати всі · ${sorted.length}`, chevron: false, cls: 'tx-showall', onclick: () => { open = true; draw(); } })]));
      return;
    }
    body.replaceChildren(fallbackNote(fallback), ...groups.map(([g, name]) => {
      const rows = sorted.filter(x => x.group === g);
      return rows.length ? txGroup(name, txRows(rows.map(x => row(x, tag)))) : null;
    }).filter(Boolean));
  };
  view.replaceChildren(h('div.stack-lg',
    day ? sqEmo(txPrimary({ icon: 'users-three', label: day.title, sub: `Сценарій дня · ${day.short || `рівень ${day.level}`}`, href: `#/scenarios/${day.id}` }), day.emoji || 'theater') : null,
    txGroup('Рольові ігри', [levelChips('scenarios', levelCounts(list), () => { open = false; draw(); }), body])));
  draw();
}

/** Скільки рядків видно до «Показати всі» */
const SHOW = 6;

function detail(view, s) {
  setTitle(s.title);
  // назва — у шапці застосунку; тут — повернення, група й рівень
  const grp = { life: 'Повсякдення', travel: 'Подорожі', work: 'Робота' }[s.group] || 'Сценарій';
  const fact = (icon, label, text) => h('div.tu-fact', h('span.tx-sq', ic(icon, { size: 16 })),
    h('div.tx-body', h('span.tu-fact-k', label), h('span.tu-fact-v', text)));
  view.replaceChildren(h('div.stack-lg.tu-scd',
    h('div.gx-lhead', h('a.icon-btn', { href: '#/scenarios', 'aria-label': 'До сценаріїв' }, ic('arrow-left')),
      sqEmo(h('div.tu-scd-head', h('span.tx-sq'), h('div.tx-body', h('span.tx-label', `Рольова гра · ${grp}`), h('span.tx-s', s.short || s.title))), s.emoji || 'theater'),
      s.level ? levelTag(s.level) : null),
    txGroup('Ситуація', h('div.tu-panel.stack.tu-scd-sit', h('div.tu-scd-sit-t', s.situation),
      h('div.tu-facts', fact('user', 'Ваша роль', s.myRole), fact('chalkboard-teacher', 'Вчитель грає', s.tutorRole), fact('target', 'Мета', s.goal)))),
    txPrimary({ icon: 'microphone', label: 'Почати голосом', sub: 'у реальному часі, вчитель почне сцену', href: `#/tutor?mode=voice&scenario=${s.id}` }),
    tx({ icon: 'chat-circle-dots', label: 'Почати текстом', sub: 'у чаті, з виправленнями', wide: true, href: `#/tutor?scenario=${s.id}` }),
    s.phrases.length ? txGroup(`Ключові фрази · прослухайте перед початком`, [
      txRows(s.phrases.map(p => txRow({ icon: 'speaker-high', label: p, chevron: false, onclick: () => speak(p), cls: 'tu-scd-phrase', attrs: { lang: 'en', 'aria-label': `Прослухати: ${p}` } }))),
      saveBtn(s)]) : null));
}

/** «Фрази сцени у фразник»: ситуація — за назвою й описом сценарію */
function saveBtn(s) {
  const b = h('button.tx-row.tu-scd-save', { type: 'button' });
  const paint = (busy = false) => {
    const all = s.phrases.every(hasPhrase);
    b.disabled = busy || all;
    b.replaceChildren(h('span.tx-sq', ic(busy ? 'hourglass' : all ? 'check' : 'plus', { size: 18 })),
      h('span.tx-body', h('span.tx-l', busy ? 'Зберігаю…' : all ? 'Фрази сцени у фразнику' : 'Фрази сцени у фразник'), h('span.tx-s', `${s.phrases.length} ${s.phrases.length === 1 ? 'фраза' : s.phrases.length < 5 ? 'фрази' : 'фраз'} — повторюватимете в «Фразнику»`)));
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
