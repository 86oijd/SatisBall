/* Mode: Paint Splat — colour balls bounce around painting the floor. Bounces and crashes splat,
 * paint bombs and big brushes flip the lead. When the timer ends, the colour covering the most floor wins. */
'use strict';
(function (SB) {
  const { TAU, clamp, rgba, lighten, darken, mix, easeOutBack } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;
  const CELL = 10;

  // tiny deterministic hash for render-side decoration (never touches the sim RNG)
  const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; };

  class Paint extends SB.Mode {
    init() {
      const s = this.s, g = this.g;
      this.cy = 1160;
      this.arena = new SB.Arena({ cx: 540, cy: this.cy, R: s.arenaSize, shape: s.shape, spin: 0 });
      // coverage grid over the arena's bounding box
      const R = s.arenaSize + 10;
      this.gx = 540 - R; this.gy = this.cy - R; this.gw = Math.ceil(2 * R / CELL); this.gh = this.gw;
      this.own = new Int8Array(this.gw * this.gh).fill(-1);
      this.inside = new Uint8Array(this.gw * this.gh);
      let tot = 0;
      for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) { const x = this.gx + (i + 0.5) * CELL, y = this.gy + (j + 0.5) * CELL; if (this.arena.contains(x, y, 2)) { this.inside[j * this.gw + i] = 1; tot++; } }
      this.total = tot;
      const n = s.colors, cols = this.distinctColors(n, 10);
      this.teams = [];
      this.balls = [];
      for (let t = 0; t < n; t++) {
        const color = this.color(cols[t]);
        this.teams.push({ t, color, name: this.cname(cols[t]), count: 0, shown: 0 });
        for (let k = 0; k < s.perColor; k++) {
          const [x, y] = this.arena.randomPoint(this.rng, 80);
          const b = new P.Ball(x, y, s.ballSize, { color, name: this.cname(cols[t]) });
          const a = this.rng.range(0, TAU); b.vx = Math.cos(a) * s.speed; b.vy = Math.sin(a) * s.speed;
          b.team = t; b.brush = 1; b.brushT = 0; b.lx = x; b.ly = y; b.lastHit = -1; b.curve = this.rng.range(0.4, 1) * (this.rng.chance(0.5) ? 1 : -1) * s.curve;
          this.balls.push(b);
        }
      }
      this.events = []; this.evN = 0;
      this.pickups = []; this.pickT = 3; this.lead = -1; this.leadChanges = 0; this.countdown = 99;
      this.trailLen = 6;
      for (const b of this.balls) this.stamp(b.x, b.y, s.brush * 1.6, b.team, 'splat');
      g.targetLen = clamp(g.targetLen, 12, 120);
    }
    roster() { return this.teams.map((t) => ({ name: t.name, color: t.color })); }
    trailBalls() { return this.balls; }
    /** Paint a disc into the grid (the sim truth) and queue it for the paint canvas. */
    stamp(x, y, r, team, kind) {
      const { gx, gy, gw, gh, own, inside } = this, tm = this.teams;
      const i0 = Math.max(0, Math.floor((x - r - gx) / CELL)), i1 = Math.min(gw - 1, Math.floor((x + r - gx) / CELL));
      const j0 = Math.max(0, Math.floor((y - r - gy) / CELL)), j1 = Math.min(gh - 1, Math.floor((y + r - gy) / CELL));
      const r2 = r * r;
      for (let j = j0; j <= j1; j++) {
        const cy = gy + (j + 0.5) * CELL - y;
        for (let i = i0; i <= i1; i++) {
          const k = j * gw + i;
          if (!inside[k]) continue;
          const cx = gx + (i + 0.5) * CELL - x;
          if (cx * cx + cy * cy > r2) continue;
          const o = own[k];
          if (o === team) continue;
          if (o >= 0) tm[o].count--;
          own[k] = team; tm[team].count++;
        }
      }
      if (this.events.length < 60000) this.events.push({ x, y, r, team, kind, n: this.evN++ });
      else this.overflow = true; // nobody has been drawing (headless sim): the canvas gets rebuilt from the grid
    }
    splat(x, y, r, team, big) {
      this.stamp(x, y, r, team, big ? 'big' : 'splat');
      // droplets: part of the sim (they paint), so they use the sim RNG
      const n = big ? 12 : 4;
      for (let i = 0; i < n; i++) { const a = this.rng.range(0, TAU), d = r * this.rng.range(0.9, big ? 1.9 : 1.5); this.stamp(x + Math.cos(a) * d, y + Math.sin(a) * d, r * this.rng.range(0.12, big ? 0.32 : 0.26), team, 'drop'); }
    }
    frac(t) { return t.count / this.total; }
    ranking() { return this.teams.slice().sort((a, b) => b.count - a.count); }
    spawnPickup() {
      const s = this.s, g = this.g;
      // pace/drama assist: bombs tend to appear near whoever is losing
      let x, y;
      const rank = this.ranking(), loser = rank[rank.length - 1];
      const near = s.assist && this.rng.chance(0.65) ? this.balls.filter((b) => b.team === loser.t) : null;
      if (near && near.length) { const b = this.rng.pick(near); const a = this.rng.range(0, TAU), d = this.rng.range(120, 260); x = b.x + Math.cos(a) * d; y = b.y + Math.sin(a) * d; if (!this.arena.contains(x, y, 60)) [x, y] = this.arena.randomPoint(this.rng, 60); }
      else [x, y] = this.arena.randomPoint(this.rng, 60);
      const kind = this.rng.chance(0.62) ? 'bomb' : 'brush';
      this.pickups.push({ x, y, kind, t: 0, r: 30, alive: true });
      this.snd.sfx('pop', 0.35, g.pan(x), 1.4);
    }
    take(b, p) {
      const g = this.g, s = this.s, tm = this.teams[b.team];
      p.alive = false;
      if (p.kind === 'bomb') {
        this.splat(p.x, p.y, s.bombSize, b.team, true);
        this.fx.shockwave(p.x, p.y, b.color, s.bombSize * 2.4);
        this.fx.burst(p.x, p.y, b.color, 50, 1100, { colors: [b.color, lighten(b.color, 0.4), '#ffffff'] });
        this.snd.sfx('splat', 1, g.pan(p.x)); this.snd.sfx('boom', 0.6, g.pan(p.x), 1.2);
        g.shake(0.45);
        this.fx.popup(p.x, p.y - 60, `${tm.name} PAINT BOMB!`, b.color, 50);
        const late = g.time > g.targetLen - 6;
        g.moment({ x: p.x, y: p.y, zoom: late ? 1.18 : 1.1, slow: late ? 0.3 : 0.5, dur: late ? 0.9 : 0.5, flash: b.color, flashA: 0.15 });
      } else {
        for (const q of this.balls) if (q.team === b.team) { q.brush = 2; q.brushT = 4; }
        this.fx.popup(p.x, p.y - 50, `${tm.name} BIG BRUSH x2`, b.color, 44);
        this.snd.sfx('pickup', 0.7, g.pan(p.x)); this.fx.ring(p.x, p.y, b.color, 160, 0.4, 6);
      }
    }
    update(dt) {
      const s = this.s, g = this.g, T = g.targetLen;
      const rank = this.ranking(), top = rank[0], second = rank[1];
      const gap = top && second ? (top.count - second.count) / this.total : 1;
      g.tension = clamp(g.time / T * 0.75 + (1 - clamp(gap * 8, 0, 1)) * 0.25, 0, 1);
      // lead changes
      // lead changes (with a little hysteresis so a tie doesn't flicker)
      const cur = this.lead >= 0 ? this.teams[this.lead] : null;
      if (g.state === 'play' && top && top.count > 0 && top.t !== this.lead && (!cur || top.count - cur.count > this.total * 0.006)) {
        if (cur && g.time > 3) {
          this.leadChanges++;
          if (g.time - (this.leadPopT ?? -9) > 1.2) { this.leadPopT = g.time; this.fx.popup(540, 560, `${top.name} TAKES THE LEAD`, top.color, 44); this.snd.sfx('whoosh', 0.35, 0, 1.3); }
        }
        this.lead = top.t;
      }
      // pickups
      if (g.state === 'play') {
        this.pickT -= dt;
        if (this.pickT <= 0 && this.pickups.filter((p) => p.alive).length < 2) { this.pickT = s.pickupEvery * this.rng.range(0.7, 1.3); this.spawnPickup(); }
        // final countdown
        const left = Math.ceil(T - g.time);
        if (left <= 5 && left < this.countdown && left > 0) { this.countdown = left; this.fx.banner(String(left), left <= 2 ? '#ff3d5a' : '#ffffff', { size: 150, y: 0.26, dur: 0.8 }); this.snd.sfx('beep', 0.7, 0, left === 1 ? 1.5 : 1); if (left === 1) g.slowmo(0.45, 1.1); }
        if (g.time >= T) this.finish();
      }
      for (const p of this.pickups) p.t += dt;
      const n = P.substeps(this.balls, dt, 0.4, 12), h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of this.balls) {
          if (b.curve) { const c = Math.cos(b.curve * h), sn = Math.sin(b.curve * h), vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx; }
          b.x += b.vx * h; b.y += b.vy * h;
          const imp = this.arena.collide(b, 1);
          if (imp > 60) {
            b.curve = -b.curve * this.rng.range(0.8, 1.2);
            const j = this.rng.range(-0.25, 0.25), c = Math.cos(j), sn = Math.sin(j); const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
            this.splat(C.px + C.nx * 20, C.py + C.ny * 20, s.brush * 1.5 * b.brush, b.team, false);
            if (g.clock - b.lastHit > 0.05) { b.lastHit = g.clock; this.note(0.6, b.x); this.snd.sfx('splat', 0.3, g.pan(b.x), 1.2 + this.rng.range(-0.1, 0.2)); this.contactFx(b, C.px, C.py, C.nx, C.ny, imp); }
          }
        }
        for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) {
          const a = this.balls[i], b = this.balls[j];
          const imp = P.ballBall(a, b, 1);
          if (imp > 60 && a.team !== b.team) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            this.splat(mx + (a.x - mx) * 0.6, my + (a.y - my) * 0.6, s.brush * 1.3 * a.brush, a.team, false);
            this.splat(mx + (b.x - mx) * 0.6, my + (b.y - my) * 0.6, s.brush * 1.3 * b.brush, b.team, false);
            this.note(0.7, mx); this.snd.sfx('splat', 0.45, g.pan(mx));
            this.fx.burst(mx, my, a.color, 8, 400); this.fx.burst(mx, my, b.color, 8, 400);
          }
        }
        for (const b of this.balls) { this.arena.keepIn(b); b.setSpeed(s.speed * (b.brushT > 0 ? 1.1 : 1)); }
      }
      // brush strokes along the path
      for (const b of this.balls) {
        const d = Math.hypot(b.x - b.lx, b.y - b.ly), step = s.brush * 0.5;
        if (d >= step) { const m = Math.ceil(d / step); for (let i = 1; i <= m; i++) this.stamp(b.lx + (b.x - b.lx) * i / m, b.ly + (b.y - b.ly) * i / m, s.brush * b.brush, b.team, 'brush'); b.lx = b.x; b.ly = b.y; }
        if (b.brushT > 0) { b.brushT -= dt; if (b.brushT <= 0) b.brush = 1; }
        for (const p of this.pickups) if (p.alive && Math.hypot(p.x - b.x, p.y - b.y) < p.r + b.r) this.take(b, p);
        this.decayBall(b, dt);
      }
      this.pickups = this.pickups.filter((p) => p.alive);
      for (const t of this.teams) t.shown += (t.count - t.shown) * Math.min(1, dt * 8);
    }
    finish() {
      const g = this.g, rank = this.ranking(), w = rank[0];
      const pct = (100 * w.count / this.total).toFixed(1), second = rank[1];
      const margin = second ? (100 * (w.count - second.count) / this.total).toFixed(1) : pct;
      const wb = this.balls.find((b) => b.team === w.t);
      g.win({ title: `${w.name} WINS!`, sub: `${pct}% of the floor · won by ${margin}% · ${this.leadChanges} lead changes`, color: w.color, y: 760, fx: wb ? wb.x : 540, fy: wb ? wb.y : this.cy, crown: true });
    }
    forceEnd() { if (this.g.state === 'play') this.finish(); }
    audit() { const v = []; for (const b of this.balls) if (this.arena.audit(b)) v.push('ball outside arena'); let sum = 0; for (const t of this.teams) sum += t.count; if (sum > this.total) v.push('coverage over 100%'); return v; }
    paintLayer() {
      const k = this.g.k;
      if (!this.pc) {
        this.pc = document.createElement('canvas'); this.pc.width = Math.round(this.W * k); this.pc.height = Math.round(this.H * k);
        this.pctx = this.pc.getContext('2d'); this.pctx.scale(k, k);
        this.pctx.save(); this.arena.path(this.pctx, 0); this.pctx.clip();
      }
      const c = this.pctx;
      if (this.overflow) {
        this.overflow = false; this.events.length = 0;
        c.clearRect(0, 0, this.W, this.H);
        for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) { const o = this.own[j * this.gw + i]; if (o >= 0) { c.fillStyle = this.teams[o].color; c.fillRect(this.gx + i * CELL - 0.5, this.gy + j * CELL - 0.5, CELL + 1, CELL + 1); } }
      }
      for (const e of this.events) {
        const col = this.teams[e.team].color;
        c.fillStyle = e.kind === 'brush' ? col : mix(col, '#ffffff', hash(e.n) * 0.12);
        if (e.kind === 'big' || e.kind === 'splat') {
          // blobby splat outline
          const m = e.kind === 'big' ? 18 : 10, rot = hash(e.n * 7) * TAU;
          c.beginPath();
          for (let i = 0; i <= m; i++) { const a = rot + (i / m) * TAU, rr = e.r * (0.82 + 0.3 * hash(e.n * 13 + i)); if (i === 0) c.moveTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr); else c.lineTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr); }
          c.closePath(); c.fill();
        } else { c.beginPath(); c.arc(e.x, e.y, e.r, 0, TAU); c.fill(); }
      }
      this.events.length = 0;
      return this.pc;
    }
    render(ctx) {
      const pal = this.pal, A = this.arena, g = this.g;
      A.path(ctx, 0); ctx.fillStyle = pal.light ? '#fbf7f2' : '#15121f'; ctx.fill();
      ctx.save(); ctx.globalAlpha = 0.92; ctx.drawImage(this.paintLayer(), 0, 0, this.W, this.H); ctx.restore();
      // subtle wet sheen
      ctx.save(); A.path(ctx, 0); ctx.clip(); const gr = ctx.createLinearGradient(0, this.cy - 500, 0, this.cy + 500); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(0, this.cy - 520, this.W, 1040); ctx.restore();
      ctx.lineJoin = 'round'; A.path(ctx, 4); ctx.lineWidth = 12; ctx.strokeStyle = pal.light ? 'rgba(40,20,60,0.4)' : 'rgba(255,255,255,0.45)'; ctx.stroke();
      // pickups
      for (const p of this.pickups) {
        const s = easeOutBack(clamp(p.t / 0.35, 0, 1)) * (1 + 0.08 * Math.sin(g.clock * 7));
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s);
        if (!this.look.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, 0, 0, 120, p.kind === 'bomb' ? '#ffb020' : '#7df9ff', 0.4); ctx.globalCompositeOperation = 'source-over'; }
        if (p.kind === 'bomb') {
          ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 4, p.r, 0, TAU); ctx.fill();
          ['#ff3d5a', '#3dd6ff', '#ffd23f', '#7dff9a'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-12 + (i % 2) * 24, -6 + Math.floor(i / 2) * 20, 7, 0, TAU); ctx.fill(); });
          ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(8, -p.r + 6); ctx.quadraticCurveTo(18, -p.r - 10, 26, -p.r - 6); ctx.stroke();
          ctx.fillStyle = mix('#ffd23f', '#ffffff', 0.5 + 0.5 * Math.sin(g.clock * 30)); ctx.beginPath(); ctx.arc(26, -p.r - 6, 5, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = '#ffffff'; draw.roundRect(ctx, -p.r, -p.r * 0.7, p.r * 2, p.r * 1.4, 10); ctx.fill();
          draw.label(ctx, 'x2', 0, 10, 28, '#111', 900, 0);
        }
        ctx.restore();
      }
      this.drawTrails(ctx, this.balls, 1, 0.3);
      for (const b of this.balls) {
        if (b.brushT > 0) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
        draw.ball(ctx, b, this.look);
      }
    }
    hud(ctx) {
      const pal = this.pal, W = this.W, g = this.g, rank = this.ranking();
      const n = rank.length, bw = W - 120, x0 = 60, y0 = 300;
      // stacked coverage bar
      draw.panel(ctx, x0 - 16, y0 - 16, bw + 32, 70, 22, this.look, 0.6);
      let x = x0;
      const blank = 1 - this.teams.reduce((a, t) => a + t.shown, 0) / this.total;
      for (const t of this.teams) { const w = bw * t.shown / this.total; ctx.fillStyle = t.color; ctx.fillRect(x, y0, w, 38); x += w; }
      ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.1)' : 'rgba(255,255,255,0.1)'; ctx.fillRect(x, y0, bw * Math.max(0, blank), 38);
      // leaderboard chips
      const cw = Math.min(250, (W - 60) / n - 10), cx0 = W / 2 - (cw * n + 10 * (n - 1)) / 2;
      rank.forEach((t, i) => {
        const cx = cx0 + i * (cw + 10), cy = y0 + 70;
        draw.panel(ctx, cx, cy, cw, 70, 18, this.look, 0.62);
        ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(cx + 32, cy + 35, 18, 0, TAU); ctx.fill();
        if (i === 0) draw.crown(ctx, cx + 32, cy + 12, 0.22, '#ffd23f');
        draw.font(ctx, cw > 190 ? 30 : 24, 900); ctx.fillStyle = pal.light ? pal.text : '#ffffff';
        ctx.fillText((100 * t.shown / this.total).toFixed(1) + '%', cx + 58, cy + 46);
      });
      // timer
      const left = Math.max(0, g.targetLen - g.time);
      draw.font(ctx, 30, 800, 'Space Grotesk'); ctx.textAlign = 'center'; ctx.fillStyle = left < 5 ? '#ff3d5a' : (pal.light ? pal.text : '#ffffff');
      ctx.fillText(g.state === 'play' ? `⏱ ${left.toFixed(1)}s` : 'TIME!', W / 2, y0 + 176); ctx.textAlign = 'left';
    }
    stats() { return { cov: this.teams.map((t) => t.name + ':' + (100 * t.count / this.total).toFixed(1)), leadChanges: this.leadChanges }; }
  }

  SB.modes.register({
    id: 'paint', name: 'Paint Splat', icon: '🎨', category: 'Territory', tagline: 'Balls paint the floor — most coverage when the timer ends wins',
    hook: 'Which colour *paints the most?*',
    hookY: 170,
    settings: [
      { key: 'colors', label: 'Colours', type: 'range', min: 2, max: 6, step: 1, def: 4, rand: [2, 5] },
      { key: 'perColor', label: 'Balls per colour', type: 'range', min: 1, max: 6, step: 1, def: 1, rand: [1, 2] },
      { key: 'brush', label: 'Brush size', type: 'range', min: 10, max: 60, step: 1, def: 26, rand: [20, 32] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1400, step: 10, def: 620, rand: [500, 760] },
      { key: 'curve', label: 'Swirl (curved paths)', type: 'range', min: 0, max: 3, step: 0.1, def: 1.2, rand: [0.4, 2] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 12, max: 50, step: 1, def: 26, rand: [22, 32] },
      { key: 'pickupEvery', label: 'Pickup every (s)', type: 'range', min: 1, max: 15, step: 0.5, def: 4, rand: [3, 6] },
      { key: 'bombSize', label: 'Paint bomb size', type: 'range', min: 60, max: 300, step: 5, def: 150, rand: [120, 190] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(), rand: ['circle', 'circle', 'square', 'hexagon', 'octagon', 'heart', 'star'] },
      { key: 'arenaSize', label: 'Arena size', type: 'range', min: 340, max: 500, step: 5, def: 470, rand: [440, 490] },
      { key: 'assist', label: 'Drama assist (bombs favour the losing colour)', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: '4 Colour Splat', s: {} },
      { name: '1v1 Paint Duel', s: { colors: 2, perColor: 1, brush: 32 } },
      { name: 'Paint Party (6x2)', s: { colors: 6, perColor: 2, brush: 20, ballSize: 20 } },
      { name: 'Heart Canvas', s: { shape: 'heart', colors: 3 } },
      { name: 'Bomb Frenzy', s: { pickupEvery: 1.5, bombSize: 200 } },
    ],
    create: (g, s) => new Paint(g, s),
  });
})(window.SB);
