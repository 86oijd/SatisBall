/* Mode: Rotating Maze — a procedurally generated circular (theta) maze spins while gravity rolls the
 * balls through it. Walls crack and crumble under impacts, so every run finds its way out. First ball out wins. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, gradientAt, mix, normAngle, lighten } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;

  class Maze extends SB.Mode {
    init() {
      const s = this.s, g = this.g;
      this.cx = 540; this.cy = 1140;
      const M = s.rings;
      this.r0 = Math.max(s.ballSize * 3.2, 64);
      this.Rout = s.size;
      this.band = (this.Rout - this.r0) / M;
      this.th = s.wall / 2;
      // sectors per ring: double whenever cells get too wide
      this.S = [1];
      for (let k = 1; k <= M; k++) {
        let S = k === 1 ? s.inner : this.S[k - 1];
        const mid = this.r0 + (k - 0.5) * this.band;
        if (k > 1 && TAU * mid / S > this.band * 2.1) S *= 2;
        this.S.push(S);
      }
      this.buildMaze();
      this.rot = 0; this.w = s.spin;
      this.balls = [];
      const n = s.balls, cols = this.distinctColors(n, 10);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const b = new P.Ball(this.cx + Math.cos(a) * (n > 1 ? this.r0 * 0.4 : 0), this.cy + Math.sin(a) * (n > 1 ? this.r0 * 0.4 : 0), s.ballSize, { color: n === 1 ? (s.ballColor || this.color(cols[0])) : this.color(cols[i]), name: this.cname(cols[i]) });
        b.vx = this.rng.range(-200, 200); b.vy = this.rng.range(-200, 0); b.lastHit = -1; b.out = false; b.best = 0;
        this.balls.push(b);
      }
      this.wallMul = 1; this.gateMul = 1; this.stuck = false; this.broken = 0; this.lastProg = 0; this.lastProgT = 0; this.near = -9;
      this.trailLen = 16;
    }
    buildMaze() {
      const s = this.s, M = s.rings, S = this.S, rng = this.rng;
      // cells: id 0 = centre; ring k (1..M) sector j -> id
      const id = [[0]]; let n = 1;
      this.cellK = [0]; this.cellJ = [0];
      for (let k = 1; k <= M; k++) { id.push([]); for (let j = 0; j < S[k]; j++) { id[k].push(n++); this.cellK.push(k); this.cellJ.push(j); } }
      this.id = id; this.nCells = n;
      const nb = [...Array(n)].map(() => []);
      const link = (a, b, wall) => { nb[a].push([b, wall]); nb[b].push([a, wall]); };
      // walls: arcs (between ring k and k+1, piece per outer sector) and radials (inside ring k)
      this.arcs = []; this.rads = [];
      for (let k = 1; k <= M; k++) {
        // arc at the inner edge of ring k (radius R_{k-1}), one piece per sector of ring k
        for (let j = 0; j < S[k]; j++) {
          const a0 = (j / S[k]) * TAU, span = TAU / S[k];
          const w = { k, j, R: this.r0 + (k - 1) * this.band, a0, span, alive: true, hp: s.wallHp, flash: 0 };
          this.arcs.push(w);
          const inner = k === 1 ? 0 : id[k - 1][Math.floor(j * S[k - 1] / S[k])];
          link(id[k][j], inner, w);
        }
        // radial wall between sector j and j+1 of ring k
        if (S[k] > 1) for (let j = 0; j < S[k]; j++) {
          const w = { k, j, a: ((j + 1) / S[k]) * TAU, R1: this.r0 + (k - 1) * this.band, R2: this.r0 + k * this.band, alive: true, hp: s.wallHp, flash: 0 };
          this.rads.push(w);
          link(id[k][j], id[k][(j + 1) % S[k]], w);
        }
      }
      // outer boundary arcs
      this.outer = [];
      for (let j = 0; j < S[M]; j++) this.outer.push({ k: M + 1, j, R: this.Rout, a0: (j / S[M]) * TAU, span: TAU / S[M], alive: true, hp: Infinity, flash: 0, boundary: true });
      // carve a perfect maze (randomised DFS from the centre)
      const seen = new Uint8Array(n), stack = [0]; seen[0] = 1;
      this.tree = [...Array(n)].map(() => []);
      while (stack.length) {
        const c = stack[stack.length - 1];
        const opts = nb[c].filter(([d]) => !seen[d]);
        if (!opts.length) { stack.pop(); continue; }
        const [d, w] = opts[rng.int(0, opts.length - 1)];
        w.alive = false; w.carved = true; seen[d] = 1; stack.push(d);
        this.tree[c].push(d); this.tree[d].push(c);
      }
      // a few extra openings make it flow better (loops)
      const extra = Math.round((this.arcs.length + this.rads.length) * s.loops);
      for (let i = 0; i < extra; i++) { const pool = this.arcs.concat(this.rads).filter((w) => w.alive); if (!pool.length) break; const w = rng.pick(pool); w.alive = false; }
      // exit: the outer-ring cell furthest (in the tree) from the centre
      const dist = this.bfs(0);
      let best = 0, bj = 0;
      for (let j = 0; j < S[M]; j++) { const d = dist[id[M][j]]; if (d > best) { best = d; bj = j; } }
      this.exitJ = bj;
      const gate = this.outer[bj]; gate.exit = true;
      if (s.gate > 0) { gate.boundary = false; gate.gate = true; gate.hp = s.gate; gate.maxHp = s.gate; } else gate.alive = false;
      this.exitCell = id[M][bj];
      this.distToExit = this.bfsOpen(this.exitCell);
      this.maxDist = Math.max(1, this.distToExit[0]);
    }
    bfs(src) {
      const d = new Int32Array(this.nCells).fill(-1), q = [src]; d[src] = 0;
      while (q.length) { const c = q.shift(); for (const e of this.tree[c]) if (d[e] < 0) { d[e] = d[c] + 1; q.push(e); } }
      return d;
    }
    /** Distances through currently open walls (updates as walls crumble). */
    bfsOpen(src) {
      const n = this.nCells, adj = [...Array(n)].map(() => []);
      for (const w of this.arcs) if (!w.alive) { const k = w.k, S = this.S; const a = this.id[k][w.j], b = k === 1 ? 0 : this.id[k - 1][Math.floor(w.j * S[k - 1] / S[k])]; adj[a].push(b); adj[b].push(a); }
      for (const w of this.rads) if (!w.alive) { const a = this.id[w.k][w.j], b = this.id[w.k][(w.j + 1) % this.S[w.k]]; adj[a].push(b); adj[b].push(a); }
      const d = new Int32Array(n).fill(9999), q = [src]; d[src] = 0;
      while (q.length) { const c = q.shift(); for (const e of adj[c]) if (d[e] > d[c] + 1) { d[e] = d[c] + 1; q.push(e); } }
      this.openAdj = adj;
      return d;
    }
    cellOf(b) {
      const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy);
      if (d < this.r0) return 0;
      const k = Math.min(this.s.rings, Math.floor((d - this.r0) / this.band) + 1);
      const a = normAngle(Math.atan2(dy, dx) - this.rot);
      return this.id[k][Math.min(this.S[k] - 1, Math.floor(a / TAU * this.S[k]))];
    }
    progress(b) { if (b.out) return 1; const d = this.distToExit[this.cellOf(b)]; return clamp(1 - Math.min(d, this.maxDist) / this.maxDist, 0, 1); }
    roster() { return this.balls.length > 1 ? this.balls.map((b) => ({ name: b.name, color: b.color })) : null; }
    trailBalls() { return this.balls; }
    wallHit(w, b, imp) {
      const g = this.g;
      w.flash = 1;
      if (g.clock - b.lastHit > 0.05) { b.lastHit = g.clock; this.note(this.velFromImpact(imp, 700) * 0.8, b.x); this.contactFx(b, C.px, C.py, C.nx, C.ny, imp); }
      if (w.gate) {
        if (imp < 35 || g.clock - (w.hitT || -9) < 0.12) return;
        w.hitT = g.clock;
        w.hp -= this.gateMul; w.pop = 1;
        this.snd.sfx('thud', 0.6, g.pan(b.x), 0.9 + 0.3 * (1 - w.hp / w.maxHp)); g.shake(0.1);
        if (w.hp <= 0) this.breakGate(w, b);
        return;
      }
      if (w.boundary || (!this.s.crumble && !this.forced) || imp < 90) return;
      w.hp -= this.wallMul * clamp(imp / 400, 0.4, 2);
      if (w.hp <= 0) this.breakWall(w);
    }
    /** Resting contact while the run is stuck slowly grinds the wall away. */
    press(w, h, b) {
      if (w.gate && w.alive) {
        // rolling along the gate grinds it down too (the number keeps ticking)
        w.hp -= this.gateMul * h * 6;
        if (w.hp <= 0) this.breakGate(w, b);
        return;
      }
      if (w.boundary || !this.stuck) return;
      if (!this.s.crumble && !this.forced) return;
      w.hp -= this.wallMul * h * 1.2;
      if (w.hp <= 0) this.breakWall(w);
    }
    breakGate(w, b) {
      const g = this.g;
      w.alive = false;
      const a = w.a0 + w.span / 2 + this.rot;
      this.fx.shatterArc(this.cx, this.cy, w.R, w.a0 + this.rot, w.span, this.s.wall * 1.6, () => '#7dff9a', { power: 1.6 });
      this.fx.banner('GATE BROKEN!', '#7dff9a', { size: 80, y: 0.3, dur: 1 });
      this.snd.sfx('shatter', 0.9, g.pan(b.x)); this.snd.sfx('boom', 0.6, 0);
      g.moment({ x: this.cx + Math.cos(a) * w.R, y: this.cy + Math.sin(a) * w.R, zoom: 1.15, slow: 0.35, dur: 0.8, flash: '#7dff9a', flashA: 0.2 });
    }
    breakWall(w) {
      const g = this.g;
      w.alive = false; this.broken++;
      const col = this.wallColor(w);
      if (w.a0 !== undefined) this.fx.shatterArc(this.cx, this.cy, w.R, w.a0 + this.rot, w.span, this.s.wall, () => col, { power: 0.8 });
      else { const a = w.a + this.rot; const mx = this.cx + Math.cos(a) * (w.R1 + w.R2) / 2, my = this.cy + Math.sin(a) * (w.R1 + w.R2) / 2; this.fx.debris(mx, my, this.s.wall * 2, w.R2 - w.R1, col, 8, { power: 0.8 }); }
      this.snd.sfx('crumble', 0.55, g.pan(this.cx), 1 + this.rng.range(-0.1, 0.1));
      g.shake(0.12);
      this.distToExit = this.bfsOpen(this.exitCell);
    }
    wallColor(w) { return gradientAt(this.pal.grad, clamp((w.k - 1) / Math.max(1, this.s.rings), 0, 1) * 0.9); }
    collide(b, h = 0) {
      const th = this.th, d = Math.hypot(b.x - this.cx, b.y - this.cy), rr = b.r + th + 2;
      let hit = false;
      const tryArc = (w) => {
        if (!w.alive || Math.abs(d - w.R) > rr) return;
        if (P.arc(b, this.cx, this.cy, w.R, th, w.a0 + this.rot, w.span, 0)) {
          const [wx, wy] = P.rotVel(C.px, C.py, this.cx, this.cy, this.w);
          const imp = P.resolve(b, C.nx, C.ny, C.depth, this.s.bounce, wx, wy, 0.12);
          if (imp > 30) this.wallHit(w, b, imp);
          this.press(w, h, b);
          hit = true;
        }
      };
      for (const w of this.arcs) tryArc(w);
      for (const w of this.outer) tryArc(w);
      for (const w of this.rads) {
        if (!w.alive || d < w.R1 - rr || d > w.R2 + rr) continue;
        const a = w.a + this.rot, c = Math.cos(a), sn = Math.sin(a);
        if (P.segment(b, this.cx + c * w.R1, this.cy + sn * w.R1, this.cx + c * w.R2, this.cy + sn * w.R2, th)) {
          const [wx, wy] = P.rotVel(C.px, C.py, this.cx, this.cy, this.w);
          const imp = P.resolve(b, C.nx, C.ny, C.depth, this.s.bounce, wx, wy, 0.12);
          if (imp > 30) this.wallHit(w, b, imp);
          this.press(w, h, b);
          hit = true;
        }
      }
      return hit;
    }
    update(dt) {
      const s = this.s, g = this.g;
      const prog = Math.max(...this.balls.map((b) => this.progress(b)));
      g.tension = prog;
      if (prog > this.lastProg + 0.01) { this.lastProg = prog; this.lastProgT = g.time; }
      // pacing: walls get softer when the best ball is behind schedule or stuck
      if (s.assist && g.state === 'play') {
        const exp = clamp(g.time / (g.targetLen * 0.85), 0, 1), stall = g.time - this.lastProgT;
        if (prog < exp - 0.08 || stall > 5) this.wallMul = Math.min(40, this.wallMul * (1 + dt * (0.35 + Math.min(1, stall / 10))));
        else if (prog > exp + 0.1) this.wallMul = Math.max(0.2, this.wallMul * (1 - dt * 0.6));
        this.stuck = stall > 4 && prog < exp;
        // the exit gate holds early arrivals (suspense) and gives way quickly to late ones
        const tt = g.time / g.targetLen;
        this.gateMul = tt < 0.5 ? 0.3 : tt < 0.72 ? 0.9 : tt < 0.88 ? 2 : 5;
      } else {
        this.stuck = false; this.gateMul = 1;
      }
      // rotation (optionally reverses)
      let dir = s.reverse ? (Math.floor(g.time / s.reverseEvery) % 2 ? -1 : 1) : 1;
      // stuck: spin the way that brings the next open passage (towards the exit) under the leading ball
      if (this.stuck || this.steerT > 0) {
        this.steerT = this.stuck ? 1.5 : this.steerT - dt;
        const lead = this.balls.filter((b) => !b.out).sort((a, b) => this.progress(b) - this.progress(a))[0];
        if (lead && (this.stuck || this.steerDir === undefined)) {
          const c = this.cellOf(lead);
          let best = -1, bd = this.distToExit[c];
          for (const e of this.openAdj[c]) if (this.distToExit[e] < bd) { bd = this.distToExit[e]; best = e; }
          if (c === this.exitCell) best = c;
          // really stuck: head straight for the exit's angle and grind through whatever is in the way
          if (g.time - this.lastProgT > 8) best = this.exitCell;
          if (best > 0) {
            const k = this.cellK[best], ta = (this.cellJ[best] + 0.5) / this.S[k] * TAU;
            const ba = normAngle(Math.atan2(lead.y - this.cy, lead.x - this.cx) - this.rot);
            const dd = SB.util.angleDiff(ba, ta);
            if (Math.abs(dd) > 0.05) this.steerDir = dd > 0 ? -1 : 1;
          }
        }
        if (this.steerDir) dir = this.steerDir * Math.sign(s.spin || 1);
      }
      this.w = lerp(this.w, s.spin * dir * (1 + prog * s.ramp), 1 - Math.exp(-dt * 2));
      this.rot += this.w * dt;
      const n = P.substeps(this.balls, dt, 0.35, 16), h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of this.balls) {
          this.integrate(b, h, s.gravity);
          if (b.out) { this.screenBox(b, 0.8); continue; }
          this.collide(b, h);
          const d = Math.hypot(b.x - this.cx, b.y - this.cy);
          if (d > this.Rout + this.th + b.r * 1.1) this.escape(b);
        }
        if (this.balls.length > 1) for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) P.ballBall(this.balls[i], this.balls[j], 0.9);
        for (const b of this.balls) {
          if (b.out) continue;
          this.collide(b); // ball-ball pushes can't shove anyone through a wall
          const sp = b.speed; if (sp > s.maxSpeed) b.setSpeed(s.maxSpeed);
        }
      }
      for (const w of this.arcs) w.flash = Math.max(0, w.flash - dt * 4);
      for (const w of this.rads) w.flash = Math.max(0, w.flash - dt * 4);
      for (const w of this.outer) w.flash = Math.max(0, w.flash - dt * 4);
      for (const b of this.balls) { this.decayBall(b, dt); b.best = Math.max(b.best, this.progress(b)); }
      // suspense: a ball enters the exit cell
      if (g.state === 'play' && g.time - this.near > 3) for (const b of this.balls) if (!b.out && this.cellOf(b) === this.exitCell) { this.near = g.time; g.moment({ x: b.x, y: b.y, zoom: 1.12, slow: 0.4, dur: 0.7 }); this.fx.popup(b.x, b.y - 50, 'ALMOST OUT!', '#ffffff', 44); break; }
    }
    escape(b) {
      const g = this.g;
      b.out = true;
      if (g.state !== 'play') return;
      this.fx.burst(b.x, b.y, b.color, 50, 1000, { colors: [b.color, '#ffffff'] });
      g.win({ title: this.balls.length > 1 ? `${b.name} ESCAPED FIRST!` : 'IT ESCAPED!', sub: `${this.s.rings} rings · ${this.broken} walls broken · ${g.time.toFixed(1)}s`, color: b.color, y: 760, fx: b.x, fy: b.y });
    }
    forceEnd() { this.wallMul = 999; this.forced = true; }
    audit() {
      const v = [];
      for (const b of this.balls) {
        if (b.out) continue;
        const d = Math.hypot(b.x - this.cx, b.y - this.cy);
        if (d > this.Rout + this.th + b.r * 1.2) v.push('ball left maze without escaping');
      }
      return v;
    }
    render(ctx) {
      const pal = this.pal, cx = this.cx, cy = this.cy, rot = this.rot, g = this.g;
      ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(cx, cy, this.Rout + 10, 0, TAU); ctx.fill();
      // exit glow
      const ex = this.outer[this.exitJ], ea = ex.a0 + ex.span / 2 + rot;
      if (!this.look.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, cx + Math.cos(ea) * this.Rout, cy + Math.sin(ea) * this.Rout, 160, '#7dff9a', 0.4 + 0.2 * Math.sin(g.clock * 5)); ctx.globalCompositeOperation = 'source-over'; }
      ctx.lineCap = 'round';
      const drawArc = (w) => {
        const col = w.gate ? '#7dff9a' : w.boundary ? pal.accent : this.wallColor(w), crack = w.hp === Infinity ? 1 : clamp(w.hp / this.s.wallHp, 0.25, 1);
        ctx.strokeStyle = mix(col, '#ffffff', w.flash * 0.5); ctx.globalAlpha = 0.55 + 0.45 * crack; ctx.lineWidth = this.s.wall;
        ctx.beginPath(); ctx.arc(cx, cy, w.R, w.a0 + rot, w.a0 + w.span + rot); ctx.stroke();
      };
      for (const w of this.arcs) if (w.alive) drawArc(w);
      for (const w of this.outer) if (w.alive) drawArc(w);
      for (const w of this.rads) {
        if (!w.alive) continue;
        const a = w.a + rot, c = Math.cos(a), sn = Math.sin(a), crack = clamp(w.hp / this.s.wallHp, 0.25, 1);
        ctx.strokeStyle = mix(this.wallColor(w), '#ffffff', w.flash * 0.5); ctx.globalAlpha = 0.55 + 0.45 * crack; ctx.lineWidth = this.s.wall;
        ctx.beginPath(); ctx.moveTo(cx + c * w.R1, cy + sn * w.R1); ctx.lineTo(cx + c * w.R2, cy + sn * w.R2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // gate HP
      const gw = this.outer[this.exitJ];
      if (gw.gate && gw.alive) {
        gw.pop = Math.max(0, (gw.pop || 0) - 1 / 30);
        const gx = cx + Math.cos(ea) * (this.Rout + 70), gy = cy + Math.sin(ea) * (this.Rout + 70);
        ctx.save(); ctx.translate(gx, gy); ctx.scale(1 + gw.pop * 0.3, 1 + gw.pop * 0.3);
        ctx.fillStyle = '#1b3a26'; ctx.beginPath(); ctx.arc(0, 0, 36, 0, TAU); ctx.fill(); ctx.strokeStyle = '#7dff9a'; ctx.lineWidth = 5; ctx.stroke();
        draw.label(ctx, String(Math.max(1, Math.ceil(gw.hp))), 0, 12, 34, '#ffffff', 900, 0.2);
        ctx.restore();
      }
      // exit arrow
      ctx.save(); ctx.translate(cx + Math.cos(ea) * (this.Rout + 40), cy + Math.sin(ea) * (this.Rout + 40)); ctx.rotate(ea);
      ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -15); ctx.lineTo(-10, 15); ctx.closePath(); ctx.fill(); ctx.restore();
      // centre hub
      ctx.fillStyle = rgba(pal.accent, 0.12); ctx.beginPath(); ctx.arc(cx, cy, this.r0 - this.th, 0, TAU); ctx.fill();
      this.drawTrails(ctx, this.balls, 1.2, 0.45);
      this.drawBalls(ctx, this.balls);
      if (this.balls.length > 1) for (const b of this.balls) if (!b.out) this.tag(ctx, b, b.name, { size: 22, gap: 10 });
    }
    hud(ctx) {
      const pal = this.pal, W = this.W;
      if (this.balls.length === 1) {
        const p = this.progress(this.balls[0]);
        this.g.hudCounter(ctx, 'escape progress', Math.round(p * 100) + '%', p, { y: 310, size: 70 });
        return;
      }
      const order = this.balls.slice().sort((a, b) => this.progress(b) - this.progress(a));
      const n = order.length, cw = Math.min(240, (W - 60) / n - 10), x0 = W / 2 - (cw * n + 10 * (n - 1)) / 2, y = 320;
      order.forEach((b, i) => {
        const x = x0 + i * (cw + 10);
        draw.panel(ctx, x, y, cw, 84, 18, this.look, 0.7);
        ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x + 34, y + 42, 20, 0, TAU); ctx.fill();
        draw.font(ctx, 22, 900); ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.fillText((i + 1) + ['ST', 'ND', 'RD', 'TH'][Math.min(3, i)], x + 64, y + 34);
        draw.font(ctx, 20, 800); ctx.fillStyle = b.color; ctx.fillText(b.name.slice(0, 9), x + 64, y + 60);
        const pw = cw - 24; draw.roundRect(ctx, x + 12, y + 70, pw, 6, 3); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
        draw.roundRect(ctx, x + 12, y + 70, Math.max(6, pw * this.progress(b)), 6, 3); ctx.fillStyle = b.color; ctx.fill();
      });
    }
    stats() { return { broken: this.broken, prog: this.balls.map((b) => this.progress(b).toFixed(2)) }; }
  }

  SB.modes.register({
    id: 'maze', name: 'Rotating Maze', icon: '🌀', category: 'Escape', tagline: 'A random circular maze spins — gravity rolls the ball to the exit',
    hook: 'Can it find the *way out?*',
    hookY: 180,
    settings: [
      { key: 'balls', label: 'Balls (race)', type: 'range', min: 1, max: 4, step: 1, def: 1, rand: [1, 1, 2, 3] },
      { key: 'rings', label: 'Maze rings', type: 'range', min: 3, max: 9, step: 1, def: 7, rand: [6, 8] },
      { key: 'inner', label: 'Inner ring cells', type: 'range', min: 4, max: 12, step: 1, def: 6, rand: [5, 8] },
      { key: 'loops', label: 'Extra openings', type: 'range', min: 0, max: 0.3, step: 0.01, def: 0.06, rand: [0.03, 0.1] },
      { key: 'spin', label: 'Spin speed', type: 'range', min: -2, max: 2, step: 0.05, def: 0.7, rand: [-1, 1] },
      { key: 'ramp', label: 'Spin-up as it gets closer', type: 'range', min: 0, max: 2, step: 0.1, def: 0.5, rand: [0.2, 0.8] },
      { key: 'reverse', label: 'Reverse spin', type: 'toggle', def: true, rand: [true, false] },
      { key: 'reverseEvery', label: 'Reverse every (s)', type: 'range', min: 2, max: 15, step: 0.5, def: 6, rand: [4, 8], show: (s) => s.reverse },
      { key: 'gate', label: 'Exit gate hits (0 = open)', type: 'range', min: 0, max: 50, step: 1, def: 12, rand: [8, 20] },
      { key: 'crumble', label: 'Walls crack & crumble', type: 'toggle', def: true, rand: false },
      { key: 'wallHp', label: 'Wall strength', type: 'range', min: 1, max: 30, step: 1, def: 6, rand: [4, 9], show: (s) => s.crumble },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 300, max: 3000, step: 50, def: 1500, rand: [1200, 1900] },
      { key: 'bounce', label: 'Bounciness', type: 'range', min: 0.3, max: 1, step: 0.05, def: 0.7, rand: [0.6, 0.85] },
      { key: 'maxSpeed', label: 'Max speed', type: 'range', min: 500, max: 3000, step: 50, def: 1600, rand: [1400, 1800] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 10, max: 26, step: 1, def: 17, rand: [15, 19] },
      { key: 'wall', label: 'Wall thickness', type: 'range', min: 4, max: 18, step: 1, def: 9, rand: [8, 11] },
      { key: 'size', label: 'Maze size', type: 'range', min: 380, max: 500, step: 5, def: 480, rand: [460, 490] },
      { key: 'ballColor', label: 'Ball colour (1 ball)', type: 'color', def: '' },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Classic Escape', s: {} },
      { name: 'Maze Race (3 balls)', s: { balls: 3 }, text: { hooks: { maze: 'Which ball gets *out first?*' } } },
      { name: 'Deep Maze (9 rings)', s: { rings: 9, ballSize: 13, wall: 7, wallHp: 5 } },
      { name: 'No Crumble (pure maze, longer)', s: { crumble: false, loops: 0.12, rings: 5 } },
      { name: 'Fast Spin Chaos', s: { spin: 1.6, reverseEvery: 3, bounce: 0.85, gravity: 1900 } },
    ],
    create: (g, s) => new Maze(g, s),
  });
})(window.SB);
