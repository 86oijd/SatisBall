/* Mode: Boss Fight — a squad of ability heroes vs one giant boss with 3 phases:
 * bullet rings -> dash + minions -> FINAL FORM bullet spirals. Heroes win if the boss drops, the boss wins if nobody is left. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, mix, darken, lighten } = SB.util;
  const Brawl = SB.Brawl, draw = SB.draw, P = SB.phys;
  const NAMES = ['KING GOO', 'THE VOID', 'MEGA ORB', 'BIG BERTHA', 'OVERLORD', 'THE MOON', 'GIGA BALL', 'DOOM SPHERE'];

  class BossFight extends SB.Mode {
    init() {
      const s = this.s, g = this.g;
      this.cy = 1170;
      this.arena = new SB.Arena({ cx: 540, cy: this.cy, R: s.arenaSize, shape: s.shape, spin: 0 });
      this.brawl = new Brawl(this, { arena: this.arena, speed: s.speed, damage: 1, onKill: (t, by) => this.onKill(t, by) });
      const n = s.heroes;
      const abs = Brawl.pickAbilities(this.rng, n, []);
      const cols = this.distinctColors(n + 1, 10);
      this.bossName = (s.bossName || '').trim().toUpperCase().slice(0, 14) || this.rng.pick(NAMES);
      const bossCol = s.bossColor || '#ff3d5a';
      this.boss = this.brawl.add({ x: 540, y: this.cy - 80, r: s.bossSize, color: bossCol, name: this.bossName, ab: 'none', hp: s.bossHp, team: 99, boss: true, massK: 7, speed: s.speed * 0.5 });
      this.boss.r0 = s.bossSize;
      this.heroes = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (i - (n - 1) / 2) * (1.9 / Math.max(1, n - 1));
        const col = this.color(cols[i + 1]) === bossCol ? this.color(cols[0]) : this.color(cols[i + 1]);
        const f = this.brawl.add({ x: 540 + Math.cos(a) * s.arenaSize * 0.62, y: this.cy + Math.sin(a) * s.arenaSize * 0.62, r: s.heroSize, color: col, name: Brawl.AB[abs[i]].name, ab: abs[i], hp: s.heroHp, team: 1, dir: -Math.PI / 2 + this.rng.range(-0.8, 0.8) });
        this.heroes.push(f);
      }
      // scripted-but-fair pacing: pick who the fight leans towards (seeded) and steer HP towards it
      this.script = s.winner === 'random' ? (this.rng.chance(0.62) ? 'heroes' : 'boss') : s.winner;
      this.heroMul = 1; this.bossMul = 1;
      this.brawl.mulFor = (t) => {
        if (s.assist && this.g.state === 'play') {
          // clutch guard: the side the fight leans towards can't be finished off first
          if (t.boss && this.script === 'boss' && t.hp < t.maxHp * 0.1 && this.heroesAlive().length) return 0;
          if (!t.boss && !t.owner && this.script === 'heroes' && this.heroesAlive().length === 1 && t.hp < t.maxHp * 0.15 && this.boss.hp > this.boss.maxHp * 0.03) return 0;
        }
        return t.boss ? this.heroMul * s.damage : this.bossMul * s.damage;
      };
      this.phase = 1; this.atkT = 2.2; this.dash = null; this.spiral = 0; this.spiralA = 0; this.minionT = 5;
      this.bullets = [];
      this.trailLen = 9;
    }
    roster() { return [{ name: this.bossName, color: this.boss.color, label: 'BOSS · ' + this.s.bossHp + ' HP' }].concat(this.heroes.map((f) => ({ name: f.A.name, color: f.color, label: f.A.desc }))); }
    trailBalls() { return this.brawl.fighters.concat(this.brawl.minions); }
    heroesAlive() { return this.heroes.filter((f) => f.alive); }
    heroHp() { return this.heroes.reduce((a, f) => a + Math.max(0, f.hp), 0) / this.heroes.reduce((a, f) => a + f.maxHp, 0); }
    onKill(t, by) {
      const g = this.g, b = this.boss;
      if (t === b) {
        // boss explodes in stages
        for (let i = 0; i < 4; i++) this.fx.burst(b.x + this.rng.range(-60, 60), b.y + this.rng.range(-60, 60), i % 2 ? '#ffffff' : b.color, 60, 1400);
        this.fx.debris(b.x, b.y, b.r * 1.4, b.r * 1.4, b.color, 30, { power: 2 });
        this.fx.shockwave(b.x, b.y, '#ffffff', 900);
        this.snd.sfx('explode', 1, 0); this.snd.sfx('roar', 0.6, 0, 0.7);
        for (const q of this.brawl.minions) if (q.alive) this.brawl.kill(q);
        this.bullets.length = 0;
        const fin = by && !by.boss ? by : this.heroesAlive()[0];
        const left = this.heroesAlive().length;
        g.win({ title: 'THE HEROES WIN!', sub: `${fin ? fin.A.name + ' landed the final blow · ' : ''}${left}/${this.heroes.length} survived`, color: fin ? fin.color : '#ffd23f', y: 780, fx: b.x, fy: b.y, zoom: 1.2 });
        return;
      }
      if (t.boss || t.owner) return;
      const left = this.heroesAlive();
      if (!left.length) {
        g.win({ title: `${this.bossName} WINS`, sub: `nobody survived · who should fight it next?`, color: b.color, y: 780, fx: b.x, fy: b.y, crown: false });
        this.snd.sfx('roar', 0.9, 0);
        return;
      }
      g.moment({ x: t.x, y: t.y, zoom: 1.12, slow: 0.4, dur: 0.6 });
      this.fx.banner(`${t.A.name} IS DOWN`, t.color, { size: 62, y: 0.5, sub: `${left.length} hero${left.length > 1 ? 'es' : ''} left`, dur: 1.3 });
      if (left.length === 1) this.fx.banner(`${left[0].A.name} IS THE LAST HOPE`, left[0].color, { size: 52, y: 0.33, dur: 1.6 });
    }
    setPhase(p) {
      const g = this.g, b = this.boss;
      this.phase = p;
      g.hitstop(0.12);
      g.moment({ x: b.x, y: b.y, zoom: 1.2, slow: 0.35, dur: 1 });
      this.fx.flash(b.color, 0.45); g.shake(0.8);
      this.fx.shockwave(b.x, b.y, b.color, 700);
      this.snd.sfx('roar', 1, 0, p === 3 ? 0.8 : 1); this.snd.sfx('subdrop', 0.7, 0);
      this.fx.banner(p === 2 ? 'PHASE 2' : 'FINAL FORM', b.color, { size: 96, y: 0.5, sub: p === 2 ? 'it charges and summons minions' : 'bullet hell. good luck.', dur: 1.8 });
      // knock everyone back
      for (const f of this.heroesAlive()) { const dx = f.x - b.x, dy = f.y - b.y, d = Math.hypot(dx, dy) || 1; f.vx = dx / d * f.speed; f.vy = dy / d * f.speed; }
      this.bullets.length = 0; this.atkT = 1.4; this.dash = null;
      if (p === 3) { b.r = b.r0 * 1.15; b.m = b.r * b.r * 7; b.baseSpeed *= 1.25; }
    }
    fire(n, speed, off = 0, r = 13) {
      const b = this.boss;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU;
        this.bullets.push({ x: b.x + Math.cos(a) * (b.r + 8), y: b.y + Math.sin(a) * (b.r + 8), vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r, alive: true, hero: null, t: 0 });
      }
    }
    attacks(dt) {
      const s = this.s, g = this.g, b = this.boss, B = this.brawl;
      const agg = s.aggression;
      this.atkT -= dt * agg;
      if (this.dash) {
        const d = this.dash; d.t += dt;
        if (d.state === 'aim' && d.t > 0.65) { d.state = 'go'; d.t = 0; b.vx = Math.cos(d.a) * 10; b.vy = Math.sin(d.a) * 10; b.speedMul = 3.2; this.snd.sfx('whoosh', 0.8, g.pan(b.x), 0.7); g.shake(0.2); }
        else if (d.state === 'go' && d.t > 0.5) { b.speedMul = 1; this.dash = null; }
      }
      if (this.spiral > 0) {
        this.spiral -= dt; this.spiralT = (this.spiralT || 0) - dt;
        if (this.spiralT <= 0) { this.spiralT = 0.09; this.spiralA += 0.37; this.fire(3, 400, this.spiralA, 12); this.snd.sfx('tick', 0.25, g.pan(b.x), 1.6); }
      }
      if (this.phase >= 2) {
        this.minionT -= dt * agg;
        if (this.minionT <= 0) { this.minionT = 6.5; if (B.minions.filter((q) => q.alive).length < 4) { B.spawnMinion(b); B.spawnMinion(b); this.fx.popup(b.x, b.y - b.r - 40, 'MINIONS!', b.color, 44); } }
      }
      if (this.atkT > 0 || this.dash) return;
      const roll = this.rng.next();
      if (this.phase === 1 || roll < 0.4) {
        const n = this.phase === 3 ? 18 : this.phase === 2 ? 14 : 11;
        this.fire(n, this.phase === 3 ? 430 : 360, this.rng.range(0, TAU));
        if (this.phase >= 2) this.fire(n, 300, this.rng.range(0, TAU));
        this.snd.sfx('zap', 0.6, g.pan(b.x), 0.7); this.fx.ring(b.x, b.y, b.color, b.r * 2.4, 0.4, 10);
        this.atkT = this.phase === 3 ? 2 : 2.8;
      } else if (this.phase === 3 && roll > 0.7) {
        this.spiral = 1.8; this.spiralT = 0; this.snd.sfx('charge', 0.6, g.pan(b.x), 0.8);
        this.fx.popup(b.x, b.y - b.r - 40, 'SPIRAL!', '#ffffff', 50);
        this.atkT = 3.2;
      } else {
        const t = B.nearestEnemy(b);
        if (t) {
          this.dash = { state: 'aim', t: 0, a: Math.atan2(t.y - b.y, t.x - b.x) };
          b.speedMul = 0.2; this.snd.sfx('charge', 0.55, g.pan(b.x), 1.1);
        }
        this.atkT = 2.4;
      }
    }
    bulletsUpdate(dt) {
      const B = this.brawl, g = this.g, b = this.boss;
      for (const u of this.bullets) {
        if (!u.alive) continue;
        u.t += dt; u.x += u.vx * dt; u.y += u.vy * dt;
        if (!this.arena.contains(u.x, u.y, -u.r)) { u.alive = false; if (this.rng.chance(0.3)) this.fx.burst(u.x, u.y, u.hero ? u.hero.color : b.color, 3, 150); continue; }
        if (u.hero) {
          if (b.alive && Math.hypot(u.x - b.x, u.y - b.y) < b.r + u.r) { u.alive = false; B.damage(b, 6, u.hero, u.x, u.y, 'blade', { noCrit: true }); }
          continue;
        }
        for (const f of this.heroes) {
          if (!f.alive) continue;
          if (f.ab === 'shield' && B.shieldBlocks(f, u.x, u.y) && Math.hypot(u.x - f.x, u.y - f.y) < f.r + 30) {
            // reflected bullets turn on the boss
            const dx = b.x - u.x, dy = b.y - u.y, d = Math.hypot(dx, dy) || 1, sp = Math.hypot(u.vx, u.vy) * 1.4;
            u.vx = dx / d * sp; u.vy = dy / d * sp; u.hero = f; B.clash(u.x, u.y, f.color); break;
          }
          if (f.ab === 'sword') {
            let cut = false;
            for (let k = 0; k < f.blades; k++) { const sg = Brawl.AB.sword.blade(f, k); if (P.segment(u, sg[0], sg[1], sg[2], sg[3], 6)) { cut = true; break; } }
            if (cut) { u.alive = false; this.fx.burst(u.x, u.y, '#ffffff', 5, 300); this.snd.sfx('clang', 0.3, g.pan(u.x), 1.4); break; }
          }
          if (Math.hypot(u.x - f.x, u.y - f.y) < f.r + u.r) { u.alive = false; B.damage(f, 5, b, u.x, u.y, 'body', { noCrit: true }); break; }
        }
      }
      this.bullets = this.bullets.filter((u) => u.alive);
    }
    update(dt) {
      const s = this.s, g = this.g, B = this.brawl, b = this.boss;
      const bk = b.hp / b.maxHp, hk = this.heroHp();
      g.tension = clamp(1 - Math.min(bk, hk) * 0.8 + (this.phase - 1) * 0.15, 0, 1);
      g.danger = g.state === 'play' && (this.heroesAlive().length === 1 || bk < 0.1) ? 0.22 : 0;
      if (g.state === 'play') {
        if (this.phase === 1 && bk < 0.66) this.setPhase(2);
        else if (this.phase === 2 && bk < 0.33) this.setPhase(3);
        if (s.assist) {
          const T = g.targetLen, t = g.time;
          const lin = clamp(t / (T * 0.9), 0, 1), lose = 1 - lin, win = 1 - 0.72 * lin;
          const expBoss = this.script === 'heroes' ? lose : win, expHero = this.script === 'boss' ? lose : win;
          const adj = (mul, cur, exp) => (cur < exp - 0.08 ? Math.max(0.25, mul * (1 - dt * 0.9)) : cur > exp + 0.06 ? Math.min(6, mul * (1 + dt * 0.6)) : mul);
          this.heroMul = adj(this.heroMul, bk, expBoss);
          this.bossMul = adj(this.bossMul, hk, expHero);
          // the leaning side must stay ahead in the race to zero
          if (this.script === 'heroes' && hk < bk + 0.12) this.bossMul = Math.max(0.2, this.bossMul * (1 - dt * 3));
          if (this.script === 'boss' && bk < hk + 0.12) this.heroMul = Math.max(0.2, this.heroMul * (1 - dt * 3));
          if (t > T * 1.05) { if (this.script === 'heroes') this.heroMul = Math.min(10, this.heroMul * (1 + dt * 0.5)); else this.bossMul = Math.min(10, this.bossMul * (1 + dt * 0.5)); }
        }
        if (b.alive) this.attacks(dt);
        // overtime: the side that should win starts hunting (no minion walls, gentle homing)
        if (s.assist && g.time > g.targetLen * 0.95 && b.alive) {
          const steer = (f, tx, ty, k) => { const want = Math.atan2(ty - f.y, tx - f.x), cur = Math.atan2(f.vy, f.vx), a = cur + clamp(SB.util.angleDiff(cur, want), -k * dt, k * dt), sp = f.speed; f.vx = Math.cos(a) * sp; f.vy = Math.sin(a) * sp; };
          if (this.script === 'heroes') {
            this.minionT = 99;
            for (const q of B.minions) if (q.alive) { q.hp -= dt * 6; if (q.hp <= 0) B.kill(q); }
            for (const f of this.heroesAlive()) steer(f, b.x, b.y, 1.6);
          } else if (!this.dash) { const t = B.nearestEnemy(b); if (t) steer(b, t.x, t.y, 1.4); }
        }
      }
      B.update(dt);
      this.bulletsUpdate(dt);
    }
    forceEnd() { if (this.script === 'boss') this.bossMul = 20; else this.heroMul = 20; }
    audit() { const v = []; for (const f of this.brawl.alive()) if (this.arena.audit(f)) v.push('ball outside arena'); return v; }
    render(ctx) {
      const pal = this.pal, A = this.arena, b = this.boss, g = this.g;
      A.path(ctx, 0); ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)'; ctx.fill();
      ctx.lineJoin = 'round';
      A.path(ctx, 6); ctx.lineWidth = 12;
      ctx.strokeStyle = this.phase === 3 ? mix(b.color, '#ffffff', 0.3 + 0.3 * Math.sin(g.clock * 8)) : (pal.light ? 'rgba(40,20,60,0.35)' : 'rgba(255,255,255,0.35)'); ctx.stroke();
      // dash telegraph
      if (this.dash && this.dash.state === 'aim' && b.alive) {
        ctx.save(); ctx.setLineDash([22, 16]); ctx.lineDashOffset = -g.clock * 260; ctx.strokeStyle = rgba(b.color, 0.5 + 0.4 * Math.sin(g.clock * 30)); ctx.lineWidth = b.r * 0.9; ctx.lineCap = 'round';
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(this.dash.a) * 900, b.y + Math.sin(this.dash.a) * 900); ctx.stroke(); ctx.restore();
      }
      this.brawl.render(ctx, { noBossHp: true, tagSize: 24, drawFighter: (c, f) => (f.boss ? this.drawBoss(c, f) : draw.ball(c, f, this.look)) });
      // bullets
      ctx.save();
      if (!this.look.light) ctx.globalCompositeOperation = 'lighter';
      for (const u of this.bullets) { const col = u.hero ? u.hero.color : b.color; draw.glow(ctx, u.x, u.y, u.r * 3.2, col, 0.5); }
      ctx.globalCompositeOperation = 'source-over';
      for (const u of this.bullets) { ctx.fillStyle = u.hero ? u.hero.color : lighten(b.color, 0.35); ctx.beginPath(); ctx.arc(u.x, u.y, u.r, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(u.x, u.y, u.r * 0.45, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    drawBoss(ctx, f) {
      const g = this.g, t = g.clock, look = this.look;
      if (!look.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, f.x, f.y, f.r * (this.phase === 3 ? 3.6 : 2.6), f.color, 0.3 + (this.phase === 3 ? 0.2 * Math.sin(t * 10) : 0)); ctx.globalCompositeOperation = 'source-over'; }
      // horns
      ctx.fillStyle = darken(f.color, 0.35);
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(f.x + s * f.r * 0.45, f.y - f.r * 0.8); ctx.lineTo(f.x + s * f.r * (this.phase === 3 ? 1.05 : 0.85), f.y - f.r * (this.phase === 3 ? 1.55 : 1.3)); ctx.lineTo(f.x + s * f.r * 0.8, f.y - f.r * 0.5); ctx.closePath(); ctx.fill(); }
      const wob = 1 + 0.03 * Math.sin(t * 7);
      const r0 = f.r; f.r = r0 * wob; draw.ball(ctx, f, look); f.r = r0;
      // angry eyes that track the nearest hero
      const tgt = this.brawl.nearestEnemy(f);
      const la = tgt ? Math.atan2(tgt.y - f.y, tgt.x - f.x) : Math.PI / 2;
      for (const s of [-1, 1]) {
        const ex = f.x + s * f.r * 0.36, ey = f.y - f.r * 0.12, er = f.r * 0.2;
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fill();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex + Math.cos(la) * er * 0.45, ey + Math.sin(la) * er * 0.45, er * 0.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#111'; ctx.lineWidth = f.r * 0.09; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ex - s * er * 1.2, ey - er * 1.5); ctx.lineTo(ex + s * er * 0.9, ey - er * 0.9); ctx.stroke();
      }
      ctx.strokeStyle = '#111'; ctx.lineWidth = f.r * 0.08;
      ctx.beginPath(); ctx.arc(f.x, f.y + f.r * 0.55, f.r * 0.3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      if (f.hitT > 0) { ctx.globalAlpha = f.hitT * 2; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    }
    hud(ctx) {
      const pal = this.pal, W = this.W, b = this.boss;
      const slide = SB.util.easeOutCubic(clamp((this.g.clock - this.g.playStart) / 0.5, 0, 1));
      const y = 318 - (1 - slide) * 200;
      // boss bar
      draw.panel(ctx, 40, y, W - 80, 104, 24, this.look, 0.7);
      draw.font(ctx, 40, 900); ctx.fillStyle = pal.light ? darken(b.color, 0.2) : b.color; ctx.fillText(this.bossName, 66, y + 46);
      draw.font(ctx, 24, 800, 'Space Grotesk'); ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.textAlign = 'right';
      ctx.fillText(b.alive ? `PHASE ${this.phase}/3 · ${Math.max(0, Math.ceil(b.hp))} HP` : 'DEFEATED', W - 66, y + 42); ctx.textAlign = 'left';
      const bx = 66, bw = W - 132, by = y + 62, bh = 24;
      draw.roundRect(ctx, bx, by, bw, bh, 12); ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.12)'; ctx.fill();
      const kl = clamp(b.lagHp / b.maxHp, 0, 1), k = clamp(b.shownHp / b.maxHp, 0, 1);
      if (kl > k) { draw.roundRect(ctx, bx, by, Math.max(bh, bw * kl), bh, 12); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill(); }
      if (k > 0) { draw.roundRect(ctx, bx, by, Math.max(bh, bw * k), bh, 12); ctx.fillStyle = mix(b.color, '#ffffff', b.hitT * 1.5); ctx.fill(); }
      ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.4)' : 'rgba(0,0,0,0.45)';
      for (const m of [0.33, 0.66]) ctx.fillRect(bx + bw * m - 2, by - 3, 4, bh + 6);
      // hero chips
      const n = this.heroes.length, gap = 12, cw = Math.min(250, (W - 80 - gap * (n - 1)) / n), x0 = W / 2 - (cw * n + gap * (n - 1)) / 2, hy = y + 118;
      this.heroes.forEach((f, i) => {
        const x = x0 + i * (cw + gap);
        ctx.globalAlpha = f.alive ? 1 : 0.4;
        draw.panel(ctx, x, hy, cw, 74, 18, this.look, 0.62);
        ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(x + 34, hy + 37, 22, 0, TAU); ctx.fill();
        Brawl.glyph(ctx, f.ab, x + 34, hy + 37, 24, '#ffffff');
        let fs = cw > 180 ? 22 : 17; draw.font(ctx, fs, 900); while (ctx.measureText(f.A.name).width > cw - 76 && fs > 11) { fs--; draw.font(ctx, fs, 900); }
        ctx.fillStyle = pal.light ? darken(f.color, 0.25) : f.color; ctx.fillText(f.A.name, x + 64, hy + 32);
        const hbw = cw - 78, hk = clamp(f.shownHp / f.maxHp, 0, 1);
        draw.roundRect(ctx, x + 64, hy + 44, hbw, 12, 6); ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.14)'; ctx.fill();
        if (hk > 0) { draw.roundRect(ctx, x + 64, hy + 44, Math.max(12, hbw * hk), 12, 6); ctx.fillStyle = hk < 0.3 ? '#ff3d5a' : f.color; ctx.fill(); }
        if (!f.alive) { draw.font(ctx, 28, 900); ctx.fillStyle = '#ff3d5a'; ctx.textAlign = 'center'; ctx.fillText('KO', x + cw / 2, hy + 48); ctx.textAlign = 'left'; }
        ctx.globalAlpha = 1;
      });
    }
    stats() { return { script: this.script, boss: Math.ceil(this.boss.hp), heroes: this.heroesAlive().length }; }
  }

  SB.modes.register({
    id: 'boss', name: 'Boss Fight', icon: '👹', category: 'Battles', tagline: 'A hero squad vs one giant 3-phase boss — can they take it down?',
    hook: 'Can they beat the *boss?*',
    hookY: 185,
    settings: [
      { key: 'heroes', label: 'Heroes', type: 'range', min: 1, max: 6, step: 1, def: 4, rand: [3, 5] },
      { key: 'bossHp', label: 'Boss HP', type: 'range', min: 100, max: 3000, step: 50, def: 900, rand: [700, 1400] },
      { key: 'heroHp', label: 'Hero HP', type: 'range', min: 20, max: 300, step: 10, def: 80, rand: [60, 110] },
      { key: 'winner', label: 'Who should win', type: 'select', def: 'random', options: [['random', 'Random (seeded)'], ['heroes', 'Heroes'], ['boss', 'Boss']], rand: ['random'] },
      { key: 'aggression', label: 'Boss aggression', type: 'range', min: 0.4, max: 2, step: 0.05, def: 1, rand: [0.8, 1.3] },
      { key: 'bossName', label: 'Boss name (blank = random)', type: 'text', def: '' },
      { key: 'bossColor', label: 'Boss colour', type: 'color', def: '#ff3d5a' },
      { key: 'bossSize', label: 'Boss size', type: 'range', min: 70, max: 160, step: 1, def: 108, rand: [95, 125] },
      { key: 'heroSize', label: 'Hero size', type: 'range', min: 26, max: 60, step: 1, def: 40, rand: [36, 46] },
      { key: 'damage', label: 'Damage multiplier', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1, rand: [1, 1] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1000, step: 10, def: 500, rand: [440, 580] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(), rand: ['circle', 'circle', 'octagon'] },
      { key: 'arenaSize', label: 'Arena size', type: 'range', min: 380, max: 520, step: 5, def: 480, rand: [460, 500] },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: '4 Heroes vs Boss', s: { heroes: 4 } },
      { name: 'Solo Hero', s: { heroes: 1, heroHp: 200, bossHp: 600 } },
      { name: 'Six-Hero Raid', s: { heroes: 6, bossHp: 1600, heroHp: 60 } },
      { name: 'The Boss Always Wins', s: { winner: 'boss', aggression: 1.4 }, text: { hooks: { boss: 'Nobody can beat *this boss*' } } },
      { name: 'Void Boss (dark)', s: { bossName: 'THE VOID', bossColor: '#9b5cff' }, look: { bg: 'stars' } },
    ],
    create: (g, s) => new BossFight(g, s),
  });
})(window.SB);
