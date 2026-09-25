/* SatisBall TikTok relay — a tiny server that keeps your TikTok app secret off the web page.
 * Runs as a Cloudflare Worker (free) or locally with `node relay/local.mjs`.
 *
 * Environment variables:
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET   from developers.tiktok.com (your app)
 *   ALLOWED_ORIGINS   comma-separated origins of your studio, e.g. https://you.github.io,http://localhost:8000
 *   PUBLIC_URL        (optional) this relay's own base URL; defaults to the request origin
 *
 * Routes (all under /tiktok):
 *   GET  /login?return=<studio url>   -> redirects to TikTok's consent screen
 *   GET  /callback                    -> exchanges the code, sends tokens back to the studio in the URL hash
 *   POST /refresh {refresh_token}     -> fresh access token
 *   POST /api/<path>  (X-TikTok-Token)-> forwards a Content Posting API call to open.tiktokapis.com/v2/<path>
 *   PUT  /upload?url=<upload_url>     -> forwards a video chunk to TikTok's upload host
 */
const API = 'https://open.tiktokapis.com/v2/';
const SCOPES = 'user.info.basic,video.upload,video.publish';
const API_PATHS = /^post\/publish\/(creator_info\/query|video\/init|inbox\/video\/init|status\/fetch)\/$/;

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(new TextEncoder().encode(s));
const unb64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
function allowed(env, origin) {
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  return !!origin && list.includes(origin);
}
function cors(env, req, res) {
  const origin = req.headers.get('Origin');
  const h = new Headers(res.headers);
  if (allowed(env, origin)) {
    h.set('Access-Control-Allow-Origin', origin); h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Headers', 'Content-Type, Content-Range, X-TikTok-Token');
    h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    h.set('Access-Control-Max-Age', '86400');
  }
  return new Response(res.body, { status: res.status, headers: h });
}
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

async function tokenCall(env, params) {
  const r = await fetch(API + 'oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams(Object.assign({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET }, params)),
  });
  return r.json();
}

export async function handle(req, env) {
  const url = new URL(req.url);
  const self = (env.PUBLIC_URL || url.origin).replace(/\/+$/, '');
  const redirectUri = self + '/tiktok/callback';
  if (req.method === 'OPTIONS') return cors(env, req, new Response(null, { status: 204 }));
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return jsonRes({ error: 'relay not configured: set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET' }, 500);

  if (url.pathname === '/tiktok/login' && req.method === 'GET') {
    const back = url.searchParams.get('return') || '';
    let origin = ''; try { origin = new URL(back).origin; } catch (e) { /* invalid */ }
    if (!allowed(env, origin)) return jsonRes({ error: `return URL origin ${origin || '?'} is not in ALLOWED_ORIGINS` }, 400);
    const payload = b64uStr(JSON.stringify({ r: back, t: Date.now(), n: crypto.getRandomValues(new Uint32Array(1))[0] }));
    const state = payload + '.' + await hmac(env.TIKTOK_CLIENT_SECRET, payload);
    const auth = new URL('https://www.tiktok.com/v2/auth/authorize/');
    auth.search = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, scope: SCOPES, response_type: 'code', redirect_uri: redirectUri, state }).toString();
    return Response.redirect(auth.toString(), 302);
  }

  if (url.pathname === '/tiktok/callback' && req.method === 'GET') {
    const [payload, sig] = String(url.searchParams.get('state') || '').split('.');
    if (!payload || sig !== await hmac(env.TIKTOK_CLIENT_SECRET, payload)) return jsonRes({ error: 'bad state' }, 400);
    const st = JSON.parse(unb64u(payload));
    if (Date.now() - st.t > 15 * 60e3) return jsonRes({ error: 'login took too long, try again' }, 400);
    const back = st.r;
    if (url.searchParams.get('error')) return Response.redirect(`${back}#tterror=${encodeURIComponent(url.searchParams.get('error_description') || url.searchParams.get('error'))}`, 302);
    const t = await tokenCall(env, { code: url.searchParams.get('code'), grant_type: 'authorization_code', redirect_uri: redirectUri });
    if (!t.access_token) return Response.redirect(`${back}#tterror=${encodeURIComponent(t.error_description || t.error || 'token exchange failed')}`, 302);
    const pack = b64uStr(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, open_id: t.open_id, scope: t.scope, expires_in: t.expires_in, refresh_expires_in: t.refresh_expires_in }));
    return Response.redirect(`${back}#tt=${pack}`, 302);
  }

  // everything below is called by the studio page: origin must be allowed
  if (!allowed(env, req.headers.get('Origin'))) return jsonRes({ error: 'origin not allowed' }, 403);

  if (url.pathname === '/tiktok/refresh' && req.method === 'POST') {
    const { refresh_token } = await req.json().catch(() => ({}));
    if (!refresh_token) return cors(env, req, jsonRes({ error: 'missing refresh_token' }, 400));
    const t = await tokenCall(env, { grant_type: 'refresh_token', refresh_token });
    return cors(env, req, jsonRes(t, t.access_token ? 200 : 400));
  }

  if (url.pathname.startsWith('/tiktok/api/') && req.method === 'POST') {
    const path = url.pathname.slice('/tiktok/api/'.length);
    if (!API_PATHS.test(path)) return cors(env, req, jsonRes({ error: { code: 'not_allowed', message: 'endpoint not allowed' } }, 400));
    const r = await fetch(API + path, { method: 'POST', headers: { Authorization: 'Bearer ' + req.headers.get('X-TikTok-Token'), 'Content-Type': 'application/json; charset=UTF-8' }, body: await req.text() });
    return cors(env, req, new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
  }

  if (url.pathname === '/tiktok/upload' && req.method === 'PUT') {
    let target; try { target = new URL(url.searchParams.get('url')); } catch (e) { /* invalid */ }
    // only ever forward to TikTok's own upload hosts
    if (!target || target.protocol !== 'https:' || !/(^|\.)(tiktokapis\.com|tiktok\.com|tiktokv\.com|tiktokcdn\.com|byteoversea\.com|ibyteimg\.com)$/.test(target.hostname)) return cors(env, req, jsonRes({ error: 'upload host not allowed' }, 400));
    const body = await req.arrayBuffer();
    const r = await fetch(target.toString(), { method: 'PUT', headers: { 'Content-Type': req.headers.get('Content-Type') || 'video/mp4', 'Content-Range': req.headers.get('Content-Range'), 'Content-Length': String(body.byteLength) }, body });
    return cors(env, req, new Response(await r.text(), { status: r.status }));
  }

  return cors(env, req, jsonRes({ ok: true, service: 'satisball-tiktok-relay' }, url.pathname === '/' ? 200 : 404));
}

export default { fetch: (req, env) => handle(req, env) };
