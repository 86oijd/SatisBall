// Phone emulation test: iPhone-sized touch viewport. Taps through the mobile bar, both sheets, every tab,
// a mode switch and the export modal; screenshots and reports errors. Usage: node tools/mobile.cjs [outdir]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || '.';
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext(Object.assign({}, devices['iPhone 13'], { defaultBrowserType: undefined }));
  const p = await ctx.newPage();
  const errs = [], fails = [];
  const check = (ok, w) => { if (!ok) fails.push(w); };
  p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.waitForFunction(() => window.SB && SB.app);
  await p.screenshot({ path: out + '/m-splash.png' });
  await p.tap('.splash');
  await p.waitForTimeout(1500);
  check(await p.evaluate(() => document.body.classList.contains('mobile')), 'mobile layout active');
  check(await p.evaluate(() => SB.app.canvas.width < 1080), 'reduced preview resolution');
  const noHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(noHScroll, 'no horizontal scroll');
  const st = await p.evaluate(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom }; });
  const bar = await p.evaluate(() => document.querySelector('.mobile-bar').getBoundingClientRect().top);
  check(st.w > 250 && st.bottom <= bar + 1, 'stage visible above the bar ' + JSON.stringify(st) + ' bar ' + bar);
  await p.screenshot({ path: out + '/m-main.png' });
  await p.tap('.mb:has-text("Modes")'); await p.waitForTimeout(400);
  await p.screenshot({ path: out + '/m-modes.png' });
  await p.tap('.mode-card:has-text("Boss Fight")'); await p.waitForTimeout(600);
  check(await p.evaluate(() => SB.app.state.modeId === 'boss' && !document.body.classList.contains('sheet-modes')), 'mode pick closes sheet');
  await p.tap('.mb:has-text("Settings")'); await p.waitForTimeout(400);
  for (const t of ['Mode', 'Look', 'Sound', 'Text', 'Library', 'Export']) { await p.tap(`.tab:has-text("${t}")`); await p.waitForTimeout(150); if (t === 'Look' || t === 'Mode') await p.screenshot({ path: out + `/m-${t.toLowerCase()}.png` }); }
  await p.tap('.sheet-head button >> nth=1'); await p.waitForTimeout(300);
  await p.tap('.mb:has-text("More")'); await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/m-more.png' });
  await p.tap('.more-menu button:has-text("Clean view")'); await p.waitForTimeout(800);
  check(await p.evaluate(() => document.body.classList.contains('recmode')), 'clean view');
  await p.screenshot({ path: out + '/m-clean.png' });
  await p.tap('.stage'); await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.body.classList.contains('recmode')), 'tap exits clean view');
  await p.tap('.mb:has-text("Export")'); await p.waitForTimeout(400);
  await p.screenshot({ path: out + '/m-export.png' });
  console.log(await p.evaluate(() => document.querySelector('.perf').textContent + ' canvas ' + SB.app.canvas.width + 'x' + SB.app.canvas.height));
  console.log(fails.length ? 'FAILED:\n  ' + fails.join('\n  ') : 'all mobile checks passed');
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await b.close();
})();
