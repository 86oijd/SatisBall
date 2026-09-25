/* SatisBall — studio UI: mode browser, settings panels, presets, randomise, record/export, recording mode. */
'use strict';
(function (SB) {
  const { RNG, clamp } = SB.util;
  const STEP = SB.GAME.STEP;
  const STORE = 'satisball.v1';

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };

  const DEFAULT_STATE = () => ({
    modeId: 'rings',
    settings: {},
    look: { palette: 'neon', glow: 0.9, bloom: 0.55, trails: true, shake: 1, particles: 1, ballStyle: 'glossy' },
    sound: { theme: 'piano', pattern: 'chords', key: 0, scale: 'majPent', melody: 'ode', octave: 0, volume: 0.85, reverb: 0.28, sfx: 1, music: 1 },
    text: { showHook: true, hookMode: 'always', hooks: {}, hookSize: 74, showEnd: true, endText: 'Did you *call it?*' },
    run: { targetLen: 35, autoRestart: true, autoRandom: false, randomLook: true, seed: 1 },
  });

  class UI {
    constructor(root) {
      this.root = root;
      this.state = this.load();
      this.engine = SB.engine;
      this.paused = false; this.acc = 0; this.last = 0; this.fps = 60; this.frameMs = 0;
      this.rec = null; this.exporting = false;
      this.build();
      this.applyEngineOpts();
      this.newGame();
      this.bindKeys();
      requestAnimationFrame((t) => this.loop(t));
      SB.recorder.capabilities().then((c) => { this.caps = c; this.updateCaps(); });
    }
    // ------------------------------------------------------------ persistence
    load() {
      const d = DEFAULT_STATE();
      try {
        const s = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (s) { for (const k of Object.keys(d)) if (s[k] && typeof d[k] === 'object') d[k] = Object.assign(d[k], s[k]); if (s.modeId && SB.modes.byId[s.modeId]) d.modeId = s.modeId; }
      } catch (e) { /* storage unavailable */ }
      d.run.seed = (Math.random() * 1e9) >>> 0;
      return d;
    }
    save() { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch (e) { /* ignore */ } }
    get def() { return SB.modes.byId[this.state.modeId]; }
    modeSettings() {
      const id = this.state.modeId;
      if (!this.state.settings[id]) this.state.settings[id] = {};
      return Object.assign({}, this.def.defaults, this.state.settings[id]);
    }
    gameCfg(canvas) {
      const st = this.state;
      return {
        canvas, modeId: st.modeId, seed: st.run.seed, settings: this.modeSettings(),
        look: Object.assign({}, st.look), sound: Object.assign({}, st.sound), text: JSON.parse(JSON.stringify(st.text)),
        run: Object.assign({}, st.run), engine: this.engine, audioMode: 'live',
      };
    }
    applyEngineOpts() {
      const s = this.state.sound;
      this.engine.setOpts({ volume: s.volume, reverb: s.reverb, sfx: s.sfx, music: s.music });
      this.engine.bank.warm(s.theme, 30, 100);
    }

    // ------------------------------------------------------------ game lifecycle
    newGame() {
      this.game = new SB.Game(this.gameCfg(this.canvas));
      this.game.onDone = () => this.onRunDone();
      this.acc = 0;
      this.$seed.textContent = '#' + this.state.run.seed;
      this.$modeTitle.textContent = this.def.name;
    }
    restart(newSeed) {
      if (newSeed) this.state.run.seed = (Math.random() * 1e9) >>> 0;
      this.save(); this.newGame();
    }
    onRunDone() {
      if (this.rec) { this.stopLive(); return; }
      if (this.exporting) return;
      if (this.state.run.autoRestart) {
        setTimeout(() => {
          if (this.state.run.autoRandom) this.randomize(false); else this.restart(true);
        }, 400);
      }
    }
    softRestart() { clearTimeout(this._rt); this._rt = setTimeout(() => this.restart(false), 180); }
    randomize(alsoLook = this.state.run.randomLook) {
      const rng = new RNG((Math.random() * 1e9) >>> 0);
      const def = this.def;
      this.state.settings[def.id] = SB.modes.randomize(def, rng, this.modeSettings());
      if (alsoLook) {
        this.state.look.palette = rng.pick(SB.palettes.list.filter((p) => !p.light || rng.chance(0.3))).id;
        this.state.sound.theme = rng.pick(['piano', 'marimba', 'pluck', 'synth', 'bells', 'kalimba', 'glass', 'chip']);
        this.state.sound.pattern = rng.pick(['chords', 'climb', 'pingpong', 'melody', 'tension']);
        this.state.sound.melody = rng.pick(Object.keys(SB.audio.MELODIES));
        this.state.sound.scale = rng.pick(['majPent', 'minPent', 'major', 'dorian', 'lydian']);
        this.state.sound.key = rng.int(0, 11);
        this.applyEngineOpts();
      }
      this.restart(true);
      this.renderPanels();
    }
    loop(t) {
      requestAnimationFrame((tt) => this.loop(tt));
      const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
      this.last = t;
      if (this.exporting || !this.game) return;
      const g = this.game;
      if (!this.paused) {
        this.acc += dt;
        let n = Math.floor(this.acc / STEP);
        if (n > 16) { n = 16; this.acc = 0; }
        this.acc -= n * STEP;
        g.snd.frameStart = g.clock;
        const a = performance.now();
        for (let i = 0; i < n; i++) g.step();
        g.render();
        this.frameMs = this.frameMs * 0.9 + (performance.now() - a) * 0.1;
      }
      if (dt > 0) this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
      if ((this._fc = (this._fc || 0) + 1) % 15 === 0) this.$perf.textContent = `${Math.round(this.fps)} fps · ${this.frameMs.toFixed(1)} ms · ${SB.util.fmtTime(g.time)}`;
    }

    // ------------------------------------------------------------ DOM
    build() {
      const r = this.root;
      r.innerHTML = '';
      this.canvas = el('canvas', { width: 1080, height: 1920, id: 'view' });
      this.overlay = el('canvas', { width: 1080, height: 1920, id: 'overlay' });
      this.$perf = el('span', { class: 'perf' });
      this.$seed = el('span', { class: 'seed' });
      this.$modeTitle = el('span', { class: 'mode-title' });
      const btn = (label, key, fn, cls = '') => el('button', { class: 'btn ' + cls, title: key ? `${label} (${key})` : label, onclick: fn }, label, key ? el('kbd', {}, key) : null);
      this.$rec = btn('● Record live', 'L', () => (this.rec ? this.stopLive() : this.startLive()), 'rec');
      this.$export = btn('⤓ Export MP4', 'E', () => this.openExport(), 'primary');
      const top = el('header', { class: 'topbar' },
        el('div', { class: 'brand' }, el('span', { class: 'logo' }, el('i'), el('i'), el('i')), el('b', {}, 'SATISBALL'), el('small', {}, 'studio')),
        el('div', { class: 'now' }, this.$modeTitle, this.$seed),
        el('div', { class: 'actions' },
          btn('↻ Restart', 'R', () => this.restart(false)),
          btn('New run', 'N', () => this.restart(true)),
          btn('🎲 Randomise', 'G', () => this.randomize(), 'accent'),
          this.$rec, this.$export,
          btn('◱ Recording mode', 'H', () => this.toggleRecMode()),
        ));
      this.$modes = el('nav', { class: 'modes' });
      this.$panel = el('div', { class: 'panel-body' });
      this.$tabs = el('div', { class: 'tabs' });
      this.stageWrap = el('div', { class: 'stage-wrap' }, el('div', { class: 'stage' }, this.canvas, this.overlay));
      const stageBar = el('div', { class: 'stage-bar' },
        el('button', { class: 'chip', onclick: () => { this.paused = !this.paused; } }, '⏯ Pause'),
        el('label', { class: 'chip' }, el('input', { type: 'checkbox', onchange: (e) => { this.safe = e.target.checked; this.drawOverlay(); } }), ' Safe zones'),
        this.$perf);
      const main = el('main', {}, this.stageWrap, stageBar);
      this.$splash = el('div', { class: 'splash' },
        el('div', { class: 'splash-card' },
          el('div', { class: 'logo big' }, el('i'), el('i'), el('i')),
          el('h1', {}, 'SATISBALL'),
          el('p', {}, 'Satisfying ball simulations, ready to post.'),
          el('button', { class: 'btn primary big' }, 'Click to start (sound on)')));
      this.$splash.addEventListener('click', () => { this.engine.ensure(); this.engine.bank.warmAllFx(); this.$splash.remove(); this.restart(false); });
      this.$hint = el('div', { class: 'rec-hint' }, 'Recording mode — press H or Esc to exit');
      this.$modal = el('div', { class: 'modal hidden' });
      r.append(top, el('div', { class: 'body' }, el('aside', { class: 'left' }, el('h3', {}, 'Modes'), this.$modes), main, el('aside', { class: 'right' }, this.$tabs, this.$panel)), this.$splash, this.$hint, this.$modal);
      this.tab = 'mode';
      this.renderModes(); this.renderPanels();
      window.addEventListener('resize', () => this.fit());
      this.fit();
    }
    fit() {
      const wrap = this.stageWrap;
      const rec = document.body.classList.contains('recmode');
      const H = rec ? window.innerHeight : wrap.clientHeight - 8, Wd = rec ? window.innerWidth : wrap.clientWidth - 8;
      let h = H, w = h * 9 / 16;
      if (w > Wd) { w = Wd; h = w * 16 / 9; }
      const st = wrap.querySelector('.stage');
      st.style.width = Math.floor(w) + 'px'; st.style.height = Math.floor(h) + 'px';
    }
    renderModes() {
      this.$modes.innerHTML = '';
      SB.modes.list.forEach((m, i) => {
        const card = el('button', { class: 'mode-card' + (m.id === this.state.modeId ? ' on' : ''), onclick: () => this.selectMode(m.id) },
          el('span', { class: 'mi' }, m.icon), el('span', { class: 'mt' }, el('b', {}, m.name), el('small', {}, m.tagline)), el('kbd', {}, String(i + 1)));
        this.$modes.append(card);
      });
    }
    selectMode(id) {
      if (!SB.modes.byId[id]) return;
      this.state.modeId = id;
      this.renderModes(); this.renderPanels();
      this.restart(true);
    }
    renderPanels() {
      const tabs = [['mode', 'Mode'], ['look', 'Look'], ['sound', 'Sound'], ['text', 'Text'], ['run', 'Run']];
      this.$tabs.innerHTML = '';
      for (const [k, l] of tabs) this.$tabs.append(el('button', { class: 'tab' + (this.tab === k ? ' on' : ''), onclick: () => { this.tab = k; this.renderPanels(); } }, l));
      const p = this.$panel; p.innerHTML = '';
      this['panel_' + this.tab](p);
    }
    // --- generic controls
    ctlRange(label, val, min, max, step, onchange, fmt) {
      const out = el('output', {}, fmt ? fmt(val) : String(val));
      const inp = el('input', { type: 'range', min, max, step, value: val });
      inp.addEventListener('input', () => { const v = +inp.value; out.textContent = fmt ? fmt(v) : String(v); onchange(v); });
      return el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label), out), inp);
    }
    ctlSelect(label, val, options, onchange) {
      const s = el('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(val) }, l)));
      return el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label)), s);
    }
    ctlToggle(label, val, onchange) {
      const i = el('input', { type: 'checkbox', checked: !!val, onchange: (e) => onchange(e.target.checked) });
      return el('label', { class: 'ctl toggle' }, i, el('i'), el('span', {}, label));
    }
    ctlColor(label, val, onchange) {
      const pal = SB.palettes.get(this.state.look.palette);
      const row = el('div', { class: 'swatches' });
      const mk = (c, title) => el('button', { class: 'sw' + ((val || '') === c ? ' on' : ''), title, style: c ? `background:${c}` : '', onclick: () => { onchange(c); this.renderPanels(); } }, c ? '' : 'auto');
      row.append(mk('', 'Auto (palette)'));
      pal.balls.slice(0, 8).forEach((b) => row.append(mk(b.c, b.n)));
      const custom = el('input', { type: 'color', value: val || '#ffffff', oninput: (e) => onchange(e.target.value) });
      row.append(custom);
      return el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label)), row);
    }
    section(p, title, ...kids) { p.append(el('div', { class: 'sec' }, el('h4', {}, title), ...kids)); }

    panel_mode(p) {
      const def = this.def, cur = this.modeSettings();
      const set = (k, v) => { this.state.settings[def.id][k] = v; this.save(); this.softRestart(); };
      const presets = el('div', { class: 'presets' }, def.presets.map((pr) => el('button', { class: 'chip', onclick: () => this.applyPreset(pr) }, pr.name)));
      this.section(p, 'Presets', presets,
        el('div', { class: 'row' },
          el('button', { class: 'btn accent', onclick: () => this.randomize() }, '🎲 Randomise'),
          el('button', { class: 'btn', onclick: () => { this.state.settings[def.id] = {}; this.save(); this.renderPanels(); this.restart(false); } }, 'Reset to defaults')));
      const ctls = def.settings.map((s) => {
        const v = cur[s.key];
        if (s.type === 'range') return this.ctlRange(s.label, v, s.min, s.max, s.step, (x) => set(s.key, x));
        if (s.type === 'select') return this.ctlSelect(s.label, v, s.options, (x) => set(s.key, x));
        if (s.type === 'toggle') return this.ctlToggle(s.label, v, (x) => set(s.key, x));
        if (s.type === 'color') return this.ctlColor(s.label, v, (x) => set(s.key, x));
        return null;
      });
      this.section(p, def.name + ' settings', ...ctls);
    }
    applyPreset(pr) {
      const def = this.def;
      this.state.settings[def.id] = Object.assign({}, pr.s);
      if (pr.look) Object.assign(this.state.look, pr.look);
      if (pr.sound) { Object.assign(this.state.sound, pr.sound); this.applyEngineOpts(); }
      this.save(); this.renderPanels(); this.restart(true);
    }
    panel_look(p) {
      const L = this.state.look;
      const set = (k, v, restart = true) => { L[k] = v; this.save(); if (restart) this.softRestart(); else if (this.game) Object.assign(this.game.look, { [k]: v }); };
      const pals = el('div', { class: 'palettes' }, SB.palettes.list.map((pl) => el('button', {
        class: 'pal' + (pl.id === L.palette ? ' on' : ''), onclick: () => { L.palette = pl.id; this.save(); this.renderPanels(); this.restart(false); },
        style: `background:linear-gradient(160deg, ${pl.bg[0]}, ${pl.bg[1]})`,
      }, el('span', { class: 'dots' }, pl.balls.slice(0, 5).map((b) => el('i', { style: `background:${b.c}` }))), el('b', { style: `color:${pl.light ? pl.text : '#fff'}` }, pl.name))));
      this.section(p, 'Palette', pals);
      this.section(p, 'Effects',
        this.ctlSelect('Ball style', L.ballStyle, [['glossy', 'Glossy'], ['neon', 'Neon ring'], ['flat', 'Flat']], (v) => set('ballStyle', v, false)),
        this.ctlRange('Glow', L.glow, 0, 1.5, 0.05, (v) => set('glow', v, false)),
        this.ctlRange('Bloom', L.bloom, 0, 1.2, 0.05, (v) => set('bloom', v, false)),
        this.ctlRange('Screen shake', L.shake, 0, 2, 0.05, (v) => set('shake', v, false)),
        this.ctlRange('Particles', L.particles, 0, 1.5, 0.05, (v) => set('particles', v, false)),
        this.ctlToggle('Trails', L.trails, (v) => set('trails', v, false)));
    }
    panel_sound(p) {
      const S = this.state.sound;
      const set = (k, v, restart) => { S[k] = v; this.save(); this.applyEngineOpts(); if (restart) this.softRestart(); else if (this.game) this.game.soundCfg[k] = v; };
      const A = SB.audio;
      const themes = el('div', { class: 'presets' }, Object.entries(A.INSTRUMENTS).map(([k, I]) => el('button', { class: 'chip' + (S.theme === k ? ' on' : ''), onclick: () => { set('theme', k, false); this.preview(k); this.renderPanels(); } }, I.name)));
      this.section(p, 'Instrument', themes);
      this.section(p, 'Notes',
        this.ctlSelect('Note pattern', S.pattern, Object.entries(A.PATTERNS), (v) => { set('pattern', v, true); this.renderPanels(); }),
        S.pattern === 'melody' ? this.ctlSelect('Melody', S.melody, Object.entries(A.MELODIES).map(([k, m]) => [k, m.name]), (v) => set('melody', v, true)) : null,
        S.pattern !== 'melody' ? this.ctlSelect('Key', S.key, A.KEYS.map((k, i) => [i, k]), (v) => set('key', +v, true)) : null,
        S.pattern !== 'melody' ? this.ctlSelect('Scale', S.scale, Object.entries(A.SCALES).map(([k, s]) => [k, s.name]), (v) => set('scale', v, true)) : null,
        this.ctlSelect('Octave', S.octave, [[-1, 'Low'], [0, 'Middle'], [1, 'High']], (v) => set('octave', +v, true)));
      this.section(p, 'Mix',
        this.ctlRange('Master volume', S.volume, 0, 1.2, 0.01, (v) => set('volume', v)),
        this.ctlRange('Notes', S.music, 0, 1.5, 0.01, (v) => set('music', v)),
        this.ctlRange('Effects (SFX)', S.sfx, 0, 1.5, 0.01, (v) => set('sfx', v)),
        this.ctlRange('Reverb', S.reverb, 0, 0.8, 0.01, (v) => set('reverb', v)),
        el('p', { class: 'note' }, 'All instruments and effects are synthesised in the app — nothing to license.'));
    }
    preview(theme) {
      if (!this.engine.ready) return;
      const I = SB.audio.INSTRUMENTS[theme], k = this.state.sound.key | 0;
      [60, 64, 67, 72].forEach((m, i) => this.engine.playLive({ buf: this.engine.bank.note(theme, m + k), gain: 0.7 * I.gain, pan: 0, rate: 1 }, i * 0.11));
    }
    panel_text(p) {
      const T = this.state.text, id = this.state.modeId;
      const set = (k, v) => { T[k] = v; this.save(); if (this.game) { this.game.textCfg[k] = v; this.game.hookCache = null; } };
      const hook = el('input', { type: 'text', value: T.hooks[id] ?? this.def.hook, oninput: (e) => { T.hooks[id] = e.target.value; this.save(); if (this.game) { this.game.textCfg.hooks[id] = e.target.value; this.game.hookCache = null; } } });
      this.section(p, 'Hook (top of video)',
        this.ctlToggle('Show hook text', T.showHook, (v) => set('showHook', v)),
        el('div', { class: 'ctl' }, el('label', {}, el('span', {}, 'Text — wrap a word in *stars* to highlight it')), hook),
        el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { delete T.hooks[id]; this.save(); this.renderPanels(); if (this.game) { delete this.game.textCfg.hooks[id]; this.game.hookCache = null; } } }, 'Use default hook')),
        el('div', { class: 'presets' }, this.hookIdeas().map((h) => el('button', { class: 'chip', onclick: () => { T.hooks[id] = h; this.save(); this.renderPanels(); if (this.game) { this.game.textCfg.hooks[id] = h; this.game.hookCache = null; } } }, h.replace(/\*/g, '')))),
        this.ctlSelect('Show', T.hookMode, [['always', 'Whole video'], ['intro', 'First 4 seconds']], (v) => set('hookMode', v)),
        this.ctlRange('Size', T.hookSize, 44, 100, 1, (v) => set('hookSize', v)));
      const end = el('input', { type: 'text', value: T.endText, oninput: (e) => set('endText', e.target.value) });
      this.section(p, 'End card (after the payoff)',
        this.ctlToggle('Show end text', T.showEnd, (v) => set('showEnd', v)),
        el('div', { class: 'ctl' }, el('label', {}, el('span', {}, 'Text')), end));
    }
    hookIdeas() {
      const common = ['Wait for the *ending*', 'Pick one *before* it ends', 'This is so *satisfying*', 'Comment your *guess*'];
      const per = {
        rings: ['Can the ball *escape?*', 'How long to escape *40 rings?*', 'Only one gap per ring…'],
        spiral: ['Every hit makes it *faster*', 'Can it break the *whole spiral?*'],
        battle: ['Who wins? *Pick a side!*', 'Which ability is *best?*'],
        growth: ['Every bounce it gets *BIGGER*', 'Will it *fill* the circle?'],
        multiply: ['Every bounce = *+1 ball*', 'Can it reach *500 balls?*'],
        race: ['Last place is *OUT*', 'Pick your *racer!*'],
        course: ['Who *survives* the course?', 'Pick a ball — can it *survive?*'],
        strings: ['Every bounce adds a *string*', 'Watch it *weave*'],
        colorwar: ['Which colour *takes over?*', 'Pick a colour *now!*'],
      };
      return (per[this.state.modeId] || []).concat(common);
    }
    panel_run(p) {
      const R = this.state.run;
      const set = (k, v, restart) => { R[k] = v; this.save(); if (restart) this.softRestart(); };
      this.section(p, 'Pacing',
        this.ctlRange('Target video length', R.targetLen, 15, 60, 1, (v) => set('targetLen', v, true), (v) => v + 's'),
        el('p', { class: 'note' }, 'Every mode steers its difficulty so the payoff lands close to this length (15–60s). Turn "Pace assist" off in a mode for pure physics.'));
      this.section(p, 'Runs',
        this.ctlToggle('Auto-restart when a run ends', R.autoRestart, (v) => set('autoRestart', v)),
        this.ctlToggle('Randomise settings each new run', R.autoRandom, (v) => set('autoRandom', v)),
        this.ctlToggle('Randomise also changes palette & sound', R.randomLook, (v) => set('randomLook', v)),
        el('div', { class: 'ctl' }, el('label', {}, el('span', {}, 'Seed (same seed + settings = same run)')),
          el('div', { class: 'row' }, el('input', { type: 'number', value: R.seed, onchange: (e) => { R.seed = (+e.target.value) >>> 0; this.restart(false); } }), el('button', { class: 'btn', onclick: () => { this.restart(true); this.renderPanels(); } }, 'New'))));
      this.section(p, 'Keyboard',
        el('div', { class: 'keys' }, [['Space', 'Pause'], ['R', 'Restart run'], ['N', 'New run'], ['G', 'Randomise'], ['L', 'Record live'], ['E', 'Export MP4'], ['H', 'Recording mode'], ['F', 'Fullscreen'], ['1–9', 'Switch mode']].map(([k, d]) => el('div', {}, el('kbd', {}, k), d))));
    }

    // ------------------------------------------------------------ recording mode, overlay
    toggleRecMode(force) {
      const on = force ?? !document.body.classList.contains('recmode');
      document.body.classList.toggle('recmode', on);
      this.fit();
      if (on) {
        this.$hint.classList.add('show'); clearTimeout(this._ht); this._ht = setTimeout(() => this.$hint.classList.remove('show'), 1600);
        this.safeWas = this.safe; this.safe = false; this.drawOverlay();
        setTimeout(() => this.restart(false), 50);
      } else { this.safe = this.safeWas; this.drawOverlay(); }
    }
    drawOverlay() {
      const g = this.overlay.getContext('2d');
      g.clearRect(0, 0, 1080, 1920);
      if (!this.safe) return;
      g.fillStyle = 'rgba(255,40,80,0.18)'; g.strokeStyle = 'rgba(255,80,110,0.7)'; g.lineWidth = 3; g.setLineDash([12, 10]);
      const zones = [[0, 0, 1080, 150, 'TikTok top bar'], [0, 1540, 1080, 380, 'Caption & sound'], [940, 720, 140, 820, 'Buttons']];
      g.font = '600 28px "Space Grotesk", sans-serif';
      for (const [x, y, w, h, l] of zones) { g.fillRect(x, y, w, h); g.strokeRect(x + 2, y + 2, w - 4, h - 4); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(l, x + 16, y + 40); g.fillStyle = 'rgba(255,40,80,0.18)'; }
    }
    bindKeys() {
      window.addEventListener('keydown', (e) => {
        if (e.target.matches('input, select, textarea')) return;
        const k = e.key.toLowerCase();
        if (k === ' ') { this.paused = !this.paused; e.preventDefault(); }
        else if (k === 'r') this.restart(false);
        else if (k === 'n') this.restart(true);
        else if (k === 'g') this.randomize();
        else if (k === 'h') this.toggleRecMode();
        else if (k === 'escape') { if (document.body.classList.contains('recmode')) this.toggleRecMode(false); }
        else if (k === 'e') this.openExport();
        else if (k === 'l') (this.rec ? this.stopLive() : this.startLive());
        else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); setTimeout(() => this.fit(), 200); }
        else if (/^[1-9]$/.test(k)) { const m = SB.modes.list[+k - 1]; if (m) this.selectMode(m.id); }
      });
      document.addEventListener('fullscreenchange', () => setTimeout(() => this.fit(), 100));
    }

    // ------------------------------------------------------------ live record
    startLive() {
      if (this.exporting) return;
      this.engine.ensure();
      try {
        this.restart(false);
        this.rec = new SB.recorder.LiveRecorder(this.canvas, this.engine);
        this.rec.start();
        this.$rec.classList.add('on'); this.$rec.firstChild.textContent = '■ Stop recording';
        this.toast('Recording… it stops by itself after the payoff.');
      } catch (e) { this.rec = null; this.toast('Live recording failed: ' + e.message); }
    }
    async stopLive() {
      const r = this.rec; if (!r) return;
      this.rec = null;
      this.$rec.classList.remove('on'); this.$rec.firstChild.textContent = '● Record live';
      const { blob, ext } = await r.stop();
      SB.recorder.download(blob, this.fileName(ext));
      this.toast(`Saved ${this.fileName(ext)} (${(blob.size / 1e6).toFixed(1)} MB)`);
    }
    fileName(ext) { return `satisball_${this.state.modeId}_${this.state.run.seed}.${ext}`; }

    // ------------------------------------------------------------ export
    updateCaps() {
      const c = this.caps;
      if (!c || !c.video) { this.$export.title = 'Frame-perfect export needs Chrome or Edge (WebCodecs). Use Record live instead.'; this.$export.classList.add('disabled'); }
      else if (c.container === 'webm') this.$export.firstChild.textContent = '⤓ Export WebM';
    }
    openExport() {
      if (this.exporting) return;
      const m = this.$modal; m.innerHTML = ''; m.classList.remove('hidden');
      const c = this.caps || {};
      const bar = el('div', { class: 'bar' }, el('i'));
      const label = el('p', { class: 'muted' }, c.video ? `Video: ${c.video.startsWith('avc') ? 'H.264' : c.video} · Audio: ${c.audio ? (c.audio.startsWith('mp4a') ? 'AAC' : c.audio) : 'none'} · 1080×1920 · 60 fps` : 'This browser cannot export frame-perfect video. Use Chrome or Edge, or Record live.');
      const go = el('button', { class: 'btn primary big', disabled: !c.video }, `Render ${c.container === 'webm' ? 'WebM' : 'MP4'}`);
      const cancel = el('button', { class: 'btn' }, 'Close');
      const card = el('div', { class: 'modal-card' },
        el('h2', {}, 'Export video'),
        el('p', {}, 'Re-renders the current run from the start (same seed, same settings) frame by frame. The file is perfectly smooth 60 fps with the full soundtrack, even on a slow PC. It downloads automatically when done.'),
        label, bar, el('p', { class: 'status' }, ''), el('div', { class: 'row' }, go, cancel));
      m.append(card);
      const status = card.querySelector('.status');
      let cancelled = false;
      cancel.onclick = () => { cancelled = true; if (!this.exporting) m.classList.add('hidden'); };
      go.onclick = async () => {
        go.disabled = true; this.exporting = true; cancel.textContent = 'Cancel';
        const cfg = this.gameCfg(null); delete cfg.canvas;
        try {
          this.engine.ensure();
          const res = await SB.recorder.exportRun(cfg, {
            maxSecs: Math.max(70, this.state.run.targetLen * 2 + 6),
            onProgress: (k, txt) => { bar.firstChild.style.width = (k * 100).toFixed(1) + '%'; status.textContent = txt; },
            isCancelled: () => cancelled,
          });
          const name = this.fileName(res.ext);
          SB.recorder.download(res.blob, name);
          status.textContent = `Saved ${name} · ${res.duration.toFixed(1)}s · ${(res.blob.size / 1e6).toFixed(1)} MB`;
          cancel.textContent = 'Close';
        } catch (e) {
          status.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Export failed: ' + e.message;
          console.error(e);
        }
        this.exporting = false; go.disabled = false; cancel.textContent = 'Close';
      };
    }
    toast(msg) {
      const t = el('div', { class: 'toast' }, msg);
      document.body.append(t);
      setTimeout(() => t.classList.add('show'), 10);
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
    }
  }
  SB.UI = UI;
})(window.SB);
