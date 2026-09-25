/* SatisBall — the Game runtime: fixed-step simulation, director (intro card, hook, key moments, finale),
 * render pipeline (background, world, bloom, HUD) at any output resolution.
 *
 * Determinism: the simulation always advances in fixed 1/240 s steps and only uses the seeded RNG,
 * so a (mode, settings, seed) triple replays identically live and during frame-perfect export.
 * Presentation time (`clock`) keeps running at real speed during slow-motion; audio is stamped with it.
 */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, mix, lighten, darken, easeOutBack, easeOutCubic, easeInCubic, smooth, RNG } = SB.util;
  const draw = SB.draw;
  const W = 1080, H = 1920, STEP = 1 / 240;

  // ------------------------------------------------------------------ mode registry
  const modes = { list: [], byId: {} };
  modes.register = (def) => {
    def.defaults = {};
    for (const s of def.settings) def.defaults[s.key] = s.def;
    def.category = def.category || 'Classic';
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

  const FONT_WEIGHT = { Unbounded: 900, 'Space Grotesk': 700, Anton: 400, Bungee: 400, 'Luckiest Guy': 400, Poppins: 900 };
  SB.FONTS = Object.keys(FONT_WEIGHT);

  const raysCache = new Map();
  function rays(color) {
    let c = raysCache.get(color); if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(256, 256, 20, 256, 256, 256);
    gr.addColorStop(0, rgba(color, 0.55)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.moveTo(256, 256); g.arc(256, 256, 256, a, a + TAU / 32); }
    g.fill();
    raysCache.set(color, c);
    return c;
  }

  // ------------------------------------------------------------------ Game
  class Game {
    /** cfg: { modeId, settings, look, sound, text, run, seed, audioMode: 'live'|'capture'|'mute', engine, canvas } */
    constructor(cfg) {
      this.cfg = cfg;
      this.W = W; this.H = H;
      this.canvas = cfg.canvas;
      this.k = this.canvas.width / W;
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.def = modes.byId[cfg.modeId] || modes.list[0];
      this.pal = SB.palettes.resolve(cfg.look);
      this.look = Object.assign({ glow: 0.8, trails: true, shake: 1, particles: 1, ballStyle: 'glossy', bloom: 0.5, bg: 'glow', tensionFx: true, zoomFx: true }, cfg.look, { light: !!this.pal.light });
      this.look.k = this.k;
      this.soundCfg = cfg.sound;
      this.textCfg = Object.assign({ showHook: true, hookMode: 'always', hooks: {}, hookSize: 74, font: 'Unbounded', hookStyle: 'shadow', hookAnim: 'pop', hookOffset: 0, intro: false, introLen: 1.5, showEnd: true, endText: '', outroLen: 3.4, fadeOut: false, subText: '' }, cfg.text);
      this.targetLen = cfg.run.targetLen || 35;
      this.seed = cfg.seed >>> 0;
      this.rng = new RNG(this.seed);
      this.fx = new SB.FX(this);
      this.snd = new SB.audio.SoundOut(cfg.engine, this, cfg.audioMode || 'live');
      this.music = new SB.audio.Music(this, cfg.sound);
      this.bed = new SB.audio.Backing(this, cfg.sound);
      this.cam = { x: 0, y: 0, zoom: 1 };
      this.time = 0; this.clock = 0; this.steps = 0;
      this.timeScale = 1; this.slowT = 0; this.slowTarget = 1;
      this.hitstopT = 0;
      this.tension = 0; this.danger = 0; this.pulse = 0;
      this.focus = null;
      this.introLen = this.textCfg.intro ? clamp(this.textCfg.introLen || 1.5, 0.6, 4) : 0;
      this.state = this.introLen > 0 ? 'intro' : 'play';
      this.playStart = this.introLen;
      this.winInfo = null; this.finaleAt = 0; this.outro = clamp(this.textCfg.outroLen ?? 3.4, 1, 8);
      this.onDone = null;
      this.bloomCv = document.createElement('canvas'); this.bloomCv.width = Math.round(this.canvas.width / 4); this.bloomCv.height = Math.round(this.canvas.height / 4);
      this.bloomCtx = this.bloomCv.getContext('2d');
      this.hookCache = null; this.hudPop = {};
      this.settings = Object.assign({}, this.def.defaults, cfg.settings || {});
      this.mode = this.def.create(this, this.settings);
      this.mode.init && this.mode.init();
      if (this.state === 'intro') { this.snd.sfx('boom', 0.55, 0, 1.4, 0.05); this.snd.sfx('whoosh', 0.35, 0, 0.9); }
      else this.snd.sfx('whoosh', 0.45, 0, 1.1); // audible from frame one
    }
    get pace() { return this.time / this.targetLen; }
    pan(x) { return clamp((x - this.cam.x) / W * 2 - 1, -1, 1); }

    // ---------------- director API used by modes
    slowmo(scale, dur) { if (scale < this.slowTarget || this.slowT <= 0) { this.slowTarget = scale; } this.slowT = Math.max(this.slowT, dur); }
    hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
    shake(a) { this.fx.shake(a * this.look.shake); }
    bump(a) { this.pulse = Math.min(1.5, this.pulse + a); }
    /** A key moment: camera leans in on (x, y) with a zoom, optional slow-motion, flash and shake. */
    moment(o) {
      if (this.look.zoomFx !== false) this.focus = { x: o.x ?? this.cam.x + W / 2, y: o.y ?? this.cam.y + H / 2, zoom: o.zoom ?? 1.12, t: 0, hold: o.dur ?? 0.8 };
      if (o.slow) this.slowmo(o.slow, o.dur ?? 0.8);
      if (o.flash) this.fx.flash(o.flash, o.flashA ?? 0.25);
      if (o.shake) this.shake(o.shake);
      if (o.hitstop) this.hitstop(o.hitstop);
    }
    win(info) {
      if (this.state !== 'play') return;
      this.state = 'finale'; this.finaleAt = this.clock; this.winInfo = info;
      this.fx.banners.length = 0;
      this.slowmo(info.slow ?? 0.28, info.slowDur ?? 1.2);
      if (info.fx !== undefined) this.moment({ x: info.fx, y: info.fy, zoom: info.zoom ?? 1.14, dur: 1.4 });
      this.fx.flash(info.color || '#ffffff', 0.6);
      this.shake(0.75);
      this.fx.kick(0.05);
      const cols = this.pal.balls.slice(0, 8).map((b) => b.c).concat([info.color || '#ffffff']);
      this.fx.confetti(this.cam.x + 80, this.cam.y + H * 0.82, 110, cols, { dir: -Math.PI / 2 + 0.45, spread: 0.45, power: 1.35 });
      this.fx.confetti(this.cam.x + W - 80, this.cam.y + H * 0.82, 110, cols, { dir: -Math.PI / 2 - 0.45, spread: 0.45, power: 1.35 });
      this.fx.confetti(this.cam.x + W / 2, this.cam.y - 40, 80, cols, { dir: Math.PI / 2, spread: 1.1, power: 0.5 });
      // the win stack: impact, sub drop, cymbal, chord stab, fanfare, sparkle
      this.snd.sfx('boom', 1, 0, 1, 0, 0.6); this.snd.sfx('subdrop', 0.9, 0); this.snd.sfx('crash', 0.75, 0, 1, 0.02);
      this.snd.sfx('shimmer', 0.7, 0, 1, 0.12);
      this.bed.finale(); this.music.fanfare(0.1);
    }

    // ---------------- simulation
    step() {
      this.clock += STEP; this.steps++;
      this.pulse *= 0.975;
      if (this.focus) this.focus.t += STEP;
      if (this.state === 'intro') {
        if (this.clock >= this.introLen) { this.state = 'play'; this.snd.sfx('go', 0.7, 0); this.shake(0.25); }
        this.fx.update(0, STEP);
        return;
      }
      if (this.slowT > 0) { this.slowT -= STEP; this.timeScale = lerp(this.timeScale, this.slowTarget, 0.08); }
      else { this.timeScale = lerp(this.timeScale, 1, 0.03); this.slowTarget = 1; }
      let dt = STEP * this.timeScale;
      if (this.hitstopT > 0) { this.hitstopT -= STEP; dt = 0; }
      if (dt > 0) {
        this.time += dt;
        this.mode.update(dt);
      }
      this.bed.update();
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
        if (b.trail.length >= len) { const p = b.trail.shift(); p[0] = b.x; p[1] = b.y; b.trail.push(p); }
        else b.trail.push([b.x, b.y]);
      }
    }
    /** Advance one video frame of presentation time (4 steps = 1/60 s, 8 steps = 1/30 s). */
    frame(steps = 4) { for (let i = 0; i < steps; i++) this.step(); }

    // ---------------- rendering
    render() {
      const ctx = this.ctx, pal = this.pal, look = this.look, k = this.k;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      SB.backgrounds.draw(ctx, this);
      const t = this.clock;

      // world transform: camera + shake + focus zoom + intro scale-in
      const tr = this.fx.trauma * this.fx.trauma;
      const sh = 26 * tr;
      const sx = sh * Math.sin(t * 57.3) * Math.cos(t * 31.1), sy = sh * Math.cos(t * 49.7) * Math.sin(t * 23.9);
      const rot = 0.012 * tr * Math.sin(t * 41.2);
      let fw = 0, fz = 1, fx = 0, fy = 0;
      const f = this.focus;
      if (f) {
        const fin = smooth(clamp(f.t / 0.22, 0, 1)), fout = 1 - smooth(clamp((f.t - f.hold) / 0.55, 0, 1));
        fw = Math.min(fin, fout);
        if (f.t > f.hold + 0.6) this.focus = null;
        fz = 1 + (f.zoom - 1) * fw; fx = f.x; fy = f.y;
      }
      const introK = this.state === 'intro' ? 0.94 + 0.06 * easeOutCubic(clamp(t / this.introLen, 0, 1)) : 1;
      const z = this.cam.zoom * (1 + this.fx.zoomKick) * fz * introK;
      const vcx = this.cam.x + W / 2, vcy = this.cam.y + H / 2;
      const tx = lerp(vcx, fx, 0.5 * fw), ty = lerp(vcy, fy, 0.5 * fw);
      ctx.save();
      ctx.translate(W / 2 + sx, H / 2 + sy); ctx.rotate(rot); ctx.scale(z, z); ctx.translate(-tx, -ty);
      this.mode.render(ctx);
      this.fx.render(ctx);
      ctx.restore();

      // bloom (quarter-res blur added back)
      if (!pal.light && look.bloom > 0) {
        const bc = this.bloomCtx;
        bc.globalCompositeOperation = 'copy';
        bc.filter = `blur(${(7 * k).toFixed(1)}px)`;
        bc.drawImage(this.canvas, 0, 0, this.bloomCv.width, this.bloomCv.height);
        bc.filter = 'none';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = look.bloom * 0.55;
        ctx.drawImage(this.bloomCv, 0, 0, W, H);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      // tension / danger edge glow
      if (look.tensionFx && this.state === 'play') {
        const a = Math.max(0, this.tension - 0.72) / 0.28 * 0.3 * (0.65 + 0.35 * Math.sin(t * 7));
        SB.backgrounds.tension(ctx, this, a, pal.accent);
        if (this.danger > 0) SB.backgrounds.tension(ctx, this, this.danger * (0.6 + 0.4 * Math.sin(t * 12)), '#ff2d45');
      }

      // screen-space overlay
      if (this.mode.hud && this.state !== 'intro') this.mode.hud(ctx);
      if (this.state === 'intro') this.renderIntro(ctx); else this.renderHook(ctx);
      this.fx.renderScreen(ctx, W, H);
      if (this.state === 'finale' || this.state === 'done') this.renderWinner(ctx);
      if (this.textCfg.fadeOut && this.winInfo) {
        const a = clamp((this.clock - this.finaleAt - (this.outro - 0.6)) / 0.6, 0, 1);
        if (a > 0) { ctx.globalAlpha = a; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      }
    }
    hookText() {
      const tc = this.textCfg;
      return (tc.hooks && tc.hooks[this.def.id]) ?? this.def.hook;
    }
    hookStyle(size, big) {
      const tc = this.textCfg, pal = this.pal, light = pal.light;
      const font = tc.font || 'Unbounded', weight = FONT_WEIGHT[font] ?? 900;
      const color = tc.hookColor || (light ? pal.text : '#ffffff'), hl = tc.hlColor || pal.accent;
      const o = { size, font, weight, color, highlight: hl, maxWidth: big ? 960 : 940 };
      switch (tc.hookStyle) {
        case 'outline': Object.assign(o, { stroke: size * 0.22, strokeColor: '#000000', shadow: false }); break;
        case 'box': Object.assign(o, { stroke: 0, shadow: false, box: light ? 'rgba(255,255,255,0.92)' : 'rgba(10,8,24,0.78)' }); if (light) o.color = tc.hookColor || pal.text; break;
        case 'neon': Object.assign(o, { stroke: 0, shadow: false, glow: hl }); break;
        default: Object.assign(o, { stroke: light ? 0 : 12, strokeColor: 'rgba(0,0,0,0.35)', shadowColor: light ? 'rgba(80,30,90,0.18)' : 'rgba(0,0,0,0.5)' });
      }
      return o;
    }
    buildHookCache() {
      const tc = this.textCfg, text = this.hookText();
      const key = [text, this.pal.id, tc.hookSize, tc.font, tc.hookStyle, tc.hookColor, tc.hlColor, tc.subText, this.k].join('|');
      if (this.hookCache && this.hookCache.key === key) return this.hookCache;
      const k = this.k, c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(460 * k);
      const g = c.getContext('2d'); g.scale(k, k);
      let size = tc.hookSize || 74;
      const st = this.hookStyle(size);
      draw.font(g, size, st.weight, st.font);
      const w = g.measureText(text.replace(/\*/g, '')).width;
      if (w > 940) size = Math.max(52, Math.floor(size * 940 / w));
      const h = draw.text(g, text, W / 2, 20, this.hookStyle(size));
      if (tc.subText) draw.text(g, tc.subText, W / 2, 30 + h, Object.assign(this.hookStyle(Math.round(size * 0.48)), { weight: 700, font: tc.font === 'Unbounded' ? 'Space Grotesk' : tc.font }));
      this.hookCache = { key, c, h };
      return this.hookCache;
    }
    renderHook(ctx) {
      const tc = this.textCfg;
      if (!tc.showHook || !this.hookText()) return;
      const lt = this.clock - this.playStart;
      if (tc.hookMode === 'intro' && lt > 4.2) return;
      const hc = this.buildHookCache();
      const k = clamp(lt / 0.45, 0, 1);
      let s = 1, a = 1, dy = 0, clipW = 1;
      switch (tc.hookAnim) {
        case 'slide': a = Math.min(1, k * 1.5); dy = -120 * (1 - easeOutCubic(k)); break;
        case 'type': clipW = clamp(lt / 0.9, 0, 1); break;
        case 'bounce': s = (this.introLen ? 1 : easeOutBack(k)) * (1 + 0.035 * Math.sin(this.clock * 5)); a = this.introLen ? 1 : Math.min(1, k * 2); break;
        default: s = this.introLen ? 1 : easeOutBack(k); a = this.introLen ? 1 : Math.min(1, k * 2);
      }
      if (tc.hookMode === 'intro' && lt > 3.7) a = Math.max(0, 1 - (lt - 3.7) / 0.5);
      if (this.state !== 'play') a *= Math.max(0, 1 - (this.clock - this.finaleAt) / 0.4);
      if (a <= 0) return;
      const y = (this.mode.hookY ?? this.def.hookY ?? 205) + (tc.hookOffset || 0) + dy;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, y); ctx.scale(s, s);
      if (clipW < 1) { ctx.beginPath(); ctx.rect(-W / 2, -20, W * clipW, 460); ctx.clip(); }
      ctx.drawImage(hc.c, -W / 2, -20, W, 460);
      ctx.restore();
    }
    renderIntro(ctx) {
      const t = this.clock, L = this.introLen, pal = this.pal;
      const out = clamp((t - (L - 0.3)) / 0.3, 0, 1);
      ctx.globalAlpha = 0.62 * (1 - out); ctx.fillStyle = pal.light ? '#fff6f0' : '#05030f'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      const text = this.hookText() || this.def.name;
      const k = clamp(t / 0.28, 0, 1);
      const s = (2.2 - 1.2 * easeOutCubic(k)) * (1 + out * 0.15);
      ctx.save(); ctx.globalAlpha = (1 - out) * Math.min(1, k * 3); ctx.translate(W / 2, H * 0.36); ctx.scale(s, s);
      draw.text(ctx, text, 0, -60, Object.assign(this.hookStyle(98, true), { maxWidth: 900 }));
      ctx.restore();
      const roster = this.mode.roster ? this.mode.roster() : null;
      if (roster && roster.length) {
        const n = Math.min(roster.length, 12), cols = n > 6 ? 3 : n > 3 ? 2 : 1;
        const cw = cols === 1 ? 520 : cols === 2 ? 440 : 300, ch = 74, gap = 14;
        const rows = Math.ceil(n / cols), x0 = W / 2 - (cols * cw + (cols - 1) * gap) / 2, y0 = H * 0.5;
        for (let i = 0; i < n; i++) {
          const r = roster[i], kk = easeOutBack(clamp((t - 0.25 - i * 0.05) / 0.3, 0, 1));
          if (kk <= 0) continue;
          const x = x0 + (i % cols) * (cw + gap), y = y0 + Math.floor(i / cols) * (ch + gap);
          ctx.save(); ctx.globalAlpha = (1 - out); ctx.translate(x + cw / 2, y + ch / 2); ctx.scale(kk, kk); ctx.translate(-cw / 2, -ch / 2);
          draw.panel(ctx, 0, 0, cw, ch, ch / 2, this.look, 0.75);
          ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(ch / 2, ch / 2, ch * 0.32, 0, TAU); ctx.fill();
          draw.font(ctx, cols === 3 ? 26 : 32, 900); ctx.fillStyle = r.color; ctx.fillText(r.name, ch + 6, ch / 2 + 11);
          if (r.label) { draw.font(ctx, 20, 700, 'Space Grotesk'); ctx.fillStyle = pal.light ? rgba(pal.text, 0.7) : 'rgba(255,255,255,0.7)'; ctx.textAlign = 'right'; ctx.fillText(r.label, cw - 24, ch / 2 + 8); ctx.textAlign = 'left'; }
          ctx.restore();
        }
        if (t > 0.5) { draw.font(ctx, 34, 800, 'Space Grotesk'); ctx.textAlign = 'center'; ctx.globalAlpha = (1 - out) * clamp((t - 0.5) / 0.3, 0, 1); ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.fillText('PICK ONE BEFORE IT STARTS', W / 2, y0 + rows * (ch + gap) + 50); ctx.globalAlpha = 1; ctx.textAlign = 'left'; }
      }
    }
    renderWinner(ctx) {
      const w = this.winInfo; if (!w) return;
      const dt = this.clock - this.finaleAt;
      const k = clamp(dt / 0.55, 0, 1);
      const s = easeOutBack(k);
      // dim the scene so the payoff reads instantly
      ctx.globalAlpha = 0.58 * clamp(dt / 0.35, 0, 1);
      ctx.fillStyle = this.pal.light ? '#fff6f0' : '#05030f';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      const y = w.y ?? H * 0.44;
      // light rays behind the title
      const col = w.color || this.pal.accent;
      ctx.save(); ctx.globalCompositeOperation = this.pal.light ? 'source-over' : 'lighter'; ctx.globalAlpha = 0.55 * clamp(dt / 0.5, 0, 1);
      ctx.translate(W / 2, y); ctx.rotate(this.clock * 0.35); const rs = 1300 * (0.6 + 0.4 * easeOutCubic(k));
      ctx.drawImage(rays(col), -rs / 2, -rs / 2, rs, rs); ctx.restore();
      let size = w.size || 104;
      draw.font(ctx, size, 900);
      const tw = ctx.measureText(w.title).width;
      if (tw > 980) size = Math.max(56, Math.floor(size * 980 / tw));
      ctx.save();
      ctx.translate(W / 2, y); ctx.scale(s, s);
      if (!this.pal.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, 0, 0, 1000, col, 0.5); ctx.globalCompositeOperation = 'source-over'; }
      if (w.trophy) draw.trophy(ctx, 0, -size * 0.55 - 150 + Math.sin(this.clock * 4) * 6, 1.5, '#ffd23f');
      else if (w.crown !== false) draw.crown(ctx, 0, -size * 0.55 - 70 + Math.sin(this.clock * 4) * 6, 1.3, '#ffd23f');
      draw.text(ctx, w.title, 0, -size * 0.55, { size, color: col, maxWidth: 2000, stroke: 18, strokeColor: 'rgba(0,0,0,0.6)', shadow: false });
      if (w.sub) draw.text(ctx, w.sub, 0, size * 0.62, { size: 42, color: this.pal.light ? this.pal.text : '#ffffff', weight: 700, stroke: this.pal.light ? 0 : 10, strokeColor: 'rgba(0,0,0,0.55)', shadow: false, maxWidth: 960 });
      ctx.restore();
      const tc = this.textCfg;
      if (tc.showEnd && tc.endText && dt > 0.9) {
        const k2 = clamp((dt - 0.9) / 0.4, 0, 1);
        ctx.save(); ctx.globalAlpha = k2; ctx.translate(W / 2, y + size * 0.62 + 110); ctx.scale(easeOutBack(k2), easeOutBack(k2));
        draw.text(ctx, tc.endText, 0, 0, Object.assign(this.hookStyle(50), { maxWidth: 900 }));
        ctx.restore();
      }
    }

    // ---------------- shared HUD widgets
    /** Big goal counter: label + value (pops when it changes) + progress bar. */
    hudCounter(ctx, label, value, progress, o = {}) {
      const y = o.y ?? 400, pal = this.pal;
      const pop = this.hudPop[label] || (this.hudPop[label] = { v: value, t: 9 });
      if (pop.v !== value) { pop.v = value; pop.t = 0; }
      pop.t += 1 / 60;
      const bumpS = 1 + 0.16 * Math.max(0, 1 - pop.t / 0.18);
      ctx.textAlign = 'center';
      draw.font(ctx, 30, 700, 'Space Grotesk');
      ctx.fillStyle = pal.light ? rgba(pal.text, 0.7) : 'rgba(255,255,255,0.7)';
      ctx.fillText(label.toUpperCase().split('').join(' '), W / 2, y);
      const size = o.size || 84;
      ctx.save(); ctx.translate(W / 2, y + size * 0.62 + 6); ctx.scale(bumpS, bumpS);
      draw.font(ctx, size, 900);
      ctx.fillStyle = o.color || (pal.light ? pal.text : '#ffffff');
      ctx.fillText(value, 0, size * 0.38);
      ctx.restore();
      if (progress !== null && progress !== undefined) {
        const bw = 520, bh = 14, bx = W / 2 - bw / 2, by = y + size + 34;
        draw.roundRect(ctx, bx, by, bw, bh, 7); ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.12)'; ctx.fill();
        const pw = Math.max(bh, bw * clamp(progress, 0, 1));
        const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        pal.grad.forEach((c, i) => g.addColorStop(i / (pal.grad.length - 1), c));
        draw.roundRect(ctx, bx, by, pw, bh, 7); ctx.fillStyle = g; ctx.fill();
        if (!pal.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, bx + pw, by + bh / 2, 60, '#ffffff', 0.5); ctx.globalCompositeOperation = 'source-over'; }
      }
      ctx.textAlign = 'left';
    }
  }

  SB.Game = Game;
  SB.GAME = { W, H, STEP };
})(window.SB);
