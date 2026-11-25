// Друзі: код запрошення, додавання за кодом, стрік і хвилини друзів (спільний стрік); вкладка «Чати» — js/pages/chats.js.
// Друзі бачать лише ім'я для друзів, стрік і хвилини (сьогодні, цей тиждень) — RPC friends_stats() (міграція 0012).
import { h, ic, emo, toggle } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import { user, getSupa } from '../supa.js';
import { toast } from '../ui/toast.js';
import { sheet, confirmSheet } from '../ui/sheet.js';
import { streak, dayKey } from '../stats.js';
import { tx, txPrimary, txGroup, txRow, txRows, txLogin } from '../ui/tiles.js';
import { chatsList, chatRoom, openDmAndGo } from './chats.js';
import * as chat from '../chat.js';
import { friendInvite, groupInvite, friendLink, shareLink } from '../invite.js';
import { notifyPrompt } from '../ui/notifyprompt.js';
import { go } from '../router.js';
import { loc } from '../i18n.js';

const days = (n) => `${n} ${plural(n, 'день', 'дні', 'днів')}`;
const mins = (sec) => `${Math.round((sec || 0) / 60)}\u00a0хв`;
const fmtCode = (c) => c ? `${c.slice(0, 4)}-${c.slice(4)}` : '';
const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// стилі — css/p-misc.css (.friend-code, .friend-ava, .friend-streak)
const ST = { code: null, ava: null, streak: null };

const ADD_ERR = {
  not_found: 'Такого коду немає. Перевірте літери й цифри.',
  self: 'Це ваш власний код — введіть код друга.',
  rate_limited: 'Забагато спроб. Спробуйте за годину.',
  too_many_friends: 'Досягнуто межі — 100 друзів.',
};

/** Мій час: сьогодні й поточний тиждень (Пн–Нд) з локальних сесій */
function myStats() {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const today = dayKey(d);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const monday = dayKey(d);
  let t = 0, w = 0;
  for (const s of store.all('sessions')) {
    if (s.day === today) t += s.seconds || 0;
    if (s.day >= monday && s.day <= today) w += s.seconds || 0;
  }
  return { streak: streak(), today_seconds: t, week_seconds: w };
}

