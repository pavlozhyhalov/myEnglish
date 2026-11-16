// Аудіосесія iPhone (власник 2026-11-16: «кнопками гучність знижуємо до нуля, а все одно голосно»).
// Після getUserMedia Safari лишає сторінку в режимі «запис і відтворення» (як дзвінок): звук іде повз гучність медіа,
// і кнопки гучності на нього не діють. Тому: перед мікрофоном — 'play-and-record', щойно мікрофон вимкнено — 'playback'
// (звичайна гучність медіа, як у музики й відео). navigator.audioSession — Safari 16.4+; деінде нічого не робить.
const streams = new Set();

/** Зареєструвати потік мікрофона (щоб знати, чи він ще живий) */
export function trackMic(stream) { if (stream) streams.add(stream); return stream; }

/** Чи зараз відкритий мікрофон */
export function micLive() {
  for (const s of streams) {
    if (s.getTracks().some(t => t.readyState === 'live')) return true;
    streams.delete(s);
  }
  return false;
}

const set = (type) => { try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch { /* немає підтримки */ } };
/** Перед getUserMedia */
export const sessionRecord = () => set('play-and-record');
/** Перед відтворенням і після мікрофона: звичайна гучність медіа (лише якщо мікрофон уже не потрібен) */
export const sessionPlayback = () => { if (!micLive()) set('playback'); };

// будь-який дотик після запису повертає звичайну гучність — кнопки гучності знову працюють
if (typeof document !== 'undefined') document.addEventListener('pointerdown', sessionPlayback, { capture: true, passive: true });
