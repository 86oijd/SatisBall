// Live check against Google's real servers (no mocks): loads Google sign-in and sends a real upload request
// with a deliberately invalid token; passes if YouTube's own 401 comes back readable. Usage: node tools/ytlive.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = process.cwd();
  const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); s.end(d); }); }).listen(8124);
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '<-loopback>,localhost,127.0.0.1' } : undefined, args: ['--ignore-certificate-errors'] });
  const p = await b.newPage();
  const net = [];
  p.on('requestfinished', async (r) => { if (/googleapis|accounts\.google/.test(r.url())) { const res = await r.response(); net.push(`${r.method()} ${r.url().slice(0, 90)} -> ${res && res.status()}`); } });
  p.on('requestfailed', (r) => net.push(`FAILED ${r.method()} ${r.url().slice(0, 90)} ${r.failure() && r.failure().errorText}`));
  await p.goto('http://127.0.0.1:8124/index.html?headless');
  await p.waitForFunction(() => window.SB && SB.publish);
  const out = await p.evaluate(async () => {
    const yt = SB.publish.youtube, o = {};
    await yt.loadGis();
    o.gis = typeof google.accounts.oauth2.initTokenClient;
    yt.token = 'invalid-token'; yt.expires = Date.now() + 3600e3; // real request, deliberately bad credential
    const blob = new Blob([new Uint8Array(1000)], { type: 'video/mp4' });
    const meta = yt.metadata({ modeId: 'chain', seed: 1, text: { hooks: {} } }, { winner: 'X', duration: 30 }, SB.app ? SB.app.state.publish : { title: '{hook} #shorts', desc: '{hook}', hashtags: '#a #b', yt: { privacy: 'public', category: '24' } });
    try { await yt.upload(blob, meta); o.result = 'unexpected success'; } catch (e) { o.error = e.message; }
    return o;
  });
  console.log(JSON.stringify(out)); console.log(net.join('\n'));
  await b.close(); srv.close();
})();
