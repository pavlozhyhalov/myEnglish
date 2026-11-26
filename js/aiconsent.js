// Згода на передачу даних AI-сервісу (App Store 5.1.2(i), GDPR ст. 6(1)(a)) — 2026-11-26.
// До першого AI-виклику — шторка: що й кому передається. Згода — profiles.data.aiConsent { v, at } (синхронізується), відкликати — «Налаштування».
// Фонові виклики (підсумки, класифікація) без згоди тихо не виконуються; шторка — лише у відповідь на дотик людини.
import { h, ic } from './ui/dom.js';
import * as store from './store.js';

export const AI_CONSENT_V = 1;
export const hasAiConsent = () => (store.prof().aiConsent?.v || 0) >= AI_CONSENT_V && !store.prof().aiConsent?.off;
export function setAiConsent(on) { store.setProf({ aiConsent: on ? { v: AI_CONSENT_V, at: new Date().toISOString() } : { v: 0, off: true, at: new Date().toISOString() } }); }

let pending = null;
/** true — можна; false — людина відмовилась або це фоновий виклик без згоди */
export function ensureAiConsent() {
  if (hasAiConsent()) return Promise.resolve(true);
  // фоновий виклик (немає свіжого дотику) — шторку не показуємо
  if (navigator.userActivation && !navigator.userActivation.isActive && !pending) return Promise.resolve(false);
  if (pending) return pending;
  pending = import('./ui/sheet.js').then(({ sheet }) => new Promise(resolve => {
    let s = null, done = false;
    const finish = (v) => { if (done) return; done = true; if (v) setAiConsent(true); resolve(v); s?.close(); };
    const li = (icon, t) => h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, ic(icon, { size: 18 }), h('span.small', t));
    s = sheet('AI-вчитель: ваша згода', h('div.stack',
      h('p', 'Щоб вчитель відповідав, перевіряв і оцінював, ваші дані передаються Google (Gemini API).'),
      li('chat-circle-dots', 'Що: ваші повідомлення й мовлення в розмовах, тексти на перевірку, а також рівень, цілі, «Про вас», пам\'ять вчителя й ваші помилки — для персональних занять.'),
      li('seal-check', 'Лише для відповіді вчителя. Без реклами й продажу даних.'),
      li('gear-six', 'Відкликати згоду можна будь-коли в «Налаштуваннях». Без згоди картки, граматика, читання й ігри працюють як завжди.'),
      h('a.small', { href: '#/about/privacy' }, 'Політика приватності'),
      h('button.btn.primary.block', { type: 'button', onclick: () => finish(true) }, 'Погоджуюсь'),
      h('button.btn.ghost.block', { type: 'button', onclick: () => finish(false) }, 'Не зараз')),
    { onClose: () => finish(false) });
  })).finally(() => { pending = null; });
  return pending;
}
