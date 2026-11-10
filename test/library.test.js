import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newAuto, emptyLib, addAuto, assign, removeAuto, restoreAuto, migrateV1, mergeAuto, mergeBoard, listAutos, teamsOf,
  robotFromAuto, editorBoard, parseShared, shareBoard, loadLib, saveLib, normalizeAuto,
} from '../src/library.js';
import { newBoard, reduce } from '../src/store.js';

const seg = (x, y, h) => ({ kind: 'line', end: { x, y, h } });
const mk = (name, team, alliance, t) => ({ ...newAuto({ name, team, alliance, now: t }) });

test('stored auto is never mutated when mirrored into the other alliance slot', () => {
  const a = mk('A', '118', 'red', 1);
  const snap = JSON.stringify(a);
  const r = robotFromAuto(a, 'b1');
  assert.deepEqual(r.path.startPose, { x: 84, y: 135, h: -90 });
  assert.equal(JSON.stringify(a), snap);
  assert.deepEqual(robotFromAuto(a, 'r2').path.startPose, { x: 60, y: 9, h: 90 });
});

test('assign moves an auto between slots; removeAuto clears slots and undo restores', () => {
  let lib = emptyLib();
  const a = mk('A', '1', 'red', 1), b = mk('B', '2', 'blue', 2);
  lib = addAuto(addAuto(lib, a), b);
  const bid = lib.activeBoardId;
  lib = assign(lib, bid, 'r1', a.id, 10);
  lib = assign(lib, bid, 'r2', a.id, 11);
  lib = assign(lib, bid, 'b1', b.id, 12);
  assert.deepEqual(lib.boards[bid].slots, { r1: null, r2: a.id, b1: b.id, b2: null });
  const { lib: gone, undo } = removeAuto(lib, a.id, 20);
  assert.equal(gone.autos[a.id], undefined);
  assert.equal(gone.boards[bid].slots.r2, null);
  const back = restoreAuto(gone, undo, 21);
  assert.equal(back.autos[a.id].name, 'A');
  assert.equal(back.boards[bid].slots.r2, a.id);
});

test('v1 boards migrate to autos named "<board> <slot>" and an assigned board', () => {
  let b = newBoard('Q1');
  b = reduce(b, { type: 'addSegment', robot: 'r1', segment: seg(60, 40, 90) });
  b = reduce(b, { type: 'addSegment', robot: 'b2', segment: seg(24, 100, 270) });
  b = reduce(b, { type: 'setRobot', robot: 'b2', patch: { team: '36077' } });
  const lib = migrateV1({ boards: { [b.id]: b }, currentId: b.id });
  const autos = Object.values(lib.autos);
  assert.deepEqual(autos.map(a => [a.name, a.team, a.alliance]).sort(), [['Q1 Blue 2', '36077', 'blue'], ['Q1 Red 1', '', 'red']]);
  const bd = lib.boards[b.id];
  assert.equal(lib.autos[bd.slots.r1].path.segments[0].end.y, 40);
  assert.equal(bd.slots.r2, null);
  assert.equal(lib.activeBoardId, b.id);
});

test('loadLib reads v2, falls back to migrating v1, and survives garbage', () => {
  const store = {};
  const st = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const b = reduce(newBoard('Old'), { type: 'addSegment', robot: 'r2', segment: seg(100, 40, 90) });
  store['bubblotics.autosim.v1'] = JSON.stringify({ boards: { [b.id]: b }, currentId: b.id });
  let lib = loadLib(st);
  assert.equal(Object.values(lib.autos)[0].name, 'Old Red 2');
  saveLib(st, lib);
  store['bubblotics.autosim.v1'] = 'garbage';
  assert.deepEqual(loadLib(st), lib);
  assert.equal(Object.keys(loadLib({ getItem: () => '{{' }).boards).length, 1);
});

test('last-writer-wins per auto and per board slot', () => {
  let lib = emptyLib();
  const a = mk('A', '1', 'red', 5);
  lib = addAuto(lib, a);
  assert.equal(mergeAuto(lib, { ...a, name: 'old', updatedAt: 4 }), lib);
  assert.equal(mergeAuto(lib, { ...a, name: 'new', updatedAt: 6 }).autos[a.id].name, 'new');
  const bid = lib.activeBoardId, base = lib.boards[bid];
  lib = assign(lib, bid, 'r1', a.id, 10);
  const inc = { ...base, slots: { ...base.slots, r1: 'x', b2: 'y' }, slotAt: { ...base.slotAt, r1: 9, b2: 11 } };
  const m = mergeBoard(lib, inc);
  assert.deepEqual(m.boards[bid].slots, { r1: a.id, r2: null, b1: null, b2: 'y' });
});

test('filter by team, search name or team, sort', () => {
  let lib = emptyLib();
  for (const a of [mk('Zeta', '118', 'red', 3), mk('Alpha', '35858', 'blue', 1), mk('Mid 118', '35857', 'red', 2)]) lib = addAuto(lib, a);
  assert.deepEqual(teamsOf(lib), ['118', '35857', '35858']);
  assert.deepEqual(listAutos(lib, { team: '118' }).map(a => a.name), ['Zeta']);
  assert.deepEqual(listAutos(lib, { query: '118' }).map(a => a.name), ['Zeta', 'Mid 118']);
  assert.deepEqual(listAutos(lib, { sort: 'old' }).map(a => a.name), ['Alpha', 'Mid 118', 'Zeta']);
  assert.deepEqual(listAutos(lib, { sort: 'name' }).map(a => a.name), ['Alpha', 'Mid 118', 'Zeta']);
});

test('editor board shows the edited auto as drawn and mirrors the other slots', () => {
  let lib = emptyLib();
  const a = mk('A', '1', 'red', 1), b = mk('B', '2', 'red', 2);
  lib = addAuto(addAuto(lib, a), b);
  const bid = lib.activeBoardId;
  lib = assign(assign(lib, bid, 'r1', a.id, 3), bid, 'b2', b.id, 4);
  const { board, key, present } = editorBoard(lib, bid, a.id);
  assert.equal(key, 'r1');
  assert.deepEqual(present, ['r1', 'b2']);
  assert.deepEqual(board.robots.b2.path.startPose, { x: 84, y: 135, h: -90 });
});

test('share payloads: board with autos, remapped ids, and old v1 boards', () => {
  let lib = emptyLib();
  const a = mk('A', '9', 'blue', 1);
  lib = assign(addAuto(lib, a), lib.activeBoardId, 'b1', a.id, 2);
  const p = parseShared(JSON.parse(JSON.stringify(shareBoard(lib, lib.activeBoardId))));
  assert.equal(p.autos.length, 1);
  assert.notEqual(p.autos[0].id, a.id);
  assert.equal(p.board.slots.b1, p.autos[0].id);
  const old = parseShared(reduce(newBoard('Q'), { type: 'addSegment', robot: 'r1', segment: seg(60, 40, 90) }));
  assert.equal(old.autos[0].name, 'Q Red 1');
  assert.equal(normalizeAuto(p.autos[0]).team, '9');
});
