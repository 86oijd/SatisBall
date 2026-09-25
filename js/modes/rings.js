/* Mode: Escape the Rings — a ball bounces inside rotating rings with gaps; passing a gap shatters that ring. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, gradientAt, rgba, lighten, normAngle } = SB.util;
  const P = SB.phys, C = P.C;

  class Rings extends SB.Mode {
    init() {
      const s = this.s, g = this.g;
      this.cx = 540; this.cy = 1080;
      this.R0 = 120 + s.ballSize * 1.4;
      this.rings = [];
      const n = s.rings;
      for (let i = 0; i < n; i++) {
        let off;
        if (s.layout === 'spiral') off = i * 0.42;
        else if (s.layout === 'aligned') off = 0;
        else off = this.rng.range(0, TAU);
        const dir = s.alternate ? (i % 2 ? -1 : 1) : 1;
        this.rings.push({
          i, R: this.R0 + i * s.spacing, rot: off - Math.PI / 2, dir, flash: 0, alive: true,
          gap: s.gap * Math.PI / 180, wMul: 1 + ((i * 37) % 11) / 55,
          color: s.style === 'mono' ? this.pal.accent : gradientAt(this.pal.grad, (i / Math.max(1, n - 1)) * 0.85),
        });
      }
      this.broken = 0; this.lastBreak = 0; this.riser = false;
      this.balls = [];
      for (let k = 0; k < s.balls; k++) {
        const a = this.rng.range(0, TAU);
        const b = new P.Ball(this.cx + Math.cos(a) * 20 * k, this.cy - 10 - k * 25, s.ballSize, {
          vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed - 150,
          color: k === 0 ? (s.ballColor || this.contrastColor(this.rings.slice(0, 4).map((r) => r.color))) : this.color(k + 1), name: this.cname(k + 1),
        });
        b.lastHit = -1; b.out = false;
        P.setEnergy(b, s.gravity);
        this.balls.push(b);
      }
      this.trailLen = 22;
      this.speedMul = 1;
    }
    trailBalls() { return this.balls; }
    get inner() { return this.rings[this.broken]; }

    update(dt) {
      const s = this.s, g = this.g;
      const prog = this.broken / this.rings.length;
      g.tension = prog;
      // ring motion: spin (speeds up as rings go), contract towards centre
      const expected = (g.targetLen * 0.8) / this.rings.length;
      const stall = Math.max(0, g.time - this.lastBreak - expected * 1.5);
      for (const r of this.rings) {
        if (!r.alive) continue;
        const w = s.spin * r.dir * r.wMul * (1 + s.intensity * 0.9 * prog);
        r.w = w;
        r.rot += w * dt;
        const target = this.R0 + (r.i - this.broken) * s.spacing;
        const nr = lerp(r.R, target, 1 - Math.exp(-dt * 7));
        r.vr = (nr - r.R) / dt; r.R = nr;
        r.flash = Math.max(0, r.flash - dt * 3);
        if (s.assist && r === this.inner) {
          const behind = Math.max(0, g.time - (this.broken + 1) * expected);
          r.gapNow = r.gap + Math.min(1.1, stall * 0.15 + behind * 0.06);
        } else r.gapNow = r.gap;
      }
      const th = s.thickness / 2;
      const n = P.substeps(this.balls, dt, 0.35);
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of this.balls) {
          this.integrate(b, h, s.gravity);
          const ring = this.inner;
          if (ring && !b.out) {
            const a0 = ring.rot + ring.gapNow / 2, span = TAU - ring.gapNow;
            if (P.arc(b, this.cx, this.cy, ring.R, th, a0, span, -1)) {
              const [wx, wy] = P.rotVel(C.px, C.py, this.cx, this.cy, ring.w);
              const rx = (C.px - this.cx) / ring.R, ry = (C.py - this.cy) / ring.R;
              const imp = P.resolve(b, C.nx, C.ny, C.depth, 1, wx + rx * ring.vr, wy + ry * ring.vr);
              if (imp > 40) this.onBounce(b, ring, imp);
            } else {
              const d = Math.hypot(b.x - this.cx, b.y - this.cy);
              if (d > ring.R + th + b.r * 0.3) this.breakRing(ring, b);
            }
          } else if (b.out) {
            if (this.screenBox(b, 1)) { this.note(0.5, b.x); }
          }
        }
        if (this.balls.length > 1) for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) {
          const imp = P.ballBall(this.balls[i], this.balls[j], 1);
          if (imp > 60) { this.note(this.velFromImpact(imp) * 0.7, this.balls[i].x); }
        }
        for (const b of this.balls) P.lockEnergy(b, s.gravity);
      }
      for (const b of this.balls) this.decayBall(b, dt);
    }
    onBounce(b, ring, imp) {
      // tiny deterministic angle jitter breaks periodic orbits (speed preserved)
      const j = this.rng.range(-0.04, 0.04), c = Math.cos(j), sn = Math.sin(j);
      const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
      ring.flash = 1;
      if (this.g.clock - b.lastHit > 0.04) {
        b.lastHit = this.g.clock;
        this.note(this.velFromImpact(imp), b.x);
        this.contactFx(b, C.px, C.py, C.nx, C.ny, imp, ring.color);
      }
    }
    breakRing(ring, b) {
      const s = this.s, g = this.g;
      ring.alive = false;
      this.broken++;
      this.lastBreak = g.time;
      const left = this.rings.length - this.broken;
      this.fx.shatterArc(this.cx, this.cy, ring.R, ring.rot + ring.gapNow / 2, TAU - ring.gapNow, s.thickness, (t) => ring.color, { power: 1 + this.broken / this.rings.length });
      this.fx.ring(this.cx, this.cy, ring.color, ring.R + 160, 0.6, 8);
      this.snd.sfx('shatter', 0.55 + 0.35 * (this.broken / this.rings.length), g.pan(b.x), 0.9 + 0.35 * (this.broken / this.rings.length));
      this.note(1, b.x);
      g.shake(0.18 + 0.25 * (this.broken / this.rings.length));
      this.fx.kick(0.012);
      // intensify
      this.speedMul = 1 + s.intensity * 0.012;
      for (const bb of this.balls) { bb.vx *= this.speedMul; bb.vy *= this.speedMul; P.setEnergy(bb, s.gravity); }
      if (left === 3) this.fx.banner('3 LEFT!', this.pal.accent, { size: 70, y: 0.5, dur: 1.1 });
      if (left === 1) { this.fx.banner('FINAL RING', '#ffffff', { size: 76, y: 0.5, dur: 1.3 }); this.snd.sfx('riser', 0.5); }
      if (left === 0) {
        for (const bb of this.balls) bb.out = true;
        const multi = this.balls.length > 1;
        this.fx.burst(b.x, b.y, b.color, 60, 1100, { colors: this.pal.grad });
        g.win({ title: multi ? `${b.name} ESCAPED!` : 'ESCAPED!', sub: `${this.rings.length} rings · ${SB.util.fmtTime(g.time)}`, color: b.color });
      }
    }
    forceEnd() {
      // overtime: blow the remaining rings open one by one quickly
      const r = this.inner; if (r) r.gap = Math.min(TAU * 0.6, r.gap + 0.02);
    }

    render(ctx) {
      const s = this.s;
      // rings
      ctx.lineCap = 'round';
      for (let idx = this.rings.length - 1; idx >= this.broken; idx--) {
        const r = this.rings[idx];
        if (!r.alive) continue;
        const depth = r.i - this.broken;
        const vis = clamp((900 - r.R) / 260, 0, 1);
        if (vis <= 0) continue;
        const a0 = r.rot + r.gapNow / 2, span = TAU - r.gapNow;
        const isInner = depth === 0;
        const alpha = vis * (isInner ? 1 : clamp(0.9 - depth * 0.035, 0.35, 0.9));
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = r.flash > 0.02 ? SB.util.mix(r.color, '#ffffff', r.flash * 0.6) : r.color;
        ctx.lineWidth = s.thickness * (isInner ? 1.25 : 1) + r.flash * 4;
        ctx.beginPath(); ctx.arc(this.cx, this.cy, r.R, a0, a0 + span); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      this.drawTrails(ctx, this.balls, 1.5, 0.55);
      this.drawBalls(ctx, this.balls);
      if (this.balls.length > 1) for (const b of this.balls) this.tag(ctx, b, b.name, { size: 24, color: b.color });
    }
    hud(ctx) {
      const left = this.rings.length - this.broken;
      if (this.g.state === 'play') this.g.hudCounter(ctx, 'rings left', String(left), this.broken / this.rings.length, { y: 420 });
    }
  }

  SB.modes.register({
    id: 'rings', name: 'Escape the Rings', icon: '◎', tagline: 'Break every rotating ring to escape',
    hook: 'Can the ball *escape?*',
    settings: [
      { key: 'rings', label: 'Rings', type: 'range', min: 3, max: 60, step: 1, def: 24, rand: [12, 34] },
      { key: 'gap', label: 'Gap size (°)', type: 'range', min: 12, max: 100, step: 1, def: 44, rand: [32, 56] },
      { key: 'spin', label: 'Spin speed', type: 'range', min: 0, max: 4, step: 0.05, def: 1.2, rand: [0.6, 2.2] },
      { key: 'intensity', label: 'Speed-up per ring', type: 'range', min: 0, max: 3, step: 0.1, def: 1.2, rand: [0.5, 2] },
      { key: 'alternate', label: 'Alternate spin direction', type: 'toggle', def: true },
      { key: 'layout', label: 'Gap layout', type: 'select', def: 'spiral', options: [['spiral', 'Spiral'], ['random', 'Random'], ['aligned', 'Aligned']] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2500, step: 50, def: 1100, rand: [0, 1700] },
      { key: 'speed', label: 'Ball speed', type: 'range', min: 200, max: 1600, step: 10, def: 760, rand: [550, 1000] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 10, max: 40, step: 1, def: 20, rand: [15, 26] },
      { key: 'balls', label: 'Balls', type: 'range', min: 1, max: 4, step: 1, def: 1, rand: [1, 2] },
      { key: 'spacing', label: 'Ring spacing', type: 'range', min: 16, max: 70, step: 1, def: 30, rand: [22, 40] },
      { key: 'thickness', label: 'Ring thickness', type: 'range', min: 3, max: 18, step: 1, def: 9, rand: [6, 12] },
      { key: 'style', label: 'Ring colours', type: 'select', def: 'rainbow', options: [['rainbow', 'Palette gradient'], ['mono', 'Single accent']] },
      { key: 'ballColor', label: 'Ball colour', type: 'color', def: '', rand: false },
      { key: 'assist', label: 'Pace assist (keeps runs 15–60s)', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Classic Spiral', s: {} },
      { name: 'Hyper 40 Rings', s: { rings: 40, spacing: 22, gap: 40, spin: 1.6, intensity: 1.8, thickness: 7, speed: 900 } },
      { name: 'Zero Gravity Chaos', s: { gravity: 0, speed: 900, rings: 20, gap: 36, layout: 'random', spin: 1.8 } },
      { name: 'Big & Slow', s: { rings: 10, spacing: 55, gap: 38, spin: 0.7, thickness: 14, ballSize: 30, speed: 650 }, sound: { theme: 'piano', pattern: 'melody', melody: 'elise' } },
      { name: 'Race of 3', s: { balls: 3, rings: 26, gap: 46 }, },
    ],
    create: (g, s) => new Rings(g, s),
  });
})(window.SB);
