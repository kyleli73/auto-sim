// Saved-autos library and match boards. Pure and immutable: every function returns a new state.
import {
  ROBOT_KEYS, ROBOT_LABEL, DEFAULT_STARTS, SLOT_COLORS, uid, normalizeBoard, mirrorPath, newRobot,
} from './store.js';
import { allianceOf } from './field.js';

const KEY = 'bubblotics.autosim.v2';
const V1_KEY = 'bubblotics.autosim.v1';
const num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? +v : d;

export const slotAlliance = allianceOf;

export function newBoardRec(name = 'Match board', now = Date.now()) {
  return { id: uid(), name, slots: { r1: null, r2: null, b1: null, b2: null }, slotAt: { r1: 0, r2: 0, b1: 0, b2: 0 }, updatedAt: now };
}

export function normalizeBoardRec(raw) {
  if (!raw || typeof raw !== 'object' || !raw.slots) throw new Error('Not a board');
  const b = newBoardRec(String(raw.name || 'Match board'), num(raw.updatedAt, 0));
  if (typeof raw.id === 'string' && raw.id) b.id = raw.id;
  for (const k of ROBOT_KEYS) {
    b.slots[k] = typeof raw.slots[k] === 'string' ? raw.slots[k] : null;
    b.slotAt[k] = num(raw.slotAt?.[k], 0);
  }
  return b;
}

export function newAuto({ name = 'New auto', team = '', alliance = 'red', now = Date.now(), author = '' } = {}) {
  const key = alliance === 'blue' ? 'b1' : 'r1', r = newRobot(key);
  return {
    id: uid(), name, team: String(team), alliance, path: { ...r.path, id: uid(), name }, markers: [],
    robot: { size: { ...r.size }, maxVel: r.maxVel, maxAccel: r.maxAccel }, createdAt: now, updatedAt: now, author,
  };
}

// Untrusted input (imports, share links, peers) to a well-formed Auto.
export function normalizeAuto(raw) {
  if (!raw || typeof raw !== 'object' || !raw.path) throw new Error('Not an auto');
  const r = normalizeBoard({ robots: { r1: { team: raw.team, size: raw.robot?.size, maxVel: raw.robot?.maxVel, maxAccel: raw.robot?.maxAccel, path: raw.path, markers: raw.markers } } }).robots.r1;
  const now = Date.now();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(), name: String(raw.name || raw.path.name || 'Auto'), team: String(raw.team || ''),
    alliance: raw.alliance === 'blue' ? 'blue' : 'red', path: r.path, markers: r.markers,
    robot: { size: r.size, maxVel: r.maxVel, maxAccel: r.maxAccel },
    createdAt: num(raw.createdAt, now), updatedAt: num(raw.updatedAt, now), author: String(raw.author || ''),
  };
}

export const emptyLib = () => { const b = newBoardRec('Match board'); return { autos: {}, boards: { [b.id]: b }, activeBoardId: b.id }; };

export function normalizeLib(raw) {
  const lib = { autos: {}, boards: {}, activeBoardId: '' };
  for (const a of Object.values(raw?.autos || {})) { try { const n = normalizeAuto(a); lib.autos[n.id] = n; } catch { /* skip corrupt auto */ } }
  for (const b of Object.values(raw?.boards || {})) { try { const n = normalizeBoardRec(b); lib.boards[n.id] = n; } catch { /* skip corrupt board */ } }
  if (!Object.keys(lib.boards).length) { const b = newBoardRec('Match board'); lib.boards[b.id] = b; }
  lib.activeBoardId = lib.boards[raw?.activeBoardId] ? raw.activeBoardId : Object.keys(lib.boards)[0];
  return lib;
}

// One-time migration of the old per-board robot paths.
export function migrateV1(v1) {
  const lib = { autos: {}, boards: {}, activeBoardId: '' };
  for (const [id, raw] of Object.entries(v1?.boards || {})) {
    let old;
    try { old = normalizeBoard(raw); } catch { continue; }
    const b = newBoardRec(old.name, old.updatedAt);
    b.id = id;
    for (const k of ROBOT_KEYS) {
      const r = old.robots[k];
      if (!r.path.segments.length) continue;
      const a = {
        id: uid(), name: `${old.name} ${ROBOT_LABEL[k]}`, team: r.team, alliance: allianceOf(k),
        path: r.path, markers: r.markers, robot: { size: r.size, maxVel: r.maxVel, maxAccel: r.maxAccel },
        createdAt: old.updatedAt, updatedAt: r.path.updatedAt || old.updatedAt, author: r.path.author || '',
      };
      lib.autos[a.id] = a; b.slots[k] = a.id; b.slotAt[k] = a.updatedAt;
    }
    lib.boards[id] = b;
  }
  if (!Object.keys(lib.boards).length) return emptyLib();
  lib.activeBoardId = lib.boards[v1.currentId] ? v1.currentId : Object.keys(lib.boards)[0];
  return lib;
}

