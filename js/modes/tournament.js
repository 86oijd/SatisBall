/* Mode: Tournament — 4 or 8 ability fighters in a knockout bracket. Every match is a 1v1 brawl;
 * the bracket fills in live at the top and the champion lifts the trophy. */
'use strict';
(function (SB) {
  const { TAU, clamp, rgba, mix, easeOutBack } = SB.util;
  const Brawl = SB.Brawl, draw = SB.draw;
  const BETWEEN = 1.9;

  class Tournament extends SB.Mode {
    init() {
      const s = this.s, g = this.g, n = +s.fighters === 4 ? 4 : 8;
      this.cy = 1185;
      this.arena = new SB.Arena({ cx: 540, cy: this.cy, R: s.arenaSize, shape: s.shape, spin: s.spin });
      this.R0 = s.arenaSize;
      const abs = Brawl.pickAbilities(this.rng, n, []);
      const cols = this.distinctColors(n, 12);
      this.entrants = [...Array(n)].map((_, i) => ({ i, name: this.cname(cols[i]), color: this.color(cols[i]), ab: abs[i], wins: 0, out: false, dealt: 0, kos: 0 }));
      // bracket: rounds[r][j] = { a, b, winner }; winners feed rounds[r + 1][j >> 1]
      this.rounds = [];
      for (let k = n / 2; k >= 1; k /= 2) this.rounds.push([...Array(k)].map(() => ({ a: null, b: null, winner: null, t: -9 })));
      this.rounds[0].forEach((m, j) => { m.a = this.entrants[j * 2]; m.b = this.entrants[j * 2 + 1]; });
      // time budget (long-form): matches get more time as the stakes rise
      const L = clamp(g.targetLen * (n === 8 ? 2.5 : 1.5), n === 8 ? 50 : 30, n === 8 ? 160 : 100);
      g.targetLen = L;
      const w = (r) => (r === this.rounds.length - 1 ? 1.5 : r === this.rounds.length - 2 ? 1 : 0.8);
      const sumW = this.rounds.reduce((a, rd, r) => a + rd.length * w(r), 0);
      this.matchLen = (r) => (L * 0.94 - (n - 2) * BETWEEN) * w(r) / sumW;
      this.r = 0; this.j = 0; this.phase = 'match'; this.phaseT = 0; this.dmgMul = s.damage;
      this.trailLen = 10;
      this.startMatch();
    }
    roster() { return this.entrants.map((e) => ({ name: e.name, color: e.color, label: Brawl.AB[e.ab].name })); }
    get match() { return this.rounds[this.r][this.j]; }
    roundName(r = this.r) {
      const left = this.rounds.length - r;
      return left === 1 ? 'THE FINAL' : left === 2 ? 'SEMI-FINAL' : 'QUARTER-FINAL';
    }
    startMatch() {
      const s = this.s, g = this.g, m = this.match;
      this.arena.R = this.R0;
      this.brawl = new Brawl(this, { arena: this.arena, speed: s.speed, damage: this.dmgMul, onKill: (t, by) => this.onKill(t, by) });
      const r = s.fighterSize;
      [m.a, m.b].forEach((e, k) => {
        const f = this.brawl.add({ x: 540 + (k ? 1 : -1) * this.R0 * 0.5, y: this.cy + this.rng.range(-40, 40), r, color: e.color, name: e.name, ab: e.ab, hp: s.hp, team: k, dir: (k ? Math.PI : 0) + this.rng.range(-0.9, 0.9) });
        f.entrant = e;
        this.fx.ring(f.x, f.y, e.color, 180, 0.5, 8);
      });
      this.matchStart = g.time; this.sudden = false;
      const count = this.rounds[this.r].length;
      const final = this.rounds.length - this.r === 1;
      this.fx.banner(this.roundName() + (count > 1 ? ' ' + (this.j + 1) : ''), final ? '#ffd23f' : this.pal.accent, { size: final ? 96 : 76, y: 0.5, dur: 1.3, sub: `${m.a.name} vs ${m.b.name}` });
      if (this.r > 0 || this.j > 0) { this.snd.sfx('go', 0.6, 0); this.snd.sfx('whoosh', 0.45, 0, 0.9); g.shake(0.2); }
      if (final) { this.snd.sfx('riser', 0.55); g.moment({ zoom: 1.05, dur: 0.9 }); }
    }
    onKill(t, by) {
      const g = this.g, m = this.match;
      const w = this.brawl.alive()[0];
      if (!w) return;
      const e = w.entrant, lose = t.entrant;
      e.wins++; e.dealt += w.dealt; e.kos++; lose.out = true;
      m.winner = e; m.t = g.clock;
      const nextR = this.rounds[this.r + 1];
      if (!nextR) {
        this.fx.burst(w.x, w.y, w.color, 60, 1000);
        g.win({ title: `${e.name} IS CHAMPION!`, sub: `${Brawl.AB[e.ab].name} · ${e.wins} wins · ${e.dealt} damage`, color: e.color, y: 800, fx: t.x, fy: t.y, trophy: true });
        return;
      }
      const slot = nextR[this.j >> 1];
      if (this.j % 2) slot.b = e; else slot.a = e;
      this.phase = 'between'; this.phaseT = 0;
      g.moment({ x: t.x, y: t.y, zoom: 1.16, slow: 0.3, dur: 0.7 });
      this.fx.banner(`${e.name} ADVANCES!`, e.color, { size: 70, y: 0.5, sub: `${lose.name} is knocked out`, dur: 1.5 });
      this.snd.sfx('shimmer', 0.6, 0, 1, 0.25);
    }
    update(dt) {
      const s = this.s, g = this.g, B = this.brawl;
      const done = this.rounds.reduce((a, rd) => a + rd.filter((m) => m.winner).length, 0);
      const alive = B.alive();
      const low = alive.length ? Math.min(...alive.map((f) => f.hp / f.maxHp)) : 1;
      const isFinal = this.rounds.length - this.r === 1;
      g.tension = clamp(done / (this.entrants.length - 1) * 0.7 + (1 - low) * 0.3 + (isFinal ? 0.2 : 0), 0, 1);
      g.danger = this.phase === 'match' && alive.length === 2 && low < 0.2 ? 0.2 : 0;
      if (this.phase === 'between') {
        this.phaseT += dt;
        if (this.phaseT > BETWEEN && g.state === 'play') {
          this.dmgMul = B.dmgMul;
          this.j++;
          if (this.j >= this.rounds[this.r].length) { this.r++; this.j = 0; }
          this.phase = 'match'; this.startMatch();
          return;
        }
      } else if (g.state === 'play') {
        const el = g.time - this.matchStart, T = this.matchLen(this.r);
        if (s.assist) {
          const exp = 1 - clamp(el / (T * 0.9), 0, 1);
          if (low < exp - 0.12) B.dmgMul = Math.max(s.damage * 0.3, B.dmgMul * (1 - dt * 0.8));
          else if (low > exp + 0.1) B.dmgMul = Math.min(s.damage * 4, B.dmgMul * (1 + dt * 0.6));
        }
        if (!this.sudden && el > T * 1.25) {
          this.sudden = B.sudden = true;
          this.fx.banner('SUDDEN DEATH', '#ff3d5a', { size: 70, y: 0.5, dur: 1.2 }); this.snd.sfx('riser', 0.5);
        }
        if (this.sudden) this.arena.R = Math.max(this.R0 * 0.62, this.arena.R - dt * 26);
      }
      this.arena.update(dt);
      B.update(dt);
    }
    forceEnd() { this.brawl.dmgMul = this.s.damage * 6; }
    trailBalls() { return this.brawl.fighters.concat(this.brawl.minions); }
    audit() { const v = []; for (const b of this.brawl.alive()) if (this.arena.audit(b)) v.push('ball outside arena'); return v; }
    render(ctx) {
      const pal = this.pal, A = this.arena;
      A.path(ctx, 0); ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.lineJoin = 'round';
      const final = this.rounds.length - this.r === 1;
      A.path(ctx, 6); ctx.lineWidth = 12;
      ctx.strokeStyle = this.sudden ? mix('#ff3d5a', '#ffffff', 0.5 + 0.5 * Math.sin(this.g.clock * 10)) : final ? rgba('#ffd23f', 0.7) : (pal.light ? 'rgba(40,20,60,0.35)' : 'rgba(255,255,255,0.35)');
      ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.5; A.path(ctx, -10); ctx.lineWidth = 3; ctx.strokeStyle = pal.accent; ctx.stroke(); ctx.restore();
      this.brawl.render(ctx);
    }
    hud(ctx) {
      this.bracket(ctx);
      const fs = this.brawl.fighters;
      if (fs.length === 2) this.brawl.cards(ctx, fs, { top: 636, compact: true });
    }
    bracket(ctx) {
      const pal = this.pal, W = this.W, R = this.rounds.length, g = this.g;
      const top = 318, bottom = 560, dy = (bottom - top) / R;
      const rowY = (r) => bottom - r * dy; // r = 0 entrants ... R = champion
      const slots = (r) => (r === 0 ? this.entrants : r === R ? [this.rounds[R - 1][0].winner] : this.rounds[r].flatMap((mm) => [mm.a, mm.b]));
      const nSlots = (r) => this.entrants.length >> r;
      const xOf = (r, j) => { const k = nSlots(r), sw = (W - 80) / k; return 40 + sw * (j + 0.5); };
      const chipW = (r) => Math.min(250, (W - 80) / nSlots(r) - 12), ch = Math.min(50, dy - 16);
      // connector lines
      ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let r = 0; r < R; r++) {
        const list = slots(r);
        for (let j = 0; j < list.length; j++) {
          const e = list[j], mm = this.rounds[r][j >> 1];
          const won = e && mm.winner === e;
          const x1 = xOf(r, j), y1 = rowY(r) - ch / 2, x2 = xOf(r + 1, j >> 1), y2 = rowY(r + 1) + ch / 2, ym = (y1 + y2) / 2;
          ctx.strokeStyle = won ? e.color : (pal.light ? 'rgba(40,20,60,0.2)' : 'rgba(255,255,255,0.18)');
          ctx.globalAlpha = won ? 0.95 : 1;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, ym); ctx.lineTo(x2, ym); ctx.lineTo(x2, y2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // chips
      const cur = g.state === 'play' && this.phase === 'match' ? this.match : null;
      for (let r = 0; r <= R; r++) {
        const list = slots(r), cw = chipW(r);
        for (let j = 0; j < list.length; j++) {
          const e = list[j], x = xOf(r, j) - cw / 2, y = rowY(r) - ch / 2;
          let sc = 1;
          if (r > 0 && e) sc = easeOutBack(clamp((g.clock - this.slotTime(r, e) - 0.15) / 0.4, 0, 1));
          ctx.save(); ctx.translate(x + cw / 2, y + ch / 2); ctx.scale(sc, sc); ctx.translate(-cw / 2, -ch / 2);
          const lost = e && this.lostAt(r, e);
          ctx.globalAlpha = lost ? 0.4 : 1;
          draw.panel(ctx, 0, 0, cw, ch, ch / 2, this.look, 0.7);
          if (e) {
            const live = cur && (cur.a === e || cur.b === e) && r === this.r;
            if (live) { ctx.strokeStyle = mix(e.color, '#ffffff', 0.5 + 0.5 * Math.sin(g.clock * 8)); ctx.lineWidth = 4; draw.roundRect(ctx, 0, 0, cw, ch, ch / 2); ctx.stroke(); }
            const br = ch * 0.36;
            ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(ch / 2, ch / 2, br, 0, TAU); ctx.fill();
            Brawl.glyph(ctx, e.ab, ch / 2, ch / 2, br * 1.1, '#ffffff');
            let fsz = r === R ? 28 : cw > 180 ? 24 : 18;
            draw.font(ctx, fsz, 900);
            while (ctx.measureText(e.name).width > cw - ch - 12 && fsz > 11) { fsz--; draw.font(ctx, fsz, 900); }
            ctx.fillStyle = pal.light ? SB.util.darken(e.color, 0.25) : e.color; ctx.fillText(e.name, ch + 2, ch / 2 + fsz * 0.36);
            if (lost) { ctx.strokeStyle = '#ff3d5a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(10, ch / 2); ctx.lineTo(cw - 10, ch / 2); ctx.stroke(); }
            if (r === R) draw.crown(ctx, cw / 2, -14, 0.34, '#ffd23f');
          } else {
            draw.font(ctx, 24, 900); ctx.textAlign = 'center'; ctx.fillStyle = pal.light ? rgba(pal.text, 0.4) : 'rgba(255,255,255,0.35)';
            ctx.fillText(r === R ? '🏆' : '?', cw / 2, ch / 2 + 9); ctx.textAlign = 'left';
          }
          ctx.restore();
        }
      }
    }
    slotTime(r, e) { const mm = this.rounds[r - 1].find((q) => q.winner === e); return mm ? mm.t : -9; }
    lostAt(r, e) { if (r >= this.rounds.length) return false; const mm = this.rounds[r].find((q) => q.a === e || q.b === e); return !!(mm && mm.winner && mm.winner !== e); }
    stats() { return { champion: this.rounds[this.rounds.length - 1][0].winner?.name, matches: this.rounds.flat().map((m) => m.winner && m.winner.name) }; }
  }

  SB.modes.register({
    id: 'tournament', name: 'Tournament', icon: '🏆', category: 'Battles', tagline: 'Knockout bracket of ability fighters — who lifts the trophy?',
    hook: 'Who wins the *tournament?*',
    hookY: 180, longForm: true,
    settings: [
      { key: 'fighters', label: 'Fighters', type: 'select', def: 8, options: [[4, '4 (semis + final)'], [8, '8 (quarters, semis, final)']], rand: [4, 8, 8] },
      { key: 'hp', label: 'HP per match', type: 'range', min: 30, max: 300, step: 10, def: 80, rand: [60, 110] },
      { key: 'damage', label: 'Damage multiplier', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1.2, rand: [1, 1.5] },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1100, step: 10, def: 560, rand: [460, 680] },
      { key: 'fighterSize', label: 'Fighter size', type: 'range', min: 30, max: 80, step: 1, def: 54, rand: [48, 60] },
      { key: 'shape', label: 'Arena shape', type: 'select', def: 'circle', options: SB.Arena.options(), rand: ['circle', 'circle', 'hexagon', 'octagon'] },
      { key: 'spin', label: 'Arena spin', type: 'range', min: -2, max: 2, step: 0.05, def: 0, rand: [-0.4, 0.4], show: (s) => s.shape !== 'circle' },
      { key: 'arenaSize', label: 'Arena size', type: 'range', min: 300, max: 460, step: 5, def: 400, rand: [380, 420] },
      { key: 'assist', label: 'Pace assist', type: 'toggle', def: true, rand: false },
    ],
    presets: [
      { name: '8-Fighter Bracket', s: { fighters: 8 } },
      { name: 'Quick 4-Fighter Cup', s: { fighters: 4, hp: 100 } },
      { name: 'Hexagon Cup', s: { fighters: 8, shape: 'hexagon', spin: 0.25 }, look: { bg: 'grid' } },
      { name: 'Shape-Shift Championship', s: { fighters: 4, shape: 'morph' } },
    ],
    create: (g, s) => new Tournament(g, s),
  });
})(window.SB);
