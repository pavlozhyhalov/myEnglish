// Звіт за місяць (#/report?m=YYYY-MM): час, розмови, рівень у розмовах, мовлення, помилки, слова, «Ваш голос: тоді й зараз».
// Усе рахується локально (js/analysis.js monthPart); записи голосу — лише після входу (підписані посилання Supabase Storage).
import { h, ic } from '../ui/dom.js';
import { tx, txPrimary, txKpis, txRow, txGroup } from '../ui/tiles.js';
import { S, plural } from '../strings.js';
import { toast } from '../ui/toast.js';
import { user, getSupa } from '../supa.js';
import { deckIndex } from '../data.js';
import { LEVELS } from '../level.js';
import { monthPart, reportMonths, voiceClips, speechLines, monthKey, isMonthKey, MONTH_UK, MONTH_IN, MONTH_ACC, CRIT, CRIT_UK } from '../analysis.js';
import { SPEECH_META, speechRow, metricChart } from './analysis.js';
import { masteryDots, TALK_HREF } from './mistakes.js';
import { fold } from './progress.js';

const rk = (l) => LEVELS.indexOf(l);
const lvTxt = (x) => (x ? `${x.level}${x.sublevel === 'high' ? '+' : x.sublevel === 'low' ? '−' : ''}` : '—');
const fmtDate = (iso) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
const stat = (value, label, tone = '') => ({ value, label, tone });
/** Розділ звіту: згорнута плитка (назва, коротка цифра) з вмістом */
const block = (icon, title, sub, ...kids) => fold({ icon, label: title, sub }, ...kids);
const tcard = (...kids) => h('div.card.stack.tx-card', ...kids);

export default async function reportPage(view, r) {
  const months = reportMonths();
  let ym = isMonthKey(r?.query?.m) && r.query.m <= monthKey() ? r.query.m : months[0];
  if (!months.includes(ym)) { months.push(ym); months.sort().reverse(); }
  const deckIdx = await deckIndex().catch(() => []);
  const body = h('div.stack-lg');
  const chips = h('div.chips.scroll.rp-months', { role: 'group', 'aria-label': 'Місяць' });

  const drawChips = () => chips.replaceChildren(...months.map(m => {
    const [y, mm] = m.split('-').map(Number);
    const label = `${MONTH_UK[mm - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
    return h('button.chip', { type: 'button', 'aria-pressed': String(m === ym), onclick: () => {
      if (m === ym) return;
      ym = m; drawChips(); draw();
      history.replaceState(history.state, '', `#/report?m=${m}`);
    } }, label);
  }));
  const draw = () => body.replaceChildren(...monthView(monthPart(ym, deckIdx)));

  drawChips();
  draw();
  // назва розділу — у шапці й вкладках (Прогрес · Аналіз · Звіт)
  view.replaceChildren(h('div.stack-lg.report',
    months.length > 1 ? chips : null,
    body));
  // поточний місяць — до видимої частини стрічки чипів
  chips.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Ряд цифр без нулів і прочерків: лише те, що допомагає (1–3 плитки на всю ширину) */
function kpiRow(items) {
  const list = items.filter(x => x && x.value !== 0 && x.value !== '—');
  if (!list.length) return null;
  const row = txKpis(list, 3);
  if (list.length < 3) row.style.gridTemplateColumns = `repeat(${list.length},minmax(0,1fr))`;
  return row;
}

