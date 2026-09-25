/* SatisBall — base class for simulation modes. Adding a mode = subclass Mode + SB.modes.register({...}).
 *
 *  SB.modes.register({
 *    id, name, tagline, icon, hook,            // hook supports *highlight* markup
 *    settings: [{ key, label, type: 'range'|'select'|'toggle'|'color', min, max, step, def, options, rand }],
 *    presets: [{ name, s: {...settings}, look: {...}, sound: {...} }],
 *    create: (game, settings) => new MyMode(game, settings),
 *  });
 *
 *  Mode instance hooks: init(), update(dt), render(ctx) [world space], hud(ctx) [screen space],
 *  trailBalls() -> balls to sample trails for, forceEnd() -> must produce a winner (called on overtime).
 */
'use strict';
(function (SB) {
  const { TAU, clamp, rgba, lighten } = SB.util;
  const draw = SB.draw;

  class Mode {
    constructor(game, s) {
      this.g = game; this.s = s;
      this.rng = game.rng; this.fx = game.fx; this.pal = game.pal; this.snd = game.snd; this.music = game.music;
      this.W = game.W; this.H = game.H;
      this.trailLen = 14;
    }
    get look() { return this.g.look; }
    color(i) { const b = this.pal.balls; return b[((i % b.length) + b.length) % b.length].c; }
    cname(i) { const b = this.pal.balls; return b[((i % b.length) + b.length) % b.length].n; }
    /** n palette colour indices with clearly different hues (so viewers can tell fighters apart). */
    distinctColors(n, pool = 10) {
      const hue = (hex) => { const [r, g, b] = SB.util.hexToRgb(hex).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d < 0.08) return -1; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
      const cand = this.rng.shuffle([...Array(Math.min(pool, this.pal.balls.length)).keys()]);
      const out = [];
      for (const minD of [55, 38, 22, 0]) {
        for (const i of cand) {
          if (out.length >= n || out.includes(i)) continue;
          const h = hue(this.color(i));
          const ok = out.every((j) => { const h2 = hue(this.color(j)); if (h < 0 || h2 < 0) return h !== h2 || minD === 0; const dd = Math.abs(h - h2); return Math.min(dd, 360 - dd) >= minD; });
          if (ok) out.push(i);
        }
      }
      return out.slice(0, n);
    }
    /** Palette ball colour whose hue is furthest from every colour in `against` (for a hero ball). */
    contrastColor(against) {
      const hue = (hex) => { const [r, g, b] = SB.util.hexToRgb(hex).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d < 0.1) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
      const hs = against.map(hue).filter((h) => h !== null);
      let best = this.color(0), bd = -1;
      for (const b of this.pal.balls.slice(0, 8)) {
        const h = hue(b.c); if (h === null) continue;
        const d = Math.min(...hs.map((x) => { const q = Math.abs(x - h); return Math.min(q, 360 - q); }));
        if (d > bd) { bd = d; best = b.c; }
      }
      return best;
    }
    /** Setting of type 'color': '' means auto (palette index i). */
    pickColor(v, i = 0) { return v ? v : this.color(i); }
    /** Musical collision note, panned by x. */
    note(vel, x, opts) { return this.music.hit(clamp(vel, 0.15, 1), this.g.pan(x), opts); }
    velFromImpact(imp, ref = 900) { return clamp(0.3 + imp / ref, 0.3, 1); }
    /** Standard contact flourish: sparks along the normal, ball flash/squash. */
    contactFx(b, px, py, nx, ny, imp, color) {
      const k = clamp(imp / 1200, 0.2, 1.2);
      this.fx.burst(px, py, color || b.color, 4 + k * 8, 250 + imp * 0.35, { dir: Math.atan2(ny, nx), spread: 1.1, grav: 0, life: 0.6 });
      b.flash = Math.max(b.flash, 0.5 * k);
      b.squash = Math.min(0.35, 0.12 + k * 0.18); b.sqa = Math.atan2(ny, nx) + Math.PI / 2;
    }
    decayBall(b, dt) {
      b.flash = Math.max(0, b.flash - dt * 4);
      b.squash = Math.max(0, b.squash - dt * 3.5);
    }
    drawTrails(ctx, balls, widthK = 1.6, alpha = 0.5) {
      if (!this.look.trails) return;
      for (const b of balls) if (b.trail.length > 1) {
        const pts = b.alive ? b.trail.concat([[b.x, b.y]]) : b.trail;
        draw.trail(ctx, pts, b.color, b.r * widthK, this.look, alpha);
      }
    }
    drawBalls(ctx, balls, o) { for (const b of balls) if (b.alive) draw.ball(ctx, b, this.look, o); }
    /** Name tag above a ball. */
    tag(ctx, b, text, o = {}) {
      draw.font(ctx, o.size || 30, 800);
      ctx.textAlign = 'center';
      const y = b.y - b.r - (o.gap ?? 16);
      ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(text, b.x, y);
      ctx.fillStyle = o.color || '#ffffff'; ctx.fillText(text, b.x, y);
      ctx.textAlign = 'left';
    }
    /** Position-only projection back inside a circle (after ball-ball pushes). */
    keepInCircle(b, cx, cy, R) {
      const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), lim = R - b.r;
      if (d > lim && d > 0) { b.x = cx + dx / d * lim; b.y = cy + dy / d * lim; const vn = (b.vx * dx + b.vy * dy) / d; if (vn > 0) { b.vx -= 2 * vn * dx / d; b.vy -= 2 * vn * dy / d; } }
    }
    /** Integrate with gravity (semi-implicit Euler). */
    integrate(b, h, g = 0) { b.vy += g * h; b.x += b.vx * h; b.y += b.vy * h; }
    /** Keep a ball inside the screen box (used after escapes / during outros). */
    screenBox(b, e = 0.9, top = 0) {
      let hit = false;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * e; hit = true; }
      if (b.x > this.W - b.r) { b.x = this.W - b.r; b.vx = -Math.abs(b.vx) * e; hit = true; }
      if (b.y < top + b.r) { b.y = top + b.r; b.vy = Math.abs(b.vy) * e; hit = true; }
      if (b.y > this.H - b.r) { b.y = this.H - b.r; b.vy = -Math.abs(b.vy) * e; hit = true; }
      return hit;
    }
  }

  SB.Mode = Mode;
})(window.SB);
