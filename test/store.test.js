import test from 'node:test';
import assert from 'node:assert/strict';
import { newBoard, reduce, createStore } from '../src/store.js';

const seg = (x, y, h) => ({ kind: 'line', end: { x, y, h } });

test('mirror copies to other alliance with x -> 144 - x and h -> 180 - h', () => {
  let b = newBoard('t');
  b = reduce(b, { type: 'setStart', robot: 'r1', pose: { x: 24, y: 9, h: 90 } });
  b = reduce(b, { type: 'addSegment', robot: 'r1', segment: { kind: 'curve', controls: [{ x: 30, y: 20 }, { x: 40, y: 30 }], end: { x: 60, y: 40, h: 0 } } });
  b = reduce(b, { type: 'addMarker', robot: 'r1', segIndex: 0, label: 'park', waitS: 1.5 });
  b = reduce(b, { type: 'mirror', from: 'r1', at: 9, author: 'k' });
  const m = b.robots.b1;
  assert.deepEqual(m.path.startPose, { x: 120, y: 9, h: 90 });
  assert.deepEqual(m.path.segments[0].controls, [{ x: 114, y: 20 }, { x: 104, y: 30 }]);
  assert.deepEqual(m.path.segments[0].end, { x: 84, y: 40, h: 180 });
  assert.deepEqual(m.markers, [{ segIndex: 0, label: 'park', waitS: 1.5 }]);
  assert.deepEqual([m.path.updatedAt, m.path.author], [9, 'k']);
  assert.equal(b.robots.r1.path.segments[0].end.x, 60);
});

test('undo/redo restores snapshots and restamps for peers', () => {
  let t = 100;
  const s = createStore(newBoard('t'), { author: 'me', now: () => ++t });
  s.dispatch({ type: 'addSegment', robot: 'r2', segment: seg(10, 10, 0) });
  s.dispatch({ type: 'addSegment', robot: 'r2', segment: seg(20, 10, 0) });
  assert.equal(s.get().robots.r2.path.segments.length, 2);
  s.undo();
  assert.equal(s.get().robots.r2.path.segments.length, 1);
  assert.ok(s.get().robots.r2.path.updatedAt > 102);
  s.redo();
  assert.equal(s.get().robots.r2.path.segments.length, 2);
  s.undo(); s.undo();
  assert.equal(s.get().robots.r2.path.segments.length, 0);
  assert.equal(s.canUndo(), false);
});

test('coalesced drags are one undo step', () => {
  const s = createStore(newBoard('t'));
  s.dispatch({ type: 'addSegment', robot: 'r1', segment: seg(10, 10, 0) });
  for (let i = 1; i <= 5; i++) s.dispatch({ type: 'moveHandle', robot: 'r1', segIndex: 0, handle: 'end', x: 10 + i, y: 10, coalesce: 'd1' });
  assert.equal(s.get().robots.r1.path.segments[0].end.x, 15);
  s.undo();
  assert.equal(s.get().robots.r1.path.segments[0].end.x, 10);
});

test('remoteUpdate is last-writer-wins per path and skips history', () => {
  const s = createStore(newBoard('t'), { author: 'a', now: () => 50 });
  s.dispatch({ type: 'addSegment', robot: 'r1', segment: seg(10, 10, 0) });
  const mine = s.get().robots.r1;
  const older = { ...mine, path: { ...mine.path, updatedAt: 10, author: 'z', segments: [] } };
  s.dispatch({ type: 'remoteUpdate', key: 'r1', robot: older });
  assert.equal(s.get().robots.r1.path.segments.length, 1);
  const newer = { ...older, path: { ...older.path, updatedAt: 60 } };
  s.dispatch({ type: 'remoteUpdate', key: 'r1', robot: newer });
  assert.equal(s.get().robots.r1.path.segments.length, 0);
  s.undo();
  assert.equal(s.get().robots.r1.path.segments.length, 0);
  assert.equal(s.canUndo(), false);
});

test('deleteSegment drops and reindexes markers', () => {
  let b = newBoard('t');
  for (const x of [10, 20, 30]) b = reduce(b, { type: 'addSegment', robot: 'r1', segment: seg(x, 5, 0) });
  b = reduce(b, { type: 'addMarker', robot: 'r1', segIndex: 0, label: 'a', waitS: 1 });
  b = reduce(b, { type: 'addMarker', robot: 'r1', segIndex: 2, label: 'c', waitS: 1 });
  b = reduce(b, { type: 'deleteSegment', robot: 'r1', segIndex: 0 });
  assert.deepEqual(b.robots.r1.markers, [{ segIndex: 1, label: 'c', waitS: 1 }]);
  assert.deepEqual(b.robots.r1.path.segments[0].start, { x: 120, y: 9, h: 90 });
});
