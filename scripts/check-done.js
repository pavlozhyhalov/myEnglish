// Перевірка «готово» на плитках-завданнях (js/done.js): головна (завдання рівня, «Для вашої цілі»), «Сценарії», «Письмо».
// Запуск: python3 -m http.server 8765 (у корені репозиторію) і node scripts/check-done.js — після змін у завданнях дня.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = (ms) => p.waitForTimeout(ms);
  await p.goto((process.env.BASE || 'http://localhost:8765') + '/#/progress'); await wait(2500);
  const S = "const store = await import('/js/store.js');";
  await p.evaluate(`(async () => { ${S} store.setProf({ placementDone: 'skipped', onboarded: true, goalTags: ['travel','social'], about: { goals: ['travel','social'] } }); })()`);
  const go = async (hash) => { await p.evaluate(h => { location.hash = '#/progress'; }, hash); await wait(400); await p.evaluate(h => { location.hash = h; }, hash); await wait(2500); };
  await go('#/');
  const tiles = async () => p.evaluate(() => [...document.querySelectorAll('.hm-task, .hm-goal-t')].map(a => `${a.getAttribute('href')} = ${a.textContent.trim()}`));
  console.log('HOME before:', await tiles());
  // зіграти сценарій дня й сценарій цілі
  const ids = await p.evaluate(() => [...document.querySelectorAll('.hm-task, .hm-goal-t')].map(a => a.getAttribute('href')).filter(h => h.startsWith('#/scenarios/')).map(h => h.split('/').pop()));
  const mk = (sc, title) => `store.put('tutor_chats', { mode: 'voice', scenario: ${sc ? `'${sc}'` : 'null'}, title: '${title}', messages: [{ role: 'user', text: 'Hello there' }, { role: 'model', text: 'Hi' }, { role: 'user', text: 'I have a booking' }], created_at: new Date().toISOString() });`;
  await p.evaluate(`(async () => { ${S} ${ids.map(i => mk(i, 'Голос: x')).join('')} ${mk(null, 'Голос: Small talk')} })()`);
  await go('#/');
  console.log('HOME after:', await tiles());
  await go('#/scenarios');
  console.log('SCEN:', await p.evaluate(() => [...document.querySelectorAll('.tx-row, .tx-primary, a')].map(a => a.textContent.trim()).filter(t => /пройдено|готово/.test(t)).slice(0, 6).concat([...document.querySelectorAll('.tx-showall')].length)));
  // письмо: завдання дня
  await go('#/writing');
  const wid = await p.evaluate(() => document.querySelector('a[href^="#/writing/"]')?.getAttribute('href')?.split('/').pop());
  await p.evaluate(`(async () => { ${S} store.put('tutor_chats', { mode: 'check', title: 'Перевірка', messages: [{ role: 'user', text: 'Dear Sir' }], summary: { writing: '${wid}', corrections: [] }, created_at: new Date().toISOString() }); })()`);
  await go('#/writing');
  console.log('WRITING', wid, await p.evaluate(() => [...document.querySelectorAll('a[href^="#/writing/"]')].slice(0, 3).map(a => a.textContent.trim())));
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
