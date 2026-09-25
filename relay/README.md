# TikTok relay

A ~120-line server that does the parts of TikTok's API a web page can't do safely:
- the OAuth token exchange, which needs your app's client secret
- forwarding uploads, because TikTok's upload hosts don't allow browser (CORS) requests

It stores nothing. Your tokens live only in your own browser.

## Deploy on Cloudflare Workers (free)

1. Sign up at <https://dash.cloudflare.com/>, then go to **Workers & Pages → Create → Worker**, name it (e.g. `satisball-relay`) and click **Deploy**.
2. Click **Edit code**, replace everything with the contents of [`tiktok-relay.js`](tiktok-relay.js), and click **Deploy**.
3. **Settings → Variables and Secrets** — add:
   - `TIKTOK_CLIENT_KEY`: from your TikTok developer app
   - `TIKTOK_CLIENT_SECRET`: from your TikTok developer app (type **Secret**)
   - `ALLOWED_ORIGINS`: where you open the studio, comma-separated, e.g. `https://86oijd.github.io,http://localhost:8000`
4. Your relay URL is `https://satisball-relay.<you>.workers.dev`.
   - In the TikTok developer portal, set the redirect URI to `https://satisball-relay.<you>.workers.dev/tiktok/callback`.
   - Paste the relay URL into the studio (**Export → TikTok → Relay URL**).

Opening the relay URL in a browser should show `{"ok":true,"service":"satisball-tiktok-relay"}`.

## Or run it on your PC (Node 18+)

```
TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... ALLOWED_ORIGINS=http://localhost:8000 PUBLIC_URL=http://localhost:8787 node relay/local.mjs
```
(On Windows PowerShell, set the variables with `$env:NAME="value"` first.)

## What it allows

The relay only forwards:
- TikTok's own posting endpoints (creator info, video init, inbox init, status)
- uploads to TikTok's own upload hosts

It only answers pages from `ALLOWED_ORIGINS`, and it signs the login `state` so the callback can't be forged.

Test it without TikTok: `node tools/relaytest.mjs`.