async function rpc(name, args) {
  const c = await getSupa();
  const { data, error } = await c.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

export default function friends(view, r) {
  // «Друзі» → «Чати» (#/friends/chats) і чат (#/friends/chat/<id>) — js/pages/chats.js
  if (r?.parts?.[0] === 'chats') return chatsList(view, r);
  if (r?.parts?.[0] === 'chat') return chatRoom(view, r.parts[1] || '', r);
  // запрошення посиланням (js/invite.js): у групу — #/friends/join/<код>, у друзі — #/friends?code=<код>
  if (r?.parts?.[0] === 'join') { groupInvite(view, cleanCode(r.parts[1])); return; }
  if (r?.query?.code && cleanCode(r.query.code).length === 8) { friendInvite(view, cleanCode(r.query.code), { onDone: () => go('/friends', { replace: true }) }); return; }
  return friendsPage(view, r);
}

function friendsPage(view, r) {
  let alive = true;
  const u = user();
  if (!u) {
    view.replaceChildren(h('div.stack-lg',
      txLogin('Друзі й спільний стрік — після входу', 'Вхід і реєстрація — на одній сторінці'),
      tx({ icon: 'users', wide: true, cls: 'fr-head', label: 'Як це працює', sub: 'Надішліть другу посилання — він додасться одним дотиком' })));
    return;
  }

  const codeBox = h('div.friend-code', { 'aria-live': 'polite', style: ST.code }, '········');
  const nameInp = h('input.input', { type: 'text', maxlength: 40, 'aria-label': 'Ім\'я для друзів', placeholder: '' });
  const codeInp = h('input.input', {
    type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    maxlength: 12, placeholder: 'ABCD-EF23', 'aria-label': 'Код друга',
    value: r?.query?.code ? fmtCode(cleanCode(r.query.code)) : '',
    onkeydown: (e) => { if (e.key === 'Enter') add(); },
  });
  const addBtn = h('button.btn.soft', { type: 'button', onclick: () => add() }, ic('user-plus', { size: 18 }), 'Додати');
  const list = h('div.tx-rows.fr-list', h('div.tx-row', h('span.tx-s.fr-msg', 'Завантаження…')));
  let myCode = '';
  let allFriends = false;

  const shareUrl = () => friendLink(myCode);
  const shareText = () => `Вчимо англійську разом у myEnglish! Додай мене в друзі — одним дотиком:`;

  async function copy() {
    if (!myCode) return;
    try { await navigator.clipboard.writeText(fmtCode(myCode)); toast('Код скопійовано'); }
    catch { toast(`Ваш код: ${fmtCode(myCode)}`); }
  }
  async function share() {
    if (!myCode) { await loadMe(); if (!myCode) return toast('Немає зв\'язку — спробуйте ще раз', { kind: 'bad' }); }
    await shareLink(shareUrl(), shareText());
  }

  // ---------- Запити в друзі й пошук людей (міграція 0030) ----------
  // Вхідні запити — «Прийняти / Відхилити»; пошук за іменем (лише ті, хто дозволив пошук, або знайомі: спільна група, спільні друзі).
  const reqBox = h('div', { hidden: true });
  const ginvBox = h('div', { hidden: true });   // запрошення в групи (міграція 0035)
  const outBox = h('div', { hidden: true });
  const peopleList = h('div.tx-rows.fr-people');
  const searchInp = h('input.input.fr-search', { type: 'search', placeholder: 'Ім\'я людини', 'aria-label': 'Знайти людей за іменем', autocomplete: 'off', enterkeyhint: 'search' });
  let searchT = 0, searchSeq = 0;
  const REQ_TEXT = { sent: 'Запит надіслано', accepted: 'Тепер ви друзі', friend: 'Ви вже друзі', declined: 'Людина відхилила запит — спробуйте пізніше', too_many: 'Забагато надісланих запитів', rate_limited: ADD_ERR.rate_limited, not_found: 'Людину не знайдено', self: 'Це ви' };
  const ava = (name) => h('div.friend-ava', { 'aria-hidden': 'true' }, (name || '?').trim().charAt(0).toUpperCase());

  async function sendReq(p, btn) {
    btn.disabled = true;
    try {
      const st = await rpc('friend_request_send', { p_user: p.user_id });
      toast(st === 'accepted' ? `${p.name} тепер у ваших друзях` : REQ_TEXT[st] || 'Не вдалося', { kind: ['sent', 'accepted', 'friend'].includes(st) ? '' : 'bad' });
      refreshAll();
    } catch { toast(navigator.onLine ? 'Не вдалося надіслати запит' : 'Немає мережі', { kind: 'bad' }); btn.disabled = false; }
  }
  async function respond(p, accept, row) {
    row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const st = await rpc('friend_request_respond', { p_from: p.user_id, p_accept: accept });
      toast(st === 'accepted' ? `${p.name} тепер у ваших друзях` : st === 'declined' ? 'Запит відхилено' : 'Запит уже неактуальний');
      refreshAll();
    } catch { toast('Не вдалося', { kind: 'bad' }); row.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  }
  function personRow(p) {
    const sub = p.hint || (p.streak > 0 ? `Серія ${days(p.streak)}` : 'Вчить англійську в myEnglish');
    let end;
    if (p.status === 'friend') end = h('button.icon-btn', { type: 'button', 'aria-label': `Написати ${p.name}`, onclick: () => openDmAndGo(p.user_id) }, ic('chat-circle-dots', { size: 18 }));
    else if (p.status === 'sent') {
      end = h('button.btn.sm.ghost.fr-add', { type: 'button', onclick: async () => {
        if (!await confirmSheet('Скасувати запит?', `${p.name} більше не бачитиме вашого запиту.`, 'Скасувати запит')) return;
        try { await rpc('friend_request_cancel', { p_to: p.user_id }); toast('Запит скасовано'); refreshAll(); } catch { toast('Не вдалося', { kind: 'bad' }); }
      } }, ic('check', { size: 16 }), 'Надіслано');
    } else if (p.status === 'incoming') {
      end = h('button.btn.sm.primary.fr-add', { type: 'button' }, 'Прийняти');
      end.addEventListener('click', (e) => respond(p, true, e.currentTarget.closest('.tx-row')));
    } else {
      end = h('button.btn.sm.soft.fr-add', { type: 'button' }, ic('user-plus', { size: 16 }), 'Додати');
      end.addEventListener('click', () => sendReq(p, end));
    }
    return h('div.tx-row.friend-row', ava(p.name), h('span.tx-body', h('span.tx-l', p.name), h('span.tx-s', sub)), end);
  }
  async function loadPeople() {
    const q = searchInp.value.trim();
    const my = ++searchSeq;
    try {
      const rows = await rpc('people_search', { p_q: q });
      if (!alive || my !== searchSeq) return;
      const list = (rows || []).filter(p => p.status !== 'friend' || q);
      peopleList.replaceChildren(...(list.length ? list.map(personRow)
        : [txRow({ icon: 'magnifying-glass', label: q ? 'Нікого не знайдено' : 'Поки нікого', sub: q ? 'Перевірте ім\'я або надішліть посилання-запрошення' : 'Запросіть друзів посиланням — вони з\'являться тут', chevron: false })]));
    } catch { if (alive) peopleList.replaceChildren(txRow({ icon: 'warning-circle', label: navigator.onLine ? 'Не вдалося завантажити' : 'Немає мережі', chevron: false })); }
  }
  searchInp.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(loadPeople, 300); });
  let discoverable = true;
  const discToggle = h('div.row.fr-disc', h('span.grow', h('div.small', 'Мене можна знайти в пошуку'), h('div.xs.dim', 'Видно лише ім\'я й серію днів')),
    toggle(true, async (v) => {
      try { discoverable = await rpc('friend_set_discoverable', { p_on: v }); toast(v ? 'Вас можна знайти в пошуку' : 'Вас більше не видно в пошуку'); }
      catch { toast('Не вдалося зберегти', { kind: 'bad' }); }
    }, 'Мене можна знайти в пошуку'));
  async function loadRequests() {
    try {
      const r = await rpc('friend_requests_list', {});
      if (!alive) return;
      discoverable = r?.discoverable !== false;
      const inp = discToggle.querySelector('input'); if (inp) inp.checked = discoverable;
      const inc = r?.incoming || [];
      const out = r?.outgoing || [];
      // надіслані — одним згорнутим рядком (людей без імені пошук не показує, а тут видно всіх, кому я надіслав)
      outBox.hidden = !out.length;
      outBox.replaceChildren(out.length ? txRow({ icon: 'paper-plane-right', label: `Надіслані запити · ${out.length}`, sub: 'Чекають, поки людина прийме', onclick: () => {
        let s = null;
        s = sheet('Надіслані запити', h('div.stack', txRows(out.map(p => {
          const nm = p.name === 'Учень' ? 'Учень (без імені)' : p.name;
          return h('div.tx-row.friend-row', ava(p.name), h('span.tx-body', h('span.tx-l', nm), h('span.tx-s', `Надіслано ${new Date(p.at).toLocaleDateString(loc(), { day: 'numeric', month: 'long' })}`)),
            h('button.btn.sm.ghost', { type: 'button', onclick: async () => {
              try { await rpc('friend_request_cancel', { p_to: p.user_id }); toast('Запит скасовано'); s.close(); refreshAll(); } catch { toast('Не вдалося', { kind: 'bad' }); }
            } }, 'Скасувати'));
        }))));
      } }) : '');
      reqBox.hidden = !inc.length;
      reqBox.replaceChildren(inc.length ? txGroup(`Запити в друзі · ${inc.length}`, txRows(inc.map(p => {
        const row = h('div.tx-row.friend-row.on', ava(p.name),
          h('span.tx-body', h('span.tx-l', p.name), h('span.tx-s', p.hint || 'Хоче додати вас у друзі')),
          h('div.row.fr-req-acts',
            h('button.btn.sm.primary', { type: 'button', onclick: () => respond(p, true, row) }, 'Прийняти'),
            h('button.icon-btn', { type: 'button', 'aria-label': `Відхилити запит від ${p.name}`, onclick: () => respond(p, false, row) }, ic('x', { size: 18 }))));
        return row;
      }))) : '');
    } catch { /* офлайн */ }
  }
  async function loadGroupInvites() {
    try {
      const inv = await chat.groupInvites();
      if (!alive) return;
      ginvBox.hidden = !inv.length;
      ginvBox.replaceChildren(inv.length ? txGroup(`Запрошення в групи · ${inv.length}`, txRows(inv.map(g => {
        const act = async (accept, row) => {
          row.querySelectorAll('button').forEach(b => { b.disabled = true; });
          try {
            const room = await chat.respondGroupInvite(g.room_id, accept);
            if (accept && room) { toast(`Ви в групі «${g.title}»`); go(`/friends/chat/${room}`); return; }
            row.remove(); loadGroupInvites();
          } catch (e) { toast(chat.chatErrText(e), { kind: 'bad' }); row.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
        };
        const names = (g.names || []).slice(0, 3).join(', ');
        const row = h('div.tx-row.friend-row.on.fr-ginv', h('span.friend-ava.ch-ava', { 'aria-hidden': 'true' }, ic('users-three', { size: 18 })),
          h('span.tx-body', h('span.tx-l', g.title || 'Група'), h('span.tx-s', `${g.from} запрошує · ${g.members} ${plural(g.members, 'учасник', 'учасники', 'учасників')}${names ? `: ${names}` : ''}`)),
          h('div.row.fr-req-acts',
            h('button.btn.sm.primary', { type: 'button', onclick: () => act(true, row) }, 'Приєднатися'),
            h('button.icon-btn', { type: 'button', 'aria-label': `Відхилити запрошення в «${g.title}»`, onclick: () => act(false, row) }, ic('x', { size: 18 }))));
        return row;
      }))) : '');
    } catch { /* офлайн */ }
  }
  function refreshAll() { loadRequests(); loadGroupInvites(); loadPeople(); loadList(); }

  async function loadMe() {
    let tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* без часового поясу */ }
    try {
      const rows = await rpc('my_friend_code', { p_tz: tz });
      const me = Array.isArray(rows) ? rows[0] : rows;
      if (!alive || !me) return;
      myCode = me.code;
      codeBox.textContent = fmtCode(me.code); codeBox.classList.remove('off');
      nameInp.value = me.display_name || '';
      nameInp.placeholder = me.default_name || 'Ваше ім\'я';
    } catch (e) {
      console.warn('friends', e);
      if (alive) { codeBox.textContent = 'Код недоступний — немає зв\'язку'; codeBox.classList.add('off'); }
    }
  }

  async function saveName() {
    try {
      const name = await rpc('set_friend_name', { p_name: nameInp.value });
      if (!nameInp.value.trim()) nameInp.placeholder = name;
      toast(`Друзі бачать вас як «${name}»`);
    } catch { toast('Не вдалося зберегти ім\'я', { kind: 'bad' }); }
  }
  nameInp.addEventListener('change', saveName);

  async function add() {
    const code = cleanCode(codeInp.value);
    if (code.length !== 8) { toast('Код має 8 символів, наприклад ABCD-EF23'); codeInp.focus(); return; }
    if (code === myCode) { toast(ADD_ERR.self); return; }
    addBtn.disabled = true;
    try {
      const rows = await rpc('add_friend', { p_code: code });
      const res = Array.isArray(rows) ? rows[0] : rows;
      if (res?.status === 'ok') {
        toast(`${res.name} тепер у ваших друзях`);
        codeInp.value = '';
        await loadList();
      } else toast(ADD_ERR[res?.status] || 'Не вдалося додати друга', { kind: 'bad' });
    } catch (e) {
      console.warn('add_friend', e);
      toast(navigator.onLine ? 'Не вдалося додати друга. Спробуйте ще раз.' : 'Немає мережі', { kind: 'bad' });
    }
    addBtn.disabled = false;
  }

  async function remove(f) {
    if (!await confirmSheet('Видалити з друзів?', `${f.name} більше не бачитиме ваш стрік і хвилини, а ви — його; переписка 1:1 зупиниться. Додати знову можна за кодом.`, 'Видалити', { danger: true })) return;
    try { await rpc('remove_friend', { p_friend: f.friend_id }); toast('Видалено з друзів'); await loadList(); }
    catch { toast('Не вдалося видалити', { kind: 'bad' }); }
  }

  // дотик по рядку — дії з другом (написати, видалити); праворуч — стрік і «Написати»
  function friendMenu(f) {
    let s = null;
    s = sheet(f.name, h('div.stack', txRows([
      txRow({ icon: 'chat-circle-dots', label: 'Написати', sub: 'Переписка англійською — вчитель тихо підкаже', onclick: () => { s.close(); openDmAndGo(f.friend_id); } }),
      txRow({ icon: 'trash', label: 'Видалити з друзів', cls: 'ch-danger', onclick: () => { s.close(); remove(f); } }),
    ])));
  }
  function friendRow(f, mine) {
    const shared = Math.min(f.streak || 0, mine.streak || 0);
    const row = h('div.tx-row.friend-row.fr-tap', { role: 'button', tabindex: 0, 'aria-label': `${f.name}: дії` },
      h('div.friend-ava', { 'aria-hidden': 'true', style: ST.ava }, (f.name || '?').trim().charAt(0).toUpperCase()),
      h('span.tx-body',
        h('span.tx-l', f.name),
        h('span.tx-s', `Сьогодні ${mins(f.today_seconds)} · тиждень ${mins(f.week_seconds)}`),
        shared > 0 ? h('span.tx-s', `Разом без перерви: ${days(shared)}`) : null),
      h('div.friend-streak', { style: ST.streak, title: `Стрік: ${days(f.streak || 0)}`, 'aria-label': `Стрік: ${days(f.streak || 0)}` }, emo('fire'), h('span.num', String(f.streak || 0))),
      h('button.icon-btn', { type: 'button', 'aria-label': `Написати ${f.name}`, onclick: (e) => { e.stopPropagation(); openDmAndGo(f.friend_id); } }, ic('chat-circle-dots', { size: 18 })));
    row.addEventListener('click', () => friendMenu(f));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) friendMenu(f); });
    return row;
  }

  async function loadList() {
    try {
      const rows = await rpc('friends_stats', {});
      if (!alive) return;
      const mine = myStats();
      const meRow = h('div.tx-row.on.friend-row.me',
        h('div.friend-ava', { 'aria-hidden': 'true', style: ST.ava }, ic('user', { size: 18 })),
        h('span.tx-body', h('span.tx-l', 'Ви'), h('span.tx-s', `Сьогодні ${mins(mine.today_seconds)} · тиждень ${mins(mine.week_seconds)}`)),
        h('div.friend-streak', { style: ST.streak, 'aria-label': `Ваш стрік: ${days(mine.streak)}` }, emo('fire'), h('span.num', String(mine.streak))),
        h('span', { 'aria-hidden': 'true', style: { width: '40px', flex: '0 0 40px' } }));
      if (!rows?.length) {
        list.replaceChildren(meRow, h('div.tx-row', h('span.tx-s.fr-msg', 'Поки що друзів немає')));
        return;
      }
      // до 6 друзів, решта — «Показати всі» (найактивніші першими — порядок з сервера)
      const shown = allFriends ? rows : rows.slice(0, 6);
      list.replaceChildren(meRow, ...shown.map(f => friendRow(f, mine)),
        shown.length < rows.length ? txRow({ icon: 'caret-down', label: `Показати всі · ${rows.length}`, chevron: false, cls: 'tx-showall', onclick: () => { allFriends = true; loadList(); } }) : '');
    } catch (e) {
      console.warn('friends_stats', e);
      if (alive) list.replaceChildren(txRow({ icon: 'warning-circle', label: navigator.onLine ? 'Не вдалося завантажити друзів' : 'Немає мережі',
        sub: navigator.onLine ? 'Спробуйте пізніше' : 'Список друзів недоступний офлайн', pill: { text: navigator.onLine ? 'Помилка' : 'Офлайн', tone: 'warn' }, attrs: { role: 'alert' } }));
    }
  }

  // головне — запросити (код + «Поділитися»); далі друзі й додавання за кодом; ім'я для друзів — згорнуте
  const codeBox2 = h('section.card.stack.pp-panel.fr-name', { id: 'fr-code', hidden: true, style: { gap: '10px' } },
    h('div.tx.wide.fr-code', h('span.tx-sq', ic('user-plus', { size: 20 })),
      h('span.tx-body', codeBox, h('span.tx-s', 'Ваш код — друг введе його у себе')),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Копіювати код', onclick: copy }, ic('copy', { size: 20 }))),
    h('div.row', { style: { gap: '8px' } }, h('div.grow', codeInp), addBtn));
  const codeRow = txRow({ icon: 'keyboard', label: 'Додати за кодом', sub: 'Якщо друг поруч — продиктуйте код', chevron: false, cls: 'fr-name-row',
    end: ic('caret-down', { size: 16 }), attrs: { 'aria-expanded': 'false', 'aria-controls': 'fr-code' },
    onclick: () => { codeBox2.hidden = !codeBox2.hidden; codeRow.setAttribute('aria-expanded', String(!codeBox2.hidden)); if (!codeBox2.hidden) codeInp.focus(); } });
  const nameBox = h('section.card.stack.pp-panel.fr-name', { id: 'fr-name', hidden: true, style: { gap: '8px' } },
    h('div.field', h('label', 'Ім\'я, яке бачать друзі'), nameInp,
      h('div.xs.dim', 'Порожнє — ім\'я з «Профілю» або «Учень». Друзі бачать лише ім\'я, стрік і хвилини. Без імені вас не знайдуть у пошуку.')),
    discToggle);
  const nameRow = txRow({ icon: 'user', label: 'Ім\'я й пошук', sub: 'Як вас бачать і чи можна вас знайти', chevron: false, cls: 'fr-name-row',
    end: ic('caret-down', { size: 16 }), attrs: { 'aria-expanded': 'false', 'aria-controls': 'fr-name' },
    onclick: () => { nameBox.hidden = !nameBox.hidden; nameRow.setAttribute('aria-expanded', String(!nameBox.hidden)); if (!nameBox.hidden) nameInp.focus(); } });

  // нові повідомлення — одним рядком над усім (чати — на вкладці «Чати»)
  const unreadBox = h('div', { hidden: true });
  chat.listChats().then(rows => {
    const n = (rows || []).reduce((a, c) => a + (c.muted ? 0 : c.unread || 0), 0);
    if (!alive || !n) return;
    unreadBox.hidden = false;
    unreadBox.replaceChildren(txRow({ icon: 'chat-circle-dots', label: 'Нові повідомлення', on: true, pill: { text: String(n), tone: 'accent' }, href: '#/friends/chats' }));
  }).catch(() => {});
  // заблоковані — у згорнутому рядку внизу
  const blockedBox = h('div', { hidden: true });
  const loadBlocks = () => chat.myBlocks().then(rows => {
    if (!alive) return;
    blockedBox.hidden = !rows?.length;
    if (!rows?.length) { blockedBox.replaceChildren(); return; }
    blockedBox.replaceChildren(txRow({ icon: 'x-circle', label: `Заблоковані · ${rows.length}`, sub: 'Не можуть писати вам і додати вас', chevron: true, onclick: () => {
      let s = null;
      s = sheet('Заблоковані', h('div.stack', txRows(rows.map(b => txRow({ label: b.name, sub: 'Розблокувати', chevron: false, end: ic('arrow-clockwise', { size: 18 }), onclick: async () => {
        try { await chat.unblock(b.user_id); s.close(); toast(`${b.name} розблоковано. Щоб знову дружити — обміняйтеся кодами.`); loadBlocks(); }
        catch { toast('Не вдалося розблокувати', { kind: 'bad' }); }
      } })))));
    } }));
  }).catch(() => {});
  loadBlocks();

  view.replaceChildren(h('div.stack-lg',
    unreadBox,
    notifyPrompt(),
    // головне — запросити посиланням: друг відкриє його й додасться одним дотиком (навіть якщо ще не зареєстрований)
    txPrimary({ icon: 'share-network', label: 'Запросити друзів', sub: 'Посилання в Telegram, Viber чи SMS — друг додасться одним дотиком', onclick: share }),
    ginvBox,
    reqBox,
    txGroup('Знайти людей', [searchInp, peopleList, outBox]),
    txGroup('Друзі', list),
    // код — для тих, хто поруч (продиктувати) — згорнуто
    h('div.stack', codeRow, codeBox2, nameRow, nameBox, blockedBox)));

  store.queueSync(0);   // свіжі хвилини — на сервер, щоб друзі бачили актуальне
  loadMe().then(loadList);
  loadRequests(); loadGroupInvites(); loadPeople();
  const iv = setInterval(() => { if (!document.hidden) loadList(); }, 60000);
  return () => { alive = false; clearInterval(iv); };
}
