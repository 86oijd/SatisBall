/* Mode: Ball Battles — named fighters with HP and a readable ability fight until one is left. */
'use strict';
(function (SB) {
  const { TAU, clamp, mix } = SB.util;
  const Brawl = SB.Brawl;

  class Battle extends SB.Mode {
    init() {
      const s = this.s;
      this.arena = new SB.Arena({ cx: 540, cy: 1110, R: s.arenaSize, shape: s.shape, spin: s.spin });
      this.R0 = s.arenaSize;
      const n = s.fighters;
      const abs = Brawl.pickAbilities(this.rng, n, [s.ab1, s.ab2, s.ab3, s.ab4]);
      const cols = this.distinctColors(n, 9);
      const r = s.fighterSize * (n > 2 ? 0.85 : 1);
      this.brawl = new Brawl(this, { arena: this.arena, speed: s.speed, gravity: s.gravity, damage: s.damage, onKill: (t, by) => this.onKill(t, by) });
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * TAU + (n === 2 ? Math.PI / 2 : 0);
        this.brawl.add({ x: 540 + Math.cos(a) * s.arenaSize * 0.5, y: 1110 + Math.sin(a) * s.arenaSize * 0.5, r, color: this.color(cols[i]), name: this.cname(cols[i]), ab: abs[i], hp: s.hp, team: i });
      }
      this.trailLen = 10;
      this.sudden = false;
    }
    get fighters() { return this.brawl.fighters; }
    roster() { return this.fighters.map((f) => ({ name: f.name, color: f.color, label: f.A.name })); }
    trailBalls() { return this.fighters.concat(this.brawl.minions); }
    alive() { return this.brawl.alive(); }
    onKill(t, by) {
      const left = this.alive();
      if (left.length === 1) {
        const w = left[0];
        this.fx.burst(w.x, w.y, w.color, 50, 900);
        this.g.win({ title: `${w.name} WINS!`, sub: `${w.A.name} · ${Math.max(1, Math.ceil(w.hp))} HP left`, color: w.color, y: 760, fx: t.x, fy: t.y });
      } else {
        this.g.moment({ x: t.x, y: t.y, zoom: 1.15, slow: 0.35, dur: 0.6 });
        this.fx.banner(`${t.name} IS OUT!`, t.color, { size: 72, y: 0.5, sub: by ? `by ${by.name}` : '' });
      }
    }
    update(dt) {
      const s = this.s, g = this.g, B = this.brawl;
      const alive = this.alive();
      const hpFrac = alive.reduce((a, f) => a + f.hp / f.maxHp, 0) / Math.max(1, alive.length);
      g.tension = clamp(1 - hpFrac + (this.fighters.length - alive.length) / this.fighters.length * 0.5, 0, 1);
      const low = alive.length ? Math.min(...alive.map((f) => f.hp / f.maxHp)) : 1;
      g.danger = alive.length >= 2 && low < 0.2 && g.state === 'play' ? 0.22 : 0;
      if (s.sudden && !this.sudden && g.time > g.targetLen * 0.7 && g.state === 'play') {
        this.sudden = B.sudden = true; this.fx.banner('SUDDEN DEATH', '#ff3d5a', { size: 80, y: 0.5, dur: 1.6 }); this.snd.sfx('riser', 0.6); g.shake(0.3);
        g.moment({ zoom: 1.06, dur: 0.8 });
      }
      if (this.sudden && g.state === 'play') this.arena.R = Math.max(this.R0 * 0.62, this.arena.R - dt * 18);
      this.arena.update(dt);
      if (this.arena.morphed) { this.fx.banner(this.arena.label.toUpperCase() + '!', this.pal.accent, { size: 60, y: 0.3, dur: 0.9 }); this.snd.sfx('whoosh', 0.5); }
      if (s.assist && g.state === 'play' && !this.sudden) {
        const exp = 1 - clamp(g.time / (g.targetLen * 0.8), 0, 1);
        if (low < exp - 0.12) B.dmgMul = Math.max(s.damage * 0.3, B.dmgMul * (1 - dt * 0.8));
        else if (low > exp + 0.1) B.dmgMul = Math.min(s.damage * 3, B.dmgMul * (1 + dt * 0.5));
      }
      B.update(dt);
    }
    audit() {
      const v = [];
      for (const b of this.alive()) if (this.arena.audit(b)) v.push('ball outside arena');
      return v;
    }
    forceEnd() { this.brawl.dmgMul = this.s.damage * 4; }
    render(ctx) {
      const pal = this.pal, A = this.arena;
      A.path(ctx, 0); ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.lineJoin = 'round';
      A.path(ctx, 6); ctx.lineWidth = 12;
      ctx.strokeStyle = this.sudden ? mix('#ff3d5a', '#ffffff', 0.5 + 0.5 * Math.sin(this.g.clock * 10)) : (pal.light ? 'rgba(40,20,60,0.35)' : 'rgba(255,255,255,0.35)'); ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.5; A.path(ctx, -10); ctx.lineWidth = 3; ctx.strokeStyle = pal.accent; ctx.stroke(); ctx.restore();
      this.brawl.render(ctx);
    }
    hud(ctx) { this.brawl.cards(ctx, this.fighters, { top: 360 }); }
    stats() { return { alive: this.alive().map((f) => f.name + ':' + f.ab + ':' + Math.ceil(f.hp)), all: this.fighters.map((f) => f.ab) }; }
  }

  const abOpts = Brawl.abilityOptions();
  SB.modes.register({
    id: 'battle', name: 'Ball Battles', icon: '⚔', category: 'Battles', tagline: 'Named fighters, HP bars and abilities — pick a side',
    hook: 'Who wins? *Pick a side!*',
    settings: [
      { key: 'fighters', label: 'Fighters', type: 'range', min: 2, max: 4, step: 1, def: 2, rand: [2, 4] },
      { key: 'ab1', label: 'Fighter 1 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'ab2', label: 'Fighter 2 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'] },
      { key: 'ab3', label: 'Fighter 3 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'], show: (s) => s.fighters >= 3 },
      { key: 'ab4', label: 'Fighter 4 ability', type: 'select', def: 'random', options: abOpts, rand: ['random'], show: (s) => s.fighters >= 4 },
      { key: 'hp', label: 'HP', type: 'range', min: 20, max: 400, step: 10, def: 100, rand: [80, 150] },
      { key: 'damage', label: 'Damage multiplier', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1, rand: [0.8, 1.4] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1100, step: 10, def: 520, rand: [420, 680] },
      { key: 'fighterSize', label: 'Fighter size', type: 'range', min: 30, max: 90, step: 1, def: 58, rand: [50, 66] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(), rand: ['circle', 'circle', 'hexagon', 'octagon', 'square'] },
      { key: 'spin', label: 'Arena spin', type: 'range', min: -2, max: 2, step: 0.05, def: 0, rand: [-0.6, 0.6], show: (s) => s.shape !== 'circle' },
      { key: 'arenaSize', label: 'Arena size', type: 'range', min: 300, max: 520, step: 5, def: 460, rand: [420, 490] },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2000, step: 50, def: 0, rand: [0, 0] },
      { key: 'sudden', label: 'Sudden death (arena shrinks)', type: 'toggle', def: true, rand: false },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: 'Sword vs Spikes', s: { fighters: 2, ab1: 'sword', ab2: 'spikes' } },
      { name: 'Laser vs Shield', s: { fighters: 2, ab1: 'laser', ab2: 'shield' } },
      { name: 'Archer vs Frost', s: { fighters: 2, ab1: 'archer', ab2: 'frost' }, look: { bg: 'stars' } },
      { name: 'Clone vs Growth', s: { fighters: 2, ab1: 'clone', ab2: 'growth' } },
      { name: 'Vampire vs Bomber', s: { fighters: 2, ab1: 'vampire', ab2: 'bomber' } },
      { name: '4-Way Brawl (Hexagon)', s: { fighters: 4, hp: 120, shape: 'hexagon', spin: 0.3 } },
      { name: 'Shape-Shifter Duel', s: { fighters: 2, shape: 'morph' }, look: { bg: 'grid' } },
    ],
    create: (g, s) => new Battle(g, s),
  });
})(window.SB);
