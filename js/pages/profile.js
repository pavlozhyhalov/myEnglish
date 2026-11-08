// Профіль: дані про учня, за якими AI-вчитель підбирає теми, приклади й звертання.
// Зберігаються в profiles.data.about (синхронізуються між пристроями); на сервері — loadStudent() у _shared/prompts.ts.
import { h, ic, emo } from '../ui/dom.js';
import * as store from '../store.js';
import { user } from '../supa.js';
import { toast } from '../ui/toast.js';
import { confirmSheet } from '../ui/sheet.js';
import { myLevel, LEVEL_NAME } from '../level.js';
import { tx, txGroup, txRow, txRows, txLogin } from '../ui/tiles.js';

export const GOALS = [
  ['people', 'Спілкування з людьми'], ['travel', 'Подорожі'], ['work', 'Робота й кар\'єра'], ['moving', 'Життя за кордоном'],
  ['media', 'Фільми, книжки, інтернет'], ['kids', 'Допомога дітям'], ['exam', 'Іспит'], ['self', 'Саморозвиток'],
];
const PRONOUNS = [['he', 'він (he)'], ['she', 'вона (she)'], ['they', 'не вказувати (they)']];
const LIMITS = { name: 40, address: 40, nativeLang: 40, otherLangs: 120, location: 80, age: 20, occupation: 120, family: 200, interests: 300, avoid: 200, notes: 500 };

export function about() { return store.prof().about || {}; }

// ---------- Пам'ять вчителя: profiles.data.memory = { facts: [{ id, text, at }], updated_at } ----------
// Факти приходять у meta відповіді вчителя; клієнт зливає їх сюди (без дублів, не більше MEM_CAP) — синхронізується разом із профілем.
export const MEM_CAP = 40;
const memNorm = (t) => String(t || '').toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
export function memoryFacts() {
  const f = store.prof().memory?.facts;
  return Array.isArray(f) ? f.filter(x => x && typeof x.text === 'string' && x.text.trim()) : [];
}
// Профіль синхронізується цілим документом (новіший updated_at перемагає), тож пристрій зі старою копією може затерти
// щойно запам'ятоване на іншому. Тому пам'ять зливається: факти — за id (новіший at), видалені — надгробки removed.
// Тінь останньої відомої пам'яті — в localStorage (окремо для кожного акаунта); злиття — при кожній зміні профілю.
const shadowKey = () => `me:mem:${user()?.id || 'local'}`;
const readShadow = () => { try { const j = JSON.parse(localStorage.getItem(shadowKey()) || 'null'); return j && Array.isArray(j.facts) ? j : null; } catch { return null; } };
const writeShadow = (m) => { try { localStorage.setItem(shadowKey(), JSON.stringify({ facts: m?.facts || [], removed: m?.removed || [] })); } catch { /* приватний режим */ } };
const byNewest = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));
function mergeMem(a, b) {
  const removed = [...new Set([...(a?.removed || []), ...(b?.removed || [])])].slice(-200);
  const gone = new Set(removed), byId = new Map();
  for (const f of [...(a?.facts || []), ...(b?.facts || [])]) {
    if (!f?.id || typeof f.text !== 'string' || gone.has(f.id)) continue;
    const c = byId.get(f.id);
    if (!c || String(f.at || '') > String(c.at || '')) byId.set(f.id, f);
  }
  const seen = new Set();
  const facts = [...byId.values()].sort(byNewest).filter(f => { const k = memNorm(f.text); if (seen.has(k)) return false; seen.add(k); return true; });
  return { facts, removed };
}
const memSig = (m) => JSON.stringify([(m?.facts || []).map(f => [f.id, f.text, f.at]).sort(), [...(m?.removed || [])].sort()]);
function saveFacts(facts, forgotten = []) {
  const keep = [...facts].sort(byNewest).slice(0, MEM_CAP);
  const removed = [...new Set([...(store.prof().memory?.removed || []), ...forgotten])].slice(-200);
  const memory = { facts: keep, removed, updated_at: new Date().toISOString() };
  writeShadow(memory);
  store.setProf({ memory });
}
let merging = false;
function reconcileMemory() {
  if (merging) return;
  const cur = store.prof().memory;
  const sh = readShadow();
  if (!sh) { if (cur) writeShadow(cur); return; }
  const m = mergeMem(sh, cur);
  if (memSig(m) === memSig({ facts: (cur?.facts || []), removed: cur?.removed || [] })) { writeShadow(cur); return; }
  merging = true;
  try { saveFacts(m.facts, m.removed); } finally { merging = false; }
}
store.on((t) => { if (t === 'profile') reconcileMemory(); });
reconcileMemory();
/** Злити нові факти (рядки або { text }). Повертає справді нові/оновлені факти — для «Запам'ятав: …» і скасування. */
export function rememberFacts(list) {
  const facts = memoryFacts().map(f => ({ ...f }));
  const added = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, 5)) {
    const text = String(typeof raw === 'string' ? raw : raw?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const k = memNorm(text);
    if (k.length < 3) continue;
    const same = facts.find(f => { const fk = memNorm(f.text); return fk === k || (k.length > 20 && fk.length > 20 && (fk.includes(k) || k.includes(fk))); });
    if (same && memNorm(same.text) === k) continue;              // уже пам'ятає
    const at = new Date().toISOString();
    if (same) { added.push({ id: same.id, text, prev: same.text, prevAt: same.at }); same.text = text; same.at = at; continue; }   // уточнення
    const f = { id: store.uid(), text, at };
    facts.push(f); added.push({ id: f.id, text });
  }
  if (added.length) saveFacts(facts);
  return added;
}
/** Скасувати щойно запам'ятоване: нові факти прибираються, уточнені — повертаються до попереднього тексту */
export function undoRemember(added) {
  const facts = memoryFacts().map(f => ({ ...f }));
  const out = [];
  for (const f of facts) {
    const a = added.find(x => x.id === f.id);
    if (!a) { out.push(f); continue; }
    if (a.prev) out.push({ ...f, text: a.prev, at: new Date().toISOString() });
  }
  saveFacts(out, added.filter(a => !a.prev).map(a => a.id));
}
export function forgetFacts(ids) { const s = new Set(ids); saveFacts(memoryFacts().filter(f => !s.has(f.id)), ids); }

