// Вхід / реєстрація / відновлення пароля (Supabase Auth, email + пароль)
// Маршрути: #/auth (вкладки «Увійти» · «Зареєструватися»; ?tab=up — одразу реєстрація), #/auth/forgot (лист для зміни пароля),
// #/auth/reset (новий пароль після переходу з листа), для того, хто увійшов, — акаунт і «Змінити пароль».
import { h, ic } from '../ui/dom.js';
import { S } from '../strings.js';
import { signIn, signUp, user, signOut, resetPassword, updatePassword, recoveryPending, clearRecovery } from '../supa.js';
import * as store from '../store.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { setTitle } from '../ui/shell.js';
import { txGroup, txRow, txRows, txPrimary, txResult } from '../ui/tiles.js';

const MIN_LEN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_SEC = 60;
const LAST_EMAIL = 'me:last-email';

/** Зрозумілий текст помилки Supabase Auth */
function errText(err) {
  const m = String(err?.message || err || '');
  if (/invalid login/i.test(m)) return 'Неправильний email або пароль.';
  if (/not confirmed/i.test(m)) return 'Email ще не підтверджено — перевірте пошту.';
  if (/too many signups|database error saving new user/i.test(m)) return 'Сьогодні вже зареєструвалось забагато людей — спробуйте завтра.';
  if (/already registered|already been registered|user already exists/i.test(m)) return 'Такий email уже зареєстровано — увійдіть або відновіть пароль.';
  if (/should be different|same.*password/i.test(m)) return 'Новий пароль має відрізнятися від старого.';
  if (/weak|pwned|leaked|compromised/i.test(m)) return 'Цей пароль занадто простий або вже траплявся у витоках — оберіть інший.';
  if (/password.*(at least|short|characters)/i.test(m)) return `Пароль має містити щонайменше ${MIN_LEN} символів.`;
  if (/rate limit|too many requests|security purposes|only request this after/i.test(m)) return 'Забагато спроб. Зачекайте хвилину й спробуйте ще раз.';
  if (/expired|invalid.*(token|link)|otp/i.test(m)) return 'Посилання застаріло або вже використане. Надішліть лист ще раз.';
  if (/session missing|not authenticated|jwt/i.test(m)) return 'Сесія відновлення завершилась. Надішліть лист ще раз.';
  if (/email_address_invalid|address.*invalid|not authorized|email.*not allowed/i.test(m) || err?.code === 'email_address_invalid') return 'На цю адресу не вдалося надіслати лист. Перевірте email або напишіть власнику застосунку.';
  if (/fetch|network|failed to load/i.test(m)) return 'Немає з\'єднання з сервером. Перевірте інтернет.';
  return `${S.err.generic} (${m})`;
}

