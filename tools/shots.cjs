// Batch snapshots. Usage: node tools/shots.cjs outdir "mode:t1,t2;mode2:t" [seed] [optsJSON]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, spec, seed = '1000', opts = '{}'] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html?headless');
  await p.waitForFunction(() => window.SB && SB.test);
  await p.evaluate(() => SB.fontsReady);
  for (const part of spec.split(';')) {
    const [mode, ts] = part.split(':');
    for (const t of ts.split(',')) {
      const url = await p.evaluate(([m, t, s, o]) => SB.test.snapshot(m, +t, { seed: +s, scale: 0.4, ...JSON.parse(o) }), [mode, t, seed, opts]);
      fs.writeFileSync(`${out}/${mode}-${seed}-${t}.png`, Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  if (errs.length) console.log('ERRORS:', errs.join('\n'));
  await b.close();
})();
