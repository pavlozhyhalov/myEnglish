// #/admin — службова сторінка адміністратора: користувачі, активність, використання AI, помилки клієнтів.
// Дані — edge-функція `admin` (лише агрегати). Хто адміністратор, вирішує сервер (ALLOWED_USERS): 403 → доступу немає.
import { h, ic } from '../ui/dom.js';
import { user } from '../supa.js';
import { ai, aiErrorText } from '../ai.js';
import { tx, txRow, txRows, txKpis, txGrid, txGroup, txPill, txBar } from '../ui/tiles.js';
import { S } from '../strings.js';
import { go } from '../router.js';
import { setTitle } from '../ui/shell.js';

const CACHE = 'me:admin';
const RECHECK_MS = 12 * 3600e3;

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
const dShort = (d) => d ? new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '—';
const dtShort = (d) => d ? new Date(d).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const mins = (sec) => `${Math.round((sec || 0) / 60)} хв`;
/** 75 хв → «1 год 15 хв» */
const dur = (sec) => {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} хв`;
  return `${Math.floor(m / 60)} год${m % 60 ? ` ${m % 60} хв` : ''}`;
};
const typeName = (t) => S.sessionTypes?.[t] || t;

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
function usersSection(ud, limits = {}, budget = {}) {
  const sm = ud.summary || {}, a = sm.ai_today || {}, today = ud.today;
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
        h('span.small', 'Gemini сьогодні, усі разом'), h('span.xs.dim', `${a.users ?? 0} ${a.users === 1 ? 'особа' : 'осіб'}`)),
      txBar(Math.min(1, (a.strong || 0) / strongCap), true),
      h('div.xs.dim', `сильні ${a.strong ?? 0} з ≈${strongCap} · текст ${a.text ?? 0} · голос ${mins(a.voice_sec)} · озвучення ${a.tts ?? 0} · Live ${a.live ?? 0}`)),
  ]);

  const details = (u) => {
    const ai = u.ai_today || {};
    const types = (u.by_type || []).filter(t => t.sec > 0);
    const maxT = Math.max(1, ...types.map(t => t.sec));
    const onb = u.onboarded == null ? '—' : (u.onboarded ? 'так' : 'ні');
    return h('div', { style: { padding: '4px 14px 12px' } },
      txKpis([
        { value: `${u.cards_learned ?? 0}`, unit: `/${u.cards_total ?? 0}`, label: 'слів вивчено' },
        { value: u.lessons_done ?? 0, label: 'уроків пройдено' },
        { value: `${u.mistakes_open ?? 0}`, unit: ` · ${u.mistakes_closed ?? 0}`, label: 'помилок відкр. · закр.' }]),
      h('div', { style: { marginTop: '10px' } },
        fact('Реєстрація', dShort(u.created_at)),
        fact('Тест рівня', u.placement?.level ? `${u.placement.level} · ${dShort(u.placement.at)}` : 'не проходив'),
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
    const top = (u.by_type || []).filter(t => (t.sec7 || t.sec) > 0)
      .sort((x, y) => (y.sec7 - x.sec7) || (y.sec - x.sec)).slice(0, 3)
      .map(t => `${typeName(t.type)} ${dur(t.sec7 || t.sec)}`).join(' · ');
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
            lvl ? txPill(lvl, 'accent') : null,
            u.push ? ic('bell', { size: 14 }) : null),
          h('span.tx-s', u.sec_total || u.last_active
            ? `${ago(u.last_active, today)} · ${dur(u.sec7)} за 7 дн. · усього ${dur(u.sec_total)}${u.voice7 ? ` · голос ×${u.voice7}` : ''}`
            : `ще без занять · реєстрація ${dShort(u.created_at)}`),
          top ? h('span.tx-s', top) : null),
        spark(u.days7),
        ic(on ? 'caret-down' : 'caret-right', { size: 16 }));
      wrapEl.replaceChildren(btn, on ? details(u) : '');
    };
    draw();
    return wrapEl;
  };

  const list = ud.users || [];
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
      ]);
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

  function render() {
    const s = data.stats || {}, u = s.users || {}, t = s.ai_totals || {}, lim = data.limits || {};
    const today = s.today;
    const from = new Date(Date.parse(today) - (days - 1) * 864e5).toISOString().slice(0, 10);
    const usage = (s.ai_usage || []).filter(r => r.day >= from);
    const byDay = {};
    for (const r of usage) (byDay[r.day] ||= []).push(r);

    const people = udata?.users ? usersSection(udata.users, udata.limits || lim, udata.budget) : null;
    body.replaceChildren(...[
      ...(people || []),
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

      people ? null : txGroup('Акаунти (за останньою активністю)',
        h('div.list', (s.user_list || []).map(x => h('div.list-row', h('div.grow', { style: wrap },
          h('div.small', email(x.email)),
          h('div.sub', `реєстрація ${dShort(x.created_at)} · вхід ${dShort(x.last_sign_in_at)} · активність ${dShort(x.last_active)} · ${mins(x.sec7)} за 7 дн.`)))))),

    ].filter(Boolean));
  }

  await load();
}
