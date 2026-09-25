/* SatisBall — publishing: upload finished videos to YouTube Shorts (Data API v3, OAuth in the browser)
 * and TikTok (Content Posting API through the small relay in relay/, which keeps the app secret off the page).
 *
 * YouTube: needs an OAuth "Web application" client ID with this site's origin authorised. Uploads use the
 *   resumable protocol straight from the browser. Google keeps uploads from unaudited API projects private.
 * TikTok: needs a TikTok developer app + the relay. "inbox" mode sends the video to the creator's TikTok
 *   inbox as a draft (finish posting in the app); "direct" mode posts it (unaudited apps: only SELF_ONLY).
 */
'use strict';
(function (SB) {
  const TT_KEY = 'satisball.tiktok.v1';
  const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

  // ------------------------------------------------------------------ captions
  const plainHook = (h) => String(h || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  function fill(tpl, v) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)).replace(/[ \t]+\n/g, '\n').trim();
  }
  /** Values a caption template can use: {hook} {mode} {winner} {seed} {hashtags} {secs} */
  function captionVars(snap, res, cfg) {
    const def = SB.modes.byId[snap.modeId];
    const hook = plainHook((snap.text && snap.text.hooks && snap.text.hooks[snap.modeId]) ?? def.hook);
    return { hook, mode: def.name, winner: plainHook(res.winner || ''), seed: snap.seed, secs: Math.round(res.duration || 0), hashtags: cfg.hashtags || '' };
  }
  const ytTitle = (s) => s.replace(/[<>]/g, '').slice(0, 100);

  // ------------------------------------------------------------------ XHR with upload progress
  function xhr(method, url, { headers = {}, body = null, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method, url);
      for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
      if (onProgress && x.upload) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => resolve({ status: x.status, text: x.responseText, header: (h) => x.getResponseHeader(h) });
      x.onerror = () => reject(new Error('network error (CORS, offline or blocked)'));
      x.send(body);
    });
  }
  const json = (t) => { try { return JSON.parse(t); } catch (e) { return null; } };

  // ------------------------------------------------------------------ YouTube
  const youtube = {
    token: null, expires: 0, tokenClient: null, clientId: '',
    connected() { return !!this.token && Date.now() < this.expires - 60e3; },
    loadGis() {
      if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
      if (this._gis) return this._gis;
      this._gis = new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = res; s.onerror = () => { this._gis = null; rej(new Error('could not load Google sign-in (offline?)')); };
        document.head.appendChild(s);
      });
      return this._gis;
    },
    /** Must be called from a click/tap (it opens Google's consent popup). */
    async connect(clientId) {
      if (location.protocol === 'file:') throw new Error('Google sign-in does not work from a local file — open the studio from its web address (GitHub Pages) or http://localhost');
      if (!clientId) throw new Error('paste your OAuth client ID first');
      await this.loadGis();
      if (!this.tokenClient || this.clientId !== clientId) {
        this.clientId = clientId;
        this.tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/youtube.upload', callback: () => {} });
      }
      return new Promise((resolve, reject) => {
        this.tokenClient.callback = (r) => {
          if (r.error) { reject(new Error(r.error_description || r.error)); return; }
          this.token = r.access_token; this.expires = Date.now() + (+r.expires_in || 3600) * 1000;
          resolve();
        };
        this.tokenClient.error_callback = (e) => reject(new Error(e && e.type === 'popup_closed' ? 'sign-in window was closed' : (e && e.message) || 'sign-in failed'));
        this.tokenClient.requestAccessToken({ prompt: this.token ? '' : 'consent' });
      });
    },
    disconnect() { if (this.token && window.google) try { google.accounts.oauth2.revoke(this.token, () => {}); } catch (e) { /* ignore */ } this.token = null; this.expires = 0; },
    metadata(snap, res, cfg, publishAt) {
      const v = captionVars(snap, res, cfg);
      const tags = (cfg.hashtags || '').split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean).slice(0, 15);
      const status = { privacyStatus: publishAt ? 'private' : cfg.yt.privacy, selfDeclaredMadeForKids: !!cfg.yt.madeForKids, containsSyntheticMedia: false };
      if (publishAt) status.publishAt = publishAt;
      return {
        snippet: { title: ytTitle(fill(cfg.title, v)) || 'SatisBall #shorts', description: fill(cfg.desc, v).slice(0, 5000), tags, categoryId: String(cfg.yt.category || '24') },
        status,
      };
    },
    /** Real check with Google: is the token valid, for this client, with the upload scope? */
    async verify() {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(this.token));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Google says the sign-in is invalid: ' + (j.error_description || r.status));
      if (!String(j.scope || '').includes('youtube.upload')) throw new Error('signed in, but without YouTube upload permission — reconnect and allow it');
      return { email: j.email, expiresIn: +j.expires_in, scope: j.scope };
    },
    async upload(blob, meta, onProgress) {
      if (!this.connected()) throw new Error('YouTube sign-in expired — press Connect YouTube again');
      const init = await xhr('POST', YT_UPLOAD, {
        headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'video/mp4' },
        body: JSON.stringify(meta),
      });
      if (init.status >= 300) throw new Error(ytError(init));
      // browsers may not expose Location cross-origin; the session URL is the same endpoint + upload_id,
      // and X-GUploader-UploadID is always exposed
      const uid = init.header('X-GUploader-UploadID');
      const url = init.header('Location') || (uid ? `${YT_UPLOAD}&upload_id=${encodeURIComponent(uid)}` : '');
      if (!url) throw new Error('YouTube did not return an upload session');
      const put = await xhr('PUT', url, { headers: { 'Content-Type': blob.type || 'video/mp4' }, body: blob, onProgress });
      if (put.status >= 300) throw new Error(ytError(put));
      const v = json(put.text) || {};
      return { id: v.id, url: v.id ? `https://youtube.com/shorts/${v.id}` : '', privacy: v.status && v.status.privacyStatus };
    },
  };
  function ytError(r) {
    const e = json(r.text), m = e && e.error ? (e.error.errors && e.error.errors[0] && e.error.errors[0].reason) || e.error.message : r.text.slice(0, 160);
    if (r.status === 401) return 'YouTube sign-in expired — connect again';
    if (m === 'quotaExceeded' || m === 'uploadLimitExceeded') return 'YouTube daily upload quota reached — try again tomorrow';
    return `YouTube error ${r.status}: ${m}`;
  }

  // ------------------------------------------------------------------ TikTok (via relay)
  const tiktok = {
    tokens: (() => { try { return JSON.parse(localStorage.getItem(TT_KEY) || 'null'); } catch (e) { return null; } })(),
    save() { try { if (this.tokens) localStorage.setItem(TT_KEY, JSON.stringify(this.tokens)); else localStorage.removeItem(TT_KEY); } catch (e) { /* ignore */ } },
    connected() { return !!(this.tokens && this.tokens.refresh_token && Date.now() < this.tokens.refresh_expires_at); },
    relayBase(relay) { if (!relay) throw new Error('set your TikTok relay URL first (see relay/README.md)'); return relay.replace(/\/+$/, ''); },
    /** Full-page redirect to TikTok's login (through the relay); the relay sends the tokens back in the URL hash. */
    connect(relay) {
      const back = location.href.split('#')[0];
      location.href = `${this.relayBase(relay)}/tiktok/login?return=${encodeURIComponent(back)}`;
    },
    /** Called on page load: picks up '#tt=...' from the relay callback. Returns a message or null. */
    fromHash() {
      const m = location.hash.match(/tt=([A-Za-z0-9_-]+)/), er = location.hash.match(/tterror=([^&]+)/);
      if (!m && !er) return null;
      history.replaceState(null, '', location.pathname + location.search);
      if (er) return 'TikTok login failed: ' + decodeURIComponent(er[1]);
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const t = JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4)));
      this.setTokens(t);
      return 'TikTok connected';
    },
    setTokens(t) {
      const now = Date.now();
      this.tokens = { access_token: t.access_token, refresh_token: t.refresh_token, open_id: t.open_id, scope: t.scope, expires_at: now + (t.expires_in || 86400) * 1000, refresh_expires_at: now + (t.refresh_expires_in || 31536000) * 1000 };
      this.save();
    },
    disconnect() { this.tokens = null; this.creator = null; this.save(); },
    async access(relay) {
      if (!this.connected()) throw new Error('TikTok is not connected');
      if (Date.now() < this.tokens.expires_at - 120e3) return this.tokens.access_token;
      const r = await fetch(`${this.relayBase(relay)}/tiktok/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.tokens.refresh_token }) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.access_token) { throw new Error('TikTok session expired — connect again' + (t.error_description ? ` (${t.error_description})` : '')); }
      this.setTokens(t);
      return t.access_token;
    },
    async api(relay, path, body) {
      const token = await this.access(relay);
      const r = await fetch(`${this.relayBase(relay)}/tiktok/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TikTok-Token': token }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j.error && j.error.code && j.error.code !== 'ok')) throw new Error(`TikTok: ${(j.error && (j.error.message || j.error.code)) || r.status}`);
      return j.data || {};
    },
    /** Creator info (nickname, allowed privacy levels, max duration) — required before a direct post. */
    async creatorInfo(relay) { this.creator = await this.api(relay, 'post/publish/creator_info/query/', {}); return this.creator; },
    async userInfo(relay) { const d = await this.api(relay, 'user/info/', {}); this.user = d.user || d; return this.user; },
    async selftest(relay) {
      const r = await fetch(`${this.relayBase(relay)}/tiktok/selftest`);
      const j = await r.json().catch(() => null);
      if (!j) throw new Error(`relay did not answer (${r.status}) — check the URL`);
      return j;
    },
    chunks(size) {
      const MB = 1024 * 1024;
      if (size <= 64 * MB) return { chunk: size, count: 1 };
      const chunk = 20 * MB; return { chunk, count: Math.floor(size / chunk) }; // the last chunk absorbs the remainder
    },
    async upload(relay, blob, cfg, caption, onProgress, secs) {
      if (!/mp4|quicktime/.test(blob.type) && !cfg.tt.allowWebm) throw new Error('TikTok wants MP4 (H.264). This browser exported WebM — export in Chrome/Edge on a PC, or allow WebM in the TikTok settings');
      if (cfg.tt.mode === 'direct') {
        const cr = this.creator || await this.creatorInfo(relay);
        if (cr.max_video_post_duration_sec && secs > cr.max_video_post_duration_sec) throw new Error(`video is ${Math.round(secs)}s — this account can post up to ${cr.max_video_post_duration_sec}s`);
        if (cr.privacy_level_options && !cr.privacy_level_options.includes(cfg.tt.privacy)) throw new Error(`"${cfg.tt.privacy}" isn't allowed for this account (allowed: ${cr.privacy_level_options.join(', ')})`);
      }
      const { chunk, count } = this.chunks(blob.size);
      const source_info = { source: 'FILE_UPLOAD', video_size: blob.size, chunk_size: chunk, total_chunk_count: count };
      let data;
      if (cfg.tt.mode === 'direct') {
        if (!cfg.tt.privacy) throw new Error('choose who can see TikTok posts first (Export tab → TikTok)');
        data = await this.api(relay, 'post/publish/video/init/', {
          post_info: { title: caption.slice(0, 2200), privacy_level: cfg.tt.privacy, disable_comment: !cfg.tt.comments, disable_duet: !cfg.tt.duet, disable_stitch: !cfg.tt.stitch, video_cover_timestamp_ms: 1000 },
          source_info,
        });
      } else data = await this.api(relay, 'post/publish/inbox/video/init/', { source_info });
      const base = this.relayBase(relay);
      for (let i = 0; i < count; i++) {
        const a = i * chunk, b = i === count - 1 ? blob.size : a + chunk;
        const r = await xhr('PUT', `${base}/tiktok/upload?url=${encodeURIComponent(data.upload_url)}`, {
          headers: { 'Content-Type': blob.type || 'video/mp4', 'Content-Range': `bytes ${a}-${b - 1}/${blob.size}` },
          body: blob.slice(a, b), onProgress: (k) => onProgress && onProgress((a + k * (b - a)) / blob.size),
        });
        if (r.status >= 300) throw new Error(`TikTok upload failed (${r.status}) ${r.text.slice(0, 120)}`);
      }
      return { publish_id: data.publish_id };
    },
    async status(relay, publishId) { return this.api(relay, 'post/publish/status/fetch/', { publish_id: publishId }); },
  };

  // ------------------------------------------------------------------ queue
  /** Uploads run one at a time in the background while the next video renders. */
  class Queue {
    constructor(onChange) { this.items = []; this.busy = false; this.onChange = onChange || (() => {}); }
    add(item) { item.state = 'queued'; item.progress = 0; this.items.unshift(item); if (this.items.length > 60) this.items.pop(); this.onChange(); this.pump(); return item; }
    async pump() {
      if (this.busy) return;
      const next = this.items.slice().reverse().find((i) => i.state === 'queued');
      if (!next) return;
      this.busy = true; next.state = 'uploading'; this.onChange();
      try {
        const out = await next.run((k) => { next.progress = k; this.onChange(); });
        next.state = 'done'; next.result = out;
      } catch (e) { next.state = 'error'; next.error = e.message; }
      this.busy = false; this.onChange(); this.pump();
    }
    retry(item) { if (item.state === 'error') { item.state = 'queued'; item.error = ''; this.onChange(); this.pump(); } }
    pending() { return this.items.filter((i) => i.state === 'queued' || i.state === 'uploading').length; }
  }

  SB.publish = { youtube, tiktok, Queue, fill, captionVars, plainHook };
})(window.SB);
