/* SatisBall — studio UI: mode browser (search + categories), settings panels, cast & palette editors,
 * text/hook styling, preset library & share codes, run history with exact replay, export & batch export,
 * live record and recording mode. */
'use strict';
(function (SB) {
  const { RNG, clamp } = SB.util;
  const STEP = SB.GAME.STEP;
  const STORE = 'satisball.v2', OLD_STORE = 'satisball.v1';
  const CATS = ['Satisfying', 'Escape', 'Battles', 'Survival', 'Territory', 'Viewer pick'];

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'value') e.value = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const DEFAULT_STATE = () => ({
    v: 2,
    modeId: 'lastin',
    settings: {},
    look: {
      palette: 'neon', bg: 'glow', ballStyle: 'glossy', glow: 0.9, bloom: 0.55, trails: true, shake: 1, particles: 1, tensionFx: true, zoomFx: true,
      custom: { bg0: '#0a0620', bg1: '#1d0b40', accent: '#ff3d8b', glow: '', balls: ['#ff2d75', '#22e5ff', '#ffd23f', '#7dff9a', '#b36bff', '#ff8a3d', '#ffffff', '#3d7bff'] },
      cast: { names: [], colors: [] },
    },
    sound: { theme: 'piano', pattern: 'chords', key: 0, scale: 'majPent', melody: 'ode', octave: 0, backing: 'build', bpm: 0, bedVol: 0.8, volume: 0.85, reverb: 0.28, sfx: 1, music: 1 },
    text: {
      showHook: true, hookMode: 'always', hooks: {}, hookSize: 74, font: 'Unbounded', hookStyle: 'shadow', hookAnim: 'pop', hookOffset: 0, hookColor: '', hlColor: '', subText: '',
      intro: false, introLen: 1.5, showEnd: true, endText: 'Did you *call it?*', outroLen: 3.4, fadeOut: false,
    },
    run: { targetLen: 35, autoRestart: true, autoRandom: false, randomLook: true, seed: 1 },
    export: { res: 1080, fps: 60, quality: 'high', limit: 0 },
    batch: { count: 5, which: 'current', list: [], randomSettings: true, randomLook: true, minLen: 15, maxLen: 60, useFolder: true },
    tab: 'mode',
  });

  class UI {
    constructor(root) {
      this.root = root;
      this.state = this.load();
      this.engine = SB.engine;
      this.paused = false; this.acc = 0; this.last = 0; this.fps = 60; this.frameMs = 0; this.dts = [];
      this.rec = null; this.exporting = false; this.filter = '';
      this.build();
      this.applyEngineOpts();
      this.newGame();
      this.bindKeys();
      requestAnimationFrame((t) => this.loop(t));
      this.refreshCaps();
      this.importFromHash();
    }

    // ------------------------------------------------------------ persistence
    load() {
      const d = DEFAULT_STATE();
      try {
        const s = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem(OLD_STORE) || 'null');
        if (s) {
          for (const k of Object.keys(d)) if (s[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) d[k] = Object.assign(d[k], s[k]);
          if (s.modeId && SB.modes.byId[s.modeId]) d.modeId = s.modeId;
          if (s.tab) d.tab = s.tab;
          d.look.custom = Object.assign(DEFAULT_STATE().look.custom, d.look.custom || {});
          d.look.cast = Object.assign({ names: [], colors: [] }, d.look.cast || {});
        }
      } catch (e) { /* storage unavailable */ }
      d.run.seed = (Math.random() * 1e9) >>> 0;
      return d;
    }
    save() { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch (e) { /* ignore */ } }
    get def() { return SB.modes.byId[this.state.modeId]; }
    modeSettings(id = this.state.modeId) {
      if (!this.state.settings[id]) this.state.settings[id] = {};
      return Object.assign({}, SB.modes.byId[id].defaults, this.state.settings[id]);
    }
    /** Everything that determines a run. */
    snapshot() {
      const st = this.state;
      return { v: 2, modeId: st.modeId, seed: st.run.seed, settings: this.modeSettings(), look: clone(st.look), sound: clone(st.sound), text: clone(st.text), targetLen: st.run.targetLen };
    }
    cfgFrom(snap, canvas, audioMode = 'live') {
      return {
        canvas, modeId: snap.modeId, seed: snap.seed >>> 0, settings: Object.assign({}, SB.modes.byId[snap.modeId].defaults, snap.settings),
        look: clone(snap.look), sound: clone(snap.sound), text: clone(snap.text),
        run: { targetLen: snap.targetLen || 35 }, engine: this.engine, audioMode,
      };
    }
    gameCfg(canvas) { return this.cfgFrom(this.snapshot(), canvas); }
    applyEngineOpts() {
      const s = this.state.sound;
      this.engine.setOpts({ volume: s.volume, reverb: s.reverb, sfx: s.sfx, music: s.music, bed: s.bedVol });
      this.engine.bank.warm(s.theme, [], 36, 96);
    }

    // ------------------------------------------------------------ game lifecycle
    newGame() {
      this.game = new SB.Game(this.gameCfg(this.canvas));
      this.game.onDone = () => this.onRunDone();
      this.acc = 0;
      this.$seed.textContent = '#' + this.state.run.seed;
      this.$modeTitle.textContent = this.def.icon + ' ' + this.def.name;
    }
    restart(newSeed) {
      if (newSeed) this.state.run.seed = (Math.random() * 1e9) >>> 0;
      this.save(); this.newGame();
      if (this.tab === 'library' || this.tab === 'mode') this.refreshSeedField();
    }
    refreshSeedField() { const f = this.root.querySelector('#seed-field'); if (f) f.value = this.state.run.seed; }
    onRunDone() {
      const g = this.game;
      SB.library.history.push({ snap: this.snapshot(), at: Date.now(), secs: +g.time.toFixed(1), title: g.winInfo ? g.winInfo.title : '' });
      if (this.tab === 'library') this.renderPanels();
      if (this.rec) { this.stopLive(); return; }
      if (this.exporting) return;
      if (this.state.run.autoRestart) {
        clearTimeout(this._ar);
        this._ar = setTimeout(() => { if (this.state.run.autoRandom) this.randomize(); else this.restart(true); }, 400);
      }
    }
    softRestart() { clearTimeout(this._rt); this._rt = setTimeout(() => this.restart(false), 180); }
    randomLook(rng, into) {
      const L = into.look, S = into.sound;
      L.palette = rng.pick(SB.palettes.list.filter((p) => !p.light || rng.chance(0.3))).id;
      L.bg = rng.pick(SB.backgrounds.list.map((b) => b[0]).filter((b) => b !== 'plain'));
      L.ballStyle = rng.pick(['glossy', 'glossy', 'neon', 'gem', 'bubble', 'flat']);
      S.theme = rng.pick(SB.audio.THEMES.map((t) => t[0]));
      S.pattern = rng.pick(['chords', 'climb', 'pingpong', 'melody', 'tension', 'random']);
      S.melody = rng.pick(Object.keys(SB.audio.MELODIES));
      S.scale = rng.pick(['majPent', 'minPent', 'major', 'dorian', 'lydian']);
      S.key = rng.int(0, 11);
      S.backing = rng.pick(['build', 'build', 'full', 'pad']);
    }
    randomize(alsoLook = this.state.run.randomLook) {
      const rng = new RNG((Math.random() * 1e9) >>> 0);
      const def = this.def;
      this.state.settings[def.id] = SB.modes.randomize(def, rng, this.modeSettings());
      if (alsoLook) { this.randomLook(rng, this.state); this.applyEngineOpts(); }
      this.restart(true);
      this.renderPanels();
    }
    loop(t) {
      requestAnimationFrame((tt) => this.loop(tt));
      const dt = Math.min(0.25, (t - (this.last || t)) / 1000);
      this.last = t;
      if (this.exporting || !this.game) return;
      const g = this.game;
      // Frame pacing: lock the step count to the display refresh when it divides 240 Hz (60 Hz -> 4 steps,
      // 120 Hz -> 2, 30 Hz -> 8...) so motion never judders from 3/5-step frames; otherwise accumulate.
      if (dt > 0) { this.dts.push(dt); if (this.dts.length > 40) this.dts.shift(); }
      const med = this.dts.length > 8 ? this.dts.slice().sort((a, b) => a - b)[this.dts.length >> 1] : 1 / 60;
      const spf = med / STEP, k = Math.round(spf);
      if (!this.paused) {
        let n;
        if (k >= 1 && Math.abs(spf - k) < 0.1) { n = k * clamp(Math.round(dt / med), 1, 4); this.acc = 0; }
        else { this.acc += dt; n = Math.floor(this.acc / STEP); this.acc -= n * STEP; }
        n = Math.min(n, 32);
        g.snd.frameStart = g.clock;
        const a = performance.now();
        for (let i = 0; i < n; i++) g.step();
        g.render();
        this.frameMs = this.frameMs * 0.9 + (performance.now() - a) * 0.1;
      }
      if (dt > 0) this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
      if (!this.paused && this.fps < 48 && g.time > 4) { this.slowT = (this.slowT || 0) + dt; if (this.slowT > 4 && !this.slowHinted) { this.slowHinted = true; this.toast('Preview below 60 fps — lower Bloom/Particles in Look. Exports are always frame-perfect.'); } } else this.slowT = 0;
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
      this.$export = btn('⤓ Export', 'E', () => this.openExport(), 'primary');
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
      this.$search = el('input', { type: 'text', class: 'search', placeholder: `Search ${SB.modes.list.length} modes…`, oninput: (e) => { this.filter = e.target.value.toLowerCase(); this.renderModes(); } });
      this.$modes = el('nav', { class: 'modes' });
      this.$panel = el('div', { class: 'panel-body' });
      this.$tabs = el('div', { class: 'tabs' });
      this.stageWrap = el('div', { class: 'stage-wrap' }, el('div', { class: 'stage' }, this.canvas, this.overlay));
      const stageBar = el('div', { class: 'stage-bar' },
        el('button', { class: 'chip', onclick: () => { this.paused = !this.paused; } }, '⏯ Pause'),
        el('label', { class: 'chip' }, el('input', { type: 'checkbox', onchange: (e) => { this.safe = e.target.checked; this.drawOverlay(); } }), ' Safe zones'),
        el('button', { class: 'chip', onclick: () => this.copyShare() }, '🔗 Copy share code'),
        this.$perf);
      const main = el('main', {}, this.stageWrap, stageBar);
      this.$splash = el('div', { class: 'splash' },
        el('div', { class: 'splash-card' },
          el('div', { class: 'logo big' }, el('i'), el('i'), el('i')),
          el('h1', {}, 'SATISBALL'),
          el('p', {}, `${SB.modes.list.length} satisfying simulation modes, ready to post.`),
          el('button', { class: 'btn primary big' }, 'Click to start (sound on)')));
      this.$splash.addEventListener('click', () => { this.engine.ensure(); this.engine.bank.warmFx(); this.applyEngineOpts(); this.$splash.remove(); this.restart(false); });
      this.$hint = el('div', { class: 'rec-hint' }, 'Recording mode — press H or Esc to exit');
      this.$modal = el('div', { class: 'modal hidden' });
      r.append(top, el('div', { class: 'body' }, el('aside', { class: 'left' }, this.$search, this.$modes), main, el('aside', { class: 'right' }, this.$tabs, this.$panel)), this.$splash, this.$hint, this.$modal);
      this.tab = this.state.tab || 'mode';
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
    orderedModes() {
      const list = SB.modes.list.slice();
      return list.sort((a, b) => (CATS.indexOf(a.category) + 99) % 99 - (CATS.indexOf(b.category) + 99) % 99 || list.indexOf(a) - list.indexOf(b));
    }
    renderModes() {
      this.$modes.innerHTML = '';
      const f = this.filter;
      const all = this.orderedModes();
      let lastCat = null;
      all.forEach((m, i) => {
        const hay = (m.name + ' ' + m.tagline + ' ' + m.category + ' ' + m.id).toLowerCase();
        if (f && !hay.includes(f)) return;
        if (m.category !== lastCat) { lastCat = m.category; this.$modes.append(el('h3', {}, m.category)); }
        const card = el('button', { class: 'mode-card' + (m.id === this.state.modeId ? ' on' : ''), onclick: () => this.selectMode(m.id) },
          el('span', { class: 'mi' }, m.icon), el('span', { class: 'mt' }, el('b', {}, m.name, m.longForm ? el('em', { class: 'tagpill' }, 'long') : null), el('small', {}, m.tagline)), i < 9 ? el('kbd', {}, String(i + 1)) : null);
        this.$modes.append(card);
      });
      if (!this.$modes.children.length) this.$modes.append(el('p', { class: 'note' }, 'No modes match.'));
    }
    selectMode(id) {
      if (!SB.modes.byId[id]) return;
      this.state.modeId = id;
      this.renderModes(); this.renderPanels();
      this.restart(true);
    }
    stepMode(d) {
      const list = this.orderedModes(), i = list.findIndex((m) => m.id === this.state.modeId);
      this.selectMode(list[(i + d + list.length) % list.length].id);
    }
    renderPanels() {
      const tabs = [['mode', 'Mode'], ['look', 'Look'], ['sound', 'Sound'], ['text', 'Text'], ['library', 'Library'], ['export', 'Export']];
      this.$tabs.innerHTML = '';
      for (const [k, l] of tabs) this.$tabs.append(el('button', { class: 'tab' + (this.tab === k ? ' on' : ''), onclick: () => { this.tab = k; this.state.tab = k; this.save(); this.renderPanels(); } }, l));
      const p = this.$panel, scroll = p.scrollTop, same = this._lastTab === this.tab;
      p.innerHTML = '';
      (this['panel_' + this.tab] || this.panel_mode).call(this, p);
      if (same) p.scrollTop = scroll;
      this._lastTab = this.tab;
    }

    // --- generic controls
    ctlRange(label, val, min, max, step, onchange, fmt) {
      const out = el('output', {}, fmt ? fmt(val) : String(val));
      const inp = el('input', { type: 'range', min, max, step, value: val });
      inp.addEventListener('input', () => { const v = +inp.value; out.textContent = fmt ? fmt(v) : String(v); onchange(v); });
      return el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label), out), inp);
    }
    ctlSelect(label, val, options, onchange) {
      const s = el('select', { onchange: (e) => { const o = options.find(([v]) => String(v) === e.target.value); onchange(o ? o[0] : e.target.value); } }, options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(val) }, l)));
      return el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label)), s);
    }
    ctlToggle(label, val, onchange) {
      const i = el('input', { type: 'checkbox', checked: !!val, onchange: (e) => onchange(e.target.checked) });
      return el('label', { class: 'ctl toggle' }, i, el('i'), el('span', {}, label));
    }
    ctlText(label, val, onchange, o = {}) {
      const i = el('input', { type: 'text', value: val ?? '', placeholder: o.placeholder || '', maxlength: o.max || 200, oninput: (e) => onchange(e.target.value) });
      return el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label)), i);
    }
    ctlColor(label, val, onchange, o = {}) {
      const pal = SB.palettes.resolve(this.state.look);
      const row = el('div', { class: 'swatches' });
      const mk = (c, title) => el('button', { class: 'sw' + ((val || '') === c ? ' on' : ''), title, style: c ? `background:${c}` : '', onclick: () => { onchange(c); this.renderPanels(); } }, c ? '' : 'auto');
      if (o.auto !== false) row.append(mk('', 'Auto'));
      pal.balls.slice(0, 8).forEach((b) => row.append(mk(b.c, b.n)));
      row.append(el('input', { type: 'color', value: val || '#ffffff', oninput: (e) => onchange(e.target.value) }));
      return el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label)), row);
    }
    section(p, title, ...kids) { const s = el('div', { class: 'sec' }, el('h4', {}, title), ...kids); p.append(s); return s; }

    // ------------------------------------------------------------ Mode tab
    panel_mode(p) {
      const def = this.def, cur = this.modeSettings();
      const hasShow = def.settings.some((s) => s.show);
      const set = (k, v) => { this.state.settings[def.id][k] = v; this.save(); this.softRestart(); if (hasShow) this.renderPanels(); };
      const mine = SB.library.user.list().filter((u) => u.snap.modeId === def.id);
      this.section(p, def.icon + ' ' + def.name,
        el('p', { class: 'note', style: 'margin:0 0 10px' }, def.tagline + (def.longForm ? ' · long-form (runs up to ~3 min)' : '')),
        el('div', { class: 'presets' }, def.presets.map((pr) => el('button', { class: 'chip', onclick: () => this.applyPreset(pr) }, pr.name)),
          mine.map((u) => el('button', { class: 'chip mine', title: 'Your preset', onclick: () => this.applySnapshot(u.snap, true) }, '★ ' + u.name))),
        el('div', { class: 'row' },
          el('button', { class: 'btn accent', onclick: () => this.randomize() }, '🎲 Randomise'),
          el('button', { class: 'btn', onclick: () => { this.state.settings[def.id] = {}; this.save(); this.renderPanels(); this.restart(false); } }, 'Reset to defaults')));
      const ctls = def.settings.filter((s) => !s.show || s.show(cur)).map((s) => {
        const v = cur[s.key];
        if (s.type === 'range') return this.ctlRange(s.label, v, s.min, s.max, s.step, (x) => set(s.key, x));
        if (s.type === 'select') return this.ctlSelect(s.label, v, s.options, (x) => set(s.key, x));
        if (s.type === 'toggle') return this.ctlToggle(s.label, v, (x) => set(s.key, x));
        if (s.type === 'color') return this.ctlColor(s.label, v, (x) => set(s.key, x));
        if (s.type === 'text') return this.ctlText(s.label, v, (x) => set(s.key, x), { max: 24 });
        return null;
      });
      this.section(p, 'Settings', ...ctls);
      const R = this.state.run;
      const setR = (k, v, restart) => { R[k] = v; this.save(); if (restart) this.softRestart(); };
      this.section(p, 'Pacing & runs',
        this.ctlRange('Target video length', R.targetLen, 15, 60, 1, (v) => setR('targetLen', v, true), (v) => v + 's' + (def.longForm ? ' (x2.4 long-form)' : '')),
        el('p', { class: 'note' }, 'Every mode steers itself so the payoff lands near this length. Turn "Pace assist" off in the settings above for pure physics.'),
        this.ctlToggle('Auto-restart when a run ends', R.autoRestart, (v) => setR('autoRestart', v)),
        this.ctlToggle('Randomise settings each new run', R.autoRandom, (v) => setR('autoRandom', v)),
        this.ctlToggle('Randomise also changes palette & sound', R.randomLook, (v) => setR('randomLook', v)),
        el('div', { class: 'ctl' }, el('label', {}, el('span', {}, 'Seed — same seed + settings = the same video')),
          el('div', { class: 'row' }, el('input', { type: 'number', id: 'seed-field', value: R.seed, onchange: (e) => { R.seed = (+e.target.value) >>> 0; this.restart(false); } }), el('button', { class: 'btn', onclick: () => this.restart(true) }, 'New seed'))));
      this.section(p, 'Keyboard',
        el('div', { class: 'keys' }, [['Space', 'Pause'], ['R', 'Restart run'], ['N', 'New run'], ['G', 'Randomise'], ['L', 'Record live'], ['E', 'Export'], ['H', 'Recording mode'], ['F', 'Fullscreen'], ['1–9', 'Pick mode'], ['[ ]', 'Prev / next mode']].map(([k, d]) => el('div', {}, el('kbd', {}, k), d))));
    }
    applyPreset(pr) {
      const def = this.def;
      this.state.settings[def.id] = Object.assign({}, pr.s);
      if (pr.look) Object.assign(this.state.look, pr.look);
      if (pr.sound) { Object.assign(this.state.sound, pr.sound); this.applyEngineOpts(); }
      if (pr.text) { const t = clone(pr.text); if (t.hooks) { Object.assign(this.state.text.hooks, t.hooks); delete t.hooks; } Object.assign(this.state.text, t); }
      this.save(); this.renderPanels(); this.restart(true);
    }
    /** Load a full run snapshot (keepSeed: exact replay). */
    applySnapshot(snap, keepSeed) {
      const d = DEFAULT_STATE(), st = this.state;
      if (!SB.modes.byId[snap.modeId]) { this.toast('Unknown mode in that preset.'); return; }
      st.modeId = snap.modeId;
      st.settings[snap.modeId] = Object.assign({}, snap.settings || {});
      st.look = Object.assign(d.look, clone(snap.look || {}));
      st.look.custom = Object.assign(DEFAULT_STATE().look.custom, st.look.custom || {});
      st.look.cast = Object.assign({ names: [], colors: [] }, st.look.cast || {});
      st.sound = Object.assign(d.sound, clone(snap.sound || {}));
      st.text = Object.assign(d.text, clone(snap.text || {}));
      if (snap.targetLen) st.run.targetLen = snap.targetLen;
      if (keepSeed && snap.seed !== undefined) st.run.seed = snap.seed >>> 0; else st.run.seed = (Math.random() * 1e9) >>> 0;
      this.applyEngineOpts(); this.save(); this.renderModes(); this.renderPanels(); this.newGame();
    }
    applyFeatured(f) {
      const snap = { modeId: f.modeId, settings: f.settings, look: Object.assign({}, this.state.look, { palette: 'neon', bg: 'glow', cast: { names: [], colors: [] } }, f.look || {}), sound: Object.assign({}, this.state.sound, f.sound || {}), text: Object.assign({}, this.state.text, { hooks: Object.assign({}, this.state.text.hooks) }), targetLen: this.state.run.targetLen };
      if (f.text && f.text.hooks) Object.assign(snap.text.hooks, f.text.hooks); else if (snap.text.hooks) delete snap.text.hooks[f.modeId];
      this.applySnapshot(snap, false);
      this.toast(`Loaded "${f.name}"`);
    }

    // ------------------------------------------------------------ Look tab
    panel_look(p) {
      const L = this.state.look;
      const set = (k, v, restart = true) => { L[k] = v; this.save(); if (restart) this.softRestart(); else if (this.game) this.game.look[k] = v; };
      const pals = el('div', { class: 'palettes' }, SB.palettes.list.map((pl) => el('button', {
        class: 'pal' + (pl.id === L.palette ? ' on' : ''), onclick: () => { L.palette = pl.id; this.save(); this.renderPanels(); this.restart(false); },
        style: `background:linear-gradient(160deg, ${pl.bg[0]}, ${pl.bg[1]})`,
      }, el('span', { class: 'dots' }, pl.balls.slice(0, 5).map((b) => el('i', { style: `background:${b.c}` }))), el('b', { style: `color:${pl.light ? pl.text : '#fff'}` }, pl.name))),
      el('button', { class: 'pal custom' + (L.palette === 'custom' ? ' on' : ''), onclick: () => { L.palette = 'custom'; this.save(); this.renderPanels(); this.restart(false); }, style: `background:linear-gradient(160deg, ${L.custom.bg0}, ${L.custom.bg1})` },
        el('span', { class: 'dots' }, L.custom.balls.slice(0, 5).map((c) => el('i', { style: `background:${c}` }))), el('b', {}, '✎ Custom')));
      this.section(p, 'Palette', pals);
      if (L.palette === 'custom') {
        const C = L.custom;
        const setC = (k, v) => { C[k] = v; this.save(); this.softRestart(); };
        const colorIn = (label, key) => el('label', { class: 'cin' }, el('input', { type: 'color', value: C[key] || '#ffffff', oninput: (e) => setC(key, e.target.value) }), label);
        this.section(p, 'Custom palette',
          el('div', { class: 'cgrid' }, colorIn('Background top', 'bg0'), colorIn('Background bottom', 'bg1'), colorIn('Accent / highlight', 'accent'), colorIn('Glow', 'glow')),
          el('div', { class: 'ctl' }, el('label', {}, el('span', {}, 'Ball colours (in order)')),
            el('div', { class: 'swatches' }, C.balls.map((c, i) => el('input', { type: 'color', value: c, oninput: (e) => { C.balls[i] = e.target.value; this.save(); this.softRestart(); } })))),
          el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { const cur = SB.palettes.get(this.lastPreset || 'neon'); Object.assign(C, { bg0: cur.bg[0], bg1: cur.bg[1], accent: cur.accent, glow: cur.glow[0], balls: cur.balls.slice(0, 8).map((b) => b.c) }); this.save(); this.renderPanels(); this.restart(false); } }, 'Copy from ' + SB.palettes.get(this.lastPreset || 'neon').name)));
      } else this.lastPreset = L.palette;
      // cast: names & colours per slot
      const cast = L.cast, base = SB.palettes.resolve(Object.assign({}, L, { cast: {} }));
      const rows = el('div', { class: 'cast' });
      for (let i = 0; i < 10; i++) {
        const def = base.balls[i % base.balls.length];
        rows.append(el('div', { class: 'cast-row' },
          el('span', { class: 'cast-i' }, String(i + 1)),
          el('input', { type: 'color', value: cast.colors[i] || def.c, oninput: (e) => { cast.colors[i] = e.target.value; this.save(); this.softRestart(); } }),
          el('input', { type: 'text', maxlength: 12, value: cast.names[i] || '', placeholder: def.n, oninput: (e) => { cast.names[i] = e.target.value; this.save(); this.softRestart(); } })));
      }
      this.section(p, 'Cast — names & colours',
        el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Rename fighters, racers, teams and armies (slot 1 = the first colour a mode uses). Leave blank for the palette default.'),
        rows,
        el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { L.cast = { names: [], colors: [] }; this.save(); this.renderPanels(); this.restart(false); } }, 'Clear cast'),
          el('button', { class: 'btn', onclick: () => { const pool = ['BLAZE', 'FROST', 'VENOM', 'NOVA', 'TITAN', 'PIXEL', 'ROCKET', 'SHADOW', 'COMET', 'BOLT', 'MANGO', 'KIWI', 'BERRY', 'LEMON', 'PLUM', 'GHOST', 'VIPER', 'ZEUS', 'LUNA', 'ECHO']; const r = new RNG((Math.random() * 1e9) >>> 0); L.cast.names = r.shuffle(pool).slice(0, 10); this.save(); this.renderPanels(); this.restart(false); } }, '🎲 Random names')));
      this.section(p, 'Scene',
        this.ctlSelect('Background', L.bg, SB.backgrounds.list, (v) => set('bg', v, false)),
        this.ctlSelect('Ball style', L.ballStyle, [['glossy', 'Glossy'], ['neon', 'Neon ring'], ['gem', 'Gem'], ['bubble', 'Bubble'], ['flat', 'Flat']], (v) => set('ballStyle', v, false)),
        this.ctlToggle('Trails', L.trails, (v) => set('trails', v, false)),
        this.ctlToggle('Camera zoom & slow-mo on key moments', L.zoomFx, (v) => set('zoomFx', v, false)),
        this.ctlToggle('Tension glow at the edges', L.tensionFx, (v) => set('tensionFx', v, false)));
      this.section(p, 'Effects',
        this.ctlRange('Glow', L.glow, 0, 1.5, 0.05, (v) => set('glow', v, false)),
        this.ctlRange('Bloom', L.bloom, 0, 1.2, 0.05, (v) => set('bloom', v, false)),
        this.ctlRange('Screen shake', L.shake, 0, 2, 0.05, (v) => set('shake', v, false)),
        this.ctlRange('Particles', L.particles, 0, 1.5, 0.05, (v) => set('particles', v, false)));
    }

    // ------------------------------------------------------------ Sound tab
    panel_sound(p) {
      const S = this.state.sound;
      const set = (k, v, restart) => { S[k] = v; this.save(); this.applyEngineOpts(); if (restart) this.softRestart(); else if (this.game) this.game.soundCfg[k] = v; };
      const A = SB.audio;
      const themes = el('div', { class: 'presets' }, A.THEMES.map(([k, name]) => el('button', { class: 'chip' + (S.theme === k ? ' on' : ''), onclick: () => { set('theme', k, false); this.preview(k); this.renderPanels(); } }, name)));
      this.section(p, 'Instrument', themes, el('p', { class: 'note' }, 'Click to hear it. Every sound is synthesised in the app — nothing to license.'));
      this.section(p, 'Notes',
        this.ctlSelect('Note pattern', S.pattern, Object.entries(A.PATTERNS), (v) => { set('pattern', v, true); this.renderPanels(); }),
        S.pattern === 'melody' ? this.ctlSelect('Melody', S.melody, Object.entries(A.MELODIES).map(([k, m]) => [k, m.name]), (v) => set('melody', v, true)) : null,
        S.pattern !== 'melody' ? this.ctlSelect('Key', S.key, A.KEYS.map((k, i) => [i, k]), (v) => set('key', +v, true)) : null,
        S.pattern !== 'melody' ? this.ctlSelect('Scale', S.scale, Object.entries(A.SCALES).map(([k, s]) => [k, s.name]), (v) => set('scale', v, true)) : null,
        this.ctlSelect('Octave', S.octave, [[-1, 'Low'], [0, 'Middle'], [1, 'High']], (v) => set('octave', +v, true)));
      this.section(p, 'Backing track',
        this.ctlSelect('Style', S.backing, Object.entries(A.BACKING), (v) => set('backing', v, true)),
        S.backing !== 'off' ? this.ctlRange('Tempo', S.bpm, 0, 180, 1, (v) => set('bpm', v < 60 ? 0 : v, true), (v) => (v < 60 ? 'auto' : v + ' bpm')) : null,
        S.backing !== 'off' ? this.ctlRange('Backing volume', S.bedVol, 0, 1.5, 0.01, (v) => set('bedVol', v)) : null,
        el('p', { class: 'note' }, '"Builds with tension" adds kick, hats, bass and a snare roll as the run gets closer to its payoff, then drops into the win sting.'));
      this.section(p, 'Mix',
        this.ctlRange('Master volume', S.volume, 0, 1.2, 0.01, (v) => set('volume', v)),
        this.ctlRange('Notes', S.music, 0, 1.5, 0.01, (v) => set('music', v)),
        this.ctlRange('Effects (SFX)', S.sfx, 0, 1.5, 0.01, (v) => set('sfx', v)),
        this.ctlRange('Reverb', S.reverb, 0, 0.8, 0.01, (v) => set('reverb', v)));
    }
    preview(theme) {
      if (!this.engine.ready) return;
      const I = SB.audio.INSTRUMENTS[theme], k = this.state.sound.key | 0;
      [60, 64, 67, 72].forEach((m, i) => this.engine.playLive({ buf: this.engine.bank.note(theme, m + k), gain: 0.7 * I.gain, pan: 0, rate: 1 }, i * 0.11));
    }

    // ------------------------------------------------------------ Text tab
    panel_text(p) {
      const T = this.state.text, id = this.state.modeId;
      const live = () => { if (this.game) { Object.assign(this.game.textCfg, clone(T)); this.game.hookCache = null; } };
      const set = (k, v, restart) => { T[k] = v; this.save(); if (restart) this.softRestart(); else live(); };
      const setHook = (v) => { if (v === null) delete T.hooks[id]; else T.hooks[id] = v; this.save(); live(); };
      this.section(p, 'Hook (top of the video)',
        this.ctlToggle('Show hook text', T.showHook, (v) => set('showHook', v)),
        el('div', { class: 'ctl' }, el('label', {}, el('span', {}, 'Text — wrap words in *stars* to highlight them')),
          el('input', { type: 'text', value: T.hooks[id] ?? this.def.hook, oninput: (e) => setHook(e.target.value) })),
        el('div', { class: 'presets' }, this.hookIdeas().map((h) => el('button', { class: 'chip', onclick: () => { setHook(h); this.renderPanels(); } }, h.replace(/\*/g, ''))),
          el('button', { class: 'chip', onclick: () => { setHook(null); this.renderPanels(); } }, '↺ Default')),
        this.ctlText('Sub-line under the hook (optional)', T.subText, (v) => set('subText', v), { placeholder: 'e.g. Part 3 · comment your pick', max: 60 }),
        this.ctlSelect('Show', T.hookMode, [['always', 'Whole video'], ['intro', 'First 4 seconds']], (v) => set('hookMode', v)));
      this.section(p, 'Hook style',
        this.ctlSelect('Font', T.font, SB.FONTS.map((f) => [f, f]), (v) => set('font', v)),
        this.ctlSelect('Style', T.hookStyle, [['shadow', 'Soft shadow'], ['outline', 'Thick outline'], ['box', 'Caption box'], ['neon', 'Neon glow']], (v) => set('hookStyle', v)),
        this.ctlSelect('Animation', T.hookAnim, [['pop', 'Pop in'], ['slide', 'Slide down'], ['type', 'Typewriter'], ['bounce', 'Bounce loop']], (v) => set('hookAnim', v, true)),
        this.ctlRange('Size', T.hookSize, 44, 110, 1, (v) => set('hookSize', v)),
        this.ctlRange('Vertical offset', T.hookOffset, -80, 200, 2, (v) => set('hookOffset', v), (v) => (v > 0 ? '+' : '') + v + 'px'),
        this.ctlColor('Text colour', T.hookColor, (v) => set('hookColor', v)),
        this.ctlColor('Highlight colour', T.hlColor, (v) => set('hlColor', v)));
      this.section(p, 'Intro card',
        this.ctlToggle('Big hook card before the run starts (with the roster)', T.intro, (v) => set('intro', v, true)),
        T.intro ? this.ctlRange('Intro length', T.introLen, 0.6, 4, 0.1, (v) => set('introLen', v, true), (v) => v.toFixed(1) + 's') : null);
      this.section(p, 'Payoff & outro',
        this.ctlToggle('Show end text under the winner', T.showEnd, (v) => set('showEnd', v)),
        el('div', { class: 'ctl' }, el('input', { type: 'text', value: T.endText, oninput: (e) => set('endText', e.target.value) })),
        this.ctlRange('Outro length (after the payoff)', T.outroLen, 1, 8, 0.1, (v) => set('outroLen', v, true), (v) => v.toFixed(1) + 's'),
        this.ctlToggle('Fade to black at the end', T.fadeOut, (v) => set('fadeOut', v, true)));
    }
    hookIdeas() {
      const common = ['Wait for the *ending*', 'Pick one *before* it ends', 'This is so *satisfying*', 'Comment your *guess*', 'I did NOT expect *that*'];
      const per = {
        rings: ['Can the ball *escape?*', 'How long to escape *40 rings?*'], spiral: ['Every hit makes it *faster*', 'Can it break the *whole spiral?*'],
        battle: ['Who wins? *Pick a side!*', 'Which ability is *best?*'], growth: ['Every bounce it gets *BIGGER*', 'Will it *fill* the circle?'],
        multiply: ['Every bounce = *+1 ball*', 'Can it reach *500 balls?*'], race: ['Last place is *OUT*', 'Pick your *racer!*'],
        course: ['Who *survives* the course?', 'Can it outrun *THE WALL?*'], strings: ['Every bounce adds a *string*', 'Watch it *weave*'],
        colorwar: ['Which colour *takes over?*', 'Pick a colour *now!*'], squares: ['Which square *escapes?*', 'Pick your *square!*'],
        lastin: ['Pick a number. Is it the *last one in?*', 'Comment your *number!*'], tournament: ['Who wins the *tournament?*', 'Pick your *champion*'],
        teams: ['Which team *wins?*', '3v3 — pick a *team!*'], boss: ['Can they beat the *boss?*', 'Who lands the *final blow?*'],
        levelup: ['Every orb makes them *stronger*', 'Who reaches *level 6?*'], chain: ['Watch the *chain reaction*', 'How many *TNT* in a row?'],
        maze: ['Can it find the *way out?*', 'Which ball gets *out first?*'], paint: ['Which colour *paints the most?*', 'Pick a colour *now!*'],
        army: ['Which army *wins?*', 'Red or blue? *Pick now!*'],
      };
      return (per[this.state.modeId] || []).concat(common);
    }

    // ------------------------------------------------------------ Library tab
    panel_library(p) {
      const lib = SB.library;
      this.section(p, 'Featured presets',
        el('div', { class: 'featured' }, lib.FEATURED.map((f) => {
          const m = SB.modes.byId[f.modeId]; if (!m) return null;
          return el('button', { class: 'feat', onclick: () => this.applyFeatured(f) }, el('span', { class: 'mi' }, m.icon), el('span', {}, el('b', {}, f.name), el('small', {}, f.desc)));
        })));
      const name = el('input', { type: 'text', placeholder: 'Preset name', maxlength: 40 });
      const mine = lib.user.list();
      const list = el('div', { class: 'plist' }, mine.length ? mine.map((u) => {
        const m = SB.modes.byId[u.snap.modeId];
        return el('div', { class: 'pitem' },
          el('button', { class: 'pload', title: 'Load (same seed = the exact same run)', onclick: () => { this.applySnapshot(u.snap, true); this.toast(`Loaded "${u.name}"`); } }, el('span', {}, m ? m.icon : '?'), el('b', {}, u.name), el('small', {}, m ? m.name : u.snap.modeId)),
          el('button', { class: 'btn mini', title: 'Copy share code', onclick: () => this.copy(lib.encode(u.snap), 'Share code copied') }, '🔗'),
          el('button', { class: 'btn mini', title: 'Delete', onclick: () => { if (confirm(`Delete "${u.name}"?`)) { lib.user.remove(u.name); this.renderPanels(); } } }, '✕'));
      }) : el('p', { class: 'note' }, 'No saved presets yet.'));
      const file = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: (e) => this.importFile(e.target.files[0]) });
      this.section(p, 'My presets',
        el('div', { class: 'row' }, name, el('button', { class: 'btn primary', onclick: () => { const n = name.value.trim() || `${this.def.name} #${this.state.run.seed}`; lib.user.add({ name: n, snap: this.snapshot(), at: Date.now() }); this.toast(`Saved "${n}"`); this.renderPanels(); } }, 'Save current')),
        list,
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => { const blob = new Blob([JSON.stringify({ app: 'satisball', presets: lib.user.list() }, null, 1)], { type: 'application/json' }); SB.recorder.download(blob, 'satisball-presets.json'); } }, '⤓ Export all (.json)'),
          el('button', { class: 'btn', onclick: () => file.click() }, '⤒ Import .json'), file));
      const code = el('input', { type: 'text', placeholder: 'Paste a share code (SB2-…)' });
      this.section(p, 'Share codes',
        el('p', { class: 'note', style: 'margin:0 0 10px' }, 'A share code contains the mode, every setting, the look, sound, text and the seed — whoever loads it gets the exact same video.'),
        el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => this.copyShare() }, '🔗 Copy code for this run'), el('button', { class: 'btn', onclick: () => this.copy(location.href.split('#')[0] + '#' + lib.encode(this.snapshot()), 'Link copied') }, 'Copy as link')),
        el('div', { class: 'row', style: 'margin-top:8px' }, code, el('button', { class: 'btn', onclick: () => this.loadCode(code.value) }, 'Load')));
      const hist = lib.history.list();
      this.section(p, 'History — recent runs (click to replay exactly)',
        el('div', { class: 'plist' }, hist.length ? hist.map((h) => {
          const m = SB.modes.byId[h.snap.modeId];
          return el('div', { class: 'pitem' },
            el('button', { class: 'pload', onclick: () => this.applySnapshot(h.snap, true) }, el('span', {}, m ? m.icon : '?'), el('b', {}, h.title || (m ? m.name : '?')), el('small', {}, `${m ? m.name : ''} · #${h.snap.seed} · ${h.secs}s · ${new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)),
            el('button', { class: 'btn mini', title: 'Save as preset', onclick: () => { lib.user.add({ name: (h.title || m.name).slice(0, 30) + ' #' + h.snap.seed, snap: h.snap, at: Date.now() }); this.toast('Saved to My presets'); this.renderPanels(); } }, '★'),
            el('button', { class: 'btn mini', title: 'Copy share code', onclick: () => this.copy(lib.encode(h.snap), 'Share code copied') }, '🔗'));
        }) : el('p', { class: 'note' }, 'Finished runs show up here.')),
        hist.length ? el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { lib.history.clear(); this.renderPanels(); } }, 'Clear history')) : null);
    }
    copyShare() { this.copy(SB.library.encode(this.snapshot()), 'Share code copied — paste it into Library → Share codes to replay'); }
    copy(text, msg) {
      const done = () => this.toast(msg || 'Copied');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { prompt('Copy this:', text); });
      else prompt('Copy this:', text);
    }
    loadCode(code) {
      try {
        const s = SB.library.decode(code);
        if (s.presets) { this.importLibrary(s); return; }
        this.applySnapshot(s, true); this.toast('Loaded shared run');
      } catch (e) { this.toast('Could not load: ' + e.message); }
    }
    importLibrary(obj) {
      const list = (obj.presets || []).filter((p) => p && p.snap && SB.modes.byId[p.snap.modeId]);
      for (const p of list.reverse()) SB.library.user.add(p);
      this.toast(`Imported ${list.length} preset${list.length === 1 ? '' : 's'}`); this.renderPanels();
    }
    importFile(f) {
      if (!f) return;
      f.text().then((t) => {
        const obj = JSON.parse(t);
        if (obj.presets) this.importLibrary(obj);
        else if (obj.modeId) { SB.library.user.add({ name: obj.name || f.name.replace(/\.json$/, ''), snap: obj.snap || obj, at: Date.now() }); this.toast('Imported 1 preset'); this.renderPanels(); }
        else if (obj.snap) { SB.library.user.add({ name: obj.name || f.name, snap: obj.snap, at: Date.now() }); this.renderPanels(); }
        else throw new Error('no presets in file');
      }).catch((e) => this.toast('Import failed: ' + e.message));
    }
    importFromHash() {
      const h = location.hash.slice(1);
      if (h.startsWith('SB2-')) { this.loadCode(h); history.replaceState(null, '', location.pathname + location.search); }
    }

    // ------------------------------------------------------------ Export tab
    panel_export(p) {
      const X = this.state.export, T = this.state.text, B = this.state.batch;
      const setX = (k, v) => { X[k] = v; this.save(); this.refreshCaps(); };
      const c = this.caps || {};
      const [w, h] = SB.recorder.RESOLUTIONS[X.res] || [1080, 1920];
      this.section(p, 'Video format',
        el('p', { class: 'note', style: 'margin:0 0 10px' }, c.video ? `${c.container === 'mp4' ? 'MP4' : 'WebM'} · ${c.video.startsWith('avc') ? 'H.264' : c.video.split('.')[0].toUpperCase()} + ${c.audio ? (c.audio.startsWith('mp4a') ? 'AAC' : 'Opus') : 'no audio'} · ${w}×${h} · ${X.fps} fps · ${(SB.recorder.bitrateFor(w, h, X.fps, X.quality) / 1e6).toFixed(0)} Mbps` : 'This browser cannot encode video here (WebCodecs). Use Chrome or Edge on Windows, or use Record live.'),
        this.ctlSelect('Resolution', X.res, [[720, '720 × 1280 (small files)'], [1080, '1080 × 1920 (TikTok / Shorts)'], [1440, '1440 × 2560 (extra sharp)']], (v) => setX('res', +v)),
        this.ctlSelect('Frame rate', X.fps, [[60, '60 fps (smoothest)'], [30, '30 fps (smaller)']], (v) => setX('fps', +v)),
        this.ctlSelect('Quality', X.quality, [['standard', 'Standard'], ['high', 'High (recommended)'], ['max', 'Maximum']], (v) => setX('quality', v)),
        this.ctlRange('Length limit', X.limit, 0, 200, 5, (v) => setX('limit', v), (v) => (v ? `cut at ${v}s` : 'full run + outro')),
        el('p', { class: 'note' }, 'Exports re-render the current run from its seed, frame by frame — perfectly smooth even on a slow PC, with the full soundtrack.'));
      const setT = (k, v) => { T[k] = v; this.save(); this.softRestart(); };
      this.section(p, 'Intro & outro',
        this.ctlToggle('Intro hook card', T.intro, (v) => setT('intro', v)),
        this.ctlRange('Outro length', T.outroLen, 1, 8, 0.1, (v) => setT('outroLen', v), (v) => v.toFixed(1) + 's'),
        this.ctlToggle('Fade to black at the end', T.fadeOut, (v) => setT('fadeOut', v)));
      this.section(p, 'Export this run',
        el('p', { class: 'note', style: 'margin:0 0 10px' }, `${this.def.icon} ${this.def.name} · seed #${this.state.run.seed}`),
        el('button', { class: 'btn primary big wide', disabled: !c.video, onclick: () => this.openExport() }, `⤓ Export this run (${c.container === 'webm' ? 'WebM' : 'MP4'})`));
      // batch
      const setB = (k, v, rerender) => { B[k] = v; this.save(); if (rerender) this.renderPanels(); };
      const picks = B.which === 'pick' ? el('div', { class: 'mchecks' }, this.orderedModes().map((m) => el('label', { class: 'mcheck' }, el('input', { type: 'checkbox', checked: B.list.includes(m.id), onchange: (e) => { B.list = e.target.checked ? B.list.concat(m.id) : B.list.filter((x) => x !== m.id); this.save(); } }), m.icon + ' ' + m.name))) : null;
      this.section(p, 'Batch export',
        el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Render a whole set of videos in one go, e.g. a week of posts. Each video gets a fresh seed; runs outside the length window are re-rolled.'),
        this.ctlRange('Videos', B.count, 1, 50, 1, (v) => setB('count', v)),
        this.ctlSelect('Modes', B.which, [['current', 'Current mode only'], ['all', 'Cycle through every mode'], ['pick', 'Pick modes…']], (v) => setB('which', v, true)),
        picks,
        this.ctlToggle('Randomise settings for each video', B.randomSettings, (v) => setB('randomSettings', v)),
        this.ctlToggle('Randomise palette & sound for each video', B.randomLook, (v) => setB('randomLook', v)),
        this.ctlRange('Shortest allowed', B.minLen, 10, 120, 1, (v) => setB('minLen', v), (v) => v + 's'),
        this.ctlRange('Longest allowed', B.maxLen, 20, 200, 1, (v) => setB('maxLen', v), (v) => v + 's'),
        window.showDirectoryPicker ? this.ctlToggle('Save into a folder I choose (no download prompts)', B.useFolder, (v) => setB('useFolder', v)) : el('p', { class: 'note' }, 'Files will download one after another.'),
        el('button', { class: 'btn accent big wide', disabled: !c.video, onclick: () => this.startBatch() }, `▶ Render ${B.count} video${B.count > 1 ? 's' : ''}`));
    }
    refreshCaps() {
      const X = this.state.export, [w, h] = SB.recorder.RESOLUTIONS[X.res] || [1080, 1920];
      SB.recorder.capabilities({ width: w, height: h, fps: X.fps, quality: X.quality }).then((c) => {
        this.caps = c;
        if (!c || !c.video) { this.$export.title = 'Frame-perfect export needs Chrome or Edge (WebCodecs). Use Record live instead.'; this.$export.classList.add('disabled'); }
        else { this.$export.classList.remove('disabled'); this.$export.firstChild.textContent = c.container === 'webm' ? '⤓ Export WebM' : '⤓ Export MP4'; }
        if (this.tab === 'export') this.renderPanels();
      });
    }
    exportOpts() {
      const X = this.state.export, [w, h] = SB.recorder.RESOLUTIONS[X.res] || [1080, 1920];
      return { width: w, height: h, fps: X.fps, quality: X.quality, limit: X.limit };
    }
    maxSecsFor(snap) {
      const def = SB.modes.byId[snap.modeId];
      return def.longForm ? 215 : Math.max(75, (snap.targetLen || 35) * 2.2 + 8);
    }
    fileName(snap, ext) {
      const m = SB.modes.byId[snap.modeId];
      return `satisball_${(m ? m.name : snap.modeId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${snap.seed}.${ext}`;
    }

    // ------------------------------------------------------------ recording mode, overlay, keys
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
        if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!this.$modal.classList.contains('hidden') && e.key !== 'Escape') return;
        const k = e.key.toLowerCase();
        if (k === ' ') { this.paused = !this.paused; e.preventDefault(); }
        else if (k === 'r') this.restart(false);
        else if (k === 'n') this.restart(true);
        else if (k === 'g') this.randomize();
        else if (k === 'h') this.toggleRecMode();
        else if (k === 'escape') { if (document.body.classList.contains('recmode')) this.toggleRecMode(false); else if (!this.exporting) this.$modal.classList.add('hidden'); }
        else if (k === 'e') this.openExport();
        else if (k === 'l') (this.rec ? this.stopLive() : this.startLive());
        else if (k === '[') this.stepMode(-1);
        else if (k === ']') this.stepMode(1);
        else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); setTimeout(() => this.fit(), 200); }
        else if (/^[1-9]$/.test(k)) { const m = this.orderedModes()[+k - 1]; if (m) this.selectMode(m.id); }
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
      const name = this.fileName(this.snapshot(), ext);
      SB.recorder.download(blob, name);
      this.toast(`Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB)`);
    }

    // ------------------------------------------------------------ export (single + batch)
    modalCard(title, ...kids) {
      const m = this.$modal; m.innerHTML = ''; m.classList.remove('hidden');
      const card = el('div', { class: 'modal-card' }, el('h2', {}, title), ...kids);
      m.append(card);
      return card;
    }
    openExport() {
      if (this.exporting) return;
      const c = this.caps || {}, o = this.exportOpts(), snap = this.snapshot();
      const bar = el('div', { class: 'bar' }, el('i'));
      const status = el('p', { class: 'status' }, '');
      const go = el('button', { class: 'btn primary big', disabled: !c.video }, `Render ${c.container === 'webm' ? 'WebM' : 'MP4'}`);
      const cancel = el('button', { class: 'btn' }, 'Close');
      this.modalCard('Export video',
        el('p', {}, `${this.def.icon} ${this.def.name} · seed #${snap.seed}. The run is re-rendered from the start frame by frame, so the file is perfectly smooth with the full soundtrack. It downloads automatically when done.`),
        el('p', { class: 'muted' }, c.video ? `${o.width}×${o.height} · ${o.fps} fps · ${c.video.startsWith('avc') ? 'H.264' : c.video} · ${c.audio ? (c.audio.startsWith('mp4a') ? 'AAC' : 'Opus') : 'no audio'}${o.limit ? ` · cut at ${o.limit}s` : ''} — change in the Export tab` : 'This browser cannot export frame-perfect video. Use Chrome or Edge, or Record live.'),
        bar, status, el('div', { class: 'row' }, go, cancel));
      let cancelled = false;
      cancel.onclick = () => { cancelled = true; if (!this.exporting) this.$modal.classList.add('hidden'); };
      go.onclick = async () => {
        go.disabled = true; this.exporting = true; cancel.textContent = 'Cancel';
        try {
          this.engine.ensure();
          const res = await SB.recorder.exportRun(this.cfgFrom(snap, null, 'capture'), Object.assign({}, o, {
            maxSecs: this.maxSecsFor(snap),
            onProgress: (k, txt) => { bar.firstChild.style.width = (k * 100).toFixed(1) + '%'; status.textContent = txt; },
            isCancelled: () => cancelled,
          }));
          const name = this.fileName(snap, res.ext);
          SB.recorder.download(res.blob, name);
          SB.library.history.push({ snap, at: Date.now(), secs: +res.duration.toFixed(1), title: res.winner || '' });
          status.textContent = `Saved ${name} · ${res.duration.toFixed(1)}s · ${(res.blob.size / 1e6).toFixed(1)} MB`;
        } catch (e) {
          status.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Export failed: ' + e.message;
          if (e.message !== 'cancelled') console.error(e);
        }
        this.exporting = false; go.disabled = false; cancel.textContent = 'Close';
      };
    }
    /** Quick deterministic length check (no rendering) so batches can skip runs that are too short or long. */
    async simLength(snap, maxSecs) {
      const cv = document.createElement('canvas'); cv.width = 108; cv.height = 192;
      const g = new SB.Game(this.cfgFrom(snap, cv, 'mute'));
      let f = 0; const max = maxSecs * 60;
      while (g.state !== 'done' && f < max) { g.frame(); f++; if (f % 1200 === 0) await new Promise((r) => setTimeout(r, 0)); }
      return { secs: f / 60, done: g.state === 'done', title: g.winInfo ? g.winInfo.title : '' };
    }
    async startBatch() {
      if (this.exporting) return;
      const B = this.state.batch, o = this.exportOpts();
      const pool = B.which === 'all' ? this.orderedModes().map((m) => m.id) : B.which === 'pick' ? (B.list.length ? B.list.filter((id) => SB.modes.byId[id]) : [this.state.modeId]) : [this.state.modeId];
      let dir = null;
      if (B.useFolder && window.showDirectoryPicker) {
        try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'satisball-batch' }); } catch (e) { if (e.name === 'AbortError') return; dir = null; }
      }
      const items = el('div', { class: 'blist' });
      const bar = el('div', { class: 'bar' }, el('i'));
      const status = el('p', { class: 'status' }, '');
      const cancel = el('button', { class: 'btn' }, 'Cancel');
      this.modalCard(`Batch export · ${B.count} videos`, el('p', { class: 'muted' }, `${o.width}×${o.height} · ${o.fps} fps · ${dir ? 'saving into ' + dir.name : 'downloading'} · lengths ${B.minLen}–${B.maxLen}s`), bar, status, items, el('div', { class: 'row' }, cancel));
      let cancelled = false;
      cancel.onclick = () => { if (this.exporting) cancelled = true; else this.$modal.classList.add('hidden'); };
      this.exporting = true; this.engine.ensure();
      const rng = new RNG((Math.random() * 1e9) >>> 0);
      let ok = 0;
      for (let i = 0; i < B.count && !cancelled; i++) {
        const modeId = pool[i % pool.length], def = SB.modes.byId[modeId];
        const row = el('div', { class: 'bitem' }, el('span', {}, def.icon), el('b', {}, `${i + 1}. ${def.name}`), el('small', {}, 'choosing a run…'));
        items.prepend(row);
        const small = row.lastChild;
        try {
          // roll a run that lands inside the length window (up to 8 tries)
          let snap = null, len = null;
          for (let tries = 0; tries < 8 && !cancelled; tries++) {
            const base = this.snapshot();
            const cand = Object.assign(base, { modeId, seed: rng.int(1, 2 ** 31 - 1) });
            cand.settings = B.randomSettings ? SB.modes.randomize(def, rng, def.defaults) : this.modeSettings(modeId);
            if (B.randomLook) this.randomLook(rng, cand);
            small.textContent = `checking length (try ${tries + 1})…`;
            len = await this.simLength(cand, Math.min(this.maxSecsFor(cand), B.maxLen + 10));
            snap = cand;
            if (len.done && len.secs >= B.minLen && len.secs <= B.maxLen + (cand.text.outroLen || 3.4)) break;
          }
          if (cancelled) break;
          small.textContent = `${len.secs.toFixed(0)}s · rendering…`;
          const res = await SB.recorder.exportRun(this.cfgFrom(snap, null, 'capture'), Object.assign({}, o, {
            maxSecs: this.maxSecsFor(snap),
            onProgress: (k, txt) => { const tot = (i + k) / B.count; bar.firstChild.style.width = (tot * 100).toFixed(1) + '%'; small.textContent = txt; status.textContent = `Video ${i + 1} of ${B.count}`; },
            isCancelled: () => cancelled,
          }));
          const name = this.fileName(snap, res.ext).replace('satisball_', `satisball_${String(i + 1).padStart(2, '0')}_`);
          await SB.recorder.saveTo(dir, res.blob, name);
          SB.library.history.push({ snap, at: Date.now(), secs: +res.duration.toFixed(1), title: res.winner || '' });
          small.textContent = `✓ ${name} · ${res.duration.toFixed(1)}s · ${(res.blob.size / 1e6).toFixed(1)} MB`;
          row.classList.add('ok'); ok++;
        } catch (e) {
          small.textContent = e.message === 'cancelled' ? 'cancelled' : '✕ ' + e.message;
          row.classList.add('err');
          if (e.message === 'cancelled') break;
        }
      }
      bar.firstChild.style.width = '100%';
      status.textContent = cancelled ? `Stopped · ${ok} saved` : `Done · ${ok} of ${B.count} saved${dir ? ' to ' + dir.name : ''}`;
      this.exporting = false; cancel.textContent = 'Close';
      if (this.tab === 'library') this.renderPanels();
    }
    toast(msg) {
      const live = [...document.querySelectorAll('.toast')];
      const t = el('div', { class: 'toast', style: `bottom:${24 + live.length * 58}px` }, msg);
      document.body.append(t);
      setTimeout(() => t.classList.add('show'), 10);
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
    }
  }
  SB.UI = UI;
})(window.SB);
