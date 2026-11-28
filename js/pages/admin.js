// #/admin — службова сторінка адміністратора: користувачі, активність, використання AI, помилки клієнтів.
// Дані — edge-функція `admin` (лише агрегати). Хто адміністратор, вирішує сервер (ALLOWED_USERS): 403 → доступу немає.
import { h, ic } from '../ui/dom.js';
import { user } from '../supa.js';
import { ai, aiErrorText } from '../ai.js';
import { tx, txRow, txRows, txKpis, txGrid, txGroup, txPill, txBar } from '../ui/tiles.js';
import { S } from '../strings.js';
import { go } from '../router.js';
import { setTitle } from '../ui/shell.js';
import { lvLabel } from '../level.js';
import { loc } from '../i18n.js';

const CACHE = 'me:admin';
const RECHECK_MS = 12 * 3600e3;

// Ціни платного Gemini, $ за 1 млн токенів (попередні, з оглядів 2026-11; перевірити на ai.google.dev/pricing перед рішенням про ціну):
// [вхід текст, вхід аудіо, вихід текст (і «роздуми»), вихід аудіо]. Перше правило, що підходить за назвою моделі.
const PRICES = [
  [/tts/, [1.0, 1.0, 18, 18]],
  [/live|native-audio/, [0.75, 3.0, 4.5, 12]],
  [/flash-lite/, [0.30, 0.60, 2.5, 2.5]],
  [/./, [1.5, 3.0, 7.5, 7.5]],
];
function tokenCost(model, r) {
  const p = PRICES.find(([re]) => re.test(model))[1];
  return (r.in_text * p[0] + r.in_audio * p[1] + (r.out_text + r.thoughts) * p[2] + r.out_audio * p[3]) / 1e6;
}

function cached() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    return c && c.uid === user()?.id ? c : null;
  } catch { return null; }
}
function remember(ok) { try { localStorage.setItem(CACHE, JSON.stringify({ uid: user()?.id, ok, t: Date.now() })); } catch { /* немає сховища */ } }

/** Чи є користувач адміністратором (кеш на 12 год; перевірка — запит до функції) */
export async function checkAdmin({ force = false } = {}) {
  if (!user()) return false;
  const c = cached();
  if (c && !force && Date.now() - c.t < RECHECK_MS) return c.ok;
  try {
    await ai('admin', 'ping');
    remember(true); return true;
  } catch (e) {
    if (e.code === 'not_admin' || e.code === 'not_allowed') { remember(false); return false; }
    return c?.ok || false;   // офлайн чи збій — лишаємо попереднє знання
  }
}

/** Посилання «Адмін» — лише для адміністратора (вставляється в слот на сторінці налаштувань) */
export function adminLink(slot) {
  const show = (ok) => slot.replaceChildren(...(ok ? [txRow({ icon: 'key', label: 'Адміністрування', sub: 'Користувачі, AI, помилки', href: '#/admin' })] : []));
  show(!!cached()?.ok);
  checkAdmin().then(show).catch(() => {});
}

