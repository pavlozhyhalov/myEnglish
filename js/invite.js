// Запрошення як у соцмережах (власник 2026-11-17: «додавання в друзі складне, важко створити комʼюніті»; міграція 0029).
// Друг: посилання #/friends?code=<код> → картка «Олівер запрошує вас» → «Додати в друзі» одним дотиком.
// Група: посилання #/friends/join/<код групи> → «Приєднатися до групи» одним дотиком (дружба не потрібна).
// Без входу: «Зареєструватися й приєднатися» — запрошення пам'ятається (localStorage) і відкривається одразу після входу (js/pages/auth.js).
import { h, ic } from './ui/dom.js';
import { siteBase } from './native.js';
import { getSupa, user } from './supa.js';
import { go } from './router.js';
import { toast } from './ui/toast.js';
import { tx, txPrimary, txResult, txRow, txRows } from './ui/tiles.js';
import { tLines } from './i18n.js';

const PENDING = 'me:pending-invite';
const base = () => siteBase();
export const friendLink = (code) => `${base()}#/friends?code=${code}`;
export const groupLink = (code) => `${base()}#/friends/join/${code}`;

export function savePending(hash) { try { localStorage.setItem(PENDING, JSON.stringify({ hash, at: Date.now() })); } catch { /* приватний режим */ } }
/** Адреса запрошення, яке чекало входу (до 7 днів), — один раз */
export function takePending() {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING) || 'null');
    localStorage.removeItem(PENDING);
    return v && Date.now() - v.at < 7 * 864e5 && /^#\/friends/.test(v.hash) ? v.hash : null;
  } catch { return null; }
}

