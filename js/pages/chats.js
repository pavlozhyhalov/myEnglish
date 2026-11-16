// «Друзі» → «Чати»: список чатів (#/friends/chats) і чат (#/friends/chat/<id>). Дані й логіка — js/chat.js; стилі — css/chats.css.
// Переписка вчить англійської: вчитель тихо підкреслює помилки в моїх повідомленнях (бачу лише я) і кладе їх у «Мої помилки».
import { h, ic } from '../ui/dom.js';
import { user } from '../supa.js';
import { go, onLeave } from '../router.js';
import { toast } from '../ui/toast.js';
import { sheet, confirmSheet } from '../ui/sheet.js';
import { tx, txPrimary, txGroup, txRow, txRows, txPill, txBar, txLogin } from '../ui/tiles.js';
import { tutor, aiErrorText } from '../ai.js';
import { disputeFix } from '../stats.js';
import * as chat from '../chat.js';
import * as duel from '../duel.js';
import { myLevel, lvLabel } from '../level.js';

const initial = (s) => (String(s || '?').trim().charAt(0) || '?').toUpperCase();
const ava = (name, group = false) => h('span.friend-ava.ch-ava', { 'aria-hidden': 'true' }, group ? ic('users-three', { size: 18 }) : initial(name));
const hhmm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(iso) {
  const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (diff === 0) return 'Сьогодні';
  if (diff === 1) return 'Учора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
}
function whenShort(iso) {
  const d = new Date(iso), now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return hhmm(iso);
  if (now - d < 6 * 864e5) return d.toLocaleDateString('uk-UA', { weekday: 'short' });
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* приватний режим */ } };

/** Текст службового повідомлення */
function sysText(m) {
  const x = m.meta || {};
  switch (x.event) {
    case 'created': return `${x.name || 'Хтось'} створює групу «${x.title || ''}»`;
    case 'joined': return x.by ? `${x.by} додає ${x.name}` : `${x.name} приєднується`;
    case 'left': return `${x.name || 'Учасник'} виходить з групи`;
    case 'renamed': return `${x.name || 'Хтось'} змінює назву на «${x.title || ''}»`;
    case 'topic': return `Тема дня: ${x.q || ''}`;
    case 'homework': return 'Вчитель дав домашнє завдання — у кожного своє';
    case 'homework_done': return `${x.name || 'Учасник'}: домашнє виконано`;
    case 'tutor': return `Вчитель: ${x.text || ''}`;
    case 'duel_score': return `${x.name || 'Учасник'}: ${x.score ?? 0} у дуелі «${duel.GAMES[x.game]?.label || 'гра'}»`;
    default: return '';
  }
}
/** Підпис останнього повідомлення в списку */
function preview(c) {
  if (!c.last_kind) return c.kind === 'group' ? `${c.members} ${c.members === 1 ? 'учасник' : c.members < 5 ? 'учасники' : 'учасників'}` : '';
  if (c.last_kind === 'system') return sysText({ meta: c.last_meta });
  if (c.last_body == null && c.last_kind !== 'challenge') return 'Повідомлення видалено';
  const body = c.last_kind === 'voice' ? `Голосове${c.last_body ? ': ' + c.last_body : ''}`
    : c.last_kind === 'challenge' ? (c.last_meta?.duel_id ? `Дуель: ${duel.GAMES[c.last_meta.game]?.label || 'гра'}` : `Виклик: ${chat.challengeTitle(c.last_meta?.kind, c.last_meta?.target)}`) : c.last_body;
  const who = c.last_mine ? 'Ви: ' : c.kind === 'group' && c.last_name ? `${c.last_name}: ` : '';
  return who + body;
}

/** Вибір друзів (шторка): чекбокси-рядки; exclude — ті, хто вже в групі */
function pickFriends(friends, { title, okLabel, exclude = new Set(), max = chat.MAX_GROUP - 1, withName = false } = {}) {
  return new Promise((resolve) => {
    const picked = new Set();
    const nameInp = withName ? h('input.input', { type: 'text', maxlength: 60, placeholder: 'Наприклад, English club', 'aria-label': 'Назва групи' }) : null;
    const okBtn = h('button.btn.primary.grow', { type: 'button', disabled: !withName ? true : null }, okLabel);
    const list = friends.filter(f => !exclude.has(f.friend_id));
    const rows = list.map(f => {
      const row = h('button.tx-row.ch-pick', { type: 'button', role: 'checkbox', 'aria-checked': 'false' },
        ava(f.name), h('span.tx-body', h('span.tx-l', f.name)), h('span.ch-check', { 'aria-hidden': 'true' }, ic('check', { size: 16 })));
      row.addEventListener('click', () => {
        if (picked.has(f.friend_id)) picked.delete(f.friend_id);
        else { if (picked.size >= max) { toast(`У групі може бути до ${chat.MAX_GROUP} людей`); return; } picked.add(f.friend_id); }
        row.setAttribute('aria-checked', String(picked.has(f.friend_id)));
        row.classList.toggle('on', picked.has(f.friend_id));
        if (!withName) okBtn.disabled = !picked.size;
      });
      return row;
    });
    let done = false;
    const s = sheet(title, h('div.stack.ch-sheet',
      withName ? h('div.field', h('label', 'Назва групи'), nameInp) : null,
      list.length ? h('div.stack', { style: { gap: '6px' } }, h('div.tx-label', withName ? 'Кого запросити' : 'Друзі'), h('div.tx-rows.ch-pick-list', rows))
        : txRow({ icon: 'user-plus', label: 'Немає кого запросити', sub: 'Додайте друзів за кодом на вкладці «Друзі»', href: '#/friends' }),
      h('div.row', okBtn)), { onClose: () => { if (!done) resolve(null); } });
    okBtn.addEventListener('click', () => {
      if (withName && !nameInp.value.trim()) { toast('Введіть назву групи'); nameInp.focus(); return; }
      done = true; s.close(); resolve({ ids: [...picked], title: nameInp?.value.trim() || '' });
    });
    if (withName) setTimeout(() => nameInp.focus(), 300);
  });
}

async function loadFriends() {
  try { return (await chat.rpc('friends_stats')) || []; } catch { return []; }
}

/** Відкрити (створити) чат 1:1 і перейти */
export async function openDmAndGo(friendId) {
  try { const id = await chat.openDm(friendId); go(`/friends/chat/${id}`); }
  catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
}

