import test from 'node:test';
import assert from 'node:assert/strict';
import { bezierPoint, bezierLength, tangentAngle, rdp, fitStroke, footprint, polysOverlap, normDeg } from '../src/geometry.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('line length is exact', () => {
  assert.equal(bezierLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
});

test('degree-elevated line has length 30', () => {
  near(bezierLength([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]), 30);
});

test('cubic midpoint', () => {
  const p = bezierPoint([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }], 0.5);
  assert.deepEqual(p, { x: 5, y: 7.5 });
});

test('tangent angle and heading wrap', () => {
  assert.equal(tangentAngle([{ x: 0, y: 0 }, { x: 0, y: 10 }], 0.5), 90);
  assert.equal(normDeg(270), -90);
  assert.equal(normDeg(-180), 180);
});

test('rdp keeps corners only', () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
  assert.deepEqual(rdp(pts, 1), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
});

test('stroke fit: straight, L-shape, arc', () => {
  const line = Array.from({ length: 21 }, (_, i) => ({ x: i * 2, y: 10 + (i % 2) * 0.2 }));
  assert.deepEqual(fitStroke(line).map(s => s.kind), ['line']);
  const L = [...Array.from({ length: 11 }, (_, i) => ({ x: i * 3, y: 0 })), ...Array.from({ length: 10 }, (_, i) => ({ x: 30, y: (i + 1) * 3 }))];
  const segs = fitStroke(L);
  assert.deepEqual(segs.map(s => s.kind), ['line', 'line']);
  assert.deepEqual(segs[0].end, { x: 30, y: 0 });
  const arc = Array.from({ length: 19 }, (_, i) => ({ x: 40 * Math.cos(i * 5 * Math.PI / 180), y: 40 * Math.sin(i * 5 * Math.PI / 180) }));
  const a = fitStroke(arc);
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, 'curve');
  assert.equal(a[0].controls.length, 2);
  near(a[0].end.x, 0, 0.01); near(a[0].end.y, 40, 0.01);
});

test('footprint overlap', () => {
  const a = footprint(0, 0, 0, 18, 18), b = footprint(17, 0, 45, 18, 18), c = footprint(18, 0, 0, 18, 18), d = footprint(40, 0, 0, 18, 18);
  assert.equal(polysOverlap(a, b), true);
  assert.equal(polysOverlap(a, c), false);
  assert.equal(polysOverlap(a, d), false);
});
