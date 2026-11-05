// Фразник (#/phrases): готові фрази для реальних ситуацій, підготовка «скажи вголос → перевір себе»
// #/phrases — ситуації; #/phrases/<id> — фрази ситуації; #/phrases/<id>/prepare — підготовка
import { h, ic } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { speak, stop as stopSpeech, recognize, canRecognize, compareWords } from '../speech.js';
import { setTitle } from '../ui/shell.js';
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { activityTimer } from '../stats.js';
import { user } from '../supa.js';
import { onLeave } from '../router.js';
import { tx, txPrimary, txGrid, txGroup } from '../ui/tiles.js';
import { SITUATIONS, situation, phrasesBySituation, phraseCount, savePhrases, fillMissing, guessSituation } from '../phrases.js';

const nPhrases = (n) => `${n} ${plural(n, 'фраза', 'фрази', 'фраз')}`;
/** replaceChildren без null/false/0 (рідний DOM-метод вставив би їх як текст) */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false && k !== 0 && k !== ''));
/** Остання оцінка кожної картки (журнал reviews): «Знав» → позначка «знаю» у списку */
function lastRatings() {
  const m = new Map();
  for (const r of store.all('reviews')) { const p = m.get(r.card_id); if (!p || String(r.ts) > p.ts) m.set(r.card_id, { ts: String(r.ts), rating: r.rating }); }
  return m;
}

export default function phrases(view, r) {
  const sit = r.parts[0] && SITUATIONS.find(s => s.id === r.parts[0]);
  if (sit && r.parts[1] === 'prepare') return prepare(view, sit);
  if (sit) return situationView(view, sit);
  return overview(view);
}

// ---------- Ситуації ----------
function overview(view) {
  setTitle('Фразник');
  const groups = phrasesBySituation();
  const total = phraseCount();
  const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const topSit = top && situation(top[0]);
  const tile = (s) => {
    const n = groups.get(s.id)?.length || 0;
    return tx({ href: `#/phrases/${s.id}`, icon: s.icon, label: s.uk, sub: n ? nPhrases(n) : 'поки порожньо', cls: 'ph-tile' + (n ? '' : '.empty-sit'),
      attrs: { 'aria-label': `${s.uk}: ${n ? nPhrases(n) : 'поки порожньо'}` } });
  };
  // ситуації з фразами — першими (за кількістю), далі решта в усталеному порядку
  const order = SITUATIONS.slice().sort((a, b) => (groups.get(b.id)?.length || 0) - (groups.get(a.id)?.length || 0));
  view.replaceChildren(h('div.stack-lg.phrasebook',
    topSit ? txGroup('Підготуватися до…',
      txPrimary({ href: `#/phrases/${topSit.id}/prepare`, icon: topSit.icon, label: topSit.uk,
        sub: `${nPhrases(top[1].length)} · ~${Math.max(1, Math.round(top[1].length * 0.4))} хв · скажіть уголос і перевірте себе`,
        attrs: { 'aria-label': `Підготуватися: ${topSit.uk}` } })) : emptyCard(),
    txGroup(total ? `Ситуації · ${nPhrases(total)}` : 'Ситуації', txGrid(order.map(tile), 2)),
    tx({ icon: 'plus', label: 'Додати фразу', sub: 'Те, що треба сказати лікарю, сусіду чи в банку', wide: true, onclick: () => addSheet(null, () => overview(view)) })));
}

function emptyCard() {
  return txGroup('Звідки беруться фрази', [
    h('p.small.dim.ph-empty-t', 'Збережіть корисні фрази з місій вчителя, сценаріїв і підсумків розмов — кнопкою «У фразник». Або додайте свої: те, що треба сказати лікарю, сусіду чи в банку.'),
    txGrid([
      tx({ href: '#/tutor', icon: 'flag', label: 'Місії', sub: 'рольові ігри з вчителем', on: true }),
      tx({ href: '#/scenarios', icon: 'users-three', label: 'Сценарії', sub: 'діалоги з життя' }),
    ], 2)]);
}