/** Поле пароля з кнопкою «показати/сховати» і підказкою про Caps Lock */
function passField({ id, label, autocomplete, placeholder = '' }) {
  const input = h('input.input', { type: 'password', id, autocomplete, required: true, placeholder, autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': `${id}-caps` });
  const eye = h('button.icon-btn.auth-eye', { type: 'button', 'aria-controls': id });
  const caps = h('div.xs.auth-caps', { id: `${id}-caps`, hidden: true }, 'Увімкнено Caps Lock');
  const paint = (shown) => {
    eye.setAttribute('aria-pressed', String(shown));
    eye.setAttribute('aria-label', shown ? 'Сховати пароль' : 'Показати пароль');
    eye.replaceChildren(ic(shown ? 'eye-slash' : 'eye', { size: 20 }));
  };
  eye.addEventListener('click', () => {
    const shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    paint(shown);
    // курсор лишається в полі й у кінці тексту
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* */ }
  });
  const onKey = (e) => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
  input.addEventListener('keydown', onKey);
  input.addEventListener('keyup', onKey);
  input.addEventListener('blur', () => { caps.hidden = true; });
  paint(false);
  const field = h('div.field', h('label', { for: id }, label), h('div.auth-pass', input, eye), caps);
  return { field, input, hide: () => { input.type = 'password'; paint(false); } };
}

/** Оцінка надійності пароля: 0–4 і підказка */
function strength(p) {
  if (!p) return { score: 0, text: '' };
  let s = 0;
  if (p.length >= MIN_LEN) s++;
  if (p.length >= 12) s++;
  if (/[a-zа-яіїєґ]/.test(p) && /[A-ZА-ЯІЇЄҐ]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^\p{L}\p{N}]/u.test(p)) s++;
  if (/^(.)\1+$/.test(p) || /^(12345678|password|qwerty|11111111)/i.test(p)) s = 0;
  const score = p.length < MIN_LEN ? 0 : Math.min(4, s);
  const text = p.length < MIN_LEN ? `Ще ${MIN_LEN - p.length} — мінімум ${MIN_LEN} символів` : ['Слабкий', 'Слабкий', 'Нормальний', 'Добрий', 'Надійний'][score];
  return { score, text };
}
function strengthMeter(input) {
  const bar = h('div.auth-meter', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  const label = h('span.xs.dim', { 'aria-live': 'polite' });
  const box = h('div.auth-strength', { hidden: true }, bar, label);
  const draw = () => {
    const { score, text } = strength(input.value);
    box.hidden = !input.value || box.dataset.off === '1';
    bar.dataset.score = String(score);
    label.textContent = text;
  };
  input.addEventListener('input', draw);
  return box;
}

const emailField = (value = '') => {
  const input = h('input.input', { type: 'email', id: 'email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: 'you@example.com', autocapitalize: 'off', spellcheck: 'false', value });
  return { field: h('div.field', h('label', { for: 'email' }, 'Email'), input), input };
};
const lastEmail = () => { try { return localStorage.getItem(LAST_EMAIL) || ''; } catch { return ''; } };
const saveEmail = (e) => { try { localStorage.setItem(LAST_EMAIL, e); } catch { /* */ } };

/** Кнопка з індикатором виконання */
function busyBtn(label, cls = 'btn.primary.block.lg') {
  const b = h(`button.${cls}`, { type: 'submit' }, label);
  return {
    el: b,
    async run(fn, busyText) {
      if (b.disabled) return;
      b.disabled = true; b.setAttribute('aria-busy', 'true');
      const prev = [...b.childNodes];
      b.replaceChildren(h('span.auth-spin', { 'aria-hidden': 'true' }), busyText || 'Зачекайте…');
      try { await fn(); } finally { if (b.isConnected) { b.replaceChildren(...prev); b.disabled = false; b.removeAttribute('aria-busy'); } }
    },
  };
}
const feedback = (box, kind, text) => box.replaceChildren(text ? h(`div.feedback.${kind}`, { role: kind === 'no' ? 'alert' : 'status' }, text) : '');

/** Шапка екрана — спільна txResult: підпис, заголовок (h1 сторінки, не повторює назву в шапці застосунку), пояснення.
 * title — рядок або готовий вузол h1.auth-h1, sub — рядок або вузол */
function headTile(icon, label, title, sub, tone = '') {
  const t = typeof title === 'string' ? h('h1.auth-h1', title) : title;
  return h('div.auth-head', txResult({ icon, tone: tone || 'accent', label, title: t, sub }));
}

async function afterLogin(text) {
  toast(text);
  clearRecovery();
  await store.sync().catch(() => {});
  go('/', { replace: true });
}

export default function auth(view, r = { parts: [], query: {} }) {
  const sub = r.parts?.[0] || '';
  if (sub === 'reset') return resetView(view);
  if (sub === 'forgot') return forgotView(view, r.query?.email || '');
  const u = user();
  if (u) return accountView(view, u);
  return loginView(view, r.query?.tab === 'up' ? 'up' : 'in');
}

// ---------- Вхід / реєстрація ----------
function loginView(view, initial) {
  setTitle('Вхід');
  let tab = initial;
  const em = emailField(lastEmail());
  const pass = passField({ id: 'pass', label: 'Пароль', autocomplete: 'current-password' });
  const pass2 = passField({ id: 'pass2', label: 'Повторіть пароль', autocomplete: 'new-password' });
  const meter = strengthMeter(pass.input);
  const match = h('div.xs.auth-match', { 'aria-live': 'polite' });
  const msg = h('div');
  const btn = busyBtn('Увійти');
  const forgot = h('a.small.auth-forgot', { href: '#/auth/forgot' }, 'Забули пароль?');
  forgot.addEventListener('click', (e) => { e.preventDefault(); go(`/auth/forgot${em.input.value.trim() ? `?email=${encodeURIComponent(em.input.value.trim())}` : ''}`); });
  const terms = h('p.xs.dim', { style: { margin: 0 } }, `Пароль — щонайменше ${MIN_LEN} символів. Краще — фраза з кількох слів або літери, цифри й знаки.`);

  const checkMatch = () => {
    if (tab !== 'up' || !pass2.input.value) { match.textContent = ''; match.className = 'xs auth-match'; pass2.input.removeAttribute('aria-invalid'); return true; }
    const ok = pass.input.value === pass2.input.value;
    match.textContent = ok ? 'Паролі збігаються' : 'Паролі не збігаються';
    match.className = `xs auth-match ${ok ? 'good' : 'bad'}`;
    if (ok) pass2.input.removeAttribute('aria-invalid'); else pass2.input.setAttribute('aria-invalid', 'true');
    return ok;
  };
  pass.input.addEventListener('input', checkMatch);
  pass2.input.addEventListener('input', checkMatch);

  const tabBtn = (id, label) => h('button', { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': 'auth-form', onclick: () => setTab(id) }, label);
  const tabs = h('div.seg.auth-tabs', { role: 'tablist', 'aria-label': 'Вхід або реєстрація' }, tabBtn('in', 'Увійти'), tabBtn('up', 'Зареєструватися'));
  const heading = h('h1.auth-h1');
  const lead = h('span');

  function setTab(t) {
    tab = t;
    tabs.querySelectorAll('[role=tab]').forEach(b => { const on = b.id === `tab-${t}`; b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on)); b.tabIndex = on ? 0 : -1; });
    form.setAttribute('aria-labelledby', `tab-${t}`);
    const up = t === 'up';
    heading.textContent = up ? 'Новий акаунт — безкоштовно' : 'Раді бачити знову';
    lead.textContent = up ? 'Акаунт потрібен для AI-вчителя й синхронізації між пристроями.' : 'Ваші слова, помилки й розмови — на всіх пристроях.';
    pass.input.autocomplete = up ? 'new-password' : 'current-password';
    pass.input.minLength = up ? MIN_LEN : 1;
    pass2.field.hidden = !up; pass2.input.required = up;
    meter.dataset.off = up ? '' : '1';
    meter.hidden = !up || !pass.input.value;
    terms.hidden = !up; match.hidden = !up;
    forgot.hidden = up;
    btn.el.replaceChildren(up ? 'Створити акаунт' : 'Увійти');
    feedback(msg, '', '');
    pass2.input.value = ''; checkMatch();
    history.replaceState(null, '', `${location.pathname}${location.search}#/auth${up ? '?tab=up' : ''}`);
  }
  // стрілки вліво/вправо між вкладками (як у ARIA tabs)
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tab === 'in' ? 'up' : 'in';
    setTab(next); tabs.querySelector(`#tab-${next}`).focus();
  });

  const form = h('form.stack', { id: 'auth-form', role: 'tabpanel', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    const email = em.input.value.trim().toLowerCase();
    const p1 = pass.input.value;
    if (!EMAIL_RE.test(email)) { feedback(msg, 'no', 'Перевірте email — схоже, в адресі помилка.'); em.input.focus(); return; }
    if (!p1) { feedback(msg, 'no', 'Введіть пароль.'); pass.input.focus(); return; }
    if (tab === 'up') {
      if (p1.length < MIN_LEN) { feedback(msg, 'no', `Пароль має містити щонайменше ${MIN_LEN} символів.`); pass.input.focus(); return; }
      if (!checkMatch() || !pass2.input.value) { feedback(msg, 'no', 'Паролі не збігаються — введіть однаковий пароль двічі.'); pass2.input.focus(); return; }
    }
    feedback(msg, '', '');
    btn.run(async () => {
      try {
        if (tab === 'in') {
          await signIn(email, p1);
          saveEmail(email);
          await afterLogin('Вітаю! Синхронізую дані…');
        } else {
          const res = await signUp(email, p1);
          // email підтверджується автоматично (тригер у БД) — одразу входимо
          if (!res.session) await signIn(email, p1);
          saveEmail(email);
          await afterLogin('Акаунт створено. Ласкаво просимо!');
        }
      } catch (err) {
        feedback(msg, 'no', errText(err));
        if (/already registered|user already exists/i.test(String(err?.message))) setTimeout(() => setTab('in'), 0);
      }
    }, tab === 'in' ? 'Входимо…' : 'Створюємо акаунт…');
  } },
  em.field, pass.field, meter, pass2.field, match,
  h('div.row.between.auth-row', h('span'), forgot),
  terms, btn.el, msg);

  view.replaceChildren(h('div.stack-lg.auth',
    headTile('key', 'myEnglish', heading, lead),
    h('section.card.stack.auth-card', tabs, form),
    txRow({ icon: 'cards', cls: 'auth-note', label: 'Можна й без акаунта', sub: 'Картки, уроки й ігри працюють і без нього — дані зберігаються на цьому пристрої. Після входу вони об\'єднаються з хмарою.' })));
  setTab(tab);
  (em.input.value ? pass.input : em.input).focus({ preventScroll: true });
}

