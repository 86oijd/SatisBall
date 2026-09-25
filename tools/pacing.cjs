// Runs every mode over several seeds and reports payoff times. Usage: node tools/pacing.cjs [seeds=6] [modes]
const { chromium } = require('playwright');
(async () => {
  const [n = '6', only = ''] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  await p.goto('file://' + process.cwd() + '/index.html?headless');
  await p.waitForFunction(() => window.SB && SB.test);
  const modes = only ? only.split(',') : await p.evaluate(() => SB.modes.list.map((m) => m.id));
  const longForm = await p.evaluate(() => Object.fromEntries(SB.modes.list.map((m) => [m.id, !!m.longForm])));
  let bad = 0;
  for (const m of modes) {
    const times = [];
    for (let i = 0; i < +n; i++) {
      const hi = longForm[m] ? 180 : 60;
      const r = await p.evaluate(([m, s, tl, mx]) => SB.test.simulate(m, { seed: s, targetLen: tl, maxSecs: mx }), [m, 5000 + i * 131, +(process.env.TL || 35), hi + 20]);
      times.push(r.finishedAt ? r.finishedAt.toFixed(1) : 'NONE');
      if (!r.finishedAt || r.finishedAt < 15 || r.finishedAt > hi) bad++;
    }
    console.log(m.padEnd(10), times.join('  '), longForm[m] ? '(long-form: 15-180s)' : '');
  }
  console.log(bad ? `${bad} runs outside target window` : 'all runs within target window (15-60s, long-form 15-180s)');
  if (errs.length) console.log('ERRORS', errs.join('\n'));
  await b.close();
})();