async function rpc(name, args) {
  const c = await getSupa();
  const { data, error } = await c.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

/** Поділитися посиланням: системне меню (Telegram, Viber, повідомлення…) або копіювання */
export async function shareLink(url, text) {
  text = tLines(text);
  if (navigator.share) {
    try { await navigator.share({ title: 'myEnglish', text, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Посилання скопійовано — надішліть його друзям'); }
  catch { toast(url, { ms: 8000 }); }
}
export async function shareGroup(roomId, title) {
  try {
    const code = await rpc('chat_invite_link', { p_room: roomId });
    await shareLink(groupLink(code), `Приєднуйся до нашої групи «${title || 'English'}» у myEnglish — вчимо англійську разом:`);
  } catch { toast('Не вдалося створити посилання', { kind: 'bad' }); }
}

const ERR = { rate_limited: 'Забагато спроб. Спробуйте за годину.', too_many_friends: 'Досягнуто межі — 100 друзів.', too_many: 'У групі вже 10 людей.', blocked: 'Приєднатися не можна.', not_found: 'Запрошення застаріло або посилання неправильне.' };
const errText = (e) => ERR[Object.keys(ERR).find(k => String(e?.message || e?.code || '').includes(k))] || (navigator.onLine ? 'Не вдалося. Спробуйте ще раз.' : 'Немає мережі');

/** Картка запрошення без входу */
function loginLanding(view, kind) {
  view.replaceChildren(h('div.stack-lg.inv',
    txResult({ icon: kind === 'group' ? 'users-three' : 'user-plus', tone: 'accent', label: 'Запрошення', title: kind === 'group' ? 'Вас запрошують у групу myEnglish' : 'Вас запрошують у друзі в myEnglish',
      sub: 'Вчимо англійську разом: переписка англійською, спільні виклики й домашнє від вчителя' }),
    txPrimary({ icon: 'user-plus', label: 'Зареєструватися й приєднатися', sub: 'Хвилина — і ви вже разом', onclick: () => { savePending(location.hash); go('/auth?tab=up'); } }),
    tx({ icon: 'key', wide: true, label: 'У мене вже є акаунт', onclick: () => { savePending(location.hash); go('/auth'); } })));
}

/** #/friends?code=… — «Олівер запрошує вас» */
export async function friendInvite(view, code, { onDone } = {}) {
  if (!user()) return loginLanding(view, 'friend');
  view.replaceChildren(h('div.stack-lg.inv', txRows([txRow({ icon: 'hourglass', label: 'Відкриваю запрошення…', chevron: false })])));
  let p;
  try { p = (await rpc('friend_preview', { p_code: code }))?.[0]; } catch (e) { p = { status: 'error', e }; }
  const name = p?.name || 'Друг';
  const skip = tx({ icon: 'users', wide: true, label: 'До друзів', onclick: () => onDone?.() });
  if (p?.status === 'self') {
    view.replaceChildren(h('div.stack-lg.inv', txResult({ icon: 'user', tone: 'accent', label: 'Запрошення', title: 'Це ваше власне посилання', sub: 'Надішліть його друзям — вони додадуться одним дотиком' }), skip));
    return;
  }
  if (p?.status !== 'ok' && p?.status !== 'friends') {
    view.replaceChildren(h('div.stack-lg.inv', txResult({ icon: 'warning-circle', tone: 'warn', label: 'Запрошення', title: 'Запрошення не знайдено', sub: p?.status === 'error' ? errText(p.e) : ERR.not_found }), skip));
    return;
  }
  const done = (friendId) => view.replaceChildren(h('div.stack-lg.inv',
    txResult({ icon: 'check-circle', tone: 'good', label: 'Готово', title: `${name} — у ваших друзях`, sub: 'Пишіть одне одному англійською — вчитель тихо підкаже, як правильно' }),
    txPrimary({ icon: 'chat-circle-dots', label: `Написати ${name}`, sub: 'Переписка англійською', onclick: async () => {
      try { const id = await rpc('chat_open_dm', { p_friend: friendId }); go(`/friends/chat/${id}`); } catch { onDone?.(); }
    } }),
    skip));
  if (p.status === 'friends') { toast(`${name} уже у ваших друзях`); return onDone?.(); }
  const btn = txPrimary({ icon: 'user-plus', label: 'Додати в друзі', sub: 'Одним дотиком — без кодів', onclick: async () => {
    btn.disabled = true;
    try {
      const r = (await rpc('add_friend', { p_code: code }))?.[0];
      if (r?.status === 'ok') { toast(`${name} тепер у ваших друзях`); done(r.friend_id); }
      else { toast(ERR[r?.status] || errText(r), { kind: 'bad' }); btn.disabled = false; }
    } catch (e) { toast(errText(e), { kind: 'bad' }); btn.disabled = false; }
  } });
  view.replaceChildren(h('div.stack-lg.inv',
    h('div.inv-hero', h('span.friend-ava.inv-ava', { 'aria-hidden': 'true' }, name.charAt(0).toUpperCase()),
      h('div.inv-t', `${name} запрошує вас у друзі`), h('div.tx-s', 'Друзі бачать лише ім\'я, серію днів і хвилини — пошту й помилки ніхто не бачить')),
    btn, skip));
}

/** #/friends/join/<код> — «Приєднатися до групи» */
export async function groupInvite(view, code) {
  if (!user()) return loginLanding(view, 'group');
  view.replaceChildren(h('div.stack-lg.inv', txRows([txRow({ icon: 'hourglass', label: 'Відкриваю запрошення…', chevron: false })])));
  let p;
  try { p = await rpc('chat_invite_preview', { p_code: code }); } catch (e) { p = { status: 'error', e }; }
  const toChats = tx({ icon: 'chat-circle-dots', wide: true, label: 'Мої чати', onclick: () => go('/friends/chats', { replace: true }) });
  if (p?.status === 'member') return go(`/friends/chat/${p.room_id}`, { replace: true });
  if (p?.status !== 'ok') {
    view.replaceChildren(h('div.stack-lg.inv', txResult({ icon: 'warning-circle', tone: 'warn', label: 'Запрошення', title: 'Групу не знайдено', sub: p?.status === 'error' ? errText(p.e) : ERR.not_found }), toChats));
    return;
  }
  const names = (p.names || []).join(', ');
  const more = p.members - (p.names || []).length;
  const btn = txPrimary({ icon: 'users-three', label: 'Приєднатися до групи', sub: `${p.members} з 10 місць зайнято`, onclick: async () => {
    btn.disabled = true;
    try { const id = await rpc('chat_join', { p_code: code }); toast(`Ви в групі «${p.title}»`); go(`/friends/chat/${id}`, { replace: true }); }
    catch (e) { toast(errText(e), { kind: 'bad' }); btn.disabled = false; }
  } });
  view.replaceChildren(h('div.stack-lg.inv',
    h('div.inv-hero', h('span.friend-ava.inv-ava', { 'aria-hidden': 'true' }, ic('users-three', { size: 26 })),
      h('div.inv-t', `Група «${p.title}»`), h('div.tx-s', `${names}${more > 0 ? ` і ще ${more}` : ''} · переписка англійською, виклики й домашнє від вчителя`)),
    btn, toChats));
}
