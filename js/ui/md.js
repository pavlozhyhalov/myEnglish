// Мінімальний markdown → DOM. Жодного innerHTML із тексту AI.
import { h } from './dom.js';

/**
 * Інлайн-розмітка з вкладенням: **жирний**, *курсив* (усередині може бути **жирний**), ***обидва***,
 * _курсив_, ~~закреслений~~, `код`. Непарні символи лишаються текстом.
 */
function inline(text) {
  const out = [];
  let buf = '', i = 0;
  const push = (node) => { if (buf) { out.push(buf); buf = ''; } out.push(node); };
  const isWord = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  while (i < text.length) {
    const c = text[i];
    if (c === '`') {
      const j = text.indexOf('`', i + 1);
      if (j > i + 1) { push(h('code', text.slice(i + 1, j))); i = j + 1; continue; }
    } else if (text.startsWith('~~', i)) {
      const j = text.indexOf('~~', i + 2);
      if (j > i + 2) { push(h('del', inline(text.slice(i + 2, j)))); i = j + 2; continue; }
    } else if (text.startsWith('**', i) && !text.startsWith('***', i)) {
      const j = text.indexOf('**', i + 2);
      if (j > i + 2) { push(h('strong', inline(text.slice(i + 2, j)))); i = j + 2; continue; }
    } else if (c === '*' && text[i + 1] && text[i + 1] !== ' ') {
      // курсив: шукаємо одиночну * , пропускаючи вкладені пари **
      let j = i + 1, close = -1;
      while (j < text.length) {
        if (text.startsWith('**', j)) {
          const k = text.indexOf('**', j + 2);
          if (k > -1) { j = k + 2; continue; }
        }
        if (text[j] === '*') { close = j; break; }
        j++;
      }
      if (close > i + 1) { push(h('em', inline(text.slice(i + 1, close)))); i = close + 1; continue; }
    } else if (c === '_' && !isWord(text[i - 1])) {
      const j = text.indexOf('_', i + 1);
      if (j > i + 1 && !isWord(text[j + 1]) && text[i + 1] !== ' ') { push(h('em', inline(text.slice(i + 1, j)))); i = j + 1; continue; }
    }
    buf += c; i++;
  }
  if (buf) out.push(buf);
  return out;
}

/** Лише інлайн-розмітка (для формул і коротких рядків) */
export function mdInline(src) { return inline(String(src || '')); }

export function md(src) {
  const frag = document.createDocumentFragment();
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let list = null, para = [];
  const flushPara = () => { if (para.length) { frag.append(h('p', inline(para.join(' ')))); para = []; } };
  const flushList = () => { if (list) { frag.append(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^\s*#{1,4}\s+(.*)/))) { flushPara(); flushList(); frag.append(h('p', h('strong', inline(m[1])))); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      flushPara();
      if (!list || list.tagName !== 'UL') { flushList(); list = h('ul'); }
      list.append(h('li', inline(m[1]))); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      flushPara();
      if (!list || list.tagName !== 'OL') { flushList(); list = h('ol'); }
      list.append(h('li', inline(m[1]))); continue;
    }
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  return frag;
}
