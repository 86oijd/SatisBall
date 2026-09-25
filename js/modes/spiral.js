/* Mode: Spiral — balls bounce inside a spinning spiral; every hit breaks a piece, adds speed, colour and (sometimes) a new ball. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, gradientAt, mix } = SB.util;
  const P = SB.phys, C = P.C;

  class Spiral extends SB.Mode {
    init() {
      const s = this.s;
      this.cx = 540; this.cy = 1090; this.R = 470;
      this.phi = 0; this.w = s.spin;
      this.segs = [];
      const turns = s.turns, arms = s.arms;
      const r0 = 78, r1 = this.R - 34;
      const per = Math.round(s.segments / arms);
      for (let a = 0; a < arms; a++) {
        const off = (a / arms) * TAU;
        for (let k = 0; k < per; k++) {
          const t0 = k / per, t1 = (k + 1) / per;
          const th0 = t0 * turns * TAU, th1 = t1 * turns * TAU;
          const ra = lerp(r0, r1, t0), rb = lerp(r0, r1, t1);
          this.segs.push({
            la: th0 + off, lr: ra, lb: th1 + off, lrb: rb,
            ax: 0, ay: 0, bx: 0, by: 0,
            rmin: Math.min(ra, rb) - 20, rmax: Math.max(ra, rb) + 20,
            hp: s.hp, alive: true, flash: 0, t: t0,
            color: gradientAt(this.pal.grad, t0 * 0.9),
          });
        }
      }
      this.total = this.segs.length; this.left = this.total;
      this.balls = []; this.hits = 0; this.spawnCount = 0;
      this.grid = new P.Grid(0, 500, 1080, 1200, 60);
      for (let i = 0; i < s.startBalls; i++) this.spawn(true);
      this.placeSegs();
      this.trailLen = 12;
    }
    spawn(initial) {
      const s = this.s;
      if (this.balls.length >= s.maxBalls) return;
      const a = this.rng.range(0, TAU);
      const b = new P.Ball(this.cx + this.rng.range(-20, 20), this.cy + this.rng.range(-20, 20), s.ballSize, {
        vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, color: this.pal.grad[0],
      });
      b.spd = s.speed; b.lastHit = -1;
      P.setEnergy(b, s.gravity);
      this.balls.push(b);
      if (!initial) { this.snd.sfx('pop', 0.6, 0, 1 + this.rng.range(-0.1, 0.2)); this.fx.ring(b.x, b.y, '#ffffff', 90, 0.35, 5); }
    }
    placeSegs() {
      const c = Math.cos(this.phi), s = Math.sin(this.phi);
      for (const g of this.segs) {
        if (!g.alive) continue;
        const ax = Math.cos(g.la) * g.lr, ay = Math.sin(g.la) * g.lr, bx = Math.cos(g.lb) * g.lrb, by = Math.sin(g.lb) * g.lrb;
        g.ax = this.cx + ax * c - ay * s; g.ay = this.cy + ax * s + ay * c;
        g.bx = this.cx + bx * c - by * s; g.by = this.cy + bx * s + by * c;
      }
    }
    trailBalls() { return this.balls.length <= 30 ? this.balls : null; }
    update(dt) {
      const s = this.s, g = this.g;
      const prog = 1 - this.left / this.total;
      g.tension = prog;
      this.w = s.spin * (1 + prog * s.spinUp);
      const ht = s.thickness / 2;
      const n = P.substeps(this.balls, dt, 0.4, 16);
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        this.phi += this.w * h;
        this.placeSegs();
        for (const b of this.balls) {
          this.integrate(b, h, s.gravity);
          const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy);
          for (const sg of this.segs) {
            if (!sg.alive || d + b.r < sg.rmin || d - b.r > sg.rmax) continue;
            if (P.segment(b, sg.ax, sg.ay, sg.bx, sg.by, ht)) {
              const [wx, wy] = P.rotVel(C.px, C.py, this.cx, this.cy, this.w);
              const imp = P.resolve(b, C.nx, C.ny, C.depth, 1, wx, wy);
              if (imp > 30) this.hitSeg(b, sg, imp);
            }
          }
          if (P.insideCircle(b, this.cx, this.cy, this.R)) {
            const imp = P.resolve(b, C.nx, C.ny, C.depth, 1);
            if (imp > 60 && g.clock - b.lastHit > 0.05) { b.lastHit = g.clock; this.contactFx(b, C.px, C.py, C.nx, C.ny, imp * 0.6, '#ffffff'); }
          }
        }
        if (s.collide) {
          this.grid.build(this.balls);
          this.grid.pairs(this.balls, (a, b) => P.ballBall(a, b, 1));
          for (const b of this.balls) this.keepInCircle(b, this.cx, this.cy, this.R);
        }
        for (const b of this.balls) P.lockEnergy(b, s.gravity);
      }
      for (const sg of this.segs) sg.flash = Math.max(0, sg.flash - dt * 4);
      for (const b of this.balls) this.decayBall(b, dt);
      // pace assist: behind schedule -> extra balls
      if (s.assist && g.state === 'play') {
        const expected = clamp(g.time / (g.targetLen * 0.85), 0, 1);
        if (prog < expected - 0.06 && this.balls.length < s.maxBalls && g.time - (this.lastAssist || 0) > (prog > 0.85 ? 0.6 : 1.2)) { this.lastAssist = g.time; this.spawn(); }
      }
      if (this.left === 0 && g.state === 'play') this.finish();
    }
    hitSeg(b, sg, imp) {
      const s = this.s, g = this.g;
      // jitter + speed gain
      const j = this.rng.range(-0.05, 0.05), c = Math.cos(j), sn = Math.sin(j);
      const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
      b.spd = Math.min(s.maxSpeed, b.spd + s.speedGain);
      b.setSpeed(Math.max(b.speed, b.spd * 0.9)); P.setEnergy(b, s.gravity);
      if (s.recolor) b.color = sg.color;
      sg.hp--; sg.flash = 1;
      this.hits++;
      if (g.clock - b.lastHit > 0.03) { b.lastHit = g.clock; this.note(this.velFromImpact(imp), b.x); }
      this.contactFx(b, C.px, C.py, C.nx, C.ny, imp, sg.color);
      if (sg.hp <= 0) {
        sg.alive = false; this.left--;
        const mx = (sg.ax + sg.bx) / 2, my = (sg.ay + sg.by) / 2;
        this.fx.burst(mx, my, sg.color, 10, 500, { grav: 400 });
        this.fx.debris(mx, my, 20, 20, sg.color, 3, { size: 0.7, power: 0.7 });
        if (this.left % 10 === 0) g.shake(0.08);
        if (this.left === 10) this.fx.banner('10 LEFT!', this.pal.accent, { size: 70, y: 0.5, dur: 1.1 });
      }
      // pace brake: skip scheduled spawns while ahead of schedule
      const expP = clamp(g.time / (g.targetLen * 0.85), 0, 1), prog = 1 - this.left / this.total;
      const allowed = s.startBalls + Math.floor(expP * 10) + (prog < expP - 0.08 ? 8 : 0);
      const ahead2 = s.assist && (prog > expP + 0.03 || this.balls.length >= allowed);
      if (s.spawnEvery > 0 && this.hits % s.spawnEvery === 0 && !ahead2) this.spawn();
    }
    finish() {
      const g = this.g;
      for (let i = 0; i < 6; i++) this.fx.ring(this.cx, this.cy, this.pal.grad[i % this.pal.grad.length], 300 + i * 120, 0.8 + i * 0.1, 10);
      this.fx.burst(this.cx, this.cy, '#ffffff', 80, 1400, { colors: this.pal.grad });
      g.win({ title: 'SPIRAL DESTROYED!', size: 84, sub: `${this.balls.length} balls · ${this.hits} hits · ${SB.util.fmtTime(g.time)}`, color: this.pal.accent });
    }
    audit() {
      const v = [];
      for (const b of this.balls) if (b.alive !== false && Math.hypot(b.x - this.cx, b.y - this.cy) > this.R - b.r + 2) v.push('ball outside arena');
      return v;
    }
    forceEnd() {
      const sg = this.segs.find((x) => x.alive);
      if (sg) { sg.hp = 1; this.hitSeg(this.balls[0], sg, 400); }
    }
    render(ctx) {
      const s = this.s;
      // arena
      ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      if (this.look.light) ctx.strokeStyle = 'rgba(40,20,60,0.18)';
      ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R + 5, 0, TAU); ctx.stroke();
      // spiral
      ctx.lineCap = 'round';
      for (const sg of this.segs) {
        if (!sg.alive) continue;
        const hpK = sg.hp / s.hp;
        ctx.strokeStyle = sg.flash > 0.02 ? mix(sg.color, '#ffffff', sg.flash * 0.7) : sg.color;
        ctx.globalAlpha = 0.45 + 0.55 * hpK;
        ctx.lineWidth = s.thickness + sg.flash * 5;
        ctx.beginPath(); ctx.moveTo(sg.ax, sg.ay); ctx.lineTo(sg.bx, sg.by); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      this.drawTrails(ctx, this.balls, 1.3, 0.45);
      this.drawBalls(ctx, this.balls, { glow: this.balls.length > 40 ? 0.5 : 1 });
    }
    hud(ctx) {
      if (this.g.state !== 'play') return;
      this.g.hudCounter(ctx, `spiral left · ${this.balls.length} ball${this.balls.length > 1 ? 's' : ''}`, String(this.left), 1 - this.left / this.total, { y: 420 });
    }
    stats() { return { left: this.left, balls: this.balls.length, hits: this.hits }; }
  }

  SB.modes.register({
    id: 'spiral', name: 'Spiral Breaker', icon: '@', tagline: 'Every hit breaks the spinning spiral, adds speed & balls',
    hook: 'Every hit makes it *faster*',
    settings: [
      { key: 'segments', label: 'Spiral pieces', type: 'range', min: 30, max: 400, step: 10, def: 260, rand: [200, 320] },
      { key: 'hp', label: 'Hits per piece', type: 'range', min: 1, max: 4, step: 1, def: 2, rand: [1, 3] },
      { key: 'turns', label: 'Spiral turns', type: 'range', min: 1, max: 6, step: 0.25, def: 3, rand: [2, 4] },
      { key: 'arms', label: 'Spiral arms', type: 'range', min: 1, max: 4, step: 1, def: 1, rand: [1, 3] },
      { key: 'spin', label: 'Spin speed', type: 'range', min: -3, max: 3, step: 0.05, def: 0.9, rand: [-1.6, 1.6] },
      { key: 'spinUp', label: 'Spin-up as it breaks', type: 'range', min: 0, max: 4, step: 0.1, def: 1.5 },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2500, step: 50, def: 700, rand: [0, 1400] },
      { key: 'speed', label: 'Start speed', type: 'range', min: 200, max: 1400, step: 10, def: 620 },
      { key: 'speedGain', label: 'Speed gain per hit', type: 'range', min: 0, max: 60, step: 1, def: 6 },
      { key: 'maxSpeed', label: 'Max speed', type: 'range', min: 500, max: 3000, step: 50, def: 1300 },
      { key: 'startBalls', label: 'Start balls', type: 'range', min: 1, max: 10, step: 1, def: 1, rand: [1, 3] },
      { key: 'spawnEvery', label: 'New ball every N hits (0 = off)', type: 'range', min: 0, max: 40, step: 1, def: 16, rand: [10, 24] },
      { key: 'maxBalls', label: 'Max balls', type: 'range', min: 1, max: 120, step: 1, def: 40 },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 6, max: 30, step: 1, def: 14, rand: [10, 18] },
      { key: 'thickness', label: 'Spiral thickness', type: 'range', min: 4, max: 24, step: 1, def: 10 },
      { key: 'collide', label: 'Balls collide', type: 'toggle', def: true },
      { key: 'recolor', label: 'Balls take colour of hits', type: 'toggle', def: true },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Classic Spiral', s: {} },
      { name: 'Triple Vortex', s: { arms: 3, turns: 2, segments: 210, spin: 1.3, spawnEvery: 10 } },
      { name: 'Tanky Spiral', s: { hp: 3, segments: 90, spawnEvery: 8, maxBalls: 60 } },
      { name: 'Zero-G Swarm', s: { gravity: 0, startBalls: 4, spawnEvery: 15, speed: 700 }, sound: { pattern: 'climb', theme: 'marimba' } },
    ],
    create: (g, s) => new Spiral(g, s),
  });
})(window.SB);
