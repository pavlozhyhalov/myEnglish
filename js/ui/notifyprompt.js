// «Увімкніть сповіщення» там, де вони потрібні найбільше: «Друзі», «Чати», дзвіночок (власник 2026-11-17: «щоб люди бачили сповіщення»).
// Android/комп'ютер — один дотик (дозвіл + підписка); iPhone поза іконкою «Додому» — шторка «як встановити» (без цього iOS сповіщень не дає);
// заборонено — де дозволити саме на цьому пристрої. «Не зараз» — на 7 днів. Якщо Chrome пропонує встановлення — ще й «Встановити застосунок».
import { h, ic } from './dom.js';
import { tx, txRows, txRow } from './tiles.js';
import { sheet } from './sheet.js';
import { toast } from './toast.js';
import { user } from '../supa.js';

const OFF = 'me:notify-off-social';
const isAndroid = () => /Android/i.test(navigator.userAgent);
const snoozed = () => { try { const t = Date.parse(localStorage.getItem(OFF) || ''); return t && Date.now() - t < 7 * 864e5; } catch { return false; } };

export function iosInstallSheet() {
  sheet('Сповіщення на iPhone', h('div.stack.np-sheet',
    h('p.tx-s', 'iPhone показує сповіщення лише застосункам на екрані «Додому». Це займе 20 секунд:'),
    txRows([
      txRow({ no: 1, label: 'Відкрийте сайт у Safari', sub: 'Якщо ви зараз у Chrome чи з месенджера — скопіюйте адресу в Safari', chevron: false }),
      txRow({ no: 2, label: 'Натисніть «Поділитися»', sub: 'Квадрат зі стрілкою вгору внизу екрана', chevron: false }),
      txRow({ no: 3, label: '«На екран "Додому"» → «Додати»', sub: 'Прокрутіть список дій, якщо пункту не видно', chevron: false }),
      txRow({ no: 4, label: 'Відкрийте myEnglish з іконки', sub: 'І натисніть «Увімкнути сповіщення» — iPhone спитає дозвіл', chevron: false }),
    ])));
}
function deniedSheet() {
  sheet('Сповіщення заборонено', h('div.stack.np-sheet', h('p.tx-s', 'Колись ви натиснули «Не дозволяти». Увімкнути знову можна так:'),
    txRows(/iPad|iPhone|iPod/.test(navigator.userAgent)
      ? [txRow({ no: 1, label: 'Налаштування iPhone → Сповіщення', chevron: false }), txRow({ no: 2, label: 'myEnglish → «Дозволити сповіщення»', chevron: false })]
      : isAndroid()
        ? [txRow({ no: 1, label: 'Chrome: ⋮ → Налаштування → Налаштування сайтів', chevron: false }), txRow({ no: 2, label: 'Сповіщення → myEnglish → Дозволити', sub: 'Або: Налаштування телефона → Застосунки → myEnglish (чи Chrome) → Сповіщення', chevron: false })]
        : [txRow({ no: 1, label: 'Значок замка біля адреси сайту', chevron: false }), txRow({ no: 2, label: 'Сповіщення → Дозволити', chevron: false })])));
}

/** Плитка-запрошення (порожній вузол, якщо сповіщення вже працюють або відкладено) */
export function notifyPrompt({ label = 'Увімкніть сповіщення', sub = 'Повідомлення друзів, запити й домашнє — навіть коли застосунок закрито' } = {}) {
  const slot = h('div.np', { hidden: true });
  // застосунок iOS: сповіщення про чати прийдуть через APNs (після ключа Apple); до того картку не показуємо — щоденне нагадування є на головній
  if (!user() || snoozed() || globalThis.Capacitor?.isNativePlatform?.()) return slot;
  import('../push.js').then(async (P) => {
    const st = P.pushSupport();
    if (st === 'unsupported' || st === 'ios-old') return;
    if (st === 'ok' && await P.remindersOn()) return;
    const later = h('button.tx-more.np-later', { type: 'button', onclick: () => { try { localStorage.setItem(OFF, new Date().toISOString()); } catch {} slot.hidden = true; } }, 'Не зараз');
    const tiles = [];
    if (st === 'ok') {
      tiles.push(tx({ wide: true, on: true, icon: 'bell', label, sub, end: h('span.tx-pill.accent', 'Увімкнути'), onclick: async () => {
        try { await P.enable(); toast('Сповіщення ввімкнено — тепер нічого не пропустите'); slot.hidden = true; }
        catch (e) { toast(P.pushErrorText(e), { kind: 'bad', ms: 6000 }); if (P.pushSupport() === 'denied') deniedSheet(); }
      } }));
      // Android: встановлений застосунок — окрема іконка й сповіщення з його іменем
      if (window.__meInstall) tiles.push(tx({ wide: true, icon: 'download-simple', label: 'Встановити застосунок', sub: 'Іконка myEnglish на головному екрані телефона', onclick: async () => {
        const ev = window.__meInstall; window.__meInstall = null;
        try { await ev.prompt(); } catch { /* */ }
      } }));
    } else if (st === 'ios-install') {
      tiles.push(tx({ wide: true, on: true, icon: 'bell', label: 'Сповіщення на iPhone', sub: 'Додайте myEnglish на екран «Додому» — інакше iPhone їх не показує', end: h('span.tx-pill.accent', 'Як'), onclick: iosInstallSheet }));
    } else if (st === 'denied') {
      tiles.push(tx({ wide: true, icon: 'bell', label: 'Сповіщення заборонено', sub: 'Друзі пишуть, а ви не бачите — як дозволити', onclick: deniedSheet }));
    } else return;
    slot.replaceChildren(...tiles, later);
    slot.hidden = false;
  }).catch(() => {});
  return slot;
}
