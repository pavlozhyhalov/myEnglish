// Налаштування
import { plural } from '../strings.js';
import { h, ic, seg, toggle, clear } from '../ui/dom.js';
import * as store from '../store.js';
import { BUILD, DEFAULTS, LIVE_VOICES } from '../config.js';
import { SECTIONS, byId } from '../nav.js';
import { applyTheme } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { confirmSheet } from '../ui/sheet.js';
import { user } from '../supa.js';
import { speak, englishVoices } from '../speech.js';
import { arrange } from '../ui/quickbar.js';
import { LEVELS, LEVEL_NAME, LEVEL_DESC, myLevel, setLevel } from '../level.js';

const RANGE_LABEL = { dailyGoal: 'Денна мета, хвилин', newPerDay: 'Нових карток на день', rate: 'Швидкість озвучення' };

export default function settings(view) {
  const st = store.settings();
  const set = (k) => (v) => { store.setSetting(k, v); };

  const row = (label, control, sub) => h('div.list-row', h('div.grow', h('div', label), sub ? h('div.sub', sub) : null), control);
  const range = (k, min, max, step, fmt) => {
    const out = h('span.num.small', fmt(st[k]));
    const inp = h('input.range', { type: 'range', min, max, step, value: st[k], 'aria-label': RANGE_LABEL[k] || k, oninput: (e) => { out.textContent = fmt(Number(e.target.value)); }, onchange: (e) => store.setSetting(k, Number(e.target.value)) });
    return h('div.stack', { style: { padding: '8px 14px 14px', gap: '6px' } }, inp, out);
  };
  const select = (k, options, label) => h('select.input', { 'aria-label': label, style: { width: 'auto', minHeight: '40px' }, onchange: (e) => store.setSetting(k, typeof DEFAULTS[k] === 'number' ? Number(e.target.value) : e.target.value) },
    options.map(([v, t]) => h('option', { value: v, selected: String(st[k]) === String(v) ? true : null }, t)));
  const text = (k, label) => h('input.input', { type: 'text', value: st[k], 'aria-label': label, style: { maxWidth: '180px', minHeight: '40px' }, onchange: (e) => store.setSetting(k, e.target.value.trim() || DEFAULTS[k]) });

  view.replaceChildren(h('div.stack-lg',
    group('Рівень англійської', [levelPicker()]),
    group('Вигляд', [
      h('div', { style: { padding: '12px 14px' } }, seg([['auto', 'Авто'], ['light', 'Світла'], ['dark', 'Темна']], st.theme, (v) => { store.setSetting('theme', v); applyTheme(v); })),
      row('Закріпити меню на широкому екрані', toggle(st.pinDrawer !== false, (v) => { store.setSetting('pinDrawer', v); document.body.classList.toggle('drawer-pinned', v); }, 'Закріпити меню'), 'Від 1100 px'),
    ]),
    h('div.section-title', 'Меню швидкого доступу'),
    h('p.xs.dim', { style: { margin: '0 2px' } }, 'Утримуйте рядок і перетягніть, щоб змінити порядок. До 5 пунктів. «Вчитель» завжди посередині.'),
    quickbarEditor(),
    group('Навчання', [
      h('div.list-row', h('div.grow', 'Денна мета')),
      range('dailyGoal', 5, 60, 5, v => `${v} хв на день`),
      h('div.list-row', h('div.grow', 'Нових карток на день')),
      range('newPerDay', 0, 50, 1, v => `${v} ${plural(v, 'картка', 'картки', 'карток')}`),
      row('Не вимикати екран під час завдань', toggle(st.keepAwake !== false, (v) => { store.setSetting('keepAwake', v); }, 'Не вимикати екран'), 'Працює в сучасних браузерах; на iPhone — iOS 16.4+'),
      row('Цільова утримуваність FSRS', select('retention', [[0.85, '85%'], [0.9, '90%'], [0.95, '95%']].map(([v, t]) => [String(v), t]), 'Утримуваність'), 'Вища — частіші повтори'),
    ]),
    group('Озвучення', [
      h('div', { style: { padding: '12px 14px' } }, seg([['US', 'Акцент US'], ['UK', 'Акцент UK']], st.accent, set('accent'))),
      h('div.list-row', h('div.grow', 'Швидкість')),
      range('rate', 0.6, 1.3, 0.05, v => `${Number(v).toFixed(2)}×`),
      row('Рушій озвучення', select('ttsEngine', [['browser', 'Браузер (офлайн)'], ['gemini', 'Gemini TTS (онлайн)']], 'Рушій'), 'Gemini звучить природніше'),
      row('Автоозвучення карток', toggle(st.autoSpeak !== false, set('autoSpeak'), 'Автоозвучення')),
      h('div.list-row', h('div.grow', h('div', 'Перевірити голос'), h('div.sub', `Голосів браузера: ${englishVoices().length}`)),
        h('button.btn.sm.soft', { type: 'button', onclick: () => speak('Hi! This is how I sound. Shall we practise some English today?') }, ic('play', { size: 16, fill: true }), 'Тест')),
    ]),
    group('Вчитель', [
      row("Ім'я вчителя", text('tutorName', "Ім'я")),
      row('Тон', select('tutorTone', [
        ['friendly but demanding', 'Доброзичливий, вимогливий'], ['warm and patient', 'Теплий, терплячий'],
        ['strict and concise', 'Строгий, лаконічний'], ['humorous and relaxed', 'З гумором'],
      ], 'Тон')),
      row('Голос (Gemini Live)', select('voice', LIVE_VOICES.map(v => [v, v]), 'Голос')),
      row('Мова пояснень', select('explainLang', [['uk', 'Українська'], ['en', 'English'], ['mix', 'Змішано']], 'Мова пояснень')),
      row('Строгість виправлень', select('strictness', [['important', 'Лише важливе'], ['all', 'Усе']], 'Строгість')),
      row('Професійний контекст', toggle(!!st.workFocus, set('workFocus'), 'Професійний контекст'), 'Вчитель частіше говоритиме про роботу (виробництво, CNC, якість). За замовчуванням — загальні теми'),
    ]),
    group('Дані', [
      h('div.list-row', h('div.grow', h('div', 'Експорт даних'), h('div.sub', 'JSON з картками, прогресом, розмовами')),
        h('button.btn.sm.soft', { type: 'button', onclick: exportData }, ic('download-simple', { size: 16 }), 'Експорт')),
      h('div.list-row', h('div.grow', h('div', 'Імпорт'), h('div.sub', 'Об\'єднання: зберігається новіша версія')),
        h('label.btn.sm.soft', ic('upload-simple', { size: 16 }), 'Імпорт', h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData }))),
      h('div.list-row', h('div.grow', h('div', 'Акаунт'), h('div.sub', user() ? user().email : 'Не виконано вхід (локальний режим)')),
        h('a.btn.sm.soft', { href: '#/auth' }, user() ? 'Керувати' : 'Увійти')),
      h('div.list-row', h('div.grow', h('div', 'Очистити дані на пристрої'), h('div.sub', 'Хмарна копія не зачіпається')),
        h('button.btn.sm.danger', { type: 'button', onclick: wipe }, 'Очистити')),
    ]),
    h('p.xs.dim.center', `myEnglish · збірка ${BUILD}`, h('br'), h('a', { href: '#/lab/live' }, 'Лабораторія Live (діагностика голосу)'))));
}

