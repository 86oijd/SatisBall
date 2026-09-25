/* Mode: Last One In — numbered balls bounce inside a spinning ring with gaps. Escape = out.
 * The last ball still inside wins (or: the first one out wins). Built for "comment your number". */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, gradientAt, rgba, lighten, normAngle, angleDiff } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;

  class LastIn extends SB.Mode {
    init() {
      const s = this.s, n = s.balls;
      this.cx = 540; this.cy = 1160; this.R0 = s.ringSize; this.R = this.R0;
      this.rot = this.rng.range(0, TAU); this.w = s.spin;
      this.gapK = 1; this.th = 9;
      const r = clamp(this.R0 * Math.sqrt(s.fill / n), 18, 62) * s.ballScale;
      this.balls = [];
      const pool = this.rng.shuffle([...Array(n).keys()]);
      for (let i = 0; i < n; i++) {
        // spawn on a jittered spiral so nobody overlaps
        const k = pool[i], a = k * 2.39996, rr = Math.sqrt((k + 0.5) / n) * (this.R0 - r * 1.6);
        const b = new P.Ball(this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr, r, { color: this.color(i), name: String(i + 1) });
        const va = this.rng.range(0, TAU); b.vx = Math.cos(va) * s.speed; b.vy = Math.sin(va) * s.speed;
        b.num = i + 1; b.inside = true; b.outT = 0; b.lastHit = -1; b.place = 0;
        if (s.gravity > 0) P.setEnergy(b, s.gravity);
        this.balls.push(b);
      }
      this.out = []; this.lastOut = 0; this.ringFlash = 0; this.waves = [];
      this.finalTwo = false; this.nearT = -9; this.trailLen = 10;
      this.grid = new P.Grid(this.cx - this.R0 - 80, this.cy - this.R0 - 80, this.R0 * 2 + 160, this.R0 * 2 + 160, Math.max(40, r * 2.2));
    }
    roster() { return this.balls.length <= 8 ? this.balls.map((b) => ({ name: '#' + b.num, color: b.color })) : null; }
    trailBalls() { return this.balls; }
    get inside() { return this.balls.filter((b) => b.inside); }
    gapSize() { return clamp(this.s.gap * Math.PI / 180 * this.gapK, 0.05, TAU / this.s.gaps * 0.7); }
    arcs() {
      const n = this.s.gaps, gap = this.gapSize(), out = [];
      for (let i = 0; i < n; i++) out.push([this.rot + (i / n) * TAU + gap / 2, TAU / n - gap]);
      return out;
    }
    update(dt) {
      const s = this.s, g = this.g, N = this.balls.length;
      const inside = this.inside, left = inside.length;
      const prog = 1 - (left - 1) / (N - 1);
      g.tension = s.rule === 'first' ? clamp(g.time / g.targetLen, 0, 1) : prog;
      // pacing: escapes should track a schedule that ends near the target length
      if (g.state === 'play') {
        if (s.rule === 'first') {
          // gap stays too small to pass, then opens up as the target approaches
          const open = clamp((g.time - g.targetLen * 0.45) / (g.targetLen * 0.45), 0, 1);
          const need = (this.balls[0].r * 2.3) / this.R;
          this.gapK = lerp(need * 0.55, need * 1.9, open) / (s.gap * Math.PI / 180);
        } else if (s.assist) {
          const T = g.targetLen * 0.88, exp = (N - 1) * Math.pow(clamp(g.time / T, 0, 1), 1.05);
          const done = N - left, diff = exp - done;
          if (diff > 0.6) this.gapK = Math.min(3.2, this.gapK * (1 + dt * 0.55 * Math.min(2, diff)));
          else if (diff < -0.6) this.gapK = Math.max(0.35, this.gapK * (1 - dt * 0.45));
          if (left === 2) this.gapK = Math.min(3.2, this.gapK * (1 + dt * 0.08)); // the final escape can't take forever
        }
      }
      const spinK = 1 + s.ramp * prog;
      this.w = s.spin * spinK * (s.reverse && Math.floor(g.time / 6) % 2 ? -1 : 1);
      this.rot += this.w * dt;
      // the ring contracts as balls escape (keeps the crowd tight)
      const Rt = s.shrink ? this.R0 * (0.62 + 0.38 * Math.sqrt(left / N)) : this.R0;
      const nR = lerp(this.R, Rt, 1 - Math.exp(-dt * 2));
      this.vr = (nR - this.R) / dt; this.R = nR;
      this.ringFlash = Math.max(0, this.ringFlash - dt * 3);
      const arcs = this.arcs();
      const bodies = inside;
      const n = P.substeps(bodies, dt, 0.4, 16), h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of bodies) {
          if (!b.inside) continue;
          this.integrate(b, h, s.gravity);
          const closed = g.state !== 'play';
          let hit = false;
          if (closed) { if (P.insideCircle(b, this.cx, this.cy, this.R - this.th)) { this.bounce(b, this.resolveRing(b), true); hit = true; } }
          else for (const [a0, span] of arcs) if (P.arc(b, this.cx, this.cy, this.R, this.th, a0, span, -1)) { this.bounce(b, this.resolveRing(b)); hit = true; }
          if (!hit && !closed) {
            const d = Math.hypot(b.x - this.cx, b.y - this.cy);
            if (d > this.R + this.th + b.r * 0.4) this.escape(b);
          }
        }
        this.grid.build(bodies);
        this.grid.pairs(bodies, (a, b) => { if (a.inside && b.inside) { const imp = P.ballBall(a, b, 1); if (imp > 140 && this.rng.chance(0.25)) this.note(this.velFromImpact(imp) * 0.45, a.x); } });
        // ball-ball pushes must never shove anyone through the ring
        for (const b of bodies) {
          if (!b.inside) continue;
          if (g.state !== 'play') { if (P.insideCircle(b, this.cx, this.cy, this.R - this.th)) this.resolveRing(b); }
          else {
            let hit = false;
            for (const [a0, span] of arcs) if (P.arc(b, this.cx, this.cy, this.R, this.th, a0, span, -1)) { this.resolveRing(b); hit = true; }
            if (!hit && g.state === 'play' && Math.hypot(b.x - this.cx, b.y - this.cy) > this.R + this.th + b.r * 0.4) this.escape(b);
          }
        }
        for (const b of bodies) {
          if (!b.inside) continue;
          if (s.gravity > 0) P.lockEnergy(b, s.gravity); else b.setSpeed(s.speed);
        }
      }
      // escaped balls fly off and pop
      for (const b of this.balls) {
        this.decayBall(b, dt);
        if (b.inside || !b.alive) continue;
        b.outT += dt; b.vy += 1600 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.outT > 0.55) { b.alive = false; this.fx.burst(b.x, b.y, b.color, 26, 700, { colors: [b.color, '#ffffff'] }); this.fx.ring(b.x, b.y, b.color, 90, 0.35, 5); this.snd.sfx('pop', 0.55, g.pan(b.x), 1.15); }
      }
      for (const w of this.waves) w.t += dt;
      this.waves = this.waves.filter((w) => w.t < 1);
      // suspense: one of the final two heads for a gap
      if (g.state === 'play' && left === 2 && s.rule !== 'first' && g.time - this.nearT > 2.2) {
        for (const b of inside) {
          const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy), vout = (b.vx * dx + b.vy * dy) / (d || 1);
          const ang = Math.atan2(dy, dx);
          const inGap = arcs.every(([a0, span]) => normAngle(ang - a0) > span + 0.1);
          if (vout > 0 && d > this.R - b.r * 3 && inGap) { this.nearT = g.time; g.moment({ x: b.x, y: b.y, zoom: 1.12, slow: 0.35, dur: 0.5 }); break; }
        }
      }
    }
    resolveRing(b) {
      const [wx, wy] = P.rotVel(C.px, C.py, this.cx, this.cy, this.w);
      const rx = (C.px - this.cx) / this.R, ry = (C.py - this.cy) / this.R;
      return P.resolve(b, C.nx, C.ny, C.depth, 1, wx + rx * this.vr, wy + ry * this.vr);
    }
    bounce(b, imp, quiet) {
      if (imp < 40) return;
      const j = this.rng.range(-0.05, 0.05), c = Math.cos(j), sn = Math.sin(j);
      const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
      if (this.g.clock - b.lastHit > 0.06) {
        b.lastHit = this.g.clock;
        this.ringFlash = Math.min(1, this.ringFlash + 0.35);
        if (!quiet || imp > 200) this.note(this.velFromImpact(imp) * (this.inside.length > 12 ? 0.6 : 0.85), b.x);
        this.contactFx(b, C.px, C.py, C.nx, C.ny, imp);
        if (this.waves.length < 5 && imp > 300) this.waves.push({ t: 0 });
      }
    }
    escape(b) {
      const g = this.g, s = this.s;
      b.inside = false; b.outT = 0;
      const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy) || 1;
      const sp = Math.max(700, b.speed); b.vx = dx / d * sp * 0.9; b.vy = dy / d * sp * 0.9 - 200;
      this.out.push(b); b.place = this.balls.length - this.out.length + 1;
      this.lastOut = g.time;
      const left = this.inside;
      this.fx.burst(b.x, b.y, b.color, 30, 900, { dir: Math.atan2(dy, dx), spread: 0.8, colors: [b.color, '#ffffff'] });
      this.fx.flare(b.x, b.y, b.color, 500);
      this.snd.sfx('whoosh', 0.5, g.pan(b.x), 1.3); this.snd.sfx('coin', 0.45, g.pan(b.x), 1 + this.out.length * 0.02);
      this.note(0.9, b.x);
      g.shake(0.18);
      if (s.rule === 'first') {
        g.win({ title: `#${b.num} ESCAPED FIRST!`, sub: `out of ${this.balls.length} balls · did you pick it?`, color: b.color, y: 760, fx: b.x, fy: b.y });
        return;
      }
      // stack popups when several balls fly out together
      this.popK = g.time - (this.popT ?? -9) < 0.6 ? (this.popK || 0) + 1 : 0; this.popT = g.time;
      this.fx.popup(clamp(b.x, 120, 960), clamp(b.y - b.r - 20, 520, 1800) - this.popK * 58, `#${b.num} OUT`, b.color, left.length <= 5 ? 64 : 46);
      if (left.length === 1) {
        const w = left[0];
        g.win({ title: `#${w.num} IS THE LAST ONE IN!`, sub: `outlasted ${this.balls.length - 1} balls · comment if you picked it`, color: w.color, y: 760, fx: w.x, fy: w.y });
        return;
      }
      if (left.length === 2 && !this.finalTwo) {
        this.finalTwo = true;
        this.fx.banner('FINAL TWO', this.pal.accent, { size: 84, y: 0.36, sub: `#${left[0].num} vs #${left[1].num}` });
        this.snd.sfx('riser', 0.6); g.moment({ zoom: 1.06, dur: 0.9, slow: 0.5 });
      } else if (left.length <= 5) {
        this.fx.banner(`${left.length} LEFT`, '#ffffff', { size: 66, y: 0.36, dur: 0.9 });
        g.moment({ x: b.x, y: b.y, zoom: 1.08, slow: 0.55, dur: 0.4 });
      }
    }
    forceEnd() { this.gapK = 4; }
    audit() {
      const v = [];
      const arcs = this.g.state === 'play' ? this.arcs() : [[0, TAU]];
      for (const b of this.balls) {
        if (!b.inside || Math.hypot(b.x - this.cx, b.y - this.cy) < this.R + this.th + b.r * 0.6) continue;
        // only a real violation when the ball is outside the wall itself (not squeezing past a gap edge)
        const ang = Math.atan2(b.y - this.cy, b.x - this.cx), pad = (b.r * 1.3) / this.R;
        if (arcs.some(([a0, span]) => { const rel = normAngle(ang - a0 - pad); return rel <= span - 2 * pad; })) v.push('ball through ring wall');
      }
      return v;
    }
    render(ctx) {
      const pal = this.pal, g = this.g, s = this.s, cx = this.cx, cy = this.cy, R = this.R;
      // floor disc + waves
      ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      for (const w of this.waves) { ctx.globalAlpha = (1 - w.t) * 0.3; ctx.strokeStyle = pal.accent; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, R * (1 + w.t * 0.25), 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // ring arcs
      const closed = g.state !== 'play';
      const arcs = closed ? [[0, TAU]] : this.arcs();
      ctx.lineCap = 'round';
      arcs.forEach(([a0, span], i) => {
        const col = gradientAt(pal.grad, s.gaps > 1 ? i / (s.gaps - 1) * 0.8 : 0.3);
        if (!this.look.light) { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba(col, 0.25 + this.ringFlash * 0.25); ctx.lineWidth = this.th * 2 + 22; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; }
        ctx.strokeStyle = SB.util.mix(col, '#ffffff', this.ringFlash * 0.45); ctx.lineWidth = this.th * 2;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span); ctx.stroke();
      });
      // gap markers (little arrows pointing out)
      if (!closed) for (const [a0, span] of arcs) {
        const a = a0 + span + this.gapSize() / 2, x = cx + Math.cos(a) * (R + 34), y = cy + Math.sin(a) * (R + 34);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.globalAlpha = 0.55 + 0.3 * Math.sin(g.clock * 6);
        ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      this.drawTrails(ctx, this.balls.filter((b) => b.alive), 1.1, 0.35);
      for (const b of this.balls) {
        if (!b.alive) continue;
        const sc = b.inside ? 1 : Math.max(0.2, 1 - b.outT * 1.2);
        const r0 = b.r; b.r = r0 * sc;
        draw.ball(ctx, b, this.look);
        b.r = r0;
        const fs = Math.round(b.r * sc * (b.num >= 10 ? 0.78 : 0.95));
        draw.label(ctx, String(b.num), b.x, b.y + fs * 0.36, fs, '#ffffff', 900, 0.2);
      }
      // winner halo
      if (closed && this.g.winInfo) { const w = this.inside[0]; if (w) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(w.x, w.y, w.r + 12 + Math.sin(g.clock * 6) * 4, 0, TAU); ctx.stroke(); } }
    }
    hud(ctx) {
      const pal = this.pal, W = this.W, N = this.balls.length;
      const cols = Math.min(N, N > 30 ? 12 : 10), rows = Math.ceil(N / cols);
      const cs = Math.min(76, Math.floor((W - 80) / cols) - 8, Math.floor(250 / rows) - 8), gap = 8;
      const x0 = W / 2 - (cols * cs + (cols - 1) * gap) / 2, y0 = 350;
      for (let i = 0; i < N; i++) {
        const b = this.balls[i], x = x0 + (i % cols) * (cs + gap), y = y0 + Math.floor(i / cols) * (cs + gap);
        const outK = b.inside ? 0 : clamp(b.outT * 3 + (b.alive ? 0 : 1), 0, 1);
        ctx.globalAlpha = 1 - outK * 0.65;
        draw.roundRect(ctx, x, y, cs, cs, cs * 0.28); ctx.fillStyle = b.color; ctx.fill();
        draw.label(ctx, String(b.num), x + cs / 2, y + cs * 0.66, Math.round(cs * 0.46), '#ffffff', 900, 0.2);
        if (!b.inside) { ctx.strokeStyle = '#ff3d5a'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + cs - 10, y + cs - 10); ctx.moveTo(x + cs - 10, y + 10); ctx.lineTo(x + 10, y + cs - 10); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      const left = this.inside.length, y = y0 + rows * (cs + gap) + 42;
      draw.font(ctx, 34, 900); ctx.textAlign = 'center'; ctx.fillStyle = pal.light ? pal.text : '#ffffff';
      ctx.fillText(this.s.rule === 'first' ? 'FIRST ONE OUT WINS' : `${left} STILL INSIDE`, W / 2, y);
      ctx.textAlign = 'left';
    }
    stats() { return { inside: this.inside.map((b) => b.num), out: this.out.map((b) => b.num) }; }
  }

  SB.modes.register({
    id: 'lastin', name: 'Last One In', icon: '◌', category: 'Viewer pick', tagline: 'Numbered balls, a spinning ring with gaps — comment your number',
    hook: 'Pick a number. Is it the *last one in?*',
    hookY: 170,
    settings: [
      { key: 'rule', label: 'Winner', type: 'select', def: 'last', options: [['last', 'Last ball inside wins'], ['first', 'First ball out wins']], rand: ['last', 'last', 'last', 'first'] },
      { key: 'balls', label: 'Balls', type: 'range', min: 4, max: 48, step: 1, def: 20, rand: [10, 30] },
      { key: 'gaps', label: 'Gaps in the ring', type: 'range', min: 1, max: 4, step: 1, def: 1, rand: [1, 3] },
      { key: 'gap', label: 'Gap size (°)', type: 'range', min: 8, max: 60, step: 1, def: 16, rand: [12, 22] },
      { key: 'spin', label: 'Ring spin', type: 'range', min: -3, max: 3, step: 0.05, def: 0.9, rand: [-1.4, 1.4] },
      { key: 'ramp', label: 'Spin-up as balls escape', type: 'range', min: 0, max: 3, step: 0.1, def: 1, rand: [0.5, 1.8] },
      { key: 'reverse', label: 'Reverse spin every 6s', type: 'toggle', def: false, rand: [true, false, false] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2000, step: 50, def: 900, rand: [0, 0, 700, 900, 1200] },
      { key: 'speed', label: 'Ball speed', type: 'range', min: 200, max: 1400, step: 10, def: 620, rand: [480, 800] },
      { key: 'fill', label: 'Crowding', type: 'range', min: 0.06, max: 0.3, step: 0.01, def: 0.16, rand: [0.12, 0.2] },
      { key: 'ballScale', label: 'Ball size', type: 'range', min: 0.6, max: 1.4, step: 0.05, def: 1, rand: [0.9, 1.1] },
      { key: 'ringSize', label: 'Ring size', type: 'range', min: 300, max: 500, step: 5, def: 440, rand: [410, 470] },
      { key: 'shrink', label: 'Ring shrinks as balls escape', type: 'toggle', def: true, rand: [true, true, false] },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Comment Your Number (20)', s: { balls: 20 } },
      { name: '10 Balls, 1 Gap', s: { balls: 10, gap: 18, fill: 0.14 } },
      { name: '40 Ball Chaos', s: { balls: 40, gaps: 2, gap: 12, fill: 0.2, spin: 1.2 } },
      { name: 'Zero Gravity Swirl', s: { balls: 24, gravity: 0, speed: 700, gaps: 2 }, look: { bg: 'stars' } },
      { name: 'Triple Gap Reverse', s: { balls: 30, gaps: 3, gap: 10, reverse: true } },
      { name: 'First One Out', s: { rule: 'first', balls: 16, gap: 20 }, text: { hooks: { lastin: 'Which number *escapes first?*' } } },
    ],
    create: (g, s) => new LastIn(g, s),
  });
})(window.SB);
