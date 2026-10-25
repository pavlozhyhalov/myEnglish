// Мінімальний markdown → DOM. Жодного innerHTML із тексту AI.
import { h } from './dom.js';

function inline(text) {
  const out = [];
  // **bold**, *italic*, _italic_, `code`
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] != null) out.push(h('strong', m[2]));
    else if (m[3] != null) out.push(h('code', m[3]));
    else out.push(h('em', m[4] ?? m[5]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

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
