// Screenshot the full studio UI. Usage: node tools/ui.cjs out.png [w] [h] [clickSplash=1] [js]
const { chromium } = require('playwright');
(async () => {
  const [out, w = '1600', h = '900', click = '1', js = ''] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.waitForFunction(() => window.SB && SB.app);
  if (click === '1') await p.click('.splash');
  if (js) await p.evaluate(js);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: out });
  const perf = await p.evaluate(() => document.querySelector('.perf').textContent);
  console.log('perf:', perf);
  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
  await b.close();
})();
