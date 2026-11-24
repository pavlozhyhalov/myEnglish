import { assert, assertEquals } from 'jsr:@std/assert@1';
import { PUSH_TEXT, pushText, pluralPl } from './i18n.ts';
import { buildMessage, chatMessageText, challengeNudge, cleanNudge, nudgePrompt, NUDGE_PROMPT } from './logic.ts';

Deno.test('push dictionary: every language has every key', () => {
  const keys = Object.keys(PUSH_TEXT.uk).sort();
  for (const [l, t] of Object.entries(PUSH_TEXT)) assertEquals(Object.keys(t).sort(), keys, l);
  assertEquals(pushText('xx'), PUSH_TEXT.uk);
  assertEquals(pushText(undefined), PUSH_TEXT.uk);
});

Deno.test('push: plural forms', () => {
  assertEquals(PUSH_TEXT.ru.cards(1), '1 карточка ждёт повторения.');
  assertEquals(PUSH_TEXT.ru.cards(3), '3 карточки ждут повторения.');
  assertEquals(PUSH_TEXT.ru.cards(11), '11 карточек ждут повторения.');
  assertEquals(PUSH_TEXT.es.cards(1), '1 tarjeta te espera para repasar.');
  assertEquals(PUSH_TEXT.pt.minutes(2), '2 minutos');
  assertEquals([1, 2, 5, 12, 22, 25].map(n => pluralPl(n, 'a', 'b', 'c')).join(''), 'abccbc');
  assertEquals(PUSH_TEXT.pl.cards(22), '22 fiszki czekają na powtórkę.');
});

Deno.test('push: reminder in the recipient language, Ukrainian unchanged', () => {
  const uk = buildMessage({ due: 3, todaySec: 60, streak: 4, kinds: {} })!;
  assertEquals(uk.title, 'Стрік під загрозою');
  assertEquals(uk.body, 'Ваш стрік — 4 дні. Позаймайтеся ще 4 хвилини, щоб його зберегти. 3 картки чекають на повторення.');
  const es = buildMessage({ due: 0, todaySec: 0, streak: 0, kinds: {}, lang: 'es' })!;
  assertEquals(es.title, 'Hora de inglés');
  assertEquals(es.body, 'Con 5 minutos más de práctica, hoy contará para tu racha.');
  const tr = buildMessage({ due: 2, todaySec: 600, streak: 0, kinds: {}, lang: 'tr' })!;
  assertEquals(tr, { title: 'Kart tekrarı zamanı', body: '2 kart tekrar için sizi bekliyor.', url: '#/cards/review', tag: 'myenglish-reminder' });
});

Deno.test('push: chat and challenge texts per language', () => {
  const room = { kind: 'group', title: 'Class' };
  assertEquals(chatMessageText({ kind: 'text', body: 'hi', sender: 'Emma', room }, 'pt'), { title: 'Novas mensagens no grupo «Class»', body: 'Emma: hi' });
  assertEquals(chatMessageText({ kind: 'voice', body: '', sender: 'Emma', room: { kind: 'dm', title: null } }, 'ru'), { title: 'Вам пишет Emma', body: 'Голосовое сообщение' });
  assertEquals(chatMessageText({ kind: 'text', body: 'hi', sender: '', room: { kind: 'dm', title: null } }, 'pl').title, 'Uczeń pisze do ciebie');
  assertEquals(chatMessageText({ kind: 'challenge', body: '', sender: 'Emma', room, meta: { duel_id: 'x', game: 'rush' } }, 'es').body, 'Emma · Traducción rápida · grupo «Class»: ¿quién hace más?');
  const n = challengeNudge({ room_title: 'Class', kind: 'words', target: 200, value: 50, days_left: 1 }, 'es');
  assertEquals(n.title, 'Ponte al día en el reto «200 palabras en una semana»');
  assertEquals(n.body, 'Class: llevas 50 de 200 palabras. Queda 1 día.');
});

Deno.test('push: personal nudge prompt and check per language', () => {
  assertEquals(nudgePrompt('uk'), NUDGE_PROMPT);
  const pl = nudgePrompt('pl');
  assert(pl.includes('in Polish.') && pl.includes('«ty»') && !pl.includes('literary Ukrainian'));
  const fb = { title: 'F', body: 'F', url: '#/', tag: 't' };
  assertEquals(cleanNudge({ title: 'Hola', body: 'Cuéntame de tu viaje a Valencia', topic_en: 'Ask about the trip.' }, fb, 'es').title, 'Hola');
  assertEquals(cleanNudge({ title: 'Hi', body: 'Tell me about your trip', topic_en: 'x' }, fb, 'es'), fb);
  assertEquals(cleanNudge({ title: 'Привіт', body: 'Розкажіть про поїздку', topic_en: 'x' }, fb, 'es'), fb);
});
