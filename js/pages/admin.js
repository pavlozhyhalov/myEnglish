// #/admin — службова сторінка адміністратора: користувачі, активність, використання AI, помилки клієнтів.
// Дані — edge-функція `admin` (лише агрегати). Хто адміністратор, вирішує сервер (ALLOWED_USERS): 403 → доступу немає.
import { h, ic } from '../ui/dom.js';
import { user } from '../supa.js';
import { ai, aiErrorText } from '../ai.js';
import { tx, txRow, txRows, txKpis, txGrid, txGroup } from '../ui/tiles.js';

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

export default async function adminPage(view) {
  let showEmails = false, days = 7, data = null;
  const body = h('div.stack-lg');
  const head = tx({ icon: 'key', wide: true, cls: 'adm-head', label: 'Адміністрування', sub: 'Лише агреговані показники' });
  view.replaceChildren(h('div.stack-lg', head, body));

  if (!user()) {
    body.replaceChildren(txRows([txRow({ icon: 'key', label: 'Увійти', sub: 'Увійдіть в акаунт адміністратора.', href: '#/auth' })]));
    return;
  }

  const load = async () => {
    body.replaceChildren(txRows([txRow({ icon: 'hourglass', label: 'Завантаження…', chevron: false })]));
    try {
      data = await ai('admin', 'stats', { days: 14 });
      remember(true);
      render();
    } catch (e) {
      if (e.code === 'not_admin' || e.code === 'not_allowed') {
        remember(false);
        body.replaceChildren(txRows([txRow({ icon: 'x-circle', label: 'Доступ лише для адміністраторів', sub: 'На головну', href: '#/' })]));
      } else {
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

    body.replaceChildren(
      txGroup(`Оновлено ${dtShort(s.generated_at)}`, txGrid([
        tx({ icon: showEmails ? 'eye-slash' : 'eye', label: showEmails ? 'Сховати email' : 'Показати email', attrs: { 'aria-pressed': String(showEmails) }, onclick: () => { showEmails = !showEmails; render(); } }),
        tx({ icon: 'arrow-clockwise', label: 'Оновити', onclick: load })], 2)),

      txGroup('Користувачі', [
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

      txGroup('Акаунти (за останньою активністю)',
        h('div.list', (s.user_list || []).map(x => h('div.list-row', h('div.grow', { style: wrap },
          h('div.small', email(x.email)),
          h('div.sub', `реєстрація ${dShort(x.created_at)} · вхід ${dShort(x.last_sign_in_at)} · активність ${dShort(x.last_active)} · ${mins(x.sec7)} за 7 дн.`)))))),
    );
  }

  await load();
}
