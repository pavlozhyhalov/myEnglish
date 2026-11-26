// Перевірка сторінок мовою (Playwright): node scripts/l10n-pages-check.js <lang> — потрібен сервер на :8765 (python3 -m http.server 8765).
const { chromium } = require('playwright');
const lang = process.argv[2] || 'ru';
const routes = ['#/home','#/today','#/tutor','#/cards','#/vocab','#/phrases','#/grammar','#/grammar/present-perfect','#/grammar/a0-be','#/exercises/grammar','#/pronunciation','#/pronunciation/sounds','#/abc','#/games','#/fluency','#/scenarios','#/listening','#/reading','#/reading/library','#/writing','#/diary','#/mistakes','#/tests','#/tests/placement','#/progress','#/analysis','#/report','#/settings','#/profile','#/friends','#/feedback','#/auth','#/auth?tab=up','#/about','#/about/privacy','#/about/terms','#/about/licenses','#/welcome','#/listen-go','#/cards/train'];
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const w of [390, 320]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
    await ctx.addInitScript((l) => { localStorage.setItem('me:lang-preview','1'); localStorage.setItem('me:lang', l); }, lang);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    for (const r of routes) {
      await p.goto('http://localhost:8765/' + r, { waitUntil: 'load' }); await p.waitForTimeout(1500);
      const res = await p.evaluate(() => {
        const bad = new Set(); const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          const el = n.parentElement; if (!el || el.closest('[lang="en"],script,style,[data-noi18n]')) continue;
          if (!el.getClientRects().length) continue;
          const v = n.nodeValue.trim(); if (/[ІіЇїЄєҐґ]/.test(v) || (document.documentElement.lang !== 'ru' && /[А-Яа-я]/.test(v))) bad.add(v.slice(0, 80));
        }
        return { bad: [...bad].slice(0, 15), over: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      if (res.bad.length || res.over) out[`${w} ${r}`] = res;
    }
    if (errs.length) out[`${w} errors`] = [...new Set(errs)].slice(0, 10);
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