// ---------- Забули пароль ----------
function forgotView(view, presetEmail) {
  setTitle('Відновлення пароля');
  const em = emailField(presetEmail || lastEmail());
  const msg = h('div');
  const btn = busyBtn('Надіслати посилання');
  let left = 0, timer = null;
  const tickBtn = () => {
    if (left <= 0) { clearInterval(timer); timer = null; btn.el.disabled = false; btn.el.replaceChildren('Надіслати ще раз'); return; }
    btn.el.disabled = true; btn.el.replaceChildren(`Надіслати ще раз через ${left} с`); left--;
  };
  const form = h('form.stack', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    const email = em.input.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { feedback(msg, 'no', 'Перевірте email — схоже, в адресі помилка.'); em.input.focus(); return; }
    btn.run(async () => {
      try {
        await resetPassword(email);
        saveEmail(email);
        // не розкриваємо, чи є такий акаунт
        feedback(msg, 'ok', `Якщо акаунт ${email} існує, на нього надіслано лист із посиланням для зміни пароля. Перевірте також «Спам». Посилання діє 1 годину.`);
        left = RESEND_SEC;
      } catch (err) { feedback(msg, 'no', errText(err)); }
    }, 'Надсилаємо…').then(() => { if (left > 0 && !timer) { tickBtn(); timer = setInterval(tickBtn, 1000); } });
  } }, em.field, btn.el, msg);
  view.replaceChildren(h('div.stack-lg.auth',
    headTile('envelope-simple', 'Забули пароль?', 'Надішлемо лист із посиланням', 'Вкажіть email акаунта. Перейдіть за посиланням на цьому пристрої й задайте новий пароль.'),
    h('section.card.stack.auth-card', form),
    txRows([txRow({ icon: 'key', label: 'Згадали пароль? Увійти', href: '#/auth' })])));
  em.input.focus({ preventScroll: true });
  return () => clearInterval(timer);
}

