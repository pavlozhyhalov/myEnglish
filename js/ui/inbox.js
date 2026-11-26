// Дзвіночок у шапці (власник 2026-11-16: «сповіщення в шапці; швидший доступ до групи»).
// Цифра — нові повідомлення (крім чатів без сповіщень) + невиконане домашнє + дуелі, у які я ще не зіграв (RPC my_inbox, міграція 0028).
// Шторка «Сповіщення»: «Нове» → «Мої групи й чати» (швидкий вхід у будь-який чат) → «Навчання» (картки на сьогодні, лише на пристрої).
// Оновлення: на старті (після показу першої сторінки), щохвилини, поки застосунок на екрані, і після переходів (прочитаний чат знімає цифру).
import { h, ic } from './dom.js';
import { sheet } from './sheet.js';
import { txGroup, txRow, txRows } from './tiles.js';
import { user, getSupa, onAuth } from '../supa.js';
import * as store from '../store.js';
import { plural } from '../strings.js';
import { notifyPrompt } from './notifyprompt.js';
import { loc } from '../i18n.js';

let btn = null, data = null, timer = 0, busy = false;
const GAMES = { detective: 'Детектив помилок', rush: 'Швидкий переклад' };
const due = (iso) => new Date(iso).toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'numeric' });

function count(d) {
  if (!d) return 0;
  return (d.chats || []).reduce((a, c) => a + (c.muted ? 0 : c.unread || 0), 0) + (d.homework || []).length + (d.duels || []).length + (d.requests || []).length + (d.invites || []).length + (d.replies || []).length + (d.feedback_new || 0);
}
function paint() {
  if (!btn) return;
  btn.hidden = !user();
  const n = count(data);
  btn.querySelector('.hdr-badge')?.remove();
  if (n) btn.append(h('span.hdr-badge', { 'aria-hidden': 'true' }, n > 99 ? '99+' : String(n)));
  btn.setAttribute('aria-label', n ? `Сповіщення: ${n} ${plural(n, 'нове', 'нові', 'нових')}` : 'Сповіщення');
  // та сама цифра — на іконці застосунку (PWA на екрані «Додому»)
  if (data && navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  if (data && !document.hidden) syncSw(n);
}

// Застосунок на екрані — сповіщення в Центрі сповіщень уже не потрібні (усе нове — у дзвіночку): прибираємо їх,
// а цифру дзвіночка передаємо SW — на іконці буде вона + лише ті push, що прийдуть після цього (sw.js syncBadge)
async function syncSw(n) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    // без дозволу сповіщень у Центрі сповіщень нічого немає (і безголовий Chromium падає на getNotifications)
    if (globalThis.Notification?.permission === 'granted') (await reg.getNotifications()).forEach(x => x.close());
    (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'badge', n });
  } catch { /* без SW — нічого */ }
}

export async function refreshInbox() {
  if (!user() || busy || !navigator.onLine) { paint(); return; }
  busy = true;
  try {
    const c = await getSupa();
    const { data: d, error } = await c.rpc('my_inbox');
    if (!error) data = d;
  } catch { /* офлайн — лишаємо попереднє */ }
  busy = false;
  paint();
}

function preview(c) {
  if (c.last_kind === 'voice') return 'Голосове' + (c.last_body ? `: ${c.last_body}` : '');
  if (c.last_kind === 'challenge') return c.last_meta?.duel_id ? `Дуель: ${GAMES[c.last_meta.game] || 'гра'}` : 'Новий виклик';
  if (c.last_kind === 'system') {
    const e = c.last_meta?.event;
    return e === 'tutor' ? `Вчитель: ${c.last_meta.text || ''}` : e === 'topic' ? `Тема дня: ${c.last_meta.q || ''}` : e === 'homework' ? 'Нове домашнє завдання' : e === 'weekly' ? 'Підсумок тижня від вчителя'
      : e === 'news' ? `${c.last_meta.name || 'Друг'}: ${c.last_meta.kind === 'streak' ? `серія ${c.last_meta.value} дн. поспіль` : c.last_meta.kind === 'exam' ? 'іспит рівня складено' : 'новий рекорд у грі'}` : '';
  }
  return (c.last_mine ? 'Ви: ' : c.kind === 'group' && c.last_name ? `${c.last_name}: ` : '') + (c.last_body || '');
}
const chatIcon = (c) => (c.kind === 'group' ? 'users-three' : 'chat-circle-dots');

function cardsDue() {
  const now = Date.now();
  return store.all('cards').filter(c => !c.deleted && c.reps > 0 && c.due && Date.parse(c.due) <= now).length;
}

