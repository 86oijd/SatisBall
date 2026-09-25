// Usage: node tools/sim.cjs <mode> [seeds=5] [json-opts]
const { chromium } = require('playwright');
(async () => {
const [mode, n = '5', opts = '{}'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'log') errs.push(m.text()); });
await page.goto('file://' + process.cwd() + '/index.html?headless');
await page.waitForFunction(() => window.SB && SB.test);
for (let i = 0; i < +n; i++) {
  const r = await page.evaluate(([m, s, o]) => SB.test.simulate(m, { seed: s, ...JSON.parse(o) }), [mode, 1000 + i * 77, opts]);
  console.log(JSON.stringify(r));
}
if (errs.length) console.log('LOG:', errs.slice(0, 20).join('\n'));
await browser.close();

})();