/** Розділ «Що вчитель про вас пам'ятає» */
function memorySection() {
  const box = h('section.tx-group');
  let open = false;
  const draw = () => {
    const facts = memoryFacts();
    const head = h('div.tx-label-row', h('h2.tx-label', `Що вчитель пам'ятає${facts.length ? ` · ${facts.length} з ${MEM_CAP}` : ''}`),
      facts.length ? h('button.tx-more', { type: 'button', onclick: async () => {
        if (!await confirmSheet('Очистити пам\'ять вчителя?', 'Вчитель забуде все, що дізнався про вас із розмов. Дані профілю вище залишаться.', 'Очистити', { danger: true })) return;
        saveFacts([], memoryFacts().map(f => f.id)); toast('Пам\'ять вчителя очищено'); draw();
      } }, 'Очистити все') : null);
    if (!facts.length) {
      box.replaceChildren(head, txRows([txRow({ icon: 'lightbulb', label: 'Поки що нічого', sub: 'Факти з розмов з\'являться тут' })]));
      return;
    }
    const sorted = [...facts].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    box.replaceChildren(head,
      txRows([...sorted.slice(0, open ? MEM_CAP : 6).map(f => h('div.tx-row.mem-row',
        h('span.tx-sq', ic('lightbulb', { size: 18 })),
        h('span.tx-body', h('span.tx-l.mem-t', f.text), f.at ? h('span.tx-s', new Date(f.at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })) : null),
        h('button.icon-btn', { type: 'button', 'aria-label': `Забути: ${f.text}`, onclick: () => { forgetFacts([f.id]); toast('Вчитель це забув'); draw(); } }, ic('trash', { size: 20 })))),
        !open && sorted.length > 6 ? txRow({ icon: 'caret-down', label: `Показати всі · ${sorted.length}`, chevron: false, cls: 'tx-showall', onclick: () => { open = true; draw(); } }) : null]));
  };
  draw();
  return box;
}

/** Як звертатися в привітанні: кличний відмінок, якщо вказано, інакше ім'я */
export function greetName() {
  const a = about();
  return (a.address || a.name || '').trim();
}

