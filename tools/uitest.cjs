// Drives the studio UI through every mode/tab/action and reports console errors.
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '.';
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.waitForFunction(() => window.SB && SB.app);
  await p.click('.splash');
  for (let i = 1; i <= 9; i++) {
    await p.keyboard.press(String(i)); await p.waitForTimeout(700);
    await p.keyboard.press('g'); await p.waitForTimeout(700);
    for (const tab of ['Look', 'Sound', 'Text', 'Run', 'Mode']) { await p.click(`.tab:has-text("${tab}")`); }
    await p.click('.presets .chip >> nth=0'); await p.waitForTimeout(300);
  }
  // tweak a slider and toggle
  await p.keyboard.press('1');
  const r = await p.$('.panel-body input[type=range]'); await r.focus(); await p.keyboard.press('ArrowRight');
  await p.click('.tab:has-text("Look")'); await p.click('.pal >> nth=3'); await p.waitForTimeout(500);
  await p.screenshot({ path: out + '/ui-look.png' });
  await p.click('.tab:has-text("Sound")'); await p.click('.chip:has-text("Marimba")'); await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/ui-sound.png' });
  await p.keyboard.press('h'); await p.waitForTimeout(2500);
  await p.screenshot({ path: out + '/ui-rec.png' });
  await p.keyboard.press('Escape');
  await p.keyboard.press('e'); await p.waitForTimeout(500);
  await p.screenshot({ path: out + '/ui-export.png' });
  const st = await p.evaluate(() => ({ mode: SB.app.state.modeId, fps: document.querySelector('.perf').textContent }));
  console.log(JSON.stringify(st));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await b.close();
})();
