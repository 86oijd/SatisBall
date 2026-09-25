/* SatisBall — Brawl: reusable fighter engine (HP, 12 abilities, levels, teams, projectiles, crits, combos,
 * KO moments, HUD cards). Used by Ball Battles, Team Battle, Tournament, Level Up and Boss Fight. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, mix, lighten, darken, angleDiff } = SB.util;
  const P = SB.phys, C = P.C, draw = SB.draw;

  function segSegDist(a, b) {
    const [p1x, p1y, q1x, q1y] = a, [p2x, p2y, q2x, q2y] = b;
    const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
    const A = d1x * d1x + d1y * d1y, E = d2x * d2x + d2y * d2y, F = d2x * rx + d2y * ry;
    const c = d1x * rx + d1y * ry, bb = d1x * d2x + d1y * d2y, den = A * E - bb * bb;
    let s = den > 1e-9 ? clamp((bb * F - c * E) / den, 0, 1) : 0;
    let t = (bb * s + F) / E;
    if (t < 0) { t = 0; s = clamp(-c / A, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / A, 0, 1); }
    const cx1 = p1x + d1x * s, cy1 = p1y + d1y * s, cx2 = p2x + d2x * t, cy2 = p2y + d2y * t;
    return [Math.hypot(cx1 - cx2, cy1 - cy2), (cx1 + cx2) / 2, (cy1 + cy2) / 2];
  }

  // ------------------------------------------------------------------ abilities
  // Hooks: init(f), level(f, lv), update(f, dt), onHit(f), onWall(f), draw(ctx, f) (under the ball), over(ctx, f) (over it)
  const AB = {
    sword: {
      name: 'SWORD', desc: 'Faster every hit',
      init(f) { f.ang = f.brawl.rng.range(0, TAU); f.spin = 4.2; f.sdir = 1; f.blades = 1; f.len = f.r * 1.75; f.sdmg = 9; },
      level(f, lv) { f.len = f.r * (1.45 + lv * 0.15); f.blades = lv >= 4 ? 2 : 1; f.sdmg = 7 + lv * 1.5; },
      update(f, dt) { f.ang += f.spin * f.sdir * dt; },
      blade(f, k = 0) { const a = f.ang + k * Math.PI, c = Math.cos(a), s = Math.sin(a); return [f.x + c * (f.r + 2), f.y + s * (f.r + 2), f.x + c * (f.r + f.len), f.y + s * (f.r + f.len)]; },
      onHit(f) { f.spin = Math.min(15, f.spin + 0.9); },
      contact: 4,
      over(ctx, f) {
        for (let k = 0; k < f.blades; k++) {
          const [ax, ay, bx, by] = AB.sword.blade(f, k);
          const nx = -(by - ay) / f.len, ny = (bx - ax) / f.len;
          ctx.save(); ctx.lineCap = 'round';
          ctx.strokeStyle = rgba('#ffffff', 0.12 + Math.min(0.25, f.spin / 60)); ctx.lineWidth = 26;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          // motion smear when spinning fast
          if (f.spin > 7) { ctx.globalAlpha = 0.18; ctx.strokeStyle = f.color; ctx.lineWidth = f.len * 0.5; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + f.len * 0.6, f.ang + k * Math.PI - 0.5 * f.sdir, f.ang + k * Math.PI, f.sdir < 0); ctx.stroke(); ctx.globalAlpha = 1; }
          ctx.beginPath(); ctx.moveTo(ax + nx * 8, ay + ny * 8); ctx.lineTo(bx, by); ctx.lineTo(ax - nx * 8, ay - ny * 8); ctx.closePath();
          const g = ctx.createLinearGradient(ax, ay, bx, by); g.addColorStop(0, '#dfe8ff'); g.addColorStop(1, '#ffffff');
          ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.stroke();
          ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(ax + nx * 22, ay + ny * 22); ctx.lineTo(ax - nx * 22, ay - ny * 22); ctx.stroke();
          ctx.restore();
        }
      },
    },
    spikes: {
      name: 'SPIKES', desc: 'Grows every hit',
      init(f) { f.spk = 10; f.spl = f.r * 0.32; f.sa = 0; },
      level(f, lv) { f.spk = 8 + lv * 2; f.spl = f.r * (0.2 + lv * 0.1); },
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
      init(f) { f.r0 = f.r; f.gmax = 2.3; },
      level(f, lv) { f.gmax = 1.6 + lv * 0.25; },
      onWall(f) { if (f.r < f.r0 * f.gmax) { f.r += 2.6; f.m = f.r * f.r; } },
      contactFn: (f) => 3 + (f.r / f.r0 - 1) * 9,
    },
    clone: {
      name: 'CLONE', desc: 'Splits into minis',
      init(f) { f.cloneT = 1.2; f.cloneMax = 5; f.cloneEvery = 2.6; },
      level(f, lv) { f.cloneMax = 1 + lv; f.cloneEvery = 3.4 - lv * 0.35; },
      update(f, dt) {
        f.cloneT -= dt;
        if (f.cloneT <= 0 && !f.brawl.sudden) { f.cloneT = f.cloneEvery; if (f.brawl.minions.filter((q) => q.owner === f && q.alive).length < f.cloneMax) f.brawl.spawnMinion(f); }
      },
      contact: 5,
    },
    archer: {
      name: 'ARCHER', desc: 'More arrows per hit',
      init(f) { f.shotT = 0.8; f.volley = 1; f.volleyMax = 5; },
      level(f, lv) { f.volley = Math.max(f.volley, Math.ceil(lv / 2)); f.volleyMax = 3 + Math.ceil(lv / 2); },
      update(f, dt) { f.shotT -= dt; if (f.shotT <= 0) { f.shotT = 1.3; f.brawl.fireVolley(f); } },
      onHit(f) { f.arrowHits = (f.arrowHits || 0) + 1; if (f.arrowHits % 2 === 0) f.volley = Math.min(f.volleyMax, f.volley + 1); },
      contact: 3,
    },
    vampire: {
      name: 'VAMPIRE', desc: 'Steals HP',
      init(f) { f.steal = 0.5; },
      level(f, lv) { f.steal = 0.3 + lv * 0.1; },
      contact: 8,
      draw(ctx, f) { if (f.brawl.look.light) return; ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, f.x, f.y, f.r * 3.4, '#ff1f4b', 0.35 + 0.15 * Math.sin(f.brawl.g.clock * 5)); ctx.globalCompositeOperation = 'source-over'; },
    },
    shield: {
      name: 'SHIELD', desc: 'Blocks & reflects',
      init(f) { f.shA = 0; f.shSpan = 1.9; },
      level(f, lv) { f.shSpan = Math.max(f.shSpan, 1.2 + lv * 0.45); },
      update(f, dt) { f.shA += dt * 2.6; },
      contact: 6,
      over(ctx, f) {
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
      init(f) { f.boost = 1; f.boostMax = 2.5; },
      level(f, lv) { f.boostMax = 1.6 + lv * 0.3; },
      onWall(f) { f.boost = Math.min(f.boostMax, f.boost * 1.05); f.speedMul = f.boost; },
      contactFn: (f) => 3 + (f.boost - 1) * 9,
    },
    bomber: {
      name: 'BOMBER', desc: 'Drops mines',
      init(f) { f.bombT = 1.2; f.bombEvery = 1.9; f.bombMax = 6; },
      level(f, lv) { f.bombEvery = 2.6 - lv * 0.3; f.bombMax = 2 + lv; },
      update(f, dt) { f.bombT -= dt; if (f.bombT <= 0) { f.bombT = f.bombEvery; f.brawl.dropMine(f); } },
      contact: 4,
    },
    frost: {
      name: 'FROST', desc: 'Freezes on hit',
      init(f) { f.freeze = 1.5; },
      level(f, lv) { f.freeze = 0.8 + lv * 0.35; },
      contact: 6,
      onContact(f, t) { t.slowT = Math.max(t.slowT || 0, f.freeze); f.brawl.fx.burst(t.x, t.y, '#bff4ff', 14, 400, { grav: 0, colors: ['#bff4ff', '#ffffff', '#6fd8ff'] }); },
      draw(ctx, f) {
        ctx.save(); ctx.strokeStyle = rgba('#dff8ff', 0.8); ctx.lineWidth = 4; ctx.lineCap = 'round';
        const t = f.brawl.g.clock;
        for (let i = 0; i < 6; i++) { const a = t * 0.8 + (i / 6) * TAU, r1 = f.r + 6, r2 = f.r + 24; ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.lineTo(f.x + Math.cos(a) * r2, f.y + Math.sin(a) * r2); ctx.stroke(); }
        ctx.restore();
      },
    },
    laser: {
      name: 'LASER', desc: 'Charges a beam',
      init(f) { f.lzT = 1.6; f.lzEvery = 2.7; f.lzDmg = 13; f.lzState = 0; },
      level(f, lv) { f.lzEvery = 3.2 - lv * 0.3; f.lzDmg = 9 + lv * 2.5; },
      update(f, dt) {
        const B = f.brawl;
        if (f.lzState === 0) { f.lzT -= dt; if (f.lzT <= 0) { const t = B.nearestEnemy(f); if (t) { f.lzState = 1; f.lzT = 0.45; f.lzA = Math.atan2(t.y - f.y, t.x - f.x); B.snd.sfx('charge', 0.45, B.g.pan(f.x), 1.6); } else f.lzT = 0.5; } }
        else if (f.lzState === 1) {
          // the telegraph tracks its target (limited turn rate) so a dodge is still possible
          const t = B.nearestEnemy(f);
          if (t) { const want = Math.atan2(t.y - f.y, t.x - f.x), d = angleDiff(f.lzA, want), turn = 2.6 * dt; f.lzA += clamp(d, -turn, turn); }
          f.lzT -= dt; if (f.lzT <= 0) { f.lzState = 2; f.lzT = 0.16; B.fireLaser(f); }
        }
        else { f.lzT -= dt; if (f.lzT <= 0) { f.lzState = 0; f.lzT = f.lzEvery; } }
      },
      contact: 4,
    },
    healer: {
      name: 'HEALER', desc: 'Heals the team',
      init(f) { f.healT = 1.5; f.healAmt = 7; },
      level(f, lv) { f.healAmt = 4 + lv * 2; },
      update(f, dt) {
        f.healT -= dt;
        if (f.healT <= 0) {
          f.healT = 2;
          const B = f.brawl, mates = B.fighters.filter((q) => q.alive && q.team === f.team);
          let healed = false;
          for (const q of mates) {
            if (Math.hypot(q.x - f.x, q.y - f.y) > 320) continue;
            const amt = Math.ceil((q === f ? (mates.length > 1 ? 3 : 6) : f.healAmt) * (B.sudden ? 0.4 : 1));
            if (q.hp < q.maxHp) { q.hp = Math.min(q.maxHp, q.hp + amt); B.fx.popup(q.x, q.y - q.r - 30, '+' + amt, '#7dff9a', 36); healed = true; }
          }
          if (healed) { B.fx.ring(f.x, f.y, '#7dff9a', 320, 0.5, 6); B.snd.sfx('heal', 0.4, B.g.pan(f.x)); }
        }
      },
      contact: 4,
      over(ctx, f) { ctx.fillStyle = '#ffffff'; const s = f.r * 0.22; ctx.fillRect(f.x - s * 0.35, f.y - f.r - s * 2.4, s * 0.7, s * 2); ctx.fillRect(f.x - s, f.y - f.r - s * 1.75, s * 2, s * 0.7); },
    },
    none: { name: 'BRAWLER', desc: 'Pure contact', contact: 5 },
  };
  const AB_KEYS = Object.keys(AB).filter((k) => k !== 'none');

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
      case 'frost': for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI; ctx.moveTo(Math.cos(a) * -18, Math.sin(a) * -18); ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); } ctx.stroke(); break;
      case 'laser': ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.stroke(); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-18, -8); ctx.lineTo(18, -8); ctx.moveTo(-18, 8); ctx.lineTo(18, 8); ctx.stroke(); ctx.beginPath(); ctx.arc(-18, 0, 6, 0, TAU); ctx.fill(); break;
      case 'healer': ctx.fillRect(-5, -16, 10, 32); ctx.fillRect(-16, -5, 32, 10); break;
      case 'boss': ctx.arc(0, 2, 15, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-15, -6); ctx.lineTo(-18, -20); ctx.lineTo(-6, -12); ctx.moveTo(15, -6); ctx.lineTo(18, -20); ctx.lineTo(6, -12); ctx.stroke(); break;
      default: ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  class Brawl {
    /** o: { arena, speed, gravity, damage, onKill(victim, killer), crits, combos } */
    constructor(mode, o) {
      this.m = mode; this.g = mode.g; this.rng = mode.rng; this.fx = mode.fx; this.snd = mode.snd;
      this.arena = o.arena; this.speed = o.speed; this.gravity = o.gravity || 0; this.dmgMul = o.damage ?? 1;
      this.onKill = o.onKill || (() => {}); this.crits = o.crits !== false; this.combos = o.combos !== false;
      this.fighters = []; this.minions = []; this.arrows = []; this.mines = []; this.beams = [];
      this.sudden = false; this.hpStyle = o.hpStyle || 'number';
    }
    get look() { return this.g.look; }
    add(o) {
      const f = new P.Ball(o.x, o.y, o.r, { color: o.color, name: o.name });
      const a = o.dir ?? this.rng.range(0, TAU), sp = o.speed ?? this.speed;
      f.vx = Math.cos(a) * sp; f.vy = Math.sin(a) * sp;
      f.brawl = this; f.m = o.r * o.r * (o.massK || 1);
      f.hp = f.maxHp = o.hp; f.team = o.team ?? f.id; f.ab = o.ab || 'none'; f.A = AB[f.ab] || AB.none;
      f.cool = new Map(); f.speedMul = 1; f.slowT = 0; f.hitT = 0; f.shownHp = f.lagHp = o.hp; f.kills = 0; f.dealt = 0;
      f.level = o.level || 1; f.combo = 0; f.comboT = -9; f.baseSpeed = sp; f.lowWarned = false; f.boss = !!o.boss; f.teamColor = o.teamColor;
      f.lastWall = -1;
      f.A.init && f.A.init(f);
      if (f.level > 1 && f.A.level) f.A.level(f, f.level);
      this.fighters.push(f);
      return f;
    }
    setAbility(f, ab, lv) { f.ab = ab; f.A = AB[ab] || AB.none; f.A.init && f.A.init(f); if (f.A.level) f.A.level(f, lv || f.level); }
    alive() { return this.fighters.filter((f) => f.alive); }
    teamsAlive() { const s = new Set(); for (const f of this.fighters) if (f.alive) s.add(f.team); return s; }
    owner(e) { return e.owner || e; }
    teamOf(e) { return this.owner(e).team; }
    enemiesOf(of) { const tm = this.teamOf(of); return this.fighters.filter((f) => f.alive && f.team !== tm).concat(this.minions.filter((q) => q.alive && q.owner.team !== tm)); }
    nearestEnemy(f) { let best = null, bd = 1e9; for (const t of this.enemiesOf(f)) { const d = Math.hypot(t.x - f.x, t.y - f.y); if (d < bd) { bd = d; best = t; } } return best; }
    ready(a, b, key, cd) {
      const k = b.id + key; const t = this.g.time;
      const last = a.cool.get(k);
      if (last !== undefined && t - last < cd) return false;
      a.cool.set(k, t); return true;
    }

    // --------------- spawners
    spawnMinion(f) {
      const a = this.rng.range(0, TAU);
      const q = new P.Ball(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r, f.r * 0.42, { color: f.color, name: f.name });
      q.vx = Math.cos(a) * this.speed * 1.2; q.vy = Math.sin(a) * this.speed * 1.2;
      q.owner = f; q.hp = 14; q.maxHp = 14; q.cool = new Map(); q.m = q.r * q.r; q.speedMul = 1.2; q.baseSpeed = this.speed; q.slowT = 0;
      this.minions.push(q);
      this.fx.ring(q.x, q.y, f.color, 70, 0.35, 4);
      this.snd.sfx('pop', 0.5, this.g.pan(q.x), 1.2);
    }
    fireVolley(f) {
      const best = this.nearestEnemy(f);
      if (!best) return;
      const base = Math.atan2(best.y - f.y, best.x - f.x);
      for (let i = 0; i < f.volley; i++) {
        const a = base + (i - (f.volley - 1) / 2) * 0.16;
        this.arrows.push({ x: f.x + Math.cos(a) * (f.r + 8), y: f.y + Math.sin(a) * (f.r + 8), vx: Math.cos(a) * 1250, vy: Math.sin(a) * 1250, owner: f, color: f.color, alive: true });
      }
      this.snd.sfx('zap', 0.45, this.g.pan(f.x), 1 + this.rng.range(-0.08, 0.08));
    }
    dropMine(f) {
      if (this.mines.filter((m) => m.owner === f).length >= (f.bombMax || 6)) return;
      this.mines.push({ x: f.x, y: f.y, owner: f, arm: 0.7, r: 22, alive: true, t: 0 });
      this.snd.sfx('tick', 0.4, this.g.pan(f.x), 0.7);
    }
    fireLaser(f) {
      const L = 1500, a = f.lzA, x2 = f.x + Math.cos(a) * L, y2 = f.y + Math.sin(a) * L;
      this.beams.push({ x1: f.x, y1: f.y, x2, y2, color: f.color, t: 0.22, max: 0.22 });
      this.snd.sfx('laser', 0.7, this.g.pan(f.x));
      this.g.shake(0.18);
      this.fx.flare(f.x + Math.cos(a) * (f.r + 10), f.y + Math.sin(a) * (f.r + 10), f.color, 500);
      for (const t of this.enemiesOf(f)) {
        const tmp = { x: t.x, y: t.y, r: t.r };
        if (P.segment(tmp, f.x, f.y, x2, y2, 10)) {
          if (t.shA !== undefined && t.ab === 'shield' && this.shieldBlocks(t, C.px, C.py)) { this.clash(C.px, C.py, t.color); continue; }
          this.damage(t, f.lzDmg, f, C.px, C.py, 'blade');
        }
      }
    }

    // --------------- damage
    damage(target, amount, src, x, y, kind, o = {}) {
      if (!target.alive || (this.g.state !== 'play' && !target.owner)) return 0;
      const attacker = src ? this.owner(src) : null;
      let crit = false;
      if (this.crits && !o.noCrit && kind !== 'boom' && this.rng.chance(0.1)) { crit = true; amount *= 1.8; }
      const mf = this.mulFor ? this.mulFor(target, attacker) : 1;
      if (mf <= 0) return 0;
      amount = Math.max(1, Math.round(amount * this.dmgMul * (this.sudden ? 1.6 : 1) * (o.mul || 1) * mf));
      target.hp -= amount;
      target.flash = 1; target.hitT = 0.25;
      if (attacker) attacker.dealt += amount;
      const big = amount >= 10 || crit;
      if (amount > 1 || crit) this.fx.popup(target.x + this.rng.range(-20, 20), target.y - target.r - 10, (crit ? 'CRIT -' : '-') + amount, crit ? '#ffd23f' : '#ffffff', big ? 54 : 42);
      this.fx.burst(x ?? target.x, y ?? target.y, target.color, big ? 16 : 9, 600, { grav: 0 });
      const pan = this.g.pan(target.x);
      if (kind === 'blade') this.snd.sfx('blade', 0.7, pan, 1 + this.rng.range(-0.1, 0.1));
      else if (kind === 'boom') this.snd.sfx('explode', 0.7, pan);
      else this.snd.sfx('thud', 0.75, pan, 1 + this.rng.range(-0.1, 0.15));
      this.m.note(0.55, target.x);
      this.g.shake(big ? 0.16 : 0.08);
      if (crit) { this.fx.flare(x ?? target.x, y ?? target.y, '#ffd23f', 600); this.g.hitstop(0.05); }
      else if (big && !target.owner) this.g.hitstop(0.035);
      // combos
      if (attacker && this.combos && !attacker.owner && !attacker.boss) {
        if (this.g.time - attacker.comboT < 1.1) attacker.combo++; else attacker.combo = 1;
        attacker.comboT = this.g.time;
        // only milestone combos, and never more than one callout on screen at a time
        const c = attacker.combo;
        if ((c === 3 || c === 5 || c === 8 || (c >= 12 && c % 4 === 0)) && this.g.clock - (this.comboPopT ?? -9) > 0.7) {
          this.comboPopT = this.g.clock;
          this.fx.popup(attacker.x, attacker.y - attacker.r - 60, c + 'x COMBO', attacker.color, 34 + Math.min(20, c * 2));
          if (c >= 8) this.snd.sfx('shimmer', 0.3, this.g.pan(attacker.x), 1.3);
        }
      }
      if (attacker && attacker.A && attacker.A.contact !== undefined && attacker.ab === 'vampire' && attacker.alive) {
        const heal = Math.max(1, Math.round(amount * (attacker.steal || 0.5)));
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
        this.fx.popup(attacker.x, attacker.y - attacker.r - 40, '+' + heal, '#7dff9a', 40); this.snd.sfx('heal', 0.4, this.g.pan(attacker.x));
      }
      if (!target.owner && !target.lowWarned && target.hp > 0 && target.hp / target.maxHp < 0.25) { target.lowWarned = true; this.fx.popup(target.x, target.y + target.r + 50, 'LOW HP!', '#ff5a70', 36); }
      if (target.hp <= 0) this.kill(target, attacker);
      return amount;
    }
    kill(t, by) {
      t.alive = false; t.hp = 0;
      if (t.owner) { this.fx.burst(t.x, t.y, t.color, 14, 500); this.snd.sfx('pop', 0.6, this.g.pan(t.x), 0.8); return; }
      this.fx.burst(t.x, t.y, t.color, 70, 1200, { colors: [t.color, '#ffffff'] });
      this.fx.shockwave(t.x, t.y, t.color, 380);
      this.fx.flare(t.x, t.y, t.color, 900);
      this.fx.debris(t.x, t.y, t.r, t.r, t.color, 16, { power: 1.4 });
      this.snd.sfx('elim', 1, this.g.pan(t.x));
      this.g.shake(0.5); this.fx.flash(t.color, 0.25);
      for (const q of this.minions) if (q.owner === t && q.alive) this.kill(q);
      for (const m of this.mines) if (m.owner === t) m.alive = false;
      if (by) by.kills++;
      this.onKill(t, by);
    }

    // --------------- simulation
    update(dt) {
      const g = this.g;
      const alive = this.alive();
      for (const f of alive) f.A.update && f.A.update(f, dt);
      const bodies = alive.concat(this.minions.filter((q) => q.alive));
      const n = P.substeps(bodies, dt, 0.45, 12);
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const b of bodies) {
          this.m.integrate(b, h, this.gravity);
          const imp = this.arena.collide(b, 1);
          if (imp > 50) this.onWall(b, imp);
        }
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          const foes = this.teamOf(a) !== this.teamOf(b);
          if (foes) { this.checkReach(a, b); this.checkReach(b, a); }
          const imp = P.ballBall(a, b, 1);
          if (imp > 0 && foes) { this.contact(a, b); this.contact(b, a); }
          else if (imp > 80) this.m.note(0.35, a.x);
        }
        for (const b of bodies) this.arena.keepIn(b);
        this.weapons();
        for (const b of bodies) {
          const slow = b.slowT > 0 ? 0.55 : 1;
          if (this.gravity > 0) { if (b.E0 === undefined) P.setEnergy(b, this.gravity); P.lockEnergy(b, this.gravity); }
          else b.setSpeed((b.baseSpeed || this.speed) * (b.speedMul || 1) * slow);
        }
      }
      this.projectiles(dt);
      // sudden death: minions fade out so they can't body-block a finish forever
      if (this.sudden) for (const q of this.minions) if (q.alive) { q.hp -= dt * 3; if (q.hp <= 0) this.kill(q); }
      for (const b of bodies) {
        this.m.decayBall(b, dt);
        if (b.hitT) b.hitT = Math.max(0, b.hitT - dt);
        if (b.slowT) b.slowT = Math.max(0, b.slowT - dt);
        b.shownHp = lerp(b.shownHp ?? b.hp, b.hp, 1 - Math.exp(-dt * 10));
        b.lagHp = b.lagHp === undefined ? b.hp : (b.lagHp > b.shownHp ? Math.max(b.shownHp, b.lagHp - dt * b.maxHp * 0.6) : b.shownHp);
      }
      for (const bm of this.beams) bm.t -= dt;
      this.beams = this.beams.filter((b) => b.t > 0);
      this.minions = this.minions.filter((q) => q.alive || q.trail.length);
    }
    onWall(b, imp) {
      const g = this.g;
      if (g.clock - (b.lastWall || 0) > 0.05) { b.lastWall = g.clock; this.m.note(this.m.velFromImpact(imp) * (b.owner ? 0.5 : 0.85), b.x); this.m.contactFx(b, C.px, C.py, C.nx, C.ny, imp * 0.7); }
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
      if (d > 0) {
        this.damage(b, d, a, (a.x + b.x) / 2, (a.y + b.y) / 2, 'body');
        if (!a.owner && a.A.onHit) a.A.onHit(a);
        if (!a.owner && a.A.onContact && b.alive) a.A.onContact(a, b);
      }
    }
    checkReach(a, b) {
      if (a.owner || !a.A.reach || !a.alive || !b.alive) return;
      const R = a.A.reach(a);
      if (Math.hypot(a.x - b.x, a.y - b.y) < R + b.r) {
        if (!this.ready(a, b, 'r', 0.4)) return;
        this.damage(b, a.A.contact, a, (a.x + b.x) / 2, (a.y + b.y) / 2, 'blade');
        a.A.onHit(a);
        const nx = (b.x - a.x), ny = (b.y - a.y), d = Math.hypot(nx, ny) || 1;
        b.vx = nx / d * b.speed; b.vy = ny / d * b.speed;
      }
    }
    weapons() {
      const swords = this.fighters.filter((f) => f.alive && f.ab === 'sword');
      for (const f of swords) {
        for (let k = 0; k < f.blades; k++) {
          const seg = AB.sword.blade(f, k);
          for (const t of this.enemiesOf(f)) {
            if (t.ab === 'shield' && !t.owner && this.shieldBlocks(t, seg[2], seg[3])) {
              if (this.ready(f, t, 'p', 0.25)) { f.sdir *= -1; t.shSpan = Math.min(4.8, t.shSpan + 0.12); this.clash(seg[2], seg[3], f.color); }
              continue;
            }
            if (P.segment(t, seg[0], seg[1], seg[2], seg[3], 6)) {
              if (this.ready(f, t, 's', 0.3)) {
                this.damage(t, f.sdmg, f, C.px, C.py, 'blade'); AB.sword.onHit(f);
                t.vx = C.nx * t.speed; t.vy = C.ny * t.speed;
              }
            }
          }
          for (const o of swords) {
            if (o === f || o.id < f.id || o.team === f.team) continue;
            for (let kk = 0; kk < o.blades; kk++) {
              const [d, px, py] = segSegDist(seg, AB.sword.blade(o, kk));
              if (d < 14 && this.ready(f, o, 'p', 0.22)) { f.sdir *= -1; o.sdir *= -1; this.clash(px, py, '#ffffff'); }
            }
          }
        }
      }
    }
    shieldBlocks(t, x, y) {
      const d = Math.hypot(x - t.x, y - t.y);
      if (d > t.r + 34 || d < t.r - 4) return false;
      const a = Math.atan2(y - t.y, x - t.x);
      return Math.abs(angleDiff(t.shA, a)) < t.shSpan / 2;
    }
    clash(x, y, color) {
      this.fx.burst(x, y, '#ffffff', 18, 900, { grav: 200, colors: ['#ffffff', color, '#ffe27a'] });
      this.fx.flare(x, y, '#ffffff', 380);
      this.snd.sfx('clang', 0.8, this.g.pan(x), 1 + this.rng.range(-0.08, 0.1));
      this.m.note(0.7, x);
      this.g.shake(0.12);
    }
    projectiles(dt) {
      for (const a of this.arrows) {
        if (!a.alive) continue;
        const steps = 4;
        for (let k = 0; k < steps && a.alive; k++) {
          a.x += a.vx * dt / steps; a.y += a.vy * dt / steps;
          if (!this.arena.contains(a.x, a.y)) { a.alive = false; this.fx.burst(a.x, a.y, a.color, 4, 200); break; }
          for (const t of this.enemiesOf(a.owner)) {
            if (t.ab === 'shield' && !t.owner && this.shieldBlocks(t, a.x, a.y)) {
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
          for (const f of this.fighters) {
            if (!a.alive || !f.alive || f.ab !== 'sword' || f.team === this.teamOf(a.owner)) continue;
            for (let bk = 0; bk < f.blades; bk++) {
              const s = AB.sword.blade(f, bk);
              if (P.segment({ x: a.x, y: a.y, r: 3 }, s[0], s[1], s[2], s[3], 6)) { a.alive = false; this.clash(a.x, a.y, f.color); break; }
            }
          }
        }
      }
      this.arrows = this.arrows.filter((a) => a.alive);
      for (const m of this.mines) {
        if (!m.alive) continue;
        m.t += dt; m.arm -= dt;
        if (m.arm > 0) continue;
        for (const t of this.enemiesOf(m.owner)) if (Math.hypot(t.x - m.x, t.y - m.y) < t.r + m.r) { this.explode(m); break; }
      }
      this.mines = this.mines.filter((m) => m.alive);
    }
    explode(m) {
      m.alive = false;
      this.fx.burst(m.x, m.y, '#ffb020', 40, 1000, { colors: ['#ffb020', '#ff5a1f', '#ffffff'] });
      this.fx.shockwave(m.x, m.y, '#ffb020', 220);
      this.g.shake(0.3);
      for (const t of this.enemiesOf(m.owner)) {
        const d = Math.hypot(t.x - m.x, t.y - m.y);
        if (d < 140 + t.r) { this.damage(t, 13 * (1 - d / (200 + t.r)) + 4, m.owner, t.x, t.y, 'boom'); const k = 1 / (d || 1); t.vx = (t.x - m.x) * k * t.speed; t.vy = (t.y - m.y) * k * t.speed; }
      }
    }

    // --------------- rendering
    render(ctx, o = {}) {
      const look = this.look, t = this.g.clock;
      for (const m of this.mines) {
        const armed = m.arm <= 0, blink = armed ? 0.5 + 0.5 * Math.sin(m.t * 14) : 0.3;
        ctx.fillStyle = '#20121a'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = m.owner.color; ctx.stroke();
        ctx.fillStyle = mix('#ff3d3d', '#ffffff', blink * 0.5); ctx.globalAlpha = 0.4 + blink * 0.6;
        ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      // laser telegraphs + beams
      for (const f of this.fighters) if (f.alive && f.ab === 'laser' && f.lzState === 1) {
        ctx.save(); ctx.setLineDash([18, 14]); ctx.lineDashOffset = -t * 200; ctx.strokeStyle = rgba(f.color, 0.55 + 0.4 * Math.sin(t * 40)); ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(f.lzA) * 1500, f.y + Math.sin(f.lzA) * 1500); ctx.stroke(); ctx.restore();
      }
      for (const bm of this.beams) {
        const k = bm.t / bm.max;
        ctx.save(); ctx.lineCap = 'round';
        if (!look.light) ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k; ctx.strokeStyle = bm.color; ctx.lineWidth = 40 * k + 6;
        ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 12 * k + 2; ctx.stroke();
        ctx.restore();
      }
      this.m.drawTrails(ctx, this.fighters.concat(this.minions), 1.2, 0.4);
      ctx.lineCap = 'round';
      for (const a of this.arrows) {
        const sp = Math.hypot(a.vx, a.vy);
        ctx.strokeStyle = a.color; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - a.vx / sp * 38, a.y - a.vy / sp * 38); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, TAU); ctx.fill();
      }
      for (const q of this.minions) if (q.alive) draw.ball(ctx, q, look);
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (f.teamColor) { ctx.lineWidth = 8; ctx.strokeStyle = f.teamColor; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 7, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
        if (f.A.draw) f.A.draw(ctx, f);
        // low-HP heartbeat
        if (!f.boss && f.hp / f.maxHp < 0.25 && !look.light) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, f.x, f.y, f.r * 3, '#ff2d45', 0.3 + 0.3 * Math.max(0, Math.sin(t * 9))); ctx.globalCompositeOperation = 'source-over'; }
        if (f.slowT > 0) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#bff4ff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
        if (o.drawFighter) o.drawFighter(ctx, f); else draw.ball(ctx, f, look);
        if (f.A.over) f.A.over(ctx, f);
        if (o.hp !== false && this.hpStyle !== 'none' && !(f.boss && o.noBossHp)) {
          const hp = String(Math.max(0, Math.ceil(f.hp)));
          draw.label(ctx, hp, f.x, f.y + f.r * 0.22, Math.round(f.r * (f.boss ? 0.42 : 0.62)), '#ffffff', 900, 0.14);
        }
        if (o.tags !== false && !f.boss) this.m.tag(ctx, f, f.name + (f.level > 1 && o.levels ? ' Lv' + f.level : ''), { size: o.tagSize || 28, gap: f.ab === 'shield' ? 40 : 18, color: '#ffffff' });
      }
    }
    /** HP-bar cards for a list of fighters. */
    cards(ctx, list, o = {}) {
      const W = this.m.W, n = list.length, pal = this.m.pal, top = o.top ?? 360;
      const slide = SB.util.easeOutCubic(clamp((this.g.clock - this.g.playStart) / 0.5, 0, 1));
      const cols = o.cols || 2, compact = o.compact ?? n > 2;
      const gx = o.gap ?? (n === 2 && !o.noVs ? 110 : 20), cw = o.cw || (n === 2 && !o.noVs ? 430 : Math.floor((W - 60 - gx * (cols - 1)) / cols)), ch = compact ? 104 : 150;
      list.forEach((f, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const rowW = cols * cw + (cols - 1) * gx;
        const x = W / 2 - rowW / 2 + col * (cw + gx) + (1 - slide) * (col < cols / 2 ? -700 : 700);
        const y = top + row * (ch + 12);
        ctx.save();
        ctx.globalAlpha = f.alive ? 1 : 0.45;
        draw.panel(ctx, x, y, cw, ch, 24, this.look, 0.62);
        ctx.fillStyle = f.teamColor || f.color; draw.roundRect(ctx, x, y, 12, ch, 6); ctx.fill();
        const bs = compact ? 62 : 84;
        ctx.fillStyle = rgba(f.color, 0.22); ctx.beginPath(); ctx.arc(x + 28 + bs / 2, y + ch / 2, bs / 2, 0, TAU); ctx.fill();
        glyph(ctx, f.boss ? 'boss' : f.ab, x + 28 + bs / 2, y + ch / 2, bs * 0.55, f.color);
        const tx = x + 40 + bs;
        let nsz = compact ? 28 : 40;
        draw.font(ctx, nsz, 900);
        const maxNameW = cw - (tx - x) - (o.levels ? 70 : 16);
        while (ctx.measureText(f.name).width > maxNameW && nsz > 16) { nsz--; draw.font(ctx, nsz, 900); }
        ctx.fillStyle = f.color; ctx.fillText(f.name, tx, y + (compact ? 36 : 52));
        if (o.levels) { draw.font(ctx, compact ? 20 : 24, 900); ctx.fillStyle = '#ffd23f'; ctx.textAlign = 'right'; ctx.fillText('Lv' + f.level, x + cw - 16, y + (compact ? 34 : 50)); ctx.textAlign = 'left'; }
        draw.font(ctx, compact ? 18 : 22, 700, 'Space Grotesk');
        ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.fillText(f.A.name, tx, y + (compact ? 60 : 86));
        const aw = ctx.measureText(f.A.name + '  ').width;
        if (aw + ctx.measureText(f.A.desc).width < cw - (tx - x) - 12) { ctx.fillStyle = pal.light ? rgba(pal.text, 0.6) : 'rgba(255,255,255,0.6)'; ctx.fillText(f.A.desc, tx + aw, y + (compact ? 60 : 86)); }
        const bw = cw - (tx - x) - 20, by = y + ch - (compact ? 28 : 38), bh = compact ? 14 : 18;
        draw.roundRect(ctx, tx, by, bw, bh, bh / 2); ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.12)'; ctx.fill();
        const kLag = clamp(f.lagHp / f.maxHp, 0, 1), k = clamp(f.shownHp / f.maxHp, 0, 1);
        if (kLag > k) { draw.roundRect(ctx, tx, by, Math.max(bh, bw * kLag), bh, bh / 2); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill(); }
        if (k > 0) {
          draw.roundRect(ctx, tx, by, Math.max(bh, bw * k), bh, bh / 2);
          ctx.fillStyle = k < 0.3 ? mix('#ff3d5a', '#ffffff', f.hitT * 2) : mix(f.color, '#ffffff', f.hitT * 2); ctx.fill();
        }
        if (o.xp && f.alive) { const xk = clamp(o.xp(f), 0, 1); ctx.fillStyle = '#ffd23f'; draw.roundRect(ctx, tx, by + bh + 3, Math.max(4, bw * xk), 5, 2.5); ctx.fill(); }
        if (!f.alive) { draw.font(ctx, 40, 900); ctx.fillStyle = '#ff3d5a'; ctx.textAlign = 'right'; ctx.fillText('KO', x + cw - 18, y + ch / 2 + 14); ctx.textAlign = 'left'; }
        ctx.restore();
      });
      if (n === 2 && !o.noVs && this.g.state === 'play') {
        const pulse = 1 + 0.06 * Math.sin(this.g.clock * 6);
        ctx.save(); ctx.translate(W / 2, top + ch / 2); ctx.scale(pulse * slide, pulse * slide);
        ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.fill();
        draw.font(ctx, 38, 900); ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.fillText('VS', 0, 14);
        ctx.restore(); ctx.textAlign = 'left';
      }
      return top + Math.ceil(n / cols) * (ch + 12);
    }
  }

  Brawl.AB = AB; Brawl.AB_KEYS = AB_KEYS; Brawl.glyph = glyph;
  Brawl.abilityOptions = (withRandom = true) => (withRandom ? [['random', 'Random']] : []).concat(AB_KEYS.map((k) => [k, AB[k].name[0] + AB[k].name.slice(1).toLowerCase()]));
  /** Pick n abilities: explicit settings first, then random distinct ones. */
  Brawl.pickAbilities = (rng, n, explicit = []) => {
    const pool = rng.shuffle(AB_KEYS.slice()), out = [];
    for (let i = 0; i < n; i++) { const v = explicit[i]; out.push(v && v !== 'random' && AB[v] ? v : pool.find((k) => !out.includes(k)) || pool[i % pool.length]); }
    return out;
  };
  SB.Brawl = Brawl;
})(window.SB);
