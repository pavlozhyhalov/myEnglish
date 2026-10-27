// #/admin — службова сторінка адміністратора: користувачі, активність, використання AI, помилки клієнтів.
// Дані — edge-функція `admin` (лише агрегати). Хто адміністратор, вирішує сервер (ALLOWED_USERS): 403 → доступу немає.
import { h, ic, emo } from '../ui/dom.js';
import { user } from '../supa.js';
import { ai, aiErrorText } from '../ai.js';

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
  const show = (ok) => slot.replaceChildren(...(ok ? [h('br'), h('a', { href: '#/admin' }, 'Адмін')] : []));
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
  const head = h('section.row', h('div.emoji-circle', emo('key')),
    h('div.grow', h('h1', { style: { margin: 0 } }, 'Адміністрування'), h('div.small.dim', 'Лише агреговані показники')));
  view.replaceChildren(h('div.stack-lg', head, body));

  if (!user()) {
    body.replaceChildren(h('div.empty', emo('key', 'xl'), h('p', 'Увійдіть в акаунт адміністратора.'), h('a.btn.soft', { href: '#/auth' }, 'Увійти')));
    return;
  }

  const load = async () => {
    body.replaceChildren(h('div.empty', h('p', 'Завантаження…')));
    try {
      data = await ai('admin', 'stats', { days: 14 });
      remember(true);
      render();
    } catch (e) {
      if (e.code === 'not_admin' || e.code === 'not_allowed') {
        remember(false);
        body.replaceChildren(h('div.empty', emo('cross', 'xl'), h('p', 'Ця сторінка доступна лише адміністраторам.'), h('a.btn.soft', { href: '#/' }, 'На головну')));
      } else {
        body.replaceChildren(h('div.empty', emo('warning', 'xl'), h('p', aiErrorText(e)),
          h('button.btn.soft', { type: 'button', onclick: load }, ic('arrow-clockwise', { size: 16 }), 'Спробувати ще')));
      }
    }
  };

  const stat = (v, label) => h('div.stat', h('b', String(v ?? 0)), h('span', label));
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
      h('div.row', { style: { flexWrap: 'wrap', gap: '8px' } },
        h('span.xs.dim.grow', `Оновлено ${dtShort(s.generated_at)}`),
        h('button.btn.sm.soft', { type: 'button', 'aria-pressed': String(showEmails), onclick: () => { showEmails = !showEmails; render(); } },
          ic(showEmails ? 'eye-slash' : 'eye', { size: 16 }), showEmails ? 'Сховати email' : 'Показати email'),
        h('button.btn.sm.soft', { type: 'button', onclick: load }, ic('arrow-clockwise', { size: 16 }), 'Оновити')),

      h('section.card.stack',
        h('div.section-title', 'Користувачі'),
        h('div.grid2', stat(u.total, 'усього акаунтів'), stat(u.signups7, 'нових за 7 днів'), stat(u.active_today, 'активних сьогодні'), stat(u.active7, 'активних за 7 днів')),
        h('div.xs.dim', `Активний — мав заняття (синхронізовані сесії) або виклики AI. За 30 днів: ${u.active30 ?? 0}.`),
        h('div.section-title', 'Реєстрації за 14 днів'), ...bars(s.signups_by_day || [], 'Реєстрації по днях'),
        h('div.section-title', 'Активні користувачі за 14 днів'), ...bars(s.active_by_day || [], 'Активні по днях')),

      h('section.card.stack',
        h('div.section-title', 'AI сьогодні · за 7 днів'),
        h('div.grid2',
          stat(`${t.text_today ?? 0} · ${t.text7 ?? 0}`, `текстових викликів (ліміт ${lim.textCalls ?? '—'}/день на особу)`),
          stat(`${t.tts_today ?? 0} · ${t.tts7 ?? 0}`, `озвучень (ліміт ${lim.ttsCalls ?? '—'})`),
          stat(`${t.live_today ?? 0} · ${t.live7 ?? 0}`, `токенів Live (ліміт ${lim.liveTokens ?? '—'})`),
          stat(`${mins(t.voice_sec_today)} · ${mins(t.voice_sec7)}`, 'голосу'))),

      h('section.card.stack',
        h('div.row', h('div.section-title.grow', 'AI за користувачами й днями'),
          h('div.seg', { role: 'group', 'aria-label': 'Період', style: { minWidth: '140px' } },
            [7, 14].map(n => h('button', { type: 'button', 'aria-pressed': String(days === n), onclick: () => { days = n; render(); } }, `${n} дн.`)))),
        Object.keys(byDay).length
          ? h('div.list', Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).flatMap(([day, rows]) => [
            h('div.list-row', h('b.small', day === today ? 'Сьогодні' : dShort(day))),
            ...rows.map(r => h('div.list-row', h('div.grow', { style: wrap }, h('div.small', email(r.email)),
              h('div.sub', `текст ${r.text_calls} · озвучення ${r.tts_calls} · Live ${r.live_tokens} · голос ${mins(r.voice_seconds)}`)))),
          ]))
          : h('div.xs.dim', 'За цей період викликів AI не було.')),

      h('section.card.stack',
        h('div.section-title', `Помилки клієнтів за 7 днів · ${s.errors?.total7 ?? 0} (сьогодні ${s.errors?.today ?? 0})`),
        (s.errors?.top || []).length
          ? h('div.list', s.errors.top.map(e => h('div.list-row', { style: { display: 'block' } },
            h('div.small', { style: wrap }, e.msg),
            h('div.sub', `${e.n}× · ${e.users} ${e.users === 1 ? 'користувач' : 'користувачів'} · останнє ${dtShort(e.last_at)} · ${e.route || '—'} · ${e.ua || '—'} · збірка ${e.build || '—'}`),
            e.stack ? h('details', h('summary.xs.dim', 'Стек'), h('pre.xs', { style: { whiteSpace: 'pre-wrap', ...wrap, margin: '4px 0 0' } }, e.stack)) : null)))
          : h('div.xs.dim', 'Помилок не зафіксовано.')),

      h('section.card.stack',
        h('div.section-title', 'Акаунти (за останньою активністю)'),
        h('div.list', (s.user_list || []).map(x => h('div.list-row', h('div.grow', { style: wrap },
          h('div.small', email(x.email)),
          h('div.sub', `реєстрація ${dShort(x.created_at)} · вхід ${dShort(x.last_sign_in_at)} · активність ${dShort(x.last_active)} · ${mins(x.sec7)} за 7 дн.`)))))),
    );
  }

  await load();
}
