// view.html round-robin standings — the viewer must feed computeStandings the
// same effective match set as the admin (app.html passes tournament.matches
// through untouched, so the skipped flag excludes cancelled matches there).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadView } from './viewhtml-harness.mjs';
import * as T from '../tournament.js';

// A round-robin session snapshot as it arrives from Firebase: skipped matches
// carry -1 sentinel scores (app.html serializes '' as -1) plus skipped: true.
function rrSession(matches) {
  return {
    mode: { matchmaking: 'roundrobin' },
    players: [
      { id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Ben' },
      { id: 'p3', name: 'Cai' }, { id: 'p4', name: 'Dee' },
      { id: 'p5', name: 'Eli' }, { id: 'p6', name: 'Fay' },
    ],
    tournament: {
      started: true,
      teams: [
        { players: ['p1', 'p2'] },
        { players: ['p3', 'p4'] },
        { players: ['p5', 'p6'] },
      ],
      matches,
    },
  };
}

const MATCHES = [
  { id: 1, teamA: 0, teamB: 1, score1: 11, score2: 5, submitted: true },
  // cancelled -> skipped: submitted, skipped, '' scores serialized as -1
  { id: 2, teamA: 0, teamB: 2, score1: -1, score2: -1, submitted: true, skipped: true },
  // not yet played
  { id: 3, teamA: 1, teamB: 2, score1: -1, score2: -1, submitted: false },
];

test('viewer standings exclude skipped matches, matching the admin', () => {
  let seen = null;
  const { call } = loadView({
    computeStandings: (teamCount, matches) => {
      seen = matches;
      return T.computeStandings(teamCount, matches);
    },
  });
  call('renderViewStandings', rrSession(MATCHES));

  assert.ok(seen, 'renderViewStandings should call computeStandings');
  const adminRows = T.computeStandings(3, MATCHES);
  const viewerRows = T.computeStandings(3, seen);
  assert.deepEqual(viewerRows, adminRows,
    'viewer must compute the same standings as the admin');
  // The concrete failure mode: the skipped match must not enter as a played 0-0 tie.
  assert.equal(viewerRows.find(r => r.team === 0).played, 1,
    'team 0 played one real match; the skipped match must not count');
});

test('viewer standings table renders W/L/Diff from real matches', () => {
  const { call, captured } = loadView();
  call('renderViewStandings', rrSession(MATCHES));
  const html = captured.vStandings || '';
  assert.match(html, /Round-Robin Standings/);
  // Team 0 (Ana & Ben) won 11-5: 1 W, 0 L, +6
  assert.match(html, /<td>Ana &amp; Ben<\/td><td>1<\/td><td>0<\/td><td>\+6<\/td>/);
  // Team 1 (Cai & Dee) lost: 0 W, 1 L, -6
  assert.match(html, /<td>Cai &amp; Dee<\/td><td>0<\/td><td>1<\/td><td>-6<\/td>/);
});
