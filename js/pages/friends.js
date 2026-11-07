// Друзі: код запрошення, додавання за кодом, стрік і хвилини друзів (спільний стрік).
// Друзі бачать лише ім'я для друзів, стрік і хвилини (сьогодні, цей тиждень) — RPC friends_stats() (міграція 0012).
import { h, ic, emo } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import { user, getSupa } from '../supa.js';
import { toast } from '../ui/toast.js';
import { confirmSheet } from '../ui/sheet.js';
import { streak, dayKey } from '../stats.js';
import { tx, txGrid, txGroup, txPrimary } from '../ui/tiles.js';

const days = (n) => `${n} ${plural(n, 'день', 'дні', 'днів')}`;
const mins = (sec) => `${Math.round((sec || 0) / 60)}\u00a0хв`;
const fmtCode = (c) => c ? `${c.slice(0, 4)}-${c.slice(4)}` : '';
const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// Стилі елементів сторінки (без окремого CSS-файлу)
const ST = {
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-ink)' },
  ava: { width: '34px', height: '34px', flex: '0 0 34px', borderRadius: '10px', display: 'grid', placeItems: 'center', background: 'var(--tile-sq)', color: 'var(--ink-dim)', fontWeight: 700 },
  streak: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 },
};

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
      tx({ icon: 'users', wide: true, cls: 'fr-head', label: 'Друзі й спільний стрік працюють після входу',
        sub: 'Ви отримаєте код запрошення, поділитеся ним — і бачитимете стрік та хвилини одне одного. Більше друзі нічого не бачать.' }),
      txPrimary({ icon: 'key', label: 'Увійти', sub: 'Або створити акаунт', href: '#/auth' })));
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
  const addBtn = h('button.btn.primary', { type: 'button', onclick: () => add() }, ic('user-plus', { size: 18 }), 'Додати');
  const list = h('div.tx-rows.fr-list', h('div.tx-row', h('span.tx-s.fr-msg', 'Завантаження…')));
  let myCode = '';

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
      codeBox.textContent = fmtCode(me.code);
      nameInp.value = me.display_name || '';
      nameInp.placeholder = me.default_name || 'Ваше ім\'я';
    } catch (e) {
      console.warn('friends', e);
      if (alive) codeBox.textContent = 'Немає зв\'язку';
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
        list.replaceChildren(meRow, h('div.tx-row', h('span.tx-s.fr-msg', 'Поки що друзів немає. Поділіться своїм кодом або введіть код друга.')));
        return;
      }
      list.replaceChildren(meRow, ...rows.map(f => friendRow(f, mine)));
    } catch (e) {
      console.warn('friends_stats', e);
      if (alive) list.replaceChildren(h('div.tx-row', h('span.tx-s.fr-msg', navigator.onLine ? 'Не вдалося завантажити друзів. Спробуйте пізніше.' : 'Немає мережі — список друзів недоступний.')));
    }
  }

  view.replaceChildren(h('div.stack-lg',
    txGroup('Мій код друга', [
      h('div.tx.wide.fr-code', h('span.tx-sq', ic('user-plus', { size: 20 })),
        h('span.tx-body', codeBox, h('span.tx-s', 'Поділіться кодом — друг введе його у себе'))),
      txGrid([
        tx({ icon: 'copy', label: 'Копіювати', sub: 'Код у буфер обміну', onclick: copy }),
        tx({ icon: 'share-network', label: 'Поділитися', sub: 'Запрошення з посиланням', onclick: share })], 2)]),

    txGroup('Ім\'я для друзів', h('section.card.stack.pp-panel', { style: { gap: '8px' } },
      h('div.field', h('label', 'Ім\'я, яке бачать друзі'), nameInp,
        h('div.xs.dim', 'Якщо порожнє — ім\'я з «Профілю», а без нього — «Учень». Вашу пошту друзі не бачать.')))),

    txGroup('Додати друга', h('div.row', { style: { gap: '8px' } }, h('div.grow', codeInp), addBtn)),

    txGroup('Друзі', list),

    h('p.xs.dim.pp-note', 'Друзі бачать лише ваше ім\'я для друзів, стрік і хвилини занять (сьогодні й цього тижня). Картки, помилки, розмови й профіль — лише ваші.')));

  store.queueSync(0);   // свіжі хвилини — на сервер, щоб друзі бачили актуальне
  loadMe().then(loadList);
  const iv = setInterval(() => { if (!document.hidden) loadList(); }, 60000);
  return () => { alive = false; clearInterval(iv); };
}
