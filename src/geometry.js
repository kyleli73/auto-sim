export const FIELD = 144;
export const rad = d => d * Math.PI / 180;
export const deg = r => r * 180 / Math.PI;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function normDeg(a) {
  a %= 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export function segStartPose(path, i) {
  return i === 0 ? path.startPose : path.segments[i - 1].end;
}

// Control polygon of segment i, start implied by the previous end.
export function segPoints(path, i) {
  const s = path.segments[i], a = segStartPose(path, i);
  return [{ x: a.x, y: a.y }, ...s.controls.map(c => ({ x: c.x, y: c.y })), { x: s.end.x, y: s.end.y }];
}

// De Casteljau, any degree.
export function bezierPoint(pts, t) {
  const p = pts.map(q => ({ x: q.x, y: q.y }));
  for (let n = p.length - 1; n > 0; n--) {
    for (let i = 0; i < n; i++) {
      p[i] = { x: p[i].x + (p[i + 1].x - p[i].x) * t, y: p[i].y + (p[i + 1].y - p[i].y) * t };
    }
  }
  return p[0];
}

export function bezierDerivative(pts, t) {
  const n = pts.length - 1;
  if (n < 1) return { x: 0, y: 0 };
  const d = [];
  for (let i = 0; i < n; i++) d.push({ x: n * (pts[i + 1].x - pts[i].x), y: n * (pts[i + 1].y - pts[i].y) });
  return bezierPoint(d, t);
}

function bezierSecond(c, t) {
  const k = 1 - t;
  return {
    x: 6 * (k * (c[2].x - 2 * c[1].x + c[0].x) + t * (c[3].x - 2 * c[2].x + c[1].x)),
    y: 6 * (k * (c[2].y - 2 * c[1].y + c[0].y) + t * (c[3].y - 2 * c[2].y + c[1].y)),
  };
}

// Degrees. Falls back to nearby samples when a control point coincides with an end.
export function tangentAngle(pts, t) {
  for (const tt of [t, t < 0.5 ? t + 0.02 : t - 0.02, t < 0.5 ? t + 0.1 : t - 0.1]) {
    const d = bezierDerivative(pts, tt);
    if (Math.hypot(d.x, d.y) > 1e-9) return deg(Math.atan2(d.y, d.x));
  }
  const a = pts[0], b = pts[pts.length - 1];
  return deg(Math.atan2(b.y - a.y, b.x - a.x));
}

export function arcTable(pts, n = 48) {
  const ts = [0], ds = [0];
  let prev = pts[0], acc = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, p = bezierPoint(pts, t);
    acc += dist(prev, p);
    ts.push(t); ds.push(acc); prev = p;
  }
  return { ts, ds, total: acc };
}

export function paramAtDistance(tab, d) {
  if (d <= 0) return 0;
  if (d >= tab.total) return 1;
  let lo = 0, hi = tab.ds.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (tab.ds[m] <= d) lo = m; else hi = m;
  }
  const span = tab.ds[hi] - tab.ds[lo] || 1;
  return tab.ts[lo] + (tab.ts[hi] - tab.ts[lo]) * (d - tab.ds[lo]) / span;
}

export function bezierLength(pts) {
  if (pts.length === 2) return dist(pts[0], pts[1]);
  return arcTable(pts, 100).total;
}

export function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer-Douglas-Peucker, returns kept indices.
export function rdpIndices(pts, eps) {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i], pts[a], pts[b]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = true; stack.push([a, mi], [mi, b]); }
  }
  return keep.flatMap((k, i) => k ? [i] : []);
}
export const rdp = (pts, eps) => rdpIndices(pts, eps).map(i => pts[i]);

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = a => { const l = Math.hypot(a.x, a.y); return l ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const L = u[u.length - 1] || 1;
  return u.map(v => v / L);
}

function genBezier(pts, u, t1, t2) {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], k = 1 - t;
    const b0 = k * k * k, b1 = 3 * t * k * k, b2 = 3 * t * t * k, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01, seg = dist(p0, p3);
  let al1 = det ? (x0 * c11 - x1 * c01) / det : 0, al2 = det ? (c00 * x1 - c01 * x0) / det : 0;
  if (Math.abs(det) < 1e-12 || al1 < seg * 1e-3 || al2 < seg * 1e-3) al1 = al2 = seg / 3;
  return [p0, add(p0, mul(t1, al1)), add(p3, mul(t2, al2)), p3];
}

function maxErr(pts, bez, u) {
  let err = 0, idx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(bezierPoint(bez, u[i]), pts[i]);
    if (d > err) { err = d; idx = i; }
  }
  return { err, idx };
}

