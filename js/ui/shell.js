// Спільні дії оболонки: заголовок, режим фокусу, тема
import * as store from '../store.js';
import { ic } from './dom.js';

export function setTitle(t) {
  const el = document.getElementById('page-title');
  if (el) el.textContent = t;
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B1020' : '#F3F5FA');
  const btn = document.querySelector('.btn-theme');
  if (btn) btn.replaceChildren(ic(dark ? 'moon' : 'sun'));
}