/** Вибір рівня: впливає на урок дня, нові слова, диктанти, рекомендовані сценарії й письмо, складність AI */
function levelPicker() {
  const desc = h('div.small');
  const src = h('div.xs.dim');
  const chips = h('div.level-pick');
  const render = () => {
    const cur = myLevel();
    const p = store.prof();
    chips.replaceChildren(...LEVELS.map(l => h('button.chip', { type: 'button', 'aria-pressed': String(l === cur), onclick: () => { setLevel(l, 'manual'); toast(`Рівень ${l}: план і завдання оновлено`); render(); } }, l)));
    desc.replaceChildren(h('b', `${cur} · ${LEVEL_NAME[cur]}. `), LEVEL_DESC[cur]);
    src.textContent = p.levelSource === 'progress' ? 'Підвищено за прогресом' : p.levelSource === 'test' || (p.placementDone === true && p.levelSource !== 'manual') ? 'Визначено тестом' : p.levelSource === 'manual' ? 'Обрано вручну' : 'За замовчуванням — пройдіть тест, щоб уточнити';
  };
  render();
  return h('div.stack', { style: { padding: '12px 14px', gap: '10px' } }, chips, desc,
    h('div.xs.dim', 'Від рівня залежить: урок дня й порядок граматики, з яких колод беруться нові слова, складність диктантів, рекомендовані сценарії й завдання з письма, мова вчителя. Коли опануєте рівень на 80% — застосунок запропонує наступний.'),
    h('div.row', h('div.grow', src), h('a.btn.sm.soft', { href: '#/tests/placement' }, 'Пройти тест')));
}

function group(title, rows) {
  return h('section.stack', { style: { gap: '8px' } }, h('div.section-title', title), h('div.list', rows));
}

