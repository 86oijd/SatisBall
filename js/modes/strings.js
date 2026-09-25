/* Mode: Bounce Strings — every bounce ties a glowing string from the hit point to the ball, weaving a web. */
'use strict';
(function (SB) {
  const { TAU, clamp, gradientAt, rgba } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;

  class Strings extends SB.Mode {
    init() {
      const s = this.s;
      this.cx = 540; this.cy = 1100; this.R = 450;
      this.arena = new SB.Arena({ cx: this.cx, cy: this.cy, R: this.R, shape: s.shape, spin: s.spin });
      this.w = s.spin;
      const a = this.rng.range(0, TAU);
      this.ball = new P.Ball(this.cx, this.cy - 120, s.ballSize, { vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, color: this.pickColor(s.ballColor, 1) });
      this.ball.lastHit = -1;
      P.setEnergy(this.ball, s.gravity);
      this.strings = []; // anchors in the container's local frame (so they rotate with it)
      this.speedK = 1; this.snapped = false;
      this.trailLen = 18;
    }
    trailBalls() { return [this.ball]; }
    world(a) { return this.arena.anchorPoint(a.an); }
    roster() { return null; }
    update(dt) {
      const s = this.s, g = this.g, b = this.ball;
      const prog = this.strings.length / s.goal;
      g.tension = clamp(prog, 0, 1);
      if (s.assist && g.state === 'play') {
        const exp = clamp(g.time / (g.targetLen * 0.88), 0, 1);
        if (prog < exp - 0.05) this.speedK = Math.min(2.6, this.speedK + dt * 0.12); else if (prog > exp + 0.05) this.speedK = Math.max(0.8, this.speedK - dt * 0.05);
      }
      this.w = s.spin * (1 + prog * 0.6);
      this.arena.w = this.w; this.arena.update(dt);
      if (this.arena.morphed) { this.fx.banner(this.arena.label.toUpperCase() + '!', this.pal.accent, { size: 60, y: 0.3, dur: 0.9 }); this.snd.sfx('whoosh', 0.5); }
      if (this.snapped) { b.vy += 900 * dt; b.x += b.vx * dt; b.y += b.vy * dt; this.screenBox(b, 0.8); this.decayBall(b, dt); return; }
      const n = P.substeps([b], dt, 0.35, 16), h = dt / n;
      for (let k = 0; k < n; k++) {
        this.integrate(b, h, s.gravity);
        const imp = this.arena.collide(b, 1);
        if (imp > 40) this.bounce(b, imp);
        P.lockEnergy(b, s.gravity);
      }
      this.decayBall(b, dt);
      if (this.strings.length >= s.goal && g.state === 'play') this.snap();
    }
    bounce(b, imp) {
      const s = this.s, g = this.g;
      if (g.clock - b.lastHit < 0.04) return;
      b.lastHit = g.clock;
      const j = this.rng.range(-0.05, 0.05), c = Math.cos(j), sn = Math.sin(j);
      const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
      // anchor at contact point, stored in the container frame
      const idx = this.strings.length;
      this.strings.push({ an: this.arena.anchorFor(C.px, C.py), c: gradientAt(this.pal.grad, (idx / s.goal) * 0.95), t: 0 });
      b.color = this.strings[idx].c;
      const k = 1 + s.speedUp / 100;
      b.vx *= k * this.speedK / (this.lastK || 1); b.vy *= k * this.speedK / (this.lastK || 1); this.lastK = this.speedK;
      const sp = b.speed; if (sp > s.maxSpeed) b.setSpeed(s.maxSpeed);
      P.setEnergy(b, s.gravity);
      this.note(this.velFromImpact(imp), b.x);
      this.contactFx(b, C.px, C.py, C.nx, C.ny, imp, b.color);
      this.fx.ring(C.px, C.py, b.color, 50, 0.35, 4);
      const left = s.goal - this.strings.length;
      if (left === 10) this.fx.banner('10 TO GO', this.pal.accent, { size: 64, y: 0.5, dur: 1 });
      if (left <= 3 && left > 0) this.g.moment({ x: b.x, y: b.y, zoom: 1.06, slow: 0.5, dur: 0.3 });
    }
    snap() {
      const g = this.g, b = this.ball;
      this.snapped = true;
      // every string bursts into sparks along its length
      for (const st of this.strings) {
        const [ax, ay] = this.world(st);
        for (let i = 0; i < 3; i++) { const t = this.rng.next(); this.fx.burst(ax + (b.x - ax) * t, ay + (b.y - ay) * t, st.c, 1, 500, { dots: 0.6, grav: 400 }); }
      }
      this.strings.length = 0;
      this.snd.sfx('shatter', 0.9); this.snd.sfx('boom', 0.8);
      for (let i = 0; i < 4; i++) this.fx.ring(b.x, b.y, this.pal.grad[i], 300 + i * 130, 0.7 + i * 0.1, 10);
      this.fx.shockwave(b.x, b.y, this.pal.accent, 700);
      g.win({ title: `${this.s.goal} STRINGS!`, sub: `woven in ${SB.util.fmtTime(g.time)}`, color: this.pal.accent, y: 640, fx: b.x, fy: b.y });
    }
    audit() { const b = this.ball; return !this.snapped && this.arena.audit(b) ? ['ball outside arena'] : []; }
    forceEnd() { this.speedK = 2.2; }
    path(ctx, inset = 0) { this.arena.path(ctx, inset); }
    render(ctx) {
      const b = this.ball, pal = this.pal;
      this.path(ctx, 0); ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.25)'; ctx.fill();
      // strings
      if (!pal.light) ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = this.s.stringWidth;
      const n = this.strings.length;
      for (let i = 0; i < n; i++) {
        const st = this.strings[i];
        const [ax, ay] = this.world(st);
        ctx.globalAlpha = 0.35 + 0.65 * ((i + 1) / n);
        ctx.strokeStyle = st.c;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      // anchors
      for (const st of this.strings) { const [ax, ay] = this.world(st); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ax, ay, 4, 0, TAU); ctx.fill(); }
      ctx.lineJoin = 'round';
      this.path(ctx, 6); ctx.lineWidth = 12; ctx.strokeStyle = pal.light ? rgba(pal.text, 0.5) : 'rgba(255,255,255,0.55)'; ctx.stroke();
      this.drawTrails(ctx, [b], 1.3, 0.5);
      draw.ball(ctx, b, this.look);
    }
    hud(ctx) {
      if (this.g.state !== 'play') return;
      this.g.hudCounter(ctx, `strings · goal ${this.s.goal}`, String(this.strings.length), this.strings.length / this.s.goal, { y: 420 });
    }
    stats() { return { strings: this.strings.length, speedK: +this.speedK.toFixed(2) }; }
  }

  SB.modes.register({
    id: 'strings', name: 'Bounce Strings', icon: '✺', category: 'Classic', tagline: 'Every bounce ties a new string to the ball',
    hook: 'Every bounce adds a *string*',
    settings: [
      { key: 'goal', label: 'Strings goal', type: 'range', min: 10, max: 300, step: 5, def: 70, rand: [50, 100] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(), rand: ['circle', 'triangle', 'square', 'hexagon', 'star', 'heart', 'morph'] },
      { key: 'spin', label: 'Arena spin', type: 'range', min: -3, max: 3, step: 0.05, def: 0.4, rand: [-1, 1] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2500, step: 50, def: 1200, rand: [600, 1600] },
      { key: 'speed', label: 'Start speed', type: 'range', min: 200, max: 1500, step: 10, def: 750 },
      { key: 'speedUp', label: 'Speed-up per bounce (%)', type: 'range', min: 0, max: 5, step: 0.1, def: 0.6 },
      { key: 'maxSpeed', label: 'Max speed', type: 'range', min: 600, max: 3000, step: 50, def: 2000 },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 8, max: 50, step: 1, def: 26, rand: [18, 34] },
      { key: 'stringWidth', label: 'String width', type: 'range', min: 1, max: 8, step: 0.5, def: 3 },
      { key: 'ballColor', label: 'Ball colour', type: 'color', def: '', rand: false },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Harp Web', s: {}, sound: { theme: 'pluck', pattern: 'chords' } },
      { name: 'Hexagon Weave', s: { shape: 'hexagon', spin: 0.8, goal: 100 } },
      { name: 'Zero-G Star', s: { gravity: 0, shape: 'star', spin: 0.6, speed: 900 }, sound: { theme: 'bells', pattern: 'pingpong' } },
      { name: 'Shape-Shifting Web', s: { shape: 'morph', goal: 90, spin: 0.3 }, look: { bg: 'waves', palette: 'aurora' }, sound: { theme: 'nylon', pattern: 'chords', backing: 'build' } },
      { name: 'Heart Strings', s: { shape: 'heart', goal: 60, stringWidth: 2.5 }, look: { palette: 'candy', bg: 'bokeh' }, sound: { theme: 'musicbox', pattern: 'melody', melody: 'canon', backing: 'pad' } },
    ],
    create: (g, s) => new Strings(g, s),
  });
})(window.SB);