function monthView(M) {
  const empty = !M.seconds && !M.voice && !M.text && !M.mistakes.added && !M.words.reviews;
  const out = [hero(M, empty)];
  if (empty) {
    if (M.cur) out.push(txPrimary({ icon: 'play', label: 'Почати заняття', sub: 'звіт наповнюватиметься сам', href: '#/session' }));
  } else {
    const kp = kpiRow([
      stat(M.voice + M.text, plural(M.voice + M.text, 'розмова з вчителем', 'розмови з вчителем', 'розмов з вчителем')),
      M.level.n ? stat(lvTxt(M.level.last || M.level.first), 'рівень у розмовах', 'accent') : null,
      stat(M.mistakes.closed, plural(M.mistakes.closed, 'помилку закрито', 'помилки закрито', 'помилок закрито'), 'good')]);
    if (kp) out.push(txGroup('Підсумок місяця', kp));
  }
  const folds = empty ? [] : [talkCard(M), levelCard(M), speechCard(M), mistakesCard(M), wordsCard(M)];
  folds.push(voiceCard());
  if (folds.some(Boolean)) out.push(txGroup('Детальніше', h('div.pg-folds', folds.filter(Boolean))));
  if (!empty) {
    out.push(txGroup('Вивантажити', [
      pdfRow(M.ym),
      txRow({ icon: 'share-network', label: 'Поділитися підсумком', sub: 'короткий текст про ваш місяць', onclick: () => share(M) })]));
  }
  return out.filter(Boolean);
}

// ---------- Обкладинка: місяць, великі числа, хвилини по днях ----------
function hero(M, empty = false) {
  const min = Math.round(M.seconds / 60), prev = Math.round(M.prevSec / 60);
  const [, pm] = M.prevYm.split('-').map(Number);
  let cmp = '';
  if (prev && min) {
    const d = Math.round((min - prev) / prev * 100);
    const than = M.cur ? 'за ті самі дні минулого місяця' : `у ${MONTH_IN[pm - 1]}`;
    cmp = d >= 5 ? `На ${d}% більше, ніж ${than}` : d <= -5 ? `На ${-d}% менше, ніж ${than}` : `Приблизно як ${than}`;
  } else if (min && !prev) cmp = 'Перший місяць занять — добрий старт';
  const max = Math.max(60, ...M.days.map(d => d.sec));
  const head = [h('div.row', h('span.label.grow', M.cur ? 'Мій місяць англійської · триває' : 'Мій місяць англійської'), ic('calendar-blank', { size: 20 })),
    h('h2.rp-month#rp-month', M.title)];
  // порожній місяць — без нулів: лише назва й один рядок
  if (empty) return h('section.plan-hero.rp-hero.rp-hero-empty', { 'aria-labelledby': 'rp-month' }, ...head,
    h('span.sub', M.cur ? 'Тут з\'явиться ваш місяць: хвилини, розмови, рівень і помилки' : `У ${MONTH_IN[M.monthIdx]} занять не було`));
  return h('section.plan-hero.rp-hero', { 'aria-labelledby': 'rp-month' },
    ...head,
    h('div.rp-big',
      h('div', h('b', String(min)), h('span', plural(min, 'хвилина', 'хвилини', 'хвилин'))),
      h('div', h('b', String(M.activeDays)), h('span', plural(M.activeDays, 'активний день', 'активні дні', 'активних днів'))),
      h('div', h('b', String(M.bestRun)), h('span', `${plural(M.bestRun, 'день', 'дні', 'днів')} — найдовша серія`))),
    h('div.rp-days', { role: 'img', 'aria-label': `Хвилини по днях: ${M.days.filter(d => !d.future).map(d => `${d.day} — ${Math.round(d.sec / 60)}`).join(', ')}` },
      M.days.map(d => h('i' + (d.sec ? '' : '.zero') + (d.future ? '.future' : ''), { style: { height: `${d.sec ? Math.max(8, d.sec / max * 100) : 6}%` }, title: `${d.day}: ${Math.round(d.sec / 60)} хв` }))),
    h('div.rp-days-lbl', h('span', '1'), h('span', String(Math.ceil(M.nDays / 2))), h('span', String(M.nDays))),
    cmp ? h('span.sub', cmp) : null);
}

