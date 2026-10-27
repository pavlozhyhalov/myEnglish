// deno test supabase/functions/push/logic_test.ts
import { buildMessage, isDue, localParts, plural, safeEqual, streakFrom, timeToMinutes } from './logic.ts';
import { b64uDecode, b64uEncode, encrypt, vapidHeader } from './webpush.ts';

function eq(a: unknown, b: unknown, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

Deno.test('localParts / timeToMinutes', () => {
  const t = new Date('2026-10-27T17:05:00Z');            // Київ: UTC+2 після переходу на зимовий час
  eq(localParts(t, 'Europe/Kyiv'), { day: '2026-10-27', minutes: 19 * 60 + 5 });
  eq(localParts(t, 'America/New_York'), { day: '2026-10-27', minutes: 13 * 60 + 5 });
  eq(localParts(new Date('2026-10-27T23:30:00Z'), 'Europe/Kyiv').day, '2026-10-28');
  eq(localParts(t, 'Not/AZone').day, '2026-10-27', 'bad tz falls back');
  eq(timeToMinutes('23:59'), 1425, 'clamped to last cron tick'); eq(timeToMinutes('19:00:00'), 1140); eq(timeToMinutes('07:30'), 450); eq(timeToMinutes(''), 1140);
});

Deno.test('isDue window and once per day', () => {
  const sub = { tz: 'Europe/Kyiv', remind_at: '19:00:00', last_sent_day: null as string | null };
  eq(isDue(new Date('2026-10-27T16:59:00Z'), sub).due, false, 'before');
  eq(isDue(new Date('2026-10-27T17:00:00Z'), sub).due, true, 'exact');
  eq(isDue(new Date('2026-10-27T18:59:00Z'), sub).due, true, 'within 2h');
  eq(isDue(new Date('2026-10-27T19:00:00Z'), sub).due, false, 'after window');
  eq(isDue(new Date('2026-10-27T17:10:00Z'), { ...sub, last_sent_day: '2026-10-27' }).due, false, 'already sent');
  eq(isDue(new Date('2026-10-27T17:10:00Z'), { ...sub, last_sent_day: '2026-10-26' }).due, true, 'sent yesterday');
});

Deno.test('streakFrom', () => {
  const m = new Map([['2026-10-24', 400], ['2026-10-25', 300], ['2026-10-26', 600], ['2026-10-27', 100]]);
  eq(streakFrom(m, '2026-10-27'), 3, 'today not counted yet');
  m.set('2026-10-27', 300);
  eq(streakFrom(m, '2026-10-27'), 4);
  eq(streakFrom(new Map([['2026-10-25', 900]]), '2026-10-27'), 0, 'gap');
  eq(streakFrom(new Map([['2026-03-28', 900], ['2026-03-29', 900], ['2026-03-30', 900]]), '2026-03-30'), 3, 'DST');
});

Deno.test('buildMessage', () => {
  eq(buildMessage({ due: 0, todaySec: 900, streak: 3, kinds: { cards: true, streak: true } }), null, 'nothing');
  eq(buildMessage({ due: 5, todaySec: 900, streak: 3, kinds: { cards: false, streak: true } }), null, 'cards off');
  const a = buildMessage({ due: 12, todaySec: 900, streak: 3, kinds: { cards: true, streak: true } })!;
  eq(a.title, 'Час повторити картки'); eq(a.body, '12 карток чекають на повторення.'); eq(a.url, '#/cards/review');
  const b = buildMessage({ due: 1, todaySec: 60, streak: 5, kinds: { cards: true, streak: true } })!;
  eq(b.title, 'Стрік під загрозою');
  eq(b.body, 'Ваш стрік — 5 днів. Позаймайтеся ще 4 хвилини, щоб його зберегти. 1 картка чекає на повторення.');
  const c = buildMessage({ due: 3, todaySec: 0, streak: 0, kinds: { cards: false, streak: true } })!;
  eq(c.url, '#/'); eq(c.body, 'Ще 5 хвилин практики — і сьогоднішній день зарахується в стрік.');
  eq(plural(21, 'a', 'b', 'c'), 'a'); eq(plural(12, 'a', 'b', 'c'), 'c'); eq(plural(23, 'a', 'b', 'c'), 'b');
});

Deno.test('safeEqual', () => {
  eq(safeEqual('abc', 'abc'), true); eq(safeEqual('abc', 'abd'), false); eq(safeEqual('abc', 'abcd'), false); eq(safeEqual('', 'x'), false);
});

Deno.test('encrypt header layout and vapid jwt', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const p256dh = b64uEncode(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
  const body = await encrypt(new TextEncoder().encode('{"x":1}'), { p256dh, auth });
  eq(body[20], 65); eq(new DataView(body.buffer).getUint32(16), 4096); eq(body.length, 86 + 8 + 16);
  const vk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', vk.privateKey);
  const pub = b64uEncode(await crypto.subtle.exportKey('raw', vk.publicKey));
  const hdr = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { publicKey: pub, privateKey: jwk.d!, subject: 'mailto:a@b.c' });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(hdr)!;
  eq(m[4], pub);
  const payload = JSON.parse(new TextDecoder().decode(b64uDecode(m[2])));
  eq(payload.aud, 'https://fcm.googleapis.com'); eq(payload.sub, 'mailto:a@b.c');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk.publicKey, b64uDecode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  eq(ok, true, 'signature');
});
