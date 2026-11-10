import {
  segPoints, segStartPose, bezierLength, arcTable, paramAtDistance, bezierPoint,
  tangentAngle, normDeg, footprint, polysOverlap,
} from './geometry.js';
import { ZONES, rectPoly } from './field.js';

export const AUTO_SECONDS = 30;

export function trapezoid(L, vmax, a) {
  if (!(L > 0)) return { L: 0, a, vPeak: 0, tA: 0, tC: 0, T: 0 };
  const dAcc = vmax * vmax / (2 * a);
  let vPeak = vmax, tA = vmax / a, tC = (L - 2 * dAcc) / vmax;
  if (L < 2 * dAcc) { vPeak = Math.sqrt(L * a); tA = vPeak / a; tC = 0; }
  return { L, a, vPeak, tA, tC, T: 2 * tA + tC };
}

export function distanceAt(p, t) {
  if (t <= 0) return 0;
  if (t >= p.T) return p.L;
  if (t <= p.tA) return 0.5 * p.a * t * t;
  if (t <= p.tA + p.tC) return 0.5 * p.a * p.tA * p.tA + p.vPeak * (t - p.tA);
  const r = p.T - t;
  return p.L - 0.5 * p.a * r * r;
}

const cache = new WeakMap();

// Robot objects are immutable snapshots, so identity is a safe cache key.
export function timelineFor(robot) {
  let tl = cache.get(robot);
  if (tl) return tl;
  const events = [];
  let t = 0;
  const path = robot.path;
  path.segments.forEach((seg, i) => {
    const pts = segPoints(path, i), L = bezierLength(pts);
    const tr = trapezoid(L, robot.maxVel, robot.maxAccel);
    events.push({ type: 'move', i, t0: t, t1: t + tr.T, tr, pts, table: seg.kind === 'line' ? null : arcTable(pts) });
    t += tr.T;
    const m = robot.markers.find(k => k.segIndex === i);
    if (m && m.waitS > 0) {
      events.push({ type: 'wait', i, t0: t, t1: t + m.waitS, marker: m });
      t += m.waitS;
    }
  });
  tl = { events, total: t };
  cache.set(robot, tl);
  return tl;
}

function headingAt(path, i, pts, u, frac) {
  const seg = path.segments[i], h0 = segStartPose(path, i).h;
  const m = seg.heading.mode;
  if (m === 'constant') return seg.end.h;
  if (m === 'tangential') return normDeg(tangentAngle(pts, u) + (seg.heading.reverse ? 180 : 0));
  return normDeg(h0 + normDeg(seg.end.h - h0) * frac);
}

export function poseAt(robot, t) {
  const { events } = timelineFor(robot), path = robot.path;
  if (!events.length || t <= 0) return { ...path.startPose };
  for (const ev of events) {
    if (t > ev.t1 && ev !== events[events.length - 1]) continue;
    const seg = path.segments[ev.i];
    if (ev.type === 'wait') {
      return { x: seg.end.x, y: seg.end.y, h: headingAt(path, ev.i, ev.pts || segPoints(path, ev.i), 1, 1) };
    }
    const d = distanceAt(ev.tr, Math.min(t, ev.t1) - ev.t0);
    const frac = ev.tr.L ? d / ev.tr.L : 1;
    const u = ev.table ? paramAtDistance(ev.table, d) : frac;
    const p = bezierPoint(ev.pts, u);
    return { x: p.x, y: p.y, h: headingAt(path, ev.i, ev.pts, u, frac) };
  }
  return { ...path.startPose };
}

export function totalTime(robot) { return timelineFor(robot).total; }

// Intervals where two footprints overlap, or a footprint overlaps the HIVE frame (b: 'hive'): [{a, b, t0, t1}].
const hivePoly = rectPoly(ZONES.hive);
export function findConflicts(board, { step = 0.1, tEnd = AUTO_SECONDS } = {}) {
  const keys = Object.keys(board.robots), open = {}, out = [];
  for (let t = 0; t <= tEnd + 1e-9; t += step) {
    const polys = {};
    for (const k of keys) {
      const r = board.robots[k], p = poseAt(r, t);
      polys[k] = footprint(p.x, p.y, p.h, r.size.w, r.size.l);
    }
    for (const k of keys) {
      const id = k + 'hive', hit = polysOverlap(polys[k], hivePoly);
      if (hit && !open[id]) { open[id] = { a: k, b: 'hive', t0: t, t1: t }; out.push(open[id]); }
      else if (hit) open[id].t1 = t;
      else delete open[id];
    }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const id = keys[i] + keys[j], hit = polysOverlap(polys[keys[i]], polys[keys[j]]);
        if (hit && !open[id]) { open[id] = { a: keys[i], b: keys[j], t0: t, t1: t }; out.push(open[id]); }
        else if (hit) open[id].t1 = t;
        else delete open[id];
      }
    }
  }
  return out;
}
