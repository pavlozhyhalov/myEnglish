// Налаштування
import { plural } from '../strings.js';
import { h, ic, seg, toggle, clear } from '../ui/dom.js';
import * as store from '../store.js';
import { BUILD, DEFAULTS, LIVE_VOICES } from '../config.js';
import { SECTIONS, byId } from '../nav.js';
import { applyTheme } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { confirmSheet, sheet } from '../ui/sheet.js';
import { user } from '../supa.js';
import { speak, englishVoices } from '../speech.js';
import { arrange } from '../ui/quickbar.js';
import { LEVELS, LEVEL_NAME, LEVEL_DESC, myLevel, setLevel } from '../level.js';
import { txGroup, txRow, txRows } from '../ui/tiles.js';
import { pushSupport, reminderPrefs, setReminderPrefs, remindersOn, enable as enablePush, disable as disablePush, syncPrefs, pushErrorText } from '../push.js';

const RANGE_LABEL = { dailyGoal: 'Денна мета, хвилин', newPerDay: 'Нових карток на день', rate: 'Швидкість озвучення' };

export default function settings(view) {
  const st = store.settings();
  const set = (k) => (v) => { store.setSetting(k, v); };

  const row = setRow;
  const range = (k, min, max, step, fmt, icon, label) => {
    const out = h('span.tx-pill.accent.num', fmt(st[k]));
    // --fill — заповнена частина доріжки (css/tiles.css, преміальний повзунок)
    const fill = (v) => inp.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    const inp = h('input.range', { type: 'range', min, max, step, value: st[k], 'aria-label': RANGE_LABEL[k] || k, oninput: (e) => { out.textContent = fmt(Number(e.target.value)); fill(Number(e.target.value)); }, onchange: (e) => store.setSetting(k, Number(e.target.value)) });
    fill(Number(st[k]));
    return block(icon, label, inp, null, out);
  };
  // замість системних списків: сегменти (2–3 варіанти) або шторка з вибором (більше варіантів)
  const segOf = (k, options) => seg(options, String(st[k]), (v) => store.setSetting(k, typeof DEFAULTS[k] === 'number' ? Number(v) : v));
  const pick = (k, options, label) => pickerBtn(label, options, String(st[k]), (v) => store.setSetting(k, typeof DEFAULTS[k] === 'number' ? Number(v) : v));
  const text = (k, label) => h('input.input', { type: 'text', value: st[k], 'aria-label': label, style: { maxWidth: '180px', minHeight: '40px' }, onchange: (e) => store.setSetting(k, e.target.value.trim() || DEFAULTS[k]) });

  // Основне — 4 групи (навчання, вчитель, вигляд і звук, нагадування); рідкісне — у згорнутому «Ще»
  const more = h('div.stack-lg.set-more', { id: 'set-more', hidden: true },
    group('Автоматика', [
      row('seal-check', 'Вжиті слова — вивчені', toggle(st.autoKnown !== false, set('autoKnown'), 'Вжиті слова — вивчені'), 'Правильно вжите у 2 розмовах — вивчене'),
      row('plus', 'Слова з розмов у картки', toggle(st.autoWords !== false, set('autoWords'), 'Автоматично додавати слова з розмов'), 'До 5 після підсумку, ≤ 10 на день'),
      block('brain', 'Утримуваність FSRS', segOf('retention', [['0.85', '85%'], ['0.9', '90%'], ['0.95', '95%']]), 'Вища — частіші повтори'),
      row('sun', 'Не вимикати екран', toggle(st.keepAwake !== false, (v) => { store.setSetting('keepAwake', v); }, 'Не вимикати екран'), 'Під час завдань'),
    ]),
    group('Озвучення й вчитель', [
      block('waveform', 'Рушій озвучення', segOf('ttsEngine', [['browser', 'Браузер · офлайн'], ['gemini', 'Gemini · онлайн']]), 'Gemini звучить природніше'),
      row('play', 'Перевірити голос',
        h('button.btn.sm.soft', { type: 'button', onclick: () => speak('Hi! This is how I sound. Shall we practise some English today?') }, ic('play', { size: 16, fill: true }), 'Тест'), `Голосів браузера: ${englishVoices().length}`),
      row('chalkboard-teacher', "Ім'я вчителя", text('tutorName', "Ім'я")),
      row('list', 'Закріпити меню', toggle(st.pinDrawer !== false, (v) => { store.setSetting('pinDrawer', v); document.body.classList.toggle('drawer-pinned', v); }, 'Закріпити меню'), 'На екрані від 1100 px'),
    ]),
    txGroup('Нижня панель', quickbarEditor()),
    group('Дані', [
      row('user', 'Акаунт', h('a.btn.sm.soft', { href: '#/auth' }, user() ? 'Керувати' : 'Увійти'), user() ? user().email : 'Локальний режим'),
      row('download-simple', 'Експорт',
        h('button.btn.sm.soft', { type: 'button', onclick: exportData }, ic('download-simple', { size: 16 }), 'Експорт'), 'JSON: картки, прогрес, розмови'),
      row('upload-simple', 'Імпорт',
        h('label.btn.sm.soft', ic('upload-simple', { size: 16 }), 'Імпорт', h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData })), 'Зберігається новіша версія'),
      row('trash', 'Очистити дані на пристрої', h('button.btn.sm.danger', { type: 'button', onclick: wipe }, 'Очистити'), 'Хмарна копія не зачіпається', 'bad'),
    ]),
    txGroup('Службове', [
      txRows([txRow({ icon: 'flask', label: 'Лабораторія Live', sub: 'Діагностика голосу', href: '#/lab/live' })]),
      h('p.xs.dim.center.set-build', `myEnglish · збірка ${BUILD}`)]));
  const moreRow = txRow({ icon: 'gear-six', label: 'Ще', sub: 'Автоматика, панель, озвучення, дані', chevron: false, cls: 'set-more-row',
    end: ic('caret-down', { size: 16 }), attrs: { 'aria-expanded': 'false', 'aria-controls': 'set-more' },
    onclick: () => { more.hidden = !more.hidden; moreRow.setAttribute('aria-expanded', String(!more.hidden)); } });

  // «Адміністрування» — першим рядком, лише для адміністратора (порожній слот для всіх інших)
  const adminSlot = ((slot) => { if (user()) import('./admin.js').then(m => m.adminLink(slot)).catch(() => {}); return slot; })(h('div.tx-rows.set-admin'));
  view.replaceChildren(h('div.stack-lg.pp-set',
    adminSlot,
    group('Навчання', [
      levelPicker(),
      range('dailyGoal', 5, 60, 5, v => `${v} хв на день`, 'target', 'Денна мета'),
      range('newPerDay', 0, 50, 1, v => `${v} ${plural(v, 'картка', 'картки', 'карток')}`, 'cards', 'Нових карток на день'),
    ]),
    group('Вчитель', [
      row('chat-circle-dots', 'Тон', pick('tutorTone', [
        ['friendly but demanding', 'Доброзичливий, вимогливий', 'Вимогливий'], ['warm and patient', 'Теплий, терплячий', 'Терплячий'],
        ['strict and concise', 'Строгий, лаконічний', 'Строгий'], ['humorous and relaxed', 'З гумором', 'З гумором'],
      ], 'Тон вчителя')),
      block('translate', 'Мова пояснень', segOf('explainLang', [['uk', 'Українська'], ['en', 'English'], ['mix', 'Змішано']])),
      block('check-circle', 'Виправлення', segOf('strictness', [['important', 'Лише важливе'], ['all', 'Усе']])),
      row('microphone', 'Голос вчителя', pick('voice', LIVE_VOICES.map(v => [v, v]), 'Голос вчителя'), 'Gemini Live'),
      block('hourglass', 'Пауза в голосі', segOf('voicePause', [['short', 'Коротка'], ['normal', 'Звичайна'], ['long', 'Довга']]), 'Перебиває — оберіть «Довга»'),
      row('briefcase', 'Професійний контекст', toggle(!!st.workFocus, set('workFocus'), 'Професійний контекст'), 'Розмови про вашу роботу'),
    ]),
    group('Вигляд і звук', [
      block('circle-half', 'Тема', (() => { const sg = seg([['auto', 'Авто'], ['light', 'Світла'], ['dark', 'Темна']], st.theme, (v) => { store.setSetting('theme', v); applyTheme(v); }); sg.classList.add('set-theme-seg'); return sg; })()),
      block('flag', 'Акцент', seg([['US', 'Акцент US'], ['UK', 'Акцент UK']], st.accent, set('accent'))),
      range('rate', 0.6, 1.3, 0.05, v => `${Number(v).toFixed(2)}×`, 'timer', 'Швидкість озвучення'),
      row('speaker-high', 'Автоозвучення карток', toggle(st.autoSpeak !== false, set('autoSpeak'), 'Автоозвучення')),
    ]),
    remindersGroup(),
    h('div.stack', moreRow, more)));
}