// ---------- Новий пароль (після листа) і зміна пароля в акаунті ----------
function newPasswordForm({ onDone, submitLabel = 'Зберегти пароль' }) {
  const p1 = passField({ id: 'np1', label: 'Новий пароль', autocomplete: 'new-password' });
  const p2 = passField({ id: 'np2', label: 'Повторіть новий пароль', autocomplete: 'new-password' });
  const meter = strengthMeter(p1.input);
  const match = h('div.xs.auth-match', { 'aria-live': 'polite' });
  const msg = h('div');
  const btn = busyBtn(submitLabel);
  const check = () => {
    if (!p2.input.value) { match.textContent = ''; match.className = 'xs auth-match'; return false; }
    const ok = p1.input.value === p2.input.value;
    match.textContent = ok ? 'Паролі збігаються' : 'Паролі не збігаються';
    match.className = `xs auth-match ${ok ? 'good' : 'bad'}`;
    return ok;
  };
  p1.input.addEventListener('input', check); p2.input.addEventListener('input', check);
  // прихований email-рядок допомагає менеджерам паролів зберегти новий пароль до правильного акаунта
  const u = user();
  const form = h('form.stack', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (p1.input.value.length < MIN_LEN) { feedback(msg, 'no', `Пароль має містити щонайменше ${MIN_LEN} символів.`); p1.input.focus(); return; }
    if (!check()) { feedback(msg, 'no', 'Паролі не збігаються — введіть однаковий пароль двічі.'); p2.input.focus(); return; }
    btn.run(async () => {
      try { await updatePassword(p1.input.value); p1.hide(); p2.hide(); await onDone(); }
      catch (err) { feedback(msg, 'no', errText(err)); }
    }, 'Зберігаємо…');
  } },
  u?.email ? h('input', { type: 'email', name: 'username', autocomplete: 'username', value: u.email, hidden: true, readonly: true, tabindex: -1, 'aria-hidden': 'true' }) : null,
  p1.field, meter, p2.field, match, btn.el, msg);
  return { form, focus: () => p1.input.focus({ preventScroll: true }) };
}