// ---------- Фрази ситуації ----------
function situationView(view, sit) {
  setTitle(sit.uk);
  const body = h('div.stack-lg.phrasebook');
  view.replaceChildren(body);
  const draw = () => {
    const list = phrasesBySituation().get(sit.id) || [];
    const missing = list.filter(c => !c.uk).length;
    const last = lastRatings();
    const known = (c) => (last.get(c.id)?.rating || 0) >= srs.Rating.Good;
    fill(body, 
      h('div.row', h('a.icon-btn', { href: '#/phrases', 'aria-label': 'До фразника' }, ic('arrow-left')),
        h('span.tile-ico', ic(sit.icon, { size: 22 })),
        h('div.grow', h('h1', { style: { margin: 0, fontSize: 'var(--fs-xl)' } }, sit.uk), h('div.xs.dim', list.length ? nPhrases(list.length) : 'Поки порожньо'))),
      list.length ? h('div.stack', { style: { gap: '8px' } },
        txPrimary({ href: `#/phrases/${sit.id}/prepare`, icon: 'play', label: 'Підготуватися', sub: nPhrases(Math.min(15, list.length)) + ' за раз' }),
        h('div.xs.dim.ph-hint', 'Бачите фразу українською — кажете вголос англійською — перевіряєте себе.')) : null,
      list.length ? h('div.list.ph-list', list.map(c => row(c, known(c)))) : h('div.empty.ph-sit-empty', ic('chat-centered-text', { size: 40 }),
        h('p', 'Тут ще немає фраз. Додайте те, що вам знадобиться в цій ситуації, або збережіть фрази з місій і сценаріїв.'),
        h('a.btn.soft', { href: '#/tutor' }, ic('flag', { size: 18 }), 'Місії вчителя')),
      missing && !(user() && navigator.onLine) ? h('div.xs.dim', `${missing} ${plural(missing, 'фраза', 'фрази', 'фраз')} без перекладу — його буде додано після входу, коли з'явиться мережа.`) : null,
      tx({ icon: 'plus', label: 'Додати фразу', wide: true, onclick: () => addSheet(sit.id, draw) }));
  };
  const row = (c, isKnown) => h('div.list-row.ph-row',
    h('button.ph-say', { type: 'button', 'aria-label': `Прослухати: ${c.en}`, onclick: () => speak(c.en) },
      h('span.ph-spk', ic('speaker-high', { size: 18 })),
      h('span.grow.ph-text', h('span.ph-en', { lang: 'en' }, c.en), c.uk ? h('span.ph-uk', c.uk) : h('span.ph-uk.ph-noua', 'переклад з\'явиться згодом'))),
    isKnown ? h('span.tag.good', { title: 'Ви знали цю фразу під час підготовки' }, 'знаю') : null,
    h('button.icon-btn', { type: 'button', 'aria-label': `Видалити: ${c.en}`, onclick: () => del(c) }, ic('trash', { size: 18 })));
  const del = (c) => {
    store.remove('cards', c.id);
    draw();
    toast('Фразу видалено', { action: 'Повернути', onAction: () => { const x = { ...c, deleted: false }; store.put('cards', x); if (body.isConnected) draw(); } });
  };
  draw();
  // фрази без перекладу (збережені без мережі) — перекладаємо одним запитом
  const list = phrasesBySituation().get(sit.id) || [];
  if (list.some(c => !c.uk) && user() && navigator.onLine) fillMissing(list).then(n => { if (n && body.isConnected) draw(); });
}

/** Шторка «Додати фразу»: англійською (обов'язково) + переклад (необов'язково) + ситуація */
function addSheet(sitId, onSaved) {
  const en = h('input.input', { type: 'text', lang: 'en', placeholder: 'Could I book an appointment, please?', autocomplete: 'off', autocapitalize: 'sentences', 'aria-label': 'Фраза англійською' });
  const uk = h('input.input', { type: 'text', placeholder: 'Можна записатися на прийом?', autocomplete: 'off', 'aria-label': 'Переклад (необов\'язково)' });
  let picked = sitId;
  const sel = sitId ? null : h('select.input', { 'aria-label': 'Ситуація' }, SITUATIONS.map(s => h('option', { value: s.id }, s.uk)));
  let touched = false;
  if (sel) {
    sel.value = 'other';
    sel.addEventListener('change', () => { touched = true; });
    en.addEventListener('input', () => { if (!touched) sel.value = guessSituation(en.value); });
  }
  const err = h('div.xs.ph-err', { role: 'alert' });
  const save = h('button.btn.primary.block', { type: 'button' }, ic('plus', { size: 18 }), 'Зберегти');
  const s = sheet('Нова фраза', h('div.stack',
    h('div.field', h('label', 'Англійською'), en),
    h('div.field', h('label', 'Українською — необов\'язково'), uk,
      h('div.xs.dim', user() ? 'Якщо залишити порожнім, переклад зробить вчитель.' : 'Переклад можна додати пізніше — після входу його зробить вчитель.')),
    sel ? h('div.field', h('label', 'Ситуація'), sel) : null,
    err, save));
  save.addEventListener('click', async () => {
    const v = en.value.trim();
    if (!/[a-z]/i.test(v)) { err.textContent = 'Напишіть фразу англійською.'; en.focus(); return; }
    picked = sel ? sel.value : picked;
    save.disabled = true;
    save.replaceChildren(ic('hourglass', { size: 18 }), uk.value.trim() ? 'Зберігаю…' : 'Перекладаю…');
    const res = await savePhrases([{ en: v, uk: uk.value.trim() }], { situation: picked, source: 'manual' }).catch(() => null);
    s.close();
    toast(!res ? 'Не вдалося зберегти фразу' : res.added ? `Додано у фразник: ${situation(picked).uk}` : 'Ця фраза вже є у ваших картках');
    onSaved?.();
  });
  en.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); uk.focus(); } });
  uk.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
  setTimeout(() => en.focus(), 300);
}

