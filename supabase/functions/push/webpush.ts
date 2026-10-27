// Мінімальний Web Push на Web Crypto (без node-залежностей):
//  * шифрування вмісту — RFC 8291 (aes128gcm, RFC 8188), один запис;
//  * VAPID — RFC 8292 (JWT ES256, заголовок `Authorization: vapid t=…, k=…`).

const enc = new TextEncoder();

export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str: string): Uint8Array<ArrayBuffer> {
  const s = str.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export type PushKeys = { p256dh: string; auth: string };

/** Зашифрувати вміст для підписки (aes128gcm). salt і ephemeral — лише для тестів. */
export async function encrypt(payload: Uint8Array<ArrayBuffer>, keys: PushKeys, opts: { salt?: Uint8Array<ArrayBuffer>; ephemeral?: CryptoKeyPair } = {}) {
  const uaPublic = b64uDecode(keys.p256dh);
  const authSecret = b64uDecode(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh');
  if (authSecret.length < 16) throw new Error('bad auth');
  const as = opts.ephemeral || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // один (останній) запис: вміст + роздільник 0x02, без доповнення
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = 4096;
  if (cipher.length + 86 > rs) throw new Error('payload too large');
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

export type Vapid = { publicKey: string; privateKey: string; subject: string };

const keyCache = new Map<string, CryptoKey>();
async function signingKey(v: Vapid) {
  const id = v.publicKey + v.privateKey;
  let k = keyCache.get(id);
  if (!k) {
    const pub = b64uDecode(v.publicKey);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error('bad VAPID public key');
    k = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: v.privateKey.replace(/=+$/, ''),
      x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    keyCache.set(id, k);
  }
  return k;
}

/** Заголовок Authorization для кінцевої точки (aud = її origin) */
export async function vapidHeader(endpoint: string, v: Vapid, ttlSec = 12 * 3600) {
  const aud = new URL(endpoint).origin;
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + ttlSec, sub: v.subject })));
  const unsigned = `${head}.${body}`;
  // Web Crypto повертає підпис у форматі r||s (IEEE P1363) — саме те, що потрібно JWS ES256
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(v), enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64uEncode(sig)}, k=${v.publicKey.replace(/=+$/, '')}`;
}

export type Sub = { endpoint: string; keys: PushKeys };

/** Надіслати повідомлення. Повертає HTTP-статус служби push (201 — прийнято; 404/410 — підписка недійсна). */
export async function sendPush(sub: Sub, data: unknown, v: Vapid, { ttl = 4 * 3600, urgency = 'normal' } = {}) {
  const body = await encrypt(enc.encode(JSON.stringify(data)), sub.keys);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, v),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  return { status: res.status, text };
}
