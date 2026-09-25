/* Mode: Ball Multiply — every wall hit (or every escape) spawns more balls until chaos. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, gradientAt, mix } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;
  const SIDES = { circle: 0, square: 4, hexagon: 6, triangle: 3 };

  class Multiply extends SB.Mode {
    init() {
      const s = this.s;
      this.cx = 540; this.cy = 1100; this.R = 440;
      this.sides = s.rule === 'escape' ? 0 : SIDES[s.shape];
      this.rot = -Math.PI / 2; this.w = s.spin;
      this.gapA = s.gap * Math.PI / 180;
      this.balls = []; this.escaped = []; this.count = 0; this.spawnedTotal = 0;
      this.grid = new P.Grid(0, 500, 1080, 1300, Math.max(24, s.ballSize * 2.2));
      this.p = s.chance;
      this.add(this.cx, this.cy - 100, this.rng.range(0, TAU), true);
      this.trailLen = 8;
      this.popT = 0;
    }
    add(x, y, a, silent) {
      const s = this.s;
      if (this.balls.length >= s.target + 5) return null;
      const b = new P.Ball(x, y, s.ballSize, { vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, color: gradientAt(this.pal.grad, (this.spawnedTotal * 0.037) % 1) });
      b.lastHit = -1;
      P.setEnergy(b, s.gravity);
      this.balls.push(b); this.spawnedTotal++;
      if (!silent) {
        b.flash = 1;
        if (this.g.clock - this.popT > 0.03) { this.popT = this.g.clock; this.snd.sfx('pop', 0.35, this.g.pan(x), 0.9 + this.rng.range(0, 0.4)); }
      }
      return b;
    }
    trailBalls() { return this.balls.length < 120 ? this.balls : null; }
    update(dt) {
      const s = this.s, g = this.g;
      if (this.exploded) { for (const b of this.balls.concat(this.escaped)) { b.vy += 600 * dt; b.x += b.vx * dt; b.y += b.vy * dt; } return; }
      const live = this.balls.length;
      const prog = Math.log(Math.max(1, live)) / Math.log(s.target);
      g.tension = clamp(prog, 0, 1);
      if (s.assist && g.state === 'play') {
        const exp = clamp(g.time / (g.targetLen * 0.85), 0, 1);
        if (prog < exp - 0.05) this.p = Math.min(1, this.p * (1 + dt * 1.5)); else if (prog > exp + 0.07) this.p = Math.max(0.03, this.p * (1 - dt * 1.2));
        if (s.rule === 'escape') {
          const base = s.gap * Math.PI / 180;
          if (prog < exp - 0.04) this.gapA = Math.min(Math.max(base, 2.2), this.gapA * (1 + dt * 0.35));
          else if (prog > exp + 0.06) this.gapA = Math.max(base * 0.6, this.gapA * (1 - dt * 0.3));
        }
      }
      this.w = s.spin * (1 + prog * 0.8);
      this.rot += this.w * dt;
      const pts = this.sides ? P.polygon(this.cx, this.cy, this.R, this.sides, this.rot) : null;
      const n = P.substeps(this.balls, dt, 0.45, 8);
      const h = dt / n;
      const toSpawn = [];
      for (let k = 0; k < n; k++) {
        for (const b of this.balls) {
          if (!b.alive) continue;
          this.integrate(b, h, s.gravity);
          let imp = 0;
          if (s.rule === 'escape') {
            const a0 = this.rot + this.gapA / 2;
            if (P.arc(b, this.cx, this.cy, this.R, 5, a0, TAU - this.gapA, -1)) {
              const [wx, wy] = P.rotVel(C.px, C.py, this.cx, this.cy, this.w);
              imp = P.resolve(b, C.nx, C.ny, C.depth, 1, wx, wy);
            } else if (Math.hypot(b.x - this.cx, b.y - this.cy) > this.R + b.r + 6) {
              b.alive = false; this.escaped.push(b); b.vy -= 200;
              if (g.state === 'play') { toSpawn.push(null, null); }
              continue;
            }
          } else if (pts) imp = P.insidePolygon(b, pts, this.cx, this.cy, this.w, 1);
          else if (P.insideCircle(b, this.cx, this.cy, this.R)) imp = P.resolve(b, C.nx, C.ny, C.depth, 1);
          if (imp > 40) {
            const j = this.rng.range(-0.06, 0.06), c = Math.cos(j), sn = Math.sin(j);
            const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
            if (g.clock - b.lastHit > 0.06) {
              b.lastHit = g.clock;
              if (this.balls.length < 60 || this.rng.chance(40 / this.balls.length)) this.note(this.velFromImpact(imp) * 0.8, b.x);
              if (this.balls.length < 150) this.contactFx(b, C.px, C.py, C.nx, C.ny, imp * 0.6);
            }
            if (s.rule === 'wall' && g.state === 'play' && this.rng.chance(this.p)) toSpawn.push(b);
          }
        }
        if (s.collide) {
          this.grid.build(this.balls); this.grid.pairs(this.balls, (a, b) => P.ballBall(a, b, 1));
          for (const b of this.balls) if (b.alive) { if (pts) P.insidePolygon(b, pts, this.cx, this.cy, this.w, 1); else if (s.rule !== 'escape') this.keepInCircle(b, this.cx, this.cy, this.R); }
        }
        for (const b of this.balls) if (b.alive) P.lockEnergy(b, s.gravity);
      }
      this.balls = this.balls.filter((b) => b.alive);
      // spawns
      for (const src of toSpawn) {
        if (this.balls.length >= s.target) break;
        if (src) { const a = Math.atan2(src.vy, src.vx) + this.rng.range(-0.9, 0.9); this.add(src.x - C.nx * 2, src.y, a); }
        else this.add(this.cx + this.rng.range(-30, 30), this.cy + this.rng.range(-30, 30), this.rng.range(0, TAU));
      }
      // escaped balls fall away
      for (const b of this.escaped) { b.vy += 1600 * dt; b.x += b.vx * dt; b.y += b.vy * dt; }
      this.escaped = this.escaped.filter((b) => b.y < this.H + 100 && b.x > -100 && b.x < this.W + 100);
      this.balls = this.balls.filter((b) => b.alive);
      for (const b of this.balls) this.decayBall(b, dt);
      const cnt = this.balls.length;
      if (cnt !== this.count) {
        const m = [50, 100, 250, 500, 1000, 2000].find((x) => this.count < x && cnt >= x && x < s.target);
        if (m) { this.fx.banner(m + ' BALLS!', this.pal.accent, { size: 72, y: 0.5, dur: 1 }); this.g.shake(0.15); }
        this.count = cnt;
      }
      if (cnt >= s.target && g.state === 'play') this.finish();
    }
    finish() {
      const g = this.g;
      // everything bursts
      let i = 0;
      for (const b of this.balls) { if (i++ % 2 === 0) this.fx.burst(b.x, b.y, b.color, 2, 900, { dots: 1, life: 1.2 }); }
      for (const b of this.balls) { const a = Math.atan2(b.y - this.cy, b.x - this.cx); b.vx = Math.cos(a) * 1500; b.vy = Math.sin(a) * 1500; }
      this.exploded = true;
      for (let k = 0; k < 5; k++) this.fx.ring(this.cx, this.cy, this.pal.grad[k], 400 + k * 150, 0.8 + k * 0.1, 14);
      g.win({ title: `${this.s.target} BALLS!`, sub: `from 1 ball in ${SB.util.fmtTime(g.time)}`, color: this.pal.accent, y: 700 });
    }
    audit() {
      if (this.exploded || this.s.rule === 'escape') return [];
      const v = []; for (const b of this.balls) if (Math.hypot(b.x - this.cx, b.y - this.cy) > this.R + 2) { v.push('ball outside arena'); break; } return v;
    }
    forceEnd() { this.p = 1; }
    render(ctx) {
      const s = this.s, pal = this.pal;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const stroke = pal.light ? '#2a1a40' : '#ffffff';
      if (!this.exploded) {
        ctx.lineWidth = 12;
        if (s.rule === 'escape') {
          ctx.strokeStyle = mix(stroke, pal.accent, 0.5);
          ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R, this.rot + this.gapA / 2, this.rot + TAU - this.gapA / 2); ctx.stroke();
        } else {
          ctx.strokeStyle = mix(stroke, pal.accent, 0.4);
          ctx.beginPath();
          if (this.sides) { P.polygon(this.cx, this.cy, this.R + 6 / Math.cos(Math.PI / this.sides), this.sides, this.rot).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
          else ctx.arc(this.cx, this.cy, this.R + 6, 0, TAU);
          ctx.stroke();
        }
      }
      this.drawTrails(ctx, this.balls, 1.1, 0.35);
      const many = this.balls.length > 200;
      for (const b of this.escaped) draw.ball(ctx, b, this.look, { glow: 0.4 });
      for (const b of this.balls) draw.ball(ctx, b, this.look, { glow: many ? 0.35 : 0.8 });
    }
    hud(ctx) {
      if (this.g.state !== 'play') return;
      this.g.hudCounter(ctx, `balls · goal ${this.s.target}`, String(this.balls.length), Math.log(Math.max(1, this.balls.length)) / Math.log(this.s.target), { y: 420 });
    }
    stats() { return { balls: this.balls.length, p: +this.p.toFixed(3) }; }
  }

  SB.modes.register({
    id: 'multiply', name: 'Ball Multiply', icon: '⁂', tagline: 'Every hit spawns another ball — pure chaos',
    hook: 'Every bounce = *+1 ball*',
    settings: [
      { key: 'rule', label: 'Rule', type: 'select', def: 'wall', options: [['wall', 'Wall hit spawns a ball'], ['escape', 'Each escape spawns 2']] },
      { key: 'target', label: 'Goal (balls)', type: 'range', min: 20, max: 1500, step: 10, def: 500, rand: [300, 800] },
      { key: 'chance', label: 'Spawn chance per hit', type: 'range', min: 0.05, max: 1, step: 0.05, def: 0.5, rand: [0.3, 0.8] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: [['circle', 'Circle'], ['square', 'Square'], ['hexagon', 'Hexagon'], ['triangle', 'Triangle']] },
      { key: 'spin', label: 'Arena spin', type: 'range', min: -3, max: 3, step: 0.05, def: 0.5, rand: [-1.2, 1.2] },
      { key: 'gap', label: 'Gap size (escape rule)', type: 'range', min: 10, max: 120, step: 1, def: 40, rand: [28, 60] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2500, step: 50, def: 900, rand: [0, 1600] },
      { key: 'speed', label: 'Speed', type: 'range', min: 150, max: 1400, step: 10, def: 650, rand: [450, 900] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 4, max: 30, step: 1, def: 11, rand: [8, 15] },
      { key: 'collide', label: 'Balls collide', type: 'toggle', def: false, rand: 0.3 },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Wall Chaos', s: {} },
      { name: 'Escape = 2 More', s: { rule: 'escape', target: 400, gap: 42, gravity: 900, spin: 1.1 } },
      { name: 'Zero-G Hexagon', s: { shape: 'hexagon', gravity: 0, spin: 0.8, target: 800 } },
      { name: 'Pile Up (collisions)', s: { collide: true, target: 350, ballSize: 13, gravity: 1400 } },
    ],
    create: (g, s) => new Multiply(g, s),
  });
})(window.SB);
