import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams } from '../tournament.js';

test('buildTeams: doubles pairs in order, no leftover', () => {
  const r = buildTeams(['a', 'b', 'c', 'd'], 2);
  assert.deepEqual(r.teams, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(r.leftover, []);
});

test('buildTeams: doubles with odd remainder leaves leftover', () => {
  const r = buildTeams(['a', 'b', 'c', 'd', 'e'], 2);
  assert.deepEqual(r.teams, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(r.leftover, ['e']);
});

test('buildTeams: singles makes one-player teams', () => {
  const r = buildTeams(['a', 'b', 'c'], 1);
  assert.deepEqual(r.teams, [['a'], ['b'], ['c']]);
  assert.deepEqual(r.leftover, []);
});
