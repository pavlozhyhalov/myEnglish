// APNs — сповіщення в застосунок iOS (2026-11-26, підготовка до App Store).
// Підписка застосунку — рядок push_subscriptions з endpoint `https://api.push.apple.com/3/device/<токен>` і keys `{ type: 'apns' }`
// (js/push.js → apnsRegister). Надсилання — JWT ES256 ключем .p8 з Apple Developer (Keys → Apple Push Notifications service).
// Секрети функції: APNS_KEY_P8 (вміст .p8), APNS_KEY_ID, APNS_TEAM_ID, опційно APNS_TOPIC (bundle id, типово io.github.pavlozhyhalov.myenglish)
// і APNS_SANDBOX=1 (збірки з Xcode напряму; TestFlight і App Store — production). Без секретів нічого не надсилається й підписка не видаляється.
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let jwtCache: { token: string; at: number } | null = null;
let keyCache: CryptoKey | null = null;

export const apnsConfigured = () => !!(Deno.env.get('APNS_KEY_P8') && Deno.env.get('APNS_KEY_ID') && Deno.env.get('APNS_TEAM_ID'));

async function signingKey() {
  if (keyCache) return keyCache;
  const pem = (Deno.env.get('APNS_KEY_P8') || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  keyCache = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return keyCache;
}

/** JWT провайдера: дійсний до години, Apple просить оновлювати не частіше ніж раз на 20 хв */
async function providerToken() {
  if (jwtCache && Date.now() - jwtCache.at < 40 * 60_000) return jwtCache.token;
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', kid: Deno.env.get('APNS_KEY_ID') })));
  const iat = Math.floor(Date.now() / 1000);
  const claims = b64u(enc.encode(JSON.stringify({ iss: Deno.env.get('APNS_TEAM_ID'), iat })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(), enc.encode(`${head}.${claims}`));
  const token = `${head}.${claims}.${b64u(sig)}`;
  jwtCache = { token, at: Date.now() };
  return token;
}

type Msg = { title?: string; body?: string; url?: string; tag?: string; badge?: number };

/** Надіслати в APNs. Повертає статус як у Web Push: 2xx — доставлено, 410 — токен недійсний (підписку видалити), 0 — не налаштовано */
export async function sendApns(endpoint: string, data: unknown, { ttl = 4 * 3600, urgency = 'normal' } = {}) {
  if (!apnsConfigured()) return { status: 0, text: 'apns not configured' };
  const token = endpoint.split('/').pop() || '';
  if (!/^[0-9a-f]{32,200}$/i.test(token)) return { status: 410, text: 'bad token' };
  const m = (data || {}) as Msg;
  const host = Deno.env.get('APNS_SANDBOX') === '1' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const payload = {
    aps: { alert: { title: String(m.title || 'myEnglish').slice(0, 120), body: String(m.body || '').slice(0, 300) }, sound: 'default',
      ...(m.tag ? { 'thread-id': String(m.tag).slice(0, 64) } : {}), ...(Number.isFinite(m.badge) ? { badge: m.badge } : {}) },
    url: typeof m.url === 'string' && m.url.startsWith('#/') ? m.url : '#/',
  };
  const res = await fetch(`https://${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await providerToken()}`,
      'apns-topic': Deno.env.get('APNS_TOPIC') || 'io.github.pavlozhyhalov.myenglish',
      'apns-push-type': 'alert',
      'apns-priority': urgency === 'high' ? '10' : '5',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl),
      ...(m.tag ? { 'apns-collapse-id': String(m.tag).slice(0, 64) } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  // недійсний/неактуальний токен — як 410 у Web Push: підписку прибрати
  if (res.status === 410 || (res.status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(text))) return { status: 410, text };
  return { status: res.status, text };
}
