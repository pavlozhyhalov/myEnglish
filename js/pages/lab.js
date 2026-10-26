// #/lab/live — спайк голосу: діагностика і тестова розмова з логом подій
import { h, ic, emo } from '../ui/dom.js';
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
  const usageBox = h('div.small.dim', '…');
  const decision = store.prof().voiceDecision;
  view.replaceChildren(h('div.stack-lg',
    h('section.row', h('div.emoji-circle', emo('mic')), h('div.grow', h('h1', { style: { margin: 0 } }, 'Лабораторія Live'), h('div.small.dim', `Модель: ${MODELS.live} → ${MODELS.liveFallbacks.join(', ')} · збірка ${BUILD}`))),
    h('div.list', checks.map(([t, ok]) => h('div.list-row', h('span.grow', t), h('span.tag.' + (ok ? 'good' : 'bad'), ok ? 'так' : 'ні')))),
    h('section.card.stack', h('div.section-title', 'Ліміти AI сьогодні'), usageBox),
    h('button.btn.primary.lg.block', { type: 'button', onclick: async () => {
      const { voiceSession } = await import('../live/voice.js');
      voiceSession(view, { debug: true });
    } }, ic('microphone', { fill: true }), 'Тестова розмова (з логом)'),
    lastLog(),
    h('section.card.stack', h('div.section-title', 'Рішення після тесту (§11, Фаза 0)'),
      h('div.chips', [['live', 'Gemini Live'], ['ptt', 'Режим «рація»'], ['other', 'Інший провайдер']].map(([v, t]) =>
        h('button.chip', { type: 'button', 'aria-pressed': String(decision === v), onclick: (e) => { store.setProf({ voiceDecision: v }); e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget))); } }, t))),
      h('div.xs.dim', 'Зберігається в профілі; розробник фіксує його в CLAUDE.md.'))));
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
  return h('section.card.stack', h('div.row', h('div.section-title.grow', 'Лог останньої голосової сесії'),
    text ? h('button.btn.sm.soft', { type: 'button', onclick: () => { navigator.clipboard?.writeText(text); } }, ic('copy', { size: 16 }), 'Копіювати') : null),
    text ? h('pre.xs', { style: { whiteSpace: 'pre-wrap', maxHeight: '40dvh', overflow: 'auto', margin: 0 } }, text) : h('div.small.dim', 'Ще не було голосових сесій на цьому пристрої'));
}
