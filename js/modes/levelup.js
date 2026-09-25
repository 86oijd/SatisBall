/* Mode: Level Up — ability fighters hunt XP orbs; every level makes their ability stronger (more blades,
 * bigger spikes, more arrows...). Hits and KOs give XP too. Last one standing wins. */
'use strict';
(function (SB) {
  const { TAU, clamp, rgba, mix, lighten, darken } = SB.util;
  const Brawl = SB.Brawl, draw = SB.draw;
  const XP0 = [0, 0, 5, 13, 24, 38, 56]; // cumulative XP needed for Lv1..Lv6 at a 35s target
  const MAX = 6;

  class LevelUp extends SB.Mode {
    init() {
      const s = this.s, n = s.fighters;
      this.cy = 1170;
      this.arena = new SB.Arena({ cx: 540, cy: this.cy, R: s.arenaSize, shape: s.shape, spin: s.spin });
      this.R0 = s.arenaSize;
      const abs = Brawl.pickAbilities(this.rng, n, [s.ab1, s.ab2, s.ab3, s.ab4]);
      const cols = this.distinctColors(n, 10);
      this.brawl = new Brawl(this, { arena: this.arena, speed: s.speed, damage: s.damage, onKill: (t, by) => this.onKill(t, by) });
      const r = s.fighterSize * (n > 2 ? 0.88 : 1);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * TAU + (n === 2 ? Math.PI / 2 : 0);
        const f = this.brawl.add({ x: 540 + Math.cos(a) * this.R0 * 0.5, y: this.cy + Math.sin(a) * this.R0 * 0.5, r, color: this.color(cols[i]), name: this.cname(cols[i]), ab: abs[i], hp: s.hp, team: i, level: 1 });
        f.xp = 0; f.orbs = 0; f.dmgXp = 0; f.r1 = r;
      }
      const k = clamp(this.g.targetLen / 35, 0.6, 2);
      this.XP = XP0.map((v) => Math.round(v * k));
      this.orbs = []; this.orbT = 0.3; this.goldT = 5; this.trailLen = 10;
      this.sudden = false;
      for (let i = 0; i < 6; i++) this.spawnOrb(false);
    }
    get fighters() { return this.brawl.fighters; }
    roster() { return this.fighters.map((f) => ({ name: f.name, color: f.color, label: f.A.name + ' · Lv1' })); }
    trailBalls() { return this.fighters.concat(this.brawl.minions); }
    spawnOrb(gold) {
      const [x, y] = this.arena.randomPoint(this.rng, 50);
      this.orbs.push({ x, y, gold, t: 0, alive: true, r: gold ? 20 : 12, ph: this.rng.range(0, TAU) });
    }
    xpFrac(f) { if (f.level >= MAX) return 1; const a = this.XP[f.level], b = this.XP[f.level + 1]; return (f.xp - a) / (b - a); }
    gainXp(f, amt) {
      if (!f.alive || f.owner) return;
      f.xp += amt;
      while (f.level < MAX && f.xp >= this.XP[f.level + 1]) this.levelUp(f);
    }
    levelUp(f) {
      const g = this.g;
      f.level++;
      if (f.A.level) f.A.level(f, f.level);
      f.maxHp += this.s.hpPerLevel; f.hp = Math.min(f.maxHp, f.hp + this.s.hpPerLevel);
      f.r = f.r1 * (1 + (f.level - 1) * 0.06); f.m = f.r * f.r;
      f.baseSpeed = this.s.speed * (1 + (f.level - 1) * 0.04);
      f.lvT = g.clock;
      this.fx.ring(f.x, f.y, '#ffd23f', f.r * 4, 0.6, 10); this.fx.embers(f.x, f.y, '#ffd23f', 24);
      this.fx.burst(f.x, f.y, '#ffd23f', 24, 700, { colors: ['#ffd23f', '#ffffff', f.color] });
      this.snd.sfx('levelup', 0.75, g.pan(f.x), 1 + f.level * 0.03);
      if (f.level >= MAX) {
        this.fx.banner(`${f.name} MAXED OUT!`, f.color, { size: 70, y: 0.5, sub: `${f.A.name} Lv${MAX} · ${f.A.desc}`, dur: 1.5 });
        g.moment({ x: f.x, y: f.y, zoom: 1.16, slow: 0.35, dur: 0.8, flash: '#ffd23f', flashA: 0.2 });
      } else {
        this.fx.popup(f.x, f.y - f.r - 60, `LEVEL UP! Lv${f.level}`, '#ffd23f', f.level >= 4 ? 52 : 44);
        if (f.level >= 4) g.moment({ x: f.x, y: f.y, zoom: 1.08, slow: 0.55, dur: 0.4 });
      }
    }
    onKill(t, by) {
      const left = this.brawl.alive();
      if (by) this.gainXp(by, this.s.koXp);
      // the fallen drop their orbs
      for (let i = 0; i < Math.min(8, 2 + (t.level | 0)); i++) { const a = this.rng.range(0, TAU), d = this.rng.range(20, 110); const x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d; if (this.arena.contains(x, y, 30)) this.orbs.push({ x, y, gold: false, t: 0, alive: true, r: 12, ph: a }); }
      if (left.length === 1) {
        const w = left[0];
        this.g.win({ title: `${w.name} WINS!`, sub: `Lv${w.level} ${w.A.name} · ${w.orbs} orbs · ${w.kills} KO`, color: w.color, y: 780, fx: t.x, fy: t.y });
      } else {
        this.g.moment({ x: t.x, y: t.y, zoom: 1.14, slow: 0.35, dur: 0.6 });
        this.fx.banner(`${t.name} IS OUT!`, t.color, { size: 72, y: 0.5, sub: by ? `${by.name} +${this.s.koXp} XP` : '' });
      }
    }
    update(dt) {
      const s = this.s, g = this.g, B = this.brawl;
      const alive = B.alive();
      const low = alive.length ? Math.min(...alive.map((f) => f.hp / f.maxHp)) : 1;
      const lv = alive.reduce((a, f) => a + f.level, 0) / Math.max(1, alive.length);
      g.tension = clamp((1 - low) * 0.6 + (lv - 1) / (MAX - 1) * 0.4 + (this.fighters.length - alive.length) / this.fighters.length * 0.3, 0, 1);
      g.danger = alive.length >= 2 && low < 0.2 && g.state === 'play' ? 0.2 : 0;
      // orbs
      if (g.state === 'play') {
        this.orbT -= dt * s.orbRate; this.goldT -= dt;
        if (this.orbT <= 0) { this.orbT = 0.5; if (this.orbs.length < 16) this.spawnOrb(false); }
        if (this.goldT <= 0) { this.goldT = 6.5; this.spawnOrb(true); this.fx.popup(this.orbs[this.orbs.length - 1].x, this.orbs[this.orbs.length - 1].y - 40, '+4 XP', '#ffd23f', 34); }
      }
      for (const o of this.orbs) {
        o.t += dt;
        for (const f of alive) {
          const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy);
          if (d < f.r + 90) { const k = Math.min(1, dt * 7); o.x += dx * k * 0.5; o.y += dy * k * 0.5; } // magnet
          if (d < f.r + o.r) {
            o.alive = false; f.orbs++;
            this.gainXp(f, o.gold ? 4 : 1);
            this.fx.burst(o.x, o.y, o.gold ? '#ffd23f' : '#7df9ff', o.gold ? 18 : 7, 400, { grav: 0 });
            f.pickN = g.clock - (f.pickT || -9) < 1 ? (f.pickN || 0) + 1 : 0; f.pickT = g.clock;
            this.snd.sfx('coin', o.gold ? 0.7 : 0.4, g.pan(o.x), 1 + Math.min(10, f.pickN) * 0.06 + (o.gold ? -0.2 : 0));
            if (o.gold) this.fx.popup(o.x, o.y - 40, '+4 XP', '#ffd23f', 40);
            break;
          }
        }
      }
      this.orbs = this.orbs.filter((o) => o.alive);
      // fighters drift towards the nearest orb (they're hunting XP)
      if (s.hunt > 0) for (const f of alive) {
        let best = null, bd = 1e9;
        for (const o of this.orbs) { const d = (o.x - f.x) ** 2 + (o.y - f.y) ** 2; if (d < bd) { bd = d; best = o; } }
        if (!best) continue;
        const want = Math.atan2(best.y - f.y, best.x - f.x), cur = Math.atan2(f.vy, f.vx), turn = s.hunt * dt;
        const a = cur + clamp(SB.util.angleDiff(cur, want), -turn, turn), sp = f.speed; f.vx = Math.cos(a) * sp; f.vy = Math.sin(a) * sp;
      }
      // damage -> XP
      for (const f of alive) { const earned = Math.floor(f.dealt / 12); if (earned > f.dmgXp) { this.gainXp(f, earned - f.dmgXp); f.dmgXp = earned; } }
      if (s.sudden && !this.sudden && g.time > g.targetLen * 0.75 && g.state === 'play') {
        this.sudden = B.sudden = true; this.fx.banner('SUDDEN DEATH', '#ff3d5a', { size: 80, y: 0.5, dur: 1.6 }); this.snd.sfx('riser', 0.6); g.shake(0.3);
      }
      if (this.sudden && g.state === 'play') { this.arena.R = Math.max(this.R0 * 0.62, this.arena.R - dt * 18); B.dmgMul = Math.min(s.damage * 8, B.dmgMul * (1 + dt * 0.1)); }
      this.arena.update(dt);
      if (s.assist && g.state === 'play' && !this.sudden) {
        const exp = 1 - clamp(g.time / (g.targetLen * 0.8), 0, 1);
        // level-ups heal, so ramp slowly and cap early (a burst of luck must not end it in 10s)
        const cap = s.damage * (1 + 1.4 * clamp(g.time / g.targetLen, 0, 1));
        if (low < exp - 0.12) B.dmgMul = Math.max(s.damage * 0.3, B.dmgMul * (1 - dt * 0.8));
        else if (low > exp + 0.1) B.dmgMul = Math.min(cap, B.dmgMul * (1 + dt * 0.25));
        if (B.dmgMul > cap) B.dmgMul = cap;
      }
      B.update(dt);
    }
    forceEnd() { this.brawl.dmgMul = this.s.damage * 6; }
    audit() { const v = []; for (const b of this.brawl.alive()) if (this.arena.audit(b)) v.push('ball outside arena'); return v; }
    render(ctx) {
      const pal = this.pal, A = this.arena, g = this.g;
      A.path(ctx, 0); ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.lineJoin = 'round';
      A.path(ctx, 6); ctx.lineWidth = 12;
      ctx.strokeStyle = this.sudden ? mix('#ff3d5a', '#ffffff', 0.5 + 0.5 * Math.sin(g.clock * 10)) : (pal.light ? 'rgba(40,20,60,0.35)' : 'rgba(255,255,255,0.35)'); ctx.stroke();
      // orbs
      ctx.save();
      if (!this.look.light) {
        ctx.globalCompositeOperation = 'lighter';
        for (const o of this.orbs) draw.glow(ctx, o.x, o.y, o.r * 4, o.gold ? '#ffd23f' : '#5ff2ff', 0.45 * Math.min(1, o.t * 4));
        ctx.globalCompositeOperation = 'source-over';
      }
      for (const o of this.orbs) {
        const s = Math.min(1, o.t * 5) * (1 + 0.12 * Math.sin(g.clock * 6 + o.ph)), r = o.r * s;
        ctx.fillStyle = o.gold ? '#ffd23f' : '#7df9ff'; ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(o.x - r * 0.25, o.y - r * 0.25, r * 0.4, 0, TAU); ctx.fill();
        if (o.gold) { draw.font(ctx, Math.round(r * 1.1), 900); ctx.textAlign = 'center'; ctx.fillStyle = '#7a4a00'; ctx.fillText('XP', o.x, o.y + r * 0.38); ctx.textAlign = 'left'; }
      }
      ctx.restore();
      this.brawl.render(ctx, {
        levels: true,
        drawFighter: (c, f) => {
          // level aura: rings stack up with the level, gold at max
          if (f.level > 1) {
            c.save(); c.lineWidth = 3; c.strokeStyle = f.level >= MAX ? '#ffd23f' : rgba(lighten(f.color, 0.4), 0.8);
            for (let k = 1; k < f.level; k++) { c.globalAlpha = 0.25 + 0.1 * k; c.beginPath(); c.arc(f.x, f.y, f.r + 6 + k * 5, g.clock * (k % 2 ? 1.4 : -1.4), g.clock * (k % 2 ? 1.4 : -1.4) + 4.2); c.stroke(); }
            c.restore();
          }
          draw.ball(c, f, this.look);
          const lt = g.clock - (f.lvT ?? -9);
          if (lt < 0.5) { c.globalAlpha = 1 - lt * 2; c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(f.x, f.y, f.r, 0, TAU); c.fill(); c.globalAlpha = 1; }
        },
      });
    }
    hud(ctx) { this.brawl.cards(ctx, this.fighters, { top: 340, levels: true, xp: (f) => this.xpFrac(f) }); }
    stats() { return { levels: this.fighters.map((f) => f.name + ':' + f.level), alive: this.brawl.alive().map((f) => f.name) }; }
  }

  const abOpts = Brawl.abilityOptions();
  SB.modes.register({
    id: 'levelup', name: 'Level Up', icon: '⬆', category: 'Battles', tagline: 'Fighters hunt XP orbs — every level upgrades their ability',
    hook: 'Every orb makes them *stronger*',
    hookY: 190,
    settings: [
      { key: 'fighters', label: 'Fighters', type: 'range', min: 2, max: 4, step: 1, def: 2, rand: [2, 4] },
      { key: 'ab1', label: 'Fighter 1 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'ab2', label: 'Fighter 2 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'ab3', label: 'Fighter 3 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'], show: (s) => s.fighters >= 3 },
      { key: 'ab4', label: 'Fighter 4 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'], show: (s) => s.fighters >= 4 },
      { key: 'hp', label: 'Starting HP', type: 'range', min: 30, max: 300, step: 10, def: 100, rand: [80, 130] },
      { key: 'hpPerLevel', label: 'Max HP per level', type: 'range', min: 0, max: 60, step: 5, def: 15, rand: [10, 25] },
      { key: 'orbRate', label: 'Orb spawn rate', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1, rand: [0.8, 1.5] },
      { key: 'hunt', label: 'How hard they chase orbs', type: 'range', min: 0, max: 3, step: 0.1, def: 0.9, rand: [0.5, 1.4] },
      { key: 'koXp', label: 'XP for a KO', type: 'range', min: 0, max: 30, step: 1, def: 10, rand: [8, 14] },
      { key: 'damage', label: 'Damage multiplier', type: 'range', min: 0.3, max: 3, step: 0.1, def: 0.9, rand: [0.8, 1.2] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1000, step: 10, def: 500, rand: [420, 600] },
      { key: 'fighterSize', label: 'Fighter size', type: 'range', min: 30, max: 80, step: 1, def: 50, rand: [44, 56] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(true), rand: ['circle', 'circle', 'hexagon', 'octagon'] },
      { key: 'spin', label: 'Arena spin', type: 'range', min: -2, max: 2, step: 0.05, def: 0, rand: [-0.4, 0.4], show: (s) => s.shape !== 'circle' },
      { key: 'arenaSize', label: 'Arena size', type: 'range', min: 340, max: 520, step: 5, def: 470, rand: [440, 490] },
      { key: 'sudden', label: 'Sudden death (arena shrinks)', type: 'toggle', def: true, rand: false },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Level Up Duel', s: { fighters: 2 } },
      { name: 'Sword vs Archer (evolve!)', s: { fighters: 2, ab1: 'sword', ab2: 'archer' } },
      { name: 'Clone vs Spikes', s: { fighters: 2, ab1: 'clone', ab2: 'spikes' } },
      { name: '4-Way XP Rush', s: { fighters: 4, orbRate: 1.6, hp: 90 } },
      { name: 'Orb Hunters', s: { fighters: 3, hunt: 2, orbRate: 2 }, look: { bg: 'stars' } },
    ],
    create: (g, s) => new LevelUp(g, s),
  });
})(window.SB);
