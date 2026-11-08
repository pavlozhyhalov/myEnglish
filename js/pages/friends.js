// Друзі: код запрошення, додавання за кодом, стрік і хвилини друзів (спільний стрік).
// Друзі бачать лише ім'я для друзів, стрік і хвилини (сьогодні, цей тиждень) — RPC friends_stats() (міграція 0012).
import { h, ic, emo } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import { user, getSupa } from '../supa.js';
import { toast } from '../ui/toast.js';
import { confirmSheet } from '../ui/sheet.js';
import { streak, dayKey } from '../stats.js';
import { tx, txPrimary, txGroup, txRow, txLogin } from '../ui/tiles.js';

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
  let alive = true;
  const u = user();
  if (!u) {
    view.replaceChildren(h('div.stack-lg',
      txLogin('Друзі й спільний стрік — після входу', 'Вхід і реєстрація — на одній сторінці'),
      tx({ icon: 'users', wide: true, cls: 'fr-head', label: 'Як це працює', sub: 'Обміняйтеся кодами — і бачитимете стрік і хвилини одне одного' })));
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

  const shareUrl = () => `${location.origin}${location.pathname}#/friends?code=${myCode}`;
  const shareText = () => `Займаймося англійською разом у myEnglish! Мій код друга: ${fmtCode(myCode)}`;

  async function copy() {
    if (!myCode) return;
    try { await navigator.clipboard.writeText(fmtCode(myCode)); toast('Код скопійовано'); }
    catch { toast(`Ваш код: ${fmtCode(myCode)}`); }
  }
  async function share() {
    if (!myCode) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'myEnglish', text: shareText(), url: shareUrl() }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(`${shareText()}\n${shareUrl()}`); toast('Запрошення скопійовано'); }
    catch { toast(shareText()); }
  }

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
    if (!await confirmSheet('Видалити з друзів?', `${f.name} більше не бачитиме ваш стрік і хвилини, а ви — його. Додати знову можна за кодом.`, 'Видалити', { danger: true })) return;
    try { await rpc('remove_friend', { p_friend: f.friend_id }); toast('Видалено з друзів'); await loadList(); }
    catch { toast('Не вдалося видалити', { kind: 'bad' }); }
  }

  function friendRow(f, mine) {
    const shared = Math.min(f.streak || 0, mine.streak || 0);
    return h('div.tx-row.friend-row',
      h('div.friend-ava', { 'aria-hidden': 'true', style: ST.ava }, (f.name || '?').trim().charAt(0).toUpperCase()),
      h('span.tx-body',
        h('span.tx-l', f.name),
        h('span.tx-s', `Сьогодні ${mins(f.today_seconds)} · тиждень ${mins(f.week_seconds)}`),
        shared > 0 ? h('span.tx-s', `Разом без перерви: ${days(shared)}`) : null),
      h('div.friend-streak', { style: ST.streak, title: `Стрік: ${days(f.streak || 0)}`, 'aria-label': `Стрік: ${days(f.streak || 0)}` }, emo('fire'), h('span.num', String(f.streak || 0))),
      h('button.icon-btn', { type: 'button', 'aria-label': `Видалити ${f.name} з друзів`, onclick: () => remove(f) }, ic('trash', { size: 18 })));
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
  const nameBox = h('section.card.stack.pp-panel.fr-name', { id: 'fr-name', hidden: true, style: { gap: '8px' } },
    h('div.field', h('label', 'Ім\'я, яке бачать друзі'), nameInp,
      h('div.xs.dim', 'Порожнє — ім\'я з «Профілю» або «Учень». Друзі бачать лише ім\'я, стрік і хвилини.')));
  const nameRow = txRow({ icon: 'user', label: 'Ім\'я для друзів', sub: 'Пошту й навчання друзі не бачать', chevron: false, cls: 'fr-name-row',
    end: ic('caret-down', { size: 16 }), attrs: { 'aria-expanded': 'false', 'aria-controls': 'fr-name' },
    onclick: () => { nameBox.hidden = !nameBox.hidden; nameRow.setAttribute('aria-expanded', String(!nameBox.hidden)); if (!nameBox.hidden) nameInp.focus(); } });

  view.replaceChildren(h('div.stack-lg',
    txGroup('Мій код друга', [
      h('div.tx.wide.fr-code', h('span.tx-sq', ic('user-plus', { size: 20 })),
        h('span.tx-body', codeBox, h('span.tx-s', 'Друг введе його у себе')),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Копіювати код', onclick: copy }, ic('copy', { size: 20 }))),
      txPrimary({ icon: 'share-network', label: 'Запросити друга', sub: 'Посилання з вашим кодом', onclick: share })]),

    txGroup('Друзі', list),

    txGroup('Додати друга', h('div.row', { style: { gap: '8px' } }, h('div.grow', codeInp), addBtn)),

    h('div.stack', nameRow, nameBox)));

  store.queueSync(0);   // свіжі хвилини — на сервер, щоб друзі бачили актуальне
  loadMe().then(loadList);
  const iv = setInterval(() => { if (!document.hidden) loadList(); }, 60000);
  return () => { alive = false; clearInterval(iv); };
}
