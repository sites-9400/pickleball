import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams, generateRoundRobin } from '../tournament.js';

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

function pairKey(m) { return [m.teamA, m.teamB].sort((a, b) => a - b).join('-'); }

test('generateRoundRobin: 4 teams single pass = 6 unique matches', () => {
  const s = generateRoundRobin(4, 1);
  assert.equal(s.length, 6);
  const keys = new Set(s.map(pairKey));
  assert.equal(keys.size, 6); // every pair exactly once
});

test('generateRoundRobin: 4 teams has 3 rounds of 2 matches each', () => {
  const s = generateRoundRobin(4, 1);
  const byRound = {};
  for (const m of s) (byRound[m.round] ||= []).push(m);
  assert.deepEqual(Object.keys(byRound).map(Number).sort((a, b) => a - b), [1, 2, 3]);
  for (const r of Object.values(byRound)) assert.equal(r.length, 2);
});

test('generateRoundRobin: no team plays twice in one round', () => {
  const s = generateRoundRobin(6, 1);
  const byRound = {};
  for (const m of s) (byRound[m.round] ||= []).push(m);
  for (const matches of Object.values(byRound)) {
    const seen = new Set();
    for (const m of matches) {
      assert.ok(!seen.has(m.teamA) && !seen.has(m.teamB), 'team double-booked in a round');
      seen.add(m.teamA); seen.add(m.teamB);
    }
  }
});

test('generateRoundRobin: 5 teams (odd) = 10 matches, one bye per round', () => {
  const s = generateRoundRobin(5, 1);
  assert.equal(s.length, 10); // 5*4/2
});

test('generateRoundRobin: double pass = twice the matches', () => {
  assert.equal(generateRoundRobin(4, 2).length, 12);
});
