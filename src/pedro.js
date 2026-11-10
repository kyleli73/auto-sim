// Pedro Pathing import/export. Pure: no DOM. parsePedro accepts .pp JSON or pasted Java.
import { normDeg, segPoints, tangentAngle } from './geometry.js';

let n = 0;
const sid = () => 's' + (++n).toString(36) + Math.random().toString(36).slice(2, 5);
const num = (v, d) => (v !== undefined && v !== null && v !== '' && Number.isFinite(+v)) ? +v : d;
const r2 = v => Math.round(v * 100) / 100;
const firstNum = (...vs) => { for (const v of vs) if (v !== undefined && v !== null && v !== '' && Number.isFinite(+v)) return +v; return undefined; };

// ---- shared builder: segments from normalized pieces ----
// piece: { controls, end:{x,y}, heading:{type:'linear'|'constant'|'tangential', startDeg?, endDeg?, degrees?, reverse?} }
function buildPath(name, start, pieces, waits) {
  const path = { id: sid(), name, color: '#14b8a6', startPose: { x: r2(start.x), y: r2(start.y), h: r2(normDeg(start.h)) }, segments: [], updatedAt: 0, author: '' };
  let cur = path.startPose;
  pieces.forEach((p, i) => {
    const controls = p.controls.map(c => ({ x: r2(c.x), y: r2(c.y) }));
    const hd = p.heading || { type: 'constant', degrees: cur.h };
    const seg = { id: sid(), kind: controls.length ? 'curve' : 'line', controls, end: { x: r2(p.end.x), y: r2(p.end.y), h: 0 }, heading: { mode: 'linear' } };
    if (i === 0) seg.start = { ...cur };
    if (p.name) seg.name = p.name;
    path.segments.push(seg);
    if (hd.type === 'tangential') {
      seg.heading = { mode: 'tangential', ...(hd.reverse ? { reverse: true } : {}) };
      const pts = segPoints(path, i);
      seg.end.h = r2(normDeg(tangentAngle(pts, 1) + (hd.reverse ? 180 : 0)));
    } else if (hd.type === 'constant') {
      seg.heading = { mode: 'constant' };
      seg.end.h = r2(normDeg(hd.degrees ?? cur.h));
    } else {
      seg.end.h = r2(normDeg(hd.endDeg ?? cur.h));
    }
    cur = seg.end;
  });
  const markers = [];
  for (const w of waits) {
    if (w.segIndex < 0 || w.segIndex >= path.segments.length) continue;
    const m = markers.find(k => k.segIndex === w.segIndex);
    if (m) { m.waitS = r2(m.waitS + w.waitS); if (w.label && !m.label.includes(w.label)) m.label += ' + ' + w.label; }
    else markers.push({ segIndex: w.segIndex, label: w.label || 'Wait', waitS: r2(w.waitS) });
  }
  markers.sort((a, b) => a.segIndex - b.segIndex);
  return { path, markers };
}

// ---- .pp JSON ----
function headingOf(line, fallback) {
  const h = line.heading, ep = line.endPoint || {};
  let spec = null;
  if (h && typeof h === 'object') spec = h;
  else if (typeof h === 'string') spec = { type: h, ...line };
  else if (typeof ep.heading === 'string') spec = { type: ep.heading, ...ep };
  else if (ep.heading && typeof ep.heading === 'object') spec = ep.heading;
  else if (line.startDeg !== undefined || line.endDeg !== undefined) spec = { type: 'linear', ...line };
  else if (ep.startDeg !== undefined || ep.endDeg !== undefined) spec = { type: 'linear', ...ep };
  else if (ep.degrees !== undefined || line.degrees !== undefined) spec = { type: 'constant', ...ep, ...line };
  if (!spec) return fallback;
  const t = spec.type || spec.heading;
  if (t === 'piecewise') {
    const segs = spec.piecewiseHeading?.segments || spec.segments || [];
    const first = segs[0] || {}, last = segs[segs.length - 1] || {};
    const sd = firstNum(first.startDeg, first.heading?.startDeg, first.degrees, first.heading?.degrees);
    const ed = firstNum(last.endDeg, last.heading?.endDeg, last.degrees, last.heading?.degrees);
    return { type: 'linear', startDeg: sd, endDeg: ed ?? sd, piecewise: true };
  }
  if (t === 'tangential' || t === 'tangent') return { type: 'tangential', reverse: !!(spec.reverse ?? line.reverse) };
  if (t === 'constant') return { type: 'constant', degrees: firstNum(spec.degrees, spec.endDeg, spec.startDeg) };
  if (t === 'linear') return { type: 'linear', startDeg: firstNum(spec.startDeg), endDeg: firstNum(spec.endDeg, spec.degrees) };
  return fallback;
}

