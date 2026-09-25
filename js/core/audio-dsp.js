/* SatisBall — audio DSP: every instrument, drum and effect is synthesised here with plain JS
 * (no samples, nothing to license). Renderers return mono Float32Arrays at 48 kHz. */
'use strict';
(function (SB) {
  const { clamp, RNG } = SB.util;
  const SR = 48000;
  const TAU = Math.PI * 2;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ------------------------------------------------------------------ DSP helpers
  function polyblep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  function normalize(buf, peak) {
    let m = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
    if (m > 0) { const k = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= k; }
    return buf;
  }
  function fadeOut(buf, secs) {
    const n = Math.min(buf.length, Math.floor(secs * SR));
    for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
    return buf;
  }
  function fadeIn(buf, secs) {
    const n = Math.min(buf.length, Math.floor(secs * SR));
    for (let i = 0; i < n; i++) buf[i] *= i / n;
    return buf;
  }
  /** Add a decaying sine partial (recursive oscillator, cheap). */
  function addPartial(buf, f, amp, tau, start = 0, tau2 = 0, mix2 = 0) {
    if (f >= SR * 0.45) return;
    const w = TAU * f / SR;
    const c = Math.cos(w), s = Math.sin(w);
    let sn = 0, cs = 1;
    const d1 = Math.exp(-1 / (tau * SR));
    const d2 = tau2 > 0 ? Math.exp(-1 / (tau2 * SR)) : 0;
    let e1 = amp * (1 - mix2), e2 = amp * mix2;
    const i0 = Math.floor(start * SR);
    for (let i = i0; i < buf.length; i++) {
      buf[i] += sn * (e1 + e2);
      const nsn = sn * c + cs * s; cs = cs * c - sn * s; sn = nsn;
      e1 *= d1; e2 *= d2;
      if (e1 + e2 < 1e-5) break;
    }
  }
  function lowpass1(buf, fc) {
    const a = 1 - Math.exp(-TAU * fc / SR);
    let y = 0;
    for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
    return buf;
  }
  function highpass1(buf, fc) {
    const a = Math.exp(-TAU * fc / SR);
    let px = 0, py = 0;
    for (let i = 0; i < buf.length; i++) { const x = buf[i]; const y = a * (py + x - px); px = x; py = y; buf[i] = y; }
    return buf;
  }
  function noise(len, rng) { const b = new Float32Array(len); for (let i = 0; i < len; i++) b[i] = rng.next() * 2 - 1; return b; }
  /** State-variable filter with a per-sample cutoff function. mode: 'lp' | 'bp' | 'hp' */
  function svf(buf, cutoffAt, Q, mode) {
    let low = 0, band = 0;
    const q = 1 / Q;
    let f = 0;
    for (let i = 0; i < buf.length; i++) {
      if ((i & 15) === 0) f = 2 * Math.sin(Math.PI * Math.min(cutoffAt(i / SR), SR / 6.5) / SR);
      low += f * band;
      const high = buf[i] - low - q * band;
      band += f * high;
      buf[i] = mode === 'lp' ? low : mode === 'bp' ? band : high;
    }
    return buf;
  }

  // ------------------------------------------------------------------ instruments
  // Each returns a Float32Array for MIDI note m. Keep durations modest (memory + CPU).
  const INSTRUMENTS = {
    piano: {
      name: 'Grand Piano', gain: 0.9,
      render(m) {
        const f = mtof(m);
        const dur = clamp(2.6 * Math.pow(261 / f, 0.35), 0.9, 2.6);
        const b = new Float32Array(Math.floor(dur * SR));
        const tauF = clamp(1.9 * Math.pow(261 / f, 0.55), 0.35, 3.2);
        const B = 0.00032;
        const N = Math.min(14, Math.floor(9000 / f));
        const bright = clamp(Math.pow(f / 261, 0.25), 0.6, 1.6);
        for (let n = 1; n <= N; n++) {
          const fn = n * f * Math.sqrt(1 + B * n * n);
          const amp = Math.pow(n, -1.15) * Math.exp(-(n - 1) * 0.16 / bright) * (n === 2 ? 0.8 : 1);
          const tau = tauF / (1 + 0.32 * (n - 1));
          addPartial(b, fn * 1.00035, amp * 0.5, tau, 0, tau * 0.22, 0.6);
          addPartial(b, fn * 0.99965, amp * 0.5, tau * 0.97, 0, tau * 0.25, 0.6);
        }
        // hammer
        const rng = new RNG(m * 7 + 1);
        const hn = Math.floor(0.012 * SR);
        const h = noise(hn, rng); lowpass1(h, 2500 + f);
        for (let i = 0; i < hn; i++) b[i] += h[i] * 0.08 * (1 - i / hn);
        for (let i = 0; i < 96; i++) b[i] *= i / 96;
        return fadeOut(normalize(b, 0.8), 0.08);
      },
    },
    marimba: {
      name: 'Marimba', gain: 1.0,
      render(m) {
        const f = mtof(m);
        const dur = 1.3;
        const b = new Float32Array(Math.floor(dur * SR));
        const tau = clamp(0.55 * Math.pow(440 / f, 0.45), 0.12, 0.9);
        addPartial(b, f, 1, tau);
        addPartial(b, f * 3.93, 0.32, tau * 0.18);
        addPartial(b, f * 9.2, 0.1, 0.015);
        addPartial(b, f * 2, 0.06, tau * 0.4);
        const rng = new RNG(m * 13 + 5);
        const cn = Math.floor(0.004 * SR);
        const c = noise(cn, rng); lowpass1(c, 3000);
        for (let i = 0; i < cn; i++) b[i] += c[i] * 0.2 * (1 - i / cn);
        for (let i = 0; i < 48; i++) b[i] *= i / 48;
        return fadeOut(normalize(b, 0.8), 0.1);
      },
    },
    pluck: {
      name: 'Harp Pluck', gain: 1.35,
      render(m) {
        const f = mtof(m);
        const dur = clamp(1.8 * Math.pow(261 / f, 0.3), 0.7, 2.0);
        const len = Math.floor(dur * SR);
        const y = new Float32Array(len);
        const d = SR / f - 0.5;
        const D0 = Math.floor(d), fr = d - D0;
        const rng = new RNG(m * 31 + 3);
        const T = 1.6 * Math.pow(261 / f, 0.4);
        const g = Math.pow(0.001, 1 / (f * T));
        // excitation: filtered noise burst one period long
        const ex = noise(D0 + 2, rng); lowpass1(ex, Math.min(9000, f * 9)); normalize(ex, 1);
        let zprev = 0;
        for (let n = 0; n < len; n++) {
          let v = n < ex.length ? ex[n] * 0.9 : 0;
          if (n > D0 + 1) {
            const z = y[n - D0] * (1 - fr) + y[n - D0 - 1] * fr;
            v += g * 0.5 * (z + zprev);
            zprev = z;
          }
          y[n] = v;
        }
        addPartial(y, f, 0.25, T * 0.5);
        highpass1(y, 40);
        for (let i = 0; i < 24; i++) y[i] *= i / 24;
        return fadeOut(normalize(y, 0.8), 0.1);
      },
    },
    synth: {
      name: 'Neon Synth', gain: 0.85,
      render(m) {
        const f = mtof(m);
        const dur = 0.85;
        const len = Math.floor(dur * SR);
        const b = new Float32Array(len);
        const det = [-0.11, 0, 0.11].map((c) => f * Math.pow(2, c / 12));
        const ph = [0.1, 0.5, 0.8];
        for (let i = 0; i < len; i++) {
          let v = 0;
          for (let k = 0; k < 3; k++) {
            const dt = det[k] / SR;
            ph[k] += dt; if (ph[k] >= 1) ph[k] -= 1;
            v += 2 * ph[k] - 1 - polyblep(ph[k], dt);
          }
          v = v / 3 + 0.35 * Math.sin(TAU * f * 0.5 * i / SR);
          const t = i / SR;
          const env = (1 - Math.exp(-t / 0.003)) * (0.35 + 0.65 * Math.exp(-t / 0.12)) * Math.exp(-t / 0.45);
          b[i] = v * env;
        }
        svf(b, (t) => 700 + 6200 * Math.exp(-t / 0.1) + f * 1.2, 1.4, 'lp');
        for (let i = 0; i < len; i++) b[i] = Math.tanh(b[i] * 1.6);
        return fadeOut(normalize(b, 0.8), 0.1);
      },
    },
    bells: {
      name: 'Crystal Bells', gain: 0.8,
      render(m) {
        const f = mtof(m);
        const dur = 2.4;
        const len = Math.floor(dur * SR);
        const b = new Float32Array(len);
        let pc = 0, pm = 0, pc2 = 0;
        const fm = f * 3.5;
        for (let i = 0; i < len; i++) {
          const t = i / SR;
          const I = 3.2 * Math.exp(-t / 0.25) + 0.35;
          pm += TAU * fm / SR; pc += TAU * f / SR; pc2 += TAU * f * 2.756 / SR;
          const env = (1 - Math.exp(-t / 0.002)) * Math.exp(-t / (0.9 * Math.pow(440 / f, 0.3)));
          b[i] = (Math.sin(pc + I * Math.sin(pm)) + 0.22 * Math.sin(pc2) * Math.exp(-t / 0.3)) * env;
        }
        return fadeOut(normalize(b, 0.8), 0.15);
      },
    },
    kalimba: {
      name: 'Kalimba', gain: 1.0,
      render(m) {
        const f = mtof(m);
        const dur = 1.6;
        const b = new Float32Array(Math.floor(dur * SR));
        const tau = clamp(0.8 * Math.pow(440 / f, 0.3), 0.3, 1.2);
        addPartial(b, f, 1, tau);
        addPartial(b, f * 5.95, 0.22, 0.05);
        addPartial(b, f * 2.01, 0.05, tau * 0.3);
        addPartial(b, f * 12.1, 0.05, 0.01);
        for (let i = 0; i < 40; i++) b[i] *= i / 40;
        return fadeOut(normalize(b, 0.8), 0.1);
      },
    },
    glass: {
      name: 'Glass Sine', gain: 0.95,
      render(m) {
        const f = mtof(m);
        const dur = 1.8;
        const b = new Float32Array(Math.floor(dur * SR));
        addPartial(b, f, 1, 0.9, 0, 0.12, 0.2);
        addPartial(b, f * 2, 0.12, 0.4);
        addPartial(b, f * 3, 0.08, 0.2);
        addPartial(b, f * 1.003, 0.4, 1.1);
        for (let i = 0; i < 240; i++) b[i] *= i / 240;
        return fadeOut(normalize(b, 0.8), 0.15);
      },
    },
    chip: {
      name: '8-Bit', gain: 0.58,
      render(m) {
        const f = mtof(m);
        const dur = 0.4;
        const len = Math.floor(dur * SR);
        const b = new Float32Array(len);
        let ph = 0;
        const duty = 0.25;
        for (let i = 0; i < len; i++) {
          const t = i / SR;
          const ff = f * (t < 0.03 ? 2 : 1);
          const dt = ff / SR;
          ph += dt; if (ph >= 1) ph -= 1;
          let v = ph < duty ? 1 : -1;
          v += polyblep(ph, dt);
          v -= polyblep((ph + 1 - duty) % 1, dt);
          b[i] = v * Math.exp(-t / 0.14) * 0.6;
        }
        return fadeOut(normalize(b, 0.7), 0.04);
      },
    },
  };

  // ------------------------------------------------------------------ SFX
  const SFX = {
    shatter(rng) {
      const len = Math.floor(0.9 * SR); const b = new Float32Array(len);
      const n = noise(len, rng); highpass1(n, 1800);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] = n[i] * 0.55 * Math.exp(-t / 0.07); }
      for (let k = 0; k < 16; k++) addPartial(b, rng.range(2200, 7400), rng.range(0.06, 0.18), rng.range(0.05, 0.25), rng.range(0, 0.22));
      addPartial(b, 95, 0.55, 0.09);
      for (let i = 0; i < 24; i++) b[i] *= i / 24;
      return fadeOut(normalize(b, 0.9), 0.1);
    },
    boom(rng) {
      const len = Math.floor(0.9 * SR); const b = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR; const f = 38 + 85 * Math.exp(-t / 0.07);
        ph += TAU * f / SR; b[i] = Math.sin(ph) * Math.exp(-t / 0.32);
      }
      const n = noise(len, rng); lowpass1(n, 400);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] += n[i] * 0.5 * Math.exp(-t / 0.18) + (t < 0.004 ? (rng.next() * 2 - 1) * 0.6 : 0); b[i] = Math.tanh(b[i] * 1.8); }
      return fadeOut(normalize(b, 0.95), 0.1);
    },
    elim(rng) {
      const len = Math.floor(0.7 * SR); const b = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR; const f = 70 + 560 * Math.exp(-t / 0.12); const dt = f / SR;
        ph += dt; if (ph >= 1) ph -= 1;
        b[i] = (2 * ph - 1 - polyblep(ph, dt)) * Math.exp(-t / 0.26);
      }
      svf(b, (t) => 300 + 3500 * Math.exp(-t / 0.15), 2, 'lp');
      const n = noise(len, rng); lowpass1(n, 900);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] = Math.tanh((b[i] + n[i] * 0.6 * Math.exp(-t / 0.1)) * 2.2); }
      addPartial(b, 55, 0.7, 0.2);
      return fadeOut(normalize(b, 0.9), 0.1);
    },
    gate(rng) {
      const len = Math.floor(0.9 * SR); const b = new Float32Array(len);
      let p1 = 0, p2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR; const f = 330 * Math.pow(4, Math.min(1, t / 0.35));
        p1 += TAU * f / SR; p2 += TAU * f * 1.5 / SR;
        const env = Math.min(1, t / 0.02) * Math.exp(-Math.max(0, t - 0.3) / 0.15);
        b[i] = (Math.sin(p1) + 0.6 * Math.sin(p2)) * env * 0.5;
      }
      [1318, 1760, 2637, 3520].forEach((f, k) => addPartial(b, f, 0.25, 0.25, 0.28 + k * 0.05));
      return fadeOut(normalize(b, 0.85), 0.1);
    },
    collapse(rng) {
      const len = Math.floor(1.5 * SR); const b = new Float32Array(len);
      let br = 0;
      for (let i = 0; i < len; i++) { br = (br + 0.02 * (rng.next() * 2 - 1)) / 1.02; b[i] = br * 8; }
      lowpass1(b, 260);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] *= Math.min(1, t / 0.03) * Math.exp(-t / 0.5) * (0.7 + 0.3 * Math.sin(t * 60)); }
      for (let k = 0; k < 14; k++) { const s = Math.floor(rng.range(0, 0.6) * SR); const L = Math.floor(0.02 * SR); for (let i = 0; i < L && s + i < len; i++) b[s + i] += (rng.next() * 2 - 1) * 0.5 * (1 - i / L); }
      addPartial(b, 48, 0.9, 0.35);
      for (let i = 0; i < len; i++) b[i] = Math.tanh(b[i] * 1.5);
      return fadeOut(normalize(b, 0.9), 0.2);
    },
    tick(rng) {
      const b = new Float32Array(Math.floor(0.12 * SR));
      addPartial(b, 1850, 0.8, 0.012); addPartial(b, 920, 0.6, 0.03); addPartial(b, 2900, 0.2, 0.006);
      return normalize(b, 0.8);
    },
    go(rng) {
      const b = new Float32Array(Math.floor(0.9 * SR));
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => { addPartial(b, f, 0.5, 0.3); addPartial(b, f * 2, 0.12, 0.1); });
      return fadeOut(normalize(b, 0.8), 0.1);
    },
    blade(rng) {
      const len = Math.floor(0.55 * SR); const b = new Float32Array(len);
      let pc = 0, pm = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR; pm += TAU * 1400 * 2.41 / SR; pc += TAU * 1400 / SR;
        b[i] = Math.sin(pc + 5 * Math.exp(-t / 0.05) * Math.sin(pm)) * Math.exp(-t / 0.16) * 0.6;
      }
      const n = noise(len, rng); highpass1(n, 4000);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] += n[i] * 0.5 * Math.min(1, t / 0.01) * Math.exp(-t / 0.07); }
      return fadeOut(normalize(b, 0.8), 0.05);
    },
    clang(rng) {
      const b = new Float32Array(Math.floor(0.9 * SR));
      [[1, 0.6, 0.35], [2.76, 0.4, 0.2], [5.4, 0.3, 0.1], [8.93, 0.2, 0.06], [1.5, 0.2, 0.25]].forEach(([r, a, d]) => addPartial(b, 640 * r, a, d));
      const n = noise(2000, rng); for (let i = 0; i < 2000; i++) b[i] += n[i] * 0.4 * (1 - i / 2000);
      return fadeOut(normalize(b, 0.85), 0.1);
    },
    thud(rng) {
      const len = Math.floor(0.3 * SR); const b = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (60 + 120 * Math.exp(-t / 0.03)) / SR; b[i] = Math.sin(ph) * Math.exp(-t / 0.07); }
      const n = noise(len, rng); lowpass1(n, 1500);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] = Math.tanh((b[i] + n[i] * 0.5 * Math.exp(-t / 0.025)) * 1.6); }
      return fadeOut(normalize(b, 0.9), 0.03);
    },
    pickup(rng) {
      const b = new Float32Array(Math.floor(0.6 * SR));
      [1318.5, 1568, 2093, 2637].forEach((f, k) => { addPartial(b, f, 0.5, 0.12, k * 0.045); addPartial(b, f * 2, 0.1, 0.05, k * 0.045); });
      return fadeOut(normalize(b, 0.75), 0.05);
    },
    whoosh(rng) {
      const len = Math.floor(0.55 * SR); const b = noise(len, rng);
      svf(b, (t) => 300 + 2600 * Math.sin(Math.PI * Math.min(1, t / 0.5)), 3, 'bp');
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] *= Math.sin(Math.PI * Math.min(1, t / 0.55)); }
      return normalize(b, 0.7);
    },
    crush(rng) {
      const len = Math.floor(0.7 * SR); const b = noise(len, rng);
      lowpass1(b, 1400);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] = Math.tanh(b[i] * 6 * Math.exp(-t / 0.12)) * Math.exp(-t / 0.2); }
      addPartial(b, 70, 0.8, 0.15); addPartial(b, 140, 0.4, 0.06);
      return fadeOut(normalize(b, 0.9), 0.05);
    },
    boing(rng) {
      const len = Math.floor(0.55 * SR); const b = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR; const f = 160 + 380 * (1 - Math.exp(-t / 0.04)) + 40 * Math.sin(TAU * 18 * t) * Math.exp(-t / 0.2);
        ph += TAU * f / SR; b[i] = Math.sin(ph) * Math.exp(-t / 0.2);
      }
      return fadeOut(normalize(b, 0.8), 0.05);
    },
    pop(rng) {
      const len = Math.floor(0.12 * SR); const b = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (380 + 700 * Math.exp(-t / 0.02)) / SR; b[i] = Math.sin(ph) * Math.exp(-t / 0.035); }
      return normalize(b, 0.8);
    },
    key(rng) {
      const b = new Float32Array(Math.floor(0.5 * SR));
      [[987.8, 0], [1318.5, 0.07], [1975.5, 0.14]].forEach(([f, s]) => { addPartial(b, f, 0.5, 0.15, s); addPartial(b, f * 3, 0.1, 0.05, s); });
      return fadeOut(normalize(b, 0.75), 0.05);
    },
    zap(rng) {
      const len = Math.floor(0.15 * SR); const b = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (500 + 1700 * Math.exp(-t / 0.025)) / SR; b[i] = Math.sin(ph) * Math.exp(-t / 0.04); }
      const n = noise(len, rng); highpass1(n, 3000);
      for (let i = 0; i < len; i++) b[i] += n[i] * 0.3 * Math.exp(-i / SR / 0.015);
      return normalize(b, 0.7);
    },
    heal(rng) {
      const b = new Float32Array(Math.floor(0.7 * SR));
      [784, 988, 1175, 1568].forEach((f, k) => addPartial(b, f, 0.4, 0.2, k * 0.06));
      return fadeIn(fadeOut(normalize(b, 0.6), 0.1), 0.01);
    },
    shimmer(rng) {
      const b = new Float32Array(Math.floor(2.4 * SR));
      for (let k = 0; k < 28; k++) addPartial(b, rng.range(1800, 6500), rng.range(0.05, 0.14), rng.range(0.3, 0.9), rng.range(0, 1.2));
      return fadeOut(normalize(b, 0.6), 0.3);
    },
    riser(rng) {
      const len = Math.floor(2.0 * SR); const b = noise(len, rng);
      svf(b, (t) => 300 + 5000 * Math.pow(t / 2, 2), 4, 'bp');
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR; ph += TAU * (110 * Math.pow(4, t / 2)) / SR;
        b[i] = (b[i] * 0.8 + Math.sin(ph) * 0.25) * Math.pow(t / 2, 1.5);
      }
      return fadeOut(normalize(b, 0.7), 0.02);
    },
    crumble(rng) {
      const len = Math.floor(0.45 * SR); const b = new Float32Array(len);
      for (let k = 0; k < 18; k++) { const s = Math.floor(rng.range(0, 0.3) * SR); const L = Math.floor(rng.range(0.004, 0.015) * SR); for (let i = 0; i < L && s + i < len; i++) b[s + i] += (rng.next() * 2 - 1) * (1 - i / L); }
      lowpass1(b, 2200);
      addPartial(b, 90, 0.4, 0.08);
      return fadeOut(normalize(b, 0.8), 0.05);
    },
    door(rng) {
      const len = Math.floor(0.5 * SR); const b = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (90 + 40 * t) / SR; const v = ph / TAU % 1; b[i] = (v * 2 - 1) * Math.exp(-t / 0.18); }
      lowpass1(b, 900);
      addPartial(b, 1200, 0.2, 0.03);
      return fadeOut(normalize(b, 0.75), 0.05);
    },
  };
  // ---- added instruments -------------------------------------------------
  Object.assign(INSTRUMENTS, {
    rhodes: {
      name: 'Lo-fi Keys', gain: 0.95,
      render(m) {
        const f = mtof(m), dur = clamp(2.2 * Math.pow(261 / f, 0.3), 0.9, 2.4);
        const len = Math.floor(dur * SR), b = new Float32Array(len);
        let pc = 0, pm = 0, pt = 0;
        const tau = clamp(1.4 * Math.pow(261 / f, 0.45), 0.35, 2.2);
        for (let i = 0; i < len; i++) {
          const t = i / SR;
          pm += TAU * f / SR; pc += TAU * f / SR; pt += TAU * f * 14.1 / SR;
          const I = 1.6 * Math.exp(-t / 0.08) + 0.35;
          const env = (1 - Math.exp(-t / 0.0025)) * Math.exp(-t / tau) * (1 + 0.12 * Math.sin(TAU * 4.6 * t));
          b[i] = (Math.sin(pc + I * Math.sin(pm)) + 0.18 * Math.sin(pt) * Math.exp(-t / 0.012)) * env;
        }
        for (let i = 0; i < len; i++) b[i] = Math.tanh(b[i] * 1.3);
        return fadeOut(normalize(b, 0.8), 0.1);
      },
    },
    vibes: {
      name: 'Vibraphone', gain: 0.95,
      render(m) {
        const f = mtof(m), dur = 2.2, b = new Float32Array(Math.floor(dur * SR));
        addPartial(b, f, 1, 1.5); addPartial(b, f * 4, 0.28, 0.35); addPartial(b, f * 10.2, 0.08, 0.05);
        for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] *= 1 - 0.28 * (0.5 + 0.5 * Math.sin(TAU * 5.4 * t)); }
        for (let i = 0; i < 60; i++) b[i] *= i / 60;
        return fadeOut(normalize(b, 0.8), 0.15);
      },
    },
    musicbox: {
      name: 'Music Box', gain: 0.9,
      render(m) {
        const f = mtof(m + 12), dur = 1.9, b = new Float32Array(Math.floor(dur * SR));
        [[1, 1, 0.9], [3.93, 0.3, 0.25], [8.6, 0.12, 0.08], [13.3, 0.06, 0.04], [2.01, 0.08, 0.5]].forEach(([r, a, d]) => addPartial(b, f * r, a, d * Math.pow(880 / f, 0.2)));
        for (let i = 0; i < 30; i++) b[i] *= i / 30;
        return fadeOut(normalize(b, 0.8), 0.15);
      },
    },
    steelpan: {
      name: 'Steel Pan', gain: 0.95,
      render(m) {
        const f = mtof(m), dur = 1.4, len = Math.floor(dur * SR), b = new Float32Array(len);
        const parts = [[1, 1, 0.7], [2, 0.55, 0.45], [3.01, 0.3, 0.25], [4.02, 0.12, 0.12]];
        const ph = parts.map(() => 0);
        for (let i = 0; i < len; i++) {
          const t = i / SR, bend = 1 + 0.012 * Math.exp(-t / 0.02);
          let v = 0;
          parts.forEach(([r, a, d], k) => { ph[k] += TAU * f * r * bend / SR; v += Math.sin(ph[k]) * a * Math.exp(-t / d) * (k === 1 ? Math.min(1, t / 0.015) : 1); });
          b[i] = v * Math.min(1, t / 0.003);
        }
        return fadeOut(normalize(b, 0.8), 0.1);
      },
    },
    nylon: {
      name: 'Nylon Guitar', gain: 1.25,
      render(m) {
        const f = mtof(m), dur = clamp(2.0 * Math.pow(261 / f, 0.25), 0.9, 2.2), len = Math.floor(dur * SR);
        const y = new Float32Array(len), d = SR / f - 0.5, D0 = Math.floor(d), fr = d - D0;
        const rng = new RNG(m * 57 + 11), T = 1.9 * Math.pow(261 / f, 0.35), g = Math.pow(0.001, 1 / (f * T));
        const ex = noise(D0 + 2, rng); lowpass1(ex, Math.min(5000, f * 5)); lowpass1(ex, Math.min(6000, f * 6)); normalize(ex, 1);
        let zp = 0;
        for (let n = 0; n < len; n++) { let v = n < ex.length ? ex[n] : 0; if (n > D0 + 1) { const z = y[n - D0] * (1 - fr) + y[n - D0 - 1] * fr; v += g * (0.55 * z + 0.45 * zp); zp = z; } y[n] = v; }
        addPartial(y, 98, 0.12, 0.08); addPartial(y, 196, 0.08, 0.06); addPartial(y, f, 0.2, T * 0.4);
        highpass1(y, 50);
        for (let i = 0; i < 40; i++) y[i] *= i / 40;
        return fadeOut(normalize(y, 0.8), 0.1);
      },
    },
    bass: {
      name: 'Bass', gain: 0.9, hidden: true,
      render(m) {
        const f = mtof(m), dur = 0.7, len = Math.floor(dur * SR), b = new Float32Array(len);
        let ph = 0;
        for (let i = 0; i < len; i++) { const t = i / SR, dt = f / SR; ph += dt; if (ph >= 1) ph -= 1; b[i] = (0.6 * (2 * ph - 1 - polyblep(ph, dt)) + Math.sin(TAU * f * t)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.35); }
        svf(b, (t) => 180 + 900 * Math.exp(-t / 0.06), 1.2, 'lp');
        return fadeOut(normalize(b, 0.85), 0.08);
      },
    },
  });

  /** Warm, wide pad chord (stereo pair) for the backing track. */
  function padChord(notes, dur, seed, bright = 1) {
    const len = Math.floor(dur * SR), out = [new Float32Array(len), new Float32Array(len)];
    for (let ch = 0; ch < 2; ch++) {
      const b = out[ch];
      notes.forEach((m, k) => {
        const f = mtof(m);
        [-0.09, 0.08].forEach((cents, j) => {
          const ff = f * Math.pow(2, (cents + (ch ? 0.03 : -0.03) * (k + 1)) / 12);
          let ph = ((seed * 0.37 + k * 0.19 + j * 0.5 + ch * 0.23) % 1);
          const dt = ff / SR;
          for (let i = 0; i < len; i++) { ph += dt; if (ph >= 1) ph -= 1; b[i] += (2 * ph - 1 - polyblep(ph, dt)) * 0.2; }
        });
      });
      svf(b, (t) => (650 + 500 * Math.sin(Math.min(1, t / dur) * Math.PI)) * bright, 0.9, 'lp');
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] *= Math.min(1, t / 0.35) * Math.min(1, (dur - t) / 0.8); }
    }
    const pk = Math.max(...out.map((b) => b.reduce((a, v) => Math.max(a, Math.abs(v)), 0))) || 1;
    out.forEach((b) => { for (let i = 0; i < b.length; i++) b[i] *= 0.7 / pk; });
    return out;
  }
  /** Big supersaw chord hit for payoffs. */
  function stabChord(notes, seed) {
    const len = Math.floor(1.6 * SR), out = [new Float32Array(len), new Float32Array(len)];
    for (let ch = 0; ch < 2; ch++) {
      const b = out[ch];
      notes.forEach((m, k) => {
        const f = mtof(m);
        [-0.14, -0.05, 0.05, 0.14].forEach((c, j) => {
          const ff = f * Math.pow(2, (c + (ch ? 0.02 : -0.02)) / 12), dt = ff / SR;
          let ph = (seed * 0.13 + k * 0.31 + j * 0.27 + ch * 0.4) % 1;
          for (let i = 0; i < len; i++) { ph += dt; if (ph >= 1) ph -= 1; b[i] += (2 * ph - 1 - polyblep(ph, dt)) * 0.15; }
        });
      });
      svf(b, (t) => 900 + 6000 * Math.exp(-t / 0.18), 1.1, 'lp');
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] = Math.tanh(b[i] * 1.4) * Math.min(1, t / 0.004) * Math.exp(-t / 0.55); }
    }
    const pk = Math.max(...out.map((b) => b.reduce((a, v) => Math.max(a, Math.abs(v)), 0))) || 1;
    out.forEach((b) => { for (let i = 0; i < b.length; i++) b[i] *= 0.85 / pk; fadeOut(b, 0.2); });
    return out;
  }

  Object.assign(SFX, {
    kick(rng) {
      const len = Math.floor(0.45 * SR), b = new Float32Array(len); let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (45 + 110 * Math.exp(-t / 0.035)) / SR; b[i] = Math.sin(ph) * Math.exp(-t / 0.22) + (t < 0.003 ? (rng.next() * 2 - 1) * 0.4 : 0); b[i] = Math.tanh(b[i] * 1.5); }
      return fadeOut(normalize(b, 0.95), 0.03);
    },
    hat(rng) {
      const len = Math.floor(0.09 * SR), b = noise(len, rng); highpass1(b, 7000); highpass1(b, 6000);
      for (let i = 0; i < len; i++) b[i] *= Math.exp(-i / SR / 0.02);
      return fadeOut(normalize(b, 0.6), 0.01);
    },
    ohat(rng) {
      const len = Math.floor(0.35 * SR), b = noise(len, rng); highpass1(b, 6500); highpass1(b, 5000);
      for (let i = 0; i < len; i++) b[i] *= Math.exp(-i / SR / 0.11);
      return fadeOut(normalize(b, 0.55), 0.04);
    },
    clap(rng) {
      const len = Math.floor(0.35 * SR), b = new Float32Array(len), n = noise(len, rng);
      svf(n, () => 1400, 1.4, 'bp');
      for (let i = 0; i < len; i++) { const t = i / SR; let e = Math.exp(-Math.max(0, t - 0.022) / 0.1) * (t > 0.022 ? 1 : 0); for (const o of [0, 0.008, 0.016]) if (t >= o && t < o + 0.008) e = Math.max(e, 1 - (t - o) / 0.008); b[i] = n[i] * e; }
      return fadeOut(normalize(b, 0.8), 0.03);
    },
    snare(rng) {
      const len = Math.floor(0.3 * SR), b = noise(len, rng); svf(b, () => 3200, 0.8, 'bp');
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] = b[i] * Math.exp(-t / 0.09) + Math.sin(TAU * 190 * t) * 0.6 * Math.exp(-t / 0.05); }
      return fadeOut(normalize(b, 0.85), 0.03);
    },
    crash(rng) {
      const len = Math.floor(2.4 * SR), b = noise(len, rng); highpass1(b, 3500);
      for (let k = 0; k < 10; k++) addPartial(b, rng.range(3000, 9000), 0.04, rng.range(0.4, 1.4));
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] *= Math.min(1, t / 0.002) * (0.3 * Math.exp(-t / 0.05) + 0.7 * Math.exp(-t / 0.9)); }
      return fadeOut(normalize(b, 0.7), 0.3);
    },
    subdrop(rng) {
      const len = Math.floor(1.5 * SR), b = new Float32Array(len); let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (30 + 60 * Math.exp(-t / 0.35)) / SR; b[i] = Math.sin(ph) * Math.min(1, t / 0.01) * Math.exp(-t / 0.7); }
      return fadeOut(normalize(b, 0.95), 0.2);
    },
    swell(rng) {
      const len = Math.floor(1.1 * SR), b = noise(len, rng); svf(b, (t) => 400 + 6000 * Math.pow(t / 1.1, 2), 2, 'bp');
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] *= Math.pow(t / 1.1, 2.2); }
      return fadeOut(normalize(b, 0.7), 0.01);
    },
    levelup(rng) {
      const b = new Float32Array(Math.floor(1.0 * SR));
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, k) => { addPartial(b, f, 0.45, 0.25, k * 0.06); addPartial(b, f * 2, 0.12, 0.1, k * 0.06); });
      for (let k = 0; k < 12; k++) addPartial(b, rng.range(2500, 6000), 0.05, 0.3, 0.3 + rng.range(0, 0.3));
      return fadeOut(normalize(b, 0.8), 0.1);
    },
    laser(rng) {
      const len = Math.floor(0.7 * SR), b = new Float32Array(len); let ph = 0, pm = 0;
      for (let i = 0; i < len; i++) { const t = i / SR, f = 900 * Math.exp(-t / 0.4) + 180; pm += TAU * f * 0.5 / SR; ph += TAU * f / SR; b[i] = Math.sin(ph + 2.5 * Math.sin(pm)) * Math.min(1, t / 0.01) * Math.exp(-t / 0.35); }
      return fadeOut(normalize(b, 0.8), 0.05);
    },
    roar(rng) {
      const len = Math.floor(1.3 * SR), b = new Float32Array(len); let ph = 0;
      const n = noise(len, rng); lowpass1(n, 700);
      for (let i = 0; i < len; i++) { const t = i / SR, f = 58 + 8 * Math.sin(TAU * 7 * t) + 20 * Math.exp(-t / 0.3), dt = f / SR; ph += dt; if (ph >= 1) ph -= 1; b[i] = Math.tanh(((2 * ph - 1) * 0.8 + n[i] * 0.9) * 2.5) * Math.min(1, t / 0.08) * Math.exp(-t / 0.6); }
      svf(b, (t) => 500 + 1500 * Math.exp(-t / 0.4), 1.5, 'lp');
      return fadeOut(normalize(b, 0.9), 0.2);
    },
    charge(rng) {
      const len = Math.floor(0.8 * SR), b = new Float32Array(len); let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (200 * Math.pow(5, t / 0.8)) / SR; b[i] = Math.sin(ph) * (t / 0.8) * (0.7 + 0.3 * Math.sin(TAU * 30 * t)); }
      return fadeOut(normalize(b, 0.6), 0.02);
    },
    splat(rng) {
      const len = Math.floor(0.35 * SR), b = noise(len, rng); lowpass1(b, 1800);
      for (let i = 0; i < len; i++) { const t = i / SR; b[i] = b[i] * Math.exp(-t / 0.06) * (1 + Math.sin(TAU * 40 * t)); }
      addPartial(b, 110, 0.6, 0.06); addPartial(b, 70, 0.4, 0.1);
      return fadeOut(normalize(b, 0.85), 0.04);
    },
    portal(rng) {
      const len = Math.floor(0.7 * SR), b = new Float32Array(len); let ph = 0, pm = 0;
      for (let i = 0; i < len; i++) { const t = i / SR, f = 300 + 900 * (t / 0.7); pm += TAU * 11 / SR; ph += TAU * f * (1 + 0.04 * Math.sin(pm)) / SR; b[i] = Math.sin(ph) * Math.sin(Math.PI * t / 0.7); }
      return fadeOut(normalize(b, 0.6), 0.02);
    },
    coin(rng) {
      const len = Math.floor(0.3 * SR), b = new Float32Array(len); let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR, f = t < 0.06 ? 1318.5 : 1975.5, dt = f / SR; ph += dt; if (ph >= 1) ph -= 1; b[i] = (ph < 0.5 ? 1 : -1) * 0.5 * Math.exp(-t / 0.12); }
      lowpass1(b, 6000);
      return fadeOut(normalize(b, 0.55), 0.03);
    },
    heart(rng) {
      const len = Math.floor(0.55 * SR), b = new Float32Array(len);
      for (const [o, a] of [[0, 1], [0.17, 0.7]]) { let ph = 0; const s0 = Math.floor(o * SR); for (let i = s0; i < len; i++) { const t = (i - s0) / SR; ph += TAU * (48 + 40 * Math.exp(-t / 0.02)) / SR; b[i] += Math.sin(ph) * a * Math.exp(-t / 0.09); } }
      return fadeOut(normalize(b, 0.9), 0.05);
    },
    beep(rng) { const b = new Float32Array(Math.floor(0.18 * SR)); addPartial(b, 880, 0.8, 0.07); addPartial(b, 1760, 0.2, 0.03); for (let i = 0; i < 48; i++) b[i] *= i / 48; return fadeOut(normalize(b, 0.7), 0.02); },
    explode(rng) {
      const len = Math.floor(1.1 * SR), b = noise(len, rng); lowpass1(b, 2500);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; ph += TAU * (40 + 90 * Math.exp(-t / 0.06)) / SR; b[i] = Math.tanh((b[i] * Math.exp(-t / 0.25) * 1.3 + Math.sin(ph) * Math.exp(-t / 0.3)) * 2); }
      return fadeOut(normalize(b, 0.95), 0.2);
    },
  });

  SB.dsp = { SR, TAU, mtof, polyblep, normalize, fadeOut, fadeIn, addPartial, lowpass1, highpass1, noise, svf, INSTRUMENTS, SFX, padChord, stabChord };
})(window.SB);