export default function profile(view) {
  const a = { goals: [], pronoun: 'they', nativeLang: 'українська', ...about() };
  let timer = null;
  const save = (patch) => {
    Object.assign(a, patch);
    clearTimeout(timer);
    // невелика затримка: не синхронізуємо кожну літеру
    timer = setTimeout(() => { timer = null; store.setProf({ about: { ...a } }); }, 400);
  };

  const field = (key, label, { placeholder = '', textarea = false, hint = '' } = {}) => {
    const el = h(textarea ? 'textarea.input' : 'input.input', {
      value: a[key] || '', placeholder, maxlength: LIMITS[key], 'aria-label': label,
      ...(textarea ? { rows: 3 } : { type: 'text' }),
      oninput: (e) => save({ [key]: e.target.value }),
    });
    if (textarea) el.value = a[key] || '';
    return h('div.field', h('label', label), el, hint ? h('div.xs.dim', hint) : null);
  };

  const pronounSeg = h('div.chips', PRONOUNS.map(([v, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(a.pronoun === v), onclick: (e) => {
    save({ pronoun: v });
    e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
  } }, t)));

  const goals = new Set(a.goals || []);
  const goalChips = h('div.chips', GOALS.map(([v, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(goals.has(v)), onclick: (e) => {
    goals.has(v) ? goals.delete(v) : goals.add(v);
    e.currentTarget.setAttribute('aria-pressed', String(goals.has(v)));
    save({ goals: [...goals] });
  } }, t)));

  const u = user();
  const lvl = myLevel();
  // необов'язкове рідше заповнюють — згорнуто в «Ще про вас»
  const extra = h('div.card.stack.pp-extra', { id: 'pp-extra', hidden: true },
    h('div.grid2.form2', field('nativeLang', 'Рідна мова', { placeholder: 'українська' }), field('otherLangs', 'Інші мови', { placeholder: 'польська — базово' })),
    field('family', 'Сім\'я', { placeholder: 'Наприклад: одружений, плануємо дитину' }),
    field('avoid', 'Теми, яких краще уникати', { placeholder: 'Наприклад: політика' }),
    field('notes', 'Що ще має знати вчитель', { placeholder: 'Наприклад: хочу більше розмовних фраз, менше граматики', textarea: true }));
  const filled = ['otherLangs', 'family', 'avoid', 'notes'].filter(k => String(a[k] || '').trim()).length;
  const extraRow = txRow({ icon: 'plus', label: 'Ще про вас', sub: filled ? `Заповнено: ${filled} з 4 · мови, сім'я, побажання` : 'Мови, сім\'я, побажання вчителю', chevron: false, cls: 'pp-extra-row',
    end: ic('caret-down', { size: 16 }), attrs: { 'aria-expanded': 'false', 'aria-controls': 'pp-extra' },
    onclick: () => { extra.hidden = !extra.hidden; extraRow.setAttribute('aria-expanded', String(!extra.hidden)); } });

  view.replaceChildren(h('div.stack-lg.pp-form',
    tx({ icon: 'user', wide: true, cls: 'pp-head', label: a.name || (u ? (u.email || '').split('@')[0] : 'Гість'),
      sub: `${u ? u.email : 'Локальний режим'} · бачить лише AI-вчитель`,
      end: h('a.tag.accent', { href: '#/settings', title: 'Змінити рівень' }, `${lvl} · ${LEVEL_NAME[lvl]}`) }),
    !u ? txLogin('Потрібен вхід', 'AI-вчитель і синхронізація профілю') : null,

    txGroup('Як до вас звертатися',
      h('div.card.stack',
        field('name', 'Ім\'я латиницею', { placeholder: 'Наприклад: Pavlo' }),
        field('address', 'Звертання в привітанні', { placeholder: 'Наприклад: Павле' }),
        h('div.field', h('label', 'Як учителю говорити про вас'), pronounSeg))),

    txGroup('Про вас',
      h('div.card.stack',
        h('div.grid2.form2', field('age', 'Вік', { placeholder: 'Наприклад: 32' }), field('location', 'Де живете', { placeholder: 'Місто, країна' })),
        field('occupation', 'Чим займаєтесь', { placeholder: 'Професія або навчання' }),
        h('div.field', h('label', 'Навіщо вам англійська'), goalChips),
        field('interests', 'Інтереси й хобі', { placeholder: 'Гори, кіно, готування, футбол…', textarea: true }))),

    h('div.stack', extraRow, extra),

    memorySection()));

  return () => { if (timer) { clearTimeout(timer); store.setProf({ about: { ...a } }); toast('Профіль збережено'); } };
}
