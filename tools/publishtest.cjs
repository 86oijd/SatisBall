// End-to-end publishing test with YouTube + TikTok mocked: exports a short run with auto-upload on for both,
// checks the requests the studio makes and the queue results. Usage: node tools/publishtest.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = process.cwd();
  const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); s.end(d); }); }).listen(8123);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [], seen = { ytMeta: null, ytPut: 0, ttInit: null, ttPuts: [] };
  p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  // fake Google Identity Services
  await p.addInitScript(() => { window.google = { accounts: { oauth2: { initTokenClient: (o) => ({ callback: o.callback, requestAccessToken() { setTimeout(() => this.callback({ access_token: 'YT-TOKEN', expires_in: 3599 }), 10); } }), revoke: () => {} } } }; });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Location' };
  await p.route('https://www.googleapis.com/upload/youtube/v3/videos*', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    seen.ytMeta = JSON.parse(r.request().postData()); seen.ytAuth = r.request().headers()['authorization'];
    r.fulfill({ status: 200, headers: Object.assign({ Location: 'https://upload.yt.test/session1' }, cors), body: '' });
  });
  await p.route('https://upload.yt.test/**', (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors }); seen.ytPut = (r.request().postDataBuffer() || []).length; r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ id: 'abc123', status: { privacyStatus: 'private' } }) }); });
  await p.route('https://relay.test/**', (r) => {
    const u = new URL(r.request().url()), m = r.request().method();
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const j = (o) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.endsWith('/inbox/video/init/')) { seen.ttInit = JSON.parse(r.request().postData()); return j({ data: { publish_id: 'pub1', upload_url: 'https://open-upload.tiktokapis.com/v/1' }, error: { code: 'ok' } }); }
    if (u.pathname.endsWith('/status/fetch/')) return j({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } });
    if (u.pathname === '/tiktok/upload') { seen.ttPuts.push([r.request().headers()['content-range'], (r.request().postDataBuffer() || []).length]); return r.fulfill({ status: 201, headers: cors, body: '' }); }
    j({ error: { code: 'unexpected', message: u.pathname } });
  });
  await p.goto('http://localhost:8123/index.html');
  await p.waitForFunction(() => window.SB && SB.app);
  await p.click('.splash');
  await p.evaluate(() => {
    const a = SB.app; a.state.run.targetLen = 15; Object.assign(a.state.export, { res: 720, fps: 30 });
    Object.assign(a.state.publish.yt, { auto: true, clientId: 'test.apps.googleusercontent.com', schedule: true, startAt: '', every: 3, nextAt: 0 });
    Object.assign(a.state.publish.tt, { auto: true, relay: 'https://relay.test', mode: 'inbox', allowWebm: true }); // headless Chromium can only make WebM
    SB.publish.tiktok.setTokens({ access_token: 'TT', refresh_token: 'RT', expires_in: 86400, refresh_expires_in: 1e7 });
    a.selectMode('chain'); a.tab = 'export'; a.renderPanels();
  });
  await p.click('.panel-body button:has-text("Connect YouTube")');
  await p.waitForFunction(() => SB.publish.youtube.connected());
  await p.keyboard.press('e'); await p.waitForTimeout(300);
  await p.click('.modal button:has-text("Render")');
  await p.waitForFunction(() => SB.app.queue.items.length === 2 && SB.app.queue.items.every((i) => i.state === 'done' || i.state === 'error'), null, { timeout: 300000 });
  const items = await p.evaluate(() => SB.app.queue.items.map((i) => ({ label: i.label, state: i.state, error: i.error, result: i.result })));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.screenshot({ path: process.argv[2] || 'publish.png' });
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  ok(items.every((i) => i.state === 'done'), 'both uploads done ' + JSON.stringify(items));
  ok(seen.ytAuth === 'Bearer YT-TOKEN', 'YouTube auth header');
  ok(seen.ytMeta && /#shorts/.test(seen.ytMeta.snippet.title) && seen.ytMeta.snippet.title.length <= 100, 'YouTube title ' + (seen.ytMeta && seen.ytMeta.snippet.title));
  ok(seen.ytMeta && seen.ytMeta.status.privacyStatus === 'private' && Date.parse(seen.ytMeta.status.publishAt) > Date.now(), 'scheduled upload is private with publishAt');
  ok(seen.ytPut > 100000, 'YouTube received the video bytes ' + seen.ytPut);
  ok(seen.ttInit && seen.ttInit.source_info.video_size === seen.ytPut && seen.ttInit.source_info.total_chunk_count === 1, 'TikTok init sizes');
  ok(seen.ttPuts.length === 1 && seen.ttPuts[0][0] === `bytes 0-${seen.ytPut - 1}/${seen.ytPut}`, 'TikTok chunk range ' + JSON.stringify(seen.ttPuts));
  const ch = await p.evaluate(() => [SB.publish.tiktok.chunks(150 * 1048576), SB.publish.tiktok.chunks(3e6)]);
  ok(ch[0].count === 7 && ch[0].chunk === 20 * 1048576 && ch[1].count === 1, 'chunking rules ' + JSON.stringify(ch));
  const fmt = await p.evaluate(() => SB.publish.tiktok.upload('https://relay.test', new Blob(['x'], { type: 'video/webm' }), { tt: { mode: 'inbox', allowWebm: false } }, 'c').then(() => 'accepted', (e) => e.message));
  ok(/MP4/.test(fmt), 'WebM refused for TikTok by default: ' + fmt);
  console.log('YouTube title:', seen.ytMeta && seen.ytMeta.snippet.title);
  console.log(fails.length ? 'FAILED:\n  ' + fails.join('\n  ') : 'all publishing checks passed');
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no errors');
  await b.close(); srv.close();
})();
