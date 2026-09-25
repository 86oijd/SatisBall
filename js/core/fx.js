/* SatisBall — visual effects & drawing helpers: particles, shake, flashes, banners, glow sprites, ball rendering, text. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, mix, lighten, darken, easeOutBack, easeOutCubic } = SB.util;

  // ------------------------------------------------------------------ sprite caches
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(lighten(color, 0.5), 0.9));
    gr.addColorStop(0.18, rgba(color, 0.55));
    gr.addColorStop(0.45, rgba(color, 0.16));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowCache.set(color, c);
    return c;
  }
  const ballCache = new Map();
  function ballSprite(color, style, big) {
    const key = color + style + (big ? 'B' : '');
    let c = ballCache.get(key);
    if (c) return c;
    const S = big ? 512 : 160, R = S / 2 - 2;
    c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const m = S / 2;
    if (style === 'neon') {
      g.fillStyle = darken(color, 0.55); g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
      g.lineWidth = R * 0.2; g.strokeStyle = color; g.beginPath(); g.arc(m, m, R * 0.88, 0, TAU); g.stroke();
      g.lineWidth = R * 0.06; g.strokeStyle = lighten(color, 0.75); g.beginPath(); g.arc(m, m, R * 0.88, 0, TAU); g.stroke();
    } else if (style === 'flat') {
      g.fillStyle = color; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
    } else {
      const gr = g.createRadialGradient(m - R * 0.38, m - R * 0.42, R * 0.05, m, m, R);
      gr.addColorStop(0, lighten(color, 0.72));
      gr.addColorStop(0.35, lighten(color, 0.12));
      gr.addColorStop(0.85, color);
      gr.addColorStop(1, darken(color, 0.28));
      g.fillStyle = gr; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
      g.lineWidth = Math.max(1.5, R * 0.035); g.strokeStyle = rgba(lighten(color, 0.6), 0.55);
      g.beginPath(); g.arc(m, m, R - g.lineWidth / 2, 0, TAU); g.stroke();
      // specular
      const sp = g.createRadialGradient(m - R * 0.35, m - R * 0.45, 0, m - R * 0.35, m - R * 0.45, R * 0.4);
      sp.addColorStop(0, 'rgba(255,255,255,0.75)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sp; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
    }
    ballCache.set(key, c);
    return c;
  }

  // ------------------------------------------------------------------ draw helpers
  const draw = {
    glow(ctx, x, y, size, color, alpha = 1) {
      if (alpha <= 0.01) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(glowSprite(color), x - size / 2, y - size / 2, size, size);
      ctx.globalAlpha = 1;
    },
    /** A shaded ball with optional glow and squash along its velocity. */
    ball(ctx, b, look, o = {}) {
      const r = o.r ?? b.r, color = o.color || b.color;
      const glowAmt = (o.glow ?? 1) * look.glow;
      if (glowAmt > 0 && !look.light) {
        ctx.globalCompositeOperation = 'lighter';
        draw.glow(ctx, b.x, b.y, r * 5.2, color, 0.5 * glowAmt + b.flash * 0.5);
        ctx.globalCompositeOperation = 'source-over';
      } else if (look.light) {
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#2a1a40';
        ctx.beginPath(); ctx.ellipse(b.x + r * 0.12, b.y + r * 0.2, r * 1.02, r, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      const spr = ballSprite(color, look.ballStyle, r > 70);
      const sq = b.squash || 0;
      if (sq > 0.01) {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.sqa || 0); ctx.scale(1 - sq * 0.5, 1 + sq * 0.35);
        ctx.drawImage(spr, -r, -r, r * 2, r * 2); ctx.restore();
      } else ctx.drawImage(spr, b.x - r, b.y - r, r * 2, r * 2);
      if (b.flash > 0.02) {
        ctx.globalAlpha = b.flash * 0.8; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
    },
    /** Tapered, fading trail from a list of [x,y] points (oldest first). */
    trail(ctx, pts, color, width, look, alpha = 0.55) {
      const n = pts.length;
      if (n < 2) return;
      ctx.lineCap = 'round';
      if (!look.light) ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = color;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        ctx.globalAlpha = alpha * t * t;
        ctx.lineWidth = width * (0.15 + 0.85 * t);
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    },
    /** Rich text with *highlight* markup, word wrap, stroke & shadow. Returns height used. */
    text(ctx, str, x, y, o = {}) {
      const size = o.size || 64, weight = o.weight || 900, font = o.font || 'Unbounded';
      ctx.font = `${weight} ${size}px ${font}, "Segoe UI Black", "Arial Black", sans-serif`;
      ctx.textBaseline = 'alphabetic';
      const maxW = o.maxWidth || 960;
      const words = String(str).split(/\s+/).filter(Boolean);
      const lines = []; let cur = [];
      const plain = (w) => w.replace(/\*/g, '');
      for (const w of words) {
        const test = cur.concat(w).map(plain).join(' ');
        if (cur.length && ctx.measureText(test).width > maxW) { lines.push(cur); cur = [w]; } else cur.push(w);
      }
      if (cur.length) lines.push(cur);
      const lh = size * (o.lineHeight || 1.12);
      const align = o.align || 'center';
      let hl = false;
      lines.forEach((ln, li) => {
        const full = ln.map(plain).join(' ');
        const W = ctx.measureText(full).width;
        let cx = align === 'center' ? x - W / 2 : align === 'right' ? x - W : x;
        const cy = y + li * lh + size * 0.8;
        const space = ctx.measureText(' ').width;
        ln.forEach((w, wi) => {
          // parse *...* spans across words
          let parts = w.split('*');
          parts.forEach((p, pi) => {
            if (pi > 0) hl = !hl;
            if (!p) return;
            const pw = ctx.measureText(p).width;
            const col = hl ? (o.highlight || '#ffd23f') : (o.color || '#ffffff');
            if (o.shadow !== false) {
              ctx.fillStyle = o.shadowColor || 'rgba(0,0,0,0.45)';
              ctx.fillText(p, cx + size * 0.045, cy + size * 0.07);
            }
            if (o.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = o.stroke; ctx.strokeStyle = o.strokeColor || 'rgba(0,0,0,0.6)'; ctx.strokeText(p, cx, cy); }
            ctx.fillStyle = col; ctx.fillText(p, cx, cy);
            cx += pw;
          });
          if (wi < ln.length - 1) cx += space;
        });
      });
      return lines.length * lh;
    },
    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    },
    font(ctx, size, weight = 800, fam = 'Unbounded') { ctx.font = `${weight} ${size}px ${fam}, "Segoe UI Black", "Arial Black", sans-serif`; },
    /** Glassy HUD panel. */
    panel(ctx, x, y, w, h, r, look, alpha = 0.55) {
      draw.roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = look.light ? `rgba(255,255,255,${alpha + 0.15})` : `rgba(8,6,20,${alpha})`;
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = look.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.10)'; ctx.stroke();
    },
    crown(ctx, x, y, s, color = '#ffd23f') {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(-50, 20); ctx.lineTo(-58, -30); ctx.lineTo(-28, -5); ctx.lineTo(0, -42); ctx.lineTo(28, -5); ctx.lineTo(58, -30); ctx.lineTo(50, 20); ctx.closePath();
      const g = ctx.createLinearGradient(0, -42, 0, 20); g.addColorStop(0, lighten(color, 0.5)); g.addColorStop(1, darken(color, 0.15));
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = darken(color, 0.4); ctx.stroke();
      ctx.fillStyle = '#ff2d75'; [-30, 0, 30].forEach((cx) => { ctx.beginPath(); ctx.arc(cx, 8, 6, 0, TAU); ctx.fill(); });
      ctx.restore();
    },
    glowSprite, ballSprite,
  };

  // ------------------------------------------------------------------ particle system
  const MAX_P = 7000;
  class FX {
    constructor(game) {
      this.g = game; this.p = []; this.free = [];
      this.trauma = 0; this.flashA = 0; this.flashC = '#ffffff';
      this.banners = []; this.popups = []; this.zoomKick = 0;
    }
    get rng() { return this.g.rng; }
    spawn() {
      if (this.p.length - this.free.length >= MAX_P * this.g.look.particles + 50) return null;
      const q = this.free.length ? this.p[this.free.pop()] : (this.p.push({}), this.p[this.p.length - 1]);
      q.on = true; q.drag = 0.985; q.grav = 0; q.rot = 0; q.vr = 0; q.add = true; q.alpha = 1; q.shrink = true;
      return q;
    }
    _mk(type, x, y, vx, vy, life, size, color) {
      const q = this.spawn(); if (!q) return null;
      q.type = type; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.life = life; q.max = life; q.size = size; q.color = color;
      return q;
    }
    /** Burst of glowing sparks. */
    burst(x, y, color, n = 20, speed = 600, o = {}) {
      n = Math.round(n * this.g.look.particles);
      const rng = this.rng;
      for (let i = 0; i < n; i++) {
        const a = o.dir !== undefined ? o.dir + rng.range(-(o.spread ?? 1), o.spread ?? 1) : rng.range(0, TAU);
        const s = speed * rng.range(0.25, 1);
        const q = this._mk(rng.chance(o.dots ?? 0.35) ? 'dot' : 'spark', x, y, Math.cos(a) * s, Math.sin(a) * s, rng.range(0.35, 0.9) * (o.life || 1), rng.range(3, 7) * (o.size || 1), o.colors ? rng.pick(o.colors) : color);
        if (q) { q.grav = o.grav ?? 300; q.drag = o.drag ?? 0.975; }
      }
    }
    /** Shatter an arc of a ring into flying fragments. */
    shatterArc(cx, cy, R, a0, span, thick, colorAt, o = {}) {
      const rng = this.rng;
      const pieces = Math.max(6, Math.round((span * R) / (o.pieceLen || 42)));
      for (let i = 0; i < pieces; i++) {
        const a = a0 + (i + 0.5) * (span / pieces);
        const px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R;
        const out = rng.range(200, 750) * (o.power || 1);
        const q = this._mk('shard', px, py, Math.cos(a) * out + rng.range(-120, 120), Math.sin(a) * out + rng.range(-120, 120), rng.range(0.9, 1.6), thick, colorAt(i / pieces));
        if (!q) break;
        q.arcR = R; q.span = span / pieces * 0.92; q.rot = a; q.vr = rng.range(-6, 6); q.grav = o.grav ?? 700; q.drag = 0.99; q.add = false; q.shrink = false;
      }
      this.burst(cx + Math.cos(a0 + span / 2) * R, cy + Math.sin(a0 + span / 2) * R, colorAt(0.5), 14, 700);
    }
    debris(x, y, w, h, color, n = 10, o = {}) {
      const rng = this.rng;
      n = Math.round(n * this.g.look.particles);
      for (let i = 0; i < n; i++) {
        const q = this._mk('chunk', x + rng.range(-w / 2, w / 2), y + rng.range(-h / 2, h / 2), rng.range(-250, 250) * (o.power || 1), rng.range(-400, 50) * (o.power || 1), rng.range(0.8, 1.5), rng.range(6, 16) * (o.size || 1), color);
        if (!q) break;
        q.grav = 1500; q.vr = rng.range(-10, 10); q.add = false; q.drag = 0.995; q.shrink = false;
      }
    }
    confetti(x, y, n = 120, colors, o = {}) {
      const rng = this.rng;
      n = Math.round(n * this.g.look.particles);
      for (let i = 0; i < n; i++) {
        const a = (o.dir ?? -Math.PI / 2) + rng.range(-(o.spread ?? 1.2), o.spread ?? 1.2);
        const s = rng.range(500, 1500) * (o.power || 1);
        const q = this._mk('confetti', x, y, Math.cos(a) * s, Math.sin(a) * s, rng.range(2, 3.6), rng.range(10, 20), rng.pick(colors));
        if (!q) break;
        q.grav = 900; q.drag = 0.965; q.vr = rng.range(-12, 12); q.phase = rng.range(0, TAU); q.add = false; q.shrink = false;
      }
    }
    ring(x, y, color, size = 200, life = 0.5, width = 10) {
      const q = this._mk('ring', x, y, 0, 0, life, size, color);
      if (q) { q.w = width; q.drag = 1; }
    }
    shake(amount) { this.trauma = clamp(this.trauma + amount, 0, 1); }
    flash(color = '#ffffff', a = 0.6) { this.flashC = color; this.flashA = Math.max(this.flashA, a); }
    kick(z = 0.03) { this.zoomKick = Math.max(this.zoomKick, z); }
    /** Big centred announcement. */
    banner(text, color, o = {}) {
      this.banners.push({ text, color: color || '#ffffff', t: 0, dur: o.dur || 1.4, size: o.size || 86, y: o.y ?? 0.42, sub: o.sub || '' });
      if (this.banners.length > 3) this.banners.shift();
    }
    popup(x, y, text, color, size = 44) { this.popups.push({ x, y, text, color, size, t: 0, dur: 0.9 }); if (this.popups.length > 40) this.popups.shift(); }

    update(dt, rdt) {
      const P = this.p;
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        if (!q.on) continue;
        q.life -= dt;
        if (q.life <= 0) { q.on = false; this.free.push(i); continue; }
        const dr = Math.pow(q.drag, dt * 60);
        q.vx *= dr; q.vy = q.vy * dr + q.grav * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
        if (q.type === 'ring') q.r = q.size * easeOutCubic(1 - q.life / q.max);
      }
      // presentation-time effects
      this.trauma = Math.max(0, this.trauma - rdt * 1.6);
      this.flashA = Math.max(0, this.flashA - rdt * 3.2);
      this.zoomKick = Math.max(0, this.zoomKick - rdt * 0.25);
      for (const b of this.banners) b.t += rdt;
      this.banners = this.banners.filter((b) => b.t < b.dur);
      for (const p of this.popups) { p.t += rdt; p.y -= rdt * 90; }
      this.popups = this.popups.filter((p) => p.t < p.dur);
    }
    render(ctx) {
      const light = this.g.look.light;
      const P = this.p;
      for (let pass = 0; pass < 2; pass++) {
        const additive = pass === 1;
        if (additive && !light) ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < P.length; i++) {
          const q = P[i];
          if (!q.on || q.add !== additive) continue;
          const t = q.life / q.max;
          const a = Math.min(1, t * 2.2) * q.alpha;
          switch (q.type) {
            case 'spark': {
              const len = Math.min(60, Math.hypot(q.vx, q.vy) * 0.03 + 4);
              const s = Math.hypot(q.vx, q.vy) || 1;
              ctx.globalAlpha = a; ctx.strokeStyle = q.color; ctx.lineWidth = q.size * (0.4 + 0.6 * t); ctx.lineCap = 'round';
              ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx / s * len, q.y - q.vy / s * len); ctx.stroke();
              break;
            }
            case 'dot': {
              const sz = q.size * 5 * (q.shrink ? 0.3 + 0.7 * t : 1);
              ctx.globalAlpha = a; ctx.drawImage(glowSprite(q.color), q.x - sz / 2, q.y - sz / 2, sz, sz);
              break;
            }
            case 'shard': {
              ctx.globalAlpha = Math.min(1, t * 1.6);
              ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
              ctx.strokeStyle = q.color; ctx.lineWidth = q.size; ctx.lineCap = 'butt';
              ctx.beginPath(); ctx.arc(-q.arcR, 0, q.arcR, -q.span / 2, q.span / 2); ctx.stroke();
              ctx.restore();
              break;
            }
            case 'chunk': {
              ctx.globalAlpha = Math.min(1, t * 2);
              ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
              ctx.fillStyle = q.color; ctx.fillRect(-q.size / 2, -q.size / 2, q.size, q.size * 0.7);
              ctx.restore();
              break;
            }
            case 'confetti': {
              ctx.globalAlpha = Math.min(1, t * 1.5);
              ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
              ctx.scale(1, Math.cos(q.phase + q.life * 9));
              ctx.fillStyle = q.color; ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
              ctx.restore();
              break;
            }
            case 'ring': {
              ctx.globalAlpha = t * 0.9; ctx.strokeStyle = q.color; ctx.lineWidth = q.w * t + 1;
              ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1, q.r || 0), 0, TAU); ctx.stroke();
              break;
            }
          }
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      // popups (world space)
      for (const p of this.popups) {
        const k = p.t / p.dur;
        const s = p.size * (k < 0.15 ? easeOutBack(k / 0.15) : 1);
        ctx.globalAlpha = 1 - Math.max(0, (k - 0.6) / 0.4);
        draw.font(ctx, s, 900); ctx.textAlign = 'center';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineJoin = 'round'; ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
        ctx.globalAlpha = 1; ctx.textAlign = 'left';
      }
    }
    renderScreen(ctx, W, H) {
      for (const b of this.banners) {
        const k = b.t / b.dur;
        const s = k < 0.18 ? easeOutBack(k / 0.18) : 1;
        const a = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
        ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H * b.y); ctx.scale(s, s);
        draw.text(ctx, b.text, 0, -b.size * 0.6, { size: b.size, color: b.color, maxWidth: 980, stroke: 14, strokeColor: 'rgba(0,0,0,0.55)', shadow: false });
        if (b.sub) draw.text(ctx, b.sub, 0, b.size * 0.75, { size: b.size * 0.42, color: '#ffffff', stroke: 8, weight: 700, shadow: false });
        ctx.restore();
      }
      if (this.flashA > 0.005) {
        ctx.globalAlpha = this.flashA; ctx.fillStyle = this.flashC; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      }
    }
    clear() { this.p.length = 0; this.free.length = 0; this.banners.length = 0; this.popups.length = 0; }
  }

  SB.FX = FX;
  SB.draw = draw;
})(window.SB);
