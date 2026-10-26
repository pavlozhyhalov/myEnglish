// Розмовні сценарії: рольові ігри з вчителем (текст або голос)
import { h, ic, emo } from '../ui/dom.js';
import { scenarios as load } from '../data.js';
import { speak } from '../speech.js';
import { setTitle } from '../ui/shell.js';
import * as store from '../store.js';
import { byFit, levelTag, myLevel } from '../level.js';

export default async function scenarios(view, r) {
  const list = await load();
  const s = r.parts[0] && list.find(x => x.id === r.parts[0]);
  if (s) return detail(view, s);
  const played = new Set(store.all('tutor_chats').map(c => c.scenario).filter(Boolean));
  const groups = [['life', 'Повсякдення'], ['travel', 'Подорожі'], ['work', 'Робота']];
  view.replaceChildren(h('div.stack-lg',
    h('section.row', h('div.emoji-circle', emo('theater')), h('div.grow', h('h1', { style: { margin: 0 } }, 'Розмовні сценарії'), h('div.small.dim', `Рольові ігри з вчителем · спершу рівень ${myLevel()}`))),
    ...groups.map(([g, name]) => h('section.stack', { style: { gap: '8px' } }, h('div.section-title', name),
      h('div.list', byFit(list.filter(x => x.group === g)).map(x => h('a.list-row', { href: `#/scenarios/${x.id}` },
        emo(x.emoji || 'theater'), h('div.grow', h('div', { style: { fontWeight: 600 } }, x.title), h('div.sub', x.short)),
        played.has(x.id) ? h('span.tag.good', 'було') : null, levelTag(x.level), ic('caret-right', { size: 18 }))))))));
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
    h('section.card', h('div.section-title', 'Ключові фрази — прослухайте перед стартом'),
      s.phrases.map(p => h('div.example', h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(p) }, ic('speaker-high', { size: 20 })), h('div.grow', p)))),
    h('div.stack',
      h('a.btn.primary.lg.block', { href: `#/tutor?mode=voice&scenario=${s.id}` }, ic('microphone', { fill: true }), 'Почати голосом'),
      h('a.btn.soft.lg.block', { href: `#/tutor?scenario=${s.id}` }, ic('chat-circle-dots'), 'Почати текстом'))));
}
