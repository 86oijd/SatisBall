/* Mode: Ball Battles — named fighters with HP and a readable ability fight until one is left. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, mix, lighten, darken, normAngle } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;

  function segSegDist(a, b) {
    // closest distance between segments a=[ax,ay,bx,by], b=[...] ; returns [dist, px, py]
    const [p1x, p1y, q1x, q1y] = a, [p2x, p2y, q2x, q2y] = b;
    const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
    const A = d1x * d1x + d1y * d1y, E = d2x * d2x + d2y * d2y, F = d2x * rx + d2y * ry;
    let s, t;
    const c = d1x * rx + d1y * ry, bb = d1x * d2x + d1y * d2y, den = A * E - bb * bb;
    s = den > 1e-9 ? clamp((bb * F - c * E) / den, 0, 1) : 0;
    t = (bb * s + F) / E;
    if (t < 0) { t = 0; s = clamp(-c / A, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / A, 0, 1); }
    const cx1 = p1x + d1x * s, cy1 = p1y + d1y * s, cx2 = p2x + d2x * t, cy2 = p2y + d2y * t;
    return [Math.hypot(cx1 - cx2, cy1 - cy2), (cx1 + cx2) / 2, (cy1 + cy2) / 2];
  }

  // ------------------------------------------------------------------ abilities
  // Each: name, desc (shown on the HUD card), optional hooks. `m` is the mode.
  const AB = {
    sword: {
      name: 'SWORD', desc: 'Faster every hit',
      init(f) { f.ang = f.mode.rng.range(0, TAU); f.spin = 4.2; f.sdir = 1; f.len = f.r * 1.75; },
      update(f, dt) { f.ang += f.spin * f.sdir * dt; },
      blade(f) { const c = Math.cos(f.ang), s = Math.sin(f.ang); return [f.x + c * (f.r + 2), f.y + s * (f.r + 2), f.x + c * (f.r + f.len), f.y + s * (f.r + f.len)]; },
      dmg: 9,
      onHit(f) { f.spin = Math.min(15, f.spin + 0.9); },
      draw(ctx, f) {
        const [ax, ay, bx, by] = AB.sword.blade(f);
        const nx = -(by - ay) / f.len, ny = (bx - ax) / f.len;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba('#ffffff', 0.18); ctx.lineWidth = 26;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax + nx * 8, ay + ny * 8); ctx.lineTo(bx, by); ctx.lineTo(ax - nx * 8, ay - ny * 8); ctx.closePath();
        const g = ctx.createLinearGradient(ax, ay, bx, by); g.addColorStop(0, '#dfe8ff'); g.addColorStop(1, '#ffffff');
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = f.color; ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(ax + nx * 22, ay + ny * 22); ctx.lineTo(ax - nx * 22, ay - ny * 22); ctx.stroke();
        ctx.restore();
      },
    },
    spikes: {
      name: 'SPIKES', desc: 'Grows every hit',
      init(f) { f.spk = 10; f.spl = f.r * 0.32; f.sa = 0; },
      update(f, dt) { f.sa += dt * 1.5; },
      reach(f) { return f.r + f.spl * 0.85; },
      contact: 7,
      onHit(f) { f.spk = Math.min(22, f.spk + 1); f.spl = Math.min(f.r * 0.95, f.spl + 4); },
      draw(ctx, f) {
        ctx.fillStyle = lighten(f.color, 0.55);
        ctx.beginPath();
        for (let i = 0; i < f.spk; i++) {
          const a = f.sa + (i / f.spk) * TAU, w = Math.PI / f.spk * 0.8;
          ctx.moveTo(f.x + Math.cos(a - w) * (f.r - 2), f.y + Math.sin(a - w) * (f.r - 2));
          ctx.lineTo(f.x + Math.cos(a) * (f.r + f.spl), f.y + Math.sin(a) * (f.r + f.spl));
          ctx.lineTo(f.x + Math.cos(a + w) * (f.r - 2), f.y + Math.sin(a + w) * (f.r - 2));
        }
        ctx.fill();
      },
    },
    growth: {
      name: 'GROWTH', desc: 'Grows every bounce',
      init(f) { f.r0 = f.r; },
      onWall(f) { if (f.r < f.r0 * 2.3) { f.r += 2.6; f.m = f.r * f.r; } },
      contact: 0, contactFn: (f) => 3 + (f.r / f.r0 - 1) * 9,
    },
    clone: {
      name: 'CLONE', desc: 'Splits into minis',
      init(f) { f.cloneT = 1.2; },
      update(f, dt) {
        f.cloneT -= dt;
        const mine = f.mode.minions.filter((q) => q.owner === f && q.alive).length;
        if (f.cloneT <= 0 && mine < 5) { f.cloneT = 2.6; f.mode.spawnMinion(f); }
      },
      contact: 5,
    },
    archer: {
      name: 'ARCHER', desc: 'More arrows per hit',
      init(f) { f.shotT = 0.8; f.volley = 1; },
      update(f, dt) {
        f.shotT -= dt;
        if (f.shotT <= 0) { f.shotT = 1.3; f.mode.fireVolley(f); }
      },
      onHit(f) { f.arrowHits = (f.arrowHits || 0) + 1; if (f.arrowHits % 2 === 0) f.volley = Math.min(5, f.volley + 1); },
      contact: 3,
    },
    vampire: {
      name: 'VAMPIRE', desc: 'Steals HP',
      contact: 8, lifesteal: 0.5,
    },
    shield: {
      name: 'SHIELD', desc: 'Blocks & reflects',
      init(f) { f.shA = 0; f.shSpan = 1.9; },
      update(f, dt) { f.shA += dt * 2.6; },
      contact: 6,
      draw(ctx, f) {
        ctx.save(); ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(lighten(f.color, 0.5), 0.3); ctx.lineWidth = 24;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 16, f.shA - f.shSpan / 2, f.shA + f.shSpan / 2); ctx.stroke();
        ctx.strokeStyle = lighten(f.color, 0.6); ctx.lineWidth = 9;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 16, f.shA - f.shSpan / 2, f.shA + f.shSpan / 2); ctx.stroke();
        ctx.restore();
      },
    },
    speed: {
      name: 'SPEED', desc: 'Faster every bounce',
      init(f) { f.boost = 1; },
      onWall(f) { f.boost = Math.min(2.5, f.boost * 1.05); f.speedMul = f.boost; },
      contact: 0, contactFn: (f) => 3 + (f.boost - 1) * 9,
    },
    bomber: {
      name: 'BOMBER', desc: 'Drops mines',
      init(f) { f.bombT = 1.2; },
      update(f, dt) { f.bombT -= dt; if (f.bombT <= 0) { f.bombT = 1.9; f.mode.dropMine(f); } },
      contact: 4,
    },
  };
  const AB_KEYS = Object.keys(AB);

  // ability glyphs for HUD cards
  function glyph(ctx, id, x, y, s, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 40, s / 40);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (id) {
      case 'sword': ctx.moveTo(-14, 14); ctx.lineTo(14, -14); ctx.moveTo(-18, 4); ctx.lineTo(-4, 18); ctx.stroke(); break;
      case 'spikes': for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); } ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill(); break;
      case 'growth': ctx.arc(0, 0, 17, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(0, -9); ctx.moveTo(-7, -2); ctx.lineTo(0, -9); ctx.lineTo(7, -2); ctx.stroke(); break;
      case 'clone': ctx.arc(-7, 3, 10, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(11, -7, 7, 0, TAU); ctx.fill(); break;
      case 'archer': ctx.moveTo(-16, 16); ctx.lineTo(16, -16); ctx.moveTo(16, -16); ctx.lineTo(4, -15); ctx.moveTo(16, -16); ctx.lineTo(15, -4); ctx.stroke(); break;
      case 'vampire': ctx.moveTo(-12, -8); ctx.lineTo(-6, 12); ctx.lineTo(0, -8); ctx.lineTo(6, 12); ctx.lineTo(12, -8); ctx.stroke(); break;
      case 'shield': ctx.moveTo(0, -18); ctx.lineTo(15, -11); ctx.lineTo(13, 6); ctx.lineTo(0, 18); ctx.lineTo(-13, 6); ctx.lineTo(-15, -11); ctx.closePath(); ctx.stroke(); break;
      case 'speed': ctx.moveTo(4, -19); ctx.lineTo(-10, 3); ctx.lineTo(2, 3); ctx.lineTo(-4, 19); ctx.lineTo(10, -3); ctx.lineTo(-2, -3); ctx.closePath(); ctx.fill(); break;
      case 'bomber': ctx.arc(-2, 4, 13, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(6, -6); ctx.quadraticCurveTo(12, -16, 18, -14); ctx.stroke(); break;
    }
    ctx.restore();
  }

  class Battle extends SB.Mode {
    init() {
      const s = this.s, rng = this.rng;
      this.cx = 540; this.cy = 1110; this.R = s.arenaSize; this.R0 = this.R;
      const n = s.fighters;
      this.fighters = []; this.minions = []; this.arrows = []; this.mines = [];
      // abilities: explicit or random distinct
      const pool = rng.shuffle(AB_KEYS.slice());
      const chosen = [];
      for (let i = 0; i < n; i++) { const v = s['ab' + (i + 1)]; chosen.push(v && v !== 'random' ? v : pool.find((k) => !chosen.includes(k)) || pool[i]); }
      const colorIdx = this.distinctColors(n, 9);
      const r = s.fighterSize * (n > 2 ? 0.85 : 1);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * TAU + (n === 2 ? Math.PI / 2 : 0);
        const f = new P.Ball(this.cx + Math.cos(a) * this.R * 0.5, this.cy + Math.sin(a) * this.R * 0.5, r, { color: this.color(colorIdx[i]), name: this.cname(colorIdx[i]) });
        const va = rng.range(0, TAU);
        f.vx = Math.cos(va) * s.speed; f.vy = Math.sin(va) * s.speed;
        f.mode = this; f.m = r * r; f.hp = s.hp; f.maxHp = s.hp; f.ab = chosen[i]; f.A = AB[f.ab];
        f.cool = new Map(); f.speedMul = 1; f.hitT = 0; f.shownHp = s.hp; f.kills = 0; f.lastWall = -1;
        f.idx = i;
        f.A.init && f.A.init(f);
        this.fighters.push(f);
      }
      this.trailLen = 10;
      this.dmgMul = s.damage;
      this.sudden = false;
      this.introT = 0;
      this.ranking = [];
    }
    trailBalls() { return this.fighters.concat(this.minions); }
    alive() { return this.fighters.filter((f) => f.alive); }
    ready(a, b, key, cd) {
      const k = b.id + key; const t = this.g.time;
      const last = a.cool.get(k);
      if (last !== undefined && t - last < cd) return false;
      a.cool.set(k, t); return true;
    }
    owner(e) { return e.owner || e; }
    enemies(of) { const o = this.owner(of); return this.fighters.filter((f) => f.alive && f !== o).concat(this.minions.filter((q) => q.alive && q.owner !== o)); }

    // --------------- spawners
    spawnMinion(f) {
      const a = this.rng.range(0, TAU);
      const q = new P.Ball(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r, f.r * 0.42, { color: f.color, name: f.name });
      q.vx = Math.cos(a) * this.s.speed * 1.2; q.vy = Math.sin(a) * this.s.speed * 1.2;
      q.owner = f; q.hp = 14; q.maxHp = 14; q.cool = new Map(); q.m = q.r * q.r; q.speedMul = 1.2;
      this.minions.push(q);
      this.fx.ring(q.x, q.y, f.color, 70, 0.35, 4);
      this.snd.sfx('pop', 0.5, this.g.pan(q.x), 1.2);
    }
    fireVolley(f) {
      const targets = this.enemies(f);
      if (!targets.length) return;
      let best = null, bd = 1e9;
      for (const t of targets) { const d = Math.hypot(t.x - f.x, t.y - f.y); if (d < bd) { bd = d; best = t; } }
      const base = Math.atan2(best.y - f.y, best.x - f.x);
      for (let i = 0; i < f.volley; i++) {
        const a = base + (i - (f.volley - 1) / 2) * 0.16;
        this.arrows.push({ x: f.x + Math.cos(a) * (f.r + 8), y: f.y + Math.sin(a) * (f.r + 8), vx: Math.cos(a) * 1250, vy: Math.sin(a) * 1250, owner: f, color: f.color, alive: true, life: 2 });
      }
      this.snd.sfx('zap', 0.45, this.g.pan(f.x), 1 + this.rng.range(-0.08, 0.08));
    }
    dropMine(f) {
      if (this.mines.filter((m) => m.owner === f).length >= 6) return;
      this.mines.push({ x: f.x, y: f.y, owner: f, arm: 0.7, r: 22, alive: true, t: 0 });
      this.snd.sfx('tick', 0.4, this.g.pan(f.x), 0.7);
    }

    // --------------- damage
    damage(target, amount, src, x, y, kind) {
      if (!target.alive || this.g.state !== 'play' && !target.owner) return;
      amount = Math.max(1, Math.round(amount * this.dmgMul * (this.sudden ? 1.6 : 1)));
      target.hp -= amount;
      target.flash = 1; target.hitT = 0.25;
      const big = amount >= 10;
      this.fx.popup(target.x + this.rng.range(-20, 20), target.y - target.r - 10, '-' + amount, '#ffffff', big ? 54 : 42);
      this.fx.burst(x ?? target.x, y ?? target.y, target.color, big ? 16 : 9, 600, { grav: 0 });
      const pan = this.g.pan(target.x);
      if (kind === 'blade') this.snd.sfx('blade', 0.7, pan, 1 + this.rng.range(-0.1, 0.1));
      else if (kind === 'boom') this.snd.sfx('boom', 0.7, pan);
      else this.snd.sfx('thud', 0.75, pan, 1 + this.rng.range(-0.1, 0.15));
      this.note(0.55, target.x);
      this.g.shake(big ? 0.16 : 0.08);
      if (big && !target.owner) this.g.hitstop(0.035);
      const o = src ? this.owner(src) : null;
      if (o && o.A && o.A.lifesteal && o.alive) { const heal = Math.max(1, Math.round(amount * o.A.lifesteal)); o.hp = Math.min(o.maxHp, o.hp + heal); this.fx.popup(o.x, o.y - o.r - 40, '+' + heal, '#7dff9a', 40); this.snd.sfx('heal', 0.4, this.g.pan(o.x)); }
      if (target.hp <= 0) this.kill(target, o);
    }
    kill(t, by) {
      t.alive = false; t.hp = 0;
      if (t.owner) { this.fx.burst(t.x, t.y, t.color, 14, 500); this.snd.sfx('pop', 0.6, this.g.pan(t.x), 0.8); return; }
      this.ranking.unshift(t);
      this.fx.burst(t.x, t.y, t.color, 70, 1200, { colors: [t.color, '#ffffff'] });
      this.fx.ring(t.x, t.y, t.color, 360, 0.7, 14);
      this.fx.debris(t.x, t.y, t.r, t.r, t.color, 16, { power: 1.4 });
      this.snd.sfx('elim', 1, this.g.pan(t.x));
      this.g.shake(0.5); this.fx.flash(t.color, 0.25);
      for (const q of this.minions) if (q.owner === t && q.alive) this.kill(q);
      if (by) by.kills++;
      const left = this.alive();
      if (left.length === 1) {
        const w = left[0];
        this.fx.burst(w.x, w.y, w.color, 50, 900);
        this.g.win({ title: `${w.name} WINS!`, sub: `${w.A.name} · ${Math.max(1, Math.ceil(w.hp))} HP left`, color: w.color, y: 760 });
      } else {
        this.fx.banner(`${t.name} IS OUT!`, t.color, { size: 72, y: 0.5 });
      }
    }

    // --------------- simulation
    update(dt) {
      const s = this.s, g = this.g;
      this.introT += dt;
      const alive = this.alive();
      const hpFrac = alive.reduce((a, f) => a + f.hp / f.maxHp, 0) / Math.max(1, alive.length);
      g.tension = clamp(1 - hpFrac + (this.fighters.length - alive.length) / this.fighters.length * 0.5, 0, 1);
      if (s.sudden && !this.sudden && g.time > g.targetLen * 0.7 && g.state === 'play') {
        this.sudden = true; this.fx.banner('SUDDEN DEATH', '#ff3d5a', { size: 80, y: 0.5, dur: 1.6 }); this.snd.sfx('riser', 0.6); g.shake(0.3);
      }
      if (this.sudden && g.state === 'play') this.R = Math.max(this.R0 * 0.62, this.R - dt * 18);
      for (const f of alive) f.A.update && f.A.update(f, dt);
      // pace assist: steer damage so the knockout lands near the target length
      if (s.assist && g.state === 'play' && !this.sudden) {
        const low = Math.min(...alive.map((f) => f.hp / f.maxHp));
        const exp = 1 - clamp(g.time / (g.targetLen * 0.8), 0, 1);
        if (low < exp - 0.12) this.dmgMul = Math.max(s.damage * 0.3, this.dmgMul * (1 - dt * 0.8));
        else if (low > exp + 0.1) this.dmgMul = Math.min(s.damage * 3, this.dmgMul * (1 + dt * 0.5));
      }
      const bodies = alive.concat(this.minions.filter((q) => q.alive));
      const n = P.substeps(bodies, dt, 0.45, 12);
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of bodies) {
          this.integrate(b, h, s.gravity);
          if (P.insideCircle(b, this.cx, this.cy, this.R)) {
            const imp = P.resolve(b, C.nx, C.ny, C.depth, 1);
            if (imp > 50) this.onWall(b, imp);
          }
        }
        // body-body
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          const oa = this.owner(a), ob = this.owner(b);
          // reach contact (spikes) before physical overlap
          if (oa !== ob) this.checkReach(a, b), this.checkReach(b, a);
          const imp = P.ballBall(a, b, 1);
          if (imp > 0 && oa !== ob) { this.contact(a, b); this.contact(b, a); }
          else if (imp > 80) this.note(0.35, a.x);
        }
        this.weapons(h);
        for (const b of bodies) { const sp = s.speed * (b.speedMul || 1); if (s.gravity > 0) { if (b.E0 === undefined) P.setEnergy(b, s.gravity); P.lockEnergy(b, s.gravity); } else b.setSpeed(sp); }
      }
      this.projectiles(dt);
      for (const b of bodies) { this.decayBall(b, dt); if (b.hitT) b.hitT = Math.max(0, b.hitT - dt); b.shownHp = lerp(b.shownHp ?? b.hp, b.hp, 1 - Math.exp(-dt * 10)); }
      this.minions = this.minions.filter((q) => q.alive || q.trail.length);
    }
    onWall(b, imp) {
      const g = this.g;
      if (g.clock - (b.lastWall || 0) > 0.05) { b.lastWall = g.clock; this.note(this.velFromImpact(imp) * (b.owner ? 0.5 : 0.85), b.x); this.contactFx(b, C.px, C.py, C.nx, C.ny, imp * 0.7); }
      // deterministic jitter so paths don't loop
      const j = this.rng.range(-0.08, 0.08), c = Math.cos(j), s = Math.sin(j);
      const vx = b.vx * c - b.vy * s; b.vy = b.vx * s + b.vy * c; b.vx = vx;
      if (!b.owner && b.A.onWall) b.A.onWall(b);
    }
    contactDamage(a) {
      if (a.owner) return 3;
      const A = a.A; return A.contactFn ? A.contactFn(a) : (A.contact ?? 4);
    }
    contact(a, b) {
      if (!a.alive || !b.alive) return;
      if (!this.ready(a, b, 'c', 0.35)) return;
      const d = this.contactDamage(a);
      if (d > 0) { this.damage(b, d, a, (a.x + b.x) / 2, (a.y + b.y) / 2, 'body'); if (!a.owner && a.A.onHit) a.A.onHit(a); }
    }
    checkReach(a, b) {
      if (a.owner || !a.A.reach || !a.alive || !b.alive) return;
      const R = a.A.reach(a);
      if (Math.hypot(a.x - b.x, a.y - b.y) < R + b.r) {
        if (!this.ready(a, b, 'r', 0.4)) return;
        this.damage(b, a.A.contact, a, (a.x + b.x) / 2, (a.y + b.y) / 2, 'blade');
        a.A.onHit(a);
        // knockback
        const nx = (b.x - a.x), ny = (b.y - a.y), d = Math.hypot(nx, ny) || 1;
        b.vx = nx / d * b.speed; b.vy = ny / d * b.speed;
      }
    }
    weapons(h) {
      const swords = this.fighters.filter((f) => f.alive && f.ab === 'sword');
      for (const f of swords) {
        const seg = AB.sword.blade(f);
        for (const t of this.enemies(f)) {
          // shield block
          if (t.ab === 'shield' && !t.owner && this.shieldBlocks(t, seg[2], seg[3])) {
            if (this.ready(f, t, 'p', 0.25)) { f.sdir *= -1; t.shSpan = Math.min(4.8, t.shSpan + 0.12); this.clash(seg[2], seg[3], f.color); }
            continue;
          }
          if (P.segment(t, seg[0], seg[1], seg[2], seg[3], 6)) {
            if (this.ready(f, t, 's', 0.3)) {
              this.damage(t, AB.sword.dmg, f, C.px, C.py, 'blade'); AB.sword.onHit(f);
              const nx = C.nx, ny = C.ny; t.vx = nx * t.speed; t.vy = ny * t.speed;
            }
          }
        }
        // parry with other swords
        for (const o of swords) {
          if (o === f || o.id < f.id) continue;
          const [d, px, py] = segSegDist(seg, AB.sword.blade(o));
          if (d < 14 && this.ready(f, o, 'p', 0.22)) { f.sdir *= -1; o.sdir *= -1; this.clash(px, py, '#ffffff'); }
        }
      }
    }
    shieldBlocks(t, x, y) {
      const d = Math.hypot(x - t.x, y - t.y);
      if (d > t.r + 34 || d < t.r - 4) return false;
      const a = Math.atan2(y - t.y, x - t.x);
      return Math.abs(SB.util.angleDiff(t.shA, a)) < t.shSpan / 2;
    }
    clash(x, y, color) {
      this.fx.burst(x, y, '#ffffff', 18, 900, { grav: 200, colors: ['#ffffff', color, '#ffe27a'] });
      this.snd.sfx('clang', 0.8, this.g.pan(x), 1 + this.rng.range(-0.08, 0.1));
      this.note(0.7, x);
      this.g.shake(0.12);
    }
    projectiles(dt) {
      for (const a of this.arrows) {
        if (!a.alive) continue;
        const steps = 4;
        for (let k = 0; k < steps && a.alive; k++) {
          a.x += a.vx * dt / steps; a.y += a.vy * dt / steps;
          if (Math.hypot(a.x - this.cx, a.y - this.cy) > this.R) { a.alive = false; this.fx.burst(a.x, a.y, a.color, 4, 200); break; }
          for (const t of this.enemies(a.owner)) {
            if (t.ab === 'shield' && !t.owner && this.shieldBlocks(t, a.x, a.y)) {
              // reflect: arrow now belongs to the shield
              const nx = (a.x - t.x), ny = (a.y - t.y), d = Math.hypot(nx, ny) || 1;
              const vn = (a.vx * nx + a.vy * ny) / d;
              a.vx -= 2 * vn * nx / d; a.vy -= 2 * vn * ny / d; a.owner = t; a.color = t.color;
              t.shSpan = Math.min(4.8, t.shSpan + 0.08);
              this.clash(a.x, a.y, t.color);
              break;
            }
            if (Math.hypot(a.x - t.x, a.y - t.y) < t.r + 4) {
              a.alive = false;
              this.damage(t, 4, a.owner, a.x, a.y, 'blade');
              if (a.owner.A && a.owner.A.onHit) a.owner.A.onHit(a.owner);
              break;
            }
          }
          // swords cut arrows
          for (const f of this.fighters) {
            if (!a.alive || !f.alive || f.ab !== 'sword' || f === a.owner) continue;
            const s = AB.sword.blade(f);
            const tmp = { x: a.x, y: a.y, r: 3 };
            if (P.segment(tmp, s[0], s[1], s[2], s[3], 6)) { a.alive = false; this.clash(a.x, a.y, f.color); }
          }
        }
      }
      this.arrows = this.arrows.filter((a) => a.alive);
      for (const m of this.mines) {
        if (!m.alive) continue;
        m.t += dt; m.arm -= dt;
        if (m.arm > 0) continue;
        for (const t of this.enemies(m.owner)) {
          if (Math.hypot(t.x - m.x, t.y - m.y) < t.r + m.r) { this.explode(m); break; }
        }
      }
      this.mines = this.mines.filter((m) => m.alive);
    }
    explode(m) {
      m.alive = false;
      this.fx.burst(m.x, m.y, '#ffb020', 40, 1000, { colors: ['#ffb020', '#ff5a1f', '#ffffff'] });
      this.fx.ring(m.x, m.y, '#ffb020', 180, 0.45, 12);
      this.g.shake(0.3);
      for (const t of this.enemies(m.owner)) {
        const d = Math.hypot(t.x - m.x, t.y - m.y);
        if (d < 140 + t.r) { this.damage(t, 13 * (1 - d / (200 + t.r)) + 4, m.owner, t.x, t.y, 'boom'); const k = 1 / (d || 1); t.vx = (t.x - m.x) * k * t.speed; t.vy = (t.y - m.y) * k * t.speed; }
      }
    }
    forceEnd() { this.dmgMul = this.s.damage * 4; }

    // --------------- rendering
    render(ctx) {
      const pal = this.pal;
      // arena
      ctx.save();
      ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R, 0, TAU);
      ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.lineWidth = 12; ctx.strokeStyle = this.sudden ? mix('#ff3d5a', '#ffffff', 0.5 + 0.5 * Math.sin(this.g.clock * 10)) : (pal.light ? 'rgba(40,20,60,0.35)' : 'rgba(255,255,255,0.35)'); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = pal.accent; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R - 14, 0, TAU); ctx.stroke();
      ctx.restore();
      // mines
      for (const m of this.mines) {
        const armed = m.arm <= 0;
        const blink = armed ? 0.5 + 0.5 * Math.sin(m.t * 14) : 0.3;
        ctx.fillStyle = '#20121a'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = m.owner.color; ctx.stroke();
        ctx.fillStyle = mix('#ff3d3d', '#ffffff', blink * 0.5); ctx.globalAlpha = 0.4 + blink * 0.6;
        ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      this.drawTrails(ctx, this.fighters.concat(this.minions), 1.2, 0.4);
      // arrows
      ctx.lineCap = 'round';
      for (const a of this.arrows) {
        const sp = Math.hypot(a.vx, a.vy);
        ctx.strokeStyle = a.color; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - a.vx / sp * 38, a.y - a.vy / sp * 38); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, TAU); ctx.fill();
      }
      for (const q of this.minions) if (q.alive) draw.ball(ctx, q, this.look);
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (f.A.draw && f.ab !== 'sword') f.A.draw(ctx, f);
        if (f.ab === 'vampire') { ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.g.clock * 5); draw.glow(ctx, f.x, f.y, f.r * 3.4, '#ff1f4b', 1); ctx.globalAlpha = 1; }
        draw.ball(ctx, f, this.look);
        if (f.ab === 'sword') AB.sword.draw(ctx, f);
        // HP number
        draw.font(ctx, Math.round(f.r * 0.62), 900); ctx.textAlign = 'center';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineJoin = 'round';
        const hp = String(Math.max(0, Math.ceil(f.hp)));
        ctx.strokeText(hp, f.x, f.y + f.r * 0.22); ctx.fillStyle = '#ffffff'; ctx.fillText(hp, f.x, f.y + f.r * 0.22);
        // name + ability tag
        this.tag(ctx, f, f.name, { size: 28, gap: f.ab === 'shield' ? 40 : 18, color: '#ffffff' });
        ctx.textAlign = 'left';
      }
    }
    hud(ctx) {
      const W = this.W, n = this.fighters.length, pal = this.pal, top = 360;
      const slide = SB.util.easeOutCubic(clamp(this.g.clock / 0.5, 0, 1));
      const cols = 2;
      const cw = n === 2 ? 430 : 470, ch = n > 2 ? 104 : 150, gx = n === 2 ? 110 : 20;
      this.fighters.forEach((f, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = W / 2 + (col === 0 ? -cw - gx / 2 : gx / 2) + (1 - slide) * (col === 0 ? -600 : 600);
        const y = top + row * (ch + 14);
        ctx.save();
        ctx.globalAlpha = f.alive ? 1 : 0.45;
        draw.panel(ctx, x, y, cw, ch, 26, this.look, 0.6);
        ctx.fillStyle = f.color; draw.roundRect(ctx, x, y, 12, ch, 6); ctx.fill();
        // glyph badge
        const bs = n > 2 ? 64 : 84;
        ctx.fillStyle = rgba(f.color, 0.22); ctx.beginPath(); ctx.arc(x + 30 + bs / 2, y + ch / 2, bs / 2, 0, TAU); ctx.fill();
        glyph(ctx, f.ab, x + 30 + bs / 2, y + ch / 2, bs * 0.55, f.color);
        const tx = x + 44 + bs;
        draw.font(ctx, n > 2 ? 30 : 40, 900); ctx.fillStyle = f.color; ctx.fillText(f.name, tx, y + (n > 2 ? 38 : 52));
        draw.font(ctx, n > 2 ? 19 : 22, 700, 'Space Grotesk');
        ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.fillText(f.A.name, tx, y + (n > 2 ? 63 : 86));
        const aw = ctx.measureText(f.A.name + '  ').width;
        ctx.fillStyle = pal.light ? SB.util.rgba(pal.text, 0.6) : 'rgba(255,255,255,0.6)'; ctx.fillText(f.A.desc, tx + aw, y + (n > 2 ? 63 : 86));
        // HP bar
        const bw = cw - (tx - x) - 24, by = y + ch - (n > 2 ? 28 : 38), bh = n > 2 ? 14 : 18;
        draw.roundRect(ctx, tx, by, bw, bh, bh / 2); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
        const k = clamp(f.shownHp / f.maxHp, 0, 1);
        if (k > 0) {
          draw.roundRect(ctx, tx, by, Math.max(bh, bw * k), bh, bh / 2);
          ctx.fillStyle = k < 0.3 ? mix('#ff3d5a', '#ffffff', f.hitT * 2) : mix(f.color, '#ffffff', f.hitT * 2); ctx.fill();
        }
        if (!f.alive) { draw.font(ctx, 40, 900); ctx.fillStyle = '#ff3d5a'; ctx.textAlign = 'right'; ctx.fillText('KO', x + cw - 22, y + 50); ctx.textAlign = 'left'; }
        ctx.restore();
      });
      if (n === 2 && this.g.state === 'play') {
        const ch = 150, pulse = 1 + 0.06 * Math.sin(this.g.clock * 6);
        ctx.save(); ctx.translate(W / 2, top + ch / 2); ctx.scale(pulse * slide, pulse * slide);
        ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.fill();
        draw.font(ctx, 38, 900); ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.fillText('VS', 0, 14);
        ctx.restore();
        ctx.textAlign = 'left';
      }
    }
    stats() { return { alive: this.alive().map((f) => f.name + ':' + f.ab + ':' + Math.ceil(f.hp)), all: this.fighters.map((f) => f.ab) }; }
  }

  const abOpts = [['random', 'Random']].concat(AB_KEYS.map((k) => [k, AB[k].name[0] + AB[k].name.slice(1).toLowerCase()]));
  SB.modes.register({
    id: 'battle', name: 'Ball Battles', icon: '⚔', tagline: 'Named fighters, HP bars and abilities — pick a side',
    hook: 'Who wins? *Pick a side!*',
    settings: [
      { key: 'fighters', label: 'Fighters', type: 'range', min: 2, max: 4, step: 1, def: 2, rand: [2, 4] },
      { key: 'ab1', label: 'Fighter 1 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'ab2', label: 'Fighter 2 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'ab3', label: 'Fighter 3 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'ab4', label: 'Fighter 4 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'hp', label: 'HP', type: 'range', min: 20, max: 400, step: 10, def: 100, rand: [80, 150] },
      { key: 'damage', label: 'Damage multiplier', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1, rand: [0.8, 1.4] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1100, step: 10, def: 520, rand: [420, 680] },
      { key: 'fighterSize', label: 'Fighter size', type: 'range', min: 30, max: 90, step: 1, def: 58, rand: [50, 66] },
      { key: 'arenaSize', label: 'Arena size', type: 'range', min: 300, max: 520, step: 5, def: 460, rand: [420, 490] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2000, step: 50, def: 0, rand: [0, 0] },
      { key: 'sudden', label: 'Sudden death (arena shrinks)', type: 'toggle', def: true, rand: false },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Sword vs Spikes', s: { fighters: 2, ab1: 'sword', ab2: 'spikes' } },
      { name: 'Archer vs Shield', s: { fighters: 2, ab1: 'archer', ab2: 'shield' } },
      { name: 'Clone vs Growth', s: { fighters: 2, ab1: 'clone', ab2: 'growth' } },
      { name: '4-Way Brawl', s: { fighters: 4, hp: 120 } },
      { name: 'Vampire vs Bomber', s: { fighters: 2, ab1: 'vampire', ab2: 'bomber' } },
    ],
    create: (g, s) => new Battle(g, s),
  });
  SB.battleAbilities = AB;
})(window.SB);
