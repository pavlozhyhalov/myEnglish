// Лексика: теми, мій словник, додавання слів (з AI-автозаповненням), масове додавання
import { h, ic, emo, clear } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { allDecks, deckIndex } from '../data.js';
import { speak } from '../speech.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { sheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { fmtInterval } from '../ui/dom.js';
import { activityTimer } from '../stats.js';
import { onLeave } from '../router.js';

const STATUS = [['all', 'Усі'], ['new', 'Нові'], ['learning', 'Вчу'], ['review', 'Повторюю'], ['learned', 'Вивчені']];
const SORTS = [['recent', 'Нещодавні'], ['az', 'A–Z'], ['due', 'До повтору']];

function statusOf(c) {
  if (!c.reps) return 'new';
  if (c.stability >= 21) return 'learned';
  if (c.state === 1 || c.state === 3) return 'learning';
  return 'review';
}
const STATUS_TAG = { new: ['', 'нове'], learning: ['warn', 'вчу'], review: ['accent', 'повторюю'], learned: ['good', 'вивчено'] };

export default async function vocab(view, r) {
  // перегляд і додавання слів — теж навчання: час рахується (пауза після 2 хв бездіяльності)
  const timer = activityTimer('vocab');
  onLeave(view, () => timer.stop());
  // сторінка (теми, мої слова) — одразу з каталогу; слова вбудованих колод (~0,5 МБ) дозавантажуються
  const idx = await deckIndex();
  const deckName = Object.fromEntries([...idx.map(d => [d.id, d.name]), ['my', 'Мої слова']]);
  let decks = [], loading = true;
  let topic = r.query.topic || 'all', status = 'all', sort = 'recent', q = '', limit = 80, tag = 'all';

  const listBox = h('div');
  const countEl = h('div.xs.dim');
  const search = h('input.input', { type: 'search', placeholder: 'Пошук англійською або українською', 'aria-label': 'Пошук', oninput: (e) => { q = e.target.value.trim().toLowerCase(); limit = 80; draw(); } });

  const chipRow = (opts, get, setv) => {
    const row = h('div.chips.scroll');
    const paint = () => row.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.v === get())));
    for (const [v, t] of opts) row.append(h('button.chip', { type: 'button', dataset: { v }, onclick: () => { setv(v); limit = 80; paint(); draw(); } }, t));
    paint();
    return row;
  };

  function allRows() {
    const map = new Map();
    for (const d of decks) for (const c of d.cards) { const row = srs.rowFromStarter(d.id, c); map.set(row.id, row); }
    for (const c of store.all('cards')) map.set(c.id, c);
    return [...map.values()];
  }

  function draw() {
    let rows = allRows();
    if (topic !== 'all') rows = rows.filter(c => c.deck_id === topic);
    if (status !== 'all') rows = rows.filter(c => statusOf(c) === status);
    if (tag === 'phrasal') rows = rows.filter(c => (c.tags || []).includes('phrasal') || c.extra?.kind === 'phrasal_verb');
    if (tag === 'colloc') rows = rows.filter(c => (c.tags || []).includes('collocation') || c.extra?.kind === 'collocation');
    if (q) rows = rows.filter(c => c.en.toLowerCase().includes(q) || (c.uk || '').toLowerCase().includes(q));
    if (sort === 'az') rows.sort((a, b) => a.en.localeCompare(b.en));
    else if (sort === 'due') rows.sort((a, b) => (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity));
    else rows.sort((a, b) => (b.last_review || b.created_at || '').localeCompare(a.last_review || a.created_at || ''));
    countEl.textContent = loading && topic !== 'my' ? 'Завантаження слів…' : `${rows.length} ${plural(rows.length, 'запис', 'записи', 'записів')}`;
    clear(listBox);
    if (!rows.length && loading && topic !== 'my') { listBox.append(h('div.empty', h('p', 'Завантаження…'))); return; }
    if (!rows.length) { listBox.append(h('div.empty', emo('magnifier', 'xl'), h('p', 'Нічого не знайдено'))); return; }
    listBox.append(h('div.list', rows.slice(0, limit).map(c => {
      const [cls, label] = STATUS_TAG[statusOf(c)];
      return h('button.list-row', { type: 'button', onclick: () => detail(c, deckName, draw) },
        h('div.grow', h('div', h('b', c.en), c.ipa ? h('span.ipa.xs', ` ${c.ipa}`) : null), h('div.sub', c.uk)),
        h('span.tag' + (cls ? '.' + cls : ''), label));
    })));
    if (rows.length > limit) listBox.append(h('button.btn.ghost.block', { type: 'button', onclick: () => { limit += 120; draw(); } }, 'Показати ще'));
  }

  const topics = [['all', 'Усі теми'], ...idx.map(d => [d.id, d.name]), ['my', 'Мої слова']];
  view.replaceChildren(h('div.stack',
    h('div.row', h('button.btn.primary.grow', { type: 'button', onclick: () => addWord(draw) }, ic('plus'), 'Додати слово'),
      h('button.btn.soft.grow', { type: 'button', onclick: () => bulkAdd(draw) }, ic('notebook'), 'Списком')),
    search,
    chipRow(topics, () => topic, v => { topic = v; }),
    chipRow(STATUS, () => status, v => { status = v; }),
    h('div.row.between', chipRow([['all', 'Усе'], ['phrasal', 'Фразові дієслова'], ['colloc', 'Колокації']], () => tag, v => { tag = v; })),
    h('div.row.between', countEl, h('select.input', { 'aria-label': 'Сортування', style: { width: 'auto', minHeight: '36px', padding: '4px 10px' }, onchange: (e) => { sort = e.target.value; draw(); } }, SORTS.map(([v, t]) => h('option', { value: v }, t)))),
    listBox));
  draw();
  allDecks().then(d => { decks = d; }, e => { console.warn('decks', e); toast('Не вдалося завантажити слова колод', { kind: 'bad' }); })
    .finally(() => { loading = false; if (view.isConnected) draw(); });
}