function reparam(pts, u, bez) {
  return u.map((t, i) => {
    const q = sub(bezierPoint(bez, t), pts[i]);
    const d1 = bezierDerivative(bez, t), d2 = bezierSecond(bez, t);
    const den = dot(d1, d1) + dot(q, d2);
    return Math.abs(den) < 1e-12 ? t : Math.max(0, Math.min(1, t - dot(q, d1) / den));
  });
}

function fitRec(pts, t1, t2, tol, depth) {
  const n = pts.length;
  if (n === 2) {
    const s = dist(pts[0], pts[1]) / 3;
    return [[pts[0], add(pts[0], mul(t1, s)), add(pts[1], mul(t2, s)), pts[1]]];
  }
  let u = chordParams(pts), bez = genBezier(pts, u, t1, t2), e = maxErr(pts, bez, u);
  if (e.err < tol) return [bez];
  if (e.err < tol * 4) {
    for (let r = 0; r < 4; r++) {
      u = reparam(pts, u, bez); bez = genBezier(pts, u, t1, t2); e = maxErr(pts, bez, u);
      if (e.err < tol) return [bez];
    }
  }
  if (depth > 8 || n < 5) return [bez];
  const k = Math.max(1, Math.min(n - 2, e.idx));
  const c = unit(sub(pts[k - 1], pts[k + 1]));
  return [
    ...fitRec(pts.slice(0, k + 1), t1, c, tol, depth + 1),
    ...fitRec(pts.slice(k), mul(c, -1), t2, tol, depth + 1),
  ];
}

// Schneider-style cubic fit; returns arrays of 4 points.
export function fitCubics(pts, tol = 2) {
  const n = pts.length;
  if (n < 2) return [];
  const t1 = unit(sub(pts[Math.min(3, n - 1)], pts[0]));
  const t2 = unit(sub(pts[Math.max(n - 4, 0)], pts[n - 1]));
  return fitRec(pts, t1, t2, tol, 0);
}

function dedupe(pts, minD) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (dist(pts[i], out[out.length - 1]) >= minD) out.push(pts[i]);
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) {
    if (out.length > 1 && dist(last, out[out.length - 1]) < minD) out[out.length - 1] = last; else out.push(last);
  }
  return out;
}

const roundP = p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

// Freehand stroke -> [{kind, controls, end}] (no heading).
export function fitStroke(raw, { tol = 1.5, straightTol = 1, cornerDeg = 50 } = {}) {
  if (raw.length < 2) return [];
  const pts = dedupe(raw, 0.75);
  if (pts.length < 2) return [];
  const idx = rdpIndices(pts, tol);
  const cuts = [0];
  for (let k = 1; k < idx.length - 1; k++) {
    const a = pts[idx[k - 1]], b = pts[idx[k]], c = pts[idx[k + 1]];
    const turn = Math.abs(normDeg(deg(Math.atan2(c.y - b.y, c.x - b.x)) - deg(Math.atan2(b.y - a.y, b.x - a.x))));
    if (turn > cornerDeg) cuts.push(idx[k]);
  }
  cuts.push(pts.length - 1);
  const out = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const run = pts.slice(cuts[k], cuts[k + 1] + 1);
    const end = run[run.length - 1];
    if (run.length === 2 || rdp(run, tol).length === 2) {
      out.push({ kind: 'line', controls: [], end: roundP(end) });
      continue;
    }
    for (const c of fitCubics(run, tol * 1.3)) {
      const straight = distToSeg(c[1], c[0], c[3]) < straightTol && distToSeg(c[2], c[0], c[3]) < straightTol;
      out.push(straight
        ? { kind: 'line', controls: [], end: roundP(c[3]) }
        : { kind: 'curve', controls: [roundP(c[1]), roundP(c[2])], end: roundP(c[3]) });
    }
  }
  return out;
}

// Robot footprint corners; w across, l along heading.
export function footprint(x, y, hDeg, w, l) {
  const c = Math.cos(rad(hDeg)), s = Math.sin(rad(hDeg)), hl = l / 2, hw = w / 2;
  return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([a, b]) => ({ x: x + a * c - b * s, y: y + a * s + b * c }));
}

// Separating axis test; touching edges do not count as overlap.
export function polysOverlap(A, B) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = { x: q.y - p.y, y: p.x - q.x };
      const proj = P => { const v = P.map(r => dot(r, ax)); return [Math.min(...v), Math.max(...v)]; };
      const [a0, a1] = proj(A), [b0, b1] = proj(B);
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}
