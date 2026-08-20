import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeImportedNames } from '../tournament.js';

// A past session's players array — the shape stored under sessions/{id}/players.
const source = [
  { id: 7, name: 'Eve',   present: true,  gamesPlayed: 12, wins: 8, losses: 4, points: 120, pointsAgainst: 90, skill: 'advanced', partnerId: 9 },
  { id: 9, name: 'Jude',  present: true,  gamesPlayed: 12, wins: 4, losses: 8, points: 90,  pointsAgainst: 120, skill: 'beginner' },
];

test('imports names as fresh players with reset stats and new ids', () => {
  const res = mergeImportedNames(source, [], 3);
  assert.equal(res.added, 2);
  assert.equal(res.skipped, 0);
  assert.equal(res.nextCounter, 5);              // 3 -> +1, +2
  assert.deepEqual(res.players.map(p => p.id), [4, 5]);
  assert.deepEqual(res.players.map(p => p.name), ['Eve', 'Jude']);
  const eve = res.players[0];
  assert.equal(eve.present, false);              // everyone checks in fresh
  assert.equal(eve.gamesPlayed, 0);
  assert.equal(eve.wins, 0);
  assert.equal(eve.losses, 0);
  assert.equal(eve.points, 0);
  assert.equal(eve.pointsAgainst, 0);
  assert.equal(eve.lastPlayedRound, -1);
  assert.equal(eve.partnerId, null);             // no pair lock-in carried over
  assert.deepEqual(eve.events, []);
  assert.equal(eve.via, 'import');
});

test('does NOT carry over skill — everyone imports as intermediate', () => {
  const res = mergeImportedNames(source, [], 0);
  assert.deepEqual(res.players.map(p => p.skill), ['intermediate', 'intermediate']);
});

test('skips names already present (case-insensitive) and counts them', () => {
  const existing = [{ id: 1, name: 'eve' }];
  const res = mergeImportedNames(source, existing, 1);
  assert.equal(res.added, 1);
  assert.equal(res.skipped, 1);
  assert.deepEqual(res.players.map(p => p.name), ['Jude']);
  assert.deepEqual(res.players.map(p => p.id), [2]);
  assert.equal(res.nextCounter, 2);
});

test('skips intra-source duplicates and blank/invalid names', () => {
  const messy = [
    { name: 'Eve' },
    { name: 'eve' },        // dupe within source
    { name: '  ' },         // blank
    { name: '' },           // empty
    {},                     // no name
    null,                   // junk
    { name: 'Ada' },
  ];
  const res = mergeImportedNames(messy, [], 10);
  assert.deepEqual(res.players.map(p => p.name), ['Eve', 'Ada']);
  assert.equal(res.added, 2);
  assert.equal(res.skipped, 1);   // only the real-name dupe 'eve' counts as skipped
});

test('tolerates missing/sentinel source without throwing', () => {
  assert.deepEqual(mergeImportedNames(null, [], 0), { players: [], added: 0, skipped: 0, nextCounter: 0 });
  assert.deepEqual(mergeImportedNames([{ _empty: true }], [], 0), { players: [], added: 0, skipped: 0, nextCounter: 0 });
});