export async function openInbox() {
  let s = null;
  const body = h('div.stack.ib-sheet');
  const close = () => s?.close();
  const prompt = notifyPrompt({ label: 'Сповіщення на цьому телефоні', sub: 'Щоб це все приходило, навіть коли застосунок закрито' });
  const render = () => {
    const d = data || {};
    const chats = d.chats || [];
    const unread = chats.filter(c => c.unread > 0 && !c.muted);
    const fresh = [
      d.feedback_new ? txRow({ icon: 'envelope-simple', label: `Нові звернення користувачів · ${d.feedback_new}`, sub: 'Помилки й ідеї — на сторінці адміністратора', pill: { text: 'Прочитати', tone: 'accent' }, href: '#/admin', onclick: close }) : null,
      ...(d.replies || []).map(x => txRow({ icon: 'envelope-simple', label: 'Відповідь розробника', sub: x.reply, pill: { text: 'Нове', tone: 'accent' }, href: '#/feedback', onclick: close })),
      ...(d.invites || []).map(x => txRow({ icon: 'users-three', label: `${x.from} запрошує вас у групу «${x.title || 'Група'}»`, sub: 'Приєднатися чи відхилити — на сторінці «Друзі»', pill: { text: 'Запрошення', tone: 'accent' }, href: '#/friends', onclick: close })),
      ...(d.requests || []).map(x => txRow({ icon: 'user-plus', label: `${x.name} хоче додати вас у друзі`, sub: 'Прийняти чи відхилити — на сторінці «Друзі»', pill: { text: 'Запит', tone: 'accent' }, href: '#/friends', onclick: close })),
      ...unread.map(c => txRow({ icon: chatIcon(c), label: c.kind === 'group' ? `Нові повідомлення в групі «${c.title || 'Група'}»` : `Вам пише ${c.title || 'друг'}`, sub: preview(c), pill: { text: String(c.unread > 99 ? '99+' : c.unread), tone: 'accent' }, href: `#/friends/chat/${c.id}`, onclick: close })),
      ...(d.homework || []).map(x => txRow({ icon: 'chalkboard-teacher', label: 'Виконайте домашнє завдання', sub: `«${x.title || 'група'}» · виконано ${x.done} з ${x.total} · до ${due(x.due_at)}`, pill: { text: `${x.total - x.done} лишилось`, tone: 'warn' }, href: `#/friends/chat/${x.room_id}`, onclick: close })),
      ...(d.duels || []).map(x => txRow({ icon: 'sword', label: 'Вас кличуть на дуель', sub: `${x.by} · ${GAMES[x.game] || 'гра'} · «${x.title}»`, pill: { text: 'Грати', tone: 'accent' },
        href: `#/games/${x.game}?duel=${x.id}&seed=${x.seed}&lv=${x.level}&room=${x.room_id}`, onclick: close })),
    ].filter(Boolean);
    const recent = chats.slice(0, 5);
    const n = cardsDue();
    body.replaceChildren(...[
      prompt,
      txGroup('Нове', fresh.length ? txRows(fresh) : txRows([txRow({ icon: 'check-circle', label: 'Нових сповіщень немає', sub: 'Повідомлення, домашнє й дуелі з’являться тут', chevron: false })])),
      txGroup('Мої групи й чати', txRows([
        ...recent.map(c => txRow({ icon: chatIcon(c), label: c.title || 'Чат', sub: preview(c) || (c.kind === 'group' ? `${c.members} учасн.` : ''), href: `#/friends/chat/${c.id}`, onclick: close })),
        txRow({ icon: 'users', label: recent.length ? 'Усі чати' : 'Створити групу або написати другу', href: '#/friends/chats', onclick: close, cls: 'ib-all' })])),
      n ? txGroup('Навчання', txRows([txRow({ icon: 'cards', label: `${n} ${plural(n, 'картка чекає', 'картки чекають', 'карток чекають')} на повторення`, href: '#/cards/review', onclick: close })])) : null].filter(Boolean));
  };
  render();
  s = sheet('Сповіщення', body);
  await refreshInbox();
  render();
}

export function initInbox(button) {
  btn = button;
  btn.addEventListener('click', openInbox);
  paint();
  onAuth(() => { data = null; refreshInbox(); });
  const later = () => { clearTimeout(timer); timer = setTimeout(refreshInbox, 1500); };
  addEventListener('hashchange', later);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) later(); });
  setInterval(() => { if (!document.hidden) refreshInbox(); }, 60_000);
  setTimeout(refreshInbox, 2500);
}