// ---------- Розмови з вчителем ----------
function talkCard(M) {
  const vmin = Math.round(M.voiceSec / 60);
  const types = Object.entries(M.byType).filter(([, v]) => v > 0).slice(0, 6);
  const sub = [M.voice ? `${M.voice} ${plural(M.voice, 'голосова', 'голосові', 'голосових')}` : '', M.text ? `${M.text} ${plural(M.text, 'текстова', 'текстові', 'текстових')}` : '', M.diary ? `${M.diary} у щоденнику` : ''].filter(Boolean).join(' · ');
  return block('chat-circle-dots', 'Заняття', sub || 'розмов з вчителем не було',
    kpiRow([
      stat(M.voice, plural(M.voice, 'голосова розмова', 'голосові розмови', 'голосових розмов')),
      stat(M.text, plural(M.text, 'текстова розмова', 'текстові розмови', 'текстових розмов')),
      stat(M.diary, plural(M.diary, 'запис у щоденнику', 'записи в щоденнику', 'записів у щоденнику'))]),
    vmin ? h('div.xs.dim.pg-note', `Голосом — ${vmin} хв розмови з вчителем.`) : null,
    types.length ? h('div.chips', types.map(([k, v]) => h('span.tag', `${S.sessionTypes[k] || k}: ${v} хв`))) : null);
}

// ---------- Рівень у розмовах: перша й остання оцінка місяця, критерії CEFR ----------
function levelCard(M) {
  const L = M.level;
  if (!L.n && !M.cur) return null;
  if (!L.n) return block('target', 'Рівень у розмовах', 'оцінок цього місяця немає',
    h('div.stack.an-empty', h('span.small.dim', 'Вчитель оцінює розмову, коли в ній 40+ ваших слів.'),
      M.cur ? txRow({ icon: 'microphone', label: 'Поговорити', href: '#/tutor?mode=voice' }) : null));
  const a = L.first, b = L.last;
  const crit = CRIT.filter(k => a.crit[k] || b?.crit[k]);
  const arrow = (x, y) => {
    if (!x || !y) return null;
    const d = rk(y) - rk(x);
    return d > 0 ? h('span.tag.good', '↑') : d < 0 ? h('span.tag.bad', '↓') : h('span.tag', '=');
  };
  return block('target', 'Рівень у розмовах', b ? `${lvTxt(a)} → ${lvTxt(b)} · ${L.n} ${plural(L.n, 'оцінка', 'оцінки', 'оцінок')}` : `${lvTxt(a)} · ${L.n} ${plural(L.n, 'оцінка', 'оцінки', 'оцінок')}`, tcard(
    h('div.rp-lv',
      h('div', h('span.xs.dim', b ? 'на початку місяця' : 'оцінка місяця'), h('div.level-badge', lvTxt(a))),
      b ? h('span.rp-lv-arrow', { 'aria-hidden': 'true' }, ic('arrow-right', { size: 22 })) : null,
      b ? h('div', h('span.xs.dim', 'в кінці'), h('div.level-badge', lvTxt(b))) : null,
),
    crit.length ? h('div.an-table', { role: 'table', 'aria-label': 'Критерії CEFR' },
      crit.map(k => h('div.an-tr', { role: 'row' },
        h('span.grow', { role: 'cell' }, CRIT_UK[k]),
        b ? h('span.xs.dim', { role: 'cell' }, `${a.crit[k] || '—'} →`) : null,
        h('b', { role: 'cell' }, (b ? b.crit[k] : a.crit[k]) || '—'),
        b ? h('span', { role: 'cell' }, arrow(a.crit[k], b.crit[k])) : null))) : null));
}

