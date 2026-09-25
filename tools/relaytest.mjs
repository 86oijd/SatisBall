// Tests the TikTok relay's logic with TikTok's API mocked (no network). Usage: node tools/relaytest.mjs
import { handle } from '../relay/tiktok-relay.js';
const env = { TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'secret', ALLOWED_ORIGINS: 'https://me.github.io, http://localhost:8123', PUBLIC_URL: 'https://relay.test' };
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); calls.push({ url, init });
  if (url.endsWith('/v2/oauth/token/')) {
    const p = new URLSearchParams(init.body.toString());
    if (p.get('client_secret') !== 'secret') return new Response('{"error":"bad"}');
    if (p.get('grant_type') === 'client_credentials') return new Response(JSON.stringify({ access_token: 'clt.x', expires_in: 7200 }));
    return new Response(JSON.stringify({ access_token: 'AT-' + (p.get('code') || 'refreshed'), refresh_token: 'RT', open_id: 'u1', scope: 'video.upload', expires_in: 86400, refresh_expires_in: 31536000 }));
  }
  if (url.includes('/v2/user/info/')) return new Response(JSON.stringify({ data: { user: { display_name: 'Me' } }, error: { code: 'ok' } }));
  if (url.includes('/v2/post/publish/')) return new Response(JSON.stringify({ data: { publish_id: 'p1', upload_url: 'https://open-upload.tiktokapis.com/video/?id=1', auth: init.headers.Authorization }, error: { code: 'ok' } }));
  if (url.startsWith('https://open-upload.tiktokapis.com/')) return new Response('', { status: 201 });
  return new Response('unexpected ' + url, { status: 599 });
};
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const req = (path, o = {}) => handle(new Request('https://relay.test' + path, o), env);

let r = await req('/tiktok/login?return=' + encodeURIComponent('https://evil.com/'));
ok(r.status === 400, 'rejects foreign return url');
r = await req('/tiktok/login?return=' + encodeURIComponent('https://me.github.io/SatisBall/index.html'));
ok(r.status === 302, 'login redirects');
const auth = new URL(r.headers.get('Location'));
ok(auth.host === 'www.tiktok.com' && auth.searchParams.get('redirect_uri') === 'https://relay.test/tiktok/callback' && auth.searchParams.get('client_key') === 'ck', 'authorize url');
const state = auth.searchParams.get('state');
r = await req('/tiktok/callback?code=C1&state=' + state.replace(/.$/, 'x'));
ok(r.status === 400, 'tampered state rejected');
r = await req('/tiktok/callback?code=C1&state=' + state);
const back = r.headers.get('Location') || '';
ok(back.startsWith('https://me.github.io/SatisBall/index.html#tt='), 'callback returns tokens to studio');
const tok = JSON.parse(Buffer.from(back.split('#tt=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
ok(tok.access_token === 'AT-C1' && tok.refresh_token === 'RT', 'tokens decoded');
const O = { Origin: 'https://me.github.io' };
r = await req('/tiktok/refresh', { method: 'POST', headers: { ...O, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: 'RT' }) });
ok(r.status === 200 && (await r.json()).access_token === 'AT-refreshed' && r.headers.get('Access-Control-Allow-Origin') === 'https://me.github.io', 'refresh + CORS');
r = await req('/tiktok/refresh', { method: 'POST', headers: { Origin: 'https://evil.com' }, body: '{}' });
ok(r.status === 403, 'foreign origin blocked');
r = await req('/tiktok/api/post/publish/inbox/video/init/', { method: 'POST', headers: { ...O, 'X-TikTok-Token': 'AT' }, body: '{"source_info":{}}' });
const j = await r.json();
ok(r.status === 200 && j.data.publish_id === 'p1' && j.data.auth === 'Bearer AT', 'api proxy');
r = await req('/tiktok/api/video/list/', { method: 'POST', headers: O, body: '{}' });
ok(r.status === 400, 'non-posting endpoints refused');
r = await req('/tiktok/api/user/info/', { method: 'POST', headers: { ...O, 'X-TikTok-Token': 'AT' }, body: '{}' });
ok(r.status === 200 && calls[calls.length - 1].url.includes('/v2/user/info/?fields=') && calls[calls.length - 1].init.headers.Authorization === 'Bearer AT', 'user info');
r = await req('/tiktok/selftest', { headers: O });
const sj = await r.json();
ok(sj.ok && sj.caller_allowed && sj.redirect_uri === 'https://relay.test/tiktok/callback', 'selftest ' + JSON.stringify(sj));
r = await req('/tiktok/upload?url=' + encodeURIComponent('https://evil.com/x'), { method: 'PUT', headers: O, body: 'x' });
ok(r.status === 400, 'upload to foreign host refused');
r = await req('/tiktok/upload?url=' + encodeURIComponent('https://open-upload.tiktokapis.com/video/?id=1'), { method: 'PUT', headers: { ...O, 'Content-Range': 'bytes 0-3/4', 'Content-Type': 'video/mp4' }, body: 'abcd' });
const up = calls[calls.length - 1];
ok(r.status === 201 && up.init.headers['Content-Range'] === 'bytes 0-3/4' && up.init.body.byteLength === 4, 'upload forwarded');
r = await req('/tiktok/refresh', { method: 'OPTIONS', headers: O });
ok(r.status === 204 && /X-TikTok-Token/.test(r.headers.get('Access-Control-Allow-Headers')), 'preflight');
console.log(fails ? `${fails} relay checks failed` : 'all relay checks passed');
process.exit(fails ? 1 : 0);
