// Offline-render each mode's soundtrack and print levels. Usage: node tools/audio.cjs [modes] [theme]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [only = '', theme = 'piano', wavDir = ''] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  await p.goto('file://' + process.cwd() + '/index.html?headless');
  await p.waitForFunction(() => window.SB && SB.test);
  const modes = only ? only.split(',') : await p.evaluate(() => SB.modes.list.map((m) => m.id));
  for (const m of modes) {
    const r = await p.evaluate(([m, th, w]) => SB.test.audio(m, { seed: 5000, sound: { theme: th }, wav: !!w }), [m, theme, wavDir]);
    if (r.wav) { fs.writeFileSync(`${wavDir}/${m}-${theme}.wav`, Buffer.from(r.wav.split(',')[1], 'base64')); delete r.wav; }
    console.log(JSON.stringify(r));
  }
  if (errs.length) console.log('ERRORS', errs.join('\n'));
  await b.close();
})();
