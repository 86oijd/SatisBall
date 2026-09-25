// Usage: node tools/shot.cjs <mode> <t1,t2,...> [seed] [outdir]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
const [mode, times = '2', seed = '1234', out = process.env.OUT || '.'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('file://' + process.cwd() + '/index.html?headless');
await page.waitForFunction(() => window.SB && SB.test);
await page.evaluate(() => SB.fontsReady);
for (const t of times.split(',')) {
  const url = await page.evaluate(([m, t, s]) => SB.test.snapshot(m, +t, { seed: +s, ...(window.__opts || {}) }), [mode, t, seed]);
  fs.writeFileSync(`${out}/${mode}-${seed}-${t}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
if (errs.length) console.log('ERRORS:', errs.join('\n'));
await browser.close();

})();
