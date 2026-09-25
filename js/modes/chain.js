/* Mode: Chain Reaction — balls bounce through a board of numbered bricks. TNT bricks blow up their
 * neighbours (and other TNT -> chains), +BALL bricks add balls. Goal: clear the whole board. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, gradientAt, lighten, darken, mix } = SB.util;
  const P = SB.phys, draw = SB.draw;
  const BOX = { x0: 36, x1: 1044, y0: 470, y1: 1780 };

  // board shapes: (c, r, cols, rows, rng) -> brick here?
  const SHAPES = {
    full: () => true,
    pyramid: (c, r, C, R) => Math.abs(c - (C - 1) / 2) <= r * (C / 2) / R + 0.5,
    diamond: (c, r, C, R) => Math.abs(c - (C - 1) / 2) / (C / 2) + Math.abs(r - (R - 1) / 2) / (R / 2) <= 1.05,
    heart: (c, r, C, R) => { const x = (c / (C - 1) * 2 - 1) * 1.18, y = (1 - r / (R - 1) * 2) * 1.12 + 0.12; return (x * x + y * y - 1) ** 3 - x * x * y * y * y <= 0; },
    rings: (c, r, C, R) => { const d = Math.hypot((c - (C - 1) / 2) / (C / 2), (r - (R - 1) / 2) / (R / 2)); return d < 1.05 && (Math.floor(d * 4) % 2 === 0 || d < 0.2); },
    checker: (c, r) => (c + r) % 2 === 0,
    random: (c, r, C, R, rng) => rng.chance(0.72),
  };

  class Chain extends SB.Mode {
    init() {
      const s = this.s, g = this.g;
      const C = s.cols, R = s.rows;
      const cw = (BOX.x1 - BOX.x0 - 40) / C, top = 590, ch = Math.min(cw * 0.62, (s.boardH - 0) / R);
      this.cw = cw; this.ch = ch; this.gx = BOX.x0 + 20; this.gy = top; this.C = C; this.R = R;
      const shape = SHAPES[s.shape] || SHAPES.full;
      this.bricks = []; this.cell = new Array(C * R).fill(null);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        if (!shape(c, r, C, R, this.rng)) continue;
        const roll = this.rng.next();
        const kind = roll < s.tnt ? 'tnt' : roll < s.tnt + s.multi ? 'ball' : 'brick';
        const rowK = 1 - r / Math.max(1, R - 1);
        const hp = kind === 'brick' ? Math.max(1, Math.round(s.maxHp * (0.35 + 0.65 * rowK) * this.rng.range(0.55, 1))) : kind === 'tnt' ? 1 : 2;
        const b = { c, r, x: this.gx + c * cw + 3, y: this.gy + r * ch + 3, w: cw - 6, h: ch - 6, hp, maxHp: hp, kind, alive: true, flash: 0, dmgT: -9, fuse: -1 };
        this.bricks.push(b); this.cell[r * C + c] = b;
      }
      if (this.bricks.length < 4) { const b = { c: 0, r: 0, x: this.gx + 3, y: this.gy + 3, w: cw - 6, h: ch - 6, hp: 1, maxHp: 1, kind: 'brick', alive: true, flash: 0, dmgT: -9, fuse: -1 }; this.bricks.push(b); this.cell[0] = b; }
      this.totalHp = this.bricks.reduce((a, b) => a + b.hp, 0);
      this.maxBrickHp = Math.max(...this.bricks.map((b) => b.maxHp));
      this.balls = [];
      for (let i = 0; i < s.balls; i++) this.addBall(540 + (i - (s.balls - 1) / 2) * 60, BOX.y1 - 120, -Math.PI / 2 + (i - (s.balls - 1) / 2) * 0.22 + this.rng.range(-0.1, 0.1));
      this.dmgMul = 1; this.pending = []; this.chain = 0; this.chainT = -9; this.bestChain = 0;
      this.cleared = 0; this.lastBreak = 0; this.trailLen = 14;
    }
    get left() { return this.bricks.filter((b) => b.alive); }
    roster() { return null; }
    trailBalls() { return this.balls; }
    addBall(x, y, a) {
      if (this.balls.length >= this.s.maxBalls) return null;
      const b = new P.Ball(x, y, this.s.ballSize, { color: this.balls.length ? this.color(this.balls.length + 2) : (this.s.ballColor || '#ffffff') });
      b.vx = Math.cos(a) * this.s.speed; b.vy = Math.sin(a) * this.s.speed; b.lastHit = -1;
      this.balls.push(b);
      return b;
    }
    hpLeft() { let h = 0; for (const b of this.bricks) if (b.alive) h += b.hp; return h; }
    hit(b, ball, dmg, why) {
      if (!b.alive) return;
      const g = this.g;
      b.flash = 1; b.dmgT = g.clock;
      if (b.kind === 'tnt') { this.detonate(b, why === 'boom' ? 0.07 : 0); return; }
      b.hp -= dmg;
      if (b.hp <= 0.001) this.breakBrick(b, ball);
      else if (ball && g.clock - ball.lastHit > 0.03) { ball.lastHit = g.clock; this.note(0.35 + 0.5 * (1 - b.hp / b.maxHp), b.x + b.w / 2); this.snd.sfx('tick', 0.22, g.pan(b.x), 1.2 + this.rng.range(-0.1, 0.1)); }
    }
    breakBrick(b, ball) {
      const g = this.g, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      b.alive = false; b.hp = 0; this.cell[b.r * this.C + b.c] = null;
      this.cleared++; this.lastBreak = g.time;
      const col = this.brickColor(b);
      this.fx.debris(cx, cy, b.w, b.h, col, 6, { power: 0.8 });
      this.fx.burst(cx, cy, col, 10, 500);
      this.note(0.8, cx);
      this.snd.sfx('pop', 0.4, g.pan(cx), 1 + this.rng.range(-0.15, 0.2));
      if (b.kind === 'ball') {
        const nb = this.addBall(cx, cy, this.rng.range(0, TAU));
        this.fx.popup(cx, cy - 20, nb ? '+1 BALL' : 'MAX BALLS', '#7dff9a', 40); this.snd.sfx('pickup', 0.6, g.pan(cx));
        this.fx.ring(cx, cy, '#7dff9a', 140, 0.4, 6);
      }
      if (!this.left.length) this.finish(cx, cy);
    }
    detonate(b, delay) {
      if (b.fuse >= 0) return;
      b.fuse = delay;
      this.pending.push(b);
    }
    explode(b) {
      const g = this.g, s = this.s, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      b.alive = false; b.hp = 0; this.cell[b.r * this.C + b.c] = null; this.cleared++; this.lastBreak = g.time;
      // chain counter
      this.chain = g.time - this.chainT < 0.35 ? this.chain + 1 : 1; this.chainT = g.time;
      this.bestChain = Math.max(this.bestChain, this.chain);
      this.fx.burst(cx, cy, '#ffb020', 34, 1100, { colors: ['#ffb020', '#ff5a1f', '#ffffff'] });
      this.fx.shockwave(cx, cy, '#ffb020', this.cw * s.blast * 2.2);
      this.fx.flare(cx, cy, '#ffb020', 600);
      this.fx.debris(cx, cy, b.w, b.h, '#ff5a1f', 8, { power: 1.6 });
      this.snd.sfx('explode', 0.55 + Math.min(0.4, this.chain * 0.06), g.pan(cx), 1 + Math.min(0.5, this.chain * 0.05) + this.rng.range(-0.05, 0.05));
      g.shake(0.22 + Math.min(0.5, this.chain * 0.06));
      this.note(1, cx);
      if (this.chain >= 3) this.fx.popup(cx, cy - 30, `CHAIN x${this.chain}`, '#ffd23f', 40 + Math.min(40, this.chain * 4));
      if (this.chain === 5 || this.chain === 10 || this.chain === 15) {
        this.fx.banner(`CHAIN x${this.chain}!`, '#ffd23f', { size: 88, y: 0.3, dur: 1.1 });
        g.moment({ x: cx, y: cy, zoom: 1.12, slow: 0.35, dur: 0.8, flash: '#ffb020', flashA: 0.2 });
        this.snd.sfx('crash', 0.5, 0);
      }
      // blast: everything within radius takes heavy damage, other TNT chains
      const rad = s.blast;
      for (let dr = -Math.ceil(rad); dr <= Math.ceil(rad); dr++) for (let dc = -Math.ceil(rad); dc <= Math.ceil(rad); dc++) {
        if (dr * dr + dc * dc > rad * rad + 0.01) continue;
        const r = b.r + dr, c = b.c + dc;
        if (r < 0 || c < 0 || r >= this.R || c >= this.C) continue;
        const t = this.cell[r * this.C + c];
        if (!t || !t.alive || t === b) continue;
        this.hit(t, null, s.tntDmg * (s.assist ? clamp(this.dmgMul, 0.2, 4) : 1), 'boom');
      }
      // balls nearby get kicked
      for (const ball of this.balls) { const dx = ball.x - cx, dy = ball.y - cy, d = Math.hypot(dx, dy); if (d < this.cw * rad * 1.3 && d > 1) { ball.vx = dx / d * ball.speed; ball.vy = dy / d * ball.speed; } }
      if (!this.left.length) this.finish(cx, cy);
    }
    finish(x, y) {
      const g = this.g;
      if (g.state !== 'play') return;
      this.fx.shockwave(x, y, '#ffffff', 900);
      g.win({ title: 'BOARD CLEARED!', sub: `${this.bricks.length} bricks · biggest chain x${this.bestChain} · ${this.balls.length} balls`, color: this.pal.accent, y: 760, fx: x, fy: y });
    }
    brickColor(b) {
      if (b.kind === 'tnt') return '#ff3d3d';
      if (b.kind === 'ball') return '#3ddc84';
      return gradientAt(this.pal.grad, clamp(b.maxHp / this.maxBrickHp, 0, 1) * 0.9);
    }
    // ball vs axis-aligned brick
    brickHit(ball, b) {
      const px = clamp(ball.x, b.x, b.x + b.w), py = clamp(ball.y, b.y, b.y + b.h);
      let dx = ball.x - px, dy = ball.y - py, d2 = dx * dx + dy * dy;
      if (d2 >= ball.r * ball.r) return false;
      let d = Math.sqrt(d2), nx, ny, depth;
      if (d < 1e-6) { // centre inside the brick: push out along the shallowest axis
        const l = ball.x - b.x, r = b.x + b.w - ball.x, t = ball.y - b.y, bo = b.y + b.h - ball.y, m = Math.min(l, r, t, bo);
        if (m === l) { nx = -1; ny = 0; } else if (m === r) { nx = 1; ny = 0; } else if (m === t) { nx = 0; ny = -1; } else { nx = 0; ny = 1; }
        depth = m + ball.r;
      } else { nx = dx / d; ny = dy / d; depth = ball.r - d; }
      P.resolve(ball, nx, ny, depth, 1);
      return true;
    }
    update(dt) {
      const s = this.s, g = this.g;
      const hp = this.hpLeft(), left = this.left.length, frac = 0.5 * hp / this.totalHp + 0.5 * left / this.bricks.length;
      g.tension = clamp(1 - frac, 0, 1);
      // pacing: remaining HP should follow a line to zero near the target
      if (s.assist && g.state === 'play') {
        const exp = 1 - clamp(g.time / (g.targetLen * 0.88), 0, 1);
        if (frac > exp + 0.05) this.dmgMul = Math.min(this.maxBrickHp * 1.2, this.dmgMul * (1 + dt * 0.7));
        // hits are the bottleneck once every hit one-shots: send in a bonus ball
        this.bonusT = (this.bonusT ?? 3) - dt;
        if (frac > exp + 0.1 && this.bonusT <= 0 && this.dmgMul > this.maxBrickHp * 0.5 && this.balls.length < this.s.maxBalls) {
          this.bonusT = 2.5;
          const nb = this.addBall(540, BOX.y1 - 60, -Math.PI / 2 + this.rng.range(-0.5, 0.5));
          if (nb) { this.fx.popup(540, BOX.y1 - 110, '+1 BALL', '#7dff9a', 44); this.snd.sfx('pickup', 0.5, 0, 1.2); this.fx.ring(540, BOX.y1 - 60, '#7dff9a', 120, 0.4, 6); }
        }
        else if (frac < exp - 0.05) this.dmgMul = Math.max(left <= 8 ? 1 : 0.12, this.dmgMul * (1 - dt * 0.7));
        // never let a stall drag on: no breaks for a while -> hits get stronger again
        const stall = g.time - this.lastBreak;
        if (stall > 1.5) this.dmgMul = Math.min(this.maxBrickHp * 1.2, Math.max(this.dmgMul, 0.5) * (1 + dt * 0.9 * Math.min(3, stall - 1)));
      }
      // fuses
      if (this.pending.length) {
        const now = [];
        for (const b of this.pending) { b.fuse -= dt; if (b.fuse <= 0) now.push(b); }
        this.pending = this.pending.filter((b) => b.fuse > 0);
        for (const b of now) this.explode(b);
      }
      const dmg = s.dmg * this.dmgMul; // fractional: the assist can slow a 60-ball storm down too
      const n = P.substeps(this.balls, dt, 0.4, 16), h = dt / n;
      const { cw, ch, gx, gy, C, R } = this;
      for (let k = 0; k < n; k++) {
        for (const ball of this.balls) {
          ball.x += ball.vx * h; ball.y += ball.vy * h;
          // box walls
          let wall = false;
          if (ball.x < BOX.x0 + ball.r) { ball.x = BOX.x0 + ball.r; ball.vx = Math.abs(ball.vx); wall = true; }
          if (ball.x > BOX.x1 - ball.r) { ball.x = BOX.x1 - ball.r; ball.vx = -Math.abs(ball.vx); wall = true; }
          if (ball.y < BOX.y0 + ball.r) { ball.y = BOX.y0 + ball.r; ball.vy = Math.abs(ball.vy); wall = true; }
          if (ball.y > BOX.y1 - ball.r) { ball.y = BOX.y1 - ball.r; ball.vy = -Math.abs(ball.vy); wall = true; }
          if (wall && g.clock - ball.lastHit > 0.08) { ball.lastHit = g.clock; this.note(0.3, ball.x); const j = this.rng.range(-0.05, 0.05), c = Math.cos(j), sn = Math.sin(j); const vx = ball.vx * c - ball.vy * sn; ball.vy = ball.vx * sn + ball.vy * c; ball.vx = vx; }
          // bricks near the ball
          const c0 = Math.floor((ball.x - ball.r - gx) / cw), c1 = Math.floor((ball.x + ball.r - gx) / cw);
          const r0 = Math.floor((ball.y - ball.r - gy) / ch), r1 = Math.floor((ball.y + ball.r - gy) / ch);
          for (let r = Math.max(0, r0); r <= Math.min(R - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(C - 1, c1); c++) {
            const b = this.cell[r * C + c];
            if (b && b.alive && b.fuse < 0 && this.brickHit(ball, b)) this.hit(b, ball, dmg, 'ball');
          }
          ball.setSpeed(s.speed);
        }
        if (s.ballCollide && this.balls.length > 1) for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) P.ballBall(this.balls[i], this.balls[j], 1);
      }
      // endgame: with few bricks left, balls curve gently towards them so nobody waits forever
      if (g.state === 'play' && left > 0 && left <= 4 && g.time - this.lastBreak > 2) {
        for (const ball of this.balls) {
          let best = null, bd = 1e9;
          for (const b of this.bricks) if (b.alive) { const d = (b.x + b.w / 2 - ball.x) ** 2 + (b.y + b.h / 2 - ball.y) ** 2; if (d < bd) { bd = d; best = b; } }
          if (!best) break;
          const want = Math.atan2(best.y + best.h / 2 - ball.y, best.x + best.w / 2 - ball.x), cur = Math.atan2(ball.vy, ball.vx), turn = 0.7 * dt;
          const a = cur + clamp(SB.util.angleDiff(cur, want), -turn, turn), sp = ball.speed; ball.vx = Math.cos(a) * sp; ball.vy = Math.sin(a) * sp;
        }
      }
      if (left === 1 && g.state === 'play' && !this.lastOne) { this.lastOne = true; this.fx.banner('LAST BRICK!', '#ffffff', { size: 76, y: 0.33, dur: 1.2 }); this.snd.sfx('riser', 0.5); }
      for (const b of this.bricks) b.flash = Math.max(0, b.flash - dt * 5);
      for (const ball of this.balls) this.decayBall(ball, dt);
    }
    forceEnd() { this.dmgMul = 999; for (const b of this.bricks) if (b.alive && b.kind === 'tnt') this.detonate(b, 0); }
    audit() {
      const v = [];
      for (const ball of this.balls) {
        if (ball.x < BOX.x0 - 2 || ball.x > BOX.x1 + 2 || ball.y < BOX.y0 - 2 || ball.y > BOX.y1 + 2) v.push('ball outside box');
        for (const b of this.bricks) if (b.alive && b.fuse < 0 && ball.x > b.x + 4 && ball.x < b.x + b.w - 4 && ball.y > b.y + 4 && ball.y < b.y + b.h - 4) { v.push('ball inside brick'); break; }
      }
      return v;
    }
    render(ctx) {
      const pal = this.pal, g = this.g, t = g.clock;
      // play box
      ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.25)';
      draw.roundRect(ctx, BOX.x0, BOX.y0, BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, 26); ctx.fill();
      ctx.strokeStyle = pal.light ? 'rgba(40,20,60,0.3)' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 6; ctx.stroke();
      // bricks
      const rr = Math.min(12, this.ch * 0.22);
      for (const b of this.bricks) {
        if (!b.alive) continue;
        const col = this.brickColor(b), shake = b.fuse >= 0 ? 3 : 0;
        const x = b.x + (shake ? Math.sin(t * 90) * shake : 0), y = b.y;
        const k = b.kind === 'brick' ? 0.35 + 0.65 * b.hp / b.maxHp : 1;
        ctx.fillStyle = darken(col, 0.35); draw.roundRect(ctx, x, y + 4, b.w, b.h, rr); ctx.fill();
        ctx.fillStyle = mix(mix(darken(col, 0.25), col, k), '#ffffff', b.flash * 0.6); draw.roundRect(ctx, x, y, b.w, b.h - 3, rr); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; draw.roundRect(ctx, x + 4, y + 3, b.w - 8, (b.h - 3) * 0.32, rr * 0.6); ctx.fill();
        const fs = Math.round(Math.min(b.h * 0.5, b.w * 0.34));
        if (b.kind === 'tnt') {
          draw.label(ctx, 'TNT', x + b.w / 2, y + b.h / 2 + fs * 0.34, fs, '#ffffff', 900, 0.2);
          const sp = 0.5 + 0.5 * Math.sin(t * 20 + b.c);
          ctx.fillStyle = mix('#ffd23f', '#ffffff', sp); ctx.beginPath(); ctx.arc(x + b.w - 8, y + 6, 4 + sp * 3, 0, TAU); ctx.fill();
        } else if (b.kind === 'ball') {
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x + b.w / 2, y + b.h / 2 - 1, Math.min(b.h, b.w) * 0.28, 0, TAU); ctx.stroke();
          draw.label(ctx, '+1', x + b.w / 2, y + b.h / 2 + fs * 0.3, Math.round(fs * 0.8), '#ffffff', 900, 0.2);
        } else draw.label(ctx, String(Math.ceil(b.hp)), x + b.w / 2, y + b.h / 2 + fs * 0.34, fs, '#ffffff', 900, 0.2);
      }
      this.drawTrails(ctx, this.balls, 1.3, 0.45);
      this.drawBalls(ctx, this.balls);
    }
    hud(ctx) {
      const left = this.left.length;
      this.g.hudCounter(ctx, 'bricks left', String(left), 1 - this.hpLeft() / this.totalHp, { y: 300, size: 70 });
      if (this.g.time - this.chainT < 0.8 && this.chain >= 3) {
        const a = 1 - (this.g.time - this.chainT) / 0.8;
        ctx.globalAlpha = a; draw.label(ctx, `CHAIN x${this.chain}`, this.W - 150, 330, 44, '#ffd23f', 900, 0.2); ctx.globalAlpha = 1;
      }
    }
    stats() { return { left: this.left.length, chain: this.bestChain, balls: this.balls.length }; }
  }

  SB.modes.register({
    id: 'chain', name: 'Chain Reaction', icon: '💥', category: 'Satisfying', tagline: 'Balls vs a numbered brick board — TNT chains and multiball',
    hook: 'Watch the *chain reaction*',
    hookY: 170,
    settings: [
      { key: 'shape', label: 'Board shape', type: 'select', def: 'full', options: [['full', 'Full grid'], ['pyramid', 'Pyramid'], ['diamond', 'Diamond'], ['heart', 'Heart'], ['rings', 'Rings'], ['checker', 'Checker'], ['random', 'Random holes']], rand: ['full', 'pyramid', 'diamond', 'heart', 'rings', 'random'] },
      { key: 'cols', label: 'Columns', type: 'range', min: 5, max: 14, step: 1, def: 9, rand: [8, 11] },
      { key: 'rows', label: 'Rows', type: 'range', min: 4, max: 18, step: 1, def: 11, rand: [9, 14] },
      { key: 'boardH', label: 'Board height', type: 'range', min: 400, max: 820, step: 10, def: 700, rand: [640, 760] },
      { key: 'maxHp', label: 'Brick HP (top row)', type: 'range', min: 1, max: 99, step: 1, def: 20, rand: [10, 40] },
      { key: 'tnt', label: 'TNT density', type: 'range', min: 0, max: 0.4, step: 0.01, def: 0.1, rand: [0.06, 0.16] },
      { key: 'multi', label: '+1 ball bricks', type: 'range', min: 0, max: 0.2, step: 0.01, def: 0.05, rand: [0.03, 0.08] },
      { key: 'blast', label: 'TNT blast radius (cells)', type: 'range', min: 1, max: 3, step: 0.1, def: 1.5, rand: [1.2, 2] },
      { key: 'tntDmg', label: 'TNT damage', type: 'range', min: 1, max: 100, step: 1, def: 30, rand: [20, 40] },
      { key: 'balls', label: 'Starting balls', type: 'range', min: 1, max: 10, step: 1, def: 2, rand: [1, 3] },
      { key: 'maxBalls', label: 'Max balls', type: 'range', min: 1, max: 60, step: 1, def: 24, rand: [16, 30] },
      { key: 'dmg', label: 'Damage per hit', type: 'range', min: 1, max: 10, step: 1, def: 1, rand: [1, 1] },
      { key: 'speed', label: 'Ball speed', type: 'range', min: 300, max: 2000, step: 10, def: 1000, rand: [850, 1250] },
      { key: 'ballSize', label: 'Ball size', type: 'range', min: 8, max: 40, step: 1, def: 16, rand: [13, 20] },
      { key: 'ballCollide', label: 'Balls collide', type: 'toggle', def: false, rand: false },
      { key: 'ballColor', label: 'First ball colour', type: 'color', def: '' },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Classic Board', s: {} },
      { name: 'TNT Heaven', s: { tnt: 0.3, blast: 1.6, multi: 0.03 } },
      { name: 'Heart Breaker', s: { shape: 'heart', cols: 11, rows: 12, tnt: 0.12 } },
      { name: 'Pyramid Multiball', s: { shape: 'pyramid', multi: 0.12, maxBalls: 50, balls: 1 } },
      { name: 'Big Numbers (99)', s: { maxHp: 99, cols: 7, rows: 9, tnt: 0.14, balls: 3 } },
      { name: 'Tiny Bricks Chaos', s: { cols: 14, rows: 18, maxHp: 6, tnt: 0.12, ballSize: 10, speed: 1400 } },
    ],
    create: (g, s) => new Chain(g, s),
  });
})(window.SB);
