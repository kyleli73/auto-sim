import test from 'node:test';
import assert from 'node:assert/strict';
import { startIssues } from '../src/field.js';

const size = { w: 18, l: 18 };

test('start legality: Red 1 default is legal, (36, 9, 90) is in the loading zone', () => {
  assert.deepEqual(startIssues('r1', { x: 60, y: 9, h: 90 }, size), []);
  assert.deepEqual(startIssues('r1', { x: 36, y: 9, h: 90 }, size), ['inside a LOADING ZONE']);
});