export function loadLib(storage) {
  try { const raw = JSON.parse(storage.getItem(KEY)); if (raw?.boards) return normalizeLib(raw); } catch { /* fall through */ }
  try { const v1 = JSON.parse(storage.getItem(V1_KEY)); if (v1?.boards) return migrateV1(v1); } catch { /* none */ }
  return emptyLib();
}
export function saveLib(storage, lib) {
  try { storage.setItem(KEY, JSON.stringify(lib)); return true; } catch { return false; }
}

// ---- mutations ----
export const addAuto = (lib, a) => ({ ...lib, autos: { ...lib.autos, [a.id]: a } });
export const putAuto = addAuto;
export function patchAuto(lib, id, patch) {
  const a = lib.autos[id];
  return a ? addAuto(lib, { ...a, ...patch }) : lib;
}
export const duplicateAuto = (lib, id, now = Date.now(), author = '') => {
  const a = lib.autos[id];
  if (!a) return { lib, id: null };
  const c = normalizeAuto(JSON.parse(JSON.stringify(a)));
  c.id = uid(); c.name = `${a.name} copy`; c.createdAt = c.updatedAt = now; c.author = author;
  return { lib: addAuto(lib, c), id: c.id };
};

// Clears the auto from every board slot; the returned undo record restores both.
export function removeAuto(lib, id, at = Date.now()) {
  const auto = lib.autos[id];
  if (!auto) return { lib, undo: null };
  const { [id]: _gone, ...autos } = lib.autos;
  const slots = [], boards = {};
  for (const [bid, b] of Object.entries(lib.boards)) {
    const hit = ROBOT_KEYS.filter(k => b.slots[k] === id);
    if (!hit.length) { boards[bid] = b; continue; }
    slots.push(...hit.map(k => ({ boardId: bid, slot: k, at: b.slotAt[k] })));
    boards[bid] = { ...b, slots: { ...b.slots, ...Object.fromEntries(hit.map(k => [k, null])) }, slotAt: { ...b.slotAt, ...Object.fromEntries(hit.map(k => [k, at])) }, updatedAt: at };
  }
  return { lib: { ...lib, autos, boards }, undo: { auto, slots } };
}
export function restoreAuto(lib, undo, at = Date.now()) {
  let next = addAuto(lib, { ...undo.auto, updatedAt: Math.max(undo.auto.updatedAt, at) });
  for (const s of undo.slots) if (next.boards[s.boardId] && !next.boards[s.boardId].slots[s.slot]) next = assign(next, s.boardId, s.slot, undo.auto.id, at);
  return next;
}

// An auto fills one slot per board: assigning moves it. autoId null clears the slot.
export function assign(lib, boardId, slot, autoId, at = Date.now()) {
  const b = lib.boards[boardId];
  if (!b) return lib;
  const slots = { ...b.slots }, slotAt = { ...b.slotAt };
  if (autoId) for (const k of ROBOT_KEYS) if (slots[k] === autoId) { slots[k] = null; slotAt[k] = at; }
  slots[slot] = autoId; slotAt[slot] = at;
  return { ...lib, boards: { ...lib.boards, [boardId]: { ...b, slots, slotAt, updatedAt: at } } };
}
export const slotOf = (board, autoId) => ROBOT_KEYS.find(k => board.slots[k] === autoId) || null;

// ---- last-writer-wins merges (peers, snapshots) ----
export function mergeAuto(lib, inc) {
  const cur = lib.autos[inc.id];
  if (cur && !(inc.updatedAt > cur.updatedAt || (inc.updatedAt === cur.updatedAt && inc.author > cur.author))) return lib;
  return addAuto(lib, inc);
}
export function mergeBoard(lib, inc) {
  const cur = lib.boards[inc.id];
  if (!cur) return { ...lib, boards: { ...lib.boards, [inc.id]: inc } };
  const slots = { ...cur.slots }, slotAt = { ...cur.slotAt };
  let changed = false;
  for (const k of ROBOT_KEYS) if (inc.slotAt[k] > cur.slotAt[k]) { slots[k] = inc.slots[k]; slotAt[k] = inc.slotAt[k]; changed = true; }
  const name = inc.updatedAt > cur.updatedAt ? inc.name : cur.name;
  if (!changed && name === cur.name) return lib;
  return { ...lib, boards: { ...lib.boards, [inc.id]: { ...cur, name, slots, slotAt, updatedAt: Math.max(cur.updatedAt, inc.updatedAt) } } };
}
export function mergeLib(lib, raw) {
  const inc = normalizeLib(raw);
  let next = lib;
  for (const a of Object.values(inc.autos)) next = mergeAuto(next, a);
  for (const b of Object.values(inc.boards)) next = mergeBoard(next, b);
  return next;
}

