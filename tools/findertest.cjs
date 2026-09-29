// Seed finder through the UI: run it, check ranking, load the best run (exact replay). Usage: node tools/findertest.cjs [shot.png]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [], fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  p.on('pageerror', (e) => errs.push(String(e.stack || e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.waitForFunction(() => window.SB && SB.app);
  await p.click('.splash');
  await p.evaluate(() => { SB.app.selectMode('battle'); SB.app.state.finder.count = 20; SB.app.tab = 'library'; SB.app.renderPanels(); });
  await p.click('.panel-body button:has-text("Find the best")');
  await p.waitForFunction(() => !SB.app.finding && SB.app.finderResults && SB.app.finderResults.length === 20, null, { timeout: 300000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: process.argv[2] || 'finder.png' });
  const res = await p.evaluate(() => SB.app.finderResults.map((r) => r.score));
  ok(res.every((v, i) => i === 0 || res[i - 1] >= v), 'sorted by score');
  ok(await p.$$eval('.flist .pitem', (x) => x.length) === 12, 'top 12 listed');
  const best = await p.evaluate(() => SB.app.finderResults[0].snap.seed);
  await p.click('.flist .pload >> nth=0'); await p.waitForTimeout(300);
  ok(await p.evaluate((s) => SB.app.state.run.seed === s && document.querySelector('.modal').classList.contains('hidden'), best), 'watch loads the exact seed');
  ok(await p.$$eval('.panel-body .frow', (x) => x.length) >= 1, 'results kept in Library');
  console.log('scores', res.join(' '));
  console.log(fails.length ? 'FAILED:\n  ' + fails.join('\n  ') : 'all finder checks passed');
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no errors');
  await b.close();
})();
