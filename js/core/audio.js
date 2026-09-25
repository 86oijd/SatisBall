/* SatisBall — audio engine.
 *
 *  - DSP renderers (audio-dsp.js) are rendered once into AudioBuffers (cached, warmed in idle time).
 *  - Mix: notes + backing track share a "music" bus that ducks under big effects; effects have their
 *    own bus; both feed a reverb → compressor → limiter chain. The identical graph is used live and in
 *    an OfflineAudioContext for export, so exports sound exactly like the preview.
 *  - Music: a per-run sequencer turns collisions into notes (chord arpeggios, scale climbs, melodies,
 *    rising tension) and a generative backing track (pad, bass, drums) that builds with the tension.
 */
'use strict';
(function (SB) {
  const { clamp, RNG } = SB.util;
  const { SR, mtof, INSTRUMENTS, SFX, padChord, stabChord, fadeIn, fadeOut } = SB.dsp;
  const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 400 }) : (fn) => setTimeout(() => fn({ timeRemaining: () => 6 }), 30);

  // ------------------------------------------------------------------ bank (buffer cache)
  function toBuffer(data) {
    const chans = Array.isArray(data) ? data : [data];
    for (const d of chans) { fadeIn(d, 0.0015); fadeOut(d, 0.004); } // no clicks, ever
    const ab = new AudioBuffer({ length: chans[0].length, numberOfChannels: chans.length, sampleRate: SR });
    chans.forEach((d, i) => ab.copyToChannel(d, i));
    return ab;
  }
  const hashStr = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  class Bank {
    constructor() { this.inst = new Map(); this.sfx = new Map(); this.pads = new Map(); this.queue = []; this.queued = new Set(); this.warming = false; }
    note(instId, m) {
      m = clamp(Math.round(m), 21, 108);
      const key = instId + ':' + m;
      let b = this.inst.get(key);
      if (!b) { const I = INSTRUMENTS[instId] || INSTRUMENTS.piano; b = toBuffer(I.render(m)); this.inst.set(key, b); }
      return b;
    }
    /** Live path: never block a frame — if a note isn't rendered yet, pitch-shift the nearest one. */
    noteLive(instId, m) {
      m = clamp(Math.round(m), 21, 108);
      const b = this.inst.get(instId + ':' + m);
      if (b) return { buf: b, rate: 1 };
      this.enqueue(instId, m, true);
      for (let d = 1; d <= 7; d++) for (const s of [-1, 1]) {
        const nb = this.inst.get(instId + ':' + (m + d * s));
        if (nb) return { buf: nb, rate: Math.pow(2, -d * s / 12) };
      }
      return { buf: this.note(instId, m), rate: 1 };
    }
    fx(name) {
      let b = this.sfx.get(name);
      if (!b) { const fn = SFX[name]; if (!fn) return null; b = toBuffer(fn(new RNG(hashStr(name)))); this.sfx.set(name, b); }
      return b;
    }
    pad(notes, dur, bright = 1) {
      const key = notes.join(',') + '|' + dur.toFixed(2) + '|' + bright;
      let b = this.pads.get(key);
      if (!b) { b = toBuffer(padChord(notes, dur, hashStr(key) % 97, bright)); this.pads.set(key, b); }
      return b;
    }
    stab(notes) {
      const key = 'stab:' + notes.join(',');
      let b = this.pads.get(key);
      if (!b) { b = toBuffer(stabChord(notes, hashStr(key) % 97)); this.pads.set(key, b); }
      return b;
    }
    /** Live-safe lookups: return a cached buffer or null (and queue the render for idle time). */
    padIfReady(notes, dur, bright) {
      const key = notes.join(',') + '|' + dur.toFixed(2) + '|' + bright;
      const b = this.pads.get(key);
      if (!b && !this.queued.has(key)) { this.queued.add(key); this.queue.unshift(['pad', notes, dur, bright, key]); this.pump(); }
      return b || null;
    }
    stabIfReady(notes) {
      const key = 'stab:' + notes.join(',');
      const b = this.pads.get(key);
      if (!b && !this.queued.has(key)) { this.queued.add(key); this.queue.unshift(['stab', notes, key]); this.pump(); }
      return b || null;
    }
    enqueue(instId, m, front) {
      const k = instId + ':' + m;
      if (this.inst.has(k) || this.queued.has(k)) return;
      this.queued.add(k);
      if (front) this.queue.unshift(['note', instId, m]); else this.queue.push(['note', instId, m]);
      this.pump();
    }
    /** Pre-render notes (priority list first) in idle time so the first hits never hitch. */
    warm(instId, notes = [], lo = 33, hi = 100) {
      for (const m of notes) this.enqueue(instId, m, false);
      for (let m = lo; m <= hi; m++) this.enqueue(instId, m, false);
    }
    warmFx() { for (const k of Object.keys(SFX)) if (!this.sfx.has(k)) this.queue.push(['fx', k]); this.pump(); }
    pump() {
      if (this.warming) return;
      this.warming = true;
      const step = (dl) => {
        const t0 = performance.now();
        while (this.queue.length && (dl.timeRemaining() > 3 || performance.now() - t0 < 2)) {
          const job = this.queue.shift();
          if (job[0] === 'note') { this.queued.delete(job[1] + ':' + job[2]); this.note(job[1], job[2]); }
          else if (job[0] === 'pad') { this.pad(job[1], job[2], job[3]); this.queued.delete(job[4]); }
          else if (job[0] === 'stab') { this.stab(job[1]); this.queued.delete(job[2]); }
          else this.fx(job[1]);
          if (performance.now() - t0 > 10) break;
        }
        if (this.queue.length) idle(step); else this.warming = false;
      };
      idle(step);
    }
  }

  // ------------------------------------------------------------------ mixing graph
  function makeIR(secs, seed) {
    const len = Math.floor(secs * SR);
    const ir = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SR });
    for (let ch = 0; ch < 2; ch++) {
      const rng = new RNG(seed + ch * 101);
      const d = new Float32Array(len);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const a = 0.9 - 0.75 * Math.min(1, t / secs);
        y += a * ((rng.next() * 2 - 1) - y);
        d[i] = y * Math.exp(-t / (secs * 0.28)) * Math.min(1, t / 0.008);
      }
      [0.011, 0.019, 0.027, 0.041].forEach((e, k) => { const i = Math.floor((e + ch * 0.003) * SR); d[i] += 0.5 / (k + 1); });
      let m = 0; for (let i = 0; i < len; i++) m = Math.max(m, Math.abs(d[i]));
      for (let i = 0; i < len; i++) d[i] *= 0.5 / m;
      ir.copyToChannel(d, ch);
    }
    return ir;
  }
  function buildGraph(ctx, opts, ir) {
    const music = ctx.createGain(), sfx = ctx.createGain(), mixIn = ctx.createGain();
    music.connect(mixIn); sfx.connect(mixIn);
    const dry = ctx.createGain();
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = opts.reverb;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32; hp.Q.value = 0.7;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 7500; air.gain.value = 2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.2;
    const makeup = ctx.createGain(); makeup.gain.value = 1.55;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    const master = ctx.createGain(); master.gain.value = opts.volume;
    mixIn.connect(dry); mixIn.connect(conv); conv.connect(wet);
    dry.connect(hp); wet.connect(hp); hp.connect(air); air.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(master);
    master.connect(ctx.destination);
    return { music, sfx, wet, master };
  }
  function playOn(ctx, graph, ev, when) {
    const src = ctx.createBufferSource();
    src.buffer = ev.buf;
    if (ev.rate !== 1) src.playbackRate.value = ev.rate;
    const g = ctx.createGain(); g.gain.value = ev.gain;
    let node = g;
    src.connect(g);
    if (ev.pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(ev.pan, -1, 1); g.connect(p); node = p; }
    node.connect(ev.bus === 'sfx' ? graph.sfx : graph.music);
    const t = Math.max(0, when);
    src.start(t);
    if (ev.duck) {
      // sidechain-style dip of notes + backing under big hits
      const gm = graph.music.gain;
      gm.setTargetAtTime(1 - ev.duck, t, 0.008);
      gm.setTargetAtTime(1, t + 0.09, 0.22);
    }
  }

  class Engine {
    constructor() {
      this.bank = new Bank();
      this.opts = { volume: 0.8, reverb: 0.28, sfx: 1, music: 1, bed: 0.8 };
      this.ctx = null; this.graph = null; this.ir = null; this.streamDest = null;
    }
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ sampleRate: SR, latencyHint: 'interactive' });
        this.ir = makeIR(2.6, 9001);
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
      playOn(this.ctx, this.graph, ev, this.ctx.currentTime + 0.012 + delay);
    }
    /** Render a captured event list (times in seconds) into a stereo AudioBuffer. `shift` offsets every event. */
    async renderOffline(events, duration, shift = 0) {
      const len = Math.ceil((duration + 0.05) * SR);
      const oc = new OfflineAudioContext({ numberOfChannels: 2, length: len, sampleRate: SR });
      const g = buildGraph(oc, this.opts, this.ir || (this.ir = makeIR(2.6, 9001)));
      const evs = events.slice().sort((a, b) => a.t - b.t);
      for (const ev of evs) { const t = ev.t + shift; if (t < duration) playOn(oc, g, ev, Math.max(0, t)); }
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
  // Public-domain melodies (MIDI notes) with their home key (root pitch class) and mode.
  const MELODIES = {
    ode: { name: 'Ode to Joy (Beethoven)', root: 0, minor: false, notes: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62, 64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60, 62, 62, 64, 60, 62, 64, 65, 64, 60, 62, 64, 65, 64, 62, 60, 62, 55, 64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60] },
    elise: { name: 'Für Elise (Beethoven)', root: 9, minor: true, notes: [76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 68, 71, 72, 64, 76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 72, 71, 69] },
    canon: { name: 'Canon in D (Pachelbel)', root: 2, minor: false, notes: [78, 76, 74, 73, 71, 69, 71, 73, 74, 73, 71, 69, 67, 66, 67, 64, 66, 69, 74, 73, 71, 74, 73, 71, 69, 67, 66, 64, 62, 64, 66, 69] },
    mountain: { name: 'Hall of the Mountain King (Grieg)', root: 11, minor: true, notes: [59, 61, 62, 64, 66, 62, 66, 65, 61, 65, 64, 60, 64, 59, 61, 62, 64, 66, 62, 66, 71, 69, 66, 62, 66, 69], rise: true },
    twinkle: { name: 'Twinkle Twinkle (traditional)', root: 0, minor: false, notes: [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60, 67, 67, 65, 65, 64, 64, 62, 67, 67, 65, 65, 64, 64, 62] },
    korobeiniki: { name: 'Korobeiniki (Russian folk)', root: 9, minor: true, notes: [76, 71, 72, 74, 72, 71, 69, 69, 72, 76, 74, 72, 71, 72, 74, 76, 72, 69, 69, 74, 77, 81, 79, 77, 76, 72, 76, 74, 72, 71, 71, 72, 74, 76, 72, 69, 69] },
    greensleeves: { name: 'Greensleeves (traditional)', root: 9, minor: true, notes: [69, 72, 74, 76, 77, 76, 74, 71, 67, 69, 71, 72, 69, 69, 68, 69, 71, 68, 64, 69, 72, 74, 76, 77, 76, 74, 71, 67, 69, 71, 72, 71, 69, 68, 66, 68, 69, 69] },
    moonlight: { name: 'Moonlight Sonata (Beethoven)', root: 1, minor: true, notes: [56, 61, 64, 56, 61, 64, 56, 61, 64, 56, 61, 64, 57, 61, 64, 57, 61, 64, 57, 62, 66, 57, 62, 66, 56, 60, 66, 56, 61, 64, 56, 61, 63, 54, 60, 63] },
    william: { name: 'William Tell Overture (Rossini)', root: 0, minor: false, notes: [67, 67, 67, 67, 67, 67, 67, 67, 72, 67, 67, 67, 67, 67, 72, 67, 67, 67, 67, 67, 72, 67, 72, 76, 72, 67, 67, 67, 67, 67, 67, 67, 67, 72, 67, 72, 74, 76, 77, 76, 74, 72], rise: true },
    habanera: { name: 'Habanera (Bizet)', root: 2, minor: true, notes: [74, 73, 72, 72, 71, 70, 70, 69, 68, 67, 65, 67, 65, 64, 65, 67, 65, 64, 62] },
  };
  const PATTERNS = {
    chords: 'Chord Arpeggios', climb: 'Scale Climb', pingpong: 'Scale Up & Down', melody: 'Melody (note per hit)', tension: 'Rises With Tension', random: 'Random In-Key',
  };
  const BACKING = { off: 'Off (hits only)', pad: 'Ambient pad', build: 'Builds with tension', full: 'Full beat from the start' };

  /** Per-run note sequencer. Deterministic: its state lives in the Game, not globally. */
  class Music {
    constructor(game, s) {
      this.g = game; this.s = s;
      this.i = 0; this.dir = 1; this.chordHits = 0; this.chord = 0; this.lastNote = -1; this.loop = 0;
      const sc = SCALES[s.scale] || SCALES.majPent;
      this.steps = sc.steps; this.minor = sc.minor;
      this.root = s.key | 0;
      if (s.pattern === 'melody') { const mel = MELODIES[s.melody] || MELODIES.ode; this.root = mel.root; this.minor = mel.minor; }
      this.base = 48 + (s.pattern === 'melody' ? this.root : (s.key | 0)) + (s.octave | 0) * 12;
    }
    prog() { return this.minor ? [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']] : [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']]; }
    /** Current chord index: bar-locked when the backing track runs, hit-counted otherwise. */
    chordIdx() { return this.g.bed && this.g.bed.active ? this.g.bed.bar : this.chord; }
    chordTones(idx) {
      const [r, q] = this.prog()[idx % 4];
      let root = this.base + r; if (r >= 7) root -= 12;
      return { root, third: q === 'm' ? 3 : 4 };
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
          if (mel.rise) m += Math.min(this.loop, 3) * 2; // climbs each loop
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
          const bedOn = this.g.bed && this.g.bed.active;
          const ci = this.chordIdx();
          if (bedOn && ci !== this.lastChord) { this.lastChord = ci; this.i = 0; }
          const { root, third } = this.chordTones(ci);
          const tones = [0, third, 7, 12, 12 + third, 19, 24];
          const k = this.i % (tones.length * 2 - 2);
          const idx = k < tones.length ? k : tones.length * 2 - 2 - k;
          this.i++;
          if (!bedOn) { this.chordHits++; if (this.chordHits >= 8) { this.chordHits = 0; this.chord++; this.i = 0; this.pendingBass = true; } }
          return root + tones[idx];
        }
      }
    }
    /** Play the next musical note for a collision. */
    hit(vel = 0.7, pan = 0, opts = {}) {
      const m = this.next(opts);
      this.g.snd.note(m, vel, pan, 0, opts);
      this.g.bump(0.06 + vel * 0.1);
      const bedOn = this.g.bed && this.g.bed.active;
      if (!bedOn && (this.pendingBass || (this.s.pattern === 'chords' && this.g.snd.count === 0))) {
        this.pendingBass = false;
        const { root } = this.chordTones(this.chord);
        this.g.snd.note(root - 12, 0.45, 0, 0, { bass: true });
      }
      this.lastNote = m;
      return m;
    }
    /** A triumphant arpeggio in key — used for wins. */
    fanfare(delay = 0) {
      const b = this.base + 12;
      const third = this.minor ? 3 : 4;
      const seq = [0, third, 7, 12, 12 + third, 19, 24];
      seq.forEach((iv, k) => this.g.snd.note(b + iv, 0.8, (k / 6) * 1.2 - 0.6, delay + k * 0.07, { prio: 2 }));
      [0, third, 7, 12].forEach((iv) => this.g.snd.note(b + iv, 0.55, 0, delay + 0.56, { prio: 2 }));
      this.g.snd.note(b - 12, 0.7, 0, delay + 0.56, { prio: 2 });
    }
  }

  /** Generative backing track: pad on every bar, then kick → hats → bass → claps enter as tension rises.
   *  Scheduled on the presentation clock (deterministic, identical offline). Uses its own RNG. */
  class Backing {
    constructor(game, s) {
      this.g = game; this.s = s;
      this.style = s.backing || 'build';
      this.active = this.style !== 'off';
      const r = new RNG((game.seed ^ 0x5eed5) >>> 0);
      this.bpm = s.bpm > 0 ? s.bpm : r.int(100, 124);
      this.b16 = 60 / this.bpm / 4; // one 16th
      this.last16 = -1; this.bar = 0; this.done = false; this.riserBar = -99;
      this.melodyMode = s.pattern === 'melody';
      this.live = game.snd.mode === 'live';
      if (this.active && this.live) this.prewarm();
    }
    barLen() { return this.b16 * 16; }
    padNotes(ci) {
      const m = this.g.music, { root, third } = m.chordTones(ci);
      const n = this.melodyMode ? [m.base - 12, m.base - 5, m.base] : [root - 12, root - 12 + third, root - 5, root];
      return n.map((x) => clamp(x, 36, 84));
    }
    finaleNotes() { const m = this.g.music, r = m.base, third = m.minor ? 3 : 4; return { stab: [r - 12, r - 5, r, r + third, r + 7], pad: [r - 12, r - 5, r, r + third + 12] }; }
    prewarm() {
      const bank = this.g.snd.e.bank, dur = this.barLen() + 0.9;
      for (const br of [0.8, 1.15, 1.5]) for (let ci = 0; ci < 4; ci++) bank.padIfReady(this.padNotes(ci), dur, br);
      const f = this.finaleNotes(); bank.stabIfReady(f.stab); bank.padIfReady(f.pad, 4.2, 1.4);
    }
    getPad(notes, dur, bright) {
      const bank = this.g.snd.e.bank;
      if (!this.live) return bank.pad(notes, dur, bright);
      return bank.padIfReady(notes, dur, bright) || bank.padIfReady(notes, dur, 0.8);
    }
    intensity() {
      const g = this.g;
      if (this.style === 'pad') return 0.15;
      const base = clamp(g.tension * 1.05 + g.pace * 0.22, 0, 1);
      return this.style === 'full' ? Math.max(0.62, base) : base;
    }
    update() {
      if (!this.active || this.done || this.g.state === 'intro') return;
      const t = this.g.clock - this.g.playStart;
      const s16 = Math.floor(t / this.b16);
      while (this.last16 < s16) { this.last16++; this.tick(this.last16, this.g.playStart + this.last16 * this.b16); }
    }
    at(when) { return when - this.g.clock; }
    tick(i, when) {
      const snd = this.g.snd, bank = this.g.snd.e.bank, pos = i % 16, I = this.intensity();
      const d = this.at(when), vol = this.s.bedVol ?? 0.8;
      if (pos === 0) {
        this.bar = Math.floor(i / 16);
        const barLen = this.barLen(), bright = I < 0.4 ? 0.8 : I < 0.75 ? 1.15 : 1.5;
        snd.playRaw(this.getPad(this.padNotes(this.bar % 4), barLen + 0.9, bright), 0.3 * vol * (0.7 + I * 0.5), 0, d, 'bed');
        if (I > 0.9 && this.bar - this.riserBar > 6) { this.riserBar = this.bar; snd.playRaw(bank.fx('swell'), 0.4 * vol, 0, d + barLen - 1.1, 'bed'); }
      }
      const bassRoot = this.melodyMode ? this.g.music.base - 24 : this.g.music.chordTones(this.bar % 4).root - 24;
      const kick = (I > 0.55 && pos % 4 === 0) || (I > 0.25 && (pos === 0 || pos === 8));
      if (kick) { snd.playRaw(bank.fx('kick'), 0.62 * vol, 0, d, 'bed'); this.g.bump(0.18); }
      if (I > 0.42 && pos % 4 === 2) snd.playRaw(bank.fx('hat'), 0.3 * vol, 0.25, d, 'bed');
      if (I > 0.78 && pos % 2 === 1) snd.playRaw(bank.fx('hat'), 0.16 * vol, -0.25, d, 'bed');
      if (I > 0.5 && (pos % 4 === 2 || (I > 0.8 && pos % 4 === 3 && pos > 8))) snd.playRaw(bank.note('bass', clamp(bassRoot, 28, 52)), 0.5 * vol, 0, d, 'bed');
      if (I > 0.7 && (pos === 4 || pos === 12)) snd.playRaw(bank.fx('clap'), 0.42 * vol, 0, d, 'bed');
      if (I > 0.92 && this.bar % 2 === 1 && pos >= 12) snd.playRaw(bank.fx('snare'), (0.18 + (pos - 12) * 0.06) * vol, 0, d, 'bed');
    }
    /** Payoff: stop the beat, hit a huge chord and let a tonic pad ring out. */
    finale() {
      if (!this.active || this.done) return;
      this.done = true;
      const snd = this.g.snd, bank = snd.e.bank, vol = this.s.bedVol ?? 0.8, f = this.finaleNotes();
      snd.playRaw(this.live ? bank.stabIfReady(f.stab) : bank.stab(f.stab), 0.55 * vol, 0, 0.02, 'bed');
      snd.playRaw(this.getPad(f.pad, 4.2, 1.4), 0.4 * vol, 0, 0.05, 'bed');
      snd.playRaw(bank.fx('kick'), 0.8 * vol, 0, 0.0, 'bed');
    }
  }

  /** Per-game sound output: live playback, or capture for offline export. Voice-limited in presentation time. */
  class SoundOut {
    constructor(engine, game, mode) {
      this.e = engine; this.g = game; this.mode = mode; // 'live' | 'capture' | 'mute'
      this.events = []; this.voices = []; this.last = new Map(); this.active = new Map(); this.count = 0;
      this.frameStart = 0; this.maxVoices = 30;
    }
    get inst() { return this.g.soundCfg.theme; }
    push(buf, gain, pan, rate, t, bus, duck) {
      const ev = { buf, t, gain, pan: pan * 0.7, rate, bus, duck };
      if (this.mode === 'live') this.e.playLive(ev, Math.max(0, t - this.frameStart));
      else this.events.push(ev);
    }
    play(buf, vel, pan = 0, rate = 1, delay = 0, prio = 0, kind = 'music', duck = 0) {
      if (!buf || this.mode === 'mute') return;
      const t = this.g.clock + delay;
      // voice management in presentation time (identical live and offline)
      const v = this.voices;
      while (v.length && v[0] <= t) v.shift();
      const lastT = this.last.get(buf);
      if (lastT !== undefined && t - lastT < (prio < 1 ? 0.028 : 0.016)) return;
      if (prio < 1 && v.length >= this.maxVoices) return;
      if (kind === 'sfx') {
        // never stack more than 4 copies of the same effect
        let a = this.active.get(buf) || [];
        a = a.filter((e) => e > t);
        if (a.length >= 4 && prio < 2) { this.active.set(buf, a); return; }
        a.push(t + buf.duration / rate); this.active.set(buf, a);
      }
      this.last.set(buf, t);
      if (kind !== 'sfx') { const end = t + Math.min(buf.duration / rate, 1.2); let i = v.length; while (i > 0 && v[i - 1] > end) i--; v.splice(i, 0, end); }
      this.count++;
      const o = this.e.opts;
      const gain = clamp(vel, 0, 1.3) * (kind === 'sfx' ? o.sfx : o.music);
      this.push(buf, gain, pan, rate, t, kind === 'sfx' ? 'sfx' : 'music', duck);
    }
    /** Backing-track sounds: bypass voice limits, own volume. */
    playRaw(buf, vel, pan, delay, kind) {
      if (!buf || this.mode === 'mute') return;
      this.push(buf, vel * (this.e.opts.bed ?? 0.8), pan, 1, this.g.clock + delay, 'music', 0);
    }
    note(midi, vel = 0.7, pan = 0, delay = 0, opts = {}) {
      const inst = opts.inst || this.inst;
      const I = INSTRUMENTS[inst] || INSTRUMENTS.piano;
      const g = vel * I.gain * (opts.bass ? 0.9 : 1);
      if (this.mode === 'live') { const { buf, rate } = this.e.bank.noteLive(inst, midi); this.play(buf, g, pan, rate, delay, opts.prio || 0, 'music'); }
      else this.play(this.e.bank.note(inst, midi), g, pan, 1, delay, opts.prio || 0, 'music');
    }
    /** duck: 0..1 dips the music bus under this effect (big hits, eliminations, wins). */
    sfx(name, vel = 0.8, pan = 0, rate = 1, delay = 0, duck = 0) {
      const d = duck || (name === 'elim' || name === 'boom' || name === 'explode' ? 0.45 : name === 'shatter' || name === 'crush' || name === 'roar' ? 0.3 : 0);
      this.play(this.e.bank.fx(name), vel, pan, rate, delay, 1, 'sfx', d);
    }
  }

  const THEMES = Object.entries(INSTRUMENTS).filter(([, I]) => !I.hidden).map(([k, I]) => [k, I.name]);
  SB.audio = { Engine, Music, Backing, SoundOut, INSTRUMENTS, SFX, SCALES, KEYS, MELODIES, PATTERNS, BACKING, THEMES, SR, mtof };
})(window.SB);