function detail(c, deckName, onChange) {
  const own = c.deck_id === 'my';
  const inStore = !!store.get('cards', c.id);
  const ex = c.examples || [];
  const ext = c.extra || {};
  const s = sheet(null, h('div.stack',
    h('div.row', h('div.grow', h('div', { style: { fontSize: 'var(--fs-xl)', fontWeight: 600 } }, c.en), c.ipa ? h('div.ipa', c.ipa) : null),
      h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(c.en) }, ic('speaker-high'))),
    h('div', { style: { fontSize: 'var(--fs-lg)' } }, c.uk),
    h('div.chips', h('span.tag', deckName[c.deck_id] || c.deck_id), c.pos ? h('span.tag', c.pos) : null, ext.cefr ? h('span.tag.accent', ext.cefr) : null, ...(c.tags || []).map(t => h('span.tag', t))),
    ex.map(e => h('div.example', h('button.icon-btn', { type: 'button', 'aria-label': 'Прослухати приклад', onclick: () => speak(e.en) }, ic('speaker-high', { size: 20 })), h('div.grow', h('div', e.en), e.uk ? h('div.xs.dim', e.uk) : null))),
    ext.collocations?.length ? h('div.small', h('b', 'Колокації: '), ext.collocations.join(', ')) : null,
    ext.synonyms?.length ? h('div.small', h('b', 'Синоніми: '), ext.synonyms.join(', ')) : null,
    c.reps ? h('div.xs.dim', `Повторень: ${c.reps} · помилок: ${c.lapses} · стабільність: ${fmtInterval(c.stability)} · наступний повтор: ${c.due ? new Date(c.due).toLocaleDateString('uk-UA') : '—'}`) : h('div.xs.dim', 'Ще не вивчалось'),
    h('div.row.wrap',
      !inStore ? h('button.btn.soft', { type: 'button', onclick: () => { store.put('cards', c); toast('Додано — з\'явиться першим серед нових'); s.close(); onChange(); } }, ic('plus'), 'Вчити першим') : null,
      h('a.btn.ghost', { href: `#/tutor?ask=${encodeURIComponent(c.en)}`, onclick: () => s.close() }, ic('chat-circle-dots'), 'Запитати вчителя'),
      own ? h('button.btn.soft', { type: 'button', onclick: () => { s.close(); addWord(onChange, c); } }, ic('pencil-simple'), S.edit) : null,
      own ? h('button.btn.danger', { type: 'button', onclick: async () => { if (await confirmSheet('Видалити картку?', c.en, 'Видалити', { danger: true })) { store.remove('cards', c.id); s.close(); onChange(); } } }, ic('trash'), S.delete) : null)));
}

