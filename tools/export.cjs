// Frame-perfect export test. Usage: node tools/export.cjs <mode> <out> [targetLen]   env: FORCE=mp4-vp9, OPTS='{"width":720,"height":1280,"fps":30}', SETTINGS='{...}'
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [mode = 'growth', out = 'test.mp4', tl = '15'] = process.argv.slice(2);
  const b = await chromium.launch({ channel: process.env.CHANNEL || undefined });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack || e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html?headless');
  await p.waitForFunction(() => window.SB && SB.test);
  await p.evaluate(() => SB.fontsReady); if (process.env.FORCE) await p.evaluate((f) => { window.__force = f; }, process.env.FORCE);
  await p.evaluate(([o, st]) => { window.__opts = o ? JSON.parse(o) : null; window.__settings = st ? JSON.parse(st) : null; }, [process.env.OPTS || '', process.env.SETTINGS || '']);
  console.log('caps', JSON.stringify(await p.evaluate(() => SB.recorder.capabilities())));
  const t0 = Date.now();
  const r = await p.evaluate(async ([mode, tl]) => {
    const g = SB.test.makeGame(mode, { targetLen: +tl, settings: window.__settings || {} });
    const cfg = Object.assign({}, g.cfg); delete cfg.canvas;
    const res = await SB.recorder.exportRun(cfg, Object.assign({ maxSecs: SB.modes.byId[mode].longForm ? 215 : 75, force: window.__force }, window.__opts || {}));
    const buf = new Uint8Array(await res.blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), ext: res.ext, duration: res.duration, codec: res.codec, audio: res.audio, w: res.width, h: res.height, fps: res.fps };
  }, [mode, tl]);
  fs.writeFileSync(out.replace(/\.\w+$/, '.' + r.ext), Buffer.from(r.b64, 'base64'));
  console.log(JSON.stringify({ ext: r.ext, duration: r.duration, codec: r.codec, audio: r.audio, size: r.w + 'x' + r.h + '@' + r.fps, bytes: r.b64.length * 0.75, wallSecs: (Date.now() - t0) / 1000 }));
  if (errs.length) console.log('ERRORS', errs.join('\n'));
  await b.close();
})();