// ---------- Підготовка ----------
/** Порядок: невідомі й «до повтору» — першими, потім решта; до 15 фраз за раз */
function prepOrder(list) {
  const now = Date.now();
  const rank = (c) => (!c.reps ? 1 : c.due && Date.parse(c.due) <= now ? 0 : c.lapses ? 2 : 3);
  return list.slice().sort((a, b) => rank(a) - rank(b) || (b.lapses || 0) - (a.lapses || 0)).slice(0, 15);
}

function prepare(view, sit, only = null) {
  setTitle(sit.uk);
  const all = phrasesBySituation().get(sit.id) || [];
  const list = only ? all.filter(c => only.has(c.id)) : prepOrder(all);
  if (!list.length) { location.replace(`#/phrases/${sit.id}`); return; }
  const timer = activityTimer('cards');
  let i = 0, ac = null;
  const missed = [];
  const box = h('div.stack-lg.phrasebook.ph-prep');
  view.replaceChildren(box);

  const head = () => h('div.row', h('a.icon-btn', { href: `#/phrases/${sit.id}`, 'aria-label': 'Завершити підготовку' }, ic('x')),
    h('div.grow.stack', { style: { gap: '6px' } },
      h('div.row.xs.dim', h('span.grow', `Підготовка · ${sit.uk}`), h('span', `${Math.min(i + 1, list.length)}/${list.length}`)),
      h('div.progress', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(list.length), 'aria-valuenow': String(i), 'aria-label': 'Прогрес підготовки' },
        h('i', { style: { width: `${Math.round(i / list.length * 100)}%` } }))));

  const step = () => {
    ac?.abort(); ac = null;
    if (i >= list.length) return done();
    const c = store.get('cards', list[i].id) || list[i];
    const heard = h('div.ph-heard', { 'aria-live': 'polite' });
    const card = h('section.card.ph-card',
      h('div.label', c.uk ? 'Скажіть англійською вголос' : 'Прочитайте вголос і запам\'ятайте'),
      h('div.ph-q', c.uk || c.en));
    const actions = h('div.stack', { style: { gap: '8px' } });
    const reveal = (said = null) => {
      ac?.abort(); ac = null;
      const cmp = said ? compareWords(c.en, said) : null;
      fill(card, 
        c.uk ? h('div.ph-uk-q', c.uk) : null,
        h('div.ph-a', { lang: 'en' }, cmp ? cmp.words.map((w, k) => [k ? ' ' : '', h('span' + (w.ok ? '' : '.miss'), w.raw)]) : c.en),
        h('button.btn.sm.soft.ph-listen', { type: 'button', onclick: () => speak(c.en) }, ic('speaker-high', { size: 16 }), 'Прослухати ще раз'),
        said ? h('div.xs.dim.ph-said', h('span', 'Ви сказали: '), h('span', { lang: 'en' }, `«${said}»`), cmp ? h('b.' + (cmp.pct >= 75 ? 'good' : 'bad'), ` · ${cmp.pct}%`) : null) : null);
      speak(c.en);
      timer.poke();
      fill(actions, h('div.ph-grades',
        h('button.grade.again', { type: 'button', onclick: () => rate(c, srs.Rating.Again) }, ic('arrow-clockwise', { size: 18 }), 'Ще ні'),
        h('button.grade.good', { type: 'button', onclick: () => rate(c, srs.Rating.Good) }, ic('check', { size: 18 }), 'Знав')),
      cmp && cmp.pct >= 75 ? h('div.xs.dim', { style: { textAlign: 'center' } }, 'Схоже на правду — якщо сказали без підказки, тисніть «Знав».') : null);
    };
    const listen = async (btn) => {
      ac = new AbortController();
      btn.disabled = true;
      btn.replaceChildren(ic('microphone', { size: 18, fill: true }), 'Слухаю…');
      btn.classList.add('rec');
      try {
        const res = await recognize({ signal: ac.signal, onInterim: (t) => { heard.textContent = t; } });
        if (!card.isConnected) return;
        if (res?.text) reveal(res.text);
        else { heard.textContent = 'Нічого не почув — спробуйте ще раз або натисніть «Показати».'; btn.disabled = false; btn.classList.remove('rec'); btn.replaceChildren(ic('microphone', { size: 18 }), 'Сказати'); }
      } catch (e) {
        if (!card.isConnected) return;
        heard.textContent = e?.code === 'mic' ? 'Немає доступу до мікрофона — скажіть уголос і натисніть «Показати».' : 'Розпізнавання недоступне — скажіть уголос і натисніть «Показати».';
        btn.remove();
      }
    };
    const mic = canRecognize() ? h('button.btn.soft.ph-mic', { type: 'button', onclick: (e) => listen(e.currentTarget) }, ic('microphone', { size: 18 }), 'Сказати') : null;
    actions.replaceChildren(h('div.ph-acts' + (mic ? '' : '.one'), mic, h('button.btn.primary', { type: 'button', onclick: () => reveal() }, ic('eye', { size: 18 }), 'Показати')), heard);
    box.replaceChildren(head(), card, actions);
    if (!c.uk) speak(c.en);
  };
  const rate = (c, g) => {
    const row = store.get('cards', c.id);
    if (row) srs.grade(row, g);
    if (g === srs.Rating.Again) missed.push(c);
    timer.poke();
    i++; step();
  };
  const done = () => {
    stopSpeech();
    const ok = list.length - missed.length;
    const topic = `Role-play a real-life situation (${sit.id === 'other' ? 'everyday life' : sit.uk}): you play the other person, the student practises these phrases naturally: ${list.map(c => c.en).join(' | ')}`.slice(0, 900);
    fill(box, 
      h('div.hero', ic(ok === list.length ? 'trophy' : 'barbell', { size: 44 }),
        h('h2', `${ok} з ${list.length}`),
        h('p.dim', ok === list.length ? 'Усі фрази знали. Ви готові до цієї ситуації!' : `Ще ${missed.length} ${plural(missed.length, 'фразу', 'фрази', 'фраз')} варто повторити — ${missed.length === 1 ? 'вона повернеться' : 'вони повернуться'} в картки найближчим часом.`)),
      missed.length ? h('section.stack', { style: { gap: '8px' } }, h('div.section-title', 'Повторити'),
        h('div.list', missed.map(c => h('button.list-row', { type: 'button', onclick: () => speak(c.en) },
          ic('speaker-high', { size: 18 }), h('span.grow.ph-text', h('span.ph-en', { lang: 'en' }, c.en), c.uk ? h('span.ph-uk', c.uk) : null))))) : null,
      h('div.stack', { style: { gap: '8px' } },
        missed.length ? h('button.btn.primary.lg.block', { type: 'button', onclick: () => { ac?.abort(); timer.stop(); prepare(view, sit, new Set(missed.map(c => c.id))); } }, ic('arrow-clockwise', { size: 18 }), 'Ще раз — лише невідомі') : null,
        h('a.btn.' + (missed.length ? 'soft' : 'primary') + '.block', { href: `#/tutor?mode=voice&topic=${encodeURIComponent(topic)}` }, ic('microphone', { size: 18 }), 'Відіграти з вчителем'),
        h('a.btn.soft.block', { href: '#/phrases' }, 'До фразника')));
  };
  // прибирання — через onLeave: «Ще раз — лише невідомі» запускає підготовку заново в тому ж контейнері
  onLeave(view, () => { ac?.abort(); stopSpeech(); timer.stop(); });
  step();
}