// ---------- Редактор нижньої панелі з перетягуванням ----------
function quickbarEditor() {
  const wrap = h('div.list.dnd-list');
  let active = store.settings().quickbar.filter(id => byId[id]);

  function save() {
    store.setSetting('quickbar', active.slice());
  }

  function render() {
    clear(wrap);
    const preview = arrange(active).map(id => byId[id].label).join(' · ');
    for (const id of active) {
      const s = byId[id];
      const r = h('div.dnd-row', { dataset: { id } },
        h('span.handle', { 'aria-hidden': 'true' }, ic('dots-six-vertical')),
        ic(s.icon, { fill: true }), h('span.grow', s.label),
        h('button.icon-btn', { type: 'button', 'aria-label': `Вгору: ${s.label}`, onclick: () => move(id, -1) }, ic('caret-left', { size: 18 })),
        toggle(true, (v) => { if (!v) { if (active.length <= 2) { toast('Мінімум 2 пункти'); render(); return; } active = active.filter(x => x !== id); save(); render(); } }, `Прибрати ${s.label}`));
      r.querySelector('.icon-btn .ico').style.transform = 'rotate(90deg)';
      attachDrag(r, id);
      wrap.append(r);
    }
    for (const s of SECTIONS.filter(s => !active.includes(s.id))) {
      wrap.append(h('div.dnd-row', h('span.handle', { style: { visibility: 'hidden' } }, ic('dots-six-vertical')), ic(s.icon), h('span.grow.dim', s.label),
        toggle(false, (v) => { if (v) { if (active.length >= 5) { toast('Максимум 5 пунктів'); render(); return; } active.push(s.id); save(); render(); } }, `Додати ${s.label}`)));
    }
    wrap.append(h('div.list-row.xs.dim', `Панель: ${preview}`));
  }

  function move(id, d) {
    const i = active.indexOf(id), j = i + d;
    if (j < 0 || j >= active.length) return;
    [active[i], active[j]] = [active[j], active[i]];
    save(); render();
  }

  function attachDrag(r, id) {
    let timer = null, lifted = false, startY = 0, rows = [];
    const down = (e) => {
      if (e.target.closest('button, input, label.switch')) return;
      startY = e.clientY;
      timer = setTimeout(() => {
        lifted = true;
        navigator.vibrate?.(10);
        r.classList.add('lifted'); wrap.classList.add('dragging');
        r.setPointerCapture?.(e.pointerId);
        rows = [...wrap.querySelectorAll('.dnd-row[data-id]')];
      }, 280);
    };
    const moveH = (e) => {
      if (!lifted) { if (Math.abs(e.clientY - startY) > 8) clearTimeout(timer); return; }
      e.preventDefault();
      const dy = e.clientY - startY;
      r.style.transform = `translateY(${dy}px) scale(1.02)`;
      // знайти нову позицію
      const mid = r.getBoundingClientRect().top + r.offsetHeight / 2;
      const others = rows.filter(x => x !== r);
      let idx = others.findIndex(x => mid < x.getBoundingClientRect().top + x.offsetHeight / 2);
      if (idx < 0) idx = others.length;
      const cur = active.indexOf(id);
      if (idx !== cur) {
        active.splice(cur, 1); active.splice(idx, 0, id);
        const ref = others[idx] || null;
        if (ref) wrap.insertBefore(r, ref); else wrap.insertBefore(r, others[others.length - 1].nextSibling);
        startY = e.clientY; r.style.transform = 'scale(1.02)';
        rows = [...wrap.querySelectorAll('.dnd-row[data-id]')];
      }
    };
    const up = () => {
      clearTimeout(timer);
      if (!lifted) return;
      lifted = false;
      r.classList.remove('lifted'); wrap.classList.remove('dragging'); r.style.transform = '';
      save(); render();
    };
    r.addEventListener('pointerdown', down);
    r.addEventListener('pointermove', moveH);
    r.addEventListener('pointerup', up);
    r.addEventListener('pointercancel', up);
    r.addEventListener('contextmenu', e => e.preventDefault());
  }

  render();
  return wrap;
}

// ---------- Експорт / імпорт ----------
function exportData() {
  const blob = new Blob([JSON.stringify(store.exportJson(), null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `myenglish-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importData(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try { await store.importJson(JSON.parse(await f.text())); toast('Імпортовано'); }
  catch (err) { toast('Не вдалося імпортувати: файл пошкоджений або має інший формат', { kind: 'bad' }); }
  e.target.value = '';
}
async function wipe() {
  if (!await confirmSheet('Очистити дані?', 'Усі локальні дані на цьому пристрої буде видалено. Якщо ви увійшли, після синхронізації вони повернуться з хмари. Незбережені зміни буде втрачено.', 'Очистити', { danger: true })) return;
  await store.wipeLocal();
  location.reload();
}