// ---------- Додати / редагувати слово ----------
function addWord(onSaved, existing = null) {
  const f = {
    en: h('input.input', { type: 'text', placeholder: 'word or phrase', value: existing?.en || '', autocapitalize: 'off', 'aria-label': 'Англійською' }),
    uk: h('input.input', { type: 'text', placeholder: 'переклад', value: existing?.uk || '', 'aria-label': 'Переклад' }),
    ipa: h('input.input.ipa', { type: 'text', placeholder: '/ˈwɜːrd/', value: existing?.ipa || '', 'aria-label': 'Транскрипція' }),
    pos: h('input.input', { type: 'text', placeholder: 'noun, verb…', value: existing?.pos || '', 'aria-label': 'Частина мови' }),
    ex1: h('input.input', { type: 'text', placeholder: 'Приклад речення', value: existing?.examples?.[0]?.en || '', 'aria-label': 'Приклад 1' }),
    ex1uk: h('input.input', { type: 'text', placeholder: 'Переклад прикладу', value: existing?.examples?.[0]?.uk || '', 'aria-label': 'Переклад прикладу 1' }),
    ex2: h('input.input', { type: 'text', placeholder: 'Приклад 2', value: existing?.examples?.[1]?.en || '', 'aria-label': 'Приклад 2' }),
    ex2uk: h('input.input', { type: 'text', placeholder: 'Переклад прикладу 2', value: existing?.examples?.[1]?.uk || '', 'aria-label': 'Переклад прикладу 2' }),
    coll: h('input.input', { type: 'text', placeholder: 'колокації через кому', value: (existing?.extra?.collocations || []).join(', '), 'aria-label': 'Колокації' }),
    syn: h('input.input', { type: 'text', placeholder: 'синоніми через кому', value: (existing?.extra?.synonyms || []).join(', '), 'aria-label': 'Синоніми' }),
  };
  let extra = { ...(existing?.extra || {}) };
  let tags = [...(existing?.tags || [])];
  const tagBox = h('div.chips');
  const drawTags = () => tagBox.replaceChildren(...[['phrasal', 'Фразове дієслово'], ['collocation', 'Колокація'], ['work', 'Робота']].map(([v, t]) =>
    h('button.chip', { type: 'button', 'aria-pressed': String(tags.includes(v)), onclick: () => { tags = tags.includes(v) ? tags.filter(x => x !== v) : [...tags, v]; drawTags(); } }, t)));
  drawTags();
  const aiBtn = h('button.btn.soft', { type: 'button', onclick: fill }, ic('sparkle', { fill: true }), 'Заповнити AI');

  async function fill() {
    const en = f.en.value.trim();
    if (!en) { f.en.focus(); return; }
    if (!user()) { toast(S.err.needLogin); return; }
    aiBtn.disabled = true; aiBtn.textContent = 'Заповнюю…';
    try {
      const res = await tutor('fill_word', { words: [en] });
      const w = res.words?.[0];
      if (!w) throw new Error('empty');
      f.en.value = w.en || en; f.uk.value = w.uk || ''; f.ipa.value = w.ipa || ''; f.pos.value = w.pos || '';
      f.ex1.value = w.examples?.[0]?.en || ''; f.ex1uk.value = w.examples?.[0]?.uk || '';
      f.ex2.value = w.examples?.[1]?.en || ''; f.ex2uk.value = w.examples?.[1]?.uk || '';
      f.coll.value = (w.collocations || []).join(', '); f.syn.value = (w.synonyms || []).join(', ');
      extra = { ...extra, cefr: w.cefr, topic: w.topic, kind: w.kind };
      if (w.kind === 'phrasal_verb' && !tags.includes('phrasal')) tags.push('phrasal');
      if (w.kind === 'collocation' && !tags.includes('collocation')) tags.push('collocation');
      drawTags();
    } catch (e) { toast(aiErrorText(e) || 'Не вдалося заповнити', { kind: 'bad' }); }
    finally { aiBtn.disabled = false; aiBtn.replaceChildren(ic('sparkle', { fill: true }), 'Заповнити AI'); }
  }

  async function save() {
    const en = f.en.value.trim();
    if (!en || !f.uk.value.trim()) { toast('Потрібні слово і переклад'); return; }
    const examples = [[f.ex1, f.ex1uk], [f.ex2, f.ex2uk]].filter(([a]) => a.value.trim()).map(([a, b]) => ({ en: a.value.trim(), uk: b.value.trim() }));
    const list = (s) => s.split(',').map(x => x.trim()).filter(Boolean);
    const data = { en, uk: f.uk.value.trim(), ipa: f.ipa.value.trim() || null, pos: f.pos.value.trim() || null, examples, tags, extra: { ...extra, collocations: list(f.coll.value), synonyms: list(f.syn.value) } };
    if (existing) { Object.assign(existing, data); store.put('cards', existing); toast('Збережено'); }
    else {
      // слово вже є у вбудованій колоді — не дублюємо, а ставимо ту картку першою серед нових
      const key = en.toLowerCase();
      const hit = (await allDecks()).flatMap(d => d.cards.map(c => ({ d, c }))).find(x => x.c.en.toLowerCase() === key);
      if (hit && !store.get('cards', srs.starterId(hit.d.id, hit.c.en))) {
        store.put('cards', srs.rowFromStarter(hit.d.id, hit.c));
        toast(`Це слово вже є в колоді «${hit.d.name}» — додано першим серед нових`);
      } else if (hit) toast(`Це слово вже є в колоді «${hit.d.name}»`);
      else {
        const r = srs.addCard(data);
        toast(r.created ? 'Додано в «Мої слова»' : 'Таке слово вже є в картках');
      }
    }
    s.close(); onSaved?.();
  }

  const field = (label, el) => h('div.field', h('label', label), el);
  const s = sheet(existing ? 'Редагувати слово' : 'Нове слово', h('div.stack',
    h('div.row', h('div.grow', f.en), aiBtn),
    field('Переклад', f.uk),
    h('div.grid2', field('IPA', f.ipa), field('Частина мови', f.pos)),
    field('Приклад 1', f.ex1), f.ex1uk, field('Приклад 2', f.ex2), f.ex2uk,
    field('Колокації', f.coll), field('Синоніми', f.syn),
    tagBox,
    h('div.sheet-actions', h('button.btn.primary.block.lg', { type: 'button', onclick: save }, S.save))));
  setTimeout(() => f.en.focus(), 300);
}

