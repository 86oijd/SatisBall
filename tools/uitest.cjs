// Drives the studio UI: every mode x every tab, presets, library (save / share code / replay), history,
// export options, recording mode. Reports console errors and checks exact replay. Usage: node tools/uitest.cjs [outdir]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '.';
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [], fails = [];
  const check = (ok, what) => { if (!ok) fails.push(what); };
  p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', (d) => d.accept());
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.waitForFunction(() => window.SB && SB.app);
  await p.evaluate(() => { localStorage.clear(); });
  await p.click('.splash');
  const modes = await p.evaluate(() => SB.app.orderedModes().map((m) => m.id));
  const tabs = ['Mode', 'Look', 'Sound', 'Text', 'Library', 'Export'];
  for (const id of modes) {
    await p.evaluate((id) => SB.app.selectMode(id), id);
    await p.waitForTimeout(250);
    for (const tab of tabs) await p.click(`.tab:has-text("${tab}")`);
    await p.click('.tab:has-text("Mode")');
    await p.click('.presets .chip >> nth=0'); await p.waitForTimeout(150);
    await p.keyboard.press('g'); await p.waitForTimeout(250);
    // poke every select and toggle in the Mode tab once
    const n = await p.$$eval('.panel-body select', (s) => s.length);
    for (let i = 0; i < n; i++) await p.$eval(`.panel-body select >> nth=${i}`, (s) => { if (s.options.length > 1) { s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change')); } }).catch(() => {});
    const ok = await p.evaluate(() => SB.app.game && SB.app.game.mode && SB.app.game.state !== undefined);
    check(ok, 'game alive after poking ' + id);
    await p.waitForTimeout(150);
  }
  // mode search + keyboard stepping
  await p.fill('.search', 'maze'); await p.waitForTimeout(100);
  check(await p.$$eval('.mode-card', (c) => c.length) === 1, 'search filters to one mode');
  await p.fill('.search', ''); await p.$eval('.search', (e) => e.blur());
  await p.keyboard.press(']'); await p.keyboard.press('['); await p.keyboard.press('1');
  // look: custom palette + cast
  await p.click('.tab:has-text("Look")');
  await p.click('.pal.custom'); await p.waitForTimeout(200);
  await p.click('.cast-row input[type=text] >> nth=0'); await p.keyboard.type('HERO');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => SB.app.game.pal.balls[0].n === 'HERO'), 'cast name applied');
  await p.screenshot({ path: out + '/ui-look.png' });
  // sound + text
  await p.click('.tab:has-text("Sound")'); await p.click('.chip:has-text("Marimba")'); await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/ui-sound.png' });
  await p.click('.tab:has-text("Text")');
  await p.click('.panel-body .toggle:has-text("Big hook card")'); await p.waitForTimeout(300); // intro card
  check(await p.evaluate(() => SB.app.state.text.intro === true), 'intro card toggle');
  await p.screenshot({ path: out + '/ui-text.png' });
  // library: save preset, share code round trip, exact replay
  await p.click('.tab:has-text("Library")');
  await p.click('.feat >> nth=0'); await p.waitForTimeout(400);
  const snap = await p.evaluate(() => SB.app.snapshot());
  await p.fill('.panel-body input[placeholder="Preset name"]', 'UITEST');
  await p.click('.panel-body button:has-text("Save current")'); await p.waitForTimeout(200);
  check(await p.evaluate(() => SB.library.user.list().some((u) => u.name === 'UITEST')), 'preset saved');
  const code = await p.evaluate(() => SB.library.encode(SB.app.snapshot()));
  await p.evaluate(() => SB.app.selectMode('chain'));
  await p.fill('.panel-body input[placeholder^="Paste"]', code).catch(async () => { await p.click('.tab:has-text("Library")'); await p.fill('.panel-body input[placeholder^="Paste"]', code); });
  await p.click('.panel-body button:has-text("Load") >> nth=-1'); await p.waitForTimeout(300);
  const back = await p.evaluate(() => SB.app.snapshot());
  check(back.modeId === snap.modeId && back.seed === snap.seed && JSON.stringify(back.settings) === JSON.stringify(snap.settings), 'share code round trip');
  // exact replay: the same snapshot simulated twice gives the same result
  const rep = await p.evaluate(() => {
    const run = () => { const cv = document.createElement('canvas'); cv.width = 108; cv.height = 192; const g = new SB.Game(SB.app.cfgFrom(SB.app.snapshot(), cv, 'mute')); for (let i = 0; i < 60 * 12; i++) g.frame(); return JSON.stringify(g.mode.stats ? g.mode.stats() : g.time); };
    return [run(), run()];
  });
  check(rep[0] === rep[1], 'exact replay deterministic');
  await p.screenshot({ path: out + '/ui-library.png' });
  // history
  await p.evaluate(() => { SB.app.game.onDone(); });
  await p.click('.tab:has-text("Library")');
  check(await p.$$eval('.plist .pitem', (x) => x.length) >= 2, 'history + presets listed');
  // export tab + modal
  await p.click('.tab:has-text("Export")');
  await p.$eval('.panel-body select >> nth=0', (s) => { s.value = '720'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(400);
  check(await p.evaluate(() => SB.app.exportOpts().width === 720), 'export resolution option');
  await p.$eval('.panel-body select >> nth=0', (s) => { s.value = '1080'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/ui-export-tab.png' });
  await p.keyboard.press('e'); await p.waitForTimeout(400);
  await p.screenshot({ path: out + '/ui-export.png' });
  await p.keyboard.press('Escape');
  // recording mode
  await p.keyboard.press('h'); await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/ui-rec.png' });
  await p.keyboard.press('Escape');
  const st = await p.evaluate(() => ({ mode: SB.app.state.modeId, fps: document.querySelector('.perf').textContent }));
  console.log(JSON.stringify(st), `${modes.length} modes x ${tabs.length} tabs`);
  console.log(fails.length ? 'FAILED CHECKS:\n  ' + fails.join('\n  ') : 'all checks passed');
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await b.close();
})();
