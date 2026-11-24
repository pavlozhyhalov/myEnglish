// Діалоги аудіювання двома голосами Gemini (2026-11-19, власник: «паршивий голос, нічого не зрозуміло»).
// Спільне для функції `tts` (запит учня) і `push` (щоденне попереднє озвучення всіх діалогів у кеш — запис готовий до першого прослуховування).
// Голоси обирає сервер за іменами: жінка — Kore/Aoede, чоловік — Puck/Charon, роль без статі — протилежна до співрозмовника.
import { tts, wav } from './gemini.ts';
import { TTS_MODELS } from './config.ts';

const FEMALE = /^(mrs|ms|miss|woman|girl|anna|emma|ewa|kasia|kate|sophie|olga|maria|marta|julia|lucy|sarah|alice|tetiana|natalia|ola|zosia|oksana|olena|iryna|halyna|nataliia|sofiia)\b/i;
const MALE = /^(mr|man|boy|oliver|tom|marek|john|james|jack|david|peter|piotr|adam|max|sam|paul|mark|taras|ivan|andrii|mykola|dmytro|oleh|bohdan)\b/i;
export function dialogueVoices(names: string[]) {
  let g = [0, 1].map(i => FEMALE.test(names[i] || '') ? 'f' : MALE.test(names[i] || '') ? 'm' : '');
  if (!g[0] && !g[1]) g = ['f', 'm'];
  else if (!g[0]) g[0] = g[1] === 'm' ? 'f' : 'm';
  else if (!g[1]) g[1] = g[0] === 'm' ? 'f' : 'm';
  return g[0] === g[1] ? (g[0] === 'f' ? ['Kore', 'Aoede'] : ['Puck', 'Charon']) : g.map(x => (x === 'f' ? 'Kore' : 'Puck'));
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export type Dialogue = { key: string; text: string; voice: string; speakers: { name: string; voice: string }[]; lines: { speaker: string; text: string }[] };

/** lines: [{ s: 0|1, t }], names: імена двох мовців як у даних. null — порожній чи задовгий діалог */
export async function buildDialogue(raw: { s?: number; t?: string }[], rawNames: string[]): Promise<Dialogue | null> {
  const lines = (raw || []).slice(0, 30).map(l => ({ s: l?.s ? 1 : 0, t: String(l?.t || '').replace(/\s+/g, ' ').trim().slice(0, 400) })).filter(l => l.t);
  const names = [0, 1].map(i => String(rawNames?.[i] || '').replace(/[^A-Za-z]/g, '').slice(0, 20) || ['Alex', 'Sam'][i]);
  if (names[0] === names[1]) names[1] = names[1] + 'B';
  const v = dialogueVoices([0, 1].map(i => String(rawNames?.[i] || '')));
  const speakers = [0, 1].map(i => ({ name: names[i], voice: v[i] }));
  const body = lines.map(l => `${names[l.s]}: ${l.t}`).join('\n');
  if (!lines.length || body.length > 4000) return null;
  const text = `Read this everyday conversation aloud for English learners: clear, natural, friendly, at a calm and steady pace, with a short pause between lines.\n\n${body}`;
  const voice = v.join('+');
  return { key: `${await sha256(voice + '|' + text)}.wav`, text, voice, speakers, lines: lines.map(l => ({ speaker: names[l.s], text: l.t })) };
}

/** Згенерувати запис діалогу (WAV) */
export async function renderDialogue(d: Dialogue) {
  const { pcm, rate } = await tts(TTS_MODELS, d.text, d.voice, { speakers: d.speakers, lines: d.lines, timeoutMs: 65_000 });
  return wav(pcm, rate);
}
