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
  SB.test = T;
})(window.SB);
