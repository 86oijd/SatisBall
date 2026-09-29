// Autopilot end to end (platforms mocked): multi-mode search -> pick -> render -> upload -> log -> schedule,
// then reload and check it resumes by itself. Usage: node tools/autopilottest.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = process.cwd();
  const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); s.end(d); }); }).listen(8125);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [], fails = [], seen = { refresh: 0, ytMeta: null, ttInit: 0 }; const ok = (c, m) => { if (!c) fails.push(m); };
  p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Location' };
  await p.route('https://relay.test/**', (r) => {
    const u = new URL(r.request().url()); if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const j = (o) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/google/refresh') { seen.refresh++; return j({ access_token: 'YT-FRESH', expires_in: 3599 }); }
    if (u.pathname.endsWith('/inbox/video/init/')) { seen.ttInit++; return j({ data: { publish_id: 'p', upload_url: 'https://open-upload.tiktokapis.com/x' }, error: { code: 'ok' } }); }
    if (u.pathname.endsWith('/status/fetch/')) return j({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } });
    if (u.pathname === '/tiktok/upload') return r.fulfill({ status: 201, headers: cors, body: '' });
    j({ error: { code: 'x', message: u.pathname } });
  });
  await p.route('https://www.googleapis.com/upload/youtube/v3/videos*', (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors }); seen.ytMeta = JSON.parse(r.request().postData()); seen.ytAuth = r.request().headers().authorization; r.fulfill({ status: 200, headers: Object.assign({ Location: 'https://upload.yt.test/s' }, cors), body: '' }); });
  await p.route('https://upload.yt.test/**', (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors }); r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"id":"vid1","status":{"privacyStatus":"private"}}' }); });
  // simulate a completed relay sign-in for YouTube (refresh token saved) and TikTok
  await p.goto('http://127.0.0.1:8125/index.html');
  await p.waitForFunction(() => window.SB && SB.app);
  await p.evaluate(() => {
    localStorage.setItem('satisball.youtube.v1', JSON.stringify({ refresh_token: 'RT-G' }));
    SB.publish.tiktok.setTokens({ access_token: 'TT', refresh_token: 'RT', expires_in: 86400, refresh_expires_in: 1e7 });
    const a = SB.app.state;
    a.run.targetLen = 15; Object.assign(a.export, { res: 720, fps: 30 });
    Object.assign(a.publish.yt, { clientId: 'x.apps.googleusercontent.com', schedule: false, auto: false });
    Object.assign(a.publish.tt, { relay: 'https://relay.test', mode: 'inbox', allowWebm: true, auto: false });
    Object.assign(a.autopilot, { enabled: true, seeds: 45, every: 2, budgetMin: 3, modes: ['lastin', 'battle', 'chain'], minLen: 10, maxLen: 60 });
    localStorage.setItem('satisball.v2', JSON.stringify(a));
    localStorage.removeItem('satisball.autopilot.v1');
  });
  await p.reload(); // reload = unattended restart: autopilot must start by itself
  await p.waitForFunction(() => window.SB && SB.app && SB.app.apRunning, null, { timeout: 20000 });
  const t0 = Date.now();
  await p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('satisball.autopilot.v1')).log.length >= 1; } catch (e) { return false; } }, null, { timeout: 600000, polling: 1000 });
  const rt = await p.evaluate(() => JSON.parse(localStorage.getItem('satisball.autopilot.v1')));
  const e = rt.log[0];
  console.log('cycle took', ((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(e));
  ok(!e.error, 'cycle succeeded: ' + e.error);
  ok(e.searched >= 30, 'searched seeds ' + e.searched);
  ok(['lastin', 'battle', 'chain'].includes(e.modeId), 'picked one of the chosen modes');
  ok(e.uploads.some((u) => u.startsWith('YouTube ✓')) && e.uploads.some((u) => u.startsWith('TikTok ✓')), 'uploaded to both ' + JSON.stringify(e.uploads));
  ok(seen.refresh >= 1 && seen.ytAuth === 'Bearer YT-FRESH', 'YouTube token refreshed through the relay');
  ok(rt.nextAt > Date.now() + 60 * 60e3, 'next run scheduled ~2h later');
  ok(rt.posted.length === 1, 'run remembered so it is never posted twice');
  await p.waitForTimeout(1500);
  const dash = await p.evaluate(() => document.querySelector('.autopilot h2').textContent);
  ok(/waiting/.test(dash), 'dashboard shows waiting: ' + dash);
  await p.screenshot({ path: process.argv[2] || 'autopilot.png' });
  // reload while waiting: resumes and keeps the same schedule (doesn't re-run immediately)
  await p.reload();
  await p.waitForFunction(() => SB.app && SB.app.apRunning, null, { timeout: 20000 });
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({ h: document.querySelector('.autopilot h2').textContent, log: JSON.parse(localStorage.getItem('satisball.autopilot.v1')).log.length }));
  ok(/waiting/.test(after.h) && after.log === 1, 'resumed after reload and kept the schedule ' + JSON.stringify(after));
  await p.click('.autopilot button:has-text("Stop")');
  await p.waitForFunction(() => !SB.app.apRunning, null, { timeout: 30000 });
  ok(await p.evaluate(() => !SB.app.state.autopilot.enabled && !document.querySelector('.autopilot')), 'stop turns it off');
  console.log(fails.length ? 'FAILED:\n  ' + fails.join('\n  ') : 'all autopilot checks passed');
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no errors');
  await b.close(); srv.close();
})();