// ---- library view helpers ----
export function teamsOf(lib) {
  return [...new Set(Object.values(lib.autos).map(a => a.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
export function listAutos(lib, { team = '', query = '', sort = 'new' } = {}) {
  const q = query.trim().toLowerCase();
  const out = Object.values(lib.autos).filter(a => (!team || a.team === team) && (!q || a.name.toLowerCase().includes(q) || a.team.toLowerCase().includes(q)));
  const by = { new: (a, b) => b.createdAt - a.createdAt, old: (a, b) => a.createdAt - b.createdAt, name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) }[sort] || (() => 0);
  return out.sort(by);
}

// ---- mirroring and the editor board ----
// The stored auto is never touched: a mismatched alliance renders through the 180-degree mirror.
export function autoForSlot(auto, slot) {
  if (auto.alliance === slotAlliance(slot)) return { path: auto.path, markers: auto.markers };
  return { path: mirrorPath(auto.path), markers: auto.markers.map(m => ({ ...m })) };
}

export function robotFromAuto(auto, slot) {
  const { path, markers } = autoForSlot(auto, slot);
  return {
    team: auto.team, color: SLOT_COLORS[slot], size: { ...auto.robot.size }, maxVel: auto.robot.maxVel, maxAccel: auto.robot.maxAccel,
    path: { ...path, updatedAt: auto.updatedAt, author: auto.author }, markers,
  };
}

// The slot the edited auto occupies: its board slot when the alliance matches, else its drawn alliance's first slot.
export function editSlot(lib, boardId, auto) {
  const b = lib.boards[boardId], at = b && slotOf(b, auto.id);
  return at && slotAlliance(at) === auto.alliance ? at : auto.alliance === 'blue' ? 'b1' : 'r1';
}

export function editorBoard(lib, boardId, autoId) {
  const auto = lib.autos[autoId], b = lib.boards[boardId], key = editSlot(lib, boardId, auto);
  const robots = {}, present = [];
  for (const k of ROBOT_KEYS) {
    const other = k !== key && b ? lib.autos[b.slots[k]] : null;
    const a = k === key ? auto : other && other.id !== autoId ? other : null;
    robots[k] = a ? robotFromAuto(a, k) : newRobot(k);
    if (a) present.push(k);
  }
  return { board: { id: auto.id, name: auto.name, updatedAt: auto.updatedAt, robots }, key, present };
}

// What a robot edit means for the stored auto (editor robots are drawn as-is for the edited auto).
export function autoFromRobot(auto, r) {
  return {
    ...auto, team: r.team, path: { ...r.path }, markers: r.markers,
    robot: { size: { ...r.size }, maxVel: r.maxVel, maxAccel: r.maxAccel }, updatedAt: r.path.updatedAt || auto.updatedAt, author: r.path.author || auto.author,
  };
}

export { DEFAULT_STARTS };

// ---- sharing ----
export const shareAuto = auto => ({ kind: 'autos', autos: [auto] });
export const shareBoard = (lib, boardId) => {
  const board = lib.boards[boardId];
  return { kind: 'autos', board, autos: ROBOT_KEYS.map(k => lib.autos[board.slots[k]]).filter(Boolean) };
};
// Accepts a v2 share payload or an old v1 board; returns fresh ids so a share never overwrites local work.
export function parseShared(raw) {
  if (raw?.kind === 'autos') {
    const idMap = new Map(), autos = raw.autos.map(a => { const n = normalizeAuto(a); const id = uid(); idMap.set(n.id, id); return { ...n, id }; });
    let board = null;
    if (raw.board) {
      board = normalizeBoardRec(raw.board);
      board.id = uid();
      for (const k of ROBOT_KEYS) board.slots[k] = idMap.get(board.slots[k]) || null;
    }
    return { autos, board };
  }
  const lib = migrateV1({ boards: { x: raw }, currentId: 'x' });
  const board = lib.boards.x;
  board.id = uid();
  return { autos: Object.values(lib.autos), board };
}
export function importShared(lib, parsed, now = Date.now()) {
  let next = lib;
  for (const a of parsed.autos) next = addAuto(next, a);
  if (parsed.board) next = { ...next, boards: { ...next.boards, [parsed.board.id]: { ...parsed.board, updatedAt: now } }, activeBoardId: parsed.board.id };
  return next;
}

export function autoFromPedro(p, { team = '', alliance = 'red', now = Date.now(), author = '' } = {}) {
  const a = newAuto({ name: p.name, team, alliance, now, author });
  return normalizeAuto({ ...a, path: { ...p.path, id: uid(), name: p.name }, markers: p.markers });
}
