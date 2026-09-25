/* SatisBall — Arena: a reusable container (circle, polygons, star, heart, or a shape that morphs mid-run).
 *
 *  - Shapes are star-shaped around the centre, so every edge's inward normal points at the centre side.
 *  - Walls may rotate, shrink or morph; each edge's velocity comes from finite differences of its
 *    vertices, so balls bounce correctly off moving walls (and energy locks remove any gain).
 *  - Reflex (concave) corners get their own point collider, so stars and hearts never leak.
 */
'use strict';
(function (SB) {
  const { TAU, clamp, lerp, smooth } = SB.util;
  const P = SB.phys, C = P.C;

  const SHAPES = {
    circle: { name: 'Circle' }, triangle: { name: 'Triangle', n: 3 }, square: { name: 'Square', n: 4 }, pentagon: { name: 'Pentagon', n: 5 },
    hexagon: { name: 'Hexagon', n: 6 }, octagon: { name: 'Octagon', n: 8 }, star: { name: 'Star', star: 5 }, heart: { name: 'Heart', heart: true },
    morph: { name: 'Shape-shifter (morphs)' },
  };
  const M = 60; // samples used for morphing
  const unitCache = new Map();
  /** Unit outline (radius ~1, vertex 0 pointing up) as [[x,y]...] in angle order. */
  function unitPts(shape) {
    if (unitCache.has(shape)) return unitCache.get(shape);
    const d = SHAPES[shape] || SHAPES.circle;
    let pts = [];
    if (d.n) for (let i = 0; i < d.n; i++) { const a = -Math.PI / 2 + (i / d.n) * TAU; pts.push([Math.cos(a), Math.sin(a)]); }
    else if (d.star) for (let i = 0; i < d.star * 2; i++) { const a = -Math.PI / 2 + (i / (d.star * 2)) * TAU, r = i % 2 ? 0.56 : 1; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    else if (d.heart) {
      const raw = [];
      for (let i = 0; i < 44; i++) { const t = (i / 44) * TAU; raw.push([16 * Math.pow(Math.sin(t), 3), -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); }
      // centre on a point that sees the whole outline (slightly above the middle), scale to radius 1
      const cy = -1.5; let mx = 0;
      for (const p of raw) { p[1] -= cy; mx = Math.max(mx, Math.hypot(p[0], p[1])); }
      pts = raw.map(([x, y]) => [x / mx, y / mx]);
      pts.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
    } else for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; pts.push([Math.cos(a), Math.sin(a)]); }
    unitCache.set(shape, pts);
    return pts;
  }
  const radCache = new Map();
  /** Radial profile of a shape: distance from centre to outline at M evenly spaced angles. */
  function radial(shape) {
    if (radCache.has(shape)) return radCache.get(shape);
    const r = new Float32Array(M);
    if (shape === 'circle') r.fill(1);
    else {
      const pts = unitPts(shape);
      for (let j = 0; j < M; j++) {
        const a = -Math.PI / 2 + (j / M) * TAU, dx = Math.cos(a), dy = Math.sin(a);
        let best = 1;
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
          const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
          if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) { best = t; break; }
        }
        r[j] = best;
      }
    }
    radCache.set(shape, r);
    return r;
  }

  class Arena {
    constructor(o) {
      this.cx = o.cx; this.cy = o.cy; this.R = o.R; this.w = o.spin || 0; this.rot = o.rot || 0;
      this.shape = o.shape || 'circle';
      this.morphList = o.morphShapes || ['circle', 'hexagon', 'triangle', 'star', 'square', 'heart', 'pentagon'];
      this.hold = o.hold ?? 2.6; this.dur = o.morphDur ?? 0.9;
      this.mt = 0; this.mi = 0; this.morphing = false; this.morphed = null;
      this.pts = []; this.prev = []; this.vel = []; this.nrm = []; this.reflex = [];
      this.circle = this.shape === 'circle';
      this.dtAcc = 0;
      this.build(0);
    }
    get label() { return this.shape === 'morph' ? SHAPES[this.morphList[this.mi % this.morphList.length]].name : SHAPES[this.shape].name; }
    currentUnit() {
      if (this.shape !== 'morph') return unitPts(this.shape);
      const a = radial(this.morphList[this.mi % this.morphList.length]);
      const b = radial(this.morphList[(this.mi + 1) % this.morphList.length]);
      const k = this.morphing ? smooth(clamp((this.mt - this.hold) / this.dur, 0, 1)) : 0;
      const out = [];
      for (let j = 0; j < M; j++) { const ang = -Math.PI / 2 + (j / M) * TAU, r = lerp(a[j], b[j], k); out.push([Math.cos(ang) * r, Math.sin(ang) * r]); }
      return out;
    }
    build(dt) {
      this.circle = this.shape === 'circle';
      if (this.circle) return;
      const u = this.currentUnit(), n = u.length;
      const c = Math.cos(this.rot), s = Math.sin(this.rot);
      const had = this.pts.length === n;
      const prev = this.prev; this.prev = this.pts; this.pts = prev.length === n ? prev : new Array(n).fill(0).map(() => [0, 0]);
      if (this.vel.length !== n) this.vel = new Array(n).fill(0).map(() => [0, 0]);
      for (let i = 0; i < n; i++) {
        const x = this.cx + (u[i][0] * c - u[i][1] * s) * this.R, y = this.cy + (u[i][0] * s + u[i][1] * c) * this.R;
        const p = this.pts[i]; p[0] = x; p[1] = y;
        if (had && dt > 0) { this.vel[i][0] = (x - this.prev[i][0]) / dt; this.vel[i][1] = (y - this.prev[i][1]) / dt; } else { this.vel[i][0] = 0; this.vel[i][1] = 0; }
      }
      if (!had) { this.prev = this.pts.map((p) => p.slice()); }
      // inward normals + reflex corners + inradius
      this.nrm.length = n; this.reflex.length = 0; this.inR = 1e9;
      for (let i = 0; i < n; i++) {
        const a = this.pts[i], b = this.pts[(i + 1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
        let nx = -ey / L, ny = ex / L;
        if ((this.cx - a[0]) * nx + (this.cy - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
        this.nrm[i] = [nx, ny, L];
        const dist = (this.cx - a[0]) * nx + (this.cy - a[1]) * ny;
        if (dist < this.inR) this.inR = dist;
      }
      for (let i = 0; i < n; i++) {
        const p = this.pts[(i - 1 + n) % n], q = this.pts[i], r = this.pts[(i + 1) % n];
        const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
        // reflex if the turn is opposite to the polygon's overall orientation
        const orient = (q[0] - this.cx) * (r[1] - this.cy) - (q[1] - this.cy) * (r[0] - this.cx);
        if (cross * orient < 0) this.reflex.push(i);
      }
      this.convex = this.reflex.length === 0;
    }
    update(dt) {
      this.rot += this.w * dt;
      this.morphed = null;
      if (this.shape === 'morph') {
        this.mt += dt;
        this.morphing = this.mt > this.hold;
        if (this.mt > this.hold + this.dur) { this.mt = 0; this.mi++; this.morphing = false; this.morphed = this.label; }
      }
      this.build(dt);
    }
    get inradius() { return this.circle ? this.R : this.inR; }
    /** Bounce a ball off the walls. Returns the largest impact speed; C holds that contact. */
    collide(b, e = 1, friction = 0) {
      if (this.circle) {
        if (!P.insideCircle(b, this.cx, this.cy, this.R)) return 0;
        const px = C.px, py = C.py, nx = C.nx, ny = C.ny;
        const imp = P.resolve(b, nx, ny, C.depth, e, 0, 0, friction);
        C.px = px; C.py = py; C.nx = nx; C.ny = ny;
        this.lastEdge = -1;
        return imp;
      }
      const ddx = b.x - this.cx, ddy = b.y - this.cy, rr = this.inR - b.r - 2;
      if (rr > 0 && ddx * ddx + ddy * ddy < rr * rr) { this.lastEdge = -2; return 0; } // well inside: nothing to hit
      const pts = this.pts, n = pts.length;
      let best = 0, bpx = 0, bpy = 0, bnx = 0, bny = 0, be = -1, bt = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[i], c = pts[(i + 1) % n], [nx, ny] = this.nrm[i];
        const ex = c[0] - a[0], ey = c[1] - a[1], L2 = ex * ex + ey * ey;
        const t = ((b.x - a[0]) * ex + (b.y - a[1]) * ey) / L2;
        if (t < 0 || t > 1) continue;
        const d = (b.x - a[0]) * nx + (b.y - a[1]) * ny;
        if (d >= b.r || (!this.convex && d < -b.r)) continue; // concave shapes: only the near side of each edge
        const va = this.vel[i], vc = this.vel[(i + 1) % n];
        const wvx = va[0] + (vc[0] - va[0]) * t, wvy = va[1] + (vc[1] - va[1]) * t;
        const imp = P.resolve(b, nx, ny, b.r - d, e, wvx, wvy, friction);
        if (imp >= best) { best = imp; bpx = a[0] + ex * t; bpy = a[1] + ey * t; bnx = nx; bny = ny; be = i; bt = t; }
      }
      for (const i of this.reflex) {
        const q = pts[i];
        if (P.circle(b, q[0], q[1], 0)) {
          const nx = C.nx, ny = C.ny;
          const imp = P.resolve(b, nx, ny, C.depth, e, this.vel[i][0], this.vel[i][1], friction);
          if (imp >= best) { best = imp; bpx = q[0]; bpy = q[1]; bnx = nx; bny = ny; be = i; bt = 0; }
        }
      }
      C.px = bpx; C.py = bpy; C.nx = bnx; C.ny = bny;
      this.lastEdge = be; this.lastT = bt;
      return best;
    }
    /** Position-only projection (after ball-ball pushes). */
    keepIn(b) {
      if (this.circle) {
        const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy), lim = this.R - b.r;
        if (d > lim && d > 0) { b.x = this.cx + dx / d * lim; b.y = this.cy + dy / d * lim; const vn = (b.vx * dx + b.vy * dy) / d; if (vn > 0) { b.vx -= 2 * vn * dx / d; b.vy -= 2 * vn * dy / d; } }
        return;
      }
      const ddx = b.x - this.cx, ddy = b.y - this.cy, rr = this.inR - b.r - 2;
      if (rr > 0 && ddx * ddx + ddy * ddy < rr * rr) return;
      const pts = this.pts, n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], c = pts[(i + 1) % n], [nx, ny] = this.nrm[i];
        const ex = c[0] - a[0], ey = c[1] - a[1], L2 = ex * ex + ey * ey;
        const t = ((b.x - a[0]) * ex + (b.y - a[1]) * ey) / L2;
        if (t < 0 || t > 1) continue;
        const d = (b.x - a[0]) * nx + (b.y - a[1]) * ny;
        if (d < b.r && (this.convex || d > -b.r)) { b.x += nx * (b.r - d); b.y += ny * (b.r - d); const vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; } }
      }
    }
    contains(x, y, margin = 0) {
      if (this.circle) return Math.hypot(x - this.cx, y - this.cy) <= this.R - margin;
      const pts = this.pts; let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside || margin <= 0) return inside;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], [nx, ny] = this.nrm[i]; const d = (x - a[0]) * nx + (y - a[1]) * ny; const c = pts[(i + 1) % pts.length]; const ex = c[0] - a[0], ey = c[1] - a[1]; const t = ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey); if (t >= 0 && t <= 1 && d < margin) return false; }
      return true;
    }
    randomPoint(rng, margin = 20) {
      for (let k = 0; k < 40; k++) {
        const a = rng.range(0, TAU), r = Math.sqrt(rng.next()) * this.R;
        const x = this.cx + Math.cos(a) * r, y = this.cy + Math.sin(a) * r;
        if (this.contains(x, y, margin)) return [x, y];
      }
      return [this.cx, this.cy];
    }
    area() {
      if (this.circle) return Math.PI * this.R * this.R;
      let s = 0; const p = this.pts;
      for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
      return Math.abs(s) / 2;
    }
    /** Trace the outline (inset > 0 grows it outward, for borders drawn just outside the wall). */
    path(ctx, inset = 0) {
      ctx.beginPath();
      if (this.circle) { ctx.arc(this.cx, this.cy, this.R + inset, 0, TAU); return; }
      const k = (this.R + inset) / this.R;
      this.pts.forEach(([x, y], i) => { const X = this.cx + (x - this.cx) * k, Y = this.cy + (y - this.cy) * k; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath();
    }
    /** Point on the current outline for a stored anchor (edge index + t), so anchors ride moving walls. */
    anchorPoint(a) {
      if (this.circle || a.e === undefined || a.e < 0) { const ang = a.ang + this.rot; return [this.cx + Math.cos(ang) * this.R, this.cy + Math.sin(ang) * this.R]; }
      const p = this.pts[a.e % this.pts.length], q = this.pts[(a.e + 1) % this.pts.length];
      return [p[0] + (q[0] - p[0]) * a.t, p[1] + (q[1] - p[1]) * a.t];
    }
    /** Anchor for the most recent collide() contact point. */
    anchorFor(px, py) {
      if (this.circle || this.lastEdge === undefined || this.lastEdge < 0) return { ang: Math.atan2(py - this.cy, px - this.cx) - this.rot };
      return { e: this.lastEdge, t: this.lastT };
    }
    audit(b, tol = 3) {
      if (this.circle) return Math.hypot(b.x - this.cx, b.y - this.cy) > this.R - b.r + tol;
      return !this.contains(b.x, b.y, 0);
    }
  }
  Arena.SHAPES = SHAPES;
  Arena.options = (withMorph = true) => Object.entries(SHAPES).filter(([k]) => withMorph || k !== 'morph').map(([k, v]) => [k, v.name]);
  SB.Arena = Arena;
})(window.SB);
