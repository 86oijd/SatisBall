/* SatisBall — visual effects & drawing helpers: particles, shockwaves, flares, shake, flashes, banners,
 * glow sprites, ball rendering (5 styles), trails and rich text. */
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
  const flareCache = new Map();
  function flareSprite(color) {
    let c = flareCache.get(color);
    if (c) return c;
    c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 512, 0);
    gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(0.5, rgba(lighten(color, 0.6), 0.9)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    const v = g.createLinearGradient(0, 0, 0, 64); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillRect(0, 0, 512, 64);
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = v; g.fillRect(0, 0, 512, 64);
    flareCache.set(color, c);
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
      g.lineWidth = R * 0.08; g.strokeStyle = darken(color, 0.25); g.beginPath(); g.arc(m, m, R * 0.96, 0, TAU); g.stroke();
    } else if (style === 'gem') {
      // faceted jewel
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU - Math.PI / 2, a1 = ((i + 1) / n) * TAU - Math.PI / 2;
        g.fillStyle = i % 2 ? darken(color, 0.12) : lighten(color, 0.12 + 0.2 * Math.max(0, Math.cos(a0 + 0.8)));
        g.beginPath(); g.moveTo(m, m); g.lineTo(m + Math.cos(a0) * R, m + Math.sin(a0) * R); g.lineTo(m + Math.cos(a1) * R, m + Math.sin(a1) * R); g.closePath(); g.fill();
      }
      g.fillStyle = lighten(color, 0.45);
      g.beginPath(); for (let i = 0; i < n; i++) { const a = (i / n) * TAU - Math.PI / 2; const x = m + Math.cos(a) * R * 0.5, y = m + Math.sin(a) * R * 0.5; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fill();
      g.lineWidth = R * 0.04; g.strokeStyle = rgba('#ffffff', 0.55); g.stroke();
      const sp = g.createRadialGradient(m - R * 0.3, m - R * 0.4, 0, m - R * 0.3, m - R * 0.4, R * 0.35);
      sp.addColorStop(0, 'rgba(255,255,255,0.8)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sp; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
    } else if (style === 'bubble') {
      const gr = g.createRadialGradient(m, m, R * 0.55, m, m, R);
      gr.addColorStop(0, rgba(color, 0.18)); gr.addColorStop(0.85, rgba(color, 0.55)); gr.addColorStop(1, rgba(lighten(color, 0.5), 0.95));
      g.fillStyle = gr; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(m - R * 0.38, m - R * 0.42, R * 0.22, R * 0.12, -0.7, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(m + R * 0.42, m + R * 0.38, R * 0.07, 0, TAU); g.fill();
    } else {
      const gr = g.createRadialGradient(m - R * 0.38, m - R * 0.42, R * 0.05, m, m, R);
      gr.addColorStop(0, lighten(color, 0.72));
      gr.addColorStop(0.35, lighten(color, 0.12));
      gr.addColorStop(0.85, color);
      gr.addColorStop(1, darken(color, 0.28));
      g.fillStyle = gr; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
      g.lineWidth = Math.max(1.5, R * 0.035); g.strokeStyle = rgba(lighten(color, 0.6), 0.55);
      g.beginPath(); g.arc(m, m, R - g.lineWidth / 2, 0, TAU); g.stroke();
      const sp = g.createRadialGradient(m - R * 0.35, m - R * 0.45, 0, m - R * 0.35, m - R * 0.45, R * 0.4);
      sp.addColorStop(0, 'rgba(255,255,255,0.75)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sp; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
    }
    ballCache.set(key, c);
    return c;
  }

  // ------------------------------------------------------------------ draw helpers
  const FALLBACK = '"Segoe UI Black", "Arial Black", sans-serif';
  const draw = {
    glow(ctx, x, y, size, color, alpha = 1) {
      if (alpha <= 0.01) return;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(glowSprite(color), x - size / 2, y - size / 2, size, size);
      ctx.globalAlpha = 1;
    },
    /** A shaded ball with optional glow and squash along its velocity. */
    ball(ctx, b, look, o = {}) {
      const r = o.r ?? b.r, color = o.color || b.color;
      const glowAmt = (o.glow ?? 1) * look.glow;
      if (glowAmt > 0 && !look.light) {
        ctx.globalCompositeOperation = 'lighter';
        draw.glow(ctx, b.x, b.y, Math.min(r * 5.2, r * 2 + 420), color, 0.5 * glowAmt + b.flash * 0.5);
        ctx.globalCompositeOperation = 'source-over';
      } else if (look.light) {
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#2a1a40';
        ctx.beginPath(); ctx.ellipse(b.x + r * 0.12, b.y + r * 0.2, r * 1.02, r, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      const spr = ballSprite(color, o.style || look.ballStyle, r * (look.k || 1) > 70);
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
    /** Tapered, fading trail from a list of [x,y] points (oldest first), with a soft glow underlay. */
    trail(ctx, pts, color, width, look, alpha = 0.55) {
      const n = pts.length;
      if (n < 2) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (!look.light) ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = color;
      if (!look.light && look.glow > 0.3 && n > 4) {
        // one wide low-alpha stroke over the newest half = light spill
        ctx.globalAlpha = alpha * 0.18 * look.glow; ctx.lineWidth = width * 2.2;
        ctx.beginPath(); ctx.moveTo(pts[n >> 1][0], pts[n >> 1][1]);
        for (let i = (n >> 1) + 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
      for (let i = 1; i < n; i++) {
        const t = i / n;
        ctx.globalAlpha = alpha * t * t;
        ctx.lineWidth = width * (0.15 + 0.85 * t);
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    },
    /** Rich text with *highlight* markup, word wrap, stroke, shadow, caption box or neon glow. Returns height used. */
    text(ctx, str, x, y, o = {}) {
      const size = o.size || 64, weight = o.weight || 900, font = o.font || 'Unbounded';
      ctx.font = `${weight} ${size}px "${font}", ${FALLBACK}`;
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
      if (o.box) {
        lines.forEach((ln, li) => {
          const Wd = ctx.measureText(ln.map(plain).join(' ')).width, pad = size * 0.28;
          const bx = (align === 'center' ? x - Wd / 2 : align === 'right' ? x - Wd : x) - pad;
          draw.roundRect(ctx, bx, y + li * lh - size * 0.06, Wd + pad * 2, lh + size * 0.04, size * 0.22);
          ctx.fillStyle = o.box; ctx.fill();
        });
      }
      lines.forEach((ln, li) => {
        const full = ln.map(plain).join(' ');
        const Wd = ctx.measureText(full).width;
        let cx = align === 'center' ? x - Wd / 2 : align === 'right' ? x - Wd : x;
        const cy = y + li * lh + size * 0.8;
        const space = ctx.measureText(' ').width;
        ln.forEach((w, wi) => {
          const parts = w.split('*');
          parts.forEach((p, pi) => {
            if (pi > 0) hl = !hl;
            if (!p) return;
            const pw = ctx.measureText(p).width;
            const col = hl ? (o.highlight || '#ffd23f') : (o.color || '#ffffff');
            if (o.shadow !== false && !o.glow) {
              ctx.fillStyle = o.shadowColor || 'rgba(0,0,0,0.45)';
              ctx.fillText(p, cx + size * 0.045, cy + size * 0.07);
            }
            if (o.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = o.stroke; ctx.strokeStyle = o.strokeColor || 'rgba(0,0,0,0.6)'; ctx.strokeText(p, cx, cy); }
            if (o.glow) { ctx.save(); ctx.shadowColor = hl ? col : o.glow; ctx.shadowBlur = size * 0.45; ctx.fillStyle = col; ctx.fillText(p, cx, cy); ctx.fillText(p, cx, cy); ctx.restore(); }
            ctx.fillStyle = col; ctx.fillText(p, cx, cy);
            cx += pw;
          });
          if (wi < ln.length - 1) cx += space;
        });
      });
      return lines.length * lh;
    },
    roundRect(ctx, x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    },
    font(ctx, size, weight = 800, fam = 'Unbounded') { ctx.font = `${weight} ${size}px "${fam}", ${FALLBACK}`; },
    /** Glassy HUD panel. */
    panel(ctx, x, y, w, h, r, look, alpha = 0.55) {
      draw.roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = look.light ? `rgba(255,255,255,${Math.min(0.95, alpha + 0.15)})` : `rgba(8,6,20,${alpha})`;
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = look.light ? 'rgba(40,20,60,0.12)' : 'rgba(255,255,255,0.10)'; ctx.stroke();
    },
    /** Outlined label centred at x (for tags / numbers). */
    label(ctx, text, x, y, size, color = '#ffffff', weight = 900, stroke = 0.22) {
      draw.font(ctx, size, weight); ctx.textAlign = 'center';
      ctx.lineJoin = 'round'; ctx.lineWidth = size * stroke; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.textAlign = 'left';
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
    trophy(ctx, x, y, s, color = '#ffd23f') {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      const g = ctx.createLinearGradient(0, -60, 0, 60); g.addColorStop(0, lighten(color, 0.55)); g.addColorStop(1, darken(color, 0.25));
      ctx.fillStyle = g; ctx.strokeStyle = darken(color, 0.45); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-40, -55); ctx.lineTo(40, -55); ctx.quadraticCurveTo(40, 5, 0, 12); ctx.quadraticCurveTo(-40, 5, -40, -55); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(-44, -34, 16, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); ctx.beginPath(); ctx.arc(44, -34, 16, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.lineWidth = 4; ctx.fillRect(-8, 10, 16, 26); ctx.fillRect(-30, 36, 60, 14); ctx.strokeRect(-30, 36, 60, 14);
      ctx.restore();
    },
    glowSprite, ballSprite, flareSprite,
  };

  // ------------------------------------------------------------------ particle system
  const MAX_P = 7000;
  class FX {
    constructor(game) {
      this.g = game; this.p = []; this.free = [];
      this.trauma = 0; this.flashA = 0; this.flashC = '#ffffff';
      this.banners = []; this.popups = []; this.zoomKick = 0;
      this.live = 0;
    }
    get rng() { return this.g.rng; }
    spawn() {
      if (this.live >= MAX_P * this.g.look.particles + 50) return null;
      const q = this.free.length ? this.p[this.free.pop()] : (this.p.push({}), this.p[this.p.length - 1]);
      q.on = true; q.drag = 0.985; q.grav = 0; q.rot = 0; q.vr = 0; q.add = true; q.alpha = 1; q.shrink = true; q.head = false;
      this.live++;
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
        if (q) { q.grav = o.grav ?? 300; q.drag = o.drag ?? 0.975; q.head = i < 12; }
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
        q.grav = o.grav ?? 1500; q.vr = rng.range(-10, 10); q.add = false; q.drag = 0.995; q.shrink = false;
      }
    }
    confetti(x, y, n = 120, colors, o = {}) {
      const rng = this.rng;
      n = Math.round(n * this.g.look.particles);
      for (let i = 0; i < n; i++) {
        const a = (o.dir ?? -Math.PI / 2) + rng.range(-(o.spread ?? 1.2), o.spread ?? 1.2);
        const s = rng.range(500, 1500) * (o.power || 1);
        const q = this._mk('confetti', x, y, Math.cos(a) * s, Math.sin(a) * s, rng.range(2.2, 3.8), rng.range(10, 22), rng.pick(colors));
        if (!q) break;
        q.grav = 900; q.drag = 0.965; q.vr = rng.range(-12, 12); q.phase = rng.range(0, TAU); q.add = false; q.shrink = false; q.back = darken(q.color, 0.3);
        q.sway = rng.range(0.5, 2);
      }
    }
    /** Glowing embers that drift upward (finale atmosphere, fire, level-ups). */
    embers(x, y, color, n = 20, o = {}) {
      const rng = this.rng;
      n = Math.round(n * this.g.look.particles);
      for (let i = 0; i < n; i++) {
        const q = this._mk('dot', x + rng.range(-(o.w || 40), o.w || 40), y + rng.range(-(o.h || 20), o.h || 20), rng.range(-60, 60), -rng.range(80, 260) * (o.power || 1), rng.range(0.8, 1.8), rng.range(2, 5), o.colors ? rng.pick(o.colors) : color);
        if (q) { q.grav = -40; q.drag = 0.99; }
      }
    }
    ring(x, y, color, size = 200, life = 0.5, width = 10) {
      const q = this._mk('ring', x, y, 0, 0, life, size, color);
      if (q) { q.w = width; q.drag = 1; }
    }
    /** Double shockwave with a soft glow core — for big impacts. */
    shockwave(x, y, color, size = 300) {
      this.ring(x, y, color, size, 0.55, 16);
      this.ring(x, y, '#ffffff', size * 0.65, 0.35, 6);
      const q = this._mk('flash', x, y, 0, 0, 0.3, size * 0.9, color); if (q) q.drag = 1;
    }
    /** Anamorphic lens flare streak. */
    flare(x, y, color, size = 700) {
      const q = this._mk('flare', x, y, 0, 0, 0.45, size, color); if (q) { q.drag = 1; }
    }
    shake(amount) { this.trauma = clamp(this.trauma + amount, 0, 1); }
    flash(color = '#ffffff', a = 0.6) { this.flashC = color; this.flashA = Math.max(this.flashA, a); }
    kick(z = 0.03) { this.zoomKick = Math.max(this.zoomKick, z); }
    /** Big centred announcement. */
    banner(text, color, o = {}) {
      this.banners.push({ text, color: color || '#ffffff', t: 0, dur: o.dur || 1.4, size: o.size || 86, y: o.y ?? 0.42, sub: o.sub || '' });
      if (this.banners.length > 3) this.banners.shift();
    }
    popup(x, y, text, color, size = 44) { this.popups.push({ x, y, text, color, size, t: 0, dur: 0.9, vx: 0 }); if (this.popups.length > 40) this.popups.shift(); }

    update(dt, rdt) {
      const P = this.p;
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        if (!q.on) continue;
        q.life -= dt;
        if (q.life <= 0) { q.on = false; this.free.push(i); this.live--; continue; }
        if (dt === 0) continue;
        const dr = Math.pow(q.drag, dt * 60);
        q.vx *= dr; q.vy = q.vy * dr + q.grav * dt;
        if (q.type === 'confetti') q.vx += Math.sin(q.life * 4 * q.sway + q.phase) * 120 * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
        if (q.type === 'ring') q.r = q.size * easeOutCubic(1 - q.life / q.max);
      }
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
      const heads = this.live < 1800;
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
              const s = Math.hypot(q.vx, q.vy) || 1;
              const len = Math.min(60, s * 0.03 + 4);
              ctx.globalAlpha = a; ctx.strokeStyle = q.color; ctx.lineWidth = q.size * (0.4 + 0.6 * t); ctx.lineCap = 'round';
              ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx / s * len, q.y - q.vy / s * len); ctx.stroke();
              if (q.head && heads && !light) { const hs = q.size * 5 * t; ctx.globalAlpha = a * 0.6; ctx.drawImage(glowSprite(q.color), q.x - hs / 2, q.y - hs / 2, hs, hs); }
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
              const flip = Math.cos(q.phase + q.life * 9);
              ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
              ctx.scale(1, flip);
              ctx.fillStyle = flip > 0 ? q.color : q.back; ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
              ctx.restore();
              break;
            }
            case 'ring': {
              ctx.globalAlpha = t * 0.9; ctx.strokeStyle = q.color; ctx.lineWidth = q.w * t + 1;
              ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1, q.r || 0), 0, TAU); ctx.stroke();
              break;
            }
            case 'flash': {
              if (light) break;
              const sz = q.size * (1.2 - 0.4 * t);
              ctx.globalAlpha = t * 0.8; ctx.drawImage(glowSprite(q.color), q.x - sz / 2, q.y - sz / 2, sz, sz);
              break;
            }
            case 'flare': {
              if (light) break;
              const w = q.size * (0.6 + 0.4 * (1 - t)), h = q.size * 0.07;
              ctx.globalAlpha = t; ctx.drawImage(flareSprite(q.color), q.x - w / 2, q.y - h / 2, w, h);
              ctx.globalAlpha = t * 0.9; ctx.drawImage(glowSprite('#ffffff'), q.x - h * 1.5, q.y - h * 1.5, h * 3, h * 3);
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
        const hw = ctx.measureText(p.text).width / 2 + 10, cx = this.g.cam.x, px = clamp(p.x, cx + hw, cx + 1080 - hw);
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineJoin = 'round'; ctx.strokeText(p.text, px, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, px, p.y);
        ctx.globalAlpha = 1; ctx.textAlign = 'left';
      }
    }
    renderScreen(ctx, W, H) {
      for (const b of this.banners) {
        const k = b.t / b.dur;
        const s = k < 0.18 ? easeOutBack(k / 0.18) : 1;
        const a = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
        ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H * b.y);
        // streak behind the text for instant readability
        if (!this.g.look.light) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.55 * Math.min(1, k * 6); ctx.drawImage(flareSprite(b.color), -W * 0.6 * s, -b.size * 0.9, W * 1.2 * s, b.size * 1.8); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a; }
        ctx.scale(s, s);
        draw.text(ctx, b.text, 0, -b.size * 0.6, { size: b.size, color: b.color, maxWidth: 980, stroke: 14, strokeColor: 'rgba(0,0,0,0.55)', shadow: false });
        if (b.sub) draw.text(ctx, b.sub, 0, b.size * 0.75, { size: b.size * 0.42, color: '#ffffff', stroke: 8, weight: 700, shadow: false });
        ctx.restore();
      }
      if (this.flashA > 0.005) {
        ctx.globalAlpha = this.flashA; ctx.fillStyle = this.flashC; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      }
    }
    clear() { this.p.length = 0; this.free.length = 0; this.banners.length = 0; this.popups.length = 0; this.live = 0; }
  }

  SB.FX = FX;
  SB.draw = draw;
})(window.SB);
