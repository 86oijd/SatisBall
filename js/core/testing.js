/* SatisBall — headless test helpers (used by tools/test.mjs through Playwright, handy from the console too). */
'use strict';
(function (SB) {
  const T = {};
  function makeGame(modeId, o = {}) {
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const st = SB.app ? SB.app.state : null;
    const cfg = {
      canvas, modeId, seed: o.seed ?? 1234,
      settings: Object.assign({}, SB.modes.byId[modeId].defaults, o.settings || {}),
      look: Object.assign({ palette: 'neon', glow: 0.8, bloom: 0.5, trails: true, shake: 1, particles: 1, ballStyle: 'glossy' }, o.look || {}),
      sound: Object.assign({ theme: 'piano', pattern: 'chords', key: 0, scale: 'majPent', melody: 'ode', octave: 0 }, o.sound || {}),
      text: Object.assign({ showHook: true, hookMode: 'always', hooks: {}, showEnd: true, endText: 'Did you *call it?*', hookSize: 74 }, o.text || {}),
      run: { targetLen: o.targetLen || 35 },
      audioMode: 'capture', engine: SB.engine,
    };
    return new SB.Game(cfg);
  }
  T.makeGame = makeGame;
  /** Does every setting actually change the video? Renders a small frame + stats after `secs` for the
   *  defaults and for each setting changed on its own; returns the settings that made no difference. */
  T.settingsEffect = (modeId, secs = 12, o = {}) => {
    const def = SB.modes.byId[modeId];
    const sig = (settings) => {
      const g = makeGame(modeId, Object.assign({}, o, { settings: Object.assign({}, o.settings || {}, settings), seed: o.seed ?? 777 }));
      const cv = document.createElement('canvas'); cv.width = 108; cv.height = 192;
      let f = 0; const marks = [];
      while (f < secs * 60) { g.frame(); f++; if (f % 120 === 0) marks.push(g.time.toFixed(2) + ':' + JSON.stringify(g.mode.stats ? g.mode.stats() : '')); }
      const small = new SB.Game(Object.assign({}, g.cfg, { canvas: cv, audioMode: 'mute' }));
      for (let i = 0; i < f; i++) small.frame();
      small.render();
      const px = small.ctx.getImageData(0, 0, 108, 192).data; let h = 0;
      for (let i = 0; i < px.length; i += 7) h = (h * 31 + px[i]) >>> 0;
      return h + '|' + marks.join(',') + '|' + (g.winInfo ? g.winInfo.title + g.time.toFixed(2) : '') + '|' + g.snd.events.length;
    };
    const base = sig({});
    const alt = (s) => {
      if (s.type === 'range') { const d = def.defaults[s.key]; return d === s.max ? s.min : s.max; }
      if (s.type === 'select') { const o2 = s.options.find(([v]) => String(v) !== String(def.defaults[s.key])); return o2 ? o2[0] : def.defaults[s.key]; }
      if (s.type === 'toggle') return !def.defaults[s.key];
      if (s.type === 'color') return '#12ab34';
      if (s.type === 'text') return 'TESTNAME';
      return null;
    };
    const dead = [];
    for (const s of def.settings) {
      // a setting that is only shown under other conditions is tested with those conditions met
      const st = { [s.key]: alt(s) };
      if (s.show && !s.show(Object.assign({}, def.defaults, o.settings || {}, st))) continue;
      if (sig(st) === base) dead.push(s.key);
    }
    return dead;
  };
  /** Simulate a run to completion (or maxSecs) without rendering. Returns summary stats. */
  T.simulate = (modeId, o = {}) => {
    const g = makeGame(modeId, o);
    const maxFrames = (o.maxSecs || 130) * 60;
    let f = 0, finishedAt = null;
    const t0 = performance.now();
    let worst = 0;
    for (; f < maxFrames; f++) {
      const a = performance.now();
      g.frame();
      const d = performance.now() - a; if (d > worst) worst = d;
      if (g.state !== 'play' && finishedAt === null) finishedAt = g.clock;
      if (g.state === 'done') break;
      if (o.renderEvery && f % o.renderEvery === 0) g.render();
    }
    const stats = g.mode.stats ? g.mode.stats() : {};
    return {
      modeId, seed: g.seed, finishedAt, done: g.state === 'done', frames: f, simMs: Math.round(performance.now() - t0),
      worstFrameMs: +worst.toFixed(2), events: g.snd.events.length, win: g.winInfo ? g.winInfo.title : null, stats,
    };
  };
  /** Render a snapshot at time t (seconds) and return a PNG data URL (scaled down). */
  T.snapshot = (modeId, t, o = {}) => {
    const g = makeGame(modeId, o);
    const frames = Math.round(t * 60);
    for (let i = 0; i < frames; i++) { g.frame(); if (g.state === 'done') break; }
    g.render();
    const c = document.createElement('canvas'); const k = o.scale || 0.5;
    c.width = 1080 * k; c.height = 1920 * k;
    c.getContext('2d').drawImage(g.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };
  /** Measure average render+sim time per frame over n frames starting at t. */
  T.perf = (modeId, t, n = 120, o = {}) => {
    const g = makeGame(modeId, o);
    for (let i = 0; i < t * 60; i++) g.frame();
    const a = performance.now();
    let worst = 0;
    for (let i = 0; i < n; i++) { const b = performance.now(); g.frame(); g.render(); worst = Math.max(worst, performance.now() - b); }
    return { avg: +((performance.now() - a) / n).toFixed(2), worst: +worst.toFixed(2) };
  };
  /** Simulate a run, render its soundtrack offline and report levels (and optionally a WAV data URL). */
  T.audio = async (modeId, o = {}) => {
    const g = makeGame(modeId, o);
    let f = 0; while (g.state !== 'done' && f < 130 * 60) { g.frame(); f++; }
    const dur = f / 60;
    const buf = await SB.engine.renderOffline(g.snd.events, dur);
    let peak = 0, sum = 0, clip = 0, n = 0;
    const win = new Float32Array(Math.ceil(buf.length / 4800));
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a > 0.999) clip++; sum += d[i] * d[i]; n++; win[(i / 4800) | 0] = Math.max(win[(i / 4800) | 0], a); } }
    const silent = Array.from(win).filter((x) => x < 0.01).length;
    const out = { modeId, dur: +dur.toFixed(1), events: g.snd.events.length, peak: +peak.toFixed(3), rmsDb: +(10 * Math.log10(sum / n)).toFixed(1), clipped: clip, silentTenths: silent };
    if (o.wav) {
      const L = buf.getChannelData(0), R = buf.getChannelData(1), len = Math.min(buf.length, (o.wavSecs || 12) * 48000);
      const ab = new ArrayBuffer(44 + len * 4), v = new DataView(ab);
      const w = (o2, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o2 + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + len * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
      v.setUint32(24, 48000, true); v.setUint32(28, 48000 * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 4, true);
      for (let i = 0; i < len; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
      let bin = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      out.wav = 'data:audio/wav;base64,' + btoa(bin);
    }
    return out;
  };
  /** Run a mode and collect physics invariant violations each frame + energy drift for locked bouncers. */
  T.audit = (modeId, o = {}) => {
    const g = makeGame(modeId, o);
    const found = {}; let f = 0;
    while (g.state !== 'done' && f < 130 * 60) {
      g.frame(); f++;
      if (g.mode.audit) for (const v of g.mode.audit()) found[v] = (found[v] || 0) + 1;
    }
    return { modeId, seed: g.seed, secs: +(f / 60).toFixed(1), violations: found };
  };
  SB.test = T;
})(window.SB);
