/* Mode: Army Clash — 2 to 4 colour armies spawn hundreds of units from their bases. Units that meet
 * an enemy pop together; units that reach an enemy base chip its HP. Moving x2/x3 rings multiply units.
 * A fallen base's army converts to the attacker. Last base standing wins. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, lighten, darken, mix, easeOutBack } = SB.util;
  const P = SB.phys, draw = SB.draw;
  const BOX = { x0: 40, x1: 1040, y0: 470, y1: 1790 };
  const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; };

  class Army extends SB.Mode {
    init() {
      const s = this.s, n = s.armies;
      const cols = this.distinctColors(n, 10);
      const mx = (BOX.x0 + BOX.x1) / 2, my = (BOX.y0 + BOX.y1) / 2, px = 150, py = 150;
      const spots = n === 2 ? [[mx, BOX.y0 + py], [mx, BOX.y1 - py]]
        : n === 3 ? [[mx, BOX.y0 + py], [BOX.x0 + px, BOX.y1 - py], [BOX.x1 - px, BOX.y1 - py]]
          : [[BOX.x0 + px, BOX.y0 + py], [BOX.x1 - px, BOX.y0 + py], [BOX.x1 - px, BOX.y1 - py], [BOX.x0 + px, BOX.y1 - py]];
      this.armies = spots.map(([x, y], t) => ({ t, x, y, r: 64, color: this.color(cols[t]), name: this.cname(cols[t]), hp: s.baseHp, maxHp: s.baseHp, shownHp: s.baseHp, alive: true, spawnT: 0.2 + t * 0.07, units: 0, kills: 0, flash: 0, owner: t }));
      this.units = [];
      this.grid = new P.Grid(BOX.x0, BOX.y0, BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, 24);
      this.rings = [];
      for (let i = 0; i < s.rings; i++) {
        const y = n === 2 ? my + (i - (s.rings - 1) / 2) * 190 : my + (i - (s.rings - 1) / 2) * 220;
        this.rings.push({ i, x: mx, y, r: 70, mult: s.ringMult === 'mix' ? (i % 2 ? 3 : 2) : +s.ringMult, ph: this.rng.range(0, TAU), sp: this.rng.range(0.5, 0.9) * (i % 2 ? -1 : 1), flash: 0 });
      }
      this.decals = []; this.dn = 0;
      this.dmgMul = 1; this.rate = 1; this.trailLen = 0;
      this.uid = 0;
    }
    roster() { return this.armies.map((a) => ({ name: a.name + ' ARMY', color: a.color })); }
    trailBalls() { return null; }
    aliveArmies() { return this.armies.filter((a) => a.alive); }
    spawn(a, x, y, dir, team) {
      if (this.units.length >= this.s.maxUnits) return null;
      const u = { x, y, vx: Math.cos(dir) * this.s.speed, vy: Math.sin(dir) * this.s.speed, r: this.s.unitSize, team, alive: true, id: this.uid++, passed: 0, m: 1, wob: this.rng.range(0, TAU), tg: null };
      u.tg = this.pickTarget(u);
      this.units.push(u);
      return u;
    }
    /** Each unit picks an enemy base: closer and weaker bases are more attractive (spreads the attack). */
    pickTarget(u) {
      const opts = this.armies.filter((a) => a.alive && a.owner !== u.team);
      if (!opts.length) return null;
      const w = opts.map((a) => (1 / (Math.hypot(a.x - u.x, a.y - u.y) + 200)) * (1.6 - a.hp / a.maxHp));
      let r = this.rng.next() * w.reduce((x, y) => x + y, 0);
      for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
      return opts[opts.length - 1];
    }
    target(u) {
      if (!u.tg || !u.tg.alive || u.tg.owner === u.team) u.tg = this.pickTarget(u);
      return u.tg;
    }
    decal(x, y, team, r) { if (this.decals.length < 30000) this.decals.push({ x, y, team, r, n: this.dn++ }); }
    pop(u, other) {
      u.alive = false;
      this.decal(u.x, u.y, u.team, u.r * 1.3);
      if (this.rng.chance(0.35)) this.fx.burst(u.x, u.y, this.armies[u.team].color, 3, 250, { grav: 0, life: 0.4 });
      void other;
    }
    hitBase(u, a) {
      const g = this.g;
      u.alive = false;
      a.hp -= this.dmgMul; a.flash = 1;
      this.decal(u.x, u.y, u.team, u.r * 1.6);
      const att = this.armies[u.team];
      if (g.clock - (a.hitSnd || -9) > 0.06) { a.hitSnd = g.clock; this.note(0.55, a.x); this.snd.sfx('thud', 0.45, g.pan(a.x), 1 + this.rng.range(-0.1, 0.1)); }
      this.fx.burst(u.x, u.y, att.color, 4, 300, { grav: 0 });
      if (a.hp <= 0) this.baseDown(a, att);
    }
    baseDown(a, by) {
      const g = this.g;
      a.alive = false; a.hp = 0;
      this.fx.burst(a.x, a.y, a.color, 80, 1300, { colors: [a.color, '#ffffff', by.color] });
      this.fx.shockwave(a.x, a.y, by.color, 700); this.fx.debris(a.x, a.y, 120, 120, a.color, 20, { power: 1.6 });
      this.snd.sfx('explode', 1, g.pan(a.x)); this.snd.sfx('crush', 0.7, g.pan(a.x));
      g.shake(0.7);
      // the fallen army converts to the attacker
      let conv = 0;
      for (const u of this.units) if (u.alive && u.team === a.t) { u.team = by.t; conv++; }
      for (const o of this.armies) if (o.owner === a.t) o.owner = by.t;
      a.owner = by.t;
      const left = this.aliveArmies();
      if (left.length === 1) {
        const w = left[0];
        g.win({ title: `${w.name} ARMY WINS!`, sub: `${this.units.filter((u) => u.alive && u.team === w.t).length} units standing · ${w.kills} kills`, color: w.color, y: 760, fx: a.x, fy: a.y });
        return;
      }
      g.moment({ x: a.x, y: a.y, zoom: 1.15, slow: 0.3, dur: 0.9, flash: by.color, flashA: 0.2 });
      this.fx.banner(`${a.name} BASE DESTROYED`, a.color, { size: 64, y: 0.4, sub: conv ? `${conv} units join ${by.name}!` : '', dur: 1.6 });
    }
    update(dt) {
      const s = this.s, g = this.g, T = g.targetLen;
      const alive = this.aliveArmies();
      const low = alive.length ? Math.min(...alive.map((a) => a.hp / a.maxHp)) : 1;
      g.tension = clamp(1 - low + (this.armies.length - alive.length) * 0.2, 0, 1);
      g.danger = alive.length === 2 && low < 0.15 && g.state === 'play' ? 0.2 : 0;
      if (s.assist && g.state === 'play') {
        // progress = eliminations so far + how far the weakest base is gone, over the eliminations needed
        // progress = total base damage dealt, over the HP of the N-1 bases that must fall
        // (the healthiest base is the likely winner, so its damage doesn't count)
        const N = this.armies.length, dmg = this.armies.map((a) => 1 - Math.max(0, a.hp) / a.maxHp).sort((x, y) => y - x);
        const prog = clamp(dmg.slice(0, N - 1).reduce((x, y) => x + y, 0) / (N - 1), 0, 1);
        const exp = clamp((g.time - T * 0.12) / (T * 0.74), 0, 1);
        if (prog < exp - 0.05) this.dmgMul = Math.min(g.time > T ? 14 : 5, this.dmgMul * (1 + dt * (g.time > T ? 0.8 : 0.4)));
        else if (prog > exp + 0.05) this.dmgMul = Math.max(low < 0.25 ? 0.6 : 0.08, this.dmgMul * (1 - dt * 2.5));
      }
      this.rate = 1 + s.rampUp * clamp(g.time / T, 0, 1.5);
      // spawning
      if (g.state === 'play') for (const a of alive) {
        a.spawnT -= dt * this.rate;
        while (a.spawnT <= 0) {
          a.spawnT += 1 / s.spawnRate;
          for (let k = 0; k < s.burst; k++) {
            const tg = this.pickTarget({ x: a.x, y: a.y, team: a.owner });
            const d = (tg ? Math.atan2(tg.y - a.y, tg.x - a.x) : this.rng.range(0, TAU)) + this.rng.range(-0.9, 0.9);
            const u = this.spawn(a, a.x + Math.cos(d) * (a.r + 12), a.y + Math.sin(d) * (a.r + 12), d, a.owner);
            if (u && tg) u.tg = tg;
          }
        }
      }
      for (const r of this.rings) { r.x = 540 + Math.sin(g.time * r.sp + r.ph) * 330; r.flash = Math.max(0, r.flash - dt * 4); }
      // move
      const turn = s.steer * dt;
      for (const u of this.units) {
        if (!u.alive) continue;
        const tg = this.target(u);
        if (tg) {
          // aim at a point beside the base (per-unit lane) until close, so streams fan out instead of cancelling head-on
          const dx = tg.x - u.x, dy = tg.y - u.y, d = Math.hypot(dx, dy) || 1, lane = d > 280 ? Math.sin(u.wob) * (this.armies.length === 2 ? 340 : 200) : 0;
          const want = Math.atan2(dy + dx / d * lane, dx - dy / d * lane) + Math.sin(g.time * 2.2 + u.wob) * 0.35;
          const cur = Math.atan2(u.vy, u.vx), a = cur + clamp(SB.util.angleDiff(cur, want), -turn, turn);
          u.vx = Math.cos(a) * s.speed; u.vy = Math.sin(a) * s.speed;
        }
        u.x += u.vx * dt; u.y += u.vy * dt;
        if (u.x < BOX.x0 + u.r) { u.x = BOX.x0 + u.r; u.vx = Math.abs(u.vx); }
        if (u.x > BOX.x1 - u.r) { u.x = BOX.x1 - u.r; u.vx = -Math.abs(u.vx); }
        if (u.y < BOX.y0 + u.r) { u.y = BOX.y0 + u.r; u.vy = Math.abs(u.vy); }
        if (u.y > BOX.y1 - u.r) { u.y = BOX.y1 - u.r; u.vy = -Math.abs(u.vy); }
        // bases: enemy -> damage, own -> bounce off
        for (const a of this.armies) {
          if (!a.alive) continue;
          const dx = u.x - a.x, dy = u.y - a.y, d2 = dx * dx + dy * dy, rr = a.r + u.r;
          if (d2 < rr * rr) {
            if (a.owner !== u.team) { this.hitBase(u, a); break; }
            const d = Math.sqrt(d2) || 1; u.x = a.x + dx / d * rr; u.y = a.y + dy / d * rr;
          }
        }
        // multiplier rings (once per ring per unit)
        if (u.alive) for (const r of this.rings) {
          if (u.passed & (1 << r.i)) continue;
          if ((u.x - r.x) ** 2 + (u.y - r.y) ** 2 < (r.r - 4) ** 2) {
            u.passed |= 1 << r.i; r.flash = 1;
            for (let k = 1; k < r.mult; k++) { const c = this.spawn(null, u.x + this.rng.range(-8, 8), u.y + this.rng.range(-8, 8), Math.atan2(u.vy, u.vx) + this.rng.range(-0.4, 0.4), u.team); if (c) c.passed = u.passed; }
            if (g.clock - (r.snd || -9) > 0.07) { r.snd = g.clock; this.snd.sfx('pickup', 0.25, g.pan(r.x), 1.4 + r.mult * 0.1); }
          }
        }
      }
      // unit vs unit: enemies pop together, friends separate
      const live = this.units.filter((u) => u.alive);
      this.grid.build(live);
      let pops = 0;
      this.grid.pairs(live, (a, b) => {
        if (!a.alive || !b.alive) return;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, rr = a.r + b.r;
        if (d2 >= rr * rr) return;
        if (a.team !== b.team) {
          // a clash: one pops (coin flip), or both on a head-on hit
          if (this.rng.chance(this.s.trade * (g.time > T ? 0.4 : 1))) { this.pop(a, b); this.pop(b, a); this.armies[a.team].kills++; this.armies[b.team].kills++; }
          else if (this.rng.chance(0.5)) { this.pop(a, b); this.armies[b.team].kills++; } else { this.pop(b, a); this.armies[a.team].kills++; }
          pops++; return;
        }
        const d = Math.sqrt(d2) || 0.01, push = (rr - d) / 2, nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      });
      if (pops) {
        this.popAcc = (this.popAcc || 0) + pops;
        if (g.clock - (this.popSnd || -9) > 0.05) { this.popSnd = g.clock; this.snd.sfx('pop', clamp(0.15 + this.popAcc * 0.04, 0.15, 0.6), 0, 1.1 + this.rng.range(-0.15, 0.2)); if (this.popAcc > 2) this.note(clamp(this.popAcc / 12, 0.3, 0.9), 540); this.popAcc = 0; }
      }
      for (const u of live) { if (u.x < BOX.x0 + u.r) u.x = BOX.x0 + u.r; else if (u.x > BOX.x1 - u.r) u.x = BOX.x1 - u.r; if (u.y < BOX.y0 + u.r) u.y = BOX.y0 + u.r; else if (u.y > BOX.y1 - u.r) u.y = BOX.y1 - u.r; }
      if (this.units.length > live.length * 1.5 + 50) this.units = this.units.filter((u) => u.alive);
      for (const a of this.armies) { a.flash = Math.max(0, a.flash - dt * 5); a.shownHp = lerp(a.shownHp, Math.max(0, a.hp), 1 - Math.exp(-dt * 10)); }
      for (const a of this.armies) a.units = 0;
      for (const u of live) if (u.alive) this.armies[u.team].units++;
    }
    forceEnd() { this.dmgMul = 60; }
    audit() {
      const v = [];
      for (const u of this.units) if (u.alive && (u.x < BOX.x0 - 1 || u.x > BOX.x1 + 1 || u.y < BOX.y0 - 1 || u.y > BOX.y1 + 1)) { v.push('unit outside box'); break; }
      if (this.units.filter((u) => u.alive).length > this.s.maxUnits) v.push('unit cap exceeded');
      return v;
    }
    decalLayer() {
      const k = this.g.k;
      if (!this.dc) { this.dc = document.createElement('canvas'); this.dc.width = Math.round(this.W * k); this.dc.height = Math.round(this.H * k); this.dctx = this.dc.getContext('2d'); this.dctx.scale(k, k); }
      const c = this.dctx;
      for (const e of this.decals) {
        c.fillStyle = rgba(this.armies[e.team].color, 0.18 + 0.12 * hash(e.n));
        c.beginPath(); c.arc(e.x + (hash(e.n * 3) - 0.5) * 6, e.y + (hash(e.n * 5) - 0.5) * 6, e.r * (0.8 + 0.6 * hash(e.n * 7)), 0, TAU); c.fill();
      }
      this.decals.length = 0;
      return this.dc;
    }
    render(ctx) {
      const pal = this.pal, g = this.g, t = g.clock;
      ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)';
      draw.roundRect(ctx, BOX.x0, BOX.y0, BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, 26); ctx.fill();
      ctx.drawImage(this.decalLayer(), 0, 0, this.W, this.H);
      ctx.strokeStyle = pal.light ? 'rgba(40,20,60,0.3)' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 6;
      draw.roundRect(ctx, BOX.x0, BOX.y0, BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, 26); ctx.stroke();
      // multiplier rings
      for (const r of this.rings) {
        ctx.save(); ctx.translate(r.x, r.y);
        ctx.strokeStyle = mix('#ffd23f', '#ffffff', r.flash); ctx.lineWidth = 8; ctx.setLineDash([16, 10]); ctx.lineDashOffset = -t * 40;
        ctx.beginPath(); ctx.arc(0, 0, r.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = rgba('#ffd23f', 0.1 + r.flash * 0.15); ctx.beginPath(); ctx.arc(0, 0, r.r, 0, TAU); ctx.fill();
        draw.label(ctx, 'x' + r.mult, 0, 16, 46, '#ffd23f', 900, 0.2);
        ctx.restore();
      }
      // bases
      for (const a of this.armies) {
        if (!a.alive) continue;
        const own = this.armies[a.owner], sh = a.flash * 4;
        const x = a.x + Math.sin(t * 70) * sh, y = a.y;
        if (!this.look.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, x, y, a.r * 3, own.color, 0.35); ctx.globalCompositeOperation = 'source-over'; }
        ctx.fillStyle = darken(own.color, 0.3); draw.roundRect(ctx, x - a.r, y - a.r + 8, a.r * 2, a.r * 2, 18); ctx.fill();
        ctx.fillStyle = mix(own.color, '#ffffff', a.flash * 0.5); draw.roundRect(ctx, x - a.r, y - a.r, a.r * 2, a.r * 2, 18); ctx.fill();
        // battlements
        ctx.fillStyle = darken(own.color, 0.15);
        for (let i = 0; i < 4; i++) ctx.fillRect(x - a.r + 6 + i * (a.r * 2 - 12) / 3.5, y - a.r - 14, (a.r * 2 - 12) / 7, 16);
        draw.label(ctx, String(Math.max(0, Math.ceil(a.hp))), x, y + 14, 40, '#ffffff', 900, 0.2);
      }
      // units, batched per colour
      for (const army of this.armies) {
        ctx.fillStyle = army.color; ctx.beginPath();
        for (const u of this.units) if (u.alive && u.team === army.t) { ctx.moveTo(u.x + u.r, u.y); ctx.arc(u.x, u.y, u.r, 0, TAU); }
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath();
        for (const u of this.units) if (u.alive && u.team === army.t) { ctx.moveTo(u.x - u.r * 0.2, u.y - u.r * 0.35); ctx.arc(u.x - u.r * 0.35, u.y - u.r * 0.35, u.r * 0.35, 0, TAU); }
        ctx.fill();
      }
    }
    hud(ctx) {
      const pal = this.pal, W = this.W, n = this.armies.length;
      const cw = Math.min(480, (W - 60) / Math.min(n, 2) - 12), rows = Math.ceil(n / 2), cols = Math.min(n, 2), ch = 72;
      const x0 = W / 2 - (cw * cols + 12 * (cols - 1)) / 2, y0 = 290;
      this.armies.forEach((a, i) => {
        const x = x0 + (i % cols) * (cw + 12), y = y0 + Math.floor(i / cols) * (ch + 10);
        ctx.globalAlpha = a.alive ? 1 : 0.4;
        draw.panel(ctx, x, y, cw, ch, 18, this.look, 0.64);
        ctx.fillStyle = a.color; draw.roundRect(ctx, x, y, 10, ch, 5); ctx.fill();
        draw.font(ctx, 26, 900); ctx.fillStyle = pal.light ? darken(a.color, 0.2) : a.color; ctx.fillText(a.name, x + 24, y + 32);
        draw.font(ctx, 20, 800, 'Space Grotesk'); ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.textAlign = 'right';
        ctx.fillText(a.alive ? `${a.units} units` : 'DESTROYED', x + cw - 16, y + 30); ctx.textAlign = 'left';
        const bw = cw - 40, k = clamp(a.shownHp / a.maxHp, 0, 1);
        draw.roundRect(ctx, x + 24, y + 46, bw, 12, 6); ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.12)'; ctx.fill();
        if (k > 0) { draw.roundRect(ctx, x + 24, y + 46, Math.max(12, bw * k), 12, 6); ctx.fillStyle = k < 0.25 ? '#ff3d5a' : a.color; ctx.fill(); }
        ctx.globalAlpha = 1;
      });
      void rows;
    }
    stats() { return { bases: this.armies.map((a) => a.name + ':' + Math.ceil(a.hp)), units: this.units.filter((u) => u.alive).length }; }
  }

  SB.modes.register({
    id: 'army', name: 'Army Clash', icon: '⚑', category: 'Territory', tagline: 'Hundreds of colour units storm each other\'s bases — x2 rings multiply them',
    hook: 'Which army *wins?*',
    hookY: 180,
    settings: [
      { key: 'armies', label: 'Armies', type: 'range', min: 2, max: 4, step: 1, def: 2, rand: [2, 4] },
      { key: 'baseHp', label: 'Base HP', type: 'range', min: 20, max: 1000, step: 10, def: 200, rand: [150, 300] },
      { key: 'spawnRate', label: 'Spawns per second', type: 'range', min: 1, max: 20, step: 0.5, def: 8, rand: [6, 10] },
      { key: 'burst', label: 'Units per spawn', type: 'range', min: 1, max: 5, step: 1, def: 2, rand: [1, 3] },
      { key: 'rampUp', label: 'Spawn ramp-up', type: 'range', min: 0, max: 4, step: 0.1, def: 1.5, rand: [1, 2] },
      { key: 'rings', label: 'Multiplier rings', type: 'range', min: 0, max: 4, step: 1, def: 2, rand: [1, 3] },
      { key: 'ringMult', label: 'Ring multiplier', type: 'select', def: 'mix', options: [['2', 'x2'], ['3', 'x3'], ['mix', 'Mix of x2 and x3']], rand: ['2', 'mix'] },
      { key: 'trade', label: 'Both pop on a clash (chance)', type: 'range', min: 0, max: 1, step: 0.05, def: 0.5, rand: [0.3, 0.7] },
      { key: 'speed', label: 'Unit speed', type: 'range', min: 80, max: 600, step: 10, def: 230, rand: [200, 280] },
      { key: 'steer', label: 'Unit steering', type: 'range', min: 0.2, max: 5, step: 0.1, def: 1.8, rand: [1.2, 2.4] },
      { key: 'unitSize', label: 'Unit size', type: 'range', min: 4, max: 16, step: 1, def: 8, rand: [7, 10] },
      { key: 'maxUnits', label: 'Max units', type: 'range', min: 100, max: 1500, step: 50, def: 900, rand: [700, 1000] },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Red vs Blue', s: { armies: 2 } },
      { name: '4-Army War', s: { armies: 4, baseHp: 160, rings: 1 } },
      { name: 'Triple Threat', s: { armies: 3, rings: 2 } },
      { name: 'x3 Swarm', s: { ringMult: '3', rings: 3, spawnRate: 4, maxUnits: 1200 } },
      { name: 'Slow Siege (big bases)', s: { baseHp: 600, speed: 160, spawnRate: 8 } },
    ],
    create: (g, s) => new Army(g, s),
  });
})(window.SB);