// ---------- Нагадування (Web Push) ----------
function remindersGroup() {
  const list = h('div.list');
  const sec = h('section.tx-group', h('h2.tx-label', 'Нагадування'), list);
  let on = false, busy = false;

  const row = setRow;
  const kindToggle = (icon, k, label, sub) => row(icon, label, toggle(reminderPrefs()[k], (v) => { setReminderPrefs({ [k]: v }); pushPrefs(); }, label), sub);
  const pushPrefs = () => syncPrefs().catch(e => toast(pushErrorText(e), { kind: 'bad' }));

  async function flip(v) {
    if (busy) return;
    busy = true;
    try {
      if (v) { await enablePush(); toast(`Нагадування ввімкнено · ${reminderPrefs().time}`); }
      else { await disablePush(); toast('Нагадування на цьому пристрої вимкнено'); }
    } catch (e) {
      console.warn('push', e);
      toast(pushErrorText(e), { kind: 'bad', ms: 5000 });
    }
    busy = false;
    render();
  }

  async function render() {
    const st = pushSupport();
    on = await remindersOn();
    const p = reminderPrefs();
    const time = h('input.input', {
      type: 'time', value: p.time, step: 900, 'aria-label': 'Час нагадування', style: { width: 'auto', minHeight: '40px' },
      onchange: (e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) { setReminderPrefs({ time: e.target.value }); pushPrefs(); } },
    });
    const master = toggle(on, flip, 'Нагадування на цьому пристрої');
    const canToggle = st === 'ok' && !!user();
    if (!canToggle && !on) master.querySelector('input').disabled = true;
    const status = on ? `Щодня о ${p.time}, якщо є про що нагадати`
      : st === 'ok' ? (user() ? 'Вимкнено' : 'Після входу в акаунт') : pushErrorText({ code: st });
    // час і види — лише коли нагадування ввімкнені
    const rows = [
      row('bell', 'Нагадування на цьому пристрої', master, status),
      on ? row('clock', 'Час', time, 'Місцевий час') : null,
      on ? kindToggle('cards', 'cards', 'Повторити картки', 'Якщо пора повторити') : null,
      on ? kindToggle('fire', 'streak', 'Стрік під загрозою', 'Якщо сьогодні < 5 хв') : null,
    ].filter(Boolean);
    const notes = [];
    if (st === 'ios-install') {
      notes.push(h('div.notice', h('b', 'Як увімкнути нагадування на iPhone чи iPad'),
        h('ol', { style: { margin: '6px 0 0', paddingLeft: '20px' } },
          h('li', 'Відкрийте myEnglish у Safari.'),
          h('li', 'Натисніть «Поділитися» (квадрат зі стрілкою вгору).'),
          h('li', 'Оберіть «На початковий екран» і натисніть «Додати».'),
          h('li', 'Запустіть myEnglish з іконки на екрані «Додому» й увімкніть нагадування тут.')),
        h('div.xs.dim', { style: { marginTop: '6px' } }, 'Потрібна iOS 16.4 або новіша. У звичайній вкладці Safari push-сповіщення недоступні.')));
    }
    list.replaceChildren(...rows);
    sec.replaceChildren(sec.firstChild, list, ...notes);
  }

  render();
  return sec;
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
    src.textContent = p.levelSource === 'conversation' ? 'Підвищено за розмовами' : p.levelSource === 'progress' ? 'Підвищено за прогресом' : p.levelSource === 'test' || (p.placementDone === true && p.levelSource !== 'manual') ? 'Визначено тестом' : p.levelSource === 'manual' ? 'Обрано вручну' : 'Тест уточнить рівень';
  };
  render();
  return h('div.list-row.set-row.set-block.set-level', chips, desc,
    h('div.row', h('div.grow', src), h('a.btn.sm.soft', { href: '#/tests/placement' }, 'Пройти тест')));
}

