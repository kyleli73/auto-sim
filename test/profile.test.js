import test from 'node:test';
import assert from 'node:assert/strict';
import { trapezoid, distanceAt, timelineFor, poseAt, findConflicts } from '../src/profile.js';
import { newBoard, reduce } from '../src/store.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('trapezoid for 100 in at 50 in/s, 40 in/s^2', () => {
  const p = trapezoid(100, 50, 40);
  assert.deepEqual([p.tA, p.tC, p.T, p.vPeak], [1.25, 0.75, 3.25, 50]);
  assert.equal(distanceAt(p, 1.25), 31.25);
  assert.equal(distanceAt(p, 3.25), 100);
});

test('triangular profile when too short to reach max velocity', () => {
  const p = trapezoid(20, 50, 40);
  assert.equal(p.tC, 0);
  near(p.T, 1.4142135623730951, 1e-12);
  near(distanceAt(p, p.T / 2), 10, 1e-9);
});

function lineBoard() {
  let b = newBoard('t');
  b = reduce(b, { type: 'setStart', robot: 'r1', pose: { x: 24, y: 9, h: 0 }, at: 1 });
  b = reduce(b, { type: 'addSegment', robot: 'r1', segment: { kind: 'line', end: { x: 124, y: 9, h: 0 } }, at: 2 });
  return reduce(b, { type: 'addMarker', robot: 'r1', segIndex: 0, label: 'score', waitS: 2, at: 3 });
}

test('straight line timing with marker wait', () => {
  const r = lineBoard().robots.r1;
  assert.equal(timelineFor(r).total, 5.25);
  assert.deepEqual(poseAt(r, 1.25), { x: 55.25, y: 9, h: 0 });
  assert.deepEqual(poseAt(r, 4.25), { x: 124, y: 9, h: 0 });
  assert.deepEqual(poseAt(r, 99), { x: 124, y: 9, h: 0 });
  assert.deepEqual(poseAt(r, 0), { x: 24, y: 9, h: 0 });
});

test('conflict detection when two robots start overlapping', () => {
  let b = lineBoard();
  b = reduce(b, { type: 'setStart', robot: 'r2', pose: { x: 30, y: 9, h: 0 }, at: 4 });
  const c = findConflicts(b, { step: 0.5, tEnd: 2 }).filter(x => x.b === 'r2');
  assert.deepEqual(c, [{ a: 'r1', b: 'r2', t0: 0, t1: 1 }]);
});
