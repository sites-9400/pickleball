// Live view with hybrid matchmaking: court group labels, labelled Up Next cards, and the
// waiting list split into Men / Women / Not tagged. Hybrid off shows none of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadView } from './viewhtml-harness.mjs';

const G = 'mmmmmmffffff??';
const players = [...G].map((g, i) => ({ id: i + 1, name: 'P' + (i + 1), skill: 'intermediate', present: true, lastPlayedRound: -1, ...(g === '?' ? {} : { gender: g }) }));
const session = (hybrid) => ({
  mode: { matchmaking: 'waittime', format: 'doubles' }, hybrid, players,
  courtDefs: [{ id: 1, name: 'Court 1', group: 'men' }, { id: 2, name: 'Court 2', group: 'women' }, { id: 3, name: 'Court 3', group: 'mixed' }],
  courts: [{ id: 1, name: 'Court 1', team1: [1, 2], team2: [3, 4], submitted: false, round: 1, startedAt: Date.now() }],
  matchQueue: [{ group: 'women', team1: [7, 8], team2: [9, 10] }],
  queueOrder: players.map(p => p.id), gameHistory: [],
});

test('hybrid: courts show their group', () => {
  const v = loadView();
  v.call('renderCourts', session(true));
  const html = v.captured['vCourts'];
  assert.match(html, /Court 1[\s\S]*?Men's/);
  assert.match(html, /Court 2[\s\S]*?Women's/);
  assert.match(html, /Court 3[\s\S]*?Mixed/);
});

test('hybrid: Up Next labelled by group, waiting split by gender', () => {
  const v = loadView();
  v.call('renderQueue', session(true));
  const html = v.captured['vQueue'];
  assert.match(html, /Women's[\s\S]*?P7/);
  assert.match(html, />Men<[\s\S]*?P5[\s\S]*?P6/);
  assert.match(html, />Women<[\s\S]*?P11[\s\S]*?P12/);
  assert.match(html, />Not tagged<[\s\S]*?P13[\s\S]*?P14/);
});

test('hybrid off: no group labels or split', () => {
  const v = loadView();
  v.call('renderCourts', session(false));
  v.call('renderQueue', session(false));
  assert.doesNotMatch(v.captured['vCourts'], /Men's|Women's|Mixed/);
  assert.doesNotMatch(v.captured['vQueue'], /Not tagged|Women's/);
});
