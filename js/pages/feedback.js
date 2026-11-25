// #/feedback — «Написати розробнику» (власник 2026-11-17): помилка · ідея · інше, текст, скріншот (за бажанням) → таблиця feedback (міграція 0036),
// адміністратор отримує push і бачить звернення на #/admin, відповідь приходить людині push-ем, у дзвіночок і сюди («Мої звернення»).
// Разом зі зверненням ідуть сторінка, з якої прийшли, версія застосунку й браузер — щоб відтворити помилку.
import { h, ic, seg } from '../ui/dom.js';
import { user, getSupa } from '../supa.js';
import { toast } from '../ui/toast.js';
import { txGroup, txRow, txRows, txLogin, txPill } from '../ui/tiles.js';
import { BUILD } from '../config.js';
import { loc } from '../i18n.js';

const KINDS = [['bug', 'Помилка'], ['idea', 'Ідея'], ['other', 'Інше']];
const PH = { bug: 'Що сталося й де? Наприклад: «У чаті не надсилається голосове — крутиться й зникає»', idea: 'Що додати чи змінити, щоб було зручніше?', other: 'Напишіть що завгодно — прочитаю особисто' };
const LAST = 'me:last-route';
const when = (iso) => new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'long' });


/** Зменшити знімок до 1440 px і стиснути в JPEG (≈ 150–400 КБ) */
async function shrink(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file.size < 3_000_000 ? file : null;
  const k = Math.min(1, 1440 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.82));
}

export default function feedback(view) {
  if (!user()) { view.replaceChildren(h('div.stack-lg', txLogin('Написати розробнику — після входу'))); return; }
  let kind = 'bug', file = null, busy = false, alive = true;
  const ta = h('textarea.input.fb-text', { rows: 6, maxlength: 2000, placeholder: PH.bug, 'aria-label': 'Текст звернення' });
  const shotInp = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const shotBox = h('div.fb-shot');
  const paintShot = () => shotBox.replaceChildren(file
    ? h('div.fb-shot-on', h('img', { src: URL.createObjectURL(file), alt: 'Скріншот' }), h('button.icon-btn', { type: 'button', 'aria-label': 'Прибрати скріншот', onclick: () => { file = null; paintShot(); } }, ic('x', { size: 18 })))
    : h('button.btn.soft.fb-shot-btn', { type: 'button', onclick: () => shotInp.click() }, ic('upload-simple', { size: 16 }), 'Додати скріншот'));
  shotInp.addEventListener('change', async () => {
    const f = shotInp.files?.[0]; shotInp.value = '';
    if (!f) return;
    file = await shrink(f);
    if (!file) toast('Не вдалося відкрити зображення', { kind: 'bad' });
    paintShot();
  });
  paintShot();
  const kinds = seg(KINDS, kind, (v) => { kind = v; ta.placeholder = PH[v]; });
  const send = h('button.btn.primary.fb-send', { type: 'button', onclick: submit }, ic('paper-plane-right', { size: 18, fill: true }), 'Надіслати');
  const mine = h('div');

  async function submit() {
    const body = ta.value.trim();
    if (body.length < 3) { ta.focus(); toast('Напишіть хоч кілька слів'); return; }
    if (busy) return;
    busy = true; send.disabled = true;
    try {
      const c = await getSupa();
      const uid = user().id;
      let image_path = null;
      if (file) {
        const path = `${uid}/${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}.jpg`;
        const { error } = await c.storage.from('feedback').upload(path, file, { contentType: 'image/jpeg', upsert: false });
        if (!error) image_path = path;
      }
      let route = ''; try { route = sessionStorage.getItem(LAST) || ''; } catch { /* */ }
      const { error } = await c.from('feedback').insert({ user_id: uid, kind, body, route, build: BUILD, ua: navigator.userAgent, image_path });
      if (error) throw error;
      ta.value = ''; file = null; paintShot();
      toast('Дякую! Звернення надіслано — відповідь прийде сюди й у дзвіночок');
      loadMine();
    } catch (e) {
      toast(String(e?.message || '').includes('rate_limited') ? 'Сьогодні вже 10 звернень — напишіть завтра' : navigator.onLine ? 'Не вдалося надіслати. Спробуйте ще раз.' : 'Немає мережі', { kind: 'bad' });
    }
    busy = false; send.disabled = false;
  }

  async function loadMine() {
    try {
      const c = await getSupa();
      const { data } = await c.from('feedback').select('id, kind, body, status, reply, replied_at, created_at').order('created_at', { ascending: false }).limit(20);
      if (!alive) return;
      const rows = data || [];
      mine.replaceChildren(rows.length ? txGroup(`Мої звернення · ${rows.length}`, txRows(rows.map(f => {
        const pill = f.reply ? { text: 'Відповідь', tone: 'accent' } : f.status === 'done' ? { text: 'Зроблено', tone: 'good' } : f.status === 'seen' ? { text: 'Переглянуто', tone: '' } : { text: 'Надіслано', tone: '' };
        return h('div.tx-row.fb-row' + (f.reply ? '.on' : ''),
          h('span.tx-body',
            h('span.tx-s', `${KINDS.find(k => k[0] === f.kind)?.[1] || ''} · ${when(f.created_at)}`),
            h('span.fb-body', f.body),
            f.reply ? h('span.fb-reply', h('b', 'Розробник: '), f.reply) : null),
          txPill(pill.text, pill.tone));
      }))) : '');
      // відповіді прочитано — знімає цифру в дзвіночку
      if (rows.some(f => f.reply)) c.rpc('feedback_seen').then(() => import('../ui/inbox.js').then(m => m.refreshInbox())).catch(() => {});
    } catch { /* офлайн */ }
  }

  view.replaceChildren(h('div.stack-lg.fb',
    h('section.stack.fb-form',
      h('div.tx-s', 'Помилка, незручність чи ідея — напишіть, я прочитаю й відповім.'),
      kinds, ta, shotBox, shotInp, send),
    mine,
    txRows([txRow({ icon: 'info', label: 'Що надсилається', sub: 'Текст, скріншот, сторінка й версія застосунку · лише розробнику', chevron: false })])));
  loadMine();
  setTimeout(() => ta.focus(), 300);
  return () => { alive = false; };
}