// ---------- Мовлення (голосові розмови місяця) ----------
function speechCard(M) {
  const sp = M.speech;
  if (!sp.n && !M.cur) return null;
  if (!sp.n) return block('waveform', 'Мовлення', 'голосових розмов не було',
    h('div.stack.an-empty', h('span.small.dim', 'Поговоріть голосом 2–3 рази, щоб побачити темп, довжину реплік і плавність.'),
      M.cur ? txRow({ icon: 'microphone', label: 'Поговорити', href: '#/tutor?mode=voice' }) : null));
  const lines = speechLines(sp.first, sp.latest);
  const list = sp.sessions;
  return block('waveform', 'Мовлення', `${sp.latest?.wpm ?? '—'} слів/хв · ${sp.n} ${plural(sp.n, 'розмова', 'розмови', 'розмов')}`, tcard(
    h('div.xs.dim', sp.first ? `${sp.firstN === 1 ? 'Перша розмова місяця' : `Середнє перших ${sp.firstN} розмов місяця`} → остання` : 'Одна виміряна розмова цього місяця'),
    h('div.an-table', { role: 'table', 'aria-label': 'Мовлення' }, Object.keys(SPEECH_META).map(k => speechRow(k, sp.first, sp.latest))),
    lines.length ? h('ul.small.sp-lines', lines.map(l => h('li', l))) : null,
    metricChart(list.map(s => ({ at: s.at, v: s.wpm })), { label: 'Темп', unit: 'слів/хв' }),
    sp.n < 2 ? h('div.small.dim', 'Поговоріть голосом 2–3 рази, щоб побачити динаміку.') : null));
}

// ---------- Помилки ----------
function mistakesCard(M) {
  const m = M.mistakes;
  const sub = [m.added ? `нових ${m.added}` : '', m.closed ? `закрито ${m.closed}` : '', m.open ? `відкритих ${m.open}` : ''].filter(Boolean).join(' · ');
  return block('warning-circle', 'Помилки', sub || 'помилок не було',
    kpiRow([stat(m.added, plural(m.added, 'нова', 'нові', 'нових'), 'bad'), stat(m.closed, 'закрито', 'good'), stat(m.open, 'відкритих зараз')]),
    m.top.length ? h('h3.tx-label.pg-sublabel', 'Що лишилося опрацювати (найчастіші)') : null,
    m.top.length ? h('div.tx-rows', m.top.map(x => h('div.tx-row.rp-mk',
      h('span.tx-no', `×${x.count}`),
      h('div.tx-body',
        h('div.fix-line', h('s.bad', x.wrong), h('span.arrow', { 'aria-label': 'правильно:' }, ' → '), h('b.good', x.right)),
        h('div.row.wrap.xs.dim', h('span.grow', S.mistakeTypes[x.type] || x.type), masteryDots(x.streak)))))) : null,
    m.top.length ? h('div.tx-grid.c2',
      tx({ icon: 'microphone', label: 'Потренувати в розмові', href: TALK_HREF }),
      tx({ icon: 'warning-circle', label: 'Усі помилки', href: '#/mistakes' })) : null);
}

// ---------- Слова ----------
function wordsCard(M) {
  const w = M.words;
  if (!w.reviews && w.solidNow == null) return null;
  const sub = [w.started ? `почато ${w.started}` : '', w.reviews ? `повторів ${w.reviews}` : '', w.solidNow ? `закріплено ${w.solidNow}` : ''].filter(Boolean).join(' · ');
  return block('cards', 'Слова', sub || 'нових слів і повторів не було',
    kpiRow([
      stat(w.started, plural(w.started, 'нове слово почато', 'нові слова почато', 'нових слів почато')),
      stat(w.reviews, plural(w.reviews, 'повтор', 'повтори', 'повторів')),
      w.solidNow != null ? stat(w.solidNow, 'закріплено зараз (≥ 7 дн.)', 'good') : null]),
    w.oldReviews ? h('div.xs.dim.pg-note', 'Повтори карток старші за 4 місяці на пристрої не зберігаються — числа можуть бути неповні.') : null);
}

// ---------- Ваш голос: тоді й зараз (лише після входу; файл вантажиться по тапу) ----------
function voiceCard() {
  if (!user()) return null;
  const clips = voiceClips();
  if (!clips.length) return null;
  const first = clips[0], last = clips.length > 1 ? clips[clips.length - 1] : null;
  return block('microphone', last ? 'Ваш голос: тоді й зараз' : 'Ваш голос', `${clips.length} ${plural(clips.length, 'запис', 'записи', 'записів')}`, tcard(
    h('div.rp-clips', clipBox(first, last ? 'Тоді' : 'Перший запис'), last ? clipBox(last, 'Зараз') : null),
    last ? null : h('div.xs.dim', 'Після наступних голосових розмов тут буде порівняння «тоді й зараз».'),
    h('div.xs.dim', 'Записи — ваша найдовша репліка з розмови; зберігаються приватно у вашому акаунті.')));
}

