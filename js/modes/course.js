/* Mode: Obstacle Course Survival — ~4 named balls descend a long random course while THE WALL chases them.
 * Colour gates, keys, knives, trapdoors, crumbling floors, pistons, saws, bounce pads and a shortcut lane.
 */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, mix, rgba, lighten, darken, easeOutCubic } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;
  const XL = 40, XR = 1040, MID = 540;

  class Course extends SB.Mode {
    init() {
      const s = this.s, rng = this.rng;
      this.parts = []; this.sections = [];
      this.balls = [];
      const cols = this.distinctColors(s.balls, 8);
      for (let i = 0; i < s.balls; i++) {
        const ci = cols[i];
        const b = new P.Ball(lerp(XL + 150, XR - 150, s.balls > 1 ? i / (s.balls - 1) : 0.5), 120, s.ballSize, { color: this.color(ci), name: this.cname(ci) });
        b.knife = false; b.key = false; b.status = ''; b.lastHit = -1; b.still = 0; b.maxY = 0; b.progT = 0;
        b.wander = rng.sign(); b.wanderT = rng.range(0.5, 1.5); b.place = i; b.finished = false;
        this.balls.push(b);
      }
      this.build();
      this.wallY = -520; this.wallV = 0;
      this.g.cam.y = -250;
      this.feed = []; this.leader = null; this.leaderT = 0; this.closeT = 0; this.gMul = 1;
      this.finalStretch = false;
      this.trailLen = 12;
    }

    // ---------------------------------------------------------------- course building
    add(p) { this.parts.push(p); return p; }
    seg(ax, ay, bx, by, o = {}) { return this.add(Object.assign({ t: 'seg', ax, ay, bx, by, ht: 8, e: 0.4, fr: 0.12 }, o, { y0: Math.min(ay, by) - 20, y1: Math.max(ay, by) + 20 })); }
    build() {
      const s = this.s, rng = this.rng;
      let y = 0;
      // start platform with a drop gate
      this.seg(XL, 260, XR, 260, { gateStart: true, ht: 10, color: '#ffffff' });
      this.startGate = this.parts[this.parts.length - 1];
      y = 300;
      const pool = ['ramps', 'plinko', 'trapdoor', 'crumble', 'gate', 'pistons', 'spinners', 'bounce', 'keydoor', 'split'];
      const must = ['gate', 'crumble', 'trapdoor', 'ramps'];
      const n = s.assist ? Math.round(clamp(s.length * (this.g.targetLen / 35), 4, 18)) : s.length;
      const plan = [];
      const bag = rng.shuffle(must.slice(0, Math.min(must.length, n - 1)).concat(rng.shuffle(pool.slice())).slice(0, n));
      for (let i = 0; i < n; i++) {
        let k = bag[i] || rng.pick(pool);
        if (plan.length && plan[plan.length - 1] === k) k = rng.pick(pool.filter((q) => q !== k));
        plan.push(k);
      }
      if (!s.gates) for (let i = 0; i < plan.length; i++) if (plan[i] === 'gate' || plan[i] === 'split') plan[i] = rng.pick(['ramps', 'plinko', 'spinners']);
      // the first section should be forgiving: move pistons/crumble later
      if (['pistons', 'gate', 'keydoor'].includes(plan[0])) { const j = plan.findIndex((q) => !['pistons', 'gate', 'keydoor'].includes(q)); if (j > 0) [plan[0], plan[j]] = [plan[j], plan[0]]; }
      for (const k of plan) {
        const H = this['sec_' + k](y);
        this.sections.push({ kind: k, y0: y, y1: y + H, collapsed: false });
        y += H;
      }
      this.finishY = y + 120;
      // funnel into finish + catch floor
      this.seg(XL, this.finishY - 120, MID - 160, this.finishY, { ht: 8 });
      this.seg(XR, this.finishY - 120, MID + 160, this.finishY, { ht: 8 });
      this.seg(XL, this.finishY + 520, XR, this.finishY + 520, { ht: 12, e: 0.3 });
      this.courseLen = this.finishY;
      // knives: sprinkle into a few sections
      if (s.knives > 0) {
        const cand = this.sections.filter((q, i) => i > 0 && ['plinko', 'ramps', 'spinners', 'bounce'].includes(q.kind));
        rng.shuffle(cand);
        for (let i = 0; i < Math.min(s.knives, cand.length); i++) {
          const sc = cand[i];
          const yy = sc.y0 + rng.range(0.25, 0.6) * (sc.y1 - sc.y0);
          this.add({ t: 'item', kind: 'knife', x: rng.range(XL + 140, XR - 140), y: yy, taken: false, y0: yy - 60, y1: yy + 60, bob: rng.range(0, TAU) });
        }
      }
    }
    ballCol(i) { const alive = this.balls.filter((b) => b.alive); return (i != null ? this.balls[i] : this.rng.pick(alive)) || this.balls[0]; }
    sec_ramps(y) {
      const rng = this.rng, n = 4, flip = rng.chance(0.5);
      for (let i = 0; i < n; i++) {
        const left = (i % 2 === 0) !== flip;
        const yy = y + 80 + i * 250;
        if (left) this.seg(XL, yy, XL + 720, yy + 210); else this.seg(XR, yy, XR - 720, yy + 210);
        if (this.s.danger > 0 && rng.chance(0.3 * this.s.danger) && i > 0) {
          // hovers above the downstream half of the ramp: rolling balls pass under, bouncing ones get sliced
          const t = rng.range(0.66, 0.84), sx = left ? lerp(XL, XL + 720, t) : lerp(XR, XR - 720, t), sy = yy + 210 * t - (this.s.ballSize * 2 + 34 + 16);
          this.add({ t: 'saw', x: sx, y: sy, r: 34, a: 0, y0: sy - 40, y1: sy + 40 });
        }
      }
      return 80 + n * 250 + 60;
    }
    sec_plinko(y) {
      const rows = 6;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? 55 : 0;
        for (let x = XL + 70 + off; x < XR - 40; x += 110) this.add({ t: 'peg', x, y: y + 100 + r * 110, r: 13, y0: y + 80 + r * 110, y1: y + 120 + r * 110 });
      }
      return 100 + rows * 110 + 40;
    }
    sec_trapdoor(y) {
      const fy = y + 260, rng = this.rng;
      const doors = [230, 540, 850], w = 150;
      let x = XL;
      doors.forEach((dx, i) => {
        // floor piece sloping down towards this door
        const a = dx - w / 2;
        if (a > x) this.seg(x, fy - (i === 0 ? 60 : 30), a, fy, { ht: 9 });
        this.add({ t: 'door', kind: 'trap', ax: a, ay: fy, bx: a + w, by: fy, ht: 9, open: 0, period: rng.range(1.9, 2.6), phase: rng.range(0, 3), y0: fy - 20, y1: fy + 20, color: this.pal.grad[4] });
        x = a + w;
        if (i < doors.length - 1) { const nx = doors[i + 1] - w / 2, m = (x + nx) / 2; this.seg(x, fy, m, fy - 30, { ht: 9 }); x = m; this.seg(m, fy - 30, nx, fy, { ht: 9 }); x = nx; }
      });
      this.seg(x, fy, XR, fy - 60, { ht: 9 });
      return 460;
    }
    sec_crumble(y) {
      const tw = 100;
      [y + 200, y + 470].forEach((ty, r) => {
        for (let x = XL + (r ? tw / 2 : 0); x < XR - 1; x += tw) {
          const w = Math.min(tw, XR - x);
          this.add({ t: 'tile', x, y: ty, w, h: 26, state: 0, crack: 0, y0: ty - 30, y1: ty + 40 });
        }
        if (r) this.add({ t: 'tile', x: XL, y: ty, w: tw / 2, h: 26, state: 0, crack: 0, y0: ty - 30, y1: ty + 40 });
      });
      return 620;
    }
    sec_gate(y) {
      const fy = y + 300;
      const target = this.ballCol(null);
      this.seg(XL, fy - 150, MID - 110, fy, { ht: 9 });
      this.seg(XR, fy - 150, MID + 110, fy, { ht: 9 });
      this.add({ t: 'door', kind: 'gate', ax: MID - 110, ay: fy, bx: MID + 110, by: fy, ht: 11, open: 0, target, color: target.color, y0: fy - 30, y1: fy + 30, unlock: -1 });
      return 520;
    }
    sec_keydoor(y) {
      const fy = y + 330;
      this.seg(XL, fy - 170, MID - 90, fy, { ht: 9 });
      this.seg(XR, fy - 170, MID + 90, fy, { ht: 9 });
      // the key hovers just above one of the slopes: whoever rolls through it grabs it
      const left = this.rng.chance(0.5), kx = left ? MID - 260 : MID + 260;
      const sy = lerp(fy - 170, fy, left ? (kx - XL) / (MID - 90 - XL) : (XR - kx) / (XR - MID - 90));
      this.add({ t: 'item', kind: 'key', x: kx, y: sy - 48, taken: false, y0: sy - 110, y1: sy + 10, bob: 0 });
      this.add({ t: 'door', kind: 'key', ax: MID - 90, ay: fy, bx: MID + 90, by: fy, ht: 11, open: 0, color: '#ffd23f', y0: fy - 30, y1: fy + 30, unlock: -1, waitT: 0 });
      return 540;
    }
    sec_pistons(y) {
      const rng = this.rng;
      for (let i = 0; i < 2; i++) {
        const py = y + 220 + i * 330;
        this.add({ t: 'piston', y: py, h: 70, w: rng.range(1.6, 2.2), ph: rng.range(0, TAU), gap: 300, y0: py - 60, y1: py + 110 });
        // guide pegs above
        for (let k = 0; k < 3; k++) this.add({ t: 'peg', x: MID + (k - 1) * 240, y: py - 110, r: 12, y0: py - 130, y1: py - 90 });
      }
      return 820;
    }
    sec_spinners(y) {
      const rng = this.rng;
      const yy = y + 260;
      for (let i = 0; i < 3; i++) this.add({ t: 'spin', x: lerp(XL + 170, XR - 170, i / 2), y: yy + (i === 1 ? 180 : 0), L: 150, a: rng.range(0, TAU), w: rng.sign() * rng.range(2, 3), y0: yy - 180 + (i === 1 ? 180 : 0), y1: yy + 180 + (i === 1 ? 180 : 0) });
      if (this.s.danger > 0) {
        this.add({ t: 'saw', x: XL + 10, y: yy + 90, r: 44, a: 0, y0: yy + 40, y1: yy + 140 });
        this.add({ t: 'saw', x: XR - 10, y: yy + 90, r: 44, a: 0, y0: yy + 40, y1: yy + 140 });
      }
      return 720;
    }
    sec_bounce(y) {
      const fy = y + 380;
      this.seg(XL, fy - 200, MID - 60, fy, { ht: 9 });
      this.seg(XR, fy - 200, MID + 60, fy, { ht: 9 });
      // pads sitting on the slopes launch balls back up & across
      const t1 = 0.45, t2 = 0.45;
      const p1x = lerp(XL, MID - 60, t1), p1y = lerp(fy - 200, fy, t1), p2x = lerp(XR, MID + 60, t2), p2y = lerp(fy - 200, fy, t2);
      this.add({ t: 'pad', ax: p1x - 60, ay: p1y - 26, bx: p1x + 60, by: p1y + 20, ht: 10, power: 1500, flash: 0, y0: p1y - 60, y1: p1y + 60 });
      this.add({ t: 'pad', ax: p2x - 60, ay: p2y + 20, bx: p2x + 60, by: p2y - 26, ht: 10, power: 1500, flash: 0, y0: p2y - 60, y1: p2y + 60 });
      this.add({ t: 'bump', x: MID, y: fy - 300, r: 42, flash: 0, y0: fy - 360, y1: fy - 240 });
      return 560;
    }
    sec_split(y) {
      // a sloped floor with a coloured shortcut door; everyone else takes the long way round
      const fy = y + 160;
      const target = this.ballCol(null);
      const dx0 = 700, dx1 = 870;
      const slope = (x) => lerp(fy, fy + 200, (XR - x) / (XR - (XL + 200)));
      this.seg(XR, fy, dx1, slope(dx1), { ht: 9 });
      this.add({ t: 'door', kind: 'short', ax: dx1, ay: slope(dx1), bx: dx0, by: slope(dx0), ht: 10, open: 0, target, color: target.color, y0: slope(dx1) - 30, y1: slope(dx0) + 30 });
      this.seg(dx0, slope(dx0), XL + 200, slope(XL + 200), { ht: 9 });
      // divider wall between lanes
      const wallTop = slope(dx0) + 20;
      this.seg(dx0 - 10, wallTop, dx0 - 10, y + 1000, { ht: 10 });
      // left lane: slow ramps
      this.seg(XL, fy + 380, dx0 - 170, fy + 500, { ht: 8 });
      this.seg(dx0 - 20, fy + 610, XL + 170, fy + 730, { ht: 8 });
      this.seg(XL, fy + 820, dx0 - 170, fy + 900, { ht: 8 });
      // right lane: free fall with a boost arrow
      this.add({ t: 'label', text: 'SHORTCUT', x: (dx0 + XR) / 2, y: fy + 420, color: target.color, y0: fy + 380, y1: fy + 460 });
      return 1060;
    }

    // ---------------------------------------------------------------- simulation
    trailBalls() { return this.balls; }
    roster() { return this.balls.map((b) => ({ name: b.name, color: b.color })); }
    alive() { return this.balls.filter((b) => b.alive); }
    update(dt) {
      const s = this.s, g = this.g;
      const alive = this.alive();
      const t = g.time;
      // start gate drops almost instantly: something happens in the first second
      if (this.startGate && t > 0.55) { this.startGate.gone = true; this.startGate = null; this.snd.sfx('go', 0.8); this.fx.banner('GO!', '#ffffff', { size: 120, y: 0.45, dur: 0.8 }); g.shake(0.2); }
      // leader / pacing
      const sorted = alive.slice().sort((a, b) => b.y - a.y);
      const lead = sorted[0], last = sorted[sorted.length - 1];
      const leadP = lead ? clamp(lead.y / this.finishY, 0, 1) : 1;
      g.tension = clamp(0.25 + leadP * 0.75, 0, 1);
      if (s.assist && g.state === 'play' && lead) {
        const exp = clamp(t / (g.targetLen * 0.92), 0, 1);
        if (leadP < exp - 0.05) this.gMul = Math.min(1.7, this.gMul + dt * 0.08); else if (leadP > exp + 0.05) this.gMul = Math.max(0.85, this.gMul - dt * 0.05);
      }
      // THE WALL
      if (t > 1.6 && g.state === 'play' && last) {
        let v = s.wallSpeed * (0.75 + g.pace * 0.6);
        const gap = last.y - this.wallY;
        if (gap > 1400) v += (gap - 1400) * 0.8;
        this.wallV = lerp(this.wallV, v, 1 - Math.exp(-dt * 2));
        this.wallY += this.wallV * dt;
        for (const sc of this.sections) if (!sc.collapsed && this.wallY > sc.y1) {
          sc.collapsed = true; this.snd.sfx('collapse', 0.55); g.shake(0.25);
          for (let k = 0; k < 6; k++) this.fx.debris(this.rng.range(XL, XR), sc.y1 - 40, 120, 40, '#553344', 4, { power: 1.2 });
        }
      }
      // parts animation
      for (const p of this.parts) this.animPart(p, dt);
      const grav = s.gravity * this.gMul;
      const n = P.substeps(alive, dt, 0.4, 14);
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of alive) {
          if (!b.alive) continue;
          this.integrate(b, h, grav);
          b.vx += b.wander * 170 * h;
          if (b.speed > s.maxSpeed) b.setSpeed(s.maxSpeed);
          if (b.x < XL + b.r) { b.x = XL + b.r; b.vx = Math.abs(b.vx) * 0.5; }
          if (b.x > XR - b.r) { b.x = XR - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
          for (const p of this.parts) { if (b.y + b.r < p.y0 - 30 || b.y - b.r > p.y1 + 30) continue; this.collidePart(b, p); if (!b.alive) break; }
          if (!b.alive) continue;
          // crushed by the wall
          if (g.state === 'play' && b.y - b.r < this.wallY) this.kill(b, 'CRUSHED', 'crush');
          if (!b.finished && b.y > this.finishY) this.cross(b);
        }
        for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i], c = alive[j];
          if (!a.alive || !c.alive) continue;
          const imp = P.ballBall(a, c, 0.7);
          if (imp > 0) this.ballContact(a, c, imp);
        }
      }
      // behaviour: wander direction flips, unstick, close calls
      for (const b of alive) {
        if (!b.alive) continue;
        b.wanderT -= dt;
        if (b.wanderT <= 0) { b.wanderT = this.rng.range(0.8, 2); b.wander = this.rng.chance(0.5) ? -b.wander : b.wander; }
        if (b.y > b.maxY + 20) { b.maxY = b.y; b.progT = t; }
        if (t - b.progT > 2.4 && !b.finished) { b.progT = t; b.vy = -this.rng.range(300, 520); b.vx = this.rng.sign() * this.rng.range(200, 420); }
        const d = b.y - b.r - this.wallY;
        if (d < 70 && d > 0 && t - this.closeT > 3 && g.state === 'play') { this.closeT = t; b.close = true; }
        if (b.close && d > 170) { b.close = false; this.fx.popup(b.x, b.y - 60, 'CLOSE CALL!', '#ffd23f', 40); this.snd.sfx('whoosh', 0.5, g.pan(b.x)); this.pushFeed(`${b.name} escapes the wall`, b.color); }
        this.decayBall(b, dt);
      }
      this.updateLeader(sorted);
      if (!this.finalStretch && lead && this.finishY - lead.y < 1400 && g.state === 'play') {
        this.finalStretch = true; this.fx.banner('FINAL STRETCH', this.pal.accent, { size: 72, y: 0.5, dur: 1.3 }); this.snd.sfx('riser', 0.55);
      }
      // camera
      this.camera(dt, sorted);
      for (const f of this.feed) f.t += dt;
      this.feed = this.feed.filter((f) => f.t < 4);
    }
    camera(dt, sorted) {
      const cam = this.g.cam;
      if (!sorted.length) return;
      const lead = sorted[0], last = sorted[sorted.length - 1];
      const bottom = (lead.finished ? this.finishY + 300 : lead.y + 520) - 1760;
      const top = Math.min(last.y - 260, this.wallY + 120) - 470;
      let target = bottom <= top ? lerp(bottom, top, 0.5) : lerp(bottom, top, 0.2);
      target = Math.max(target, -300);
      cam.y = lerp(cam.y, target, 1 - Math.exp(-dt * 3.2));
    }
    animPart(p, dt) {
      const t = this.g.time;
      switch (p.t) {
        case 'door': {
          let want = 0;
          if (p.kind === 'trap') { const c = ((t + p.phase) % p.period) / p.period; want = c > 0.62 ? 1 : 0; if (want && !p.wasOpen) this.snd.sfx('door', 0.35, 0, 1.2); p.wasOpen = !!want; }
          else { want = t < p.openUntil || (p.unlock >= 0 && t > p.unlock) ? 1 : 0; }
          if (p.kind === 'gate' || p.kind === 'short') {
            if (p.target && !p.target.alive && !p.neutral) { p.neutral = true; p.color = '#ffffff'; this.pushFeed(`${p.target.name}'s gate is now open to all`, '#ffffff'); }
            if (p.kind === 'gate' && p.target && p.target.alive && p.target.y > p.ay + 60 && p.unlock < 0) p.unlock = t + 1.4;
          }
          if (p.kind === 'key' && p.unlock < 0) {
            // fail-safe: nobody holds the key and balls are waiting -> it opens after a while
            const waiting = this.balls.some((b) => b.alive && Math.abs(b.y - p.ay) < 80 && Math.abs(b.x - MID) < 200);
            if (waiting && !this.balls.some((b) => b.alive && b.key)) { p.waitT += dt; if (p.waitT > 4) p.unlock = t; }
          }
          p.open = clamp(p.open + (want ? dt * 6 : -dt * 5), 0, 1);
          break;
        }
        case 'tile':
          if (p.state === 1) { p.crack += dt; if (p.crack > 0.42) { p.state = 2; this.fx.debris(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, '#8a7a9a', 6, { size: 1 }); this.snd.sfx('crumble', 0.45, this.g.pan(p.x)); } }
          break;
        case 'saw': p.a += dt * 9; break;
        case 'spin': p.a += p.w * dt; break;
        case 'piston': p.ph += p.w * dt; break;
        case 'pad': case 'bump': p.flash = Math.max(0, (p.flash || 0) - dt * 4); break;
      }
    }
    pistonGap(p) { return 12 + (p.gap - 12) * (0.5 + 0.5 * Math.cos(p.ph)); }
    collidePart(b, p) {
      const g = this.g;
      switch (p.t) {
        case 'seg': {
          if (p.gone) return;
          if (P.segment(b, p.ax, p.ay, p.bx, p.by, p.ht)) { const imp = P.resolve(b, C.nx, C.ny, C.depth, p.e, 0, 0, p.fr); this.ping(b, imp); }
          return;
        }
        case 'peg': case 'bump': {
          if (!P.circle(b, p.x, p.y, p.r)) return;
          const imp = P.resolve(b, C.nx, C.ny, C.depth, p.t === 'bump' ? 1.2 : 0.5);
          if (p.t === 'bump') { const vn = b.vx * C.nx + b.vy * C.ny; if (vn < 800) { b.vx += C.nx * (800 - vn); b.vy += C.ny * (800 - vn); } p.flash = 1; this.snd.sfx('boing', 0.5, g.pan(b.x)); }
          this.ping(b, imp);
          return;
        }
        case 'door': {
          if (p.open > 0.35) return;
          if (!P.segment(b, p.ax, p.ay, p.bx, p.by, p.ht)) return;
          const imp = P.resolve(b, C.nx, C.ny, C.depth, 0.35, 0, 0, 0.03);
          this.ping(b, imp);
          const t = g.time;
          if (p.kind === 'gate' || p.kind === 'short') {
            if (p.neutral || b === p.target) {
              if (!(t < p.openUntil)) { this.snd.sfx('gate', 0.8, g.pan(b.x)); this.fx.burst(b.x, b.y + b.r, p.color, 26, 700, { grav: 0 }); this.pushFeed(p.kind === 'short' ? `${b.name} takes the SHORTCUT!` : `${b.name} opens the gate!`, b.color); if (p.kind === 'short') this.fx.popup(b.x, b.y - 60, 'SHORTCUT!', b.color, 40); }
              p.openUntil = t + (p.kind === 'short' ? 0.6 : 1.3);
            } else if (!p.nudged || t - p.nudged > 2) { p.nudged = t; this.fx.popup((p.ax + p.bx) / 2, p.ay - 70, `NEEDS ${p.target.name}`, p.color, 30); }
          } else if (p.kind === 'key') {
            if (b.key) {
              b.key = false; p.openUntil = t + 0.9; this.snd.sfx('gate', 0.8, g.pan(b.x)); this.snd.sfx('key', 0.6);
              this.pushFeed(`${b.name} unlocks the door!`, b.color); p.unlock = t + 2.6;
            } else if (!p.nudged || t - p.nudged > 2) { p.nudged = t; this.fx.popup(MID, p.ay - 70, 'LOCKED', '#ffd23f', 30); }
          }
          return;
        }
        case 'tile': {
          if (p.state === 2) return;
          // box collision via its top & sides (two segments)
          let hit = P.segment(b, p.x + 4, p.y, p.x + p.w - 4, p.y, 4);
          if (!hit) hit = P.segment(b, p.x + 4, p.y + p.h, p.x + p.w - 4, p.y + p.h, 4);
          if (!hit) return;
          const imp = P.resolve(b, C.nx, C.ny, C.depth, 0.3, 0, 0, 0.04);
          if (p.state === 0) { p.state = 1; p.crack = 0; }
          this.ping(b, imp);
          return;
        }
        case 'saw': {
          if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + p.r * 0.85 && g.state === 'play') { this.kill(b, 'SLICED', 'blade'); this.fx.burst(p.x, p.y, '#ffffff', 20, 800); }
          return;
        }
        case 'spin': {
          const cx = Math.cos(p.a) * p.L, cy = Math.sin(p.a) * p.L;
          if (P.segment(b, p.x - cx, p.y - cy, p.x + cx, p.y + cy, 10)) {
            const [wx, wy] = P.rotVel(C.px, C.py, p.x, p.y, p.w);
            const imp = P.resolve(b, C.nx, C.ny, C.depth, 0.6, wx, wy);
            this.ping(b, imp);
          }
          if (P.circle(b, p.x, p.y, 16)) P.resolve(b, C.nx, C.ny, C.depth, 0.5);
          return;
        }
        case 'pad': {
          if (!P.segment(b, p.ax, p.ay, p.bx, p.by, p.ht)) return;
          P.resolve(b, C.nx, C.ny, C.depth, 0.2);
          const up = -Math.abs(C.ny) || -1;
          b.vy = up * p.power * this.rng.range(0.8, 1.1); b.vx = (b.x < MID ? 1 : -1) * this.rng.range(250, 600);
          p.flash = 1;
          this.snd.sfx('boing', 0.7, g.pan(b.x), 1 + this.rng.range(-0.1, 0.1));
          this.fx.burst(b.x, b.y + b.r, '#ffffff', 10, 500, { dir: -Math.PI / 2, spread: 0.6, grav: 0 });
          return;
        }
        case 'piston': {
          const gap = this.pistonGap(p);
          const lx = MID - gap / 2, rx = MID + gap / 2;
          const v = -Math.sin(p.ph) * p.w * (p.gap - 12) / 2; // gap growth rate/2
          const inBand = b.y + b.r > p.y && b.y - b.r < p.y + p.h;
          // squash: caught between the jaws
          if (inBand && b.x > lx - 2 && b.x < rx + 2 && gap < b.r * 2 - 4 && g.state === 'play') { this.kill(b, 'SQUASHED', 'crush'); return; }
          const boxes = [[XL, lx, -v], [rx, XR, v]];
          for (const [x0, x1, vx] of boxes) {
            // top, bottom, inner face
            const segs = [[x0, p.y, x1, p.y], [x0, p.y + p.h, x1, p.y + p.h], x0 === XL ? [x1, p.y, x1, p.y + p.h] : [x0, p.y, x0, p.y + p.h]];
            for (const sg of segs) if (P.segment(b, sg[0], sg[1], sg[2], sg[3], 4)) { const imp = P.resolve(b, C.nx, C.ny, C.depth, 0.4, vx * Math.abs(C.nx), 0, 0.04); this.ping(b, imp); }
          }
          return;
        }
        case 'item': {
          if (p.taken) return;
          if (Math.hypot(b.x - p.x, b.y - p.y) > b.r + 34) return;
          if (p.kind === 'knife') { if (b.knife) return; b.knife = true; this.pushFeed(`${b.name} grabbed a KNIFE!`, b.color); this.fx.popup(b.x, b.y - 60, 'KNIFE!', '#ffffff', 42); }
          else { if (b.key) return; b.key = true; this.pushFeed(`${b.name} has the KEY!`, b.color); this.fx.popup(b.x, b.y - 60, 'KEY!', '#ffd23f', 42); }
          p.taken = true; this.snd.sfx('pickup', 0.8, g.pan(b.x)); this.fx.burst(p.x, p.y, '#ffffff', 22, 600, { grav: 0 });
          return;
        }
      }
    }
    ping(b, imp) {
      if (imp < 150 || this.g.clock - b.lastHit < 0.08) return;
      b.lastHit = this.g.clock;
      this.note(this.velFromImpact(imp, 1100) * 0.75, b.x);
      this.contactFx(b, C.px, C.py, C.nx, C.ny, imp * 0.5);
    }
    ballContact(a, c, imp) {
      if (this.g.state !== 'play') return;
      if (a.knife && c.knife) { a.knife = c.knife = false; this.snd.sfx('clang', 0.9, this.g.pan(a.x)); this.fx.burst((a.x + c.x) / 2, (a.y + c.y) / 2, '#ffffff', 30, 900); this.pushFeed('Knives clash — both break!', '#ffffff'); return; }
      if (a.knife || c.knife) {
        const killer = a.knife ? a : c, victim = a.knife ? c : a;
        killer.knife = false;
        this.kill(victim, `SLICED BY ${killer.name}`, 'blade');
        this.g.hitstop(0.08);
        this.g.moment({ x: victim.x, y: victim.y, zoom: 1.2, slow: 0.3, dur: 0.7 });
        this.fx.flare(victim.x, victim.y, '#ffffff', 900);
        return;
      }
      if (imp > 200) { this.note(0.4, a.x); }
    }
    kill(b, why, sfx) {
      if (!b.alive || this.g.state !== 'play') return;
      b.alive = false; b.status = why;
      this.fx.burst(b.x, b.y, b.color, 70, 1200, { colors: [b.color, '#ffffff'] });
      this.fx.ring(b.x, b.y, b.color, 280, 0.6, 12);
      this.fx.debris(b.x, b.y, b.r, b.r, b.color, 12, { power: 1.2 });
      this.snd.sfx('elim', 1, this.g.pan(b.x)); this.snd.sfx(sfx, 0.8, this.g.pan(b.x));
      this.g.shake(0.5); this.fx.flash(b.color, 0.2);
      this.pushFeed(`${b.name} ${why}`, b.color);
      if (why === 'CRUSHED' || why === 'SQUASHED' || why === 'SLICED') this.g.moment({ x: b.x, y: b.y, zoom: 1.12, slow: 0.4, dur: 0.5 });
      const left = this.alive();
      if (left.length === 1) {
        const w = left[0];
        this.g.win({ title: `${w.name} SURVIVES!`, sub: 'last ball standing', color: w.color, y: 900, fx: w.x, fy: w.y });
      } else if (left.length > 1) this.fx.banner(`${b.name} ${why.split(' ')[0]}!`, b.color, { size: 70, y: 0.55, sub: `${left.length} left`, dur: 1.3 });
    }
    cross(b) {
      b.finished = true;
      if (this.g.state !== 'play') return;
      this.fx.burst(b.x, b.y, b.color, 60, 1100, { colors: this.pal.grad });
      const second = this.alive().filter((q) => q !== b).sort((p, q) => q.y - p.y)[0];
      const photo = second && b.y - second.y < 260;
      this.g.win({ title: `${b.name} WINS!`, sub: photo ? `PHOTO FINISH over ${second.name}!` : `first to the finish · ${SB.util.fmtTime(this.g.time)}`, color: b.color, y: 900, fx: b.x, fy: b.y, zoom: photo ? 1.2 : 1.12 });
    }
    pushFeed(text, color) { this.feed.push({ text, color, t: 0 }); if (this.feed.length > 3) this.feed.shift(); }
    updateLeader(sorted) {
      sorted.forEach((b, i) => (b.place = i));
      const L = sorted[0];
      if (L && L !== this.leader) {
        if (this.leader && this.g.time - this.leaderT > 3 && this.g.time > 3 && this.g.state === 'play') {
          this.fx.popup(L.x, L.y - 60, 'NEW LEADER!', L.color, 38); this.snd.sfx('whoosh', 0.35, this.g.pan(L.x)); this.leaderT = this.g.time;
        }
        this.leader = L;
      }
    }
    audit() { const v = []; for (const b of this.alive()) { if (b.x < XL - 1 || b.x > XR + 1) v.push('ball through side wall'); if (b.y > this.finishY + 560) v.push('ball fell through floor'); } return v; }
    forceEnd() { this.wallV += 30; this.s.wallSpeed *= 1.01; }

    // ---------------------------------------------------------------- rendering
    render(ctx) {
      const pal = this.pal, light = pal.light;
      const cy = this.g.cam.y, vy0 = cy - 60, vy1 = cy + 1980;
      const line = light ? '#2a1a40' : '#e9e4ff';
      // side rails
      ctx.fillStyle = light ? 'rgba(40,20,60,0.08)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, vy0, XL, vy1 - vy0); ctx.fillRect(XR, vy0, this.W - XR, vy1 - vy0);
      ctx.fillStyle = rgba(line, 0.35); ctx.fillRect(XL - 3, vy0, 3, vy1 - vy0); ctx.fillRect(XR, vy0, 3, vy1 - vy0);
      // distance markers
      draw.font(ctx, 20, 700, 'Space Grotesk'); ctx.fillStyle = rgba(line, 0.25);
      for (let m = Math.ceil(vy0 / 500) * 500; m < vy1; m += 500) if (m > 300 && m < this.finishY) { ctx.fillRect(XL, m, 16, 2); ctx.fillText(Math.round((this.finishY - m) / 50) + 'm', XL + 22, m + 7); }
      // finish line
      if (this.finishY > vy0 && this.finishY < vy1) {
        const sq = 30;
        for (let x = XL, i = 0; x < XR; x += sq, i++) for (let r = 0; r < 2; r++) { ctx.fillStyle = (i + r) % 2 ? '#ffffff' : '#111111'; ctx.fillRect(x, this.finishY + r * sq / 2 - sq / 2, sq, sq / 2); }
        draw.font(ctx, 44, 900); ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.fillText('FINISH', MID, this.finishY - 40); ctx.textAlign = 'left';
      }
      for (const p of this.parts) { if (p.y1 < vy0 || p.y0 > vy1) continue; this.drawPart(ctx, p, line); }
      this.drawTrails(ctx, this.balls, 1.3, 0.45);
      for (const b of this.balls) {
        if (!b.alive) continue;
        draw.ball(ctx, b, this.look);
        this.tag(ctx, b, b.name, { size: 26, gap: 14 });
        if (b.knife) this.drawKnife(ctx, b.x + Math.cos(this.g.clock * 7) * (b.r + 22), b.y + Math.sin(this.g.clock * 7) * (b.r + 22), this.g.clock * 7 + Math.PI / 2, 1);
        if (b.key) this.drawKey(ctx, b.x + b.r + 14, b.y - b.r - 4, 0.7);
      }
      if (this.leader && this.leader.alive) draw.crown(ctx, this.leader.x, this.leader.y - this.leader.r - 58, 0.34);
      this.drawWall(ctx);
    }
    drawPart(ctx, p, line) {
      const pal = this.pal;
      ctx.lineCap = 'round';
      switch (p.t) {
        case 'seg':
          if (p.gone) return;
          ctx.strokeStyle = p.color || mix(line, pal.grad[4], 0.3); ctx.lineWidth = p.ht * 2;
          ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.bx, p.by); ctx.stroke();
          return;
        case 'peg':
          if (!pal.light) draw.glow(ctx, p.x, p.y, 64, pal.accent, 0.35);
          ctx.fillStyle = lighten(pal.accent, 0.4); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
          return;
        case 'bump': {
          const f = p.flash || 0;
          ctx.fillStyle = rgba(pal.grad[2], 0.25 + f * 0.5); ctx.beginPath(); ctx.arc(p.x, p.y, p.r + f * 8, 0, TAU); ctx.fill();
          ctx.lineWidth = 7; ctx.strokeStyle = mix(pal.grad[2], '#ffffff', f); ctx.stroke();
          return;
        }
        case 'door': {
          const o = easeOutCubic(p.open);
          const mx = (p.ax + p.bx) / 2, my = (p.ay + p.by) / 2;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.ht * 2;
          if (p.kind === 'trap') {
            // two leaves swinging down
            const hw = (p.bx - p.ax) / 2, a = o * 1.3;
            ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.ax + Math.cos(a) * hw, p.ay + Math.sin(a) * hw); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(p.bx, p.by); ctx.lineTo(p.bx - Math.cos(a) * hw, p.by + Math.sin(a) * hw); ctx.stroke();
            return;
          }
          // sliding gate halves with glow
          const dxh = (p.bx - p.ax) / 2 * (1 - o), dyh = (p.by - p.ay) / 2 * (1 - o);
          if (!pal.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, mx, my, 300, p.color, 0.35 + 0.2 * Math.sin(this.g.clock * 5)); ctx.globalCompositeOperation = 'source-over'; }
          ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.ax + dxh, p.ay + dyh); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(p.bx, p.by); ctx.lineTo(p.bx - dxh, p.by - dyh); ctx.stroke();
          if (o < 0.5) {
            if (p.kind === 'key') this.drawLock(ctx, mx, my - 50);
            else {
              draw.font(ctx, 24, 900); ctx.textAlign = 'center'; ctx.fillStyle = p.color;
              ctx.fillText(p.neutral ? 'OPEN TO ALL' : (p.kind === 'short' ? `${p.target.name} ONLY` : `${p.target.name} GATE`), mx, my - 32); ctx.textAlign = 'left';
            }
          }
          return;
        }
        case 'tile': {
          if (p.state === 2) return;
          const sh = p.state === 1 ? Math.sin(this.g.clock * 80) * 3 : 0;
          ctx.fillStyle = p.state === 1 ? '#c9a8b8' : (pal.light ? '#b9a9c9' : '#6e6090');
          draw.roundRect(ctx, p.x + 3 + sh, p.y, p.w - 6, p.h, 6); ctx.fill();
          if (p.state === 1) { ctx.strokeStyle = '#3a2030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x + p.w * 0.3, p.y); ctx.lineTo(p.x + p.w * 0.5, p.y + p.h); ctx.lineTo(p.x + p.w * 0.7, p.y + 4); ctx.stroke(); }
          return;
        }
        case 'saw': {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
          if (!pal.light) draw.glow(ctx, 0, 0, p.r * 4, '#ff3d5a', 0.35);
          ctx.fillStyle = '#e8ecf5'; ctx.beginPath();
          const teeth = 14;
          for (let i = 0; i < teeth * 2; i++) { const a = (i / (teeth * 2)) * TAU, rr = i % 2 ? p.r * 0.78 : p.r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ff3d5a'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.3, 0, TAU); ctx.fill();
          ctx.restore();
          return;
        }
        case 'spin': {
          const cx = Math.cos(p.a) * p.L, cy = Math.sin(p.a) * p.L;
          ctx.strokeStyle = pal.grad[1]; ctx.lineWidth = 20;
          ctx.beginPath(); ctx.moveTo(p.x - cx, p.y - cy); ctx.lineTo(p.x + cx, p.y + cy); ctx.stroke();
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, TAU); ctx.fill();
          return;
        }
        case 'pad': {
          ctx.strokeStyle = mix('#3dffb0', '#ffffff', p.flash || 0); ctx.lineWidth = p.ht * 2 + (p.flash || 0) * 6;
          ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.bx, p.by); ctx.stroke();
          return;
        }
        case 'piston': {
          const gap = this.pistonGap(p), lx = MID - gap / 2, rx = MID + gap / 2;
          const danger = gap < 90;
          for (const [x0, x1] of [[XL, lx], [rx, XR]]) {
            ctx.fillStyle = danger ? '#5a1e2e' : '#3a3552'; ctx.fillRect(x0, p.y, x1 - x0, p.h);
            ctx.save(); ctx.beginPath(); ctx.rect(x0, p.y, x1 - x0, p.h); ctx.clip();
            ctx.fillStyle = danger ? '#ff3d5a' : '#ffd23f';
            for (let x = x0 - 80; x < x1 + 80; x += 44) { ctx.beginPath(); ctx.moveTo(x, p.y + p.h); ctx.lineTo(x + 22, p.y + p.h); ctx.lineTo(x + 22 + p.h * 0.6, p.y); ctx.lineTo(x + p.h * 0.6, p.y); ctx.fill(); }
            ctx.restore();
          }
          return;
        }
        case 'item':
          if (p.taken) return;
          if (p.kind === 'knife') this.drawKnife(ctx, p.x, p.y + Math.sin(this.g.clock * 3 + p.bob) * 8, -0.6 + Math.sin(this.g.clock * 2) * 0.2, 1.5, true);
          else this.drawKey(ctx, p.x, p.y + Math.sin(this.g.clock * 3) * 8, 1.3, true);
          return;
        case 'label':
          draw.font(ctx, 34, 900); ctx.textAlign = 'center'; ctx.globalAlpha = 0.6; ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y); ctx.fillText('▼', p.x, p.y + 50); ctx.globalAlpha = 1; ctx.textAlign = 'left';
          return;
      }
    }
    drawKnife(ctx, x, y, a, s, glow) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
      if (glow && !this.pal.light) draw.glow(ctx, 0, 0, 120, '#ffffff', 0.4);
      ctx.fillStyle = '#eef2ff'; ctx.beginPath(); ctx.moveTo(0, -30); ctx.quadraticCurveTo(9, -8, 6, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6b3a2a'; draw.roundRect(ctx, -5, 6, 10, 18, 3); ctx.fill();
      ctx.fillStyle = '#c9ced9'; ctx.fillRect(-9, 4, 18, 4);
      ctx.restore();
    }
    drawKey(ctx, x, y, s, glow) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      if (glow && !this.pal.light) draw.glow(ctx, 0, 0, 130, '#ffd23f', 0.5);
      ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#ffd23f'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(-12, 0, 10, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(22, 0); ctx.moveTo(14, 0); ctx.lineTo(14, 9); ctx.moveTo(21, 0); ctx.lineTo(21, 8); ctx.stroke();
      ctx.restore();
    }
    drawLock(ctx, x, y) {
      ctx.save(); ctx.translate(x, y);
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, -8, 12, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#ffd23f'; draw.roundRect(ctx, -17, -8, 34, 28, 6); ctx.fill();
      ctx.fillStyle = '#3a2a00'; ctx.beginPath(); ctx.arc(0, 4, 4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    drawWall(ctx) {
      const y = this.wallY, cy = this.g.cam.y;
      if (y < cy - 40) return;
      const top = cy - 60;
      const g = ctx.createLinearGradient(0, y - 400, 0, y);
      g.addColorStop(0, '#1a0508'); g.addColorStop(1, '#4a0c18');
      ctx.fillStyle = g; ctx.fillRect(0, top, this.W, y - top);
      // spikes
      ctx.fillStyle = '#ff3d5a';
      ctx.beginPath();
      for (let x = 0; x <= this.W; x += 54) { ctx.moveTo(x, y - 2); ctx.lineTo(x + 27, y + 36); ctx.lineTo(x + 54, y - 2); }
      ctx.fill();
      ctx.fillStyle = '#ff3d5a'; ctx.fillRect(0, y - 8, this.W, 8);
      if (!this.pal.light) { ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createLinearGradient(0, y, 0, y + 260); gg.addColorStop(0, 'rgba(255,40,70,0.35)'); gg.addColorStop(1, 'rgba(255,40,70,0)'); ctx.fillStyle = gg; ctx.fillRect(0, y, this.W, 260); ctx.globalCompositeOperation = 'source-over'; }
      if (y - top > 80) { draw.font(ctx, 36, 900); ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText('▼  THE WALL  ▼', MID, y - 30); ctx.textAlign = 'left'; }
    }
    hud(ctx) {
      const pal = this.pal, W = this.W, n = this.balls.length;
      // scrim so the scrolling course never fights the text
      const sc = ctx.createLinearGradient(0, 0, 0, 500);
      sc.addColorStop(0, SB.util.rgba(pal.bg[0], 0.96)); sc.addColorStop(0.72, SB.util.rgba(pal.bg[0], 0.82)); sc.addColorStop(1, SB.util.rgba(pal.bg[0], 0));
      ctx.fillStyle = sc; ctx.fillRect(0, 0, W, 500);
      // leaderboard cards
      const order = this.balls.slice().sort((a, b) => (b.alive - a.alive) || (a.alive ? a.place - b.place : 0));
      const cw = Math.min(250, (W - 60) / n - 10), x0 = W / 2 - (cw * n + 10 * (n - 1)) / 2, y0 = 275;
      order.forEach((b, i) => {
        const x = x0 + i * (cw + 10);
        ctx.globalAlpha = b.alive ? 1 : 0.5;
        draw.panel(ctx, x, y0, cw, 96, 20, this.look, 0.6);
        ctx.fillStyle = b.color; draw.roundRect(ctx, x, y0, cw, 8, 4); ctx.fill();
        draw.font(ctx, 20, 900); ctx.fillStyle = pal.light ? pal.text : '#ffffff';
        const ord = b.alive ? (i + 1) + (['ST', 'ND', 'RD'][i] || 'TH') : '✕';
        ctx.fillText(ord, x + 14, y0 + 40);
        const ow = ctx.measureText(ord).width;
        ctx.fillStyle = b.color; draw.font(ctx, cw > 200 ? 25 : 21, 900);
        const nm = b.name; let fs = cw > 200 ? 25 : 21;
        while (ctx.measureText(nm).width > cw - ow - 34 && fs > 14) { fs--; draw.font(ctx, fs, 900); }
        ctx.fillText(nm, x + 22 + ow, y0 + 41);
        draw.font(ctx, 19, 700, 'Space Grotesk');
        ctx.fillStyle = b.alive ? (pal.light ? rgba(pal.text, 0.7) : 'rgba(255,255,255,0.75)') : '#ff5a70';
        let st = b.alive ? `${Math.max(0, Math.round((this.finishY - b.y) / 50))}m to go` : b.status;
        if (b.alive && b.y - this.wallY < 260) { st = 'WALL CLOSE!'; ctx.fillStyle = '#ff5a70'; }
        ctx.fillText(st.length > 18 ? st.slice(0, 17) + '…' : st, x + 14, y0 + 76);
        if (b.knife) this.drawKnife(ctx, x + cw - 24, y0 + 44, 0.5, 0.8);
        if (b.key) this.drawKey(ctx, x + cw - 30, y0 + 70, 0.55);
        ctx.globalAlpha = 1;
      });
      // tracker bar (left edge)
      const tx = 22, ty0 = 520, ty1 = 1640;
      ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.15)' : 'rgba(255,255,255,0.12)'; draw.roundRect(ctx, tx - 4, ty0, 8, ty1 - ty0, 4); ctx.fill();
      const toY = (wy) => lerp(ty0, ty1, clamp(wy / this.finishY, 0, 1));
      ctx.fillStyle = '#ff3d5a'; ctx.fillRect(tx - 12, toY(this.wallY) - 3, 24, 6);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(tx - 12, ty1 - 2, 24, 4);
      for (const b of this.balls) if (b.alive) { ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(tx, toY(b.y), 9, 0, TAU); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke(); }
      // feed
      this.feed.forEach((f, i) => {
        const a = f.t < 0.2 ? f.t / 0.2 : f.t > 3.4 ? (4 - f.t) / 0.6 : 1;
        ctx.globalAlpha = a;
        draw.font(ctx, 24, 700, 'Space Grotesk'); ctx.textAlign = 'center';
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineJoin = 'round';
        ctx.strokeText(f.text, W / 2, 410 + i * 32); ctx.fillStyle = f.color; ctx.fillText(f.text, W / 2, 410 + i * 32);
        ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      });
    }
    stats() { return { alive: this.alive().map((b) => b.name + '@' + Math.round(b.y)), dead: this.balls.filter((b) => !b.alive).map((b) => b.name + ':' + b.status), finishY: this.finishY, wallY: Math.round(this.wallY), plan: this.sections.map((q) => q.kind).join(',') }; }
  }

  SB.modes.register({
    id: 'course', name: 'Obstacle Course Survival', icon: '⛛', category: 'Survival', tagline: 'Outrun THE WALL through gates, blades and traps',
    hook: 'Who *survives* the course?',
    hookY: 150,
    settings: [
      { key: 'balls', label: 'Balls', type: 'range', min: 2, max: 6, step: 1, def: 4, rand: [3, 5] },
      { key: 'length', label: 'Course sections', type: 'range', min: 4, max: 16, step: 1, def: 9, rand: [8, 11] },
      { key: 'wallSpeed', label: 'Wall speed', type: 'range', min: 40, max: 400, step: 5, def: 120, rand: [105, 140] },
      { key: 'danger', label: 'Hazards (saws)', type: 'range', min: 0, max: 2, step: 0.1, def: 1, rand: [0.6, 1.4] },
      { key: 'knives', label: 'Knives on course', type: 'range', min: 0, max: 4, step: 1, def: 2, rand: [1, 3] },
      { key: 'gates', label: 'Colour gates & shortcuts', type: 'toggle', def: true, rand: false },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 600, max: 3000, step: 50, def: 1600, rand: [1400, 1900] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 14, max: 34, step: 1, def: 24, rand: [22, 27] },
      { key: 'maxSpeed', label: 'Max speed', type: 'range', min: 600, max: 3000, step: 50, def: 1500 },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: '4 Survivors', s: {} },
      { name: 'Long Haul (60s)', s: { length: 13, wallSpeed: 190 } },
      { name: 'Knife Fight', s: { knives: 4, balls: 5 } },
      { name: 'Duel', s: { balls: 2, length: 8, knives: 1 } },
    ],
    create: (g, s) => new Course(g, s),
  });
})(window.SB);
