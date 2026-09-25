/* Mode: Colour War — team balls bounce off enemy tiles and flip them; most territory when the clock hits 0 wins. */
'use strict';
(function (SB) {
  const { TAU, clamp, mix, rgba, darken, lighten } = SB.util;
  const P = SB.phys, draw = SB.draw;

  class ColorWar extends SB.Mode {
    init() {
      const s = this.s, rng = this.rng;
      this.ts = s.tile;
      this.x0 = 60; this.y0 = 580;
      this.cols = Math.floor(960 / this.ts); this.rows = Math.floor(1140 / this.ts);
      this.x0 = 540 - (this.cols * this.ts) / 2;
      this.grid = new Int8Array(this.cols * this.rows);
      this.flipT = new Float32Array(this.cols * this.rows);
      const T = s.teams;
      const ci = this.distinctColors(T, 8);
      this.teams = ci.map((c, i) => ({ i, color: this.color(c), name: this.cname(c), count: 0 }));
      // initial territories
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        let t;
        if (T === 2) t = c < this.cols / 2 ? 0 : 1;
        else if (T === 3) t = Math.min(2, Math.floor((r / this.rows) * 3));
        else t = (c < this.cols / 2 ? 0 : 1) + (r < this.rows / 2 ? 0 : 2);
        this.grid[r * this.cols + c] = t;
      }
      this.balls = [];
      for (const tm of this.teams) {
        // centre of territory
        let sx = 0, sy = 0, n = 0;
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this.grid[r * this.cols + c] === tm.i) { sx += c; sy += r; n++; }
        for (let k = 0; k < s.perTeam; k++) {
          const a = rng.range(0, TAU);
          const b = new P.Ball(this.x0 + (sx / n + 0.5) * this.ts + (k - (s.perTeam - 1) / 2) * 60, this.y0 + (sy / n + 0.5) * this.ts, s.ballSize, { vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, color: '#ffffff', name: tm.name });
          b.team = tm.i; b.lastHit = -1;
          this.balls.push(b);
        }
      }
      this.duration = s.duration > 0 ? s.duration : this.g.targetLen;
      this.lastTick = -1; this.over = false; this.flood = -1;
      this.recount();
      this.trailLen = 12;
      this.cv = document.createElement('canvas'); this.cv.width = this.cols * this.ts; this.cv.height = this.rows * this.ts;
      this.dirty = true;
    }
    trailBalls() { return this.balls; }
    recount() { for (const t of this.teams) t.count = 0; for (let i = 0; i < this.grid.length; i++) this.teams[this.grid[i]].count++; }
    update(dt) {
      const s = this.s, g = this.g;
      const left = this.duration - g.time;
      g.tension = clamp(g.time / this.duration, 0, 1);
      for (let i = 0; i < this.flipT.length; i++) if (this.flipT[i] > 0) { this.flipT[i] = Math.max(0, this.flipT[i] - dt * 3); this.dirty = true; }
      if (this.flood >= 0) { this.flood += dt * 1400; this.floodFill(); }
      if (!this.over) {
        const n = P.substeps(this.balls, dt, 0.35, 12), h = dt / n;
        for (let k = 0; k < n; k++) {
          for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) P.ballBall(this.balls[i], this.balls[j], 1);
          for (const b of this.balls) this.move(b, h);
        }
        for (const b of this.balls) { b.setSpeed(s.speed); this.decayBall(b, dt); }
        // countdown ticks in the last 5 seconds
        const sec = Math.ceil(left);
        if (sec <= 5 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; this.snd.sfx('tick', 0.9, 0, sec === 1 ? 1.5 : 1.2); this.fx.kick(0.02); }
        if (left <= 0 && g.state === 'play') this.finish();
      }
    }
    move(b, h) {
      const ts = this.ts;
      b.x += b.vx * h; b.y += b.vy * h;
      // outer bounds
      const L = this.x0, T = this.y0, R = this.x0 + this.cols * ts, B = this.y0 + this.rows * ts;
      if (b.x < L + b.r) { b.x = L + b.r; b.vx = Math.abs(b.vx); }
      if (b.x > R - b.r) { b.x = R - b.r; b.vx = -Math.abs(b.vx); }
      if (b.y < T + b.r) { b.y = T + b.r; b.vy = Math.abs(b.vy); }
      if (b.y > B - b.r) { b.y = B - b.r; b.vy = -Math.abs(b.vy); }
      // enemy tiles
      const c0 = Math.max(0, Math.floor((b.x - b.r - L) / ts)), c1 = Math.min(this.cols - 1, Math.floor((b.x + b.r - L) / ts));
      const r0 = Math.max(0, Math.floor((b.y - b.r - T) / ts)), r1 = Math.min(this.rows - 1, Math.floor((b.y + b.r - T) / ts));
      let nx = 0, ny = 0, hits = 0;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (this.grid[i] === b.team) continue;
        const tx = L + c * ts, ty = T + r * ts;
        const qx = clamp(b.x, tx, tx + ts), qy = clamp(b.y, ty, ty + ts);
        const dx = b.x - qx, dy = b.y - qy, d2 = dx * dx + dy * dy;
        if (d2 >= b.r * b.r) continue;
        const d = Math.sqrt(d2) || 1;
        nx += d2 > 0 ? dx / d : -b.vx; ny += d2 > 0 ? dy / d : -b.vy;
        this.convert(i, b, tx + ts / 2, ty + ts / 2);
        hits++;
      }
      if (hits) {
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
        const j = this.rng.range(-0.06, 0.06), c = Math.cos(j), s = Math.sin(j);
        const vx = b.vx * c - b.vy * s; b.vy = b.vx * s + b.vy * c; b.vx = vx;
        if (this.g.clock - b.lastHit > 0.05) { b.lastHit = this.g.clock; this.note(0.55, b.x); b.flash = 0.6; b.squash = 0.2; b.sqa = Math.atan2(ny, nx) + Math.PI / 2; }
      }
    }
    convert(i, b, x, y) {
      const from = this.grid[i];
      this.grid[i] = b.team; this.teams[from].count--; this.teams[b.team].count++;
      this.flipT[i] = 1; this.dirty = true; this.lastFlip = b.team;
      if (this.look.particles > 0.3) this.fx.burst(x, y, this.teams[b.team].color, 2, 220, { grav: 0, life: 0.5, size: 0.8 });
    }
    finish() {
      const g = this.g;
      this.over = true;
      const ranked = this.teams.slice().sort((a, b) => b.count - a.count);
      // exact tie: the team that flipped the last tile takes it (there is always a winner)
      const w = ranked[0].count === ranked[1].count && this.lastFlip != null ? this.teams[this.lastFlip] : ranked[0];
      this.winner = w;
      const pct = Math.round((w.count / this.grid.length) * 100);
      // flood the board from the winner's balls
      this.flood = 0; this.floodFrom = this.balls.filter((b) => b.team === w.i).map((b) => [b.x, b.y]);
      g.win({ title: `${w.name} WINS!`, sub: `${pct}% of the board`, color: w.color, y: 1040 });
    }
    floodFill() {
      const ts = this.ts, W = this.winner.i;
      let changed = false;
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c; if (this.grid[i] === W) continue;
        const x = this.x0 + (c + 0.5) * ts, y = this.y0 + (r + 0.5) * ts;
        for (const [fx, fy] of this.floodFrom) if (Math.hypot(x - fx, y - fy) < this.flood) { this.grid[i] = W; this.flipT[i] = 1; changed = true; break; }
      }
      if (changed) this.dirty = true;
    }
    audit() {
      const v = [], ts = this.ts;
      for (const b of this.balls) {
        const c = Math.floor((b.x - this.x0) / ts), r = Math.floor((b.y - this.y0) / ts);
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) v.push('ball off board');
      }
      return v;
    }
    forceEnd() { if (!this.over) this.finish(); }
    render(ctx) {
      const ts = this.ts;
      if (this.dirty) {
        const g = this.cv.getContext('2d');
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          const i = r * this.cols + c, tm = this.teams[this.grid[i]];
          g.fillStyle = darken(tm.color, 0.28); g.fillRect(c * ts, r * ts, ts, ts);
          const f = this.flipT[i];
          g.fillStyle = f > 0 ? mix(tm.color, '#ffffff', f * 0.8) : tm.color;
          g.fillRect(c * ts + 1.5, r * ts + 1.5, ts - 3, ts - 3);
        }
        this.dirty = false;
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 30;
      draw.roundRect(ctx, this.x0 - 8, this.y0 - 8, this.cols * ts + 16, this.rows * ts + 16, 20); ctx.fillStyle = '#0c0a18'; ctx.fill();
      ctx.restore();
      ctx.save(); draw.roundRect(ctx, this.x0, this.y0, this.cols * ts, this.rows * ts, 14); ctx.clip();
      ctx.drawImage(this.cv, this.x0, this.y0);
      ctx.restore();
      this.drawTrails(ctx, this.balls, 1.0, 0.6);
      for (const b of this.balls) {
        // dark core + bright rim: always readable on its own team's (same-colour) territory
        const col = this.teams[b.team].color;
        if (!this.pal.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, b.x, b.y, b.r * 4.5, '#ffffff', 0.35 + b.flash * 0.4); ctx.globalCompositeOperation = 'source-over'; }
        ctx.fillStyle = darken(col, 0.72); ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.lineWidth = Math.max(3, b.r * 0.28); ctx.strokeStyle = mix(col, '#ffffff', 0.35 + b.flash * 0.5); ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.84, 0, TAU); ctx.stroke();
      }
    }
    hud(ctx) {
      const W = this.W, pal = this.pal, total = this.grid.length;
      const x0 = 70, w = W - 140, y = 330, h = 64;
      // split score bar
      draw.roundRect(ctx, x0, y, w, h, 32); ctx.save(); ctx.clip();
      let x = x0;
      for (const t of this.teams) { const tw = (t.count / total) * w; ctx.fillStyle = t.color; ctx.fillRect(x, y, tw + 1, h); t.bx = x + tw / 2; x += tw; }
      ctx.restore();
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; draw.roundRect(ctx, x0, y, w, h, 32); ctx.stroke();
      draw.font(ctx, 30, 900); ctx.textAlign = 'center';
      for (const t of this.teams) {
        const pct = Math.round((t.count / total) * 100);
        if (pct < 6) continue;
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineJoin = 'round';
        ctx.strokeText(pct + '%', t.bx, y + 43); ctx.fillStyle = '#ffffff'; ctx.fillText(pct + '%', t.bx, y + 43);
      }
      // team names under the bar
      draw.font(ctx, 26, 900);
      this.teams.forEach((t, i) => { ctx.fillStyle = t.color; ctx.fillText(t.name, x0 + (w / this.teams.length) * (i + 0.5), y + h + 40); });
      // countdown
      if (this.g.state === 'play') {
        const left = Math.max(0, this.duration - this.g.time);
        const urgent = left <= 5;
        const sz = urgent ? 64 + 10 * (1 - (left % 1)) : 50;
        draw.font(ctx, sz, 900);
        ctx.fillStyle = urgent ? '#ff3d5a' : (pal.light ? pal.text : '#ffffff');
        ctx.fillText(urgent ? String(Math.ceil(left)) : SB.util.fmtTime(Math.ceil(left)), W / 2, y + h + 110);
      }
      ctx.textAlign = 'left';
    }
    stats() { return { teams: this.teams.map((t) => t.name + ':' + t.count) }; }
  }

  SB.modes.register({
    id: 'colorwar', name: 'Colour War', icon: '▦', tagline: 'Teams flip tiles — most territory at 0:00 wins',
    hook: 'Which colour *takes over?*',
    settings: [
      { key: 'teams', label: 'Teams', type: 'range', min: 2, max: 4, step: 1, def: 2, rand: [2, 4] },
      { key: 'perTeam', label: 'Balls per team', type: 'range', min: 1, max: 4, step: 1, def: 2, rand: [1, 3] },
      { key: 'duration', label: 'Timer (s, 0 = target length)', type: 'range', min: 0, max: 90, step: 1, def: 0, rand: false },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1800, step: 10, def: 1000, rand: [800, 1200] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 8, max: 40, step: 1, def: 17, rand: [14, 22] },
      { key: 'tile', label: 'Tile size', type: 'range', min: 20, max: 80, step: 2, def: 32, rand: [28, 40] },
    ],
    presets: [
      { name: 'Day vs Night', s: { teams: 2, perTeam: 1, tile: 30 } },
      { name: '4-Team War', s: { teams: 4, perTeam: 1, tile: 36 } },
      { name: 'Swarm (3 per team)', s: { teams: 2, perTeam: 3, ballSize: 14, speed: 700 } },
    ],
    create: (g, s) => new ColorWar(g, s),
  });
})(window.SB);
