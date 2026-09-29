/* SatisBall — Seed Finder: simulates many seeds invisibly (no rendering, no sound) and scores how
 * entertaining each run is, from what the director logged: the tension curve, key moments
 * (slow-mo / zoom beats), close calls, how late the drama lands and how close the length is to the target. */
'use strict';
(function (SB) {
  const { clamp } = SB.util;
  const W = { pace: 20, build: 20, climax: 15, drama: 20, late: 15, danger: 10 };

  /** Score a finished game 0-100, with the parts that made it up. */
  function score(g) {
    if (!g.winInfo) return { score: 0, parts: {}, why: 'never finished' };
    const L = g.log, d = g.finishedAt || g.time, T = g.targetLen, S = L.samples;
    const seg = (a, b) => { const xs = S.filter(([t]) => t >= a * d && t <= b * d).map((x) => x[1]); return xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : 0; };
    const parts = {
      pace: Math.exp(-(((d - T * 0.95) / (0.35 * T)) ** 2)),                          // lands near the target length
      build: clamp((seg(0.66, 1) - seg(0, 0.33)) * 1.6, 0, 1),                         // tension rises over the run
      climax: clamp(seg(0.8, 1) * 1.15, 0, 1),                                          // the ending is tense
      drama: clamp((L.moments.length + L.banners * 0.5) / Math.max(1, d) * 10 / 3, 0, 1), // beats per 10 s
      late: clamp(L.moments.filter((t) => t > d * 0.75).length / 2, 0, 1),              // big moments near the end
      danger: clamp(S.filter((x) => x[2] > 0).length / Math.max(1, S.length) * 4, 0, 1), // close calls
    };
    let total = 0; for (const k in W) total += W[k] * parts[k];
    if (L.forced) total *= 0.6; // had to be forced to finish
    return { score: Math.round(total), parts, secs: d };
  }

  /** Run seeds; calls onResult(result) for each. o: { count, base (snapshot), vary (randomise settings), cfgFrom, isCancelled } */
  async function run(o, onResult) {
    const rng = new SB.util.RNG((Math.random() * 1e9) >>> 0);
    const def = SB.modes.byId[o.base.modeId];
    const maxSecs = def.longForm ? 215 : Math.max(75, (o.base.targetLen || 35) * 2.2 + 8);
    const cv = document.createElement('canvas'); cv.width = 108; cv.height = 192;
    for (let i = 0; i < o.count; i++) {
      if (o.isCancelled && o.isCancelled()) break;
      const snap = JSON.parse(JSON.stringify(o.base));
      snap.seed = rng.int(1, 2 ** 31 - 1);
      if (o.vary) snap.settings = SB.modes.randomize(def, rng, def.defaults);
      const g = new SB.Game(o.cfgFrom(snap, cv, 'mute'));
      const orig = g.win.bind(g);
      g.win = (info) => { if (g.state === 'play') g.finishedAt = g.time; orig(info); };
      let f = 0;
      while ((g.state === 'play' || g.state === 'intro') && f < maxSecs * 60) { g.frame(); f++; if (f % 1500 === 0) await SB.util.yieldNow(); }
      const s = score(g);
      onResult(Object.assign({ i, snap, title: g.winInfo ? g.winInfo.title : 'no finish', curve: g.log.samples.map((x) => x[1]) }, s));
      await SB.util.yieldNow();
    }
  }

  SB.seedFinder = { score, run, WEIGHTS: W };
})(window.SB);
