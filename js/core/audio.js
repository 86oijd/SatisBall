/* SatisBall — audio: every sound is synthesised here (no samples, nothing to license).
 *
 *  - Instruments and SFX are rendered once with plain JS DSP into AudioBuffers (cached).
 *  - The same buffers + the same mixing graph are used live (AudioContext) and for export
 *    (OfflineAudioContext), so an exported video sounds exactly like the preview.
 *  - Music: a per-run sequencer turns collisions into notes (scale climb, chord arpeggios,
 *    melodies note-by-note, or pitch that rises with tension).
 */
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
      name: 'Harp Pluck', gain: 1.0,
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
      name: 'Neon Synth', gain: 0.62,
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
      name: '8-Bit', gain: 0.45,
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

  // ------------------------------------------------------------------ bank (buffer cache)
  function toBuffer(data) {
    const ab = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: SR });
    ab.copyToChannel(data, 0);
    return ab;
  }
  class Bank {
    constructor() { this.inst = new Map(); this.sfx = new Map(); this.warmQueue = []; this.warming = false; }
    note(instId, m) {
      m = clamp(Math.round(m), 21, 108);
      const key = instId + ':' + m;
      let b = this.inst.get(key);
      if (!b) { const I = INSTRUMENTS[instId] || INSTRUMENTS.piano; b = toBuffer(I.render(m)); this.inst.set(key, b); }
      return b;
    }
    fx(name) {
      let b = this.sfx.get(name);
      if (!b) { const fn = SFX[name]; if (!fn) return null; let h = 7; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; b = toBuffer(fn(new RNG(h))); this.sfx.set(name, b); }
      return b;
    }
    /** Pre-render a range of notes in idle slices so the first hits never hitch. */
    warm(instId, lo = 33, hi = 100) {
      for (let m = lo; m <= hi; m++) this.warmQueue.push([instId, m]);
      if (this.warming) return;
      this.warming = true;
      const step = () => {
        const t0 = performance.now();
        while (this.warmQueue.length && performance.now() - t0 < 8) { const [i, m] = this.warmQueue.shift(); this.note(i, m); }
        if (this.warmQueue.length) setTimeout(step, 0); else this.warming = false;
      };
      setTimeout(step, 0);
    }
    warmAllFx() { Object.keys(SFX).forEach((k) => this.fx(k)); }
  }

  // ------------------------------------------------------------------ mixing graph
  function makeIR(ctx, secs, seed) {
    const len = Math.floor(secs * SR);
    const ir = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SR });
    for (let ch = 0; ch < 2; ch++) {
      const rng = new RNG(seed + ch * 101);
      const d = new Float32Array(len);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const a = 0.9 - 0.75 * Math.min(1, t / secs); // darker tail
        y += a * ((rng.next() * 2 - 1) - y);
        d[i] = y * Math.exp(-t / (secs * 0.28)) * Math.min(1, t / 0.008);
      }
      [0.011, 0.019, 0.027, 0.041].forEach((e, k) => { const i = Math.floor((e + ch * 0.003) * SR); d[i] += 0.5 / (k + 1); });
      ir.copyToChannel(normalize(d, 0.5), ch);
    }
    return ir;
  }
  function buildGraph(ctx, opts, ir) {
    const input = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = 1;
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = opts.reverb;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.2;
    const makeup = ctx.createGain(); makeup.gain.value = 1.55;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    const master = ctx.createGain(); master.gain.value = opts.volume;
    input.connect(dry); input.connect(conv); conv.connect(wet);
    dry.connect(comp); wet.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(master);
    master.connect(ctx.destination);
    return { input, wet, master };
  }
  function playOn(ctx, dest, ev, when) {
    const src = ctx.createBufferSource();
    src.buffer = ev.buf;
    if (ev.rate !== 1) src.playbackRate.value = ev.rate;
    const g = ctx.createGain(); g.gain.value = ev.gain;
    let node = g;
    src.connect(g);
    if (ev.pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(ev.pan, -1, 1); g.connect(p); node = p; }
    node.connect(dest);
    src.start(Math.max(0, when));
  }

  class Engine {
    constructor() {
      this.bank = new Bank();
      this.opts = { volume: 0.8, reverb: 0.28, sfx: 1, music: 1 };
      this.ctx = null; this.graph = null; this.ir = null; this.streamDest = null;
    }
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ sampleRate: SR, latencyHint: 'interactive' });
        this.ir = makeIR(this.ctx, 2.6, 9001);
        this.graph = buildGraph(this.ctx, this.opts, this.ir);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    get ready() { return !!this.ctx && this.ctx.state === 'running'; }
    setOpts(o) {
      Object.assign(this.opts, o);
      if (this.graph) { this.graph.master.gain.value = this.opts.volume; this.graph.wet.gain.value = this.opts.reverb; }
    }
    /** A MediaStream carrying the master mix (for live recording). */
    stream() {
      this.ensure();
      if (!this.streamDest) { this.streamDest = this.ctx.createMediaStreamDestination(); this.graph.master.connect(this.streamDest); }
      return this.streamDest.stream;
    }
    playLive(ev, delay) {
      if (!this.ready) return;
      playOn(this.ctx, this.graph.input, ev, this.ctx.currentTime + 0.012 + delay);
    }
    /** Render a captured event list (times in seconds) into a stereo AudioBuffer. */
    async renderOffline(events, duration) {
      const len = Math.ceil((duration + 0.05) * SR);
      const oc = new OfflineAudioContext({ numberOfChannels: 2, length: len, sampleRate: SR });
      const ir = this.ir || makeIR(oc, 2.6, 9001);
      const g = buildGraph(oc, this.opts, ir);
      for (const ev of events) if (ev.t < duration) playOn(oc, g.input, ev, ev.t);
      return oc.startRendering();
    }
  }

  // ------------------------------------------------------------------ music theory
  const SCALES = {
    majPent: { name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9], minor: false },
    minPent: { name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10], minor: true },
    major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], minor: false },
    minor: { name: 'Natural Minor', steps: [0, 2, 3, 5, 7, 8, 10], minor: true },
    dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], minor: true },
    lydian: { name: 'Lydian (dreamy)', steps: [0, 2, 4, 6, 7, 9, 11], minor: false },
    harmMinor: { name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11], minor: true },
    japanese: { name: 'In-Sen (Japanese)', steps: [0, 1, 5, 7, 10], minor: true },
  };
  const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Public-domain melodies (MIDI note numbers). Composers died > 100 years ago / traditional.
  const MELODIES = {
    ode: { name: 'Ode to Joy (Beethoven)', notes: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62, 64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60, 62, 62, 64, 60, 62, 64, 65, 64, 60, 62, 64, 65, 64, 62, 60, 62, 55, 64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60] },
    elise: { name: 'Für Elise (Beethoven)', notes: [76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 68, 71, 72, 64, 76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 72, 71, 69] },
    canon: { name: 'Canon in D (Pachelbel)', notes: [78, 76, 74, 73, 71, 69, 71, 73, 74, 73, 71, 69, 67, 66, 67, 64, 66, 69, 74, 73, 71, 74, 73, 71, 69, 67, 66, 64, 62, 64, 66, 69] },
    mountain: { name: 'Hall of the Mountain King (Grieg)', notes: [59, 61, 62, 64, 66, 62, 66, 65, 61, 65, 64, 60, 64, 59, 61, 62, 64, 66, 62, 66, 71, 69, 66, 62, 66, 69], rise: true },
    twinkle: { name: 'Twinkle Twinkle (traditional)', notes: [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60, 67, 67, 65, 65, 64, 64, 62, 67, 67, 65, 65, 64, 64, 62] },
    korobeiniki: { name: 'Korobeiniki (Russian folk)', notes: [76, 71, 72, 74, 72, 71, 69, 69, 72, 76, 74, 72, 71, 72, 74, 76, 72, 69, 69, 74, 77, 81, 79, 77, 76, 72, 76, 74, 72, 71, 71, 72, 74, 76, 72, 69, 69] },
    greensleeves: { name: 'Greensleeves (traditional)', notes: [69, 72, 74, 76, 77, 76, 74, 71, 67, 69, 71, 72, 69, 69, 68, 69, 71, 68, 64, 69, 72, 74, 76, 77, 76, 74, 71, 67, 69, 71, 72, 71, 69, 68, 66, 68, 69, 69] },
    moonlight: { name: 'Moonlight Sonata (Beethoven)', notes: [56, 61, 64, 56, 61, 64, 56, 61, 64, 56, 61, 64, 57, 61, 64, 57, 61, 64, 57, 62, 66, 57, 62, 66, 56, 60, 66, 56, 61, 64, 56, 61, 63, 54, 60, 63] },
  };
  const PATTERNS = {
    chords: 'Chord Arpeggios', climb: 'Scale Climb', pingpong: 'Scale Up & Down', melody: 'Melody (note per hit)', tension: 'Rises With Tension', random: 'Random In-Key',
  };

  /** Per-run note sequencer. Deterministic: its state lives in the Game, not globally. */
  class Music {
    constructor(game, s) {
      this.g = game; this.s = s;
      this.i = 0; this.dir = 1; this.chordHits = 0; this.chord = 0; this.lastNote = -1; this.loop = 0;
      this.steps = (SCALES[s.scale] || SCALES.majPent).steps;
      this.minor = (SCALES[s.scale] || SCALES.majPent).minor;
      this.base = 48 + (s.key | 0) + (s.octave | 0) * 12;
    }
    scaleNote(idx) {
      const n = this.steps.length;
      const o = Math.floor(idx / n), d = ((idx % n) + n) % n;
      return this.base + o * 12 + this.steps[d];
    }
    next(opts = {}) {
      const s = this.s, n = this.steps.length;
      const range = n * 2 + 1;
      switch (opts.pattern || s.pattern) {
        case 'climb': { const m = this.scaleNote(this.i % range); this.i++; return m; }
        case 'pingpong': {
          const m = this.scaleNote(this.i);
          this.i += this.dir; if (this.i >= range - 1) this.dir = -1; if (this.i <= 0) this.dir = 1;
          return m;
        }
        case 'melody': {
          const mel = MELODIES[s.melody] || MELODIES.ode;
          const k = this.i % mel.notes.length;
          if (k === 0 && this.i > 0) this.loop++;
          this.i++;
          let m = mel.notes[k] + (s.octave | 0) * 12;
          if (mel.rise) m += Math.min(this.loop, 3) * 2; // Mountain King climbs each loop
          return m;
        }
        case 'tension': {
          const t = clamp(this.g.tension, 0, 1);
          const idx = Math.floor(t * (n * 2.4)) + Math.floor(this.g.rng.next() * 3);
          return this.scaleNote(idx);
        }
        case 'random': return this.scaleNote(Math.floor(this.g.rng.next() * range));
        case 'chords':
        default: {
          const prog = this.minor ? [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']] : [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']];
          const [r, q] = prog[this.chord % 4];
          const third = q === 'm' ? 3 : 4;
          const tones = [0, third, 7, 12, 12 + third, 19, 24];
          const k = this.i % (tones.length * 2 - 2);
          const idx = k < tones.length ? k : tones.length * 2 - 2 - k;
          this.i++;
          this.chordHits++;
          if (this.chordHits >= 8) { this.chordHits = 0; this.chord++; this.i = 0; this.pendingBass = true; }
          let root = this.base + r; if (r >= 7) root -= 12;
          return root + tones[idx];
        }
      }
    }
    /** Play the next musical note for a collision. */
    hit(vel = 0.7, pan = 0, opts = {}) {
      const m = this.next(opts);
      this.g.snd.note(m, vel, pan, 0, opts);
      if (this.pendingBass || (this.s.pattern === 'chords' && this.g.snd.count === 0)) {
        this.pendingBass = false;
        const prog = this.minor ? [0, 8, 3, 10] : [0, 7, 9, 5];
        let r = this.base + prog[this.chord % 4] - 12; if (prog[this.chord % 4] >= 7) r -= 12;
        this.g.snd.note(r, 0.45, 0, 0, { bass: true });
      }
      this.lastNote = m;
      return m;
    }
    /** A triumphant arpeggio in key — used for wins. */
    fanfare(delay = 0) {
      const b = this.base + 12;
      const third = this.minor ? 3 : 4;
      const seq = [0, third, 7, 12, 12 + third, 19, 24];
      seq.forEach((iv, k) => this.g.snd.note(b + iv, 0.8, (k / 6) * 1.2 - 0.6, delay + k * 0.075, { prio: 2 }));
      [0, third, 7, 12].forEach((iv) => this.g.snd.note(b + iv, 0.55, 0, delay + 0.6, { prio: 2 }));
      this.g.snd.note(b - 12, 0.7, 0, delay + 0.6, { prio: 2 });
    }
  }

  /** Per-game sound output: live playback, or capture for offline export. Voice-limited in sim time. */
  class SoundOut {
    constructor(engine, game, mode) {
      this.e = engine; this.g = game; this.mode = mode; // 'live' | 'capture' | 'mute'
      this.events = []; this.voices = []; this.last = new Map(); this.count = 0;
      this.frameStart = 0; this.maxVoices = 30;
    }
    get inst() { return this.g.soundCfg.theme; }
    play(buf, vel, pan = 0, rate = 1, delay = 0, prio = 0, kind = 'music') {
      if (!buf || this.mode === 'mute') return;
      const t = this.g.clock + delay;
      // voice management in presentation time (identical live and offline)
      const v = this.voices;
      while (v.length && v[0] <= t) v.shift();
      const lastT = this.last.get(buf);
      if (prio < 1 && lastT !== undefined && t - lastT < 0.028) return;
      if (prio < 1 && v.length >= this.maxVoices) return;
      this.last.set(buf, t);
      const end = t + Math.min(buf.duration / rate, 1.2);
      let i = v.length; while (i > 0 && v[i - 1] > end) i--; v.splice(i, 0, end);
      this.count++;
      const opts = this.e.opts;
      const gain = clamp(vel, 0, 1.2) * (kind === 'sfx' ? opts.sfx : opts.music);
      const ev = { buf, t, gain, pan: pan * 0.7, rate };
      if (this.mode === 'live') this.e.playLive(ev, Math.max(0, t - this.frameStart));
      else this.events.push(ev);
    }
    note(midi, vel = 0.7, pan = 0, delay = 0, opts = {}) {
      const inst = opts.inst || this.inst;
      const I = INSTRUMENTS[inst] || INSTRUMENTS.piano;
      this.play(this.e.bank.note(inst, midi), vel * I.gain * (opts.bass ? 0.9 : 1), pan, 1, delay, opts.prio || 0, 'music');
    }
    sfx(name, vel = 0.8, pan = 0, rate = 1, delay = 0) {
      this.play(this.e.bank.fx(name), vel, pan, rate, delay, 1, 'sfx');
    }
  }

  SB.audio = { Engine, Music, SoundOut, INSTRUMENTS, SFX, SCALES, KEYS, MELODIES, PATTERNS, SR, mtof };
})(window.SB);
