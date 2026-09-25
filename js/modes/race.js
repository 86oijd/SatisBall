/* Mode: Marble Race Knockout — balls race down a random course; each lap the last ball is eliminated. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, mix, rgba, lighten } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;

  const TOP = 600, BOT = 1750, XL = 70, XR = 1010;

  class Race extends SB.Mode {
    init() {
      const s = this.s, rng = this.rng;
      this.statics = []; // {type:'seg'|'peg'|'bump', ...}
      this.spinners = []; this.sliders = [];
      this.buildCourse();
      const n = s.balls;
      const cols = this.distinctColors(Math.min(n, 12), 12);
      this.balls = [];
      for (let i = 0; i < n; i++) {
        const ci = cols[i] ?? i;
        const b = new P.Ball(lerp(XL + 60, XR - 60, (i + 0.5) / n), TOP - 30 - (i % 2) * 30, s.ballSize, { color: this.color(ci), name: this.cname(ci) });
        b.vx = rng.range(-80, 80); b.vy = rng.range(0, 60);
        b.laps = 0; b.still = 0; b.maxY = -1e9; b.progT = 0; b.lastHit = -1; b.place = i; b.elimRound = 0; b.lapT = 0;
        this.balls.push(b);
      }
      this.round = 1; this.out = []; this.leader = null; this.leaderT = 0; this.gMul = 1; this.roundStart = 0;
      this.trailLen = 10;
    }
    buildCourse() {
      const rng = this.rng, s = this.s;
      const kinds = ['pegs', 'spinners', 'funnel', 'bumpers', 'sliders', 'zigzag', 'pegs', 'spinners'];
      rng.shuffle(kinds);
      const rows = [];
      let y = TOP + 40;
      // start with a peg row to scatter, end with a funnel to the finish
      const plan = ['pegs'].concat(kinds.filter((k, i) => i < s.rows)).slice(0, s.rows);
      if (plan[plan.length - 1] !== 'funnel') plan.push('funnel');
      const H = (BOT - 60 - y) / plan.length;
      plan.forEach((k, i) => { this.row(k, y + H * 0.5, H); y += H; });
    }
    seg(ax, ay, bx, by, o = {}) { this.statics.push({ t: 'seg', ax, ay, bx, by, ht: o.ht ?? 7, e: o.e ?? 0.55, color: o.color }); }
    row(kind, cy, H) {
      const rng = this.rng, pal = this.pal;
      switch (kind) {
        case 'pegs': {
          const rows = Math.max(2, Math.floor(H / 70));
          for (let r = 0; r < rows; r++) {
            const yy = cy - H * 0.35 + r * (H * 0.7 / Math.max(1, rows - 1));
            const off = r % 2 ? 45 : 0;
            for (let x = XL + 70 + off; x < XR - 50; x += 90) this.statics.push({ t: 'peg', x: x + rng.range(-6, 6), y: yy, r: 11, e: 0.6 });
          }
          break;
        }
        case 'spinners': {
          const n = rng.pick([2, 3]);
          for (let i = 0; i < n; i++) {
            const x = lerp(XL, XR, (i + 0.5) / n);
            this.spinners.push({ x, y: cy, L: Math.min(115, H * 0.42, (XR - XL) / n / 2 - 12), a: rng.range(0, TAU), w: rng.sign() * rng.range(1.8, 3.2), arms: rng.pick([2, 3, 4]) });
          }
          break;
        }
        case 'funnel': {
          const gap = 150, mid = rng.range(420, 660);
          this.seg(XL, cy - H * 0.45, mid - gap / 2, cy + H * 0.4, { ht: 9, e: 0.45 });
          this.seg(XR, cy - H * 0.45, mid + gap / 2, cy + H * 0.4, { ht: 9, e: 0.45 });
          break;
        }
        case 'bumpers': {
          const n = 3;
          for (let i = 0; i < n; i++) this.statics.push({ t: 'bump', x: lerp(XL + 90, XR - 90, i / (n - 1)) + rng.range(-40, 40), y: cy + (i % 2 ? -H * 0.18 : H * 0.18), r: 38, e: 1.25, flash: 0 });
          this.statics.push({ t: 'bump', x: (XL + XR) / 2 + rng.range(-60, 60), y: cy + H * 0.05, r: 28, e: 1.25, flash: 0 });
          break;
        }
        case 'sliders': {
          for (let i = 0; i < 2; i++) this.sliders.push({ y: cy + (i ? H * 0.2 : -H * 0.2), L: 240, x0: (XL + XR) / 2, amp: 260, w: rng.range(1.2, 2) * (i ? -1 : 1), ph: rng.range(0, TAU), tilt: (i ? -1 : 1) * 0.22 });
          break;
        }
        case 'zigzag': {
          // two ramps that overlap only a little so there is always room to drop through
          const flip = rng.chance(0.5);
          const L1 = [XL, cy - H * 0.45, XL + 390, cy - H * 0.45 + 150], L2 = [XR, cy - H * 0.1, XR - 390, cy - H * 0.1 + 150];
          const m = (a) => flip ? [XL + XR - a[0], a[1], XL + XR - a[2], a[3]] : a;
          this.seg(...m(L1), { ht: 7 }); this.seg(...m(L2), { ht: 7 });
          break;
        }
      }
    }
    trailBalls() { return this.balls; }
    roster() { return this.balls.map((b) => ({ name: b.name, color: b.color })); }
    alive() { return this.balls.filter((b) => b.alive); }
    progress(b) { return b.laps + clamp((b.y - TOP) / (BOT - TOP), 0, 1); }

    update(dt) {
      const s = this.s, g = this.g;
      const alive = this.alive();
      g.tension = clamp((this.balls.length - alive.length) / Math.max(1, this.balls.length - 1), 0, 1);
      // pace: adjust gravity so rounds last ~ target / eliminations
      const expRound = (g.targetLen * 0.88) / Math.max(1, s.balls - 1);
      if (s.assist && g.state === 'play') {
        const rt = g.time - this.roundStart;
        this.gMul = rt > expRound * 1.1 ? Math.min(1.9, this.gMul + dt * 0.12) : Math.max(0.9, this.gMul - dt * 0.03);
      }
      const grav = s.gravity * this.gMul;
      for (const sp of this.spinners) sp.a += sp.w * dt;
      for (const sl of this.sliders) { sl.ph += sl.w * dt; }
      const n = P.substeps(alive, dt, 0.4, 12);
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of alive) {
          this.integrate(b, h, grav);
          const sp = b.speed; if (sp > s.maxSpeed) b.setSpeed(s.maxSpeed);
          this.collideCourse(b, h);
          // walls
          if (b.x < XL + b.r) { b.x = XL + b.r; b.vx = Math.abs(b.vx) * 0.6; }
          if (b.x > XR - b.r) { b.x = XR - b.r; b.vx = -Math.abs(b.vx) * 0.6; }
          if (b.y > BOT + b.r) this.lap(b);
        }
        for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
          const imp = P.ballBall(alive[i], alive[j], 0.8);
          if (imp > 250) { this.note(0.4, alive[i].x); this.fx.burst((alive[i].x + alive[j].x) / 2, (alive[i].y + alive[j].y) / 2, '#ffffff', 5, 300, { grav: 0 }); }
        }
      }
      // unstick
      for (const b of alive) {
        if (b.speed < 30) b.still += dt; else b.still = 0;
        if (b.y > b.maxY + 25) { b.maxY = b.y; b.progT = g.time; }
        if (b.still > 0.7 || g.time - b.progT > 2.2) { b.still = 0; b.progT = g.time; b.vx = this.rng.sign() * this.rng.range(200, 380); b.vy = -this.rng.range(200, 400); }
        this.decayBall(b, dt);
      }
      for (const st of this.statics) if (st.flash) st.flash = Math.max(0, st.flash - dt * 4);
      this.checkRound();
      this.updateLeader();
    }
    collideCourse(b) {
      for (const st of this.statics) {
        let hit = false;
        if (st.t === 'peg' || st.t === 'bump') hit = P.circle(b, st.x, st.y, st.r);
        else hit = P.segment(b, st.ax, st.ay, st.bx, st.by, st.ht);
        if (!hit) continue;
        const imp = P.resolve(b, C.nx, C.ny, C.depth, st.e, 0, 0, 0.1);
        if (st.t === 'bump') {
          const vn = b.vx * C.nx + b.vy * C.ny;
          if (vn < 650) { b.vx += C.nx * (650 - vn); b.vy += C.ny * (650 - vn); }
          st.flash = 1;
          if (imp > 60) { this.snd.sfx('boing', 0.45, this.g.pan(b.x), 1 + this.rng.range(-0.1, 0.2)); this.note(0.6, b.x); this.fx.ring(st.x, st.y, b.color, st.r + 40, 0.3, 6); }
        } else if (imp > 160) this.ping(b, imp);
      }
      for (const sp of this.spinners) {
        for (let a = 0; a < sp.arms; a++) {
          const ang = sp.a + (a / sp.arms) * Math.PI;
          const cx = Math.cos(ang) * sp.L, cy = Math.sin(ang) * sp.L;
          if (P.segment(b, sp.x - cx, sp.y - cy, sp.x + cx, sp.y + cy, 8)) {
            const [wx, wy] = P.rotVel(C.px, C.py, sp.x, sp.y, sp.w);
            const imp = P.resolve(b, C.nx, C.ny, C.depth, 0.6, wx, wy);
            if (imp > 160) this.ping(b, imp);
          }
        }
        if (P.circle(b, sp.x, sp.y, 14)) P.resolve(b, C.nx, C.ny, C.depth, 0.6);
      }
      for (const sl of this.sliders) {
        const x = sl.x0 + Math.sin(sl.ph) * sl.amp, vx = Math.cos(sl.ph) * sl.amp * sl.w;
        const dx = Math.cos(sl.tilt) * sl.L / 2, dy = Math.sin(sl.tilt) * sl.L / 2;
        if (P.segment(b, x - dx, sl.y - dy, x + dx, sl.y + dy, 9)) {
          const imp = P.resolve(b, C.nx, C.ny, C.depth, 0.5, vx, 0, 0.15);
          if (imp > 160) this.ping(b, imp);
        }
      }
    }
    ping(b, imp) {
      if (this.g.clock - b.lastHit < 0.06) return;
      b.lastHit = this.g.clock;
      this.note(this.velFromImpact(imp, 1100) * 0.8, b.x);
      this.contactFx(b, C.px, C.py, C.nx, C.ny, imp * 0.5);
    }
    lap(b) {
      b.laps++;
      b.x = this.rng.range(XL + 140, XR - 140); b.y = TOP - 60; b.vy = 120; b.vx = this.rng.range(-120, 120);
      b.trail.length = 0; b.maxY = b.y; b.progT = this.g.time;
      this.fx.ring(b.x, TOP - 40, b.color, 120, 0.4, 6);
      if (b.laps >= this.round) {
        const done = this.alive().filter((q) => q.laps >= this.round).length;
        if (done === 1) { this.fx.popup(540, BOT - 20, `${b.name} LEADS LAP ${this.round}`, b.color, 34); }
      }
      this.snd.sfx('tick', 0.5, this.g.pan(b.x), 1.3);
    }
    checkRound() {
      const g = this.g;
      if (g.state !== 'play') return;
      const alive = this.alive();
      if (alive.length <= 1) return;
      const pending = alive.filter((b) => b.laps < this.round);
      // photo finish: the last two are both about to cross — slow it right down
      if (pending.length === 2 && this.photoRound !== this.round && pending.every((b) => b.y > BOT - 240)) {
        this.photoRound = this.round;
        g.moment({ x: (pending[0].x + pending[1].x) / 2, y: BOT - 90, zoom: 1.18, slow: 0.3, dur: 0.7 });
        this.fx.banner('PHOTO FINISH!', '#ffffff', { size: 58, y: 0.62, dur: 1 });
        this.snd.sfx('riser', 0.4, 0, 1.6);
      }
      if (pending.length === 1) this.eliminate(pending[0]);
      else if (this.s.timer && g.time - this.roundStart > this.roundLimit()) {
        // time's up: the ball furthest behind goes
        pending.sort((a, b) => this.progress(a) - this.progress(b));
        this.timeouts = (this.timeouts || 0) + 1;
        this.fx.banner("TIME'S UP!", '#ff3d5a', { size: 60, y: 0.62, dur: 0.9 });
        this.eliminate(pending[0]);
      }
    }
    roundLimit() { return Math.max(4, (this.g.targetLen * 0.9) / Math.max(1, this.s.balls - 1) * 1.6); }
    eliminate(b) {
      const g = this.g;
      b.alive = false; b.elimRound = this.round;
      this.out.push(b);
      this.fx.burst(b.x, b.y, b.color, 60, 1100, { colors: [b.color, '#ffffff'] });
      this.fx.shockwave(b.x, b.y, b.color, 300);
      this.fx.flare(b.x, b.y, b.color, 700);
      this.snd.sfx('elim', 0.95, g.pan(b.x));
      g.shake(0.35); this.fx.flash(b.color, 0.18);
      this.round++; this.roundStart = g.time;
      const left = this.alive();
      if (left.length === 1) {
        const w = left[0];
        g.win({ title: `${w.name} WINS!`, sub: `last ball standing · ${SB.util.fmtTime(g.time)}`, color: w.color, y: 1000, fx: w.x, fy: w.y });
      } else if (this.photoRound !== this.round - 1) this.g.moment({ x: b.x, y: b.y, zoom: 1.1, dur: 0.4 });
      if (left.length > 1) this.fx.banner(`${b.name} OUT!`, b.color, { size: 66, y: 0.5, sub: `${left.length} left`, dur: 1.2 });
    }
    updateLeader() {
      const alive = this.alive();
      alive.sort((a, b) => this.progress(b) - this.progress(a));
      alive.forEach((b, i) => (b.place = i));
      const L = alive[0];
      if (L && L !== this.leader) {
        if (this.leader && this.g.time - this.leaderT > 2.5 && this.g.state === 'play' && alive.length > 2) {
          this.fx.popup(L.x, L.y - 50, 'NEW LEADER', L.color, 34);
          this.snd.sfx('whoosh', 0.3, this.g.pan(L.x));
          this.leaderT = this.g.time;
        }
        this.leader = L;
      }
    }
    audit() { const v = []; for (const b of this.alive()) { if (b.x < XL - 1 || b.x > XR + 1) v.push('ball through side wall'); if (b.y < TOP - 400) v.push('ball flew out top'); } return v; }
    forceEnd() { const a = this.alive().sort((x, y) => this.progress(x) - this.progress(y)); if (a.length > 1) this.eliminate(a[0]); }

    render(ctx) {
      const pal = this.pal, light = pal.light;
      const line = light ? '#2a1a40' : '#ffffff';
      // lane
      ctx.fillStyle = light ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.22)';
      draw.roundRect(ctx, XL - 10, TOP - 80, XR - XL + 20, BOT - TOP + 110, 30); ctx.fill();
      ctx.lineWidth = 8; ctx.strokeStyle = rgba(line, 0.25); ctx.stroke();
      // start portal & finish line
      const t = this.g.clock;
      ctx.lineCap = 'round';
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 6; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 4);
      ctx.beginPath(); ctx.moveTo(XL + 30, TOP - 60); ctx.lineTo(XR - 30, TOP - 60); ctx.stroke(); ctx.globalAlpha = 1;
      const sq = 24;
      for (let x = XL, i = 0; x < XR; x += sq, i++) for (let r = 0; r < 2; r++) { ctx.fillStyle = (i + r) % 2 ? '#ffffff' : '#111111'; ctx.fillRect(x, BOT + 4 + r * sq / 2, sq, sq / 2); }
      // statics
      for (const st of this.statics) {
        if (st.t === 'peg') {
          if (!light) draw.glow(ctx, st.x, st.y, 60, pal.accent, 0.35);
          ctx.fillStyle = lighten(pal.accent, 0.4); ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, TAU); ctx.fill();
        } else if (st.t === 'bump') {
          const f = st.flash || 0;
          ctx.fillStyle = rgba(pal.grad[2], 0.2 + f * 0.5); ctx.beginPath(); ctx.arc(st.x, st.y, st.r + f * 8, 0, TAU); ctx.fill();
          ctx.lineWidth = 7; ctx.strokeStyle = mix(pal.grad[2], '#ffffff', f); ctx.stroke();
        } else {
          ctx.lineWidth = st.ht * 2; ctx.strokeStyle = mix(line, pal.grad[4], 0.35);
          ctx.beginPath(); ctx.moveTo(st.ax, st.ay); ctx.lineTo(st.bx, st.by); ctx.stroke();
        }
      }
      for (const sp of this.spinners) {
        ctx.lineWidth = 16; ctx.strokeStyle = pal.grad[1];
        for (let a = 0; a < sp.arms; a++) {
          const ang = sp.a + (a / sp.arms) * Math.PI, cx = Math.cos(ang) * sp.L, cy = Math.sin(ang) * sp.L;
          ctx.beginPath(); ctx.moveTo(sp.x - cx, sp.y - cy); ctx.lineTo(sp.x + cx, sp.y + cy); ctx.stroke();
        }
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 12, 0, TAU); ctx.fill();
      }
      for (const sl of this.sliders) {
        const x = sl.x0 + Math.sin(sl.ph) * sl.amp, dx = Math.cos(sl.tilt) * sl.L / 2, dy = Math.sin(sl.tilt) * sl.L / 2;
        ctx.lineWidth = 18; ctx.strokeStyle = pal.grad[5] || pal.accent;
        ctx.beginPath(); ctx.moveTo(x - dx, sl.y - dy); ctx.lineTo(x + dx, sl.y + dy); ctx.stroke();
      }
      this.drawTrails(ctx, this.balls, 1.3, 0.45);
      this.drawBalls(ctx, this.balls);
      if (this.s.tags) for (const b of this.balls) if (b.alive) this.tag(ctx, b, b.name, { size: 20, gap: 8, color: '#ffffff' });
      // crown on leader
      if (this.leader && this.leader.alive) draw.crown(ctx, this.leader.x, this.leader.y - this.leader.r - (this.s.tags ? 44 : 16), 0.32);
    }
    hud(ctx) {
      const pal = this.pal, W = this.W;
      const list = this.alive().sort((a, b) => a.place - b.place).concat(this.out.slice().reverse());
      const cols = list.length > 6 ? 2 : 1;
      const perCol = Math.ceil(list.length / cols);
      const rowH = list.length > 8 ? 30 : 36, colW = cols === 2 ? 440 : 560;
      const x0 = W / 2 - (colW * cols + (cols - 1) * 20) / 2, y0 = 330;
      draw.panel(ctx, x0 - 16, y0 - 14, colW * cols + (cols - 1) * 20 + 32, perCol * rowH + 50, 22, this.look, 0.55);
      draw.font(ctx, 20, 700, 'Space Grotesk'); ctx.fillStyle = 'rgba(255,255,255,0.65)'; if (pal.light) ctx.fillStyle = rgba(pal.text, 0.6);
      ctx.fillText(`ROUND ${Math.min(this.round, this.balls.length - 1)} · LAST BALL EACH LAP IS OUT`, x0, y0 + 10);
      if (this.s.timer && this.g.state === 'play') {
        const left = Math.max(0, this.roundLimit() - (this.g.time - this.roundStart));
        ctx.textAlign = 'right'; draw.font(ctx, 22, 900);
        ctx.fillStyle = left < 2 ? '#ff3d5a' : (pal.light ? pal.text : '#ffffff');
        ctx.fillText(left.toFixed(1) + 's', x0 + colW * cols + (cols - 1) * 20, y0 + 10); ctx.textAlign = 'left';
      }
      list.forEach((b, i) => {
        const c = Math.floor(i / perCol), r = i % perCol;
        const x = x0 + c * (colW + 20), y = y0 + 40 + r * rowH;
        ctx.globalAlpha = b.alive ? 1 : 0.4;
        ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x + 12, y + rowH / 2 - 6, 10, 0, TAU); ctx.fill();
        draw.font(ctx, rowH * 0.62, 900);
        ctx.fillStyle = pal.light ? pal.text : '#ffffff';
        ctx.fillText(b.alive ? `${b.place + 1}` : '✕', x + 32, y + rowH / 2 + 2);
        ctx.fillStyle = b.color; ctx.fillText(b.name, x + 74, y + rowH / 2 + 2);
        draw.font(ctx, rowH * 0.55, 700, 'Space Grotesk');
        ctx.fillStyle = pal.light ? rgba(pal.text, 0.7) : 'rgba(255,255,255,0.7)'; ctx.textAlign = 'right';
        ctx.fillText(b.alive ? `LAP ${b.laps + 1}` : 'OUT', x + colW - 10, y + rowH / 2 + 1);
        ctx.textAlign = 'left';
        if (!b.alive) { ctx.strokeStyle = b.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 70, y + rowH / 2 - 7); ctx.lineTo(x + 74 + ctx.measureText(b.name).width + 60, y + rowH / 2 - 7); ctx.stroke(); }
        ctx.globalAlpha = 1;
      });
    }
    stats() { return { timeouts: this.timeouts || 0, lapT: this.balls.map(b=>b.laps), round: this.round, alive: this.alive().length, gMul: +this.gMul.toFixed(2), pos: this.alive().map((b) => [Math.round(b.x), Math.round(b.y), b.laps, Math.round(b.speed)]), statics: this.statics.filter(q=>q.t==='seg').map(q=>[q.ax,q.ay,q.bx,q.by].map(Math.round)) }; }
  }

  SB.modes.register({
    id: 'race', name: 'Marble Race Knockout', icon: '⚑', category: 'Survival', tagline: 'Last ball each lap is eliminated',
    hook: 'Last place is *OUT*',
    hookY: 170,
    settings: [
      { key: 'balls', label: 'Racers', type: 'range', min: 3, max: 12, step: 1, def: 8, rand: [6, 10] },
      { key: 'rows', label: 'Obstacle rows', type: 'range', min: 3, max: 7, step: 1, def: 4, rand: [3, 5] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 500, max: 3500, step: 50, def: 2100, rand: [1800, 2500] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 12, max: 32, step: 1, def: 20, rand: [17, 24] },
      { key: 'maxSpeed', label: 'Max speed', type: 'range', min: 600, max: 3000, step: 50, def: 1900 },
      { key: 'tags', label: 'Name tags', type: 'toggle', def: true },
      { key: 'timer', label: 'Round timer (slowest out when it hits 0)', type: 'toggle', def: true, rand: false },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: '8 Racers', s: {} },
      { name: '12 Racer Mayhem', s: { balls: 12, ballSize: 17, rows: 6 } },
      { name: 'Final Four', s: { balls: 4, ballSize: 26, rows: 6 } },
    ],
    create: (g, s) => new Race(g, s),
  });
})(window.SB);
