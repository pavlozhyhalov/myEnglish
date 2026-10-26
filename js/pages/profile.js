// Профіль: дані про учня, за якими AI-вчитель підбирає теми, приклади й звертання.
// Зберігаються в profiles.data.about (синхронізуються між пристроями); на сервері — loadStudent() у _shared/prompts.ts.
import { h, ic, emo } from '../ui/dom.js';
import * as store from '../store.js';
import { user } from '../supa.js';
import { toast } from '../ui/toast.js';
import { myLevel, LEVEL_NAME } from '../level.js';

export const GOALS = [
  ['people', 'Спілкування з людьми'], ['travel', 'Подорожі'], ['work', 'Робота й кар\'єра'], ['moving', 'Життя за кордоном'],
  ['media', 'Фільми, книжки, інтернет'], ['kids', 'Допомога дітям'], ['exam', 'Іспит'], ['self', 'Саморозвиток'],
];
const PRONOUNS = [['he', 'він (he)'], ['she', 'вона (she)'], ['they', 'не вказувати (they)']];
const LIMITS = { name: 40, address: 40, nativeLang: 40, otherLangs: 120, location: 80, age: 20, occupation: 120, family: 200, interests: 300, avoid: 200, notes: 500 };

export function about() { return store.prof().about || {}; }

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
  view.replaceChildren(h('div.stack-lg',
    h('section.card.row',
      h('div.level-badge', ic('user', { size: 22 })),
      h('div.grow', h('div', { style: { fontWeight: 600 } }, a.name || (u ? (u.email || '').split('@')[0] : 'Гість')),
        h('div.xs.dim', u ? u.email : 'Локальний режим — дані зберігаються на цьому пристрої')),
      h('a.tag.accent', { href: '#/settings', title: 'Змінити рівень' }, `${lvl} · ${LEVEL_NAME[lvl]}`)),
    h('p.small.dim', { style: { margin: '0 2px' } }, 'Ці дані бачить лише AI-вчитель: за ними він обирає теми розмов, приклади й звертання. Усі поля необов\'язкові — заповніть те, що хочете.'),
    !u ? h('div.feedback.no', 'AI-вчитель працює після входу. Дані профілю збережуться й синхронізуються, щойно ви ввійдете.', h('div', { style: { marginTop: '8px' } }, h('a.btn.sm.soft', { href: '#/auth' }, 'Увійти'))) : null,

    h('section.stack', { style: { gap: '8px' } }, h('div.section-title', 'Про вас'),
      h('div.card.stack',
        field('name', 'Ім\'я (для вчителя англійською)', { placeholder: 'Наприклад: Pavlo' }),
        field('address', 'Як звертатися в привітанні', { placeholder: 'Наприклад: Павле', hint: 'Кличний відмінок — для «Доброго ранку, …» на головній' }),
        h('div.field', h('label', 'Як вчителю про вас говорити'), pronounSeg),
        h('div.grid2', field('age', 'Вік', { placeholder: 'Наприклад: 32' }), field('location', 'Де живете', { placeholder: 'Місто, країна' })),
        h('div.grid2', field('nativeLang', 'Рідна мова', { placeholder: 'українська' }), field('otherLangs', 'Інші мови', { placeholder: 'польська — базово' })),
        field('occupation', 'Чим займаєтесь', { placeholder: 'Професія або навчання' }),
        field('family', 'Сім\'я', { placeholder: 'Наприклад: одружений, плануємо дитину' }))),

    h('section.stack', { style: { gap: '8px' } }, h('div.section-title', 'Навчання'),
      h('div.card.stack',
        h('div.field', h('label', 'Навіщо вам англійська'), goalChips),
        field('interests', 'Інтереси й хобі', { placeholder: 'Гори, кіно, готування, футбол…', textarea: true, hint: 'Вчитель використовуватиме їх як теми розмов і приклади' }),
        field('avoid', 'Теми, яких краще уникати', { placeholder: 'Наприклад: політика' }),
        field('notes', 'Що ще має знати вчитель', { placeholder: 'Наприклад: хочу більше розмовних фраз, менше граматики', textarea: true }))),

    h('p.xs.dim.center', 'Зберігається автоматично')));

  return () => { if (timer) { clearTimeout(timer); store.setProf({ about: { ...a } }); toast('Профіль збережено'); } };
}
