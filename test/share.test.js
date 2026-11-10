import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBoard, decodeBoard, parseHash, shareUrl } from '../src/share.js';
import { newBoard, reduce, normalizeBoard } from '../src/store.js';

test('encode/decode round-trip', async () => {
  let b = newBoard('Q12 vs 1234');
  b = reduce(b, { type: 'addSegment', robot: 'b2', segment: { kind: 'curve', controls: [{ x: 1, y: 2 }, { x: 3, y: 4 }], end: { x: 50, y: 60, h: 90 } }, at: 5, author: 'a' });
  const code = await encodeBoard(b);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeBoard(code), b);
  assert.deepEqual(normalizeBoard(await decodeBoard(code)).robots.b2.path.segments[0].controls, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
});

test('decode rejects garbage', async () => {
  await assert.rejects(decodeBoard('AAAA'));
});

test('hash parsing', () => {
  assert.deepEqual(parseHash('#b=abc_-1'), { kind: 'b', value: 'abc_-1' });
  assert.deepEqual(parseHash('#room=K7Q2X'), { kind: 'room', value: 'K7Q2X' });
  assert.equal(parseHash('#x=1'), null);
  assert.equal(shareUrl('http://h/p/#old', 'zz'), 'http://h/p/#b=zz');
});
