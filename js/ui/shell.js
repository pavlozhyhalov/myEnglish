// Спільні дії оболонки: заголовок, режим фокусу, тема
import * as store from '../store.js';
import { h, ic } from './dom.js';

export function setTitle(t) {
  const el = document.getElementById('page-title');
  // на головній — логотип «myEnglish» з акцентом на «my»
  if (el) {
    if (t === 'myEnglish') el.replaceChildren(h('span.wordmark', h('b', 'my'), 'English'));
    else el.textContent = t;
  }
  document.title = t && t !== 'myEnglish' ? `${t} · myEnglish` : 'myEnglish';
}

/** Режим фокусу: ховає нижню панель (повтор карток, голосова сесія) */
export function setFocus(on) { document.body.classList.toggle('focus-mode', !!on); }

export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
}

export function applyTheme(theme = store.settings().theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = isDark();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#080D1A' : '#F4F6FB');
  // іконка показує тему, на яку перемкне кнопка
  const btn = document.querySelector('.btn-theme');
  if (btn) btn.replaceChildren(ic(dark ? 'sun' : 'moon'));
}
