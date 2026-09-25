/* SatisBall — the Game runtime: fixed-step simulation, director (hook, finale, slow-mo), render pipeline.
 *
 * Determinism: the simulation always advances in fixed 1/240 s steps and only uses the seeded RNG,
 * so a (mode, settings, seed) triple replays identically live and during frame-perfect export.
 * Presentation time (`clock`) keeps running at real speed during slow-motion; audio is stamped with it.
 */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, mix, lighten, darken, easeOutBack, easeOutCubic, RNG } = SB.util;
  const draw = SB.draw;
  const W = 1080, H = 1920, STEP = 1 / 240;

  // ------------------------------------------------------------------ mode registry
  const modes = { list: [], byId: {} };
  modes.register = (def) => {
    def.defaults = {};
    for (const s of def.settings) def.defaults[s.key] = s.def;
    modes.list.push(def); modes.byId[def.id] = def;
  };
  /** Randomise a mode's settings within each setting's `rand` range (or its full range). */
  modes.randomize = (def, rng, current) => {
    const out = Object.assign({}, current);
    for (const s of def.settings) {
      if (s.rand === false) continue;
      if (s.type === 'range') {
        const [a, b] = s.rand || [s.min, s.max];
        let v = rng.range(a, b);
        v = Math.round(v / s.step) * s.step;
        out[s.key] = +clamp(v, s.min, s.max).toFixed(4);
      } else if (s.type === 'select') {
        const opts = s.rand || s.options.map((o) => o[0]);
        out[s.key] = rng.pick(opts);
      } else if (s.type === 'toggle') out[s.key] = rng.chance(s.rand ?? 0.5);
    }
    return out;
  };
  SB.modes = modes;

  // ------------------------------------------------------------------ background cache
  const bgCache = new Map();
  function baseBackground(pal) {
    let c = bgCache.get(pal.id);
    if (c) return c;
    c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, W * 0.3, H);
    gr.addColorStop(0, pal.bg[0]); gr.addColorStop(0.55, pal.bg[1]); gr.addColorStop(1, pal.bg[2]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // vignette
    const v = g.createRadialGradient(W / 2, H * 0.48, H * 0.25, W / 2, H * 0.5, H * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, pal.light ? 'rgba(120,60,120,0.12)' : 'rgba(0,0,0,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    // faint dot grid (gives depth without noise)
    g.fillStyle = pal.light ? 'rgba(60,20,90,0.06)' : 'rgba(255,255,255,0.035)';
    for (let y = 30; y < H; y += 60) for (let x = 30; x < W; x += 60) { g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill(); }
    bgCache.set(pal.id, c);
    return c;
  }
  const blobCache = new Map();
  function blob(color) {
    let c = blobCache.get(color);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, rgba(color, 0.5)); gr.addColorStop(0.5, rgba(color, 0.16)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    blobCache.set(color, c);
    return c;
  }

  // ------------------------------------------------------------------ Game
  class Game {
    /**
     * cfg: { modeId, settings, look, sound, text, run, seed, audioMode: 'live'|'capture'|'mute', engine, canvas }
     */
    constructor(cfg) {
      this.cfg = cfg;
      this.W = W; this.H = H;
      this.canvas = cfg.canvas;
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.def = modes.byId[cfg.modeId] || modes.list[0];
      this.pal = SB.palettes.get(cfg.look.palette);
      this.look = Object.assign({ glow: 0.8, trails: true, shake: 1, particles: 1, ballStyle: 'glossy', bloom: 0.5 }, cfg.look, { light: !!this.pal.light });
      this.soundCfg = cfg.sound;
      this.textCfg = cfg.text;
      this.targetLen = cfg.run.targetLen || 35;
      this.seed = cfg.seed >>> 0;
      this.rng = new RNG(this.seed);
      this.fx = new SB.FX(this);
      this.snd = new SB.audio.SoundOut(cfg.engine, this, cfg.audioMode || 'live');
      this.music = new SB.audio.Music(this, cfg.sound);
      this.cam = { x: 0, y: 0, zoom: 1 };
      this.time = 0; this.clock = 0; this.steps = 0;
      this.timeScale = 1; this.slowT = 0; this.slowTarget = 1;
      this.hitstopT = 0;
      this.tension = 0;
      this.state = 'play';
      this.winInfo = null; this.finaleAt = 0; this.outro = 3.4;
      this.onDone = null;
      this.bloomCv = document.createElement('canvas'); this.bloomCv.width = W / 4; this.bloomCv.height = H / 4;
      this.bloomCtx = this.bloomCv.getContext('2d');
      this.hookCache = null;
      this.settings = Object.assign({}, this.def.defaults, cfg.settings || {});
      this.mode = this.def.create(this, this.settings);
      this.mode.init && this.mode.init();
    }
    get pace() { return this.time / this.targetLen; }
    pan(x) { return clamp((x - this.cam.x) / W * 2 - 1, -1, 1); }

    // ---------------- director API used by modes
    slowmo(scale, dur) { this.slowTarget = scale; this.slowT = dur; }
    hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
    shake(a) { this.fx.shake(a * this.look.shake); }
    win(info) {
      if (this.state !== 'play') return;
      this.state = 'finale'; this.finaleAt = this.clock; this.winInfo = info;
      this.slowmo(info.slow ?? 0.3, info.slowDur ?? 1.1);
      this.fx.flash(info.color || '#ffffff', 0.55);
      this.shake(0.7);
      this.fx.kick(0.05);
      const cols = this.pal.balls.map((b) => b.c);
      this.fx.confetti(this.cam.x + 80, this.cam.y + H * 0.8, 90, cols, { dir: -Math.PI / 2 + 0.45, spread: 0.45, power: 1.3 });
      this.fx.confetti(this.cam.x + W - 80, this.cam.y + H * 0.8, 90, cols, { dir: -Math.PI / 2 - 0.45, spread: 0.45, power: 1.3 });
      this.snd.sfx('boom', 1, 0); this.snd.sfx('shimmer', 0.7, 0, 1, 0.1);
      this.music.fanfare(0.08);
    }

    // ---------------- simulation
    step() {
      this.clock += STEP; this.steps++;
      // slow-motion easing (presentation time)
      if (this.slowT > 0) { this.slowT -= STEP; this.timeScale = lerp(this.timeScale, this.slowTarget, 0.08); }
      else this.timeScale = lerp(this.timeScale, 1, 0.03);
      let dt = STEP * this.timeScale;
      if (this.hitstopT > 0) { this.hitstopT -= STEP; dt = 0; }
      if (dt > 0) {
        this.time += dt;
        this.mode.update(dt);
      }
      this.fx.update(dt, STEP);
      if ((this.steps & 1) === 0 && this.look.trails) this.sampleTrails();
      if (this.state === 'play' && this.time > this.targetLen * 1.9 && this.mode.forceEnd) this.mode.forceEnd();
      if (this.state === 'finale' && this.clock - this.finaleAt > this.outro) { this.state = 'done'; this.onDone && this.onDone(); }
    }
    sampleTrails() {
      const balls = this.mode.trailBalls ? this.mode.trailBalls() : null;
      if (!balls) return;
      const len = this.mode.trailLen || 14;
      for (const b of balls) {
        if (!b.alive) { if (b.trail.length) b.trail.shift(); continue; }
        b.trail.push([b.x, b.y]);
        if (b.trail.length > len) b.trail.shift();
      }
    }
    /** Advance one video frame (1/60 s) of presentation time. */
    frame() { for (let i = 0; i < 4; i++) this.step(); }

    // ---------------- rendering
    render() {
      const ctx = this.ctx, pal = this.pal, look = this.look;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(baseBackground(pal), 0, 0);
      // drifting glow blobs + dust (derived from clock only -> deterministic)
      const t = this.clock;
      ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
      const b1 = blob(pal.glow[0]), b2 = blob(pal.glow[1]);
      const pulse = 1 + this.tension * 0.35;
      ctx.globalAlpha = 0.55 * pulse;
      ctx.drawImage(b1, W * 0.1 + Math.sin(t * 0.21) * 160 - 700, H * 0.25 + Math.cos(t * 0.17) * 200 - 700, 1400, 1400);
      ctx.drawImage(b2, W * 0.9 + Math.cos(t * 0.19) * 160 - 700, H * 0.78 + Math.sin(t * 0.23) * 200 - 700, 1400, 1400);
      ctx.globalAlpha = pal.light ? 0.25 : 0.5;
      ctx.fillStyle = pal.light ? darken(pal.dim, 0.2) : '#ffffff';
      for (let i = 0; i < 36; i++) {
        const sx = ((i * 7919) % 1000) / 1000, sy = ((i * 104729) % 1000) / 1000, sp = 8 + (i % 5) * 5;
        const x = (sx * W + Math.sin(t * 0.3 + i) * 30) % W;
        const y = ((sy * H - t * sp - this.cam.y * 0.15) % H + H) % H;
        const r = 1 + (i % 3) * 0.8;
        ctx.globalAlpha = (pal.light ? 0.15 : 0.22) * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1));
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

      // world
      const tr = this.fx.trauma * this.fx.trauma;
      const sh = 26 * tr;
      const sx = sh * Math.sin(t * 57.3) * Math.cos(t * 31.1), sy = sh * Math.cos(t * 49.7) * Math.sin(t * 23.9);
      const rot = 0.012 * tr * Math.sin(t * 41.2);
      const z = this.cam.zoom * (1 + this.fx.zoomKick);
      ctx.save();
      ctx.translate(W / 2 + sx, H / 2 + sy); ctx.rotate(rot); ctx.scale(z, z); ctx.translate(-W / 2 - this.cam.x, -H / 2 - this.cam.y);
      this.mode.render(ctx);
      this.fx.render(ctx);
      ctx.restore();

      // bloom
      if (!pal.light && look.bloom > 0) {
        const bc = this.bloomCtx;
        bc.globalCompositeOperation = 'copy';
        bc.filter = 'blur(7px)';
        bc.drawImage(this.canvas, 0, 0, W / 4, H / 4);
        bc.filter = 'none';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = look.bloom * 0.55;
        ctx.drawImage(this.bloomCv, 0, 0, W, H);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }

      // screen-space overlay
      if (this.mode.hud) this.mode.hud(ctx);
      this.renderHook(ctx);
      this.fx.renderScreen(ctx, W, H);
      if (this.state !== 'play') this.renderWinner(ctx);
    }
    renderHook(ctx) {
      const tc = this.textCfg;
      if (!tc.showHook) return;
      const text = (tc.hooks && tc.hooks[this.def.id]) ?? this.def.hook;
      if (!text) return;
      if (tc.hookMode === 'intro' && this.clock > 4.2) return;
      const key = text + '|' + this.pal.id + '|' + tc.hookSize;
      if (!this.hookCache || this.hookCache.key !== key) {
        const c = document.createElement('canvas'); c.width = W; c.height = 420;
        const g = c.getContext('2d');
        // auto-fit: shrink to stay on one line where possible (keeps the HUD below clear)
        let size = tc.hookSize || 74;
        draw.font(g, size, 900);
        const w = g.measureText(text.replace(/\*/g, '')).width;
        if (w > 940) size = Math.max(54, Math.floor(size * 940 / w));
        draw.text(g, text, W / 2, 20, { size, color: this.pal.light ? this.pal.text : '#ffffff', highlight: this.pal.accent, maxWidth: 940, stroke: this.pal.light ? 0 : 12, strokeColor: 'rgba(0,0,0,0.35)', shadowColor: this.pal.light ? 'rgba(80,30,90,0.18)' : 'rgba(0,0,0,0.5)' });
        this.hookCache = { key, c };
      }
      const k = clamp(this.clock / 0.45, 0, 1);
      let s = easeOutBack(k), a = Math.min(1, k * 2);
      if (tc.hookMode === 'intro' && this.clock > 3.7) a = Math.max(0, 1 - (this.clock - 3.7) / 0.5);
      if (this.state !== 'play') a *= Math.max(0, 1 - (this.clock - this.finaleAt) / 0.4);
      if (a <= 0) return;
      const y = this.mode.hookY ?? this.def.hookY ?? 205;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, y); ctx.scale(s, s);
      ctx.drawImage(this.hookCache.c, -W / 2, -20);
      ctx.restore();
    }
    renderWinner(ctx) {
      const w = this.winInfo; if (!w) return;
      const k = clamp((this.clock - this.finaleAt) / 0.55, 0, 1);
      const s = easeOutBack(k);
      const y = w.y ?? H * 0.44;
      ctx.save();
      ctx.translate(W / 2, y); ctx.scale(s, s);
      // halo
      if (!this.pal.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, 0, 0, 900, w.color || this.pal.accent, 0.55); ctx.globalCompositeOperation = 'source-over'; }
      if (w.crown !== false) draw.crown(ctx, 0, -150 + Math.sin(this.clock * 4) * 6, 1.3, '#ffd23f');
      draw.text(ctx, w.title, 0, -90, { size: w.size || 104, color: w.color || '#ffffff', maxWidth: 1000, stroke: 18, strokeColor: 'rgba(0,0,0,0.6)', shadow: false });
      if (w.sub) draw.text(ctx, w.sub, 0, 55, { size: 44, color: '#ffffff', weight: 700, stroke: 10, strokeColor: 'rgba(0,0,0,0.55)', shadow: false, maxWidth: 960 });
      ctx.restore();
      const tc = this.textCfg;
      if (tc.showEnd && tc.endText && this.clock - this.finaleAt > 0.9) {
        const k2 = clamp((this.clock - this.finaleAt - 0.9) / 0.4, 0, 1);
        ctx.save(); ctx.globalAlpha = k2; ctx.translate(W / 2, (w.y ?? H * 0.44) + 260); ctx.scale(easeOutBack(k2), easeOutBack(k2));
        draw.text(ctx, tc.endText, 0, 0, { size: 50, color: '#ffffff', highlight: this.pal.accent, stroke: 10, maxWidth: 900 });
        ctx.restore();
      }
    }

    // ---------------- shared HUD widgets
    /** Big goal counter: label + value + progress bar. */
    hudCounter(ctx, label, value, progress, o = {}) {
      const y = o.y ?? 400, pal = this.pal;
      ctx.textAlign = 'center';
      draw.font(ctx, 30, 700, 'Space Grotesk');
      ctx.fillStyle = pal.light ? rgba(pal.text, 0.7) : 'rgba(255,255,255,0.7)';
      ctx.fillText(label.toUpperCase().split('').join(' '), W / 2, y);
      draw.font(ctx, o.size || 84, 900);
      ctx.fillStyle = o.color || (pal.light ? pal.text : '#ffffff');
      ctx.fillText(value, W / 2, y + (o.size || 84) + 6);
      if (progress !== null && progress !== undefined) {
        const bw = 520, bh = 14, bx = W / 2 - bw / 2, by = y + (o.size || 84) + 34;
        draw.roundRect(ctx, bx, by, bw, bh, 7); ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.12)'; ctx.fill();
        const pw = Math.max(bh, bw * clamp(progress, 0, 1));
        const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        pal.grad.forEach((c, i) => g.addColorStop(i / (pal.grad.length - 1), c));
        draw.roundRect(ctx, bx, by, pw, bh, 7); ctx.fillStyle = g; ctx.fill();
      }
      ctx.textAlign = 'left';
    }
  }

  SB.Game = Game;
  SB.GAME = { W, H, STEP };
})(window.SB);