function parsePP(j, base, warnings) {
  const sp = j.startPoint || {};
  const start = { x: num(sp.x, 0), y: num(sp.y, 0), h: firstNum(sp.headingDeg, sp.startDeg, sp.degrees) ?? 90 };
  const lines = Array.isArray(j.lines) ? j.lines : [];
  const byId = new Map(lines.map(l => [l.id, l]));
  const waits = [];
  const pieces = [];
  let warnedThrough = false, warnedPiece = false;
  const pushWait = (ms, label) => {
    if (!(ms > 0)) return;
    if (!pieces.length) { warnings.push(`${base}: wait "${label}" before the first path was ignored`); return; }
    waits.push({ segIndex: pieces.length - 1, label, waitS: ms / 1000 });
  };
  const flat = (line, inherit) => {
    if (line.throughPoints?.length && !warnedThrough) { warnedThrough = true; warnings.push(`${base}: through points are ignored`); }
    if (line.kind === 'compound' || Array.isArray(line.segments)) {
      const own = headingOf(line, inherit);
      pushWait(num(line.waitBeforeMs, 0), line.name || 'Wait');
      for (const s of line.segments || []) flat(s, own);
      if (pieces.length) pushWait(num(line.waitAfterMs, 0), line.name || 'Wait');
      return;
    }
    pushWait(num(line.waitBeforeMs, 0), line.name || 'Wait');
    const hd = headingOf(line, inherit);
    if (hd?.piecewise && !warnedPiece) { warnedPiece = true; warnings.push(`${base}: piecewise heading approximated as linear`); }
    pieces.push({
      name: line.name && !/^Path \d+$/.test(line.name) ? String(line.name) : '',
      controls: (line.controlPoints || []).map(c => ({ x: num(c.x, 0), y: num(c.y, 0) })),
      end: { x: num(line.endPoint?.x, 0), y: num(line.endPoint?.y, 0) },
      heading: hd,
    });
    pushWait(num(line.waitAfterMs, 0), line.name || 'Wait');
  };
  if (Array.isArray(j.sequence) && j.sequence.length) {
    for (const it of j.sequence) {
      if (it.kind === 'wait') pushWait(num(it.durationMs, 0), it.name || 'Wait');
      else {
        const l = byId.get(it.lineId);
        if (l) flat(l, null); else warnings.push(`${base}: sequence refers to missing line ${it.lineId}`);
      }
    }
  } else for (const l of lines) flat(l, null);
  // First heading defaults: a piece without a heading holds the previous heading.
  const fixed = pieces.map(p => p.heading ? p : { ...p, heading: null });
  const { path, markers } = buildPath(base, start, fixed, waits);
  return { name: base, path, markers };
}