// ---------------------------------------------------------------- список чатів
export function chatsList(view) {
  if (!user()) {
    view.replaceChildren(h('div.stack-lg', txLogin('Чати з друзями — після входу', 'Пишіть друзям англійською — вчитель тихо підкаже, як правильно')));
    return;
  }
  let alive = true, all = false, rows = null;
  const list = h('div.tx-rows.ch-list', txRow({ icon: 'hourglass', label: 'Завантаження…', chevron: false }));

  async function newGroup() {
    const friends = await loadFriends();
    if (!friends.length) { toast('Спершу додайте друзів за кодом'); go('/friends'); return; }
    const r = await pickFriends(friends, { title: 'Нова група', okLabel: 'Створити', withName: true });
    if (!r) return;
    try { const id = await chat.createGroup(r.title, r.ids); go(`/friends/chat/${id}`); }
    catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
  }
  async function write() {
    const friends = await loadFriends();
    if (!friends.length) { toast('Спершу додайте друзів за кодом'); go('/friends'); return; }
    let s = null;
    s = sheet('Написати другу', h('div.tx-rows.ch-pick-list', friends.map(f =>
      txRow({ label: f.name, end: ava(f.name), onclick: () => { s.close(); openDmAndGo(f.friend_id); } }))));
  }

  function row(c) {
    const group = c.kind === 'group';
    return h('a.tx-row.ch-row' + (c.unread ? '.unread' : ''), { href: `#/friends/chat/${c.id}` },
      ava(c.title, group),
      h('span.tx-body', h('span.tx-l', c.title || 'Чат'), h('span.tx-s.ch-prev', preview(c) || ' ')),
      h('span.ch-meta', h('span.ch-time', whenShort(c.last_at)),
        c.unread ? h('span.ch-badge', { 'aria-label': `${c.unread} нових` }, String(c.unread > 99 ? '99+' : c.unread))
          : c.muted ? h('span.ch-muted', { 'aria-label': 'Без сповіщень' }, ic('bell', { size: 14 })) : null));
  }
  function render() {
    if (!rows.length) {
      list.replaceChildren(txRow({ icon: 'chat-circle-dots', label: 'Поки що чатів немає', sub: 'Напишіть другу або створіть групу', chevron: false }));
      return;
    }
    const shown = all ? rows : rows.slice(0, 6);
    list.replaceChildren(...shown.map(row),
      shown.length < rows.length ? txRow({ icon: 'caret-down', label: `Показати всі · ${rows.length}`, chevron: false, cls: 'tx-showall', onclick: () => { all = true; render(); } }) : '');
  }
  async function load() {
    try { rows = await chat.listChats() || []; if (alive) render(); }
    catch (e) {
      console.warn('chat_list', e);
      if (alive && !rows) list.replaceChildren(txRow({ icon: 'warning-circle', label: navigator.onLine ? 'Не вдалося завантажити чати' : 'Немає мережі', sub: 'Торкніться, щоб повторити', onclick: load }));
    }
  }

  view.replaceChildren(h('div.stack-lg',
    txPrimary({ icon: 'chat-circle-dots', label: 'Написати другу', sub: 'Англійською — вчитель тихо підкаже', onclick: write }),
    txGroup('Чати', list),
    tx({ icon: 'users-three', wide: true, label: 'Нова група', sub: `До ${chat.MAX_GROUP} людей · спільні виклики`, onclick: newGroup })));
  load();
  const iv = setInterval(() => { if (!document.hidden) load(); }, 20000);
  const vis = () => { if (!document.hidden) load(); };
  document.addEventListener('visibilitychange', vis);
  return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', vis); };
}

