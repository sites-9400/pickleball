// Swapping a player on a COURT re-picks the auto-built upcoming matches:
// they were chosen from a pool the swap just changed, so stale picks (e.g. an
// already-played player queued while zero-game players wait) must not survive.
// Directly editing a queued match must NOT trigger a wholesale re-pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = id => ({
  id, name: id.toUpperCase(), present: true, gamesPlayed: 0, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate',
});

// 8 players: p1-p4 on court, p5-p8 free -> auto-queue builds one match of p5-p8
function loadRandomSession() {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: ['p1','p2','p3','p4','p5','p6','p7','p8'].map(P),
    queueOrder: ['p1','p2','p3','p4','p5','p6','p7','p8'],
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [{ id: 1, name: 'Court 1', round: 1, submitted: false, startedAt: 1700000000000,
               score1: '', score2: '', team1: ['p1','p2'], team2: ['p3','p4'] }],
  }))});`);
  // two more players check in AFTER the queue was built (free, not queued yet)
  app.run(`
    players.push(${JSON.stringify(P('p9'))}, ${JSON.stringify(P('p10'))});
    queueOrder.push('p9','p10');
  `);
  return app;
}

test('court swap re-picks the queued matches', () => {
  const app = loadRandomSession();
  const before = app.run(`JSON.parse(JSON.stringify(matchQueue))`);
  assert.equal(before.length, 1, 'queue holds one auto-built match');
  // swap p1 (on court) for p9 (free, never queued) — the queued match p5-p8
  // is still "valid", but it was picked from a pool that no longer exists
  app.run(`swapContext = { type: 'court', courtId: 1, team: 'team1', playerIndex: 0 };`);
  app.run(`confirmSwap('p9');`);
  assert.ok(app.run(`courts[0].team1.includes('p9')`), 'p9 seated on court');
  const after = app.run(`JSON.parse(JSON.stringify(matchQueue))`);
  assert.ok(after.length >= 1, 'queue refilled');
  assert.ok(!after.some(m => m.id === before[0].id),
    'stale queued match must be re-picked, not kept');
});

test('editing a queued match directly does not re-pick the queue', () => {
  const app = loadRandomSession();
  const before = app.run(`JSON.parse(JSON.stringify(matchQueue))`);
  const mid = before[0].id;
  const out = before[0].team1[0];
  app.run(`swapContext = { type: 'queue', matchId: ${JSON.stringify(mid)}, team: 'team1', playerIndex: 0 };`);
  app.run(`confirmSwap('p9');`);
  const after = app.run(`JSON.parse(JSON.stringify(matchQueue))`);
  assert.ok(after.some(m => m.id === mid), 'manually edited match survives');
  const edited = after.find(m => m.id === mid);
  assert.ok(edited.team1.includes('p9'), 'edit applied');
  assert.ok(!edited.team1.includes(out) || edited.team2.includes(out) === false,
    'outgoing player left the seat');
});
