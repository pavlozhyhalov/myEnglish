// #/lab/live — спайк голосу: діагностика і тестова розмова з логом подій
import { h, ic } from '../ui/dom.js';
import { tx, txGroup, txPrimary, txRow, txRows } from '../ui/tiles.js';
import { MODELS, BUILD } from '../config.js';
import * as store from '../store.js';
import { user } from '../supa.js';
import { canRecognize } from '../speech.js';
import { tutor, aiErrorText } from '../ai.js';

export default async function lab(view) {
  const checks = [
    ['Вхід в акаунт', !!user()],
    ['Мікрофон (getUserMedia)', !!navigator.mediaDevices?.getUserMedia],
    ['AudioWorklet', typeof AudioWorkletNode !== 'undefined'],
    ['WebSocket', typeof WebSocket !== 'undefined'],
    ['Розпізнавання мови браузером', canRecognize()],
    ['Озвучення браузером', 'speechSynthesis' in window],
    ['HTTPS', location.protocol === 'https:' || location.hostname === 'localhost'],
  ];
  const usageBox = h('span.tx-s', '…');
  const decision = store.prof().voiceDecision;
  view.replaceChildren(h('div.stack-lg',
    tx({ icon: 'microphone', wide: true, cls: 'lab-head', label: 'Діагностика голосу', sub: `Модель: ${MODELS.live} → ${MODELS.liveFallbacks.join(', ')} · збірка ${BUILD}` }),
    txPrimary({ icon: 'microphone', label: 'Тестова розмова', sub: 'З логом подій', onclick: async () => {
      const { voiceSession } = await import('../live/voice.js');
      voiceSession(view, { debug: true });
    } }),
    txGroup('Перевірка пристрою', txRows(checks.map(([t, ok]) => txRow({ icon: ok ? 'check-circle' : 'x-circle', label: t, pill: { text: ok ? 'так' : 'ні', tone: ok ? 'good' : 'bad' } })))),
    txGroup('Ліміти AI сьогодні', txRows([h('div.tx-row', h('span.tx-sq', ic('chart-pie-slice', { size: 18 })), h('span.tx-body', usageBox))])),
    lastLog(),
    txGroup('Рішення після тесту (§11, Фаза 0)', h('section.card.stack',
      h('div.chips', [['live', 'Gemini Live'], ['ptt', 'Режим «рація»'], ['other', 'Інший провайдер']].map(([v, t]) =>
        h('button.chip', { type: 'button', 'aria-pressed': String(decision === v), onclick: (e) => { store.setProf({ voiceDecision: v }); e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget))); } }, t))),
      h('div.xs.dim', 'Зберігається в профілі; розробник фіксує його в CLAUDE.md.')))));
  if (user()) {
    try {
      const u = await tutor('usage', {});
      usageBox.textContent = `Текстових викликів: ${u.text_calls}/${u.limits.textCalls} · голос: ${Math.round(u.voice_seconds / 60)}/${Math.round(u.limits.voiceSeconds / 60)} хв · TTS: ${u.tts_calls}/${u.limits.ttsCalls}`;
    } catch (e) { usageBox.textContent = aiErrorText(e); }
  } else usageBox.textContent = 'Увійдіть, щоб побачити';
}

/** Лог останньої голосової сесії (зберігається на пристрої) — для пошуку причини збою */
function lastLog() {
  let text = '';
  try { text = localStorage.getItem('me:voice-log') || ''; } catch { /* */ }
  return h('section.tx-group', h('div.tx-label-row', h('h2.tx-label', 'Лог останньої голосової сесії'),
    text ? h('button.tx-more', { type: 'button', onclick: () => { navigator.clipboard?.writeText(text); } }, 'Копіювати') : null),
    text ? h('section.card', h('pre.xs.lab-log', text)) : txRows([txRow({ icon: 'notebook', label: 'Лог порожній', sub: 'Ще не було голосових сесій на цьому пристрої' })]));
}
