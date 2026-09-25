/* Mode: Team Battle — 2 to 4 colour teams of ability fighters (2v2 up to 5v5). No friendly fire.
 * Last team standing wins; the MVP gets called out on the payoff card. */
'use strict';
(function (SB) {
  const { TAU, clamp, rgba, mix, darken } = SB.util;
  const Brawl = SB.Brawl, draw = SB.draw;
  const TEAM_NAMES = ['RED', 'BLUE', 'GREEN', 'GOLD', 'PINK', 'CYAN', 'PURPLE', 'ORANGE'];

  class Teams extends SB.Mode {
    init() {
      const s = this.s, T = s.teams, P = s.perTeam;
      this.cy = 1150;
      this.arena = new SB.Arena({ cx: 540, cy: this.cy, R: s.arenaSize, shape: s.shape, spin: s.spin });
      this.R0 = s.arenaSize;
      const cols = this.distinctColors(T, 10);
      const abs = Brawl.pickAbilities(this.rng, T * P, []);
      this.teams = [...Array(T)].map((_, t) => ({ t, color: this.color(cols[t]), name: this.cname(cols[t]), members: [] }));
      const r = clamp(s.fighterSize * (T * P > 8 ? 0.8 : 1), 26, 80);
      this.brawl = new Brawl(this, { arena: this.arena, speed: s.speed, damage: s.damage, onKill: (v, by) => this.onKill(v, by) });
      // teams start in wedges around the arena, members clustered
      for (let t = 0; t < T; t++) {
        const base = -Math.PI / 2 + (t / T) * TAU + (T === 2 ? Math.PI / 2 : 0);
        for (let k = 0; k < P; k++) {
          const a = base + (k - (P - 1) / 2) * (0.9 / Math.max(1, P - 1)) * (T === 2 ? 1.4 : 1);
          const rr = this.R0 * (0.62 - 0.1 * (k % 2));
          const ab = s.sameAbility ? abs[t] : abs[t * P + k];
          const f = this.brawl.add({ x: 540 + Math.cos(a) * rr, y: this.cy + Math.sin(a) * rr, r, color: this.teams[t].color, name: Brawl.AB[ab].name, ab, hp: s.hp, team: t, dir: a + Math.PI + this.rng.range(-0.7, 0.7) });
          f.teamRef = this.teams[t];
          this.teams[t].members.push(f);
        }
      }
      this.trailLen = 8;
      this.sudden = false;
    }
    roster() { return this.teams.map((tm) => ({ name: tm.name + ' TEAM', color: tm.color, label: tm.members.map((f) => f.A.name).join(' · ') })); }
    trailBalls() { return this.brawl.fighters.concat(this.brawl.minions); }
    teamHp(tm) { return tm.members.reduce((a, f) => a + Math.max(0, f.hp), 0) / tm.members.reduce((a, f) => a + f.maxHp, 0); }
    aliveTeams() { return this.teams.filter((tm) => tm.members.some((f) => f.alive)); }
    onKill(v, by) {
      const g = this.g, tm = v.teamRef, left = this.aliveTeams();
      const teamOut = !tm.members.some((f) => f.alive);
      if (left.length === 1) {
        const w = left[0];
        const mvp = w.members.slice().sort((a, b) => (b.kills - a.kills) || (b.dealt - a.dealt))[0];
        const alive = w.members.filter((f) => f.alive).length;
        g.win({ title: `${w.name} TEAM WINS!`, sub: `MVP: ${mvp.A.name} · ${mvp.kills} KO · ${alive}/${w.members.length} survived`, color: w.color, y: 780, fx: v.x, fy: v.y });
        return;
      }
      if (teamOut) {
        this.fx.banner(`${tm.name} TEAM ELIMINATED`, tm.color, { size: 64, y: 0.5, dur: 1.4 });
        g.moment({ x: v.x, y: v.y, zoom: 1.14, slow: 0.3, dur: 0.7 });
        this.snd.sfx('crush', 0.6);
      } else {
        g.moment({ x: v.x, y: v.y, zoom: 1.08, slow: 0.5, dur: 0.4 });
        this.fx.popup(v.x, v.y - 70, `${v.A.name} DOWN`, v.color, 48);
        // last member standing callout
        const mates = tm.members.filter((f) => f.alive);
        if (mates.length === 1 && tm.members.length > 1) this.fx.banner(`${tm.name}: LAST ONE STANDING`, tm.color, { size: 50, y: 0.34, dur: 1.1 });
      }
      if (by && by.kills === 3) this.fx.banner(`${by.teamRef.name} ${by.A.name}: TRIPLE KO!`, by.color, { size: 56, y: 0.3, dur: 1.2 });
    }
    update(dt) {
      const s = this.s, g = this.g, B = this.brawl;
      const left = this.aliveTeams();
      const hps = left.map((tm) => this.teamHp(tm));
      const low = hps.length ? Math.min(...hps) : 1;
      g.tension = clamp(1 - hps.reduce((a, b) => a + b, 0) / Math.max(1, hps.length) + (this.teams.length - left.length) / this.teams.length * 0.5, 0, 1);
      g.danger = left.length === 2 && low < 0.15 && g.state === 'play' ? 0.2 : 0;
      if (s.sudden && !this.sudden && g.time > g.targetLen * 0.75 && g.state === 'play') {
        this.sudden = B.sudden = true; this.fx.banner('SUDDEN DEATH', '#ff3d5a', { size: 80, y: 0.5, dur: 1.6 }); this.snd.sfx('riser', 0.6); g.shake(0.3);
      }
      if (this.sudden && g.state === 'play') this.arena.R = Math.max(this.R0 * 0.62, this.arena.R - dt * 18);
      this.arena.update(dt);
      if (this.arena.morphed) { this.fx.banner(this.arena.label.toUpperCase() + '!', this.pal.accent, { size: 60, y: 0.3, dur: 0.9 }); this.snd.sfx('whoosh', 0.5); }
      if (s.assist && g.state === 'play' && !this.sudden) {
        // the weakest team should run out of HP close to the target length
        const exp = 1 - clamp(g.time / (g.targetLen * 0.82), 0, 1);
        if (low < exp - 0.12) B.dmgMul = Math.max(s.damage * 0.3, B.dmgMul * (1 - dt * 0.8));
        else if (low > exp + 0.1) B.dmgMul = Math.min(s.damage * 5, B.dmgMul * (1 + dt * 0.6));
      }
      if (this.sudden && g.state === 'play') B.dmgMul = Math.min(s.damage * 8, B.dmgMul * (1 + dt * 0.12));
      B.update(dt);
    }
    forceEnd() { this.brawl.dmgMul = this.s.damage * 5; }
    audit() { const v = []; for (const b of this.brawl.alive()) if (this.arena.audit(b)) v.push('ball outside arena'); return v; }
    render(ctx) {
      const pal = this.pal, A = this.arena;
      A.path(ctx, 0); ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)'; ctx.fill();
      // faint team-colour wedges on the floor
      ctx.save(); A.path(ctx, 0); ctx.clip();
      const T = this.teams.length;
      this.teams.forEach((tm, t) => {
        const base = -Math.PI / 2 + (t / T) * TAU + (T === 2 ? Math.PI / 2 : 0);
        ctx.fillStyle = rgba(tm.color, tm.members.some((f) => f.alive) ? 0.07 : 0.02);
        ctx.beginPath(); ctx.moveTo(540, this.cy); ctx.arc(540, this.cy, 1000, base - Math.PI / T, base + Math.PI / T); ctx.closePath(); ctx.fill();
      });
      ctx.restore();
      ctx.lineJoin = 'round';
      A.path(ctx, 6); ctx.lineWidth = 12;
      ctx.strokeStyle = this.sudden ? mix('#ff3d5a', '#ffffff', 0.5 + 0.5 * Math.sin(this.g.clock * 10)) : (pal.light ? 'rgba(40,20,60,0.35)' : 'rgba(255,255,255,0.35)'); ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.5; A.path(ctx, -10); ctx.lineWidth = 3; ctx.strokeStyle = pal.accent; ctx.stroke(); ctx.restore();
      this.brawl.render(ctx, { tagSize: 22 });
    }
    hud(ctx) {
      const pal = this.pal, W = this.W, T = this.teams.length;
      const cols = T <= 2 ? 2 : 2, rows = Math.ceil(T / cols), gap = T === 2 ? 110 : 20;
      const cw = T === 2 ? 430 : (W - 60 - gap) / 2, ch = T > 2 ? 96 : 120, top = 330;
      const slide = SB.util.easeOutCubic(clamp((this.g.clock - this.g.playStart) / 0.5, 0, 1));
      this.teams.forEach((tm, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = W / 2 - (cols * cw + gap) / 2 + col * (cw + gap) + (1 - slide) * (col ? 700 : -700), y = top + row * (ch + 12);
        const alive = tm.members.filter((f) => f.alive).length, hp = this.teamHp(tm);
        ctx.save(); ctx.globalAlpha = alive ? 1 : 0.45;
        draw.panel(ctx, x, y, cw, ch, 22, this.look, 0.64);
        ctx.fillStyle = tm.color; draw.roundRect(ctx, x, y, 12, ch, 6); ctx.fill();
        draw.font(ctx, T > 2 ? 28 : 34, 900); ctx.fillStyle = pal.light ? darken(tm.color, 0.2) : tm.color;
        ctx.fillText(tm.name, x + 28, y + (T > 2 ? 36 : 42));
        draw.font(ctx, 22, 800, 'Space Grotesk'); ctx.fillStyle = pal.light ? pal.text : '#ffffff'; ctx.textAlign = 'right';
        ctx.fillText(alive ? `${alive}/${tm.members.length} alive` : 'OUT', x + cw - 18, y + (T > 2 ? 34 : 40)); ctx.textAlign = 'left';
        // member glyph pips
        const ps = T > 2 ? 26 : 32;
        tm.members.forEach((f, k) => {
          const px = x + 28 + ps / 2 + k * (ps + 8), py = y + ch - (T > 2 ? 50 : 60) + ps / 2 - 4;
          ctx.globalAlpha = (alive ? 1 : 0.45) * (f.alive ? 1 : 0.3);
          ctx.fillStyle = f.alive ? tm.color : '#555'; ctx.beginPath(); ctx.arc(px, py, ps / 2, 0, TAU); ctx.fill();
          Brawl.glyph(ctx, f.ab, px, py, ps * 0.6, '#ffffff');
        });
        ctx.globalAlpha = alive ? 1 : 0.45;
        const bx = x + 28 + tm.members.length * (ps + 8) + 6, bw = x + cw - 18 - bx, by = y + ch - (T > 2 ? 44 : 52), bh = 14;
        draw.roundRect(ctx, bx, by, bw, bh, 7); ctx.fillStyle = pal.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.12)'; ctx.fill();
        if (hp > 0) { draw.roundRect(ctx, bx, by, Math.max(bh, bw * hp), bh, 7); ctx.fillStyle = hp < 0.3 ? '#ff3d5a' : tm.color; ctx.fill(); }
        ctx.restore();
      });
      if (T === 2 && this.g.state === 'play') {
        const pulse = 1 + 0.06 * Math.sin(this.g.clock * 6);
        ctx.save(); ctx.translate(W / 2, top + ch / 2); ctx.scale(pulse * slide, pulse * slide);
        ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.fill();
        draw.font(ctx, 38, 900); ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.fillText('VS', 0, 14);
        ctx.restore(); ctx.textAlign = 'left';
      }
    }
    stats() { return { teams: this.teams.map((tm) => tm.name + ':' + tm.members.filter((f) => f.alive).length) }; }
  }

  SB.modes.register({
    id: 'teams', name: 'Team Battle', icon: '⚑', category: 'Battles', tagline: '2v2 up to 5v5 colour teams of ability fighters — MVP at the end',
    hook: 'Which team *wins?*',
    hookY: 190,
    settings: [
      { key: 'teams', label: 'Teams', type: 'range', min: 2, max: 4, step: 1, def: 2, rand: [2, 4] },
      { key: 'perTeam', label: 'Fighters per team', type: 'range', min: 1, max: 5, step: 1, def: 3, rand: [2, 4] },
      { key: 'sameAbility', label: 'Each team shares one ability', type: 'toggle', def: false, rand: [false, false, true] },
      { key: 'hp', label: 'HP', type: 'range', min: 20, max: 300, step: 10, def: 70, rand: [50, 90] },
      { key: 'damage', label: 'Damage multiplier', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1, rand: [0.8, 1.3] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1000, step: 10, def: 480, rand: [400, 600] },
      { key: 'fighterSize', label: 'Fighter size', type: 'range', min: 26, max: 70, step: 1, def: 44, rand: [38, 50] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(true), rand: ['circle', 'circle', 'hexagon', 'octagon', 'square', 'morph'] },
      { key: 'spin', label: 'Arena spin', type: 'range', min: -2, max: 2, step: 0.05, def: 0, rand: [-0.4, 0.4], show: (s) => s.shape !== 'circle' },
      { key: 'arenaSize', label: 'Arena size', type: 'range', min: 340, max: 520, step: 5, def: 480, rand: [450, 500] },
      { key: 'sudden', label: 'Sudden death (arena shrinks)', type: 'toggle', def: true, rand: false },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: '3v3 Classic', s: { teams: 2, perTeam: 3 } },
      { name: '2v2 Duos', s: { teams: 2, perTeam: 2, hp: 90, fighterSize: 50 } },
      { name: '5v5 Skirmish', s: { teams: 2, perTeam: 5, hp: 50, fighterSize: 36 } },
      { name: '4-Team Free-For-All', s: { teams: 4, perTeam: 2, shape: 'octagon', spin: 0.2 } },
      { name: 'Ability Squads', s: { teams: 3, perTeam: 3, sameAbility: true } },
      { name: 'Shape-Shift Wars', s: { teams: 2, perTeam: 3, shape: 'morph' }, look: { bg: 'grid' } },
    ],
    create: (g, s) => new Teams(g, s),
  });
})(window.SB);