function clipBox(c, label) {
  const slot = h('div.rp-clip-play');
  const btn = h('button.btn.soft.block', { type: 'button', onclick: load }, ic('play', { fill: true, size: 18 }), S.listen);
  slot.append(btn);
  async function load() {
    btn.disabled = true;
    btn.replaceChildren(ic('hourglass', { size: 18 }), 'Завантажую…');
    try {
      const sb = await getSupa();
      const { data, error } = await sb.storage.from('voice-clips').createSignedUrl(c.path, 3600);
      if (error || !data?.signedUrl) throw error || new Error('no url');
      const audio = h('audio', { controls: true, preload: 'auto', src: data.signedUrl });
      slot.replaceChildren(audio);
      audio.play().catch(() => { /* iOS: користувач натисне ▶ сам */ });
    } catch (e) {
      console.warn('clip', e);
      btn.disabled = false;
      btn.replaceChildren(ic('arrow-clockwise', { size: 18 }), 'Спробувати ще раз');
      toast(navigator.onLine ? 'Не вдалося завантажити запис' : S.err.offline);
    }
  }
  return h('div.rp-clip',
    h('div.row', h('span.tag.accent', label), h('span.xs.dim.grow', fmtDate(c.at)), c.sec ? h('span.xs.dim', `${Math.round(c.sec)} с`) : null),
    slot,
    c.text ? h('p.rp-clip-text', { lang: 'en' }, `«${c.text}»`) : null);
}

// ---------- Поділитися: короткий текст підсумку ----------
async function share(M) {
  const min = Math.round(M.seconds / 60);
  const parts = [`Мій ${MONTH_ACC[M.monthIdx]} в англійській (myEnglish):`,
    `• ${min} хв практики, ${M.activeDays} ${plural(M.activeDays, 'активний день', 'активні дні', 'активних днів')}, найдовша серія — ${M.bestRun} ${plural(M.bestRun, 'день', 'дні', 'днів')}`];
  if (M.voice || M.text) parts.push(`• Розмов із вчителем: ${M.voice + M.text}${M.voice ? ` (голосом — ${M.voice})` : ''}`);
  if (M.level.n) parts.push(`• Рівень у розмовах: ${M.level.last ? `${lvTxt(M.level.first)} → ${lvTxt(M.level.last)}` : lvTxt(M.level.first)}`);
  const sl = speechLines(M.speech.first, M.speech.latest)[0];
  if (sl) parts.push(`• ${sl}`);
  if (M.mistakes.closed) parts.push(`• Закрито помилок: ${M.mistakes.closed}`);
  if (M.words.started) parts.push(`• Нових слів: ${M.words.started}`);
  const text = parts.join('\n');
  try {
    if (navigator.share) { await navigator.share({ title: `Звіт за ${MONTH_ACC[M.monthIdx]}`, text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Підсумок скопійовано');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Не вдалося поділитися');
  }
}


/** «Завантажити PDF»: справжній PDF-звіт за місяць (js/pdfreport.js — вантажиться лише при натисканні) */
export function pdfRow(ym, label = 'Завантажити PDF') {
  let busy = false;
  const row = txRow({ icon: 'download-simple', label, sub: 'звіт за місяць — зберегти у Файли чи надіслати', onclick: async () => {
    if (busy) return;
    busy = true;
    const sub = row.querySelector('.tx-s'); const was = sub?.textContent;
    if (sub) sub.textContent = 'Готую PDF…';
    try {
      const r = await (await import('../pdfreport.js')).exportMonthPdf(ym);
      if (r === 'downloaded') toast('PDF збережено');
    } catch (e) { console.warn('pdf', e); toast('Не вдалося сформувати PDF', { kind: 'bad' }); }
    if (sub) sub.textContent = was;
    busy = false;
  } });
  return row;
}
