/* SatisBall — Autopilot: leave a laptop running and it makes and posts videos by itself.
 * Every N hours: run the seed finder over every chosen mode (e.g. 5000 seeds total), pick the most
 * entertaining run (compared fairly across modes), render it, upload it to YouTube / TikTok, log it,
 * and sleep until the next slot. Its schedule and log live in localStorage, so a reload or reboot
 * picks up where it left off. Mixed into SB.UI (uses its snapshot/export/publish helpers). */
'use strict';
(function (SB) {
  const { RNG, clamp } = SB.util;
  const KEY = 'satisball.autopilot.v1';
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };
  const load = () => { try { return Object.assign({ nextAt: 0, log: [], posted: [] }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return { nextAt: 0, log: [], posted: [] }; } };
  const store = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage full: drop old log */ s.log = s.log.slice(0, 50); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e2) { /* ignore */ } } };
  const fmtDur = (ms) => { ms = Math.max(0, ms); const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1000); return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`; };

  const Auto = {
    // ------------------------------------------------------------ settings panel (Export tab)
    autopilotSection(p) {
      const A = this.state.autopilot, set = (k, v, re) => { A[k] = v; this.save(); if (re) this.renderPanels(); };
      const P = this.state.publish, yt = SB.publish.youtube, tt = SB.publish.tiktok;
      const ytReady = P.yt.clientId && yt.persistent(), ttReady = P.tt.relay && tt.connected();
      const modes = A.modes.length ? A.modes : SB.modes.list.map((m) => m.id);
      const picks = el('div', { class: 'mchecks' }, this.orderedModes().map((m) => el('label', { class: 'mcheck' },
        el('input', { type: 'checkbox', checked: modes.includes(m.id), onchange: (e) => { const cur = A.modes.length ? A.modes : SB.modes.list.map((x) => x.id); A.modes = e.target.checked ? [...new Set(cur.concat(m.id))] : cur.filter((x) => x !== m.id); this.save(); } }), m.icon + ' ' + m.name)));
      const rt = load();
      this.section(p, '🤖 Autopilot — runs 24/7 and posts by itself',
        el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Every few hours it searches thousands of seeds across your chosen modes, renders the most entertaining run and uploads it. Leave this page open on a plugged-in laptop (see AUTOPILOT.md for the launcher and power settings).'),
        this.ctlRange('Seeds per search (all modes together)', A.seeds, 100, 20000, 100, (v) => set('seeds', v)),
        this.ctlRange('Run every', A.every, 0.5, 24, 0.5, (v) => set('every', v), (v) => v + ' h'),
        this.ctlRange('Search time limit', A.budgetMin, 5, 240, 5, (v) => set('budgetMin', v), (v) => v + ' min (stops early if slow)'),
        this.ctlToggle('Vary mode settings while searching', A.vary, (v) => set('vary', v)),
        this.ctlToggle('Random palette & sound for each video', A.randomLook, (v) => set('randomLook', v)),
        this.ctlToggle('Avoid posting the same mode twice in a row', A.variety, (v) => set('variety', v)),
        this.ctlRange('Video length', A.minLen, 10, 120, 1, (v) => set('minLen', v), (v) => 'at least ' + v + 's'),
        this.ctlRange(' ', A.maxLen, 20, 180, 5, (v) => set('maxLen', v), (v) => 'at most ' + v + 's'),
        el('div', { class: 'ctl' }, el('label', {}, el('span', {}, 'Modes to use')), picks),
        this.ctlRange('YouTube uploads per day (max)', A.ytCap, 0, 20, 1, (v) => set('ytCap', v), (v) => (v ? v + ' / 24h' : 'off')),
        this.ctlRange('TikTok uploads per day (max)', A.ttCap, 0, 20, 1, (v) => set('ttCap', v), (v) => (v ? v + ' / 24h' : 'off')),
        this.ctlToggle('Also download a copy of every video', A.keepCopy, (v) => set('keepCopy', v)),
        el('p', { class: ytReady ? 'note' : 'warn' }, ytReady ? '✓ YouTube: stays signed in via the relay' : 'YouTube: use “Connect via relay (stays signed in)” above — normal sign-in expires after an hour'),
        el('p', { class: ttReady ? 'note' : 'warn' }, ttReady ? `✓ TikTok: connected (${P.tt.mode === 'direct' ? 'direct posts' : 'inbox drafts'})` : 'TikTok: not connected (videos will only go to YouTube)'),
        el('p', { class: 'note' }, `Defaults respect the platforms' limits: YouTube's standard quota is ~6 uploads/day, TikTok allows ~5 pending inbox drafts/day.${rt.log.length ? ` Last run: ${new Date(rt.log[0].at).toLocaleString()} — ${rt.log[0].title || rt.log[0].error || ''}` : ''}`),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary big', onclick: () => { A.enabled = true; this.save(); this.startAutopilot(); } }, '▶ Start autopilot'),
          el('button', { class: 'btn', onclick: () => { A.enabled = true; const r = load(); r.nextAt = 0; store(r); this.save(); this.startAutopilot(); } }, 'Start & run now')));
    },

    // ------------------------------------------------------------ dashboard
    autopilotDash() {
      if (this.$ap) return this.$ap;
      const stop = el('button', { class: 'btn', onclick: () => this.stopAutopilot() }, '■ Stop autopilot');
      const now = el('button', { class: 'btn primary', onclick: () => { const r = load(); r.nextAt = 0; store(r); this.apWake && this.apWake(); } }, 'Run now');
      this.$apStatus = el('h2', {}, 'Autopilot');
      this.$apLine = el('p', { class: 'status' }, '');
      this.$apBar = el('div', { class: 'bar' }, el('i'));
      this.$apBest = el('div', { class: 'plist' });
      this.$apLog = el('div', { class: 'plist' });
      this.$ap = el('div', { class: 'autopilot' }, el('div', { class: 'ap-card' },
        el('div', { class: 'ap-head' }, el('span', { class: 'logo' }, el('i'), el('i'), el('i')), this.$apStatus),
        this.$apLine, this.$apBar,
        el('h4', {}, 'Best runs this search'), this.$apBest,
        el('h4', {}, 'Recent posts'), this.$apLog,
        el('div', { class: 'row' }, now, stop),
        el('p', { class: 'note' }, 'Keep this window open, plugged in, with sleep turned off. Closing or reloading is safe — it resumes on the next start.')));
      document.body.append(this.$ap);
      return this.$ap;
    },
    apSet(status, line, prog) {
      this.autopilotDash();
      this.$apStatus.textContent = status; this.$apLine.textContent = line || '';
      this.$apBar.firstChild.style.width = ((prog ?? 0) * 100).toFixed(1) + '%';
      document.title = `SatisBall · ${status}`;
    },
    apRenderLog() {
      const rt = load();
      this.$apLog.innerHTML = '';
      if (!rt.log.length) this.$apLog.append(el('p', { class: 'note' }, 'Nothing posted yet.'));
      for (const e of rt.log.slice(0, 12)) {
        const m = SB.modes.byId[e.modeId];
        this.$apLog.append(el('div', { class: 'pitem' }, el('div', { class: 'pload' }, el('span', {}, m ? m.icon : '•'),
          el('b', {}, e.error ? '✕ ' + e.error : `${e.title} · score ${e.score}`),
          el('small', {}, `${new Date(e.at).toLocaleString()}${m ? ' · ' + m.name : ''}${e.seed ? ' · #' + e.seed : ''}${e.uploads && e.uploads.length ? ' · ' + e.uploads.join(' · ') : ''}`))));
      }
    },

    // ------------------------------------------------------------ run loop
    async startAutopilot() {
      if (this.apRunning) return;
      this.apRunning = true; this.apStop = false;
      this.exporting = true; // freezes the live preview so every CPU cycle goes to the search
      document.body.classList.add('ap-on');
      this.$modal.classList.add('hidden');
      if (this.$splash && this.$splash.isConnected) this.$splash.remove();
      this.autopilotDash(); this.apRenderLog();
      this.keepAwake();
      while (!this.apStop) {
        const rt = load(), wait = rt.nextAt - Date.now();
        if (wait > 0) {
          this.apSet('Autopilot · waiting', `Next search in ${fmtDur(wait)} (at ${new Date(rt.nextAt).toLocaleTimeString()})`, 0);
          await new Promise((r) => { this.apWake = r; setTimeout(r, Math.min(wait, 15e3)); });
          continue;
        }
        const start = Date.now();
        rt.nextAt = start + this.state.autopilot.every * 3600e3; store(rt); // schedule first, so a crash can't make it loop
        try { await this.autopilotCycle(); } catch (e) { this.apLog({ error: e.message }); console.error(e); }
        this.apRenderLog();
      }
      this.apRunning = false; this.exporting = false;
      document.body.classList.remove('ap-on');
      if (this.$ap) { this.$ap.remove(); this.$ap = null; }
      document.title = 'SatisBall Studio';
      if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
    },
    stopAutopilot() {
      this.apStop = true; this.state.autopilot.enabled = false; this.save();
      if (this.apWake) this.apWake();
      this.apSet('Autopilot · stopping…', 'Finishing the current step', 0);
    },
    async keepAwake() {
      const req = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed here */ } };
      await req();
      if (!this._wlBound) { this._wlBound = true; document.addEventListener('visibilitychange', () => { if (this.apRunning) req(); }); }
    },
    apLog(entry) {
      const rt = load();
      rt.log.unshift(Object.assign({ at: Date.now() }, entry)); rt.log = rt.log.slice(0, 200);
      if (entry.key) rt.posted = [entry.key].concat(rt.posted).slice(0, 5000);
      store(rt);
    },
    uploadsInLastDay(platform) { return load().log.filter((e) => Date.now() - e.at < 86400e3 && e.uploads && e.uploads.some((u) => u.startsWith(platform + ' ✓'))).length; },

    /** One cycle: search -> pick -> render -> upload -> log. */
    async autopilotCycle() {
      const A = this.state.autopilot, P = this.state.publish;
      const ids = (A.modes.length ? A.modes : SB.modes.list.map((m) => m.id)).filter((id) => SB.modes.byId[id]);
      if (!ids.length) throw new Error('no modes selected');
      // don't burn an hour searching for a video no platform can take right now
      const Y = A.ytCap > 0 && P.yt.clientId && SB.publish.youtube.connected(), Tt = A.ttCap > 0 && P.tt.relay && SB.publish.tiktok.connected();
      if ((Y || Tt) && (!Y || this.uploadsInLastDay('YouTube') >= A.ytCap) && (!Tt || this.uploadsInLastDay('TikTok') >= A.ttCap)) {
        this.apLog({ error: 'skipped: every connected platform is at its daily upload cap' });
        return;
      }
      const rng = new RNG((Math.random() * 1e9) >>> 0);
      const order = rng.shuffle(ids.slice());
      const per = Math.max(1, Math.floor(A.seeds / order.length));
      const deadline = Date.now() + A.budgetMin * 60e3, t0 = Date.now();
      const posted = new Set(load().posted);
      const perMode = {}; let done = 0, total = per * order.length;
      this.apSet('Autopilot · searching', 'Starting…', 0);
      for (let mi = 0; mi < order.length && !this.apStop; mi++) {
        const modeId = order[mi];
        const base = this.autopilotBase(modeId);
        const scores = [], top = [];
        // each mode gets an equal share of whatever time is left
        const modeDeadline = Date.now() + (deadline - Date.now()) / (order.length - mi);
        await SB.seedFinder.run({ count: per, base, vary: A.vary, cfgFrom: (s, c, m) => this.cfgFrom(s, c, m), isCancelled: () => this.apStop || Date.now() > modeDeadline }, (r) => {
          done++; scores.push(r.score);
          const key = r.snap.modeId + ':' + r.snap.seed + ':' + JSON.stringify(r.snap.settings);
          if (r.secs && r.secs >= A.minLen && r.secs <= A.maxLen && !posted.has(key)) { r.key = key; top.push(r); top.sort((a, b) => b.score - a.score); if (top.length > 3) top.pop(); }
          if (done % 5 === 0) {
            const el2 = (Date.now() - t0) / 1000, rate = done / Math.max(1, el2);
            this.apSet('Autopilot · searching', `${SB.modes.byId[modeId].icon} ${SB.modes.byId[modeId].name} (${mi + 1}/${order.length}) · ${done.toLocaleString()} / ${total.toLocaleString()} seeds · ${rate.toFixed(1)}/s · ${fmtDur(deadline - Date.now())} budget left`, done / total);
          }
        });
        const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
        const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, scores.length)) || 1;
        perMode[modeId] = { mean, sd, top, n: scores.length };
        this.apShowBest(perMode);
      }
      if (this.apStop) return;
      // fair pick across modes: raw score plus how exceptional the run is for its own mode, with a variety nudge
      const recent = load().log.filter((e) => e.modeId).slice(0, 3).map((e) => e.modeId);
      let best = null, bestV = -1;
      for (const [modeId, st] of Object.entries(perMode)) for (const r of st.top) {
        const z = (r.score - st.mean) / st.sd;
        let v = 0.6 * r.score / 100 + 0.4 * clamp(z / 3, 0, 1);
        if (A.variety && recent[0] === modeId) v *= 0.55; else if (A.variety && recent.includes(modeId)) v *= 0.85;
        if (v > bestV) { bestV = v; best = r; }
      }
      if (!best) throw new Error(`no run between ${A.minLen}s and ${A.maxLen}s found in ${done} seeds — widen the length window`);
      const snap = best.snap;
      if (A.randomLook) this.randomLook(new RNG(snap.seed ^ 0x51ab), snap);
      const def = SB.modes.byId[snap.modeId];
      // render
      this.apSet('Autopilot · rendering', `${def.icon} ${def.name} #${snap.seed} · score ${best.score}`, 0);
      const res = await SB.recorder.exportRun(this.cfgFrom(snap, null, 'capture'), Object.assign({}, this.exportOpts(), {
        maxSecs: this.maxSecsFor(snap),
        onProgress: (k, txt) => this.apSet('Autopilot · rendering', `${def.icon} ${def.name} #${snap.seed} · score ${best.score} · ${txt}`, k),
        isCancelled: () => this.apStop,
      }));
      const name = this.fileName(snap, res.ext);
      if (A.keepCopy) SB.recorder.download(res.blob, name);
      SB.library.history.push({ snap, at: Date.now(), secs: +res.duration.toFixed(1), title: res.winner || '' });
      // upload (respecting the daily caps)
      const uploads = [], items = [];
      const ytOn = A.ytCap > 0 && P.yt.clientId && SB.publish.youtube.connected(), ttOn = A.ttCap > 0 && P.tt.relay && SB.publish.tiktok.connected();
      if (ytOn && this.uploadsInLastDay('YouTube') < A.ytCap) items.push(['YouTube', this.enqueueYouTube(res, snap, name)]); else if (ytOn) uploads.push('YouTube skipped (daily cap)');
      if (ttOn && this.uploadsInLastDay('TikTok') < A.ttCap) items.push(['TikTok', this.enqueueTikTok(res, snap, name)]); else if (ttOn) uploads.push('TikTok skipped (daily cap)');
      if (!ytOn && !ttOn) uploads.push('no platform connected — video not uploaded');
      while (items.some(([, it]) => it.state === 'queued' || it.state === 'uploading') && !this.apStop) {
        const up = items.find(([, it]) => it.state === 'uploading');
        this.apSet('Autopilot · uploading', up ? `${up[0]} ${Math.round(up[1].progress * 100)}%` : 'waiting for upload', up ? up[1].progress : 0);
        await SB.util.pause(1000);
      }
      for (const [plat, it] of items) uploads.push(it.state === 'done' ? `${plat} ✓${it.result && it.result.url ? ' ' + it.result.url : ''}` : `${plat} failed: ${it.error || it.state}`);
      this.apLog({ modeId: snap.modeId, seed: snap.seed, score: best.score, title: res.winner || def.name, secs: +res.duration.toFixed(1), uploads, key: best.key, searched: done, tookMin: +((Date.now() - t0) / 60e3).toFixed(1) });
    },
    /** The run template for a mode: current look/sound/text, that mode's saved settings, default hook. */
    autopilotBase(modeId) {
      const snap = this.snapshot();
      snap.modeId = modeId;
      snap.settings = this.modeSettings(modeId);
      return snap;
    },
    apShowBest(perMode) {
      const all = [];
      for (const st of Object.values(perMode)) for (const r of st.top) all.push(r);
      all.sort((a, b) => b.score - a.score);
      this.$apBest.innerHTML = '';
      for (const r of all.slice(0, 6)) {
        const m = SB.modes.byId[r.snap.modeId];
        this.$apBest.append(el('div', { class: 'pitem' }, el('div', { class: 'pload' }, el('span', {}, m.icon), el('b', {}, `${r.score} · ${r.title}`), el('small', {}, `${m.name} · #${r.snap.seed} · ${Math.round(r.secs)}s`))));
      }
    },
  };

  Object.assign(SB.UI.prototype, Auto);
})(window.SB);