// ---------- Масове додавання ----------
function bulkAdd(onSaved) {
  const ta = h('textarea.input', { rows: 8, placeholder: 'По одному слову або фразі в рядку:\nlead time\nto run out of stock\nburr', 'aria-label': 'Список слів' });
  const out = h('div.stack');
  const btn = h('button.btn.primary.block', { type: 'button', onclick: go }, ic('sparkle', { fill: true }), 'Заповнити AI');
  async function go() {
    const words = [...new Set(ta.value.split('\n').map(x => x.trim()).filter(Boolean))].slice(0, 40);
    if (!words.length) return;
    if (!user()) { toast(S.err.needLogin); return; }
    btn.disabled = true; btn.textContent = `Заповнюю ${words.length}…`;
    try {
      const res = await tutor('fill_word', { words });
      review(res.words || []);
    } catch (e) { toast(aiErrorText(e), { kind: 'bad' }); }
    finally { btn.disabled = false; btn.replaceChildren(ic('sparkle', { fill: true }), 'Заповнити AI'); }
  }
  function review(list) {
    const rows = list.map(w => {
      const exists = store.all('cards').some(c => c.en.toLowerCase() === (w.en || '').toLowerCase());
      const chk = h('input.check', { type: 'checkbox', checked: !exists, 'aria-label': w.en });
      const uk = h('input.input', { type: 'text', value: w.uk || '', 'aria-label': `Переклад ${w.en}`, style: { minHeight: '40px', padding: '8px 10px' } });
      return { w, chk, uk, el: h('div.card.tight.stack', { style: { gap: '6px' } },
        h('label.row', chk, h('b.grow', w.en), w.cefr ? h('span.tag.accent', w.cefr) : null, exists ? h('span.tag', 'вже є') : null),
        uk, w.examples?.[0]?.en ? h('div.xs.dim', w.examples[0].en) : null) };
    });
    out.replaceChildren(h('div.section-title', 'Перевірте перед збереженням'), ...rows.map(r => r.el),
      h('button.btn.primary.block.lg', { type: 'button', onclick: () => {
        let n = 0;
        for (const r of rows) {
          if (!r.chk.checked) continue;
          const w = r.w;
          const tags = w.kind === 'phrasal_verb' ? ['phrasal'] : w.kind === 'collocation' ? ['collocation'] : [];
          const res = srs.addCard({ en: w.en, uk: r.uk.value.trim(), ipa: w.ipa, pos: w.pos, examples: w.examples || [], tags, extra: { cefr: w.cefr, topic: w.topic, kind: w.kind, collocations: w.collocations || [], synonyms: w.synonyms || [] } });
          if (res.created) n++;
        }
        toast(`Додано: ${n}`); s.close(); onSaved?.();
      } }, `Зберегти вибрані`));
  }
  const s = sheet('Додати списком', h('div.stack', ta, btn, out));
}
