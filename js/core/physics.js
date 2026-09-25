/* SatisBall — 2D circle physics.
 *
 * Design rules that keep things solid:
 *  - Fixed 240 Hz step from the Game, plus adaptive sub-steps per mode (substeps()) so no ball moves
 *    more than ~40% of its radius per sub-step -> no tunnelling even at extreme speeds.
 *  - Every contact query fills a shared contact record C (no allocation in the hot loop).
 *  - Moving/rotating walls pass their surface velocity so bounces off spinning rings are correct.
 *  - lockEnergy() removes integration drift for perpetual bouncers (energy only changes on purpose).
 */
'use strict';
(function (SB) {
  const { TAU, normAngle, clamp } = SB.util;
  const C = { nx: 0, ny: 0, depth: 0, px: 0, py: 0 };

  class Ball {
    constructor(x, y, r, o = {}) {
      this.x = x; this.y = y; this.vx = o.vx || 0; this.vy = o.vy || 0;
      this.r = r; this.m = o.m || r * r; this.e = o.e ?? 1;
      this.color = o.color || '#ffffff'; this.name = o.name || '';
      this.alive = true; this.trail = []; this.id = Ball.nextId++;
      this.rot = 0; this.flash = 0; this.squash = 0; this.sqx = 0; this.sqy = 1;
      Object.assign(this, o.extra || {});
    }
    get speed() { return Math.hypot(this.vx, this.vy); }
    setSpeed(s) { const v = this.speed || 1; this.vx *= s / v; this.vy *= s / v; }
  }
  Ball.nextId = 1;

  /** Sub-steps needed so the fastest ball travels at most frac*minR per sub-step. */
  function substeps(balls, dt, frac = 0.4, cap = 24) {
    let vmax = 0, rmin = 1e9;
    for (const b of balls) { if (!b.alive) continue; const s = b.vx * b.vx + b.vy * b.vy; if (s > vmax) vmax = s; if (b.r < rmin) rmin = b.r; }
    vmax = Math.sqrt(vmax);
    if (rmin === 1e9) return 1;
    return clamp(Math.ceil((vmax * dt) / (rmin * frac)), 1, cap);
  }

  /** Apply impulse response for a contact with normal (nx,ny) pointing towards the ball; `friction` is a Coulomb mu. Returns impact speed. */
  function resolve(b, nx, ny, depth, e = 1, wvx = 0, wvy = 0, friction = 0) {
    b.x += nx * depth; b.y += ny * depth;
    const rvx = b.vx - wvx, rvy = b.vy - wvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const nvn = -vn * e;
    // Coulomb friction: tangential change bounded by mu * normal impulse (resting contact barely slows)
    let nvt = vt;
    if (friction > 0) { const dv = Math.min(Math.abs(vt), friction * (1 + e) * -vn); nvt = vt - Math.sign(vt) * dv; }
    b.vx = wvx + nx * nvn + tx * nvt;
    b.vy = wvy + ny * nvn + ty * nvt;
    return -vn;
  }

  /** Ball inside a circular container. */
  function insideCircle(b, cx, cy, R) {
    const dx = b.x - cx, dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    const lim = R - b.r;
    if (d <= lim) return false;
    const nx = d > 1e-9 ? -dx / d : 0, ny = d > 1e-9 ? -dy / d : -1;
    C.nx = nx; C.ny = ny; C.depth = d - lim; C.px = cx - nx * R; C.py = cy - ny * R;
    return true;
  }

  /** Ball vs static circle (peg / bumper). */
  function circle(b, cx, cy, cr) {
    const dx = b.x - cx, dy = b.y - cy;
    const d2 = dx * dx + dy * dy, rr = b.r + cr;
    if (d2 >= rr * rr) return false;
    const d = Math.sqrt(d2) || 1e-6;
    C.nx = dx / d; C.ny = dy / d; C.depth = rr - d; C.px = cx + C.nx * cr; C.py = cy + C.ny * cr;
    return true;
  }

  /** Ball vs capsule segment (a->b with half-thickness ht). */
  function segment(b, ax, ay, bx, by, ht = 0) {
    const ex = bx - ax, ey = by - ay;
    const L2 = ex * ex + ey * ey;
    let t = L2 > 0 ? ((b.x - ax) * ex + (b.y - ay) * ey) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ex * t, py = ay + ey * t;
    const dx = b.x - px, dy = b.y - py;
    const d2 = dx * dx + dy * dy, rr = b.r + ht;
    if (d2 >= rr * rr) return false;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { const L = Math.sqrt(L2) || 1; C.nx = -ey / L; C.ny = ex / L; d = 0; }
    else { C.nx = dx / d; C.ny = dy / d; }
    C.depth = rr - d; C.px = px; C.py = py;
    return true;
  }

  /** One-sided segment: solid only from the side its normal (left of a->b) faces. Robust for fast balls. */
  function segmentOneSided(b, ax, ay, bx, by, ht = 0) {
    if (!segment(b, ax, ay, bx, by, ht)) return false;
    const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey) || 1;
    const nx = -ey / L, ny = ex / L;
    const side = (b.x - ax) * nx + (b.y - ay) * ny;
    if (C.px !== ax && C.px !== bx) { // interior contact: always push to the solid side
      C.nx = nx; C.ny = ny; C.depth = b.r + ht - side;
    }
    return C.depth > 0;
  }

  /** Ball vs arc band (ring with a gap). Arc covers angles [a0, a0+span]. side: -1 ball kept inside, +1 outside, 0 auto. */
  function arc(b, cx, cy, R, ht, a0, span, side = 0) {
    const dx = b.x - cx, dy = b.y - cy;
    const d = Math.hypot(dx, dy) || 1e-6;
    const ang = Math.atan2(dy, dx);
    const rel = normAngle(ang - a0);
    if (rel <= span) {
      const s = side !== 0 ? side : (d >= R ? 1 : -1);
      const dist = (d - R) * s; // distance on the requested side (can be negative when crossed)
      const rr = b.r + ht;
      if (dist >= rr) return false;
      C.nx = (dx / d) * s; C.ny = (dy / d) * s; C.depth = rr - dist;
      C.px = cx + (dx / d) * R; C.py = cy + (dy / d) * R;
      return true;
    }
    // end caps
    const a1 = a0 + span;
    const e0x = cx + Math.cos(a0) * R, e0y = cy + Math.sin(a0) * R;
    const e1x = cx + Math.cos(a1) * R, e1y = cy + Math.sin(a1) * R;
    const d0 = (b.x - e0x) ** 2 + (b.y - e0y) ** 2, d1 = (b.x - e1x) ** 2 + (b.y - e1y) ** 2;
    return d0 < d1 ? circle(b, e0x, e0y, ht) : circle(b, e1x, e1y, ht);
  }

  /** Is angle `ang` inside the gap of an arc [a0, a0+span]? */
  function inGap(ang, a0, span) { return normAngle(ang - a0) > span; }

  /** Elastic ball-ball collision. Returns impact speed (0 if none). */
  function ballBall(a, b, e = 1) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const rr = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) return 0;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    const im = 1 / a.m, jm = 1 / b.m, sum = im + jm;
    const pen = rr - d;
    a.x -= nx * pen * (im / sum); a.y -= ny * pen * (im / sum);
    b.x += nx * pen * (jm / sum); b.y += ny * pen * (jm / sum);
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn >= 0) return 0;
    const j = (-(1 + e) * vn) / sum;
    a.vx -= j * nx * im; a.vy -= j * ny * im;
    b.vx += j * nx * jm; b.vy += j * ny * jm;
    return -vn;
  }

  /** Surface velocity of a point on a body rotating with angular velocity w about (cx,cy). */
  function rotVel(px, py, cx, cy, w) { return [-w * (py - cy), w * (px - cx)]; }

  /** Keep total mechanical energy fixed (E = v²/2 - g*y, y down). Kills numerical creep. */
  function lockEnergy(b, g) {
    const v2 = 2 * (b.E0 + g * b.y);
    if (v2 <= 1) return;
    const s = b.vx * b.vx + b.vy * b.vy;
    if (s < 1e-6) { b.vy = -Math.sqrt(v2); return; }
    const k = Math.sqrt(v2 / s);
    b.vx *= k; b.vy *= k;
  }
  function setEnergy(b, g) { b.E0 = 0.5 * (b.vx * b.vx + b.vy * b.vy) - g * b.y; }

  const NB = [1, 0, -1, 1, 0, 1, 1, 1];
  /** Uniform grid broad-phase for many balls (linked lists in typed arrays). */
  class Grid {
    constructor(x0, y0, w, h, cell) {
      this.x0 = x0; this.y0 = y0; this.cell = cell;
      this.cols = Math.ceil(w / cell) + 1; this.rows = Math.ceil(h / cell) + 1;
      this.head = new Int32Array(this.cols * this.rows);
      this.next = new Int32Array(4096);
    }
    build(balls) {
      this.head.fill(-1);
      if (this.next.length < balls.length) this.next = new Int32Array(balls.length * 2);
      const { cols, rows, cell, x0, y0 } = this;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i]; if (!b.alive) continue;
        const cx = clamp(((b.x - x0) / cell) | 0, 0, cols - 1), cy = clamp(((b.y - y0) / cell) | 0, 0, rows - 1);
        const k = cy * cols + cx;
        this.next[i] = this.head[k]; this.head[k] = i;
      }
    }
    /** Call fn(a, b) for every nearby pair once. */
    pairs(balls, fn) {
      const { cols, rows, head, next } = this;
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        for (let i = head[cy * cols + cx]; i !== -1; i = next[i]) {
          // same cell (j after i) + 4 forward neighbours
          for (let j = next[i]; j !== -1; j = next[j]) fn(balls[i], balls[j]);
          for (let n = 0; n < 4; n++) {
            const nx = cx + NB[n * 2], ny = cy + NB[n * 2 + 1];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            for (let j = head[ny * cols + nx]; j !== -1; j = next[j]) fn(balls[i], balls[j]);
          }
        }
      }
    }
  }

  /** Regular polygon vertices (rotating container shapes). */
  function polygon(cx, cy, R, n, rot) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU - Math.PI / 2; pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); }
    return pts;
  }
  /** Keep ball inside a convex polygon rotating with w. Returns impact speed of the strongest contact. */
  function insidePolygon(b, pts, cx, cy, w, e = 1) {
    let best = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
      const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey);
      // inward normal (polygon is clockwise on screen: vertices by increasing angle, y down)
      let nx = -ey / L, ny = ex / L;
      if ((cx - ax) * nx + (cy - ay) * ny < 0) { nx = -nx; ny = -ny; }
      const dist = (b.x - ax) * nx + (b.y - ay) * ny;
      if (dist < b.r) {
        const px = b.x - nx * dist, py = b.y - ny * dist;
        const [wvx, wvy] = rotVel(px, py, cx, cy, w);
        const imp = resolve(b, nx, ny, b.r - dist, e, wvx, wvy);
        if (imp > best) { best = imp; C.px = px; C.py = py; C.nx = nx; C.ny = ny; }
      }
    }
    return best;
  }
  /** Inradius of regular n-gon with circumradius R. */
  const inradius = (R, n) => R * Math.cos(Math.PI / n);

  SB.phys = { Ball, C, substeps, resolve, insideCircle, circle, segment, segmentOneSided, arc, inGap, ballBall, rotVel, lockEnergy, setEnergy, Grid, polygon, insidePolygon, inradius };
})(window.SB);
