// Вхід / реєстрація (Supabase Auth, email + пароль)
import { h, emo } from '../ui/dom.js';
import { S } from '../strings.js';
import { signIn, signUp, user, signOut } from '../supa.js';
import * as store from '../store.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';

export default function auth(view) {
  const u = user();
  if (u) {
    view.replaceChildren(h('div.hero',
      emo('check', 'xl'), h('h1', 'Ви увійшли'), h('p.dim', u.email),
      h('p.small.dim', `Незбережених змін: ${store.pendingCount()}`),
      h('div.row', h('a.btn.soft', { href: '#/' }, 'На головну'), h('button.btn.danger', { type: 'button', onclick: async () => { await signOut(); auth(view); } }, 'Вийти'))));
    return;
  }
  let mode = 'in';
  const email = h('input.input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com', id: 'email' });
  const pass = h('input.input', { type: 'password', autocomplete: 'current-password', required: true, minlength: 6, placeholder: 'Пароль', id: 'pass' });
  const msg = h('div.small');
  const btn = h('button.btn.primary.block.lg', { type: 'submit' }, 'Увійти');
  const switchBtn = h('button.btn.ghost.block', { type: 'button', onclick: () => {
    mode = mode === 'in' ? 'up' : 'in';
    btn.textContent = mode === 'in' ? 'Увійти' : 'Створити акаунт';
    switchBtn.textContent = mode === 'in' ? 'Немає акаунта? Створити' : 'Вже є акаунт? Увійти';
    pass.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
  } }, 'Немає акаунта? Створити');

  const form = h('form.stack', { onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = ''; btn.disabled = true;
    try {
      if (mode === 'in') {
        await signIn(email.value.trim(), pass.value);
        toast('Вітаю! Синхронізую дані…');
        await store.sync().catch(() => {});
        go('/', { replace: true });
      } else {
        const r = await signUp(email.value.trim(), pass.value);
        // email підтверджується автоматично (тригер у БД) — одразу входимо
        if (!r.session) await signIn(email.value.trim(), pass.value);
        toast('Акаунт створено');
        await store.sync().catch(() => {});
        go('/', { replace: true });
      }
    } catch (err) {
      const t = /invalid login/i.test(err.message) ? 'Неправильний email або пароль' : /not confirmed/i.test(err.message) ? 'Email ще не підтверджено — перевірте пошту' : /too many signups|database error saving new user/i.test(err.message) ? 'Сьогодні вже зареєструвалось забагато людей — спробуйте завтра' : /already registered/i.test(err.message) ? 'Такий email уже зареєстровано — увійдіть' : /password/i.test(err.message) ? 'Пароль має містити щонайменше 6 символів' : `${S.err.generic} (${err.message})`;
      msg.replaceChildren(h('div.feedback.no', t));
    } finally { btn.disabled = false; }
  } },
  h('div.field', h('label', { for: 'email' }, 'Email'), email),
  h('div.field', h('label', { for: 'pass' }, 'Пароль'), pass),
  btn, msg, switchBtn);

  view.replaceChildren(h('div.stack-lg',
    h('div.hero', emo('key', 'xl'), h('h1', 'Вхід у myEnglish'), h('p.dim.small', 'Акаунт потрібен для AI-вчителя і синхронізації між пристроями. Картки й уроки працюють і без нього — дані зберігаються на цьому пристрої.')),
    h('section.card', form)));
}
