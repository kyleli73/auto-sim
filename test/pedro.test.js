import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePedro, toPP } from '../src/pedro.js';
import { segPoints, bezierPoint, splitBezier } from '../src/geometry.js';

const strip = a => ({
  start: a.path.startPose,
  segs: a.path.segments.map(s => ({ kind: s.kind, controls: s.controls, end: s.end, mode: s.heading.mode, ...(s.heading.reverse ? { reverse: true } : {}) })),
});

test('current .pp: atomic lines, heading types and a sequence wait', () => {
  const pp = {
    startPoint: { x: 56, y: 8, headingDeg: 90 },
    lines: [
      { id: 'a', name: 'Path 1', kind: 'atomic', endPoint: { x: 56, y: 36 }, controlPoints: [], heading: { type: 'linear', startDeg: 90, endDeg: 180 } },
      { id: 'b', name: 'Path 2', kind: 'atomic', endPoint: { x: 20, y: 84 }, controlPoints: [{ x: 30, y: 60 }], heading: { type: 'constant', degrees: 45 } },
      { id: 'c', name: 'Path 3', kind: 'atomic', endPoint: { x: 20, y: 110 }, controlPoints: [], heading: { type: 'tangential', reverse: false } },
    ],
    sequence: [{ kind: 'path', lineId: 'a' }, { kind: 'wait', name: 'Launch', durationMs: 1500 }, { kind: 'path', lineId: 'c' }, { kind: 'path', lineId: 'b' }],
  };
  const { autos, warnings } = parsePedro(JSON.stringify(pp), 'my-auto.pp');
  assert.deepEqual(warnings, []);
  assert.equal(autos[0].name, 'my-auto');
  const s = strip(autos[0]);
  assert.deepEqual(s.start, { x: 56, y: 8, h: 90 });
  // sequence order wins over lines order: a, c, b
  assert.deepEqual(s.segs.map(x => [x.kind, x.end.x, x.end.y, x.end.h, x.mode]), [
    ['line', 56, 36, 180, 'linear'], ['line', 20, 110, 115.94, 'tangential'], ['curve', 20, 84, 45, 'constant'],
  ]);
  assert.deepEqual(autos[0].markers, [{ segIndex: 0, label: 'Launch', waitS: 1.5 }]);
});

test('compound lines flatten in order and inherit the compound heading', () => {
  const pp = {
    startPoint: { x: 10, y: 10, headingDeg: 0 },
    lines: [{
      id: 'c', kind: 'compound', heading: { type: 'constant', degrees: 90 }, waitAfterMs: 500,
      segments: [
        { id: 'c1', kind: 'atomic', endPoint: { x: 30, y: 10 }, controlPoints: [] },
        { id: 'c2', kind: 'atomic', endPoint: { x: 30, y: 40 }, controlPoints: [], heading: { type: 'linear', startDeg: 90, endDeg: 180 } },
      ],
    }],
  };
  const { autos } = parsePedro(JSON.stringify(pp), 'c.pp');
  const s = strip(autos[0]);
  assert.deepEqual(s.segs.map(x => [x.end.x, x.end.y, x.end.h, x.mode]), [[30, 10, 90, 'constant'], [30, 40, 180, 'linear']]);
  assert.deepEqual(autos[0].markers, [{ segIndex: 1, label: 'Wait', waitS: 0.5 }]);
});

test('legacy: endpoint heading, string heading, startPoint linear', () => {
  const pp = {
    startPoint: { x: 8, y: 8, heading: 'linear', startDeg: 45, endDeg: 90 },
    lines: [
      { id: 'a', endPoint: { x: 40, y: 8, heading: 'tangential', reverse: true }, controlPoints: [] },
      { id: 'b', endPoint: { x: 40, y: 40 }, controlPoints: [], heading: 'constant', degrees: 270 },
      { id: 'c', endPoint: { x: 10, y: 40, heading: 'linear', startDeg: 270, endDeg: 180 }, controlPoints: [], waitAfterMs: 2000 },
    ],
  };
  const { autos, warnings } = parsePedro(JSON.stringify(pp), 'old.pp');
  assert.deepEqual(warnings, []);
  const s = strip(autos[0]);
  assert.equal(s.start.h, 45);
  assert.deepEqual(s.segs.map(x => [x.mode, x.end.h, !!x.reverse]), [['tangential', 180, true], ['constant', -90, false], ['linear', 180, false]]);
  assert.deepEqual(autos[0].markers, [{ segIndex: 2, label: 'Wait', waitS: 2 }]);
});