// ---------------------------------------------------------------- чат
export function chatRoom(view, roomId) {
  if (!user()) { view.replaceChildren(h('div.stack-lg', txLogin('Чати з друзями — після входу'))); return; }
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) { go('/friends/chats', { replace: true }); return; }
  const me = user().id;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let alive = true, info = null, members = new Map(), msgs = [], fb = new Map(), checking = new Set(), more = true, chs = [];
  const byId = new Map();

  const head = h('div.ch-head');
  const strip = h('div.ch-strip');
  const olderBtn = h('button.btn.sm.soft.ch-older', { type: 'button', hidden: true, onclick: older }, 'Показати раніші');
  const list = h('div.ch-msgs', { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const ta = h('textarea', { rows: 1, maxlength: 1000, placeholder: 'Англійською…', 'aria-label': 'Повідомлення', enterkeyhint: 'send', autocapitalize: 'sentences' });
  const sendBtn = h('button.icon-btn.send', { type: 'button', 'aria-label': 'Надіслати' }, ic('paper-plane-right', { fill: true }));
  const micBtn = chat.canVoice() ? h('button.icon-btn', { type: 'button', 'aria-label': 'Записати голосове' }, ic('microphone')) : null;
  const composer = h('div.composer', micBtn, ta, sendBtn);
  const dock = h('div.tutor-dock.ch-dock', composer);
  const draftKey = `me:chdraft:${roomId}`;
  ta.value = lsGet(draftKey);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', () => { grow(); lsSet(draftKey, ta.value.trim() ? ta.value : ''); });
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.ctrlKey || e.metaKey || (!e.shiftKey && !coarse)) { e.preventDefault(); sendText(); }
  });
  sendBtn.addEventListener('mousedown', (e) => { if (document.activeElement === ta) e.preventDefault(); });
  sendBtn.addEventListener('click', () => sendText());
  micBtn?.addEventListener('click', () => record());

  view.replaceChildren(h('div.ch-room', head, strip, olderBtn, list, dock));

  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
  const toBottom = () => { const go2 = () => window.scrollTo({ top: document.documentElement.scrollHeight }); requestAnimationFrame(go2); setTimeout(go2, 350); };
  const nameOf = (uid) => members.get(uid)?.name || 'Учасник';

  // ---------- шапка й виклики ----------
  function renderHead() {
    if (!info) return;
    const group = info.kind === 'group';
    const others = [...members.values()].filter(m => !m.is_me);
    const sub = group ? `${members.size} ${members.size < 5 ? 'учасники' : 'учасників'} · ${others.slice(0, 3).map(m => m.name).join(', ')}${others.length > 3 ? '…' : ''}`
      : info.is_friend === false ? 'Більше не у друзях' : 'Друг · переписка англійською';
    head.replaceChildren(h('div.tx-row.ch-title',
      ava(info.title, group),
      h('span.tx-body', h('span.tx-l', info.title || 'Чат'), h('span.tx-s', sub)),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Разом: дуель або виклик', onclick: challengeSheet }, ic('trophy', { size: 20 })),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Про чат', onclick: menu }, ic(group ? 'users' : 'info', { size: 20 }))));
  }
  function challengeRow(c) {
    const def = chat.challengeDef(c.kind);
    const mine = c.people.find(p => p.me);
    const leader = [...c.people].sort((a, b) => b.value - a.value)[0];
    const left = chat.daysLeft(c);
    const sub = `Ви: ${mine?.value ?? 0} з ${c.target}${leader && !leader.me && leader.value > 0 ? ` · ${leader.name}: ${leader.value}` : ''}`;
    return txRow({ icon: def.icon, label: chat.challengeTitle(c.kind, c.target), sub,
      pill: (mine?.value ?? 0) >= c.target ? { text: 'Виконано', tone: 'good' } : { text: left > 1 ? `${left} дн.` : 'Останній день', tone: left > 1 ? '' : 'warn' },
      onclick: () => challengeDetails(c) });
  }
  function renderStrip() {
    const act = chs.filter(chat.challengeActive);
    // дуелі, у які я ще не зіграв, — угорі, щоб не загубились у переписці
    const open = dls.filter(d => !d.over && !d.results.some(p => p.me && p.score != null)).slice(0, 2);
    const hwLeft = hw?.mine && !hw.over && !hw.mine.done_at ? hw.mine.tasks.filter(t => !chat.hwTaskDone(t)).length : 0;
    const rows = [
      hwLeft ? txRow({ icon: 'chalkboard-teacher', label: 'Домашнє завдання', sub: `Виконано ${hw.mine.tasks.length - hwLeft} з ${hw.mine.tasks.length} · до ${dueLabel(hw.due_at)}`,
        pill: { text: `${hwLeft} лишилось`, tone: 'accent' }, onclick: () => hwSheet() }) : null,
      ...open.map(d => txRow({ icon: 'sword', label: `Дуель · ${(duel.GAMES[d.game] || duel.GAMES.detective).label}`, sub: `Зіграли ${d.results.filter(p => p.score != null).length} з ${d.results.length}`,
        pill: { text: 'Грати', tone: 'accent' }, href: duel.duelHref(d.game, d, roomId) })),
      ...act.slice(0, 3).map(challengeRow)];
    strip.replaceChildren(rows.some(Boolean) ? txRows(rows) : '');
  }
  let dls = [];   // дуелі за 7 днів (js/duel.js)
  let hw = null;   // поточне домашнє групи (chat_homework_status)
  async function loadChallenges() {
    try {
      const [a, b, c] = await Promise.all([chat.challenges(roomId), duel.duels(roomId).catch(() => []),
        info?.kind === 'group' ? chat.homework(roomId).catch(() => null) : null]);
      chs = a || []; dls = b || []; hw = c || null;
      // усе виконано — сервер перевіряє й один раз пише про це в групу
      if (hw?.mine && !hw.over && !hw.mine.done_at && hw.mine.tasks.length && hw.mine.tasks.every(chat.hwTaskDone)) {
        chat.homeworkDone(hw.id).then((ok) => {
          if (!ok || !alive) return;
          toast('Домашнє виконано — молодець!'); hw.mine.done_at = new Date().toISOString(); renderStrip(); refreshCards();
          chat.praiseTutor(roomId).then((r) => { if (r?.message && alive) append(r.message); });   // вчитель вітає в групі
        });
      }
      if (alive) { renderStrip(); refreshCards(); }
    } catch (e) { console.warn('challenges', e); }
  }
  const dueLabel = (iso) => new Date(iso).toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'numeric' });
  async function askHomework(btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await chat.newHomework(roomId);
      if (r && !r.created) toast('Домашнє вже є — ось воно');
      await loadChallenges();
      hwSheet();
    } catch (e) { toast(aiErrorText(e) || chat.chatErrText(e), { kind: 'bad' }); }
    if (btn) btn.disabled = false;
  }
  /** Шторка «Домашнє»: моє (особисто для мене) і клас (лише «N з 3») */
  function hwSheet() {
    if (!hw) return;
    const mine = hw.mine;
    let s = null;
    const act = (t) => {
      if (hw.over || chat.hwTaskDone(t)) return null;
      if (t.kind === 'write') return () => { s.close(); setTimeout(() => ta.focus(), 250); };
      if (t.kind === 'speak') return micBtn ? () => { s.close(); setTimeout(() => record(), 250); } : null;
      return null;
    };
    const href = (t) => (hw.over || chat.hwTaskDone(t) ? null : t.kind === 'lesson' && t.lesson_id ? `#/grammar/${encodeURIComponent(t.lesson_id)}` : t.kind === 'words' ? '#/cards/train' : null);
    const unit = (t) => (t.kind === 'write' ? 'слів' : t.kind === 'speak' ? 'с' : t.kind === 'words' ? 'слів' : '');
    const taskRow = (t, i) => {
      const done = chat.hwTaskDone(t);
      const fn = act(t), link = href(t);
      const kids = [
        h('span.tx-no' + (done ? '.hw-ok' : ''), done ? ic('check', { size: 16 }) : String(i + 1)),
        h('span.tx-body',
          h('span.tx-l', t.title_uk),
          t.prompt_en ? h('span.hw-en', { lang: 'en' }, t.prompt_en) : null,
          t.prompt_uk && ['A0', 'A1', 'A2'].includes(myLevel()) ? h('span.tx-s', t.prompt_uk) : null,
          t.focus_uk ? h('span.hw-focus', t.focus_uk) : null,
          t.kind !== 'lesson' ? txBar(Math.min(1, (t.value || 0) / (t.target || 1)), true) : null),
        h('span.hw-val', t.kind === 'lesson' ? (done ? 'Зараховано' : '') : `${Math.min(t.value || 0, 9999)}/${t.target}${unit(t) === 'с' ? ' с' : ''}`)];
      if (fn) return h('button.tx-row.hw-task', { type: 'button', onclick: fn }, ...kids, ic('caret-right', { size: 16 }));
      if (link) return h('a.tx-row.hw-task', { href: link, onclick: () => s.close() }, ...kids, ic('caret-right', { size: 16 }));
      return h('div.tx-row.hw-task' + (done ? '.on' : ''), ...kids);
    };
    s = sheet('Домашнє завдання', h('div.stack.ch-sheet',
      h('div.tx-s', hw.over ? 'Термін минув' : `У кожного своє · до ${dueLabel(hw.due_at)}`),
      mine ? h('div.hw-note', h('span.tx-sq', ic('chalkboard-teacher', { size: 18 })), h('p', mine.note)) : h('div.tx-s', 'Вас ще не було в групі, коли вчитель дав це завдання.'),
      mine ? txGroup(mine.done_at ? 'Моє · виконано' : 'Моє', h('div.tx-rows', mine.tasks.map(taskRow))) : null,
      hw.class?.length > 1 ? txGroup('Клас', txRows(hw.class.map(c => txRow({ label: c.me ? `${c.name} (ви)` : c.name, end: ava(c.name),
        pill: { text: `${c.done} з ${c.total}`, tone: c.done >= c.total ? 'good' : '' }, chevron: false })))) : null,
      hw.over ? h('button.btn.soft', { type: 'button', onclick: (e) => { s.close(); askHomework(e.currentTarget); } }, ic('arrow-clockwise', { size: 16 }), 'Нове домашнє') : null));
  }
  /** Репліка вчителя в групі */
  function tutorBubble(m) {
    const text = String(m.meta?.text || '');
    const el = h('div.msg.ai.ch-msg.ch-tutor', { tabindex: 0, role: 'article' },
      h('div.ch-name.ch-tutor-name', ic('chalkboard-teacher', { size: 14 }), 'Вчитель'),
      h('div.ch-text', { lang: 'en' }, text),
      h('span.ch-ts', hhmm(m.created_at)));
    const open = () => actions({ ...m, body: text, user_id: '__tutor__' });
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    return h('div.ch-wrap.ai', { dataset: { id: m.id } }, el);
  }
  function hwCard(m) {
    const cur = hw && hw.id === m.meta?.homework_id ? hw : null;
    const mine = cur?.mine;
    const doneN = mine ? mine.tasks.filter(chat.hwTaskDone).length : 0;
    const sub = !cur ? 'Завершено' : cur.over ? 'Термін минув' : mine
      ? `У кожного своє · ви: ${doneN} з ${mine.tasks.length} · до ${dueLabel(cur.due_at)}` : 'У кожного своє';
    return h('div.ch-card', { dataset: { id: m.id } },
      tx({ icon: 'chalkboard-teacher', wide: true, cls: 'ch-chal ch-hw', label: 'Домашнє завдання від вчителя', sub,
        end: mine && !cur.over ? (mine.done_at || doneN >= mine.tasks.length ? txPill('Виконано', 'good') : txPill('Відкрити', 'accent')) : undefined,
        onclick: cur ? () => hwSheet() : null }));
  }
  function duelDetails(d) {
    const g = duel.GAMES[d.game] || duel.GAMES.detective;
    const meDone = d.results.some(p => p.me && p.score != null);
    let s = null;
    s = sheet(`Дуель · ${g.label}`, h('div.stack.ch-sheet',
      h('div.tx-s', d.over ? 'Дуель завершено' : `Рівень ${lvLabel(d.level)} · ті самі завдання для всіх · до ${new Date(d.ends_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} завтра`),
      duel.duelTable(d.results),
      !d.over && !meDone ? txPrimary({ icon: g.icon, label: 'Грати', sub: g.sub, href: duel.duelHref(d.game, d, roomId), onclick: () => s.close() }) : null));
  }
  function challengeDetails(c) {
    const people = [...c.people].sort((a, b) => b.value - a.value);
    const def = chat.challengeDef(c.kind);
    const active = chat.challengeActive(c);
    let s = null;
    s = sheet(chat.challengeTitle(c.kind, c.target), h('div.stack.ch-sheet',
      h('div.tx-s', active ? `${c.starts_on.split('-').reverse().slice(0, 2).join('.')} – ${c.ends_on.split('-').reverse().slice(0, 2).join('.')} · лишилось ${chat.daysLeft(c)} дн.` : c.cancelled ? 'Скасовано' : 'Завершено'),
      h('div.tx-rows', people.map((p, i) => h('div.tx-row.ch-prog' + (p.me ? '.on' : ''),
        h('span.tx-no', String(i + 1)),
        h('span.tx-body', h('span.tx-l', p.me ? `${p.name} (ви)` : p.name), txBar(p.value / c.target, p.me)),
        h('span.ch-val', `${p.value}/${c.target}`)))),
      h('div.xs.dim', def.sub + '. Друзі бачать лише числа.'),
      c.mine && active ? h('button.btn.soft', { type: 'button', onclick: async () => {
        if (!await confirmSheet('Скасувати виклик?', 'Прогрес учасників зникне з чату.', 'Скасувати виклик', { danger: true })) return;
        try { await chat.cancelChallenge(c.id); s.close(); toast('Виклик скасовано'); loadChallenges(); } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
      } }, 'Скасувати виклик') : null));
  }
  function challengeSheet() {
    let s = null;
    const act = chs.filter(chat.challengeActive);
    const group = info?.kind === 'group';
    const hwActive = hw && !hw.over;
    s = sheet('Разом', h('div.stack.ch-sheet',
      group ? h('div.tx-label', 'Домашнє від вчителя') : null,
      group ? txRows([txRow({ icon: 'chalkboard-teacher', label: hwActive ? 'Моє домашнє' : 'Отримати домашнє', on: !hwActive,
        sub: hwActive && hw.mine ? `Виконано ${hw.mine.tasks.filter(chat.hwTaskDone).length} з ${hw.mine.tasks.length} · до ${dueLabel(hw.due_at)}` : 'У кожного своє — за рівнем і помилками · на 7 днів',
        onclick: (e) => { s.close(); hwActive ? hwSheet() : askHomework(e.currentTarget); } }),
        txRow({ icon: 'chat-circle-dots', label: 'Запитати вчителя', sub: 'Почніть повідомлення з @teacher — він відповість у групі', onclick: () => {
          s.close(); if (!/@teacher/i.test(ta.value)) ta.value = `@teacher ${ta.value}`.trimEnd() + ' '; grow(); setTimeout(() => ta.focus(), 250);
        } })]) : null,
      h('div.tx-label', 'Дуель зараз · 24 години'),
      txRows(Object.entries(duel.GAMES).map(([id, g]) => txRow({ icon: g.icon, label: g.label, sub: `${g.sub} · рівень ${lvLabel(myLevel())}`, onclick: async () => {
        try {
          const dId = await duel.createDuel(roomId, id, myLevel());
          s.close();
          await loadChallenges();
          const d = dls.find(x => x.id === dId);
          if (d) location.hash = duel.duelHref(d.game, d, roomId);
        } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
      } }))),
      act.length ? h('div.stack', { style: { gap: '6px' } }, h('div.tx-label', 'Виклики зараз'), txRows(act.map(challengeRow))) : null,
      h('div.tx-label', 'Виклик на тиждень'),
      txRows(chat.CHALLENGES.map(d => txRow({ icon: d.icon, label: d.label, sub: d.sub, onclick: async () => {
        try { await chat.createChallenge(roomId, d.kind, d.target); s.close(); toast('Виклик почався — удачі!'); loadChallenges(); }
        catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
      } })))));
  }

  // ---------- меню чату ----------
  async function menu() {
    if (!info) return;
    const group = info.kind === 'group';
    let s = null;
    const close = () => s?.close();
    const items = [];
    if (group) {
      items.push(txGroup(`Учасники · ${members.size}`, txRows([...members.values()].map(m => txRow({
        label: m.is_me ? `${m.name} (ви)` : m.name, sub: m.role === 'owner' ? 'Створив(-ла) групу' : null, end: ava(m.name),
        onclick: m.is_me ? null : () => { close(); memberMenu(m); }, chevron: !m.is_me })))));
      items.push(txRows([
        txRow({ icon: 'user-plus', label: 'Запросити друзів', onclick: async () => {
          close();
          const r = await pickFriends(await loadFriends(), { title: 'Запросити в групу', okLabel: 'Запросити', exclude: new Set(members.keys()), max: chat.MAX_GROUP - members.size });
          if (!r?.ids.length) return;
          try { const n = await chat.invite(roomId, r.ids); toast(n ? 'Запрошено' : 'Нікого не додано'); await loadMembers(); } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
        } }),
        txRow({ icon: 'pencil-simple', label: 'Перейменувати', onclick: () => { close(); renameSheet(); } }),
      ]));
    }
    items.push(txRows([
      txRow({ icon: 'bell', label: info.muted ? 'Увімкнути сповіщення' : 'Вимкнути сповіщення', sub: info.muted ? 'Зараз без сповіщень' : 'Сповіщення приходять, коли застосунок закрито', onclick: async () => {
        close();
        try { info.muted = await chat.mute(roomId, !info.muted); toast(info.muted ? 'Сповіщення вимкнено' : 'Сповіщення увімкнено'); } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
      } }),
      group ? txRow({ icon: 'sign-out', label: 'Вийти з групи', cls: 'ch-danger', onclick: async () => {
        close();
        if (!await confirmSheet('Вийти з групи?', 'Ви більше не бачитимете повідомлень. Повернутися можна, якщо друг запросить знову.', 'Вийти', { danger: true })) return;
        try { await chat.leave(roomId); toast('Ви вийшли з групи'); go('/friends/chats', { replace: true }); } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
      } }) : txRow({ icon: 'x-circle', label: 'Заблокувати', sub: 'Дружба припиниться, писати не зможете', cls: 'ch-danger', onclick: () => { close(); blockUser(info.other_id, info.title); } }),
    ]));
    s = sheet(info.title || 'Чат', h('div.stack.ch-sheet', items));
  }
  function memberMenu(m) {
    let s = null;
    s = sheet(m.name, h('div.stack.ch-sheet', txRows([
      m.is_friend ? txRow({ icon: 'chat-circle-dots', label: 'Написати особисто', onclick: () => { s.close(); openDmAndGo(m.user_id); } }) : null,
      txRow({ icon: 'x-circle', label: m.blocked ? 'Розблокувати' : 'Заблокувати', sub: m.blocked ? 'Знову бачитимете повідомлення' : 'Не бачитимете повідомлень цієї людини', cls: m.blocked ? null : 'ch-danger',
        onclick: async () => {
          s.close();
          if (m.blocked) { try { await chat.unblock(m.user_id); toast('Розблоковано'); await reload(); } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); } }
          else blockUser(m.user_id, m.name);
        } }),
    ])));
  }
  async function blockUser(uid, name) {
    if (!uid) return;
    if (!await confirmSheet(`Заблокувати ${name || 'людину'}?`, 'Ви більше не друзі, писати одне одному не зможете, у групах ви не бачитимете її повідомлень. Розблокувати можна на вкладці «Друзі».', 'Заблокувати', { danger: true })) return;
    try {
      await chat.block(uid); toast('Заблоковано');
      if (info?.kind === 'dm') go('/friends/chats', { replace: true }); else await reload();
    } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
  }
  function renameSheet() {
    const inp = h('input.input', { type: 'text', maxlength: 60, value: info.title || '', 'aria-label': 'Назва групи' });
    let s = null;
    const save = async () => {
      const t = inp.value.trim();
      if (!t) { inp.focus(); return; }
      try { info.title = await chat.rename(roomId, t); s.close(); renderHead(); } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    s = sheet('Назва групи', h('div.stack.ch-sheet', inp, h('button.btn.primary', { type: 'button', onclick: save }, 'Зберегти')));
    setTimeout(() => inp.focus(), 300);
  }

  // ---------- повідомлення ----------
  /** Текст з підкресленими фрагментами помилок (лише мої повідомлення) */
  function marked(text, fixes) {
    if (!fixes?.length) return [text];
    const low = text.toLowerCase();
    const spans = [];
    for (const f of fixes) {
      const i = low.indexOf(String(f.wrong || '').toLowerCase());
      if (i >= 0 && !spans.some(s => i < s.b && i + f.wrong.length > s.a)) spans.push({ a: i, b: i + f.wrong.length });
    }
    spans.sort((x, y) => x.a - y.a);
    const out = []; let p = 0;
    for (const s of spans) { out.push(text.slice(p, s.a), h('mark.ch-err', text.slice(s.a, s.b))); p = s.b; }
    out.push(text.slice(p));
    return out;
  }
  function fixesSheet(m) {
    const fixes = fb.get(m.id) || [];
    let s = null;
    const body = h('div.stack.ch-sheet',
      h('div.tx-s', 'Бачите лише ви. Помилки вже в «Моїх помилках».'),
      fixes.map(f => h('div.ch-fix',
        h('div.ch-fix-w', ic('x', { size: 14 }), h('s', f.wrong)),
        h('div.ch-fix-r', ic('check', { size: 14 }), h('b', f.right)),
        f.why_uk ? h('div.tx-s', f.why_uk) : null,
        h('button.btn.sm.ghost', { type: 'button', onclick: (e) => {
          disputeFix({ wrong: f.wrong, right: f.right });
          fb.set(m.id, (fb.get(m.id) || []).filter(x => x !== f));
          e.currentTarget.closest('.ch-fix').remove();
          update(m); toast('Виправлення прибрано — вчитель його не повторюватиме');
          if (!(fb.get(m.id) || []).length) s.close();
        } }, 'Не згоден'))),
      m.kind === 'text' ? h('button.btn.soft', { type: 'button', onclick: () => {
        let t = m.body;
        for (const f of fixes) { const i = t.toLowerCase().indexOf(f.wrong.toLowerCase()); if (i >= 0) t = t.slice(0, i) + f.right + t.slice(i + f.wrong.length); }
        ta.value = t; grow(); s.close(); ta.focus();
      } }, ic('pencil-simple', { size: 16 }), 'Написати правильно ще раз') : null);
    s = sheet('Як краще', body);
  }
  let playing = null;   // { audio, reset } — одночасно грає лише одне голосове
  onLeave(view, () => playing?.audio.pause());
  function voicePlayer(m) {
    let audio = null;
    const btn = h('button.ch-play', { type: 'button', 'aria-label': 'Слухати голосове' }, ic('play', { size: 18, fill: true }));
    const bar = h('span.ch-wave', h('i'));
    const time = h('span.ch-dur', fmtDur(m.meta?.dur || 0));
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (!audio) {
          // адреса вже є (prefetchAudio) — play() лишається в межах дотику (iOS)
          audio = new Audio(chat.cachedAudioUrl(m.audio_path) || await chat.audioUrl(m.audio_path));
          audio.addEventListener('timeupdate', () => { const d = audio.duration || m.meta?.dur || 1; bar.firstChild.style.width = `${Math.min(100, audio.currentTime / d * 100)}%`; time.textContent = fmtDur(audio.currentTime); });
          audio.addEventListener('ended', () => { btn.replaceChildren(ic('play', { size: 18, fill: true })); bar.firstChild.style.width = '0'; time.textContent = fmtDur(m.meta?.dur || 0); });
          audio.addEventListener('pause', () => btn.replaceChildren(ic('play', { size: 18, fill: true })));
        }
        if (audio.paused) {
          if (playing && playing.audio !== audio) playing.audio.pause();
          playing = { audio };
          await audio.play(); btn.replaceChildren(ic('pause', { size: 18, fill: true }));
        } else audio.pause();
      } catch (err) { console.warn('play', err); toast('Не вдалося відтворити', { kind: 'bad' }); }
    });
    return h('div.ch-voice', btn, bar, time);
  }
  function duelCard(m) {
    const d = dls.find(x => x.id === m.meta?.duel_id);
    const g = duel.GAMES[m.meta?.game] || duel.GAMES.detective;
    const mine = m.user_id === me;
    const played = d ? d.results.filter(p => p.score != null) : [];
    const meDone = d?.results.some(p => p.me && p.score != null);
    const leader = played[0];
    const sub = d?.over ? (leader ? `Завершено · переміг(-ла) ${leader.me ? 'ви' : leader.name} · ${leader.score}` : 'Завершено')
      : `${mine ? 'Ви кличете' : `${m.meta?.name || nameOf(m.user_id)} кличе`} на дуель · рівень ${lvLabel(m.meta?.level)}${played.length ? ` · зіграли ${played.length}` : ''}`;
    return h('div.ch-card', { dataset: { id: m.id } },
      tx({ icon: 'sword', wide: true, cls: 'ch-chal ch-duel', label: `Дуель · ${g.label}`, sub,
        end: d && !d.over && !meDone ? txPill('Грати', 'accent') : leader ? h('span.dl-score', String(leader.score)) : undefined,
        onclick: d ? () => (d.over || meDone ? duelDetails(d) : (location.hash = duel.duelHref(d.game, d, roomId))) : null }));
  }
  function topicCard(m) {
    const x = m.meta || {};
    const angles = Array.isArray(x.a) ? x.a.filter(Boolean).slice(0, 3) : [];
    return h('div.ch-card.ch-topic', { dataset: { id: m.id } },
      h('div.tx.wide.ch-topic-in',
        h('span.tx-sq', ic('chalkboard-teacher', { size: 20 })),
        h('span.tx-body',
          h('span.tx-s.ch-topic-lab', `Тема дня від вчителя · ${x.uk || x.en || ''}`),
          h('span.tx-l.ch-topic-q', { lang: 'en' }, x.q || ''),
          angles.length ? h('span.tx-s', { lang: 'en' }, 'Ideas: ' + angles.join(' · ')) : null,
          h('button.btn.sm.soft.ch-topic-btn', { type: 'button', onclick: () => { ta.focus(); } }, ic('pencil-simple', { size: 16 }), 'Відповісти англійською'))));
  }
  function challengeCard(m) {
    if (m.meta?.duel_id) return duelCard(m);
    const c = chs.find(x => x.id === m.meta?.challenge_id);
    const mine = m.user_id === me;
    return h('div.ch-card', { dataset: { id: m.id } },
      tx({ icon: 'trophy', wide: true, cls: 'ch-chal', label: chat.challengeTitle(m.meta?.kind, m.meta?.target),
        sub: `${mine ? 'Ви почали' : `${m.meta?.name || nameOf(m.user_id)} пропонує`} виклик на 7 днів${c ? ` · ${c.people.filter(p => p.value >= c.target).length} з ${c.people.length} виконали` : ''}`,
        onclick: c ? () => challengeDetails(c) : null }));
  }
  function refreshCards() { for (const m of msgs) if (m.kind === 'challenge' || m.meta?.event === 'homework') update(m); }

  function bubble(m) {
    if (m.kind === 'system' && m.meta?.event === 'topic') return topicCard(m);
    if (m.kind === 'system' && m.meta?.event === 'homework') return hwCard(m);
    if (m.kind === 'system' && m.meta?.event === 'tutor') return tutorBubble(m);
    if (m.kind === 'system') { const t = sysText(m); return t ? h('div.msg.sys', { dataset: { id: m.id } }, t) : h('div', { dataset: { id: m.id }, hidden: true }); }
    if (m.kind === 'challenge') return challengeCard(m);
    const mine = m.user_id === me;
    const group = info?.kind === 'group';
    if (m.deleted_at) return h(`div.msg.${mine ? 'me' : 'ai'}.ch-del`, { dataset: { id: m.id } }, 'Повідомлення видалено');
    const fixes = mine ? fb.get(m.id) : null;
    const kids = [];
    if (!mine && group) kids.push(h('div.ch-name', nameOf(m.user_id)));
    if (m.kind === 'voice') kids.push(voicePlayer(m));
    if (m.body) kids.push(h('div.ch-text' + (m.kind === 'voice' ? '.ch-tr' : ''), { lang: 'en' }, ...(mine ? marked(m.body, fixes) : [m.body])));
    kids.push(h('span.ch-ts', hhmm(m.created_at)));
    const el = h(`div.msg.${mine ? 'me' : 'ai'}.ch-msg`, { dataset: { id: m.id }, tabindex: 0, role: 'article' }, kids);
    el.addEventListener('click', (e) => { if (!e.target.closest('button, mark')) actions(m); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) actions(m); });
    el.querySelectorAll('mark.ch-err').forEach(mk => mk.addEventListener('click', (e) => { e.stopPropagation(); fixesSheet(m); }));
    const wrapEl = h('div.ch-wrap.' + (mine ? 'me' : 'ai'), { dataset: { id: m.id } }, el);
    if (mine && fixes?.length) wrapEl.append(h('button.ch-fixes', { type: 'button', onclick: () => fixesSheet(m) }, ic('lightbulb', { size: 14 }), `Як краще · ${fixes.length}`));
    else if (mine && checking.has(m.id)) wrapEl.append(h('span.ch-checking', 'Вчитель перевіряє…'));
    return wrapEl;
  }
  async function actions(m) {
    const mine = m.user_id === me;
    let s = null;
    const rows = [];
    if (m.body) rows.push(txRow({ icon: 'copy', label: 'Копіювати', onclick: async () => { s.close(); try { await navigator.clipboard.writeText(m.body); toast('Скопійовано'); } catch { toast('Не вдалося скопіювати'); } } }));
    if (!mine && m.body) rows.push(txRow({ icon: 'translate', label: 'Перекласти', onclick: async () => {
      s.close();
      try { const r = await tutor('translate', { text: m.body }); sheet('Переклад', h('div.stack.ch-sheet', h('p', { lang: 'en' }, m.body), h('p.ch-uk', r?.uk || ''))); }
      catch (e) { toast(aiErrorText(e) || 'Не вдалося перекласти', { kind: 'bad' }); }
    } }));
    if (mine && (fb.get(m.id) || []).length) rows.push(txRow({ icon: 'lightbulb', label: 'Як краще', onclick: () => { s.close(); fixesSheet(m); } }));
    if (mine) rows.push(txRow({ icon: 'trash', label: 'Видалити', sub: 'Зникне в усіх', cls: 'ch-danger', onclick: async () => {
      s.close();
      if (!await confirmSheet('Видалити повідомлення?', 'Воно зникне в усіх учасників чату.', 'Видалити', { danger: true })) return;
      try { await chat.deleteMessage(m); m.deleted_at = new Date().toISOString(); m.body = ''; update(m); } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
    } }));
    if (!rows.length) return;
    s = sheet(mine ? 'Ваше повідомлення' : m.user_id === '__tutor__' ? 'Вчитель' : nameOf(m.user_id), h('div.stack.ch-sheet', txRows(rows)));
  }

  function renderAll() {
    const kids = [];
    let last = '';
    for (const m of msgs) {
      const k = dayKey(m.created_at);
      if (k !== last) { kids.push(h('div.ch-day', dayLabel(m.created_at))); last = k; }
      kids.push(bubble(m));
    }
    if (!msgs.length) kids.push(h('div.ch-empty', ic('chat-circle-dots', { size: 28 }), h('div', 'Напишіть перше повідомлення англійською'), h('div.tx-s', 'Помилки підкреслить вчитель — бачите лише ви')));
    list.replaceChildren(...kids);
    olderBtn.hidden = !more;
  }
  function update(m) {
    const old = list.querySelector(`:scope > [data-id="${m.id}"]`);
    if (old) old.replaceWith(bubble(m));
  }
  function append(m) {
    if (byId.has(m.id)) { Object.assign(byId.get(m.id), m); update(byId.get(m.id)); return; }
    byId.set(m.id, m);
    if (m.kind === 'voice' && m.audio_path) chat.prefetchAudio([m.audio_path]);
    const stick = nearBottom() || m.user_id === me;
    const lastM = msgs[msgs.length - 1];
    msgs.push(m);
    list.querySelector('.ch-empty')?.remove();
    if (!lastM || dayKey(lastM.created_at) !== dayKey(m.created_at)) list.append(h('div.ch-day', dayLabel(m.created_at)));
    list.append(bubble(m));
    if (stick) toBottom();
  }

  async function loadMembers() {
    const rows = await chat.roomMembers(roomId);
    members = new Map(rows.map(r => [r.user_id, r]));
  }
  async function loadInfo() {
    const all = await chat.listChats();
    info = (all || []).find(c => c.id === roomId) || null;
    if (!info) {
      // чат 1:1 без повідомлень не показується в списку — назва з учасників
      const others = [...members.values()].filter(m => !m.is_me);
      info = { id: roomId, kind: others.length === 1 && members.size === 2 ? 'dm' : 'group', title: others.length === 1 ? others[0].name : 'Група', other_id: others[0]?.user_id, muted: false, is_friend: others[0]?.is_friend };
    }
  }
  async function reload() {
    await loadMembers();
    await loadInfo();
    const data = await chat.messages(roomId);
    more = data.length >= chat.PAGE;
    msgs = data; byId.clear(); for (const m of msgs) byId.set(m.id, m);
    fb = await chat.feedback(msgs.filter(m => m.user_id === me && m.kind !== 'system').map(m => m.id));
    chat.prefetchAudio(msgs.filter(m => m.kind === 'voice' && m.audio_path && !m.deleted_at).map(m => m.audio_path));
    if (!alive) return;
    renderHead(); renderAll(); toBottom();
  }
  async function older() {
    if (!msgs.length) return;
    olderBtn.disabled = true;
    try {
      const data = await chat.messages(roomId, msgs[0].created_at);
      more = data.length >= chat.PAGE;
      const add = data.filter(m => !byId.has(m.id));
      for (const m of add) byId.set(m.id, m);
      const f2 = await chat.feedback(add.filter(m => m.user_id === me).map(m => m.id));
      for (const [k, v] of f2) fb.set(k, v);
      chat.prefetchAudio(add.filter(m => m.kind === 'voice' && m.audio_path).map(m => m.audio_path));
      const h0 = document.documentElement.scrollHeight;
      msgs = [...add, ...msgs];
      renderAll();
      window.scrollTo({ top: window.scrollY + document.documentElement.scrollHeight - h0 });
    } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
    olderBtn.disabled = false;
  }

  // ---------- надсилання ----------
  let sending = false;
  async function sendText() {
    const body = ta.value.trim();
    if (!body || sending) return;
    if (info?.kind === 'dm' && info.is_friend === false) { toast(chat.chatErrText({ code: 'not_friends' }), { kind: 'bad' }); return; }
    sending = true; sendBtn.disabled = true;
    try {
      const m = await chat.sendText(roomId, body);
      ta.value = ''; grow(); lsSet(draftKey, '');
      checking.add(m.id);
      append(m);
      if (info?.kind === 'group' && chat.mentionsTutor(body)) tutorTyping(m.id);
      chat.checkMessage(m).then(({ fixes }) => {
        checking.delete(m.id);
        if (fixes.length) fb.set(m.id, fixes);
        if (alive) update(byId.get(m.id) || m);
      }).catch((e) => { checking.delete(m.id); if (alive) update(byId.get(m.id) || m); console.warn('friend_check', e?.code || e); });
    } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); }
    sending = false; sendBtn.disabled = false;
  }

  /** «Вчитель пише…» поки сервер готує відповідь; сама репліка приходить через Realtime (або з відповіді функції) */
  async function tutorTyping(messageId) {
    const ph = h('div.ch-wrap.ai.ch-typing', h('div.msg.ai.ch-msg.ch-tutor', h('div.ch-name.ch-tutor-name', ic('chalkboard-teacher', { size: 14 }), 'Вчитель'),
      h('span.typing', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span.sr-only', 'Вчитель пише…')));
    list.append(ph); toBottom();
    try {
      const r = await chat.askTutor(roomId, messageId);
      ph.remove();
      if (r?.message && alive) append(r.message);
      else if (r?.skipped === 'limit') toast('Вчитель сьогодні вже багато говорив — завтра продовжить');
    } catch (e) { ph.remove(); toast(aiErrorText(e) || 'Вчитель зараз не відповів', { kind: 'bad' }); }
  }

  let rec = null;
  async function record() {
    if (rec) return;
    if (info?.kind === 'dm' && info.is_friend === false) { toast(chat.chatErrText({ code: 'not_friends' }), { kind: 'bad' }); return; }
    const time = h('span.ch-rec-t', '0:00');
    const cancelBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Скасувати запис' }, ic('trash'));
    const stopBtn = h('button.icon-btn.send', { type: 'button', 'aria-label': 'Надіслати голосове' }, ic('paper-plane-right', { fill: true }));
    const bar = h('div.composer.ch-rec', cancelBtn, h('span.ch-rec-dot', { 'aria-hidden': 'true' }), time, h('span.ch-rec-hint', 'Говоріть англійською'), stopBtn);
    try {
      rec = await chat.startRecording({ onTick: (s) => { time.textContent = fmtDur(s); } });
    } catch (e) {
      rec = null;
      toast(e?.name === 'NotAllowedError' ? 'Дозвольте мікрофон у налаштуваннях браузера' : 'Мікрофон недоступний', { kind: 'bad' });
      return;
    }
    composer.replaceWith(bar);
    const mine = rec;
    const restore = () => { if (bar.isConnected) bar.replaceWith(composer); if (rec === mine) rec = null; };
    // вихід зі сторінки чи «Скасувати» — запис не надсилається
    onLeave(view, () => { if (rec === mine) rec = null; mine.cancel(); });
    cancelBtn.addEventListener('click', () => { mine.cancel(); restore(); });
    const finish = async () => {
      if (rec !== mine || mine.cancelled || !alive) return;
      const r = mine; rec = null;
      const { blob, dur } = await r.stop();
      restore();
      if (dur < 1 || blob.size < 1500) { toast('Задовго не говорили — запис закороткий'); return; }
      const ph = h('div.ch-wrap.me.ch-sending', h('div.msg.me.ch-msg', h('div.ch-voice', h('span.ch-play', ic('microphone', { size: 18 })), h('span.ch-tr', 'Надсилаю й розпізнаю…'))));
      list.append(ph); toBottom();
      try {
        const res = await chat.sendVoice(roomId, blob, dur);
        ph.remove();
        if (res?.message) { if (res.fixes?.length) fb.set(res.message.id, res.fixes); append(res.message); }
      } catch (e) { ph.remove(); toast(aiErrorText(e) || chat.chatErrText(e), { kind: 'bad' }); }
    };
    stopBtn.addEventListener('click', finish);
    mine.auto.then(() => { if (rec === mine && !mine.cancelled) finish(); });
  }

  // ---------- старт, Realtime, прочитано ----------
  list.replaceChildren(h('div.ch-empty', h('div.tx-s', 'Завантаження…')));
  let rtOk = false;
  reload().then(() => { chat.markRead(roomId); loadChallenges(); }).catch((e) => {
    console.warn('chat', e);
    if (!alive) return;
    if (e?.code === 'not_member') { toast('Цей чат недоступний'); go('/friends/chats', { replace: true }); return; }
    list.replaceChildren(txRow({ icon: 'warning-circle', label: navigator.onLine ? 'Не вдалося відкрити чат' : 'Немає мережі', sub: 'Торкніться, щоб повторити', onclick: () => location.reload() }));
  });
  const unsub = chat.subscribe(roomId, (row, ev) => {
    if (!alive || !row?.id) return;
    if (ev === 'INSERT') {
      if (row.user_id !== me && !members.has(row.user_id) && row.kind !== 'system') loadMembers().then(renderHead).catch(() => {});
      if (row.kind === 'system') loadMembers().then(renderHead).catch(() => {});
      if (row.kind === 'challenge' || ['duel_score', 'homework', 'homework_done'].includes(row.meta?.event)) loadChallenges();
      append(row);
      if (!document.hidden) chat.markRead(roomId);
    } else if (ev === 'UPDATE' && byId.has(row.id)) { Object.assign(byId.get(row.id), row); update(byId.get(row.id)); }
  }, (st) => { rtOk = st === 'SUBSCRIBED'; });
  // запасний шлях без Realtime і «тримати прочитаним» (поки чат відкрито — push не приходить)
  const poll = async () => {
    if (document.hidden || !alive) return;
    chat.markRead(roomId);
    if (rtOk) return;
    try {
      const data = await chat.messages(roomId);
      for (const m of data) if (!byId.has(m.id)) append(m);
    } catch { /* офлайн */ }
  };
  const iv = setInterval(poll, 15000);
  const vis = () => { if (!document.hidden) { poll(); loadChallenges(); } };
  document.addEventListener('visibilitychange', vis);
  return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', vis); unsub(); const r = rec; rec = null; r?.cancel(); chat.markRead(roomId); };
}