function group(title, rows) {
  return txGroup(title, h('div.list.set-list', rows));
}

/** Рядок-плитка налаштування: іконка в квадратику, назва з підказкою, елемент керування праворуч */
function setRow(icon, label, control, sub, tone = '') {
  return h('div.list-row.set-row' + (tone ? '.' + tone : ''), h('span.tx-sq', ic(icon, { size: 18 })),
    h('div.set-body', h('div.set-l', label), sub ? h('div.sub', sub) : null), h('div.set-ctl', control));
}
/** Плитка з елементом на всю ширину під назвою (сегменти, повзунки); end — значення праворуч від назви */
function block(icon, label, content, sub = null, end = null) {
  return h('div.list-row.set-row.set-block', h('div.set-top', h('span.tx-sq', ic(icon, { size: 18 })),
    h('div.set-body', h('div.set-l', label), sub ? h('div.sub', sub) : null), end), content);
}

// ---------- Редактор нижньої панелі з перетягуванням ----------
function quickbarEditor() {
  const wrap = h('div.list.dnd-list');
  let active = (store.settings().quickbar.join() === 'home,cards,tutor,grammar,progress' ? DEFAULTS.quickbar : store.settings().quickbar).filter(id => byId[id]);

  function save() {
    store.setSetting('quickbar', active.slice());
  }

  function render() {
    clear(wrap);
    const preview = arrange(active).map(id => byId[id].label).join(' · ');
    // підказка зверху: що зараз у панелі й як змінити порядок («Вчитель» — завжди посередині)
    wrap.append(h('div.list-row.xs.dim', `${preview} · до 5, утримуйте рядок, щоб перетягнути`));
    for (const id of active) {
      const s = byId[id];
      const r = h('div.dnd-row', { dataset: { id } },
        h('span.handle', { 'aria-hidden': 'true' }, ic('dots-six-vertical')),
        ic(s.icon), h('span.grow', s.label),
        h('button.icon-btn', { type: 'button', 'aria-label': `Вгору: ${s.label}`, onclick: () => move(id, -1), style: active.indexOf(id) === 0 ? { visibility: 'hidden' } : null }, ic('caret-left', { size: 18 })),
        toggle(true, (v) => { if (!v) { if (active.length <= 2) { toast('Мінімум 2 пункти'); render(); return; } active = active.filter(x => x !== id); save(); render(); } }, `Прибрати ${s.label}`));
      r.querySelector('.icon-btn .ico').style.transform = 'rotate(90deg)';
      attachDrag(r, id);
      wrap.append(r);
    }
    for (const s of SECTIONS.filter(s => !active.includes(s.id))) {
      wrap.append(h('div.dnd-row', h('span.handle', { style: { visibility: 'hidden' } }, ic('dots-six-vertical')), ic(s.icon), h('span.grow.dim', s.label),
        toggle(false, (v) => { if (v) { if (active.length >= 5) { toast('Максимум 5 пунктів'); render(); return; } active.push(s.id); save(); render(); } }, `Додати ${s.label}`)));
    }
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


/** Кнопка-вибір: поточне значення таблеткою зі стрілкою → шторка зі списком варіантів (замість системного select) */
function pickerBtn(title, options, value, onChange) {
  let cur = value;
  // третій елемент варіанта — коротка назва для кнопки (повна — у шторці)
  const lbl = () => { const o = options.find(([v]) => String(v) === String(cur)) || options[0]; return o[2] || o[1]; };
  const txt = h('span.set-pick-v', lbl());
  const btn = h('button.set-pick', { type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `${title}: ${lbl()}` }, txt, ic('caret-down', { size: 14 }));
  btn.onclick = () => {
    const s = sheet(title, h('div.tx-rows.set-pick-list', { role: 'radiogroup', 'aria-label': title }, options.map(([v, t, short]) => {
      const on = String(v) === String(cur);
      return h('button.tx-row.set-pick-opt' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on),
        onclick: () => { cur = String(v); txt.textContent = short || t; btn.setAttribute('aria-label', `${title}: ${t}`); onChange(String(v)); s.close(); } },
        h('span.tx-body', h('span.tx-l', t)), on ? ic('check', { size: 18 }) : null);
    })));
  };
  return btn;
}