// ---- Java ----
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
function readParens(s, open) { // s[open] === '('
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return { inner: s.slice(open + 1, i), end: i };
  }
  return null;
}
function splitArgs(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) {
    if (c === '(') d++; else if (c === ')') d--;
    if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function arith(e) {
  const t = e.replace(/Math\.PI/g, '3.141592653589793').replace(/(\d)[dDfF]\b/g, '$1');
  if (!/^[\d\s.+\-*/()eE]+$/.test(t)) return NaN;
  try { return Function(`"use strict";return (${t})`)(); } catch { return NaN; }
}
// Heading expression to degrees: Math.toRadians(n) is degrees n; anything else is radians.
function degExpr(e, poses) {
  const g = /^(\w+)\.getHeading\(\)$/.exec(e.trim());
  if (g) return poses?.get(g[1])?.h ?? NaN;
  const m = /^Math\.toRadians\(([\s\S]+)\)$/.exec(e.trim());
  if (m) return arith(m[1]);
  const v = arith(e);
  return Number.isFinite(v) ? v * 180 / Math.PI : NaN;
}
function poseFrom(expr, poses) {
  const e = expr.trim();
  const m = /^new\s+(Pose|Point)\s*\(/.exec(e);
  if (m) {
    const p = readParens(e, e.indexOf('('));
    if (!p) return null;
    const a = splitArgs(p.inner), x = arith(a[0] ?? ''), y = arith(a[1] ?? '');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, h: m[1] === 'Pose' && a[2] !== undefined ? degExpr(a[2], poses) : undefined };
  }
  const id = /^(\w+)/.exec(e);
  return id && poses.get(id[1]) ? poses.get(id[1]) : null;
}

function parseJava(src, base, warnings) {
  const text = stripComments(src), poses = new Map();
  const declRe = /\b(\w+)\s*=\s*new\s+(?:Pose|Point)\s*\(/g;
  let m;
  while ((m = declRe.exec(text))) {
    const par = readParens(text, m.index + m[0].length - 1);
    const p = par && poseFrom(text.slice(m.index + m[0].indexOf('new'), par.end + 1), poses);
    if (p) poses.set(m[1], p);
  }
  const results = [];
  const pbRe = /pathBuilder\s*\(\s*\)/g;
  let chainNo = 0;
  while ((m = pbRe.exec(text))) {
    const from = m.index + m[0].length;
    const build = text.indexOf('.build()', from), nextPb = text.slice(from).search(/pathBuilder\s*\(/);
    const to = build >= 0 && (nextPb < 0 || build < from + nextPb) ? build : nextPb >= 0 ? from + nextPb : text.length;
    const chain = text.slice(from, to);
    chainNo++;
    const lhs = /(\w+)\s*=\s*[\w.]*\s*$/.exec(text.slice(Math.max(0, m.index - 80), m.index));
    const name = lhs ? `${base} ${lhs[1]}` : (chainNo > 1 || /pathBuilder[\s\S]*pathBuilder/.test(text) ? `${base} ${chainNo}` : base);
    const pieces = []; let startH;
    let start = null, cur = null;
    const callRe = /\.(addPath|setLinearHeadingInterpolation|setConstantHeadingInterpolation|setTangentHeadingInterpolation|setReversed)\s*\(/g;
    let c;
    while ((c = callRe.exec(chain))) {
      const open = c.index + c[0].length - 1, par = readParens(chain, open);
      if (!par) break;
      const args = splitArgs(par.inner), last = pieces[pieces.length - 1];
      if (c[1] === 'addPath') {
        const bm = /new\s+Bezier(Line|Curve)\s*\(/.exec(par.inner);
        if (!bm) { warnings.push(`${name}: addPath without BezierLine/BezierCurve skipped`); continue; }
        const bp = readParens(par.inner, bm.index + bm[0].length - 1);
        const pts = splitArgs(bp.inner).map(a => poseFrom(a, poses));
        if (pts.length < 2 || pts.some(p => !p)) { warnings.push(`${name}: could not resolve a pose in a Bezier call; path skipped`); continue; }
        if (!start) { start = pts[0]; cur = pts[0]; }
        else if (Math.hypot(pts[0].x - cur.x, pts[0].y - cur.y) > 0.5) warnings.push(`${name}: path ${pieces.length + 1} does not start where the previous one ended`);
        const end = pts[pts.length - 1];
        pieces.push({ controls: pts.slice(1, -1), end, heading: null, endPose: end });
        cur = end;
        continue;
      }
      if (!last) continue;
      if (c[1] === 'setLinearHeadingInterpolation') {
        const a = degExpr(args[0] ?? '', poses), b = degExpr(args[1] ?? '', poses);
        if (Number.isFinite(a) && Number.isFinite(b)) { last.heading = { type: 'linear', startDeg: a, endDeg: b }; if (pieces.length === 1) startH ??= a; }
      } else if (c[1] === 'setConstantHeadingInterpolation') {
        const a = degExpr(args[0] ?? '', poses);
        if (Number.isFinite(a)) { last.heading = { type: 'constant', degrees: a }; if (pieces.length === 1) startH ??= a; }
      } else if (c[1] === 'setTangentHeadingInterpolation') {
        last.heading = { type: 'tangential', reverse: !!last.heading?.reverse };
      } else if (c[1] === 'setReversed') {
        const on = args[0] === undefined || args[0] === 'true';
        last.heading = { ...(last.heading || { type: 'tangential' }), reverse: on };
      }
    }
    if (!pieces.length) { warnings.push(`${name}: no paths found in chain`); continue; }
    const h0 = start.h ?? startH ?? 90;
    const { path, markers } = buildPath(name, { x: start.x, y: start.y, h: h0 }, pieces, []);
    results.push({ name, path, markers });
  }
  if (!results.length && /Bezier(Line|Curve)/.test(text)) warnings.push(`${base}: found Bezier calls but no pathBuilder() chain`);
  return results;
}

// ---- entry points ----
export function parsePedro(input, filename = '') {
  const warnings = [], autos = [];
  const base = String(filename || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Pasted auto';
  let text = typeof input === 'string' ? input.trim() : null;
  if (text === null) text = JSON.stringify(input);
  if (text.startsWith('{') || text.startsWith('[')) {
    let j;
    try { j = JSON.parse(text); } catch { return { autos, warnings: [`${base}: not valid JSON`] }; }
    const list = Array.isArray(j) ? j : [j];
    list.forEach((x, i) => {
      if (!x || typeof x !== 'object' || !x.startPoint && !Array.isArray(x.lines)) { warnings.push(`${base}: not a Pedro .pp file`); return; }
      autos.push(parsePP(x, list.length > 1 ? `${base} ${i + 1}` : base, warnings));
    });
  } else if (/Bezier(Line|Curve)|pathBuilder/.test(text)) {
    autos.push(...parseJava(text, base, warnings));
  } else warnings.push(`${base}: format not recognized (expected .pp JSON or Pedro Java)`);
  return { autos, warnings };
}

export function toPP(auto) {
  const path = auto.path, markers = auto.markers || [];
  const lines = [], sequence = [];
  let prev = path.startPose;
  path.segments.forEach((s, i) => {
    const id = `line-${i + 1}`;
    const hd = s.heading?.mode === 'tangential' ? { type: 'tangential', reverse: !!s.heading.reverse }
      : s.heading?.mode === 'constant' ? { type: 'constant', degrees: r2(s.end.h) }
      : { type: 'linear', startDeg: r2(prev.h), endDeg: r2(s.end.h) };
    lines.push({
      id, name: s.name || `Path ${i + 1}`, kind: 'atomic',
      endPoint: { x: r2(s.end.x), y: r2(s.end.y) },
      controlPoints: s.controls.map(c => ({ x: r2(c.x), y: r2(c.y) })),
      heading: hd,
    });
    sequence.push({ kind: 'path', lineId: id });
    const m = markers.find(k => k.segIndex === i);
    if (m && m.waitS > 0) sequence.push({ kind: 'wait', name: m.label || 'Wait', durationMs: Math.round(m.waitS * 1000) });
    prev = s.end;
  });
  return JSON.stringify({
    startPoint: { x: r2(path.startPose.x), y: r2(path.startPose.y), headingDeg: r2(path.startPose.h) },
    lines, shapes: [], sequence,
  }, null, 2);
}
