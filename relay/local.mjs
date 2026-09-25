// Run the TikTok relay on your own PC (Node 18+):
//   TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... ALLOWED_ORIGINS=http://localhost:8000 PUBLIC_URL=http://localhost:8787 node relay/local.mjs
// TikTok only accepts redirect URIs you registered, so register PUBLIC_URL + /tiktok/callback in your app.
import http from 'node:http';
import { handle } from './tiktok-relay.js';
const port = +(process.env.PORT || 8787);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half' });
  try {
    const r = await handle(request, process.env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e && e.stack || e)); }
}).listen(port, () => console.log(`SatisBall TikTok relay on http://localhost:${port}`));