test('piecewise heading imports as linear with a warning; through points warn', () => {
  const pp = {
    startPoint: { x: 8, y: 8, headingDeg: 0 },
    lines: [{
      id: 'a', kind: 'atomic', endPoint: { x: 60, y: 60 }, controlPoints: [], throughPoints: [{ x: 30, y: 30 }],
      heading: { type: 'piecewise', piecewiseHeading: { segments: [{ startDeg: 10, endDeg: 50 }, { startDeg: 50, endDeg: 120 }] } },
    }],
  };
  const { autos, warnings } = parsePedro(JSON.stringify(pp), 'p.pp');
  assert.equal(warnings.length, 2);
  assert.match(warnings.join('|'), /piecewise/);
  assert.match(warnings.join('|'), /through points/);
  assert.deepEqual(strip(autos[0]).segs[0].end, { x: 60, y: 60, h: 120 });
  assert.equal(strip(autos[0]).segs[0].mode, 'linear');
});

const JAVA = `
public class Auto {
  private final Pose startPose = new Pose(56, 8, Math.toRadians(90));
  private final Pose scorePose = new Pose(60, 20, Math.toRadians(135)); // goal
  private Pose parkPose;
  public void build() {
    parkPose = new Pose(20, 30);
    path1 = follower.pathBuilder()
      .addPath(new BezierLine(startPose, scorePose))
      .setLinearHeadingInterpolation(startPose.getHeading(), Math.toRadians(135))
      .build();
    path2 = follower.pathBuilder()
      .addPath(new BezierCurve(scorePose, new Pose(40, 40), parkPose))
      .setTangentHeadingInterpolation()
      .setReversed(true)
      .addPath(new BezierLine(new Pose(20, 30), new Point(20, 60, Point.CARTESIAN)))
      .setConstantHeadingInterpolation(Math.toRadians(180))
      .build();
  }
}`;
test('Java: pose variables, one auto per pathBuilder chain, heading calls', () => {
  const { autos } = parsePedro(JAVA, 'Auto.java');
  assert.equal(autos.length, 2);
  assert.deepEqual(autos.map(a => a.name), ['Auto path1', 'Auto path2']);
  const a = strip(autos[0]);
  assert.deepEqual(a.start, { x: 56, y: 8, h: 90 });
  assert.deepEqual(a.segs, [{ kind: 'line', controls: [], end: { x: 60, y: 20, h: 135 }, mode: 'linear' }]);
  const b = strip(autos[1]);
  assert.deepEqual(b.start, { x: 60, y: 20, h: 135 });
  assert.deepEqual(b.segs[0].controls, [{ x: 40, y: 40 }]);
  assert.deepEqual([b.segs[0].mode, b.segs[0].reverse, b.segs[0].end.x, b.segs[0].end.y], ['tangential', true, 20, 30]);
  assert.deepEqual([b.segs[1].mode, b.segs[1].end], ['constant', { x: 20, y: 60, h: 180 }]);
});

test('unrecognized text produces a warning, not a crash', () => {
  const r = parsePedro('hello world', 'x.txt');
  assert.deepEqual(r.autos, []);
  assert.equal(r.warnings.length, 1);
});

test('toPP -> parsePedro keeps geometry, headings and waits', () => {
  const src = parsePedro(JAVA, 'Auto.java').autos[1];
  src.markers = [{ segIndex: 0, label: 'Launch', waitS: 1.25 }];
  const text = toPP(src);
  const j = JSON.parse(text);
  assert.deepEqual(j.startPoint, { x: 60, y: 20, headingDeg: 135 });
  assert.deepEqual(j.sequence.map(x => x.kind), ['path', 'wait', 'path']);
  assert.deepEqual(j.sequence[1], { kind: 'wait', name: 'Launch', durationMs: 1250 });
  assert.equal(j.lines[0].heading.type, 'tangential');
  const back = parsePedro(text, 'rt.pp');
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(strip(back.autos[0]), strip(src));
  assert.deepEqual(back.autos[0].markers, src.markers);
});

test('splitBezier preserves the curve shape', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 50, y: 40 }, { x: 60, y: 0 }];
  const { left, right } = splitBezier(pts, 0.3);
  assert.deepEqual(left[3], right[0]);
  const at = (p, t) => { const q = bezierPoint(p, t); return [Math.round(q.x * 1e6) / 1e6, Math.round(q.y * 1e6) / 1e6]; };
  assert.deepEqual(at(left, 0.5), at(pts, 0.15));
  assert.deepEqual(at(right, 0.5), at(pts, 0.65));
  void segPoints;
});
