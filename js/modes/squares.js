/* Mode: Square Escape — eyed squares bounce DVD-style through a procedurally generated level.
 *
 * Layouts (random per seed, or pick one): Circuit (chain of rooms), Tower (central climb with blocked side
 * alcoves), Lanes (breakable passages into one lane per square) and Staircase (diagonal climb lined with
 * pencil spikes). Every level is validated with a flood fill (start → finish, avoiding spikes, treating
 * breakables as openable) and regenerated until it is guaranteed finishable.
 *
 * Number blocks count down per hit, colour bars only break for their own colour, spiral portals skip
 * ahead, knives kill on contact, boosts speed up, ghosts and spikes eliminate. First to a flag — or the
 * last square alive — wins. Squares leave paint trails. */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, rgba, mix, lighten, darken } = SB.util;
  const draw = SB.draw;
  const T = 24, LX = 24, LY = 456, GW = 43, GH = 59; // tile grid covering x 24..1056, y 456..1872
  const FLOOR = 0, WALL = 1, FILL = 2;
  const TOY = [
    { c: '#e8213a', n: 'RED' }, { c: '#2a47e8', n: 'BLUE' }, { c: '#ffd426', n: 'YELLOW' }, { c: '#1fb03a', n: 'GREEN' },
    { c: '#ff8fd0', n: 'PINK' }, { c: '#8a3dff', n: 'PURPLE' }, { c: '#ff7a1a', n: 'ORANGE' }, { c: '#12c9d6', n: 'CYAN' },
  ];
  const THEMES = {
    circuit: { floor: '#fffbe3', floor2: '#fff4cc', wall: '#8ff07e', edge: '#3f9a33', fill: '#ff4f6e', fillEdge: '#c9283f', chk: ['#3f6f33', '#5b8f45'] },
    tower: { floor: '#fffdf0', floor2: '#fbf6e2', wall: '#3fdc3f', edge: '#1f8a1f', fill: '#3fdc3f', fillEdge: '#1f8a1f', chk: ['#2a0716', '#b3165b'] },
    lanes: { floor: '#fff7e6', floor2: '#fbf0dc', wall: '#8a45d0', edge: '#4d1d85', fill: '#8a45d0', fillEdge: '#4d1d85', chk: ['#0c1f10', '#1e3b22'] },
    stairs: { floor: '#e6f7ff', floor2: '#d8f0fb', wall: '#ff2020', edge: '#a30f0f', fill: '#ff2020', fillEdge: '#a30f0f', chk: ['#d4507a', '#f7c9d6'] },
    gauntlet: { floor: '#fff8e8', floor2: '#fbf1dc', wall: '#5a8fd8', edge: '#23466e', fill: '#5a8fd8', fillEdge: '#23466e', chk: ['#2b2014', '#6b5132'] },
  };
  const GAUNTLET_SKINS = [
    { wall: '#5a8fd8', edge: '#23466e', chk: ['#2b2014', '#6b5132'] }, { wall: '#b53a55', edge: '#5e1526', chk: ['#0d2a24', '#2e8a73'] },
    { wall: '#2fdc4a', edge: '#138a25', chk: ['#1a8f2e', '#5fdc6f'] }, { wall: '#e0a21f', edge: '#7a5208', chk: ['#1d1033', '#44297a'] },
  ];

  class Squares extends SB.Mode {
    init() {
      const s = this.s;
      this.toy = s.style === 'toy';
      // long-form races are fine for this genre (TikTok runs go 1–3 min): stretch the pacing, cap near 3 minutes
      if (s.pace === 'long') this.g.targetLen = clamp(this.g.targetLen * 2.4, 60, 95);
      this.layout = s.layout === 'random' ? this.rng.pick(['circuit', 'tower', 'lanes', 'stairs', 'gauntlet', 'gauntlet']) : s.layout;
      this.skin = this.rng.pick(GAUNTLET_SKINS);
      const n = s.squares;
      // racers
      const cast = this.g.cfg.look.cast || {};
      const pc = this.toy ? null : this.distinctColors(n, 9);
      this.sq = [];
      for (let i = 0; i < n; i++) {
        const base = this.toy ? TOY[i % TOY.length] : { c: this.color(pc[i]), n: this.cname(pc[i]) };
        this.sq.push({ color: (cast.colors && cast.colors[i]) || base.c, name: ((cast.names && cast.names[i]) || '').trim().toUpperCase().slice(0, 10) || base.n, alive: true, finished: false, flash: 0, trail: [], r: s.size / 2, status: '', place: i, lastHit: -1, blink: this.rng.range(0, 3), knife: false, boostT: 0 });
      }
      // generate until the level is provably finishable
      let ok = false;
      for (let attempt = 0; attempt < 25 && !ok; attempt++) { this.generate(); ok = this.validate(); }
      if (!ok) { this.layout = 'circuit'; this.generate(); this.validate(); }
      this.placeRacers();
      this.feed = []; this.leader = null; this.leaderT = 0; this.bias = 0;
      this.trailLen = 10; this.cache = null; this.paintCv = null; this.paintQ = [];
    }

    // ================================================================ generation
    reset() {
      this.map = new Uint8Array(GW * GH).fill(FILL);
      this.blocks = []; this.bars = []; this.gates = []; this.doors = []; this.spikes = []; this.portals = []; this.ghosts = []; this.pickups = []; this.flags = []; this.openings = []; this.bullets = [];
      this.laneSpawns = null; this.bonusRoom = null; this.hazardBudget = undefined;
      this.roomsDrawn = [];
    }
    carve(x0, y0, x1, y1) { for (let y = Math.max(0, y0); y <= Math.min(GH - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(GW - 1, x1); x++) this.map[y * GW + x] = FLOOR; }
    fillRect(x0, y0, x1, y1, v = FILL) { for (let y = Math.max(0, y0); y <= Math.min(GH - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(GW - 1, x1); x++) this.map[y * GW + x] = v; }
    tile(x, y) { if (x < 0 || y < 0 || x >= GW || y >= GH) return FILL; return this.map[y * GW + x]; }
    px(tx) { return LX + tx * T; } py(ty) { return LY + ty * T; }
    rectPx(x0, y0, x1, y1) { return { x: this.px(x0), y: this.py(y0), w: (x1 - x0 + 1) * T, h: (y1 - y0 + 1) * T }; }
    addBlock(x0, y0, x1, y1, hp, o = {}) { this.blocks.push(Object.assign(this.rectPx(x0, y0, x1, y1), { hp, max: hp, bump: 0, alive: true }, o)); }
    addSpike(x0, y0, x1, y1, dir, kind = 'spike') { this.spikes.push(Object.assign(this.rectPx(x0, y0, x1, y1), { dir, kind })); }
    generate() {
      this.reset();
      this['gen_' + this.layout]();
      // border walls: solid tiles touching floor become visible WALL tiles (circuit look)
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (this.map[y * GW + x] === FILL && this.nearFloor(x, y)) this.map[y * GW + x] = WALL;
      this.placeCommon();
    }
    nearFloor(x, y) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < GW && Y < GH && this.map[Y * GW + X] === FLOOR) return true; } return false; }

    // ---- layout: Circuit (random chain of rooms) --------------------------
    gen_circuit() {
      const s = this.s, rng = this.rng;
      const C = 3, R = 5, cw = Math.floor((GW - 1) / C), ch = Math.floor((GH - 1) / R);
      const ox = Math.floor((GW - (C * cw + 1)) / 2), oy = Math.floor((GH - (R * ch + 1)) / 2);
      const roomRect = (i, j) => { const x0 = ox + i * cw + 1, y0 = oy + j * ch + 1; return [x0, y0, x0 + cw - 2, y0 + ch - 2]; };
      const L = clamp(s.rooms, 3, C * R);
      let path = null;
      for (let tries = 0; tries < 200 && !path; tries++) {
        const p = [[rng.int(0, C - 1), R - 1]], used = new Set([p[0].join(',')]);
        const dfs = () => {
          if (p.length === L) return true;
          const [i, j] = p[p.length - 1];
          for (const [a, b] of rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]).map(([dx, dy]) => [i + dx, j + dy])) {
            if (a < 0 || b < 0 || a >= C || b >= R || used.has(a + ',' + b)) continue;
            p.push([a, b]); used.add(a + ',' + b); if (dfs()) return true; p.pop(); used.delete(a + ',' + b);
          }
          return false;
        };
        if (dfs()) path = p;
      }
      if (!path) path = [[0, R - 1], [1, R - 1], [2, R - 1]];
      for (const [i, j] of path) { const r = roomRect(i, j); this.carve(...r); this.roomsDrawn.push(r); }
      const w = Math.min(5, ch - 4);
      for (let k = 0; k < path.length - 1; k++) {
        const a = path[k], b = path[k + 1], o = { k };
        if (a[1] === b[1]) { const x = ox + Math.max(a[0], b[0]) * cw, y0 = oy + a[1] * ch + 1, st = y0 + rng.int(1, ch - 2 - w); this.carve(x, st, x, st + w - 1); Object.assign(o, { vertical: true, tx: x, ty: st, w, dir: Math.sign(b[0] - a[0]) }); }
        else { const y = oy + Math.max(a[1], b[1]) * ch, x0 = ox + a[0] * cw + 1, st = x0 + rng.int(1, cw - 2 - w); this.carve(st, y, st + w - 1, y); Object.assign(o, { vertical: false, tx: st, ty: y, w, dir: Math.sign(b[1] - a[1]) }); }
        o.cx = o.vertical ? o.tx : o.tx + (w - 1) / 2; o.cy = o.vertical ? o.ty + (w - 1) / 2 : o.ty;
        this.openings.push(o);
      }
      const L2 = path.length;
      this.spawnT = roomRect(...path[0]);
      // number block straddling an opening a third of the way round
      const kn = clamp(Math.floor(L2 * 0.36), 1, L2 - 2);
      if (s.blockHp > 0 && L2 >= 3) { const o = this.openings[kn], h = Math.floor(o.w / 2) + 1; this.addBlock(Math.round(o.cx) - h, Math.round(o.cy) - h, Math.round(o.cx) + h, Math.round(o.cy) + h, s.blockHp, { big: true }); }
      // colour-bar tunnel later on
      const kb = clamp(Math.floor(L2 * 0.62), 1, L2 - 2);
      if (s.bars > 0 && L2 >= 4 && kb !== kn) this.barTunnel(this.openings[kb]);
      // one-way spiral portal: early room -> late room
      if (s.portals && L2 >= 6) {
        // a shortcut that skips rooms after the number block but never the colour bars or the final room
        const ka = kn + 1, kz = Math.min(L2 - 2, s.bars > 0 && kb > ka ? kb : L2 - 2);
        if (kz >= ka + 2) {
          const A = this.freeSpotIn(roomRect(...path[ka]), 2), B = this.freeSpotIn(roomRect(...path[kz]), 2);
          if (A && B) this.portals.push({ ax: A[0], ay: A[1], bx: B[0], by: B[1], size: 2 * T, rot: 0 });
        }
      }
      this.ghostZones = path.map((p, k) => ({ k, r: roomRect(...p) })).filter((z) => z.k > kn && z.k < L2 - 1).map((z) => z.r);
      this.spikeZones = path.map((p, k) => ({ k, r: roomRect(...p) })).filter((z) => z.k > 0 && z.k < L2 - 1).map((z) => z.r);
      this.pickZones = this.spikeZones;
      // finish flag on the far wall of the last room
      const [x0, y0, x1, y1] = roomRect(...path[L2 - 1]), prev = path[L2 - 2], last = path[L2 - 1];
      const dx = last[0] - prev[0], dy = last[1] - prev[1];
      if (dx > 0) this.flags.push(this.rectPx(x1 - 1, y0 + 1, x1, y1 - 1)); else if (dx < 0) this.flags.push(this.rectPx(x0, y0 + 1, x0 + 1, y1 - 1));
      else if (dy > 0) this.flags.push(this.rectPx(x0 + 1, y1 - 1, x1 - 1, y1)); else this.flags.push(this.rectPx(x0 + 1, y0, x1 - 1, y0 + 1));
    }
    barTunnel(o) {
      const s = this.s, rng = this.rng, D = 4;
      for (let d = 1; d <= D; d++) {
        if (o.vertical) { const x = o.tx + o.dir * d; this.fillRect(x, o.ty - 1, x, o.ty - 1, WALL); this.fillRect(x, o.ty + o.w, x, o.ty + o.w, WALL); }
        else { const y = o.ty + o.dir * d; this.fillRect(o.tx - 1, y, o.tx - 1, y, WALL); this.fillRect(o.tx + o.w, y, o.tx + o.w, y, WALL); }
      }
      const cols = this.sq.map((q) => q.color), layers = s.bars, depth = (D + 1) * T, pitch = depth / layers, th = Math.max(6, Math.floor(pitch) - 5);
      const start = rng.int(0, cols.length - 1);
      for (let i = 0; i < layers; i++) {
        const off = (i + 0.5) * pitch - th / 2, col = cols[(start + i + (i % 3 === 2 ? rng.int(0, cols.length - 1) : 0)) % cols.length];
        let r;
        if (o.vertical) { const x0 = o.dir > 0 ? this.px(o.tx) + off : this.px(o.tx + 1) - off - th; r = { x: x0, y: this.py(o.ty), w: th, h: o.w * T }; }
        else { const y0 = o.dir > 0 ? this.py(o.ty) + off : this.py(o.ty + 1) - off - th; r = { x: this.px(o.tx), y: y0, w: o.w * T, h: th }; }
        this.bars.push(Object.assign(r, { color: col, alive: true, owner: this.sq.find((q) => q.color === col) }));
      }
    }

    // ---- layout: Tower (central climb, blocked side alcoves) --------------
    gen_tower() {
      const s = this.s, rng = this.rng;
      const cx = 21, hw = rng.int(3, 5); // corridor half-width
      const top = 8, bottom = GH - 12;
      this.carve(cx - hw, top, cx + hw, bottom);
      this.carve(cx - 3, bottom, cx + 3, GH - 3); this.spawnT = [cx - 3, bottom + 1, cx + 3, GH - 3];
      // finish neck with a number block, flag above it
      this.carve(cx - 2, 1, cx + 2, top - 1);
      this.flags.push(this.rectPx(cx - 2, 1, cx + 2, 2));
      if (s.blockHp > 0) this.addBlock(cx - 2, 4, cx + 2, 6, Math.max(3, Math.round(s.blockHp * 0.15)), { big: true });
      // alcoves: a small number block at the mouth, a pickup inside, spikes at the far wall
      const levels = clamp(Math.round(s.rooms / 2.4), 2, 5), span = (bottom - top - 2) / levels;
      for (let i = 0; i < levels; i++) {
        const y0 = Math.round(top + 2 + i * span), y1 = y0 + 3;
        for (const side of [-1, 1]) {
          if (rng.chance(0.15)) continue;
          const xa = side < 0 ? 2 : cx + hw + 1, xb = side < 0 ? cx - hw - 1 : GW - 3;
          this.carve(xa, y0, xb, y1);
          const mouth = side < 0 ? [xb - 2, xb] : [xa, xa + 2];
          this.addBlock(mouth[0], y0, mouth[1], y1, Math.max(3, Math.round(s.blockHp * 0.1)), { alcove: true });
          const sx = side < 0 ? xa : xb;
          if (s.hazards > 0 && rng.chance(clamp(0.35 + s.hazards * 0.13, 0, 1))) this.addSpike(sx, y0, sx, y1, side < 0 ? 'right' : 'left');
          const mid = Math.round((xa + xb) / 2);
          const knivesSoFar = this.pickups.filter((p) => p.kind === 'knife').length;
          this.pickups.push({ x: this.px(mid) + T / 2, y: this.py(y0 + 2), kind: knivesSoFar < s.knives && rng.chance(0.4) ? 'knife' : 'boost', taken: false });
        }
      }
      this.ghostZones = [];
      this.spikeZones = [];
      this.pickZones = [[cx - hw, top + 4, cx + hw, bottom - 2]];
    }

    // ---- layout: Lanes (breakable passages → one lane per square) ---------
    gen_lanes() {
      const s = this.s, rng = this.rng, n = this.sq.length;
      const roomB = rng.int(15, 19);
      this.carve(1, 1, GW - 2, roomB); this.spawnT = [8, 4, GW - 9, roomB - 5];
      const midT = roomB + 8, midB = midT + 3;
      this.carve(1, midT, GW - 2, midB);
      const lanes = Math.max(2, n), step = (GW - 2) / lanes;
      for (let i = 0; i < lanes; i++) {
        // passage: 3 wide with a stack of breakable segments
        const pc = Math.round(1 + step * (i + 0.5)), px0 = pc - 1;
        this.carve(px0, roomB + 1, px0 + 2, midT - 1);
        const segs = rng.int(2, 3), segH = Math.floor((midT - roomB - 2) / segs);
        for (let k = 0; k < segs; k++) { const y0 = roomB + 1 + k * segH; this.addBlock(px0, y0, px0 + 2, y0 + segH - 1, rng.int(1, Math.max(1, Math.round(s.blockHp / 30))), { seg: true }); }
        // lane: 2 wide, offset from the passage so squares must travel the corridor
        const lc = clamp(pc + (i % 2 ? -3 : 3) + rng.int(-1, 1), 2, GW - 4);
        this.carve(lc, midB + 1, lc + 1, GH - 3);
        this.flags.push(this.rectPx(lc, GH - 4, lc + 1, GH - 3));
        if (s.hazards > 0 && i < lanes - 1 && rng.chance(clamp(0.25 + s.hazards * 0.1, 0, 0.95))) {
          const y = rng.int(midB + 6, GH - 10), sideL = rng.chance(0.5);
          this.fillRect(sideL ? lc - 1 : lc + 2, y, sideL ? lc - 1 : lc + 2, y + 1, FILL);
          this.addSpike(sideL ? lc : lc + 1, y, sideL ? lc : lc + 1, y + 1, sideL ? 'right' : 'left', 'spike');
        }
      }
      this.ghostZones = [];
      this.spikeZones = [];
      this.pickZones = [[3, 3, GW - 4, roomB - 2]];
    }

    // ---- layout: Staircase (diagonal climb, pencil spikes) ----------------
    gen_stairs() {
      const s = this.s, rng = this.rng;
      // a stepped corridor: each step is a (sw+th)×(sh+th) block overlapping the next only by th×th
      const N = clamp(s.rooms, 4, 12), th = rng.int(5, 7);
      // sizes chosen so the last step (and its flag) stays inside the grid
      const sw = Math.floor((GW - 3 - th) / N), sh = Math.floor((GH - 5 - th) / N);
      const steps = [];
      for (let i = 0; i < N; i++) {
        const x0 = 1 + i * sw, y1 = GH - 3 - i * sh;
        const r = [x0, y1 - sh - th + 1, Math.min(GW - 2, x0 + sw + th - 1), y1];
        if (i === 0) r[1] = y1 - th - 3;
        this.carve(...r); steps.push(r);
      }
      this.spawnT = [steps[0][0] + 1, steps[0][1] + 4, steps[0][2] - 3, steps[0][3] - 1];
      const lastS = steps[N - 1];
      this.flags.push(this.rectPx(lastS[2] - 2, lastS[1], lastS[2], lastS[1] + 2));
      // pencils on the right-hand risers pointing left into the climb
      if (s.hazards > 0) {
        for (let i = 1; i < N - 1; i++) {
          if (!rng.chance(clamp(0.3 + s.hazards * 0.1, 0, 1))) continue;
          const r = steps[i], x = r[2];
          const yy = rng.int(r[3] - 5, r[3] - 2);
          if (this.tile(x + 1, yy) === FLOOR) continue;
          this.addSpike(x - 1, yy, x, yy, 'left', 'pencil');
        }
      }
      this.ghostZones = steps.slice(2, N - 1).map((r) => [r[0] + 1, r[1] + 1, r[2] - 1, r[3] - 1]);
      this.spikeZones = [];
      this.pickZones = steps.slice(1, N - 1).map((r) => [r[0] + 1, r[1] + 1, r[2] - 1, r[3] - 1]);
      if (s.blockHp > 0) {
        // gate block exactly on the overlap between the middle step and the next one
        const m = Math.floor(N / 2), a = steps[m], b = steps[m + 1];
        const ox0 = Math.max(a[0], b[0]), ox1 = Math.min(a[2], b[2]), oy0 = Math.max(a[1], b[1]), oy1 = Math.min(a[3], b[3]);
        if (ox1 - ox0 >= 2 && oy1 - oy0 >= 2) this.addBlock(ox0, oy0, ox1, oy1, Math.max(4, Math.round(s.blockHp * 0.35)), { big: true });
      }
    }

    // ---- layout: Gauntlet (start stalls with linked colour doors → winding sections) ----
    gen_gauntlet() {
      const s = this.s, rng = this.rng, n = this.sq.length;
      // start stalls: one lane per square with a door of ANOTHER square's colour (derangement)
      const lw = 3, gap = 2, laneTop = 1, laneBot = rng.int(13, 16);
      const perm = [...Array(n).keys()];
      do rng.shuffle(perm); while (n > 1 && perm.some((v, i) => v === i));
      const lanesW = n * lw + (n - 1) * gap, lx0 = rng.chance(0.5) ? 2 : GW - 2 - lanesW;
      this.laneSpawns = [];
      for (let i = 0; i < n; i++) {
        const x0 = lx0 + i * (lw + gap);
        this.carve(x0, laneTop, x0 + lw - 1, laneBot);
        const dy = rng.int(Math.floor(laneBot * 0.45), Math.floor(laneBot * 0.62));
        const col = this.sq[perm[i]].color;
        this.doors.push(Object.assign(this.rectPx(x0, dy, x0 + lw - 1, dy + 2), { color: col, owner: this.sq[perm[i]], lane: this.sq[i], open: 0, closed: true, t: 0 }));
        this.laneSpawns.push([this.px(x0 + lw / 2), this.py(laneTop + 1.5)]);
      }
      this.spawnT = [lx0, laneTop, lx0 + lanesW - 1, 3];
      // each colour needs a different number of door hits -> racers are released one by one
      this.doorNeed = {}; this.doorCharge = {};
      const needs = rng.shuffle([...Array(n).keys()].map((k) => 2 + k * 2 + rng.int(0, 1)));
      this.sq.forEach((q, i) => { this.doorNeed[q.color] = needs[i]; this.doorCharge[q.color] = 0; });
      // side route next to the stalls: a room behind a number block (optional shortcut feel)
      const sideX0 = lx0 === 2 ? lx0 + lanesW + 1 : 2, sideX1 = lx0 === 2 ? GW - 3 : lx0 - 2;
      if (sideX1 - sideX0 >= 5) {
        // bonus room reached from the first corridor through a small number block
        this.carve(sideX0, laneTop + 2, sideX1, laneBot + 1);
        if (s.blockHp > 0) this.addBlock(sideX0, laneBot - 1, sideX1, laneBot + 1, Math.max(3, Math.round(s.blockHp * 0.08)), {});
        this.bonusRoom = [sideX0, laneTop + 2, sideX1, laneBot - 3];
      }
      // winding sections
      let y = laneBot + 2;
      const bands = [];
      const sections = clamp(Math.round(s.rooms / 2.2), 2, 5);
      let side = lx0 === 2 ? 1 : -1;
      for (let k = 0; k < sections; k++) {
        const h = rng.int(4, s.ghosts > 0 && k > 0 ? 7 : 6), y0 = y, y1 = Math.min(GH - 3, y0 + h - 1);
        this.carve(1, y0, GW - 2, y1); bands.push([1, y0, GW - 2, y1]);
        if (k === 0) this.carve(lx0, laneBot, lx0 + lanesW - 1, y0); // stalls drain into the first corridor
        const shaftH = 3;
        y = y1 + shaftH + 1;
        if (k < sections - 1 && y + 4 < GH - 2) {
          const sx0 = side > 0 ? GW - 9 : 2, sx1 = sx0 + 5;
          this.carve(sx0, y1 + 1, sx1, y1 + shaftH);
          const kind = rng.pick(s.blockHp > 0 ? ['block', 'block', 'spikes', 'none'] : ['spikes', 'none']);
          if (kind === 'block') this.addBlock(sx0, y1 + 1, sx1, y1 + shaftH, Math.max(4, Math.round(s.blockHp * rng.range(0.08, 0.18))), { big: true });
          else if (kind === 'spikes' && s.hazards > 0) { this.addSpike(sx0, y1 + 2, sx0, y1 + 2, 'right'); this.addSpike(sx1, y1 + 2, sx1, y1 + 2, 'left'); }
          side = -side;
        } else break;
      }
      // spike necks and combs inside the bands
      for (let k = 1; k < bands.length; k++) {
        const [x0, y0, x1, y1] = bands[k];
        if (s.hazards > 1 && y1 - y0 >= 4 && rng.chance(0.6)) {
          // neck: a solid pillar with a gap, spikes above and below the gap
          const nx = rng.int(12, GW - 14), gh = Math.min(6, y1 - y0 + 1), gt = y0 + Math.floor((y1 - y0 + 1 - gh) / 2);
          if (gh >= 6) { this.fillRect(nx, y0, nx + 1, y1, FILL); this.carve(nx, gt, nx + 1, gt + gh - 1); this.addSpike(nx, gt, nx + 1, gt, 'down'); this.addSpike(nx, gt + gh - 1, nx + 1, gt + gh - 1, 'up'); }
        }
        if (s.hazards > 2 && rng.chance(0.45) && y0 - 5 > 0) {
          // comb: dead-end slots above the corridor with spikes at the top
          const cx0 = rng.int(8, GW - 20);
          for (let c = 0; c < 3; c++) { const sx = cx0 + c * 4; if (this.tile(sx, y0 - 4) !== FILL || this.tile(sx + 1, y0 - 4) !== FILL) continue; this.carve(sx, y0 - 3, sx + 1, y0 - 1); this.addSpike(sx, y0 - 3, sx + 1, y0 - 3, 'down'); }
        }
      }
      // finish at the far end of the last band
      const lb = bands[bands.length - 1], endRight = side > 0;
      this.flags.push(endRight ? this.rectPx(lb[2] - 1, lb[1], lb[2], lb[3]) : this.rectPx(lb[0], lb[1], lb[0] + 1, lb[3]));
      this.ghostZones = bands.slice(1).filter((b) => b[3] - b[1] >= 6).map((b) => [b[0] + 2, b[1], b[2] - 2, b[3]]);
      // hazards 1-3 shape the bands (shaft spikes, necks, combs); anything above that adds loose spikes
      this.spikeZones = bands.slice(1, -1).map((b) => [b[0] + 4, b[1], b[2] - 4, b[3]]);
      this.hazardBudget = Math.max(0, s.hazards - 3);
      this.pickZones = bands.map((b) => [b[0] + 3, b[1], b[2] - 3, b[3]]);
      // one-way portal: first corridor -> the second-to-last band (never straight into the finish band)
      if (s.portals && bands.length >= 4) {
        const A = this.freeSpotIn(bands[0], 2), B = this.freeSpotIn(bands[bands.length - 2], 2);
        // it only switches on mid-run: a comeback route for whoever is behind, never a 10-second win
        if (A && B) this.portals.push({ ax: A[0], ay: A[1], bx: B[0], by: B[1], size: 2 * T, rot: 0, openAt: 0.42 });
      }
    }

    // ---- shared placements -------------------------------------------------
    placeCommon() {
      const s = this.s, rng = this.rng;
      for (let i = 0; i < s.ghosts && this.ghostZones.length; i++) {
        const z = rng.pick(this.ghostZones), [x0, y0, x1, y1] = z;
        if (x1 - x0 < 7 || y1 - y0 < 6) continue;
        const a = rng.pick([1, 3, 5, 7]) * Math.PI / 4, sp = s.speed * 0.38;
        this.ghosts.push({ x: this.px((x0 + x1 + 1) / 2), y: this.py((y0 + y1 + 1) / 2), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 22, box: [this.px(x0), this.py(y0), this.px(x1 + 1), this.py(y1 + 1)], t: rng.range(0, 6), period: rng.range(4.5, 6) });
      }
      for (let i = 0; i < (this.hazardBudget ?? s.hazards) && this.spikeZones.length; i++) {
        const z = rng.pick(this.spikeZones), p = this.freeSpotIn(z, 1);
        if (p) { const tx = Math.floor((p[0] - LX) / T), ty = Math.floor((p[1] - LY) / T); this.addSpike(tx, ty, tx, ty, 'all'); }
      }
      for (let i = this.pickups.filter((p) => p.kind === 'knife').length; i < s.knives && this.pickZones.length; i++) { const p = this.freeSpotIn(rng.pick(this.pickZones), 1); if (p) this.pickups.push({ x: p[0], y: p[1], kind: 'knife', taken: false }); }
      if (this.bonusRoom) { const p = this.freeSpotIn(this.bonusRoom, 1); if (p) this.pickups.push({ x: p[0], y: p[1], kind: (s.guns || 0) > 0 ? 'gun' : 'boost', taken: false }); }
      for (let i = 0; i < (s.guns || 0) && this.pickZones.length; i++) { const p = this.freeSpotIn(rng.pick(this.pickZones.slice(-2)), 2); if (p) this.pickups.push({ x: p[0], y: p[1], kind: 'gun', taken: false }); }
      for (let i = 0; i < (s.boosts ?? 1) && this.pickZones.length; i++) { const p = this.freeSpotIn(rng.pick(this.pickZones), 1); if (p) this.pickups.push({ x: p[0], y: p[1], kind: 'boost', taken: false }); }
    }
    /** A clear sizeT×sizeT floor area inside a tile rect, away from openings, blocks and flags. Returns its centre in px. */
    freeSpotIn(r, sizeT) {
      const [x0, y0, x1, y1] = r;
      for (let k = 0; k < 50; k++) {
        const x = this.rng.int(x0 + 1, Math.max(x0 + 1, x1 - sizeT)), y = this.rng.int(y0 + 1, Math.max(y0 + 1, y1 - sizeT));
        let clear = true;
        for (let yy = y - 1; yy <= y + sizeT && clear; yy++) for (let xx = x - 1; xx <= x + sizeT; xx++) if (this.tile(xx, yy) !== FLOOR) { clear = false; break; }
        if (!clear) continue;
        const cx = this.px(x + sizeT / 2), cy = this.py(y + sizeT / 2);
        if (this.openings.some((o) => Math.hypot(this.px(o.cx + 0.5) - cx, this.py(o.cy + 0.5) - cy) < 5 * T)) continue;
        const nearRect = (b, m) => cx > b.x - m && cx < b.x + b.w + m && cy > b.y - m && cy < b.y + b.h + m;
        if (this.blocks.some((b) => nearRect(b, T * 2)) || this.flags.some((b) => nearRect(b, T * 3)) || this.spikes.some((b) => nearRect(b, T * 2)) || this.pickups.some((p) => Math.hypot(p.x - cx, p.y - cy) < T * 3)) continue;
        return [cx, cy];
      }
      return null;
    }
    /** Flood fill from the spawn: every flag must be reachable without touching spikes. Also builds the flow field. */
    validate() {
      const blocked = new Uint8Array(GW * GH);
      for (let i = 0; i < GW * GH; i++) blocked[i] = this.map[i] !== FLOOR ? 1 : 0;
      for (const sp of this.spikes) { const x0 = Math.floor((sp.x - LX) / T) - 1, y0 = Math.floor((sp.y - LY) / T) - 1, x1 = Math.ceil((sp.x + sp.w - LX) / T), y1 = Math.ceil((sp.y + sp.h - LY) / T); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < GW && y < GH) blocked[y * GW + x] = blocked[y * GW + x] || 2; }
      // a square needs ~2 tiles of clearance: shrink the passable set by one tile ring
      const pass = new Uint8Array(GW * GH);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let ok = !blocked[y * GW + x]; if (ok) { const need = this.s.size > 40 ? 1 : 0; for (let dy = -need; dy <= need && ok; dy++) for (let dx = -need; dx <= need; dx++) if (this.tile(x + dx, y + dy) !== FLOOR) { ok = false; break; } } pass[y * GW + x] = ok ? 1 : 0; }
      const dist = new Int32Array(GW * GH).fill(-1), q = [];
      for (const f of this.flags) for (let y = Math.floor((f.y - LY) / T); y < Math.ceil((f.y + f.h - LY) / T); y++) for (let x = Math.floor((f.x - LX) / T); x < Math.ceil((f.x + f.w - LX) / T); x++) if (x >= 0 && y >= 0 && x < GW && y < GH && this.map[y * GW + x] === FLOOR) { dist[y * GW + x] = 0; q.push(y * GW + x); }
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % GW, y = (i / GW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue; const j = Y * GW + X; if (!pass[j] || dist[j] >= 0) continue; dist[j] = dist[i] + 1; q.push(j); }
      }
      this.dist = dist;
      const [a, b, c, d] = this.spawnT;
      let best = -1;
      for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) { const v = dist[y * GW + x]; if (v >= 0 && (best < 0 || v > best)) best = v; }
      this.startDist = Math.max(1, best);
      // lanes: every lane pad must be reachable too
      const allFlags = this.flags.every((f) => { const x = Math.floor((f.x + f.w / 2 - LX) / T), y = Math.floor((f.y + f.h / 2 - LY) / T); return dist[y * GW + x] >= 0; });
      return best > 0 && allFlags;
    }
    placeRacers() {
      const s = this.s, [a, b, c, d] = this.spawnT, n = this.sq.length;
      if (this.laneSpawns) {
        this.sq.forEach((q, i) => {
          [q.x, q.y] = this.laneSpawns[i];
          const ang = this.rng.pick([1, 3]) * Math.PI / 4 + this.rng.range(-0.2, 0.2);
          q.vx = Math.cos(ang) * s.speed; q.vy = Math.sin(ang) * s.speed; q.sx = q.x; q.sy = q.y;
        });
        return;
      }
      const x0 = this.px(a) + s.size, x1 = this.px(c + 1) - s.size, y0 = this.py(b) + s.size, y1 = this.py(d + 1) - s.size;
      const cols = Math.min(n, Math.max(1, Math.floor((x1 - x0) / (s.size + 10)) + 1)), rows = Math.ceil(n / cols);
      this.sq.forEach((q, i) => {
        const cI = i % cols, rI = Math.floor(i / cols);
        q.x = cols > 1 ? lerp(x0, x1, cI / (cols - 1)) : (x0 + x1) / 2;
        q.y = rows > 1 ? lerp(y0, y1, rI / (rows - 1)) : (y0 + y1) / 2;
        const ang = this.rng.pick([5, 7]) * Math.PI / 4 + this.rng.range(-0.25, 0.25) + (this.layout === 'lanes' ? Math.PI : 0);
        q.vx = Math.cos(ang) * s.speed; q.vy = Math.sin(ang) * s.speed;
        q.sx = q.x; q.sy = q.y;
        if (this.solidAt(q.x - q.r, q.y - q.r, q.x + q.r, q.y + q.r)) this.unstick(q);
      });
    }
    distAt(x, y) { const X = Math.floor((x - LX) / T), Y = Math.floor((y - LY) / T); const d = (X >= 0 && Y >= 0 && X < GW && Y < GH) ? this.dist[Y * GW + X] : -1; return d < 0 ? this.startDist : d; }
    progress(q) { return q.finished ? 1 : clamp(1 - this.distAt(q.x, q.y) / this.startDist, 0, 1); }

    // ================================================================ simulation
    trailBalls() { return this.sq; }
    roster() { return this.sq.map((q) => ({ name: q.name, color: q.color })); }
    alive() { return this.sq.filter((q) => q.alive); }
    speedOf(q) { return this.s.speed * (q.boostT > 0 ? 1.55 : 1); }
    update(dt) {
      const s = this.s, g = this.g;
      const alive = this.alive();
      const lead = alive.reduce((a, q) => Math.max(a, this.progress(q)), 0);
      g.tension = clamp(0.2 + lead * 0.8, 0, 1);
      if (lead > (this.bestLead ?? -1) + 0.03) { this.bestLead = lead; this.bestLeadT = g.time; }
      if (s.assist && g.state === 'play') {
        const exp = clamp(g.time / (g.targetLen * 0.9), 0, 1), stall = g.time - (this.bestLeadT ?? 0);
        this.bias = clamp((exp - lead - 0.05) * 2.4 + clamp((stall - 5) / 8, 0, 0.6) + (g.time > g.targetLen * 0.85 ? 0.3 : 0), 0, 0.85);
      }
      const n = Math.max(1, Math.ceil(s.speed * 1.6 * dt / (T * 0.3))), h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const q of alive) { if (!q.alive || q.finished) continue; this.moveAxis(q, h, 'x'); this.moveAxis(q, h, 'y'); if (q.alive) this.touch(q); }
        for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) this.squareSquare(alive[i], alive[j]);
        for (const gh of this.ghosts) this.moveGhost(gh, h);
      }
      for (const q of this.sq) { q.flash = Math.max(0, q.flash - dt * 4); if (q.boostT > 0) { q.boostT -= dt; if (q.boostT <= 0) this.setSpeed(q); } }
      for (const b of this.blocks) b.bump = Math.max(0, b.bump - dt * 6);
      for (const d of this.doors) {
        if (!d.closed) { d.open = Math.min(1, d.open + dt * 4); continue; }
        d.t += dt;
        if (d.t > 7 || (d.owner && !d.owner.alive)) this.openDoor(d, null); // never let a door stall a run
      }
      this.updateGuns(dt);
      for (const p of this.portals) {
        p.rot += dt * (this.portalOpen(p) ? 3 : 0.6);
        if (p.openAt && !p.opened && this.portalOpen(p)) {
          p.opened = true;
          this.fx.banner('PORTAL OPEN!', '#ffffff', { size: 70, y: 0.3, dur: 1.2, sub: 'a shortcut for whoever gets there first' });
          this.fx.shockwave(p.ax, p.ay, '#ffffff', 260); this.snd.sfx('portal', 0.9, this.g.pan(p.ax));
        }
      }
      // queue paint stamps (drawn into the persistent paint layer at render)
      if (s.paint) for (const q of alive) if (!q.finished) this.paintQ.push([q.x, q.y, q.color, q.r]);
      if (this.paintQ.length > 400) this.paintQ.splice(0, this.paintQ.length - 400);
      this.updateLeader(alive);
      for (const f of this.feed) f.t += dt;
      this.feed = this.feed.filter((f) => f.t < 3.5);
      for (const b of this.bars) if (b.alive && b.owner && !b.owner.alive && !b.neutral) { b.neutral = true; b.color = '#9aa0a6'; }
    }
    setSpeed(q) { const sp = Math.hypot(q.vx, q.vy) || 1, t = this.speedOf(q); q.vx *= t / sp; q.vy *= t / sp; }
    solidAt(x0, y0, x1, y1) {
      const tx0 = Math.floor((x0 - LX) / T), tx1 = Math.floor((x1 - 0.001 - LX) / T), ty0 = Math.floor((y0 - LY) / T), ty1 = Math.floor((y1 - 0.001 - LY) / T);
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) if (this.tile(x, y) !== FLOOR) return [x, y];
      return null;
    }
    moveAxis(q, h, ax) {
      const r = q.r;
      if (ax === 'x') q.x += q.vx * h; else q.y += q.vy * h;
      let hit = false, what = 'wall';
      const t = this.solidAt(q.x - r, q.y - r, q.x + r, q.y + r);
      if (t) {
        const [tx, ty] = t;
        if (ax === 'x') { q.x = q.vx > 0 ? this.px(tx) - r - 0.01 : this.px(tx + 1) + r + 0.01; q.vx = -q.vx; }
        else { q.y = q.vy > 0 ? this.py(ty) - r - 0.01 : this.py(ty + 1) + r + 0.01; q.vy = -q.vy; }
        hit = true;
      }
      for (const b of this.blocks) if (b.alive && this.overlap(q, b)) { this.pushOut(q, b, ax); hit = true; what = 'block'; this.hitBlock(b, q); }
      for (const d of this.doors) if (d.closed && this.overlap(q, d)) { this.pushOut(q, d, ax); hit = true; what = 'door'; this.hitDoor(d, q); }
      for (const b of this.bars) {
        if (!b.alive || !this.overlap(q, b)) continue;
        if (b.neutral || b.color === q.color) this.breakBar(b, q);
        else { this.pushOut(q, b, ax); hit = true; what = 'bar'; }
      }
      if (hit) this.bounced(q, what);
    }
    overlap(q, b) { return q.x + q.r > b.x && q.x - q.r < b.x + b.w && q.y + q.r > b.y && q.y - q.r < b.y + b.h; }
    pushOut(q, b, ax) {
      if (ax === 'x') { if (q.vx > 0) q.x = b.x - q.r - 0.01; else q.x = b.x + b.w + q.r + 0.01; q.vx = -q.vx; }
      else { if (q.vy > 0) q.y = b.y - q.r - 0.01; else q.y = b.y + b.h + q.r + 0.01; q.vy = -q.vy; }
    }
    bounced(q, what) {
      const rng = this.rng;
      let a = Math.atan2(q.vy, q.vx) + rng.range(-0.14, 0.14);
      if (this.bias > 0) {
        const X = Math.floor((q.x - LX) / T), Y = Math.floor((q.y - LY) / T), d0 = this.dist[Y * GW + X];
        let bx = 0, by = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const d = this.dist[(Y + dy) * GW + X + dx]; if (d >= 0 && d0 >= 0 && d < d0) { bx += dx; by += dy; } }
        if (bx || by) a += SB.util.angleDiff(a, Math.atan2(by, bx)) * this.bias * 0.5;
      }
      let vx = Math.cos(a), vy = Math.sin(a);
      const mn = 0.36;
      if (Math.abs(vx) < mn) { vx = Math.sign(vx || 1) * mn; vy = Math.sign(vy || 1) * Math.sqrt(1 - mn * mn); }
      if (Math.abs(vy) < mn) { vy = Math.sign(vy || 1) * mn; vx = Math.sign(vx || 1) * Math.sqrt(1 - mn * mn); }
      const sp = this.speedOf(q); q.vx = vx * sp; q.vy = vy * sp;
      q.flash = 0.6;
      if (this.g.clock - q.lastHit > 0.07) {
        q.lastHit = this.g.clock;
        if (what === 'wall') this.note(0.6, q.x);
        this.fx.burst(q.x, q.y, q.color, 4, 240, { grav: 0, life: 0.5 });
      }
    }
    hitBlock(b, q) {
      if (this.g.clock - (q.lastBlock || 0) < 0.06) return;
      q.lastBlock = this.g.clock;
      const dmg = 1 + Math.floor(this.bias * 4); // pace assist: behind schedule, every hit counts more
      b.hp = Math.max(0, b.hp - dmg); b.bump = 1;
      this.note(0.75, b.x + b.w / 2, { pattern: 'climb' });
      this.snd.sfx('thud', 0.3, this.g.pan(b.x), 1.3);
      if (b.hp > 0) return;
      b.alive = false;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, big = b.big || b.wide;
      const col = b.seg ? '#d9c8ff' : '#f2f2f2';
      this.fx.debris(cx, cy, b.w, b.h, col, big ? 28 : 10, { power: big ? 1.6 : 1, size: big ? 1.6 : 1 });
      if (big) {
        this.fx.debris(cx, cy, b.w, b.h, '#bdbdbd', 16, { power: 1.3, size: 1.2 });
        this.fx.shockwave(cx, cy, '#ffffff', 420); this.fx.flare(cx, cy, '#ffffff', 900);
        this.snd.sfx('explode', 0.9, this.g.pan(cx)); this.snd.sfx('shatter', 0.5);
        this.g.shake(0.45);
        this.g.moment({ x: cx, y: cy, zoom: 1.12, slow: 0.35, dur: 0.6 });
        this.fx.banner('BLOCK SMASHED!', '#ffffff', { size: 64, y: 0.5, sub: `${q.name} landed the final hit` });
        this.pushFeed(`${q.name} smashed the block!`, q.color);
      } else {
        this.snd.sfx('crumble', 0.6, this.g.pan(cx)); this.g.shake(0.12);
        if (b.alcove) this.pushFeed(`${q.name} opened an alcove`, q.color);
      }
    }
    /** Linked colour doors: touching a door opens every door of YOUR colour (freeing someone else). */
    hitDoor(d, q) {
      if (this.g.clock - (q.lastDoor || 0) < 0.12) return;
      q.lastDoor = this.g.clock;
      if (d.color === q.color) { this.openDoor(d, q); return; }
      const c = q.color;
      this.doorCharge[c] = (this.doorCharge[c] || 0) + 1;
      this.note(0.5, d.x); this.snd.sfx('tick', 0.35, this.g.pan(d.x), 1.2);
      if (this.doorCharge[c] >= (this.doorNeed[c] || 1)) for (const o of this.doors) if (o.closed && o.color === c) this.openDoor(o, q);
    }
    doorLeft(d) { return Math.max(0, (this.doorNeed[d.color] || 1) - (this.doorCharge[d.color] || 0)); }
    openDoor(d, q) {
      d.closed = false;
      this.snd.sfx('gate', 0.7, this.g.pan(d.x)); this.note(0.8, d.x);
      this.fx.burst(d.x + d.w / 2, d.y + d.h / 2, d.color, 22, 500, { grav: 0 });
      this.fx.popup(d.x + d.w / 2, d.y - 20, 'OPEN!', d.color, 34);
      if (q && d.lane) this.pushFeed(q === d.lane ? `${q.name} broke out!` : `${q.name} freed ${d.lane.name}!`, q.color);
      else if (d.lane) this.pushFeed(`${d.lane.name}'s door timed out`, d.lane.color);
    }
    breakBar(b, q) {
      b.alive = false;
      this.fx.debris(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, b.color, 8, { power: 0.8, size: 0.8 });
      this.snd.sfx('pop', 0.55, this.g.pan(q.x), 1.1 + this.rng.range(-0.1, 0.2));
      this.note(0.7, q.x);
      if (this.bars.every((x) => !x.alive)) { this.fx.banner('BARS BROKEN!', q.color, { size: 60, y: 0.5, dur: 1 }); this.snd.sfx('gate', 0.7); }
    }
    touch(q) {
      const g = this.g;
      if (g.state !== 'play') return;
      for (const f of this.flags) if (this.overlap(q, f)) { this.finish(q); return; }
      for (const p of this.portals) {
        if (this.portalOpen(p) && Math.abs(q.x - p.ax) < p.size / 2 && Math.abs(q.y - p.ay) < p.size / 2 && g.time - (q.portalT || -9) > 1) {
          q.portalT = g.time;
          this.fx.burst(q.x, q.y, '#ffffff', 18, 500, { grav: 0 });
          q.x = p.bx; q.y = p.by; q.trail.length = 0;
          this.fx.shockwave(q.x, q.y, q.color, 180); this.snd.sfx('portal', 0.8, g.pan(q.x));
          this.fx.popup(q.x, q.y - 50, 'PORTAL!', q.color, 40); this.pushFeed(`${q.name} took the portal!`, q.color);
        }
      }
      for (const p of this.pickups) {
        if (p.taken || Math.abs(q.x - p.x) > q.r + 16 || Math.abs(q.y - p.y) > q.r + 16) continue;
        if (p.kind === 'knife') { if (q.knife) continue; q.knife = true; this.fx.popup(q.x, q.y - 50, 'KNIFE!', '#ffffff', 42); this.pushFeed(`${q.name} grabbed a KNIFE!`, q.color); this.snd.sfx('blade', 0.6, g.pan(q.x), 1.3); }
        else if (p.kind === 'gun') { if (q.gun) continue; q.gun = true; q.ammo = 5; q.gunT = 0.4; this.fx.popup(q.x, q.y - 50, 'GUN!', '#ffd23f', 44); this.pushFeed(`${q.name} picked up a GUN!`, q.color); this.snd.sfx('key', 0.7, g.pan(q.x)); this.g.moment({ x: q.x, y: q.y, zoom: 1.1, dur: 0.4 }); }
        else { q.boostT = 3; this.setSpeed(q); this.fx.popup(q.x, q.y - 50, 'BOOST!', '#7fe9ff', 40); this.snd.sfx('coin', 0.7, g.pan(q.x)); }
        p.taken = true; this.snd.sfx('pickup', 0.5, g.pan(q.x)); this.fx.burst(p.x, p.y, '#ffffff', 16, 500, { grav: 0 });
      }
      for (const gh of this.ghosts) if (this.ghostSolid(gh) && Math.abs(q.x - gh.x) < q.r + gh.r * 0.7 && Math.abs(q.y - gh.y) < q.r + gh.r * 0.7) { if (this.hazard(q, gh, 'CAUGHT BY A GHOST')) return; }
      for (const sp of this.spikes) {
        const zone = sp.kind === 'pencil' ? this.pencilTip(sp) : sp;
        if (sp.kind === 'pencil' && this.overlap(q, sp) && !this.overlapInset(q, zone, 2)) { this.solidBounce(q, sp); continue; }
        if (this.overlapInset(q, zone, sp.kind === 'pencil' ? 2 : 7)) { this.hazard(q, sp, sp.kind === 'pencil' ? 'HIT A PENCIL' : 'HIT THE SPIKES'); return; }
      }
    }
    updateGuns(dt) {
      const g = this.g;
      for (const q of this.sq) {
        if (!q.alive || !q.gun || q.finished) continue;
        q.gunT -= dt;
        if (q.gunT > 0) continue;
        q.gunT = 0.75;
        let best = null, bd = 1e9;
        for (const o of this.sq) if (o !== q && o.alive && !o.finished) { const d = Math.hypot(o.x - q.x, o.y - q.y); if (d < bd) { bd = d; best = o; } }
        if (!best || bd > 700) continue;
        const a = Math.atan2(best.y - q.y, best.x - q.x);
        this.bullets.push({ x: q.x + Math.cos(a) * (q.r + 8), y: q.y + Math.sin(a) * (q.r + 8), vx: Math.cos(a) * 1000, vy: Math.sin(a) * 1000, owner: q, life: 1.2 });
        q.ammo--; this.snd.sfx('zap', 0.6, g.pan(q.x), 0.8); this.fx.flare(q.x + Math.cos(a) * (q.r + 12), q.y + Math.sin(a) * (q.r + 12), '#ffd23f', 200);
        if (q.ammo <= 0) { q.gun = false; this.pushFeed(`${q.name} is out of ammo`, q.color); }
      }
      for (const b of this.bullets) {
        for (let k = 0; k < 4 && b.life > 0; k++) {
          b.x += b.vx * dt / 4; b.y += b.vy * dt / 4;
          if (this.solidAt(b.x - 3, b.y - 3, b.x + 3, b.y + 3) || this.blocks.some((bl) => bl.alive && b.x > bl.x && b.x < bl.x + bl.w && b.y > bl.y && b.y < bl.y + bl.h)) { b.life = 0; this.fx.burst(b.x, b.y, '#ffd23f', 5, 200, { grav: 0 }); break; }
          for (const o of this.sq) if (o !== b.owner && o.alive && !o.finished && Math.abs(o.x - b.x) < o.r && Math.abs(o.y - b.y) < o.r && g.state === 'play') { b.life = 0; this.caught(o, `SHOT BY ${b.owner.name}`); break; }
        }
        b.life -= dt;
      }
      this.bullets = this.bullets.filter((b) => b.life > 0);
    }
    /** Hazard contact: eliminations are spaced out; inside the gap the square deflects with a close call. */
    hazard(q, obj, why) {
      const g = this.g, gap = g.targetLen * 0.3, first = g.targetLen * 0.15;
      const hazardKills = this.sq.filter((x) => !x.alive && x.byHazard).length;
      const allowed = this.s.hazardRule === 'restart' || (g.time > first && g.time - (this.lastKill ?? -99) > gap && hazardKills < this.sq.length - 2);
      if (allowed) q.byHazard = true;
      if (allowed) { this.caught(q, why); return true; }
      if (g.clock - (q.closeT || 0) > 0.8) { q.closeT = g.clock; this.fx.popup(q.x, q.y - 50, 'CLOSE CALL!', '#ffd23f', 36); this.snd.sfx('whoosh', 0.45, g.pan(q.x), 1.3); q.flash = 1; }
      if (obj.w !== undefined) this.solidBounce(q, obj);
      else { const dx = q.x - obj.x, dy = q.y - obj.y; if (Math.abs(dx) > Math.abs(dy)) q.vx = Math.sign(dx) * Math.abs(q.vx); else q.vy = Math.sign(dy) * Math.abs(q.vy); }
      return false;
    }
    /** Bounce off an entity rect along the shallower overlap axis. */
    solidBounce(q, b) {
      const ox = Math.min(q.x + q.r - b.x, b.x + b.w - (q.x - q.r)), oy = Math.min(q.y + q.r - b.y, b.y + b.h - (q.y - q.r));
      if (ox < oy) { if (q.x < b.x + b.w / 2) { q.x = b.x - q.r - 0.01; q.vx = -Math.abs(q.vx); } else { q.x = b.x + b.w + q.r + 0.01; q.vx = Math.abs(q.vx); } }
      else { if (q.y < b.y + b.h / 2) { q.y = b.y - q.r - 0.01; q.vy = -Math.abs(q.vy); } else { q.y = b.y + b.h + q.r + 0.01; q.vy = Math.abs(q.vy); } }
      if (this.solidAt(q.x - q.r, q.y - q.r, q.x + q.r, q.y + q.r)) this.unstick(q);
    }
    pencilTip(sp) { const tw = sp.h * 0.9; return sp.dir === 'left' ? { x: sp.x, y: sp.y + sp.h * 0.25, w: tw, h: sp.h * 0.5 } : { x: sp.x + sp.w - tw, y: sp.y + sp.h * 0.25, w: tw, h: sp.h * 0.5 }; }
    overlapInset(q, b, m) { return q.x + q.r > b.x + m && q.x - q.r < b.x + b.w - m && q.y + q.r > b.y + m && q.y - q.r < b.y + b.h - m; }
    caught(q, why) {
      const g = this.g;
      this.fx.burst(q.x, q.y, q.color, 50, 900, { colors: [q.color, '#ffffff'] });
      this.fx.debris(q.x, q.y, q.r * 2, q.r * 2, q.color, 10, { power: 1.2 });
      this.fx.shockwave(q.x, q.y, q.color, 240);
      g.shake(0.4);
      if (this.s.hazardRule === 'restart') {
        this.snd.sfx('boing', 0.8, g.pan(q.x), 0.8);
        q.x = q.sx; q.y = q.sy; q.trail.length = 0; q.knife = false;
        this.fx.popup(q.x, q.y - 50, 'BACK TO START!', q.color, 40);
        this.pushFeed(`${q.name} ${why.toLowerCase()} — back to start`, q.color);
        return;
      }
      q.alive = false; q.status = why; q.knife = false; q.gun = false;
      this.lastKill = g.time;
      this.snd.sfx('elim', 1, g.pan(q.x));
      g.moment({ x: q.x, y: q.y, zoom: 1.15, slow: 0.35, dur: 0.55 });
      this.pushFeed(`${q.name} ${why.toLowerCase()}`, q.color);
      const left = this.alive();
      if (left.length === 1) { const w = left[0]; g.win({ title: `${w.name} WINS!`, sub: 'last square alive', color: w.color, y: 820, fx: w.x, fy: w.y }); }
      else if (left.length > 1) this.fx.banner(`${q.name} IS OUT!`, q.color, { size: 70, y: 0.5, sub: `${left.length} left`, dur: 1.2 });
    }
    finish(q) {
      q.finished = true;
      const second = this.alive().filter((x) => x !== q).sort((a, b) => this.progress(b) - this.progress(a))[0];
      const photo = second && this.progress(second) > 0.93;
      this.fx.confetti(q.x, q.y, 80, this.sq.map((x) => x.color), { power: 0.9 });
      this.g.win({ title: `${q.name} WINS!`, sub: photo ? `photo finish over ${second.name}!` : `first to the flag · ${SB.util.fmtTime(this.g.time)}`, color: q.color, y: 820, fx: q.x, fy: q.y, zoom: photo ? 1.2 : 1.12 });
    }
    squareSquare(a, b) {
      if (!a.alive || !b.alive || a.finished || b.finished) return;
      const dx = b.x - a.x, dy = b.y - a.y, S = a.r + b.r;
      if (Math.abs(dx) >= S || Math.abs(dy) >= S) return;
      if ((a.knife || b.knife) && this.g.state === 'play') {
        if (a.knife && b.knife) { a.knife = b.knife = false; this.snd.sfx('clang', 0.9, this.g.pan(a.x)); this.fx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffffff', 30, 900); this.pushFeed('Knives clash — both break!', '#ffffff'); }
        else {
          const killer = a.knife ? a : b, victim = a.knife ? b : a, g = this.g;
          const lastBlow = this.alive().length <= 2;
          const ok = g.time - (this.lastKill ?? -99) > g.targetLen * 0.15 && (!lastBlow || g.time > g.targetLen * 0.6);
          if (ok) { killer.knife = false; this.fx.flare(victim.x, victim.y, '#ffffff', 800); this.snd.sfx('blade', 0.9, g.pan(victim.x)); g.hitstop(0.06); this.caught(victim, `SLICED BY ${killer.name}`); if (!victim.alive) return; }
          else if (g.clock - (victim.closeT || 0) > 0.8) { victim.closeT = g.clock; this.fx.popup(victim.x, victim.y - 50, 'DODGED!', '#ffd23f', 36); this.snd.sfx('clang', 0.6, g.pan(victim.x), 1.3); }
        }
      }
      const ox = S - Math.abs(dx), oy = S - Math.abs(dy);
      if (ox < oy) { const sx = Math.sign(dx) || 1; a.x -= sx * ox / 2; b.x += sx * ox / 2; if ((b.vx - a.vx) * sx < 0) { const t = a.vx; a.vx = b.vx; b.vx = t; } }
      else { const sy = Math.sign(dy) || 1; a.y -= sy * oy / 2; b.y += sy * oy / 2; if ((b.vy - a.vy) * sy < 0) { const t = a.vy; a.vy = b.vy; b.vy = t; } }
      for (const q of [a, b]) if (this.solidAt(q.x - q.r, q.y - q.r, q.x + q.r, q.y + q.r)) this.unstick(q);
      if (this.g.clock - (a.bumpT || 0) > 0.12) { a.bumpT = this.g.clock; this.note(0.45, a.x); a.flash = b.flash = 0.5; }
    }
    unstick(q) {
      for (let d = 1; d <= 60; d++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        if (!this.solidAt(q.x + dx * d - q.r, q.y + dy * d - q.r, q.x + dx * d + q.r, q.y + dy * d + q.r)) { q.x += dx * d; q.y += dy * d; return; }
      }
    }
    /** Ghosts fade out for part of their cycle — harmless while faded (squares can slip past). */
    ghostPhase(gh) { const c = (gh.t % gh.period) / gh.period; return c < 0.55 ? 1 : c < 0.62 ? 1 - (c - 0.55) / 0.07 : c < 0.93 ? 0 : (c - 0.93) / 0.07; }
    ghostSolid(gh) { return this.ghostPhase(gh) > 0.6; }
    moveGhost(gh, h) {
      gh.t += h; gh.x += gh.vx * h; gh.y += gh.vy * h;
      const [x0, y0, x1, y1] = gh.box;
      if (gh.x < x0 + gh.r) { gh.x = x0 + gh.r; gh.vx = Math.abs(gh.vx); }
      if (gh.x > x1 - gh.r) { gh.x = x1 - gh.r; gh.vx = -Math.abs(gh.vx); }
      if (gh.y < y0 + gh.r) { gh.y = y0 + gh.r; gh.vy = Math.abs(gh.vy); }
      if (gh.y > y1 - gh.r) { gh.y = y1 - gh.r; gh.vy = -Math.abs(gh.vy); }
    }
    updateLeader(alive) {
      const sorted = alive.slice().sort((a, b) => this.progress(b) - this.progress(a));
      sorted.forEach((q, i) => (q.place = i));
      const L = sorted[0];
      if (L && L !== this.leader) {
        if (this.leader && this.g.time - this.leaderT > 2.5 && this.g.time > 3 && this.g.state === 'play') { this.fx.popup(L.x, L.y - 50, 'NEW LEADER!', L.color, 36); this.snd.sfx('whoosh', 0.35, this.g.pan(L.x)); this.leaderT = this.g.time; }
        this.leader = L;
      }
    }
    pushFeed(text, color) { this.feed.push({ text, color, t: 0 }); if (this.feed.length > 3) this.feed.shift(); }
    forceEnd() { for (const b of this.blocks) if (b.alive) b.hp = Math.max(0, b.hp - 1); this.bias = 0.9; for (const b of this.bars) b.neutral = true; }
    audit() {
      const v = [];
      for (const q of this.alive()) if (!q.finished && this.solidAt(q.x - q.r + 1, q.y - q.r + 1, q.x + q.r - 1, q.y + q.r - 1)) { v.push('square inside wall'); break; }
      return v;
    }
    stats() { return { layout: this.layout, alive: this.alive().map((q) => q.name + '@' + Math.round(this.progress(q) * 100)), dead: this.sq.filter((q) => !q.alive).map((q) => q.name + ':' + q.status) }; }

    // ================================================================ rendering
    theme() {
      if (this.toy) return this.layout === 'gauntlet' ? Object.assign({}, THEMES.gauntlet, { wall: this.skin.wall, fill: this.skin.wall, edge: this.skin.edge, fillEdge: this.skin.edge, chk: this.skin.chk }) : THEMES[this.layout];
      const p = this.pal;
      return { floor: mix(p.bg[1], '#ffffff', p.light ? 0.6 : 0.1), floor2: mix(p.bg[1], '#ffffff', p.light ? 0.5 : 0.06), wall: p.accent, edge: darken(p.accent, 0.45), fill: mix(p.bg[0], p.grad[3] || p.accent, 0.35), fillEdge: darken(p.bg[0], 0.3), chk: null };
    }
    buildCache() {
      const k = this.g.k, c = document.createElement('canvas'); c.width = Math.round(1080 * k); c.height = Math.round(1920 * k);
      const g = c.getContext('2d'); g.scale(k, k);
      const P = this.theme();
      if (P.chk) for (let y = 0; y < 1920; y += 60) for (let x = 0; x < 1080; x += 60) { g.fillStyle = ((x + y) / 60) % 2 ? P.chk[0] : P.chk[1]; g.fillRect(x, y, 60, 60); }
      // outer frame of the level
      g.fillStyle = P.edge; g.fillRect(LX - 8, LY - 8, GW * T + 16, GH * T + 16);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const t = this.map[y * GW + x], X = LX + x * T, Y = LY + y * T;
        g.fillStyle = t === FLOOR ? ((x + y) % 2 ? P.floor : P.floor2) : t === WALL ? P.wall : P.fill;
        g.fillRect(X, Y, T, T);
      }
      // dark outline where solid meets floor
      g.fillStyle = P.edge;
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        if (this.map[y * GW + x] === FLOOR) continue;
        const X = LX + x * T, Y = LY + y * T;
        if (this.tile(x, y - 1) === FLOOR) g.fillRect(X, Y, T, 3);
        if (this.tile(x, y + 1) === FLOOR) g.fillRect(X, Y + T - 3, T, 3);
        if (this.tile(x - 1, y) === FLOOR) g.fillRect(X, Y, 3, T);
        if (this.tile(x + 1, y) === FLOOR) g.fillRect(X + T - 3, Y, 3, T);
      }
      for (const f of this.flags) {
        const sq = 12;
        for (let y = f.y, r = 0; y < f.y + f.h; y += sq, r++) for (let x = f.x, cI = 0; x < f.x + f.w; x += sq, cI++) { g.fillStyle = (r + cI) % 2 ? '#111111' : '#ffffff'; g.fillRect(x, y, Math.min(sq, f.x + f.w - x), Math.min(sq, f.y + f.h - y)); }
        g.strokeStyle = '#1fbf3a'; g.lineWidth = 5; g.strokeRect(f.x + 2, f.y + 2, f.w - 4, f.h - 4);
      }
      this.cache = c;
      this.paintCv = document.createElement('canvas'); this.paintCv.width = c.width; this.paintCv.height = c.height;
    }
    render(ctx) {
      if (!this.cache) this.buildCache();
      const t = this.g.clock;
      ctx.drawImage(this.cache, 0, 0, 1080, 1920);
      // persistent paint trails
      if (this.paintQ.length) {
        const pg = this.paintCv.getContext('2d'), k = this.g.k;
        pg.setTransform(k, 0, 0, k, 0, 0); pg.globalAlpha = 0.16;
        for (const [x, y, c, r] of this.paintQ) { pg.fillStyle = c; pg.fillRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6); }
        this.paintQ.length = 0;
      }
      if (this.s.paint) ctx.drawImage(this.paintCv, 0, 0, 1080, 1920);
      for (const sp of this.spikes) this.drawSpike(ctx, sp);
      for (const d of this.doors) {
        if (d.open >= 1) continue;
        const k = 1 - d.open, h = d.h * k;
        ctx.fillStyle = '#111'; ctx.fillRect(d.x - 2, d.y - 2, d.w + 4, h + 4);
        ctx.fillStyle = d.color; ctx.fillRect(d.x, d.y, d.w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(d.x + 3, d.y + 3, 4, Math.max(0, h - 6));
        if (d.closed && this.doorNeed) draw.label(ctx, String(this.doorLeft(d)), d.x + d.w / 2, d.y + d.h / 2 + 10, 28, '#ffffff', 900, 0.25);
      }
      ctx.fillStyle = '#ffd23f';
      for (const b of this.bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, TAU); ctx.fill(); }
      for (const b of this.bars) if (b.alive) { ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.fillStyle = 'rgba(255,255,255,0.35)'; if (b.w < b.h) ctx.fillRect(b.x, b.y, 2, b.h); else ctx.fillRect(b.x, b.y, b.w, 2); }
      for (const p of this.portals) {
        const open = this.portalOpen(p);
        this.drawSpiral(ctx, p.ax, p.ay, p.size, p.rot, open ? 1 : 0.4); this.drawSpiral(ctx, p.bx, p.by, p.size * 0.8, -p.rot, open ? 0.55 : 0.25);
        if (!open) draw.label(ctx, String(Math.ceil(this.g.targetLen * p.openAt - this.g.time)), p.ax, p.ay + 12, 30, '#ffffff', 900, 0.25);
      }
      for (const b of this.blocks) if (b.alive) this.drawBlock(ctx, b);
      for (const p of this.pickups) if (!p.taken) this.drawPickup(ctx, p, t);
      for (const gh of this.ghosts) this.drawGhost(ctx, gh, t);
      if (this.look.trails) for (const q of this.sq) if (q.alive && q.trail.length > 1) {
        for (let i = 0; i < q.trail.length; i++) { const [x, y] = q.trail[i], kk = i / q.trail.length; ctx.globalAlpha = 0.2 * kk; ctx.fillStyle = q.color; const s = q.r * 2 * (0.5 + 0.5 * kk); ctx.fillRect(x - s / 2, y - s / 2, s, s); }
        ctx.globalAlpha = 1;
      }
      for (const q of this.sq) if (q.alive) this.drawSquare(ctx, q, t);
      if (this.leader && this.leader.alive) draw.crown(ctx, this.leader.x, this.leader.y - this.leader.r - 22, 0.28);
    }
    drawSquare(ctx, q, t) {
      const s = q.r * 2, x = q.x - q.r, y = q.y - q.r;
      if (!this.look.light && this.look.glow > 0 && !this.toy) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, q.x, q.y, s * 3, q.color, 0.35); ctx.globalCompositeOperation = 'source-over'; }
      if (q.boostT > 0) { ctx.globalAlpha = 0.5; ctx.strokeStyle = '#7fe9ff'; ctx.lineWidth = 4; ctx.strokeRect(x - 8, y - 8, s + 16, s + 16); ctx.globalAlpha = 1; }
      ctx.fillStyle = '#111111'; ctx.fillRect(x - 3, y - 3, s + 6, s + 6);
      ctx.fillStyle = q.flash > 0.05 ? mix(q.color, '#ffffff', q.flash * 0.5) : q.color; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y, s, s * 0.18);
      const ew = s * 0.27, eh = s * 0.34, lx = Math.sign(q.vx) * s * 0.06, ly = Math.sign(q.vy) * s * 0.05;
      const blink = ((t + q.blink) % 3.2) < 0.12 ? 0.2 : 1;
      for (const ex of [q.x - s * 0.2, q.x + s * 0.2]) {
        ctx.fillStyle = '#111111'; ctx.fillRect(ex - ew / 2 - 2, q.y - s * 0.12 - eh / 2 - 2, ew + 4, eh * blink + 4);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(ex - ew / 2, q.y - s * 0.12 - eh / 2, ew, eh * blink);
        if (blink === 1) { ctx.fillStyle = '#111111'; ctx.fillRect(ex - ew * 0.22 + lx, q.y - s * 0.12 - eh * 0.1 + ly, ew * 0.44, eh * 0.5); }
      }
      if (q.knife) this.drawKnife(ctx, q.x + Math.cos(t * 7) * (q.r + 18), q.y + Math.sin(t * 7) * (q.r + 18), t * 7 + Math.PI / 2, 0.8);
      if (q.gun) this.drawGun(ctx, q.x + q.r + 14, q.y - q.r * 0.2, 0.55);
    }
    drawBlock(ctx, b) {
      const s = 1 + b.bump * 0.05, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
      const bev = Math.min(b.w, b.h) * 0.12, low = b.hp / b.max;
      const face = b.seg ? '#e7dcff' : mix('#e4e4e4', '#ffb3b3', 1 - low), hi = b.seg ? '#ffffff' : '#ffffff', lo = b.seg ? '#8f7ac8' : '#5a5a5a';
      ctx.fillStyle = '#9b9b9b'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = hi; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w - bev, b.y + bev); ctx.lineTo(b.x + bev, b.y + bev); ctx.lineTo(b.x + bev, b.y + b.h - bev); ctx.lineTo(b.x, b.y + b.h); ctx.fill();
      ctx.fillStyle = lo; ctx.beginPath(); ctx.moveTo(b.x + b.w, b.y + b.h); ctx.lineTo(b.x, b.y + b.h); ctx.lineTo(b.x + bev, b.y + b.h - bev); ctx.lineTo(b.x + b.w - bev, b.y + b.h - bev); ctx.lineTo(b.x + b.w - bev, b.y + bev); ctx.lineTo(b.x + b.w, b.y); ctx.fill();
      ctx.fillStyle = face; ctx.fillRect(b.x + bev, b.y + bev, b.w - bev * 2, b.h - bev * 2);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (b.big) {
        ctx.strokeStyle = 'rgba(60,60,60,0.55)'; ctx.lineWidth = 3;
        if (low < 0.66) { ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.2, b.y + bev); ctx.lineTo(b.x + b.w * 0.35, b.y + b.h * 0.4); ctx.lineTo(b.x + b.w * 0.28, b.y + b.h * 0.6); ctx.stroke(); }
        if (low < 0.33) { ctx.beginPath(); ctx.moveTo(b.x + b.w - bev, b.y + b.h * 0.3); ctx.lineTo(b.x + b.w * 0.62, b.y + b.h * 0.55); ctx.lineTo(b.x + b.w * 0.7, b.y + b.h - bev); ctx.stroke(); }
      }
      if (!b.seg || b.hp > 1) {
        const txt = String(b.hp); const size = Math.min(b.h * 0.62, b.w * (txt.length > 2 ? 0.34 : 0.44));
        draw.font(ctx, size, 900); ctx.textAlign = 'center';
        ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.14; ctx.strokeStyle = b.big ? '#8a8a8a' : '#2a2a2a'; ctx.strokeText(txt, cx, cy + size * 0.36);
        ctx.fillStyle = b.big ? '#ffffff' : '#111111'; if (!b.big) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size * 0.1; ctx.strokeText(txt, cx, cy + size * 0.36); }
        ctx.fillText(txt, cx, cy + size * 0.36); ctx.textAlign = 'left';
      }
      ctx.restore();
    }
    drawSpike(ctx, sp) {
      if (sp.kind === 'pencil') {
        // yellow pencil pointing left/right
        const left = sp.dir === 'left', tip = sp.h * 0.9, y = sp.y + sp.h * 0.2, h = sp.h * 0.6;
        const x0 = sp.x, x1 = sp.x + sp.w;
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(left ? x0 + tip : x0, y, sp.w - tip, h);
        ctx.fillStyle = '#e8a33a'; ctx.fillRect(left ? x0 + tip : x0, y + h * 0.66, sp.w - tip, h * 0.34);
        ctx.fillStyle = '#e9c49a'; ctx.beginPath();
        if (left) { ctx.moveTo(x0 + tip, y); ctx.lineTo(x0, y + h / 2); ctx.lineTo(x0 + tip, y + h); } else { ctx.moveTo(x1 - tip, y); ctx.lineTo(x1, y + h / 2); ctx.lineTo(x1 - tip, y + h); }
        ctx.fill();
        ctx.fillStyle = '#333'; ctx.beginPath(); if (left) { ctx.moveTo(x0 + tip * 0.4, y + h * 0.3); ctx.lineTo(x0, y + h / 2); ctx.lineTo(x0 + tip * 0.4, y + h * 0.7); } else { ctx.moveTo(x1 - tip * 0.4, y + h * 0.3); ctx.lineTo(x1, y + h / 2); ctx.lineTo(x1 - tip * 0.4, y + h * 0.7); } ctx.fill();
        return;
      }
      ctx.fillStyle = '#c4165b'; ctx.strokeStyle = '#4a0620'; ctx.lineWidth = 2;
      const n = sp.dir === 'all' ? 1 : Math.max(1, Math.round((sp.dir === 'left' || sp.dir === 'right' ? sp.h : sp.w) / T));
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        if (sp.dir === 'right' || sp.dir === 'left') {
          const y0 = sp.y + i * T, base = sp.dir === 'right' ? sp.x : sp.x + sp.w, tipX = sp.dir === 'right' ? sp.x + sp.w : sp.x;
          ctx.moveTo(base, y0 + 2); ctx.lineTo(tipX, y0 + T / 2); ctx.lineTo(base, y0 + T - 2);
        } else if (sp.dir === 'up' || sp.dir === 'down') {
          const x0 = sp.x + i * T, base = sp.dir === 'down' ? sp.y : sp.y + sp.h, tipY = sp.dir === 'down' ? sp.y + sp.h : sp.y;
          ctx.moveTo(x0 + 2, base); ctx.lineTo(x0 + T / 2, tipY); ctx.lineTo(x0 + T - 2, base);
        } else {
          const cx = sp.x + sp.w / 2, cy = sp.y + sp.h / 2, r = Math.min(sp.w, sp.h) / 2;
          for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, rr = k % 2 ? r * 0.45 : r; k ? ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    portalOpen(p) { return !p.openAt || this.g.time >= this.g.targetLen * p.openAt; }
    drawSpiral(ctx, x, y, size, rot, a) {
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.strokeStyle = '#111111'; ctx.lineWidth = 3; ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.beginPath(); ctx.rect(-size / 2, -size / 2, size, size); ctx.clip();
      ctx.rotate(rot); ctx.strokeStyle = '#111111'; ctx.lineWidth = size * 0.07; ctx.beginPath();
      for (let i = 0; i < 90; i++) { const th = i * 0.28, r = th * size * 0.035; i ? ctx.lineTo(Math.cos(th) * r, Math.sin(th) * r) : ctx.moveTo(0, 0); }
      ctx.stroke(); ctx.restore();
    }
    drawPickup(ctx, p, t) {
      const bob = Math.sin(t * 3 + p.x) * 5;
      if (p.kind === 'knife') this.drawKnife(ctx, p.x, p.y + bob, -0.6, 1.3, true);
      else if (p.kind === 'gun') this.drawGun(ctx, p.x, p.y + bob, 1.1);
      else { const s = 22; ctx.fillStyle = '#111'; ctx.fillRect(p.x - s / 2 - 2, p.y + bob - s / 2 - 2, s + 4, s + 4); ctx.fillStyle = '#9feaff'; ctx.fillRect(p.x - s / 2, p.y + bob - s / 2, s, s); ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x - s / 4, p.y + bob - s / 4, s / 2, s / 2); }
    }
    drawKnife(ctx, x, y, a, s, glow) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
      if (glow && !this.look.light && !this.toy) draw.glow(ctx, 0, 0, 120, '#ffffff', 0.4);
      ctx.fillStyle = '#eef2ff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -30); ctx.quadraticCurveTo(10, -8, 7, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#222'; draw.roundRect(ctx, -5, 6, 11, 18, 3); ctx.fill();
      ctx.restore();
    }
    drawGun(ctx, x, y, s) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(-40, -8, 70, 12); ctx.fillRect(30, -6, 22, 5); ctx.fillRect(-52, -10, 16, 20);
      ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(4, 4); ctx.lineTo(10, 22); ctx.lineTo(2, 24); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-26, 4); ctx.lineTo(-16, 4); ctx.lineTo(-20, 18); ctx.lineTo(-30, 16); ctx.fill();
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-52, -6, 14, 12);
      ctx.restore();
    }
    drawGhost(ctx, gh, t) {
      const r = gh.r, x = gh.x, y = gh.y + Math.sin(t * 3 + gh.t) * 4;
      const ph = this.ghostPhase(gh);
      ctx.save(); ctx.globalAlpha = 0.2 + 0.72 * ph;
      if (!this.look.light && !this.toy) { ctx.globalCompositeOperation = 'lighter'; draw.glow(ctx, x, y, r * 4, '#9ff6ff', 0.35 * ph); ctx.globalCompositeOperation = 'source-over'; }
      ctx.fillStyle = '#c9fbff'; ctx.strokeStyle = '#5ab9c9'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y - r * 0.1, r, Math.PI, 0);
      for (let i = 0; i <= 4; i++) { const px = x + r - (i / 4) * r * 2, py = y + r * 0.8 + (i % 2 ? -8 : 0) + Math.sin(t * 8 + i) * 3; ctx.lineTo(px, py); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b3a44';
      ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.2, r * 0.14, r * 0.2, 0, 0, TAU); ctx.ellipse(x + r * 0.35, y - r * 0.2, r * 0.14, r * 0.2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y + r * 0.2, r * 0.18, 0, Math.PI); ctx.fill();
      ctx.restore();
    }
    hud(ctx) {
      const pal = this.pal, W = this.W, n = this.sq.length;
      const order = this.sq.slice().sort((a, b) => (b.alive - a.alive) || (a.alive ? a.place - b.place : 0));
      const cw = Math.min(250, (W - 40) / n - 8), x0 = W / 2 - (cw * n + 8 * (n - 1)) / 2, y0 = 280;
      order.forEach((q, i) => {
        const x = x0 + i * (cw + 8);
        ctx.globalAlpha = q.alive ? 1 : 0.5;
        draw.panel(ctx, x, y0, cw, 98, 18, this.look, 0.72);
        ctx.fillStyle = '#111'; ctx.fillRect(x + 12, y0 + 16, 38, 38); ctx.fillStyle = q.color; ctx.fillRect(x + 15, y0 + 19, 32, 32);
        draw.font(ctx, 20, 900); ctx.fillStyle = pal.light ? pal.text : '#ffffff';
        ctx.fillText(q.alive ? (i + 1) + (['ST', 'ND', 'RD'][i] || 'TH') : '✕', x + 58, y0 + 34);
        let fs = cw > 200 ? 24 : 20; draw.font(ctx, fs, 900); while (ctx.measureText(q.name).width > cw - 70 && fs > 13) { fs--; draw.font(ctx, fs, 900); }
        ctx.fillStyle = q.color === '#ffd426' && pal.light ? darken(q.color, 0.3) : q.color; ctx.fillText(q.name, x + 58, y0 + 58);
        draw.font(ctx, 18, 700, 'Space Grotesk'); ctx.fillStyle = q.alive ? (pal.light ? rgba(pal.text, 0.7) : 'rgba(255,255,255,0.75)') : '#ff5a70';
        const st = q.alive ? Math.round(this.progress(q) * 100) + '% there' + (q.knife ? ' · 🔪' : '') : q.status;
        ctx.fillText(st.length > 20 ? st.slice(0, 19) + '…' : st, x + 14, y0 + 85);
        ctx.globalAlpha = 1;
      });
      const feed = this.feed.slice(-2);
      feed.forEach((f, i) => {
        const a = f.t < 0.2 ? f.t / 0.2 : f.t > 2.9 ? (3.5 - f.t) / 0.6 : 1;
        ctx.globalAlpha = a; draw.label(ctx, f.text, W / 2, 440 - (feed.length - 1 - i) * 30, 23, f.color, 700, 0.25); ctx.globalAlpha = 1;
      });
    }
  }

  SB.modes.register({
    id: 'squares', name: 'Square Escape', icon: '■', category: 'Survival', tagline: 'Eyed squares race a random level — first to the flag or last alive',
    hook: 'Which square *escapes?*',
    hookY: 160,
    settings: [
      { key: 'layout', label: 'Level layout', type: 'select', def: 'random', options: [['random', 'Random each run'], ['gauntlet', 'Gauntlet (start stalls + doors)'], ['circuit', 'Circuit (rooms)'], ['tower', 'Tower climb'], ['lanes', 'Lanes'], ['stairs', 'Staircase']], rand: ['random'] },
      { key: 'squares', label: 'Squares', type: 'range', min: 2, max: 6, step: 1, def: 4, rand: [3, 5] },
      { key: 'rooms', label: 'Level length', type: 'range', min: 3, max: 15, step: 1, def: 8, rand: [6, 11], show: (s) => s.layout !== 'lanes' },
      { key: 'blockHp', label: 'Number block hits (0 = none)', type: 'range', min: 0, max: 400, step: 5, def: 45, rand: [30, 120] },
      { key: 'bars', label: 'Colour bars (circuit)', type: 'range', min: 0, max: 16, step: 1, def: 8, rand: [4, 12], show: (s) => s.layout === 'circuit' || s.layout === 'random' },
      { key: 'ghosts', label: 'Ghosts', type: 'range', min: 0, max: 4, step: 1, def: 1, rand: [0, 2], show: (s) => s.layout !== 'tower' && s.layout !== 'lanes' },
      { key: 'hazards', label: 'Spikes & pencils', type: 'range', min: 0, max: 10, step: 1, def: 3, rand: [1, 6] },
      { key: 'knives', label: 'Knives', type: 'range', min: 0, max: 3, step: 1, def: 1, rand: [0, 2] },
      { key: 'guns', label: 'Guns', type: 'range', min: 0, max: 2, step: 1, def: 0, rand: [0, 1] },
      { key: 'boosts', label: 'Speed boosts', type: 'range', min: 0, max: 4, step: 1, def: 1, rand: [0, 3] },
      { key: 'hazardRule', label: 'Ghosts, spikes & knives', type: 'select', def: 'eliminate', options: [['eliminate', 'Eliminate (last alive wins)'], ['restart', 'Send back to start']] },
      { key: 'portals', label: 'Spiral portal shortcut', type: 'toggle', def: true, show: (s) => s.layout === 'circuit' || s.layout === 'gauntlet' || s.layout === 'random' },
      { key: 'paint', label: 'Paint trails', type: 'toggle', def: true },
      { key: 'speed', label: 'Speed', type: 'range', min: 200, max: 1100, step: 10, def: 480, rand: [420, 620] },
      { key: 'size', label: 'Square size', type: 'range', min: 20, max: 44, step: 1, def: 34, rand: [30, 40] },
      { key: 'style', label: 'Style', type: 'select', def: 'toy', options: [['toy', 'Toy (flat colours)'], ['palette', 'Palette colours']], rand: ['toy', 'toy', 'palette'] },
      { key: 'pace', label: 'Race length', type: 'select', def: 'long', options: [['long', 'Long (natural, 1–3 min)'], ['target', 'Match target length']], rand: false },
      { key: 'assist', label: 'Pace assist (steers when a race stalls)', type: 'toggle', def: true, rand: false },
    ],
    longForm: true,
    presets: [
      { name: 'Random Level', s: {} },
      { name: 'Circuit (13 rooms)', s: { layout: 'circuit', rooms: 13, blockHp: 140, ghosts: 2 } },
      { name: 'Gauntlet (linked doors)', s: { layout: 'gauntlet', rooms: 9, blockHp: 80, knives: 1 } },
      { name: 'Gauntlet + Gun', s: { layout: 'gauntlet', rooms: 10, guns: 1, knives: 1, hazards: 5 } },
      { name: 'Tower Climb', s: { layout: 'tower', rooms: 8, blockHp: 60, knives: 2 } },
      { name: 'Lanes + Knife', s: { layout: 'lanes', knives: 1, ghosts: 1, hazards: 4 } },
      { name: 'Pencil Staircase', s: { layout: 'stairs', rooms: 9, hazards: 8, ghosts: 0 } },
      { name: 'Block Buster (300 hits)', s: { layout: 'circuit', rooms: 7, blockHp: 300, bars: 0, ghosts: 0 } },
      { name: 'No Deaths (back to start)', s: { hazardRule: 'restart', ghosts: 2, hazards: 6 } },
      { name: 'Neon Squares', s: { style: 'palette' }, look: { palette: 'vapor', bg: 'grid' }, sound: { theme: 'chip', pattern: 'climb', backing: 'full' } },
    ],
    create: (g, s) => new Squares(g, s),
  });
})(window.SB);
