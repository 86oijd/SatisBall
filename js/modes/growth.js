/* Mode: Ball Growth — every bounce makes the ball bigger until it fills the (rotating) arena. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, gradientAt, mix, rgba } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;

  class Growth extends SB.Mode {
    init() {
      const s = this.s;
      this.cx = 540; this.cy = 1090; this.R = 450;
      this.arena = new SB.Arena({ cx: this.cx, cy: this.cy, R: this.R, shape: s.shape === 'morph' ? 'circle' : s.shape, spin: s.spin });
      this.inR = this.arena.inradius;
      this.balls = [];
      for (let i = 0; i < s.balls; i++) {
        const a = this.rng.range(0, TAU);
        const b = new P.Ball(this.cx + (i - (s.balls - 1) / 2) * 120, this.cy - 60, s.startSize, { vx: Math.cos(a) * s.speed, vy: -Math.abs(Math.sin(a)) * s.speed, color: i === 0 ? this.pickColor(s.ballColor, 0) : this.color(i * 2) });
        b.base = b.color; b.hits = 0; b.lastHit = -1;
        P.setEnergy(b, s.gravity);
        this.balls.push(b);
      }
      this.imprints = [];
      this.growMul = 1;
      this.paceK = this.rng.range(0.78, 0.95); // each run lands at a slightly different moment
      this.done = false;
      this.trailLen = 16;
      this.bounces = 0;
    }
    trailBalls() { return this.balls; }
    coverage() { let a = 0; for (const b of this.balls) a += b.r * b.r; return a / (this.inR * this.inR); }
    update(dt) {
      const s = this.s, g = this.g;
      const cov = this.coverage();
      g.tension = clamp(cov / s.fill, 0, 1);
      this.arena.update(dt);
      const n = P.substeps(this.balls, dt, 0.4, 16);
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of this.balls) {
          if (this.done) continue;
          this.integrate(b, h, s.gravity);
          const imp = this.arena.collide(b, 1);
          if (imp > 40) this.bounce(b, imp);
        }
        for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) {
          const imp = P.ballBall(this.balls[i], this.balls[j], 1);
          if (imp > 60) { this.bounce(this.balls[i], imp * 0.6); this.bounce(this.balls[j], imp * 0.6); }
        }
        for (const b of this.balls) { this.arena.keepIn(b); P.lockEnergy(b, s.gravity); }
      }
      for (const b of this.balls) this.decayBall(b, dt);
      // heartbeat as it nears full
      const k = cov / s.fill;
      if (k > 0.82 && g.state === 'play') {
        const beat = Math.floor(g.time / (0.62 - 0.25 * (k - 0.82) / 0.18));
        if (beat !== this.lastBeat) { this.lastBeat = beat; this.snd.sfx('heart', 0.55 + (k - 0.82) * 2, 0); for (const b of this.balls) b.flash = Math.max(b.flash, 0.35); this.fx.kick(0.006); }
      }
      if (!this.done && this.coverage() >= s.fill && g.state === 'play') this.finish();
    }
    bounce(b, imp) {
      const s = this.s, g = this.g;
      if (g.clock - b.lastHit < 0.03) return;
      b.lastHit = g.clock;
      const j = this.rng.range(-0.05, 0.05), c = Math.cos(j), sn = Math.sin(j);
      const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
      b.hits++; this.bounces++;
      const maxR = this.inR * Math.sqrt(s.fill / this.balls.length) * 1.02;
      const gr = s.growMode === 'percent' ? b.r * s.growth / 100 : s.growth;
      if (s.assist) {
        // track a coverage schedule: always grow a little, catch up quickly when behind, never outrun it
        const T = g.targetLen * this.paceK, tt = clamp((g.time + 0.4) / T, 0, 1);
        const covT = Math.pow(tt, 1.25) * s.fill;
        const rT = this.inR * Math.sqrt(covT / this.balls.length);
        b.r = Math.min(maxR, b.r + clamp(rT - b.r, gr * 0.15, gr * 4));
      } else b.r = Math.min(maxR, b.r + gr);
      b.m = b.r * b.r;
      P.setEnergy(b, s.gravity);
      if (s.colorShift) {
        const shifted = gradientAt(this.pal.grad, (this.coverage() / s.fill) * 0.95);
        // a hand-picked colour stays recognisable: it only leans towards the palette as it grows
        b.color = s.ballColor && b === this.balls[0] ? SB.util.mix(s.ballColor, shifted, 0.35) : shifted;
      }
      this.note(this.velFromImpact(imp), b.x);
      this.contactFx(b, C.px, C.py, C.nx, C.ny, imp, b.color);
      if (s.imprints) { this.imprints.push({ x: b.x, y: b.y, r: b.r, c: b.color }); if (this.imprints.length > 140) this.imprints.shift(); }
      const pct = Math.floor((this.coverage() / s.fill) * 10);
      if (pct !== this.lastPct) { if (pct >= 9 && this.lastPct < 9) { this.fx.banner('ALMOST FULL!', this.pal.accent, { size: 70, y: 0.5 }); this.snd.sfx('riser', 0.5); } this.lastPct = pct; }
    }
    finish() {
      const g = this.g;
      this.done = true;
      for (const b of this.balls) {
        b.vx = b.vy = 0;
        this.fx.burst(b.x, b.y, b.color, 90, 1600, { colors: this.pal.grad, life: 1.4 });
        for (let i = 0; i < 5; i++) this.fx.ring(b.x, b.y, this.pal.grad[i % this.pal.grad.length], b.r + 200 + i * 90, 0.7 + i * 0.12, 12);
      }
      const b0 = this.balls[0];
      this.fx.shockwave(b0.x, b0.y, b0.color, 1100);
      this.fx.flare(b0.x, b0.y, b0.color, 1400);
      this.fx.flash(b0.color, 0.5);
      this.snd.sfx('explode', 0.9);
      g.win({ title: "IT'S FULL!", sub: `${this.bounces} bounces · ${SB.util.fmtTime(g.time)}`, color: '#ffffff', y: 600, fx: b0.x, fy: b0.y, zoom: 1.1 });
    }
    audit() {
      const v = [];
      if (!this.done) for (const b of this.balls) if (this.arena.audit(b)) v.push('ball outside arena');
      return v;
    }
    forceEnd() { for (const b of this.balls) { b.r = Math.min(this.inR * Math.sqrt(this.s.fill / this.balls.length), b.r + 0.5); b.m = b.r * b.r; } }
    arenaPath(ctx, inset = 0) { this.arena.path(ctx, inset); }
    render(ctx) {
      const pal = this.pal;
      this.arenaPath(ctx, 0);
      ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.22)'; ctx.fill();
      // imprints (clip to arena)
      if (this.imprints.length) {
        ctx.save(); this.arenaPath(ctx, 0); ctx.clip();
        ctx.lineWidth = 3;
        for (let i = 0; i < this.imprints.length; i++) {
          const q = this.imprints[i];
          ctx.globalAlpha = 0.1 + 0.25 * (i / this.imprints.length);
          ctx.strokeStyle = q.c; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.stroke();
        }
        ctx.restore(); ctx.globalAlpha = 1;
      }
      const cov = this.coverage();
      ctx.lineJoin = 'round';
      this.arenaPath(ctx, 6);
      ctx.lineWidth = 12; ctx.strokeStyle = mix(pal.light ? '#2a1a40' : '#ffffff', pal.accent, clamp(cov, 0, 1)); ctx.stroke();
      if (!this.done) { this.drawTrails(ctx, this.balls, 1.2, 0.35); this.drawBalls(ctx, this.balls); }
      // size label inside ball
      for (const b of this.balls) {
        if (this.done || b.r < 40) continue;
        draw.font(ctx, Math.min(140, b.r * 0.5), 900); ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(Math.round((this.coverage() / this.s.fill) * 100) + '%', b.x, b.y + Math.min(140, b.r * 0.5) * 0.36);
        ctx.textAlign = 'left';
      }
    }
    hud(ctx) {
      if (this.g.state !== 'play') return;
      const p = clamp(this.coverage() / this.s.fill, 0, 1);
      this.g.hudCounter(ctx, 'arena filled', Math.floor(p * 100) + '%', p, { y: 420 });
    }
    stats() { return { cov: +this.coverage().toFixed(3), bounces: this.bounces, growMul: +this.growMul.toFixed(2) }; }
  }

  SB.modes.register({
    id: 'growth', name: 'Ball Growth', icon: '●', category: 'Satisfying', tagline: 'Every bounce makes it bigger until it fills the arena',
    hook: 'Every bounce it gets *BIGGER*',
    settings: [
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(false), rand: ['circle', 'circle', 'triangle', 'square', 'hexagon', 'star', 'heart'] },
      { key: 'spin', label: 'Arena spin', type: 'range', min: -3, max: 3, step: 0.05, def: 0.6, rand: [-1.2, 1.2], show: (s) => s.shape !== 'circle' },
      { key: 'growth', label: 'Growth per bounce', type: 'range', min: 0.5, max: 20, step: 0.5, def: 3, rand: [2, 5] },
      { key: 'growMode', label: 'Growth type', type: 'select', def: 'px', options: [['px', 'Pixels (steady)'], ['percent', 'Percent (accelerating)']] },
      { key: 'startSize', label: 'Start size', type: 'range', min: 6, max: 80, step: 1, def: 24, rand: [16, 32] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 3000, step: 50, def: 1400, rand: [600, 2000] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1600, step: 10, def: 800, rand: [600, 1100] },
      { key: 'balls', label: 'Balls', type: 'range', min: 1, max: 3, step: 1, def: 1, rand: [1, 1] },
      { key: 'fill', label: 'Fill target', type: 'range', min: 0.3, max: 0.95, step: 0.01, def: 0.93, rand: false },
      { key: 'imprints', label: 'Leave imprints', type: 'toggle', def: true },
      { key: 'colorShift', label: 'Colour shifts as it grows', type: 'toggle', def: true },
      { key: 'ballColor', label: 'Ball colour', type: 'color', def: '', rand: false },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Classic Circle', s: {} },
      { name: 'Spinning Hexagon', s: { shape: 'hexagon', spin: 0.9 } },
      { name: 'Triangle Trap', s: { shape: 'triangle', spin: -0.7, gravity: 1800 } },
      { name: 'Twin Growth', s: { balls: 2, growth: 3.5 } },
      { name: 'Melody Grow', s: { shape: 'square', spin: 0.5 }, sound: { pattern: 'melody', melody: 'canon', theme: 'piano' } },
      { name: 'Grow a Heart', s: { shape: 'heart', spin: 0, gravity: 1500 }, look: { palette: 'candy', bg: 'bokeh' }, sound: { theme: 'musicbox', pattern: 'melody', melody: 'twinkle', backing: 'pad' } },
      { name: 'Star Squeeze', s: { shape: 'star', spin: 0.8, growth: 3.5 }, look: { palette: 'aurora', bg: 'stars' }, sound: { theme: 'bells', pattern: 'climb', backing: 'build' } },
    ],
    create: (g, s) => new Growth(g, s),
  });
})(window.SB);
