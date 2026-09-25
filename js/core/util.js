/* SatisBall — core utilities: math, seeded RNG, colour helpers. */
'use strict';
window.SB = window.SB || {};

(function (SB) {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInCubic = (t) => t * t * t;
  const easeOutElastic = (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
  /** Normalise an angle into [0, TAU). */
  const normAngle = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
  /** Signed smallest difference b - a in (-PI, PI]. */
  const angleDiff = (a, b) => { let d = normAngle(b - a); return d > Math.PI ? d - TAU : d; };

  /** Deterministic PRNG (mulberry32). All simulation randomness goes through this so runs replay exactly. */
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 1; }
    next() {
      let t = (this.s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    int(a, b) { return Math.floor(a + (b - a + 1) * this.next()); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    chance(p) { return this.next() < p; }
    sign() { return this.next() < 0.5 ? -1 : 1; }
    gauss() { return (this.next() + this.next() + this.next() - 1.5) * 1.414; }
    shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  }

  // ---------- colour ----------
  const rgbCache = new Map();
  function hexToRgb(hex) {
    let c = rgbCache.get(hex);
    if (c) return c;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
    return c;
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function mix(h1, h2, t) { const a = hexToRgb(h1), b = hexToRgb(h2); return toHex(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)); }
  const lighten = (h, t) => mix(h, '#ffffff', t);
  const darken = (h, t) => mix(h, '#000000', t);
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
    const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  /** Sample a multi-stop gradient (array of hex) at t in [0,1]. */
  function gradientAt(stops, t) {
    t = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(Math.floor(t), stops.length - 2);
    return mix(stops[i], stops[i + 1], t - i);
  }
  function luminance(hex) { const c = hexToRgb(hex); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }

  const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); const r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); };

  SB.util = { TAU, clamp, lerp, smooth, easeOutBack, easeOutCubic, easeInCubic, easeOutElastic, normAngle, angleDiff, RNG, hexToRgb, rgba, mix, lighten, darken, hsl, gradientAt, luminance, fmtTime };
})(window.SB);