const mask = (email) => {
  if (!email) return '—';
  const [n, d = ''] = String(email).split('@');
  return `${n.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, n.length - 2)))}@${d}`;
};
const dShort = (d) => d ? new Date(d).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }) : '—';
const dtShort = (d) => d ? new Date(d).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const mins = (sec) => `${Math.round((sec || 0) / 60)} хв`;
/** 75 хв → «1 год 15 хв» */
const dur = (sec) => {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} хв`;
  return `${Math.floor(m / 60)} год${m % 60 ? ` ${m % 60} хв` : ''}`;
};
const typeName = (t) => S.sessionTypes?.[t] || t;

/** Секунди сьогодні: останній день у days7 (сервер віддає 7 днів по зростанню, останній — сьогодні) */
const todaySec = (u) => (Array.isArray(u.days7) && u.days7.length ? Number(u.days7[u.days7.length - 1]) || 0 : 0);
/** Остання активність: «сьогодні», «вчора», «N дн. тому», дата */
function ago(day, today) {
  if (!day) return 'ще без занять';
  const n = Math.round((Date.parse(today) - Date.parse(day)) / 864e5);
  if (n <= 0) return 'сьогодні';
  if (n === 1) return 'вчора';
  if (n < 7) return `${n} дн. тому`;
  return dShort(day);
}

/** Крихітна діаграма 7 днів (хвилини по днях, останній — сьогодні) */
function spark(days) {
  const v = (days || []).map(x => Number(x) || 0);
  const max = Math.max(60, ...v);
  return h('span', {
    role: 'img', 'aria-label': `Хвилини за 7 днів: ${v.map(x => Math.round(x / 60)).join(', ')}`,
    style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '26px', flex: 'none' },
  }, v.map((x, i) => h('i', {
    style: {
      display: 'block', width: '5px', borderRadius: '2px',
      height: `${x ? Math.max(4, Math.round(x / max * 26)) : 2}px`,
      background: x ? 'var(--accent-ink)' : 'var(--track)',
      opacity: x ? (i === v.length - 1 ? '1' : '.7') : '1',
    },
  })));
}

/** Рядок «назва — значення» для розгорнутих деталей */
const fact = (k, v) => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderTop: '1px solid var(--line)' } },
  h('span.xs.dim', k), h('span.small', { style: { textAlign: 'right', overflowWrap: 'anywhere' } }, v));

const openUsers = new Set();   // розгорнуті рядки переживають перемальовування сторінки

/** Розділ «Користувачі»: зведення + рядок на кожного (дотик — подробиці). Вміст розмов не показується. */
// демо-акаунти для перевірки Apple (appreview.demo / appreview.oliver, 2026-11-26) — не справжні учні: ні в списку, ні в цифрах
const DEMO = new Set(['19da8a4e-952f-4c6c-892e-54e4ae011c89', 'e17898d3-8d63-46aa-8baa-99a84cfd0651']);
const isDemo = (u) => DEMO.has(u?.id) || /^appreview\./i.test(String(u?.name || ''));
function usersSection(ud, limits = {}, budget = {}) {
  const demo = (ud.users || []).filter(isDemo);
  const sm0 = ud.summary || {};
  const sm = demo.length ? { ...sm0, total: Math.max(0, (sm0.total || 0) - demo.length),
    new7: Math.max(0, (sm0.new7 || 0) - demo.filter(u => Date.now() - Date.parse(u.created_at || 0) < 7 * 864e5).length) } : sm0;
  const a = sm.ai_today || {}, today = ud.today;
  const strongCap = budget.strongCalls || (limits.strongCalls || 8) * 10;
  const strongTone = a.strong >= strongCap ? 'bad' : a.strong >= strongCap * 0.75 ? 'warn' : undefined;
  const open = openUsers;

  const summary = txGroup('Зараз', [
    txKpis([
      { value: sm.active_today ?? 0, label: 'активні сьогодні' },
      { value: sm.active7 ?? 0, label: `активні за 7 днів · з ${sm.total ?? 0}` },
      { value: sm.new7 ?? 0, label: 'нових за тиждень' }]),
    txKpis([
      { value: dur(sm.sec7), label: 'занять за 7 днів' },
      { value: `${a.strong ?? 0}/${strongCap}`, label: 'сильні моделі сьогодні', tone: strongTone }], 2),
    h('section.card.stack.adm-card',
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
        h('span.small', 'Gemini сьогодні, усі разом'), h('span.xs.dim', `з AI: ${a.users ?? 0} ${a.users === 1 ? 'особа' : 'осіб'}`)),
      txBar(Math.min(1, (a.strong || 0) / strongCap), true),
      h('div.xs.dim', `сильні ${a.strong ?? 0} з ≈${strongCap} · текст ${a.text ?? 0} · голос ${mins(a.voice_sec)} · озвучення ${a.tts ?? 0} · Live ${a.live ?? 0}`)),
  ]);

  const details = (u) => {
    const ai = u.ai_today || {};
    const types = (u.by_type || []).filter(t => t.sec >= 60);
    const maxT = Math.max(1, ...types.map(t => t.sec));
    const onb = u.onboarded == null ? '—' : (u.onboarded ? 'так' : 'ні');
    return h('div', { style: { padding: '4px 14px 12px' } },
      txKpis([
        { value: `${u.cards_learned ?? 0}`, unit: `/${u.cards_total ?? 0}`, label: 'слів вивчено' },
        { value: u.lessons_done ?? 0, label: 'уроків пройдено' },
        { value: `${u.mistakes_open ?? 0}`, unit: ` · ${u.mistakes_closed ?? 0}`, label: 'помилок відкр. · закр.' }]),
      h('div', { style: { marginTop: '10px' } },
        fact('Реєстрація', dShort(u.created_at)),
        fact('Тест рівня', u.placement?.level ? `${lvLabel(u.placement.level)} · ${dShort(u.placement.at)}` : 'не проходив'),
        fact('Голосових розмов', `${u.voice7 ?? 0} за 7 дн. · ${u.voice_total ?? 0} усього`),
        fact('Нагадування', u.push ? 'увімкнені' : 'вимкнені'),
        fact('Знайомство пройдено', onb),
        fact('AI сьогодні', `текст ${ai.text ?? 0}/${limits.textCalls ?? '—'} · сильні ${ai.strong ?? 0}/${limits.strongCalls ?? '—'} · голос ${mins(ai.voice_sec)}/${Math.round((limits.voiceSeconds || 0) / 60) || '—'} хв`)),
      types.length ? h('div', { style: { marginTop: '10px' } },
        h('div.xs.dim', { style: { marginBottom: '6px' } }, 'Час за видами · 7 днів / усього'),
        ...types.map(t => h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2px 10px', alignItems: 'center', marginBottom: '6px' } },
          h('span.small', typeName(t.type)), h('span.xs.dim', `${dur(t.sec7)} / ${dur(t.sec)}`),
          h('span', { style: { gridColumn: '1 / -1' } }, txBar(t.sec / maxT))))) : null);
  };

  const row = (u) => {
    // за 7 днів — лише види від хвилини (не «Тест 0 хв»); без занять за тиждень — підсумок «усього», а не загальний час під виглядом тижневого
    const week = (u.by_type || []).filter(t => (t.sec7 || 0) >= 60).sort((x, y) => y.sec7 - x.sec7);
    const top = (week.length ? ['тиждень: ' + week.slice(0, 3).map(t => `${typeName(t.type)} ${dur(t.sec7)}`).join(' · ')]
      : (u.by_type || []).filter(t => t.sec >= 60).sort((x, y) => y.sec - x.sec).slice(0, 3).map(t => `${typeName(t.type)} ${dur(t.sec)} усього`)).join(' · ');
    const lvl = u.level || u.placement?.level;
    const wrapEl = h('div', { style: { borderRadius: 'var(--r-row)', background: 'var(--tile)', boxShadow: 'var(--tile-shadow)' } });
    const draw = () => {
      const on = open.has(u.id);
      const btn = h('button.tx-row', {
        type: 'button', 'aria-expanded': String(on),
        style: { width: '100%', textAlign: 'left', boxShadow: on ? 'none' : null },
        onclick: () => { on ? open.delete(u.id) : open.add(u.id); draw(); },
      },
        h('span.tx-body',
          h('span.tx-l', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, u.name || 'Учень'),
            lvl ? txPill(lvLabel(lvl), 'accent') : null,
            u.push ? ic('bell', { size: 14 }) : null),
          h('span.tx-s', u.sec_total || u.last_active
            // 2026-11-16 (власник: «як у мене сьогодні може бути 4 год?») — «сьогодні · 4 год за 7 дн.» читалось як 4 год сьогодні: кожна цифра з підписом
            ? `${todaySec(u) >= 60 ? `сьогодні ${dur(todaySec(u))}` : (ago(u.last_active, today) === 'сьогодні' ? 'сьогодні < 1 хв' : `був ${ago(u.last_active, today)}`)} · тиждень ${dur(u.sec7)} · усього ${dur(u.sec_total)}${u.voice7 ? ` · голос ×${u.voice7}` : ''}`
            : `ще без занять · реєстрація ${dShort(u.created_at)}`),
          top ? h('span.tx-s', top) : null),
        spark(u.days7),
        ic(on ? 'caret-down' : 'caret-right', { size: 16 }));
      wrapEl.replaceChildren(btn, on ? details(u) : '');
    };
    draw();
    return wrapEl;
  };

  const list = (ud.users || []).filter(u => !isDemo(u));
  return [summary, txGroup(`Користувачі · ${list.length}`, list.length
    ? h('div.tx-rows', list.map(row))
    : h('p.xs.dim.adm-note', 'Ще немає зареєстрованих користувачів.'))];
}

export default async function adminPage(view) {
  let showEmails = false, days = 7, data = null, udata = null;
  // Для всіх, крім адміністратора, сторінки «не існує» (власник 2026-11-14): без входу чи без прав — тихо на головну,
  // жодного заголовка чи згадки про адміністрування; заголовок з'являється лише після підтвердження сервером.
  const away = () => go('/home', { replace: true });
  if (!user() || cached()?.ok === false) return away();
  const body = h('div.stack-lg');
  const head = tx({ icon: 'key', wide: true, cls: 'adm-head', label: 'Адміністрування', sub: 'Лише агреговані показники' });
  head.hidden = true;
  view.replaceChildren(h('div.stack-lg', head, body));

  const load = async () => {
    body.replaceChildren(head.hidden ? '' : txRows([txRow({ icon: 'hourglass', label: 'Завантаження…', chevron: false })]));
    try {
      const [st, us] = await Promise.all([
        ai('admin', 'stats', { days: 14 }),
        ai('admin', 'users').catch(() => null),   // стара версія функції без дії `users` — показуємо решту
        ai('admin', 'feedback').catch(() => null),
      ]).then(([a, b, c]) => { fdata = c; return [a, b]; });
      data = st; udata = us;
      remember(true);
      head.hidden = false; setTitle('Адміністрування');
      render();
    } catch (e) {
      if (e.code === 'not_admin' || e.code === 'not_allowed') {
        remember(false);
        away();
      } else {
        // збій мережі: адміністраторові (уже підтвердженому раніше) — «Повторити», решті — нічого не показуємо
        if (!cached()?.ok) return away();
        head.hidden = false;
        body.replaceChildren(txRows([txRow({ icon: 'warning', label: 'Не вдалося завантажити', sub: aiErrorText(e) || 'Торкніться, щоб повторити', onclick: load })]));
      }
    }
  };

  const stat = (v, label) => ({ value: v ?? 0, label });
  const email = (e) => showEmails ? (e || '—') : mask(e);
  const bars = (series, label) => {
    const max = Math.max(1, ...series.map(x => x.n));
    return [
      h('div.bars', { style: { height: '72px' }, role: 'img', 'aria-label': `${label}: ${series.map(x => x.n).join(', ')}` },
        series.map(x => h('i' + (x.n ? '' : '.zero'), { style: { height: `${Math.max(2, x.n / max * 100)}%` }, title: `${dShort(x.day)}: ${x.n}` }))),
      h('div.bars-labels', h('span', dShort(series[0]?.day)), h('span', 'сьогодні')),
    ];
  };
  const wrap = { overflowWrap: 'anywhere', minWidth: 0 };

  // ---------- Звернення користувачів (#/feedback, міграція 0036) ----------
  let fdata = null, fbAll = false;
  const KIND = { bug: 'Помилка', idea: 'Ідея', other: 'Інше', report: 'Скарга' };
  // скарга на повідомлення (міграція 0039): route = 'report:msg:<uuid>' → «Сховати повідомлення» (admin_hide_message)
  const reportMsg = (f) => f.kind === 'report' && /^report:msg:([0-9a-f-]{36})$/.exec(f.route || '')?.[1];
  const hideMsg = async (f, id) => {
    try { const { getSupa } = await import('../supa.js'); const c = await getSupa(); const { error } = await c.rpc('admin_hide_message', { p_id: id }); if (error) throw error;
      f.hidden = true; await fbSet(f, { status: 'done' }); }
    catch (e) { alert('Не вдалося сховати: ' + (e?.message || e)); }
  };
  const fbSet = async (f, patch) => {
    try { await ai('admin', 'feedback_update', { id: f.id, ...patch }); Object.assign(f, patch, patch.reply ? { status: 'done', replied_at: new Date().toISOString() } : {}); render(); }
    catch (e) { alert(aiErrorText(e) || 'Не вдалося'); }
  };
  function replySheet(f) {
    import('../ui/sheet.js').then(({ sheet }) => {
      const inp = h('textarea.input', { rows: 5, maxlength: 2000, placeholder: 'Відповідь — прийде людині push-ем і в дзвіночок', 'aria-label': 'Відповідь' });
      inp.value = f.reply || '';
      let s = null;
      s = sheet(`Відповісти: ${f.name}`, h('div.stack', h('p.small', { style: wrap }, f.body), inp,
        h('button.btn.primary', { type: 'button', onclick: async () => { const t = inp.value.trim(); if (!t) return inp.focus(); s.close(); await fbSet(f, { reply: t }); } }, 'Надіслати відповідь')));
      setTimeout(() => inp.focus(), 300);
    });
  }
  function feedbackSection(list) {
    const fresh = list.filter(f => f.status === 'new');
    // відкрили сторінку — нові стали «переглянуто» (цифра в дзвіночку зникає)
    for (const f of fresh) ai('admin', 'feedback_update', { id: f.id, status: 'seen' }).then(() => { f.status = 'seen'; }).catch(() => {});
    const shown = fbAll ? list : list.slice(0, 6);
    const row = (f) => h('div.tx-row.adm-fb' + (fresh.includes(f) ? '.on' : ''),
      h('span.tx-body', { style: wrap },
        h('span.tx-l', `${f.name} · ${KIND[f.kind] || ''}`),
        h('span.tx-s', `${dtShort(f.created_at)}${f.route ? ` · ${f.route}` : ''} · ${f.build || ''}`),
        h('span.small', { style: { whiteSpace: 'pre-wrap', ...wrap } }, f.body),
        f.image ? h('a', { href: f.image, target: '_blank', rel: 'noopener' }, h('img.adm-fb-img', { src: f.image, alt: 'Скріншот', loading: 'lazy' })) : null,
        f.reply ? h('span.tx-s', { style: wrap }, `Ваша відповідь: ${f.reply}`) : null,
        h('span.row', { style: { gap: '6px', flexWrap: 'wrap' } },
          h('button.btn.sm.primary', { type: 'button', onclick: () => replySheet(f) }, f.reply ? 'Змінити відповідь' : 'Відповісти'),
          reportMsg(f) && !f.hidden ? h('button.btn.sm.danger', { type: 'button', onclick: () => hideMsg(f, reportMsg(f)) }, 'Сховати повідомлення') : null,
          f.status !== 'done' ? h('button.btn.sm.soft', { type: 'button', onclick: () => fbSet(f, { status: 'done' }) }, 'Зроблено') : null)),
      txPill(f.status === 'done' ? 'Зроблено' : f.status === 'seen' ? 'Переглянуто' : 'Нове', f.status === 'done' ? 'good' : f.status === 'new' ? 'accent' : ''));
    return txGroup(`Звернення${fresh.length ? ` · ${fresh.length} нових` : ` · ${list.length}`}`, list.length
      ? h('div.tx-rows', ...shown.map(row), shown.length < list.length ? txRow({ icon: 'caret-down', label: `Показати всі · ${list.length}`, chevron: false, cls: 'tx-showall', onclick: () => { fbAll = true; render(); } }) : '')
      : txRows([txRow({ icon: 'envelope-simple', label: 'Звернень поки немає', sub: 'Користувачі пишуть з меню «Я» → конверт', chevron: false })]));
  }

  // собівартість AI (міграція 0041): фактичні токени × ціни платного Gemini (docs/gemini-cost.md); рахується за кнопкою
  let cost = null, costErr = '';
  async function loadCosts() {
    costErr = '';
    try { cost = await ai('admin', 'costs'); } catch (e) { costErr = aiErrorText(e); }
    render();
  }
  function costSection() {
    const usd = (x) => `$${x < 10 ? x.toFixed(2) : Math.round(x)}`;
    if (!cost) return txGroup('Собівартість AI', [costErr ? h('div.xs.adm-note', costErr) : null,
      txGrid([tx({ icon: 'chart-line-up', label: 'Порахувати за 30 днів', onclick: loadCosts })], 1)]);
    const byModel = {};
    let total = 0;
    for (const r of cost.rows) {
      const c = tokenCost(r.model, r);
      total += c;
      const k = `${r.kind} · ${r.model}`;
      byModel[k] ||= { calls: 0, usd: 0 };
      byModel[k].calls += r.calls; byModel[k].usd += c;
    }
    const days = new Set(cost.rows.map(r => r.day)).size || 1;
    const rows = Object.entries(byModel).sort((a, b) => b[1].usd - a[1].usd)
      .map(([k, v]) => txRow({ label: k, sub: `${v.calls} викл.`, end: h('b.small', usd(v.usd)) }));
    return txGroup(`Собівартість AI · ${days} дн. обліку`, [
      txKpis([stat(usd(total), 'усього за платним тарифом'), stat(usd(total / days * 30), '≈ за місяць'),
        stat(cost.people ? usd(total / days * 30 / cost.people) : '—', 'на учня за місяць')]),
      rows.length ? txRows(rows) : h('div.xs.dim.adm-note', 'Облік токенів почався 28.11 — дані з\'являться після перших занять.'),
      h('p.xs.dim.adm-note', `Ціни — попередні (docs/gemini-cost.md). Учнів з AI за 30 днів: ${cost.people}, голосу: ${cost.voiceMin} хв.`),
    ]);
  }

  // резервні копії (міграція 0040): щоденні зашифровані знімки бази в приватному бакеті; завантажити файл — копія поза Supabase
  let bk = null, bkBusy = false, bkErr = '';
  async function loadBackups(now = false) {
    bkBusy = true; bkErr = ''; render();
    try { bk = await ai('admin', now ? 'backup_now' : 'backups'); } catch (e) { bkErr = aiErrorText(e); }
    bkBusy = false; render();
  }
  function backupSection() {
    const rows = (bk?.files || []).map(f => txRow({ icon: 'download-simple', label: f.path.replace(/^(daily|weekly)\//, '').replace('.meb', ''),
      sub: f.path.startsWith('weekly') ? 'Тижнева · 28 днів' : 'Щоденна · 7 днів', href: f.url || undefined, attrs: f.url ? { download: '', target: '_blank', rel: 'noopener' } : {} }));
    return txGroup('Резервні копії', [
      bk ? (rows.length ? txRows(rows) : h('div.xs.dim.adm-note', 'Копій ще немає — перша з\'явиться вночі.')) : null,
      bk?.made ? h('div.xs.dim.adm-note', `Копію зроблено · ${Math.round(bk.made.bytes / 1024)} КБ`) : null,
      bkErr ? h('div.xs.adm-note', bkErr) : null,
      txGrid([
        tx({ icon: 'arrow-clockwise', label: bk ? 'Оновити' : 'Показати копії', onclick: () => !bkBusy && loadBackups() }),
        tx({ icon: 'plus', label: bkBusy ? 'Зачекайте…' : 'Зробити копію зараз', onclick: () => !bkBusy && loadBackups(true) })], 2),
      bk?.key ? h('details', h('summary.xs.dim', 'Ключ розшифрування — збережіть у менеджері паролів'), h('pre.xs', { style: { whiteSpace: 'pre-wrap', ...wrap, margin: '4px 0 0' } }, bk.key)) : null,
      h('p.xs.dim.adm-note', 'Щоночі автоматично; файл зашифровано. Раз на місяць завантажуйте копію собі (диск або Google Drive). Відновлення — docs/backup.md.'),
    ]);
  }

  function render() {
    const s = data.stats || {}, u = s.users || {}, t = s.ai_totals || {}, lim = data.limits || {};
    const today = s.today;
    const from = new Date(Date.parse(today) - (days - 1) * 864e5).toISOString().slice(0, 10);
    const usage = (s.ai_usage || []).filter(r => r.day >= from);
    const byDay = {};
    for (const r of usage) (byDay[r.day] ||= []).push(r);

    const people = udata?.users ? usersSection(udata.users, udata.limits || lim, udata.budget) : null;
    body.replaceChildren(...[
      fdata?.feedback ? feedbackSection(fdata.feedback) : null,
      ...(people || []),
      udata?.chats ? txGroup('Переписка друзів · лише кількість', txKpis([
        stat(udata.chats.today, 'повідомлень за добу'), stat(udata.chats.week, 'за 7 днів'), stat(udata.chats.senders_week, 'пишуть'),
        stat(udata.chats.groups, 'груп'), stat(udata.chats.voice_week, 'голосових'), stat(udata.chats.fixes_week, 'виправлень'),
      ])) : null,
      txGroup(`Оновлено ${dtShort(s.generated_at)}`, txGrid([
        tx({ icon: showEmails ? 'eye-slash' : 'eye', label: showEmails ? 'Сховати email' : 'Показати email', attrs: { 'aria-pressed': String(showEmails) }, onclick: () => { showEmails = !showEmails; render(); } }),
        tx({ icon: 'arrow-clockwise', label: 'Оновити', onclick: load })], 2)),

      people ? null : txGroup('Користувачі', [
        txKpis([stat(u.total, 'усього акаунтів'), stat(u.signups7, 'нових за 7 днів')], 2),
        txKpis([stat(u.active_today, 'активних сьогодні'), stat(u.active7, 'активних за 7 днів')], 2),
        h('p.xs.dim.adm-note', `Активний — мав заняття (синхронізовані сесії) або виклики AI. За 30 днів: ${u.active30 ?? 0}.`)]),
      txGroup('Реєстрації й активність за 14 днів', h('section.card.stack.adm-card',
        h('div.xs.dim', 'Реєстрації'), ...bars(s.signups_by_day || [], 'Реєстрації по днях'),
        h('div.xs.dim', 'Активні користувачі'), ...bars(s.active_by_day || [], 'Активні по днях'))),

      txGroup('AI сьогодні · за 7 днів', [
        txKpis([
          stat(`${t.text_today ?? 0} · ${t.text7 ?? 0}`, `текстових викликів (ліміт ${lim.textCalls ?? '—'}/день на особу)`),
          stat(`${t.tts_today ?? 0} · ${t.tts7 ?? 0}`, `озвучень (ліміт ${lim.ttsCalls ?? '—'})`)], 2),
        txKpis([
          stat(`${t.live_today ?? 0} · ${t.live7 ?? 0}`, `токенів Live (ліміт ${lim.liveTokens ?? '—'})`),
          stat(`${mins(t.voice_sec_today)} · ${mins(t.voice_sec7)}`, 'голосу')], 2)]),

      h('section.tx-group',
        h('div.tx-label-row', h('h2.tx-label', 'AI за користувачами й днями'),
          h('div.seg.adm-seg', { role: 'group', 'aria-label': 'Період' },
            [7, 14].map(n => h('button', { type: 'button', 'aria-pressed': String(days === n), onclick: () => { days = n; render(); } }, `${n} дн.`)))),
        Object.keys(byDay).length
          ? h('div.list', Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).flatMap(([day, rows]) => [
            h('div.list-row', h('b.small', day === today ? 'Сьогодні' : dShort(day))),
            ...rows.map(r => h('div.list-row', h('div.grow', { style: wrap }, h('div.small', email(r.email)),
              h('div.sub', `текст ${r.text_calls} · озвучення ${r.tts_calls} · Live ${r.live_tokens} · голос ${mins(r.voice_seconds)}`)))),
          ]))
          : h('div.xs.dim.adm-note', 'За цей період викликів AI не було.')),

      txGroup(`Помилки клієнтів за 7 днів · ${s.errors?.total7 ?? 0} (сьогодні ${s.errors?.today ?? 0})`, [
        (s.errors?.top || []).length
          ? h('div.list', s.errors.top.map(e => h('div.list-row', { style: { display: 'block' } },
            h('div.small', { style: wrap }, e.msg),
            h('div.sub', `${e.n}× · ${e.users} ${e.users === 1 ? 'користувач' : 'користувачів'} · останнє ${dtShort(e.last_at)} · ${e.route || '—'} · ${e.ua || '—'} · збірка ${e.build || '—'}`),
            e.stack ? h('details', h('summary.xs.dim', 'Стек'), h('pre.xs', { style: { whiteSpace: 'pre-wrap', ...wrap, margin: '4px 0 0' } }, e.stack)) : null)))
          : h('div.xs.dim.adm-note', 'Помилок не зафіксовано.')]),

      costSection(),
      backupSection(),

      people ? null : txGroup('Акаунти (за останньою активністю)',
        h('div.list', (s.user_list || []).map(x => h('div.list-row', h('div.grow', { style: wrap },
          h('div.small', email(x.email)),
          h('div.sub', `реєстрація ${dShort(x.created_at)} · вхід ${dShort(x.last_sign_in_at)} · активність ${dShort(x.last_active)} · ${mins(x.sec7)} за 7 дн.`)))))),

    ].filter(Boolean));
  }

  await load();
}
