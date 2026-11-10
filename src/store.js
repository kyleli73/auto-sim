import { FIELD, normDeg } from './geometry.js';

export const ROBOT_KEYS = ['r1', 'r2', 'b1', 'b2'];
export const ROBOT_LABEL = { r1: 'Red 1', r2: 'Red 2', b1: 'Blue 1', b2: 'Blue 2' };
export const OTHER_ALLIANCE = { r1: 'b1', r2: 'b2', b1: 'r1', b2: 'r2' };
const COLORS = { r1: '#ef4444', r2: '#f97316', b1: '#3b82f6', b2: '#a78bfa' };
const STARTS = {
  r1: { x: 60, y: 9, h: 90 }, r2: { x: 120, y: 9, h: 90 },
  b1: { x: 84, y: 135, h: 270 }, b2: { x: 24, y: 135, h: 270 },
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export function newRobot(key) {
  return {
    team: '', color: COLORS[key], size: { w: 18, l: 18 }, maxVel: 50, maxAccel: 40,
    path: { id: uid(), name: ROBOT_LABEL[key], color: COLORS[key], startPose: { ...STARTS[key] }, segments: [], updatedAt: 0, author: '' },
    markers: [],
  };
}

export function newBoard(name = 'Untitled board') {
  const robots = {};
  for (const k of ROBOT_KEYS) robots[k] = newRobot(k);
  return { id: uid(), name, updatedAt: Date.now(), robots };
}

const num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? +v : d;

// Accepts untrusted JSON (imports, share links, peers) and returns a well-formed board.
export function normalizeBoard(raw) {
  if (!raw || typeof raw !== 'object' || !raw.robots) throw new Error('Not a board');
  const b = newBoard(String(raw.name || 'Imported board'));
  if (typeof raw.id === 'string' && raw.id) b.id = raw.id;
  b.updatedAt = num(raw.updatedAt, Date.now());
  for (const k of ROBOT_KEYS) {
    const r = raw.robots[k];
    if (!r) continue;
    const base = b.robots[k], p = r.path || {};
    const pose = q => ({ x: num(q?.x, 0), y: num(q?.y, 0), h: num(q?.h, 0) });
    const segs = (Array.isArray(p.segments) ? p.segments : []).map(s => ({
      id: String(s.id || uid()), kind: s.kind === 'curve' ? 'curve' : 'line',
      ...(s.start ? { start: pose(s.start) } : {}),
      controls: s.kind === 'curve' ? (s.controls || []).map(c => ({ x: num(c.x, 0), y: num(c.y, 0) })) : [],
      end: pose(s.end),
      heading: { mode: ['linear', 'constant', 'tangential'].includes(s.heading?.mode) ? s.heading.mode : 'linear', ...(s.heading?.reverse ? { reverse: true } : {}) },
      ...(s.name ? { name: String(s.name) } : {}),
    })).map(s => s.kind === 'curve' && !s.controls.length ? { ...s, kind: 'line' } : s);
    b.robots[k] = {
      team: String(r.team || ''), color: String(r.color || base.color),
      size: { w: num(r.size?.w, 18), l: num(r.size?.l, 18) },
      maxVel: Math.max(1, num(r.maxVel, 50)), maxAccel: Math.max(1, num(r.maxAccel, 40)),
      path: {
        id: String(p.id || uid()), name: String(p.name || ROBOT_LABEL[k]), color: String(p.color || base.color),
        startPose: p.startPose ? pose(p.startPose) : base.path.startPose, segments: segs,
        updatedAt: num(p.updatedAt, 0), author: String(p.author || ''),
      },
      markers: (Array.isArray(r.markers) ? r.markers : [])
        .filter(m => Number.isInteger(m.segIndex) && m.segIndex >= 0 && m.segIndex < segs.length)
        .map(m => ({ segIndex: m.segIndex, label: String(m.label || ''), waitS: Math.max(0, num(m.waitS, 0)) })),
    };
  }
  return b;
}

const mirrorPose = p => ({ ...p, x: FIELD - p.x, y: FIELD - p.y, h: normDeg(p.h + 180) });

export function mirrorPath(path) {
  return {
    ...path,
    startPose: mirrorPose(path.startPose),
    segments: path.segments.map(s => ({
      ...s, id: uid(),
      ...(s.start ? { start: mirrorPose(s.start) } : {}),
      controls: s.controls.map(c => ({ x: FIELD - c.x, y: FIELD - c.y })),
      end: mirrorPose(s.end),
    })),
  };
}

function edit(board, key, a, fn) {
  const robot = board.robots[key];
  if (!robot) return board;
  const next = fn(robot);
  if (next === robot) return board;
  const path = { ...next.path, updatedAt: a.at ?? 0, author: a.author ?? '' };
  return { ...board, updatedAt: a.at ?? board.updatedAt, robots: { ...board.robots, [key]: { ...next, path } } };
}

const withPath = (r, patch) => ({ ...r, path: { ...r.path, ...patch } });
const setSeg = (r, i, fn) => withPath(r, { segments: r.path.segments.map((s, j) => j === i ? fn(s) : s) });
const wins = (inc, cur) => inc.path.updatedAt > cur.path.updatedAt ||
  (inc.path.updatedAt === cur.path.updatedAt && inc.path.author > cur.path.author);

export function reduce(board, a) {
  switch (a.type) {
    case 'loadBoard': return a.board;
    case 'renameBoard': return { ...board, name: a.name, updatedAt: a.at ?? board.updatedAt };
    case 'remoteUpdate': {
      const incoming = a.board ? Object.entries(a.board.robots) : [[a.key, a.robot]];
      let next = board;
      for (const [k, r] of incoming) {
        const cur = next.robots[k];
        if (cur && r && wins(r, cur)) next = { ...next, robots: { ...next.robots, [k]: r } };
      }
      return next;
    }
    case 'setStart':
      return edit(board, a.robot, a, r => {
        const startPose = { ...r.path.startPose, ...a.pose };
        const segments = r.path.segments.map((s, i) => i === 0 ? { ...s, start: { ...startPose } } : s);
        return withPath(r, { startPose, segments });
      });
    case 'addSegment':
      return edit(board, a.robot, a, r => {
        const s = a.segment;
        const seg = {
          id: s.id || uid(), kind: s.kind, controls: s.kind === 'curve' ? s.controls : [], end: { ...s.end },
          heading: s.heading || { mode: 'linear' },
        };
        if (!r.path.segments.length) seg.start = { ...r.path.startPose };
        return withPath(r, { segments: [...r.path.segments, seg] });
      });
    case 'moveHandle':
      return edit(board, a.robot, a, r => {
        const { x, y } = a;
        if (a.handle === 'start') {
          const startPose = { ...r.path.startPose, x, y };
          return withPath(r, { startPose, segments: r.path.segments.map((s, i) => i === 0 ? { ...s, start: { ...startPose } } : s) });
        }
        if (!r.path.segments[a.segIndex]) return r;
        if (a.handle === 'end') return setSeg(r, a.segIndex, s => ({ ...s, end: { ...s.end, x, y } }));
        const ci = +String(a.handle).slice(1);
        return setSeg(r, a.segIndex, s => ({ ...s, controls: s.controls.map((c, j) => j === ci ? { x, y } : c) }));
      });
    case 'setHeading': // segIndex -1 is the start pose
      return edit(board, a.robot, a, r => {
        if (a.segIndex === -1) return withPath(r, { startPose: { ...r.path.startPose, h: a.h } });
        if (!r.path.segments[a.segIndex]) return r;
        return setSeg(r, a.segIndex, s => ({
          ...s, end: a.h === undefined ? s.end : { ...s.end, h: a.h },
          heading: a.heading ? a.heading : s.heading,
        }));
      });
    case 'setSegment': // patch: kind/controls changes
      return edit(board, a.robot, a, r => r.path.segments[a.segIndex] ? setSeg(r, a.segIndex, s => ({ ...s, ...a.patch })) : r);
    case 'deleteSegment':
      return edit(board, a.robot, a, r => {
        const i = a.segIndex;
        if (!r.path.segments[i]) return r;
        const segments = r.path.segments.filter((_, j) => j !== i);
        if (i === 0 && segments[0]) segments[0] = { ...segments[0], start: { ...r.path.startPose } };
        const markers = r.markers.filter(m => m.segIndex !== i).map(m => m.segIndex > i ? { ...m, segIndex: m.segIndex - 1 } : m);
        return { ...withPath(r, { segments }), markers };
      });
    case 'clearPath':
      return edit(board, a.robot, a, r => ({ ...withPath(r, { segments: [] }), markers: [] }));
    case 'addMarker':
      return edit(board, a.robot, a, r => {
        if (!r.path.segments[a.segIndex]) return r;
        const m = { segIndex: a.segIndex, label: a.label, waitS: Math.max(0, +a.waitS || 0) };
        return { ...r, markers: [...r.markers.filter(k => k.segIndex !== a.segIndex), m].sort((p, q) => p.segIndex - q.segIndex) };
      });
    case 'removeMarker':
      return edit(board, a.robot, a, r => ({ ...r, markers: r.markers.filter(m => m.segIndex !== a.segIndex) }));
    case 'setRobot':
      return edit(board, a.robot, a, r => ({ ...r, ...a.patch, path: a.patch.color ? { ...r.path, color: a.patch.color } : r.path }));
    case 'mirror': {
      const from = board.robots[a.from], to = a.to || OTHER_ALLIANCE[a.from];
      if (!from || !board.robots[to]) return board;
      return edit(board, to, a, r => ({
        ...r, markers: from.markers.map(m => ({ ...m })),
        path: { ...r.path, startPose: mirrorPose(from.path.startPose), segments: mirrorPath(from.path).segments },
      }));
    }
    default: return board;
  }
}

export function createStore(board, { author = 'local', now = () => Date.now(), limit = 100 } = {}) {
  let cur = board, past = [], future = [], lastCoalesce = null;
  const subs = new Set();
  const notify = meta => subs.forEach(f => f(cur, meta));

  // Undo/redo restore older snapshots; restamp so last-writer-wins lets them reach peers.
  const restamp = (from, to) => {
    const t = now(), robots = { ...to.robots };
    for (const k of ROBOT_KEYS) {
      if (robots[k] !== from.robots[k]) robots[k] = { ...robots[k], path: { ...robots[k].path, updatedAt: t, author } };
    }
    return { ...to, robots, updatedAt: t };
  };

  return {
    get: () => cur,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    dispatch(action) {
      const a = { at: now(), author, ...action };
      const next = reduce(cur, a);
      if (next === cur) return;
      const remote = a.type === 'remoteUpdate';
      if (a.type === 'loadBoard') { past = []; future = []; lastCoalesce = null; }
      else if (!remote) {
        if (!(a.coalesce && a.coalesce === lastCoalesce)) {
          past.push(cur);
          if (past.length > limit) past.shift();
        }
        future = [];
        lastCoalesce = a.coalesce || null;
      }
      const prev = cur;
      cur = next;
      notify({ type: a.type, remote, prev });
    },
    undo() {
      if (!past.length) return;
      const prev = cur;
      future.push(cur);
      cur = restamp(cur, past.pop());
      lastCoalesce = null;
      notify({ type: 'undo', remote: false, prev });
    },
    redo() {
      if (!future.length) return;
      const prev = cur;
      past.push(cur);
      cur = restamp(cur, future.pop());
      lastCoalesce = null;
      notify({ type: 'redo', remote: false, prev });
    },
  };
}

const LIB_KEY = 'bubblotics.autosim.v1';

export function readLibrary(storage) {
  try {
    const lib = JSON.parse(storage.getItem(LIB_KEY));
    const boards = {};
    for (const [id, b] of Object.entries(lib.boards)) { try { boards[id] = normalizeBoard(b); } catch { /* skip corrupt board */ } }
    if (Object.keys(boards).length) return { boards, currentId: boards[lib.currentId] ? lib.currentId : Object.keys(boards)[0] };
  } catch { /* first run or unreadable */ }
  const b = newBoard('Untitled board');
  return { boards: { [b.id]: b }, currentId: b.id };
}

export function writeLibrary(storage, lib) {
  try { storage.setItem(LIB_KEY, JSON.stringify(lib)); return true; } catch { return false; }
}
