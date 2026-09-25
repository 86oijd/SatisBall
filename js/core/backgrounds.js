/* SatisBall — animated backgrounds. Everything is derived from the presentation clock (deterministic),
 * reacts gently to the beat/hit pulse and to rising tension, and stays dark enough for balls to pop. */
'use strict';
(function (SB) {
  const { TAU, clamp, rgba, lighten, darken, mix } = SB.util;
  const W = 1080, H = 1920;

  const baseCache = new Map();
  function base(pal) {
    let c = baseCache.get(pal.id);
    if (c) return c;
    c = document.createElement('canvas'); c.width = W / 2; c.height = H / 2; // smooth gradients survive upscaling
    const g = c.getContext('2d'); g.scale(0.5, 0.5);
    const gr = g.createLinearGradient(0, 0, W * 0.3, H);
    gr.addColorStop(0, pal.bg[0]); gr.addColorStop(0.55, pal.bg[1]); gr.addColorStop(1, pal.bg[2]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const v = g.createRadialGradient(W / 2, H * 0.48, H * 0.25, W / 2, H * 0.5, H * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, pal.light ? 'rgba(120,60,120,0.12)' : 'rgba(0,0,0,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    baseCache.set(pal.id, c);
    return c;
  }
  const dotCache = new Map();
  function dots(pal) {
    let c = dotCache.get(pal.id);
    if (c) return c;
    c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = pal.light ? 'rgba(60,20,90,0.06)' : 'rgba(255,255,255,0.035)';
    for (let y = 30; y < H; y += 60) for (let x = 30; x < W; x += 60) { g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill(); }
    dotCache.set(pal.id, c);
    return c;
  }
  const blobCache = new Map();
  function blob(color) {
    let c = blobCache.get(color);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, rgba(color, 0.5)); gr.addColorStop(0.5, rgba(color, 0.16)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    blobCache.set(color, c);
    return c;
  }
  const vigCache = new Map();
  function vignette(color) {
    let c = vigCache.get(color);
    if (c) return c;
    c = document.createElement('canvas'); c.width = 270; c.height = 480;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(135, 240, 150, 135, 240, 300);
    gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(1, rgba(color, 0.9));
    g.fillStyle = gr; g.fillRect(0, 0, 270, 480);
    vigCache.set(color, c);
    return c;
  }
  const hash = (i, k) => (((i * 7919 + k * 104729) % 1000) + 1000) % 1000 / 1000;

  const STYLES = {
    glow(ctx, g, pal, t, pulse) {
      ctx.drawImage(dots(pal), 0, 0, W, H);
      ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
      ctx.globalAlpha = 0.55 * (1 + g.tension * 0.35 + pulse * 0.35);
      ctx.drawImage(blob(pal.glow[0]), W * 0.1 + Math.sin(t * 0.21) * 160 - 700, H * 0.25 + Math.cos(t * 0.17) * 200 - 700, 1400, 1400);
      ctx.drawImage(blob(pal.glow[1]), W * 0.9 + Math.cos(t * 0.19) * 160 - 700, H * 0.78 + Math.sin(t * 0.23) * 200 - 700, 1400, 1400);
      dust(ctx, g, pal, t, 36);
    },
    grid(ctx, g, pal, t, pulse) {
      const hz = H * 0.6;
      ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
      ctx.globalAlpha = 0.6 + pulse * 0.3;
      ctx.drawImage(blob(pal.glow[1]), W / 2 - 800, hz - 700, 1600, 1100);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(blob(pal.glow[0]), W / 2 - 700, -500, 1400, 1100);
      const col = pal.light ? darken(pal.glow[1], 0.2) : pal.glow[1];
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      const N = 14, ph = (t * 0.35) % 1;
      for (let i = 0; i < N; i++) {
        const k = (i + ph) / N, y = hz + (H - hz) * k * k;
        ctx.globalAlpha = (0.08 + 0.3 * k) * (1 + pulse * 0.6);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      for (let i = -12; i <= 12; i++) {
        ctx.globalAlpha = 0.16 * (1 + pulse * 0.6);
        ctx.beginPath(); ctx.moveTo(W / 2 + i * 26, hz); ctx.lineTo(W / 2 + i * 260, H); ctx.stroke();
      }
      dust(ctx, g, pal, t, 20);
    },
    stars(ctx, g, pal, t, pulse) {
      ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
      ctx.globalAlpha = 0.4; ctx.drawImage(blob(pal.glow[0]), -300, H * 0.1, 1200, 1200);
      ctx.globalAlpha = 0.3; ctx.drawImage(blob(pal.glow[1]), W - 800, H * 0.55, 1200, 1200);
      const col = pal.light ? darken(pal.dim, 0.3) : '#ffffff';
      ctx.fillStyle = col;
      for (let layer = 0; layer < 3; layer++) {
        const n = [70, 45, 22][layer], sp = [10, 26, 55][layer], sz = [1.6, 2.6, 3.6][layer], par = [0.05, 0.15, 0.3][layer];
        for (let i = 0; i < n; i++) {
          const x = hash(i, layer + 1) * W;
          const y = ((hash(i, layer + 7) * H + t * sp - g.cam.y * par) % H + H) % H;
          ctx.globalAlpha = (pal.light ? 0.25 : 0.35 + 0.35 * layer / 2) * (0.6 + 0.4 * Math.sin(t * (1 + i % 3) + i)) * (1 + pulse * 0.5);
          ctx.fillRect(x, y, sz, sz);
        }
      }
    },
    waves(ctx, g, pal, t, pulse) {
      ctx.drawImage(dots(pal), 0, 0, W, H);
      ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
      const cols = [pal.glow[0], pal.glow[1], pal.grad[2] || pal.accent];
      for (let bnd = 0; bnd < 3; bnd++) {
        const y0 = H * (0.3 + bnd * 0.22), A = 90 + bnd * 30, th = 260;
        const gr = ctx.createLinearGradient(0, y0 - A, 0, y0 + th);
        gr.addColorStop(0, rgba(cols[bnd], 0)); gr.addColorStop(0.35, rgba(cols[bnd], pal.light ? 0.10 : 0.16 * (1 + pulse * 0.6))); gr.addColorStop(1, rgba(cols[bnd], 0));
        ctx.fillStyle = gr; ctx.globalAlpha = 1;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 40) { const y = y0 + Math.sin(x * 0.004 + t * (0.3 + bnd * 0.1) + bnd) * A + Math.sin(x * 0.011 - t * 0.5) * A * 0.3; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.lineTo(W, y0 + th + A); ctx.lineTo(0, y0 + th + A); ctx.closePath(); ctx.fill();
      }
      dust(ctx, g, pal, t, 24);
    },
    rays(ctx, g, pal, t, pulse) {
      const cx = W / 2, cy = H * 0.56;
      ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
      ctx.globalAlpha = 0.5 + pulse * 0.3; ctx.drawImage(blob(pal.glow[0]), cx - 900, cy - 900, 1800, 1800);
      const gr = ctx.createRadialGradient(cx, cy, 60, cx, cy, 1300);
      gr.addColorStop(0, rgba(pal.glow[1], pal.light ? 0.10 : 0.16 * (1 + pulse * 0.8))); gr.addColorStop(1, rgba(pal.glow[1], 0));
      ctx.fillStyle = gr; ctx.globalAlpha = 1;
      const n = 14, rot = t * 0.06;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; ctx.moveTo(cx, cy); ctx.arc(cx, cy, 1400, a, a + TAU / n * 0.45); }
      ctx.fill();
      dust(ctx, g, pal, t, 20);
    },
    bokeh(ctx, g, pal, t, pulse) {
      ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
      for (let i = 0; i < 16; i++) {
        const c = pal.balls[i % Math.min(8, pal.balls.length)].c;
        const r = 60 + hash(i, 3) * 190;
        const x = hash(i, 5) * W + Math.sin(t * 0.2 + i) * 40;
        const y = ((hash(i, 9) * (H + 400) - t * (8 + hash(i, 2) * 18)) % (H + 400) + H + 400) % (H + 400) - 200;
        ctx.globalAlpha = (pal.light ? 0.12 : 0.2) * (0.7 + 0.3 * Math.sin(t * 0.7 + i)) * (1 + pulse * 0.4);
        ctx.drawImage(blob(c), x - r * 2, y - r * 2, r * 4, r * 4);
      }
    },
    plain(ctx, g, pal, t, pulse) {
      if (pulse > 0.02 && !pal.light) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse * 0.25; ctx.drawImage(blob(pal.accent), W / 2 - 900, H / 2 - 900, 1800, 1800); }
    },
  };
  function dust(ctx, g, pal, t, n) {
    ctx.globalCompositeOperation = pal.light ? 'source-over' : 'lighter';
    ctx.fillStyle = pal.light ? darken(pal.dim, 0.2) : '#ffffff';
    for (let i = 0; i < n; i++) {
      const sx = ((i * 7919) % 1000) / 1000, sy = ((i * 104729) % 1000) / 1000, sp = 8 + (i % 5) * 5;
      const x = (sx * W + Math.sin(t * 0.3 + i) * 30) % W;
      const y = ((sy * H - t * sp - g.cam.y * 0.15) % H + H) % H;
      ctx.globalAlpha = (pal.light ? 0.15 : 0.22) * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1));
      ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3) * 0.8, 0, TAU); ctx.fill();
    }
  }

  SB.backgrounds = {
    list: [['glow', 'Glow drift'], ['grid', 'Synth grid'], ['stars', 'Starfield'], ['waves', 'Aurora waves'], ['rays', 'Light rays'], ['bokeh', 'Bokeh lights'], ['plain', 'Plain gradient']],
    draw(ctx, g) {
      const pal = g.pal, t = g.clock;
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(base(pal), 0, 0, W, H);
      (STYLES[g.look.bg] || STYLES.glow)(ctx, g, pal, t, clamp(g.pulse, 0, 1.5));
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    },
    /** Pulsing edge glow that appears as tension peaks (and on demand, e.g. danger). */
    tension(ctx, g, amount, color) {
      if (amount <= 0.01) return;
      ctx.globalAlpha = clamp(amount, 0, 1);
      ctx.globalCompositeOperation = g.pal.light ? 'source-over' : 'lighter';
      ctx.drawImage(vignette(color), 0, 0, W, H);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    },
    blob,
  };
})(window.SB);