function resetView(view) {
  setTitle('Новий пароль');
  const u = user();
  if (!u) {
    // посилання ще обробляється або застаріло
    view.replaceChildren(h('div.stack-lg.auth',
      headTile('warning', 'Відновлення пароля', 'Посилання недійсне',
        recoveryPending() ? 'Не вдалося підтвердити посилання. Можливо, воно застаріло або вже використане.' : 'Відкрийте посилання з листа на цьому пристрої або надішліть новий лист.', 'warn'),
      txPrimary({ icon: 'envelope-simple', label: 'Надіслати лист ще раз', sub: 'Посилання діє 1 годину', href: '#/auth/forgot' }),
      txRows([txRow({ icon: 'key', label: 'До входу', href: '#/auth' })])));
    return;
  }
  const f = newPasswordForm({ onDone: () => afterLogin('Пароль змінено. Ви увійшли.') });
  view.replaceChildren(h('div.stack-lg.auth',
    headTile('key', 'Акаунт', u.email, `Щонайменше ${MIN_LEN} символів — двічі однаково`),
    h('section.card.stack.auth-card', f.form)));
  f.focus();
}

function accountView(view, u) {
  setTitle('Акаунт');
  const pending = store.pendingCount();
  const changeBox = h('div');
  const changeBtn = txRow({ icon: 'key', label: 'Змінити пароль', sub: 'Для всіх пристроїв', onclick: () => {
    changeBtn.hidden = true;
    const f = newPasswordForm({ submitLabel: 'Змінити пароль', onDone: async () => {
      toast('Пароль змінено');
      changeBox.replaceChildren(h('div.feedback.ok', 'Пароль змінено. Використовуйте його для входу на інших пристроях.'));
    } });
    changeBox.replaceChildren(h('section.card.stack.auth-card', h('h2.tx-label', 'Новий пароль'), f.form,
      h('button.btn.ghost.block', { type: 'button', onclick: () => { changeBox.replaceChildren(); changeBtn.hidden = false; } }, S.cancel || 'Скасувати')));
    f.focus();
  } });
  // одна група: стан синхронізації, пароль, вихід («На головну» — у нижній панелі й меню)
  view.replaceChildren(h('div.stack-lg.auth',
    headTile('check-circle', 'Ви увійшли', u.email, null, 'good'),
    txGroup('Акаунт', [txRows([
      txRow({ icon: 'arrow-clockwise', label: pending ? 'Є несинхронізовані зміни' : 'Усе синхронізовано',
        sub: pending ? 'Надішлемо, щойно буде зв\'язок' : 'Дані однакові на всіх пристроях',
        pill: pending ? { text: `${pending}`, tone: 'warn' } : { text: 'OK', tone: 'good' } }),
      changeBtn,
      txRow({ icon: 'sign-out', cls: 'auth-out', label: 'Вийти', sub: 'Дані залишаться в хмарі', chevron: false, onclick: async (e) => {
        e.currentTarget.disabled = true;
        await signOut();
        toast('Ви вийшли з акаунта');
        loginView(view, 'in');
      } })]), changeBox])));
}
