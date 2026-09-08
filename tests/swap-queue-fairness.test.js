// A player swapped OFF a court never played that game. Sending them back to the
// waiting pool must not cost them their place in line: their wait clock
// (lastPlayedRound) still runs from their last REAL game, and they rejoin at the
// front of the tiebreak order — the same way the queue-swap branch already does it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id, lastPlayedRound = -1, gamesPlayed = 0) => ({
  id, name: id.toUpperCase(), present: true, gamesPlayed, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound, skill: 'intermediate',
});

// p1-p4 seated on court 1, p5-p8 waiting, p9 free. Manual mode so nothing auto-queues.
function loadSession({ seatedLPR, waitingLPR, queueOrder }) {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'manual', format: 'doubles' },
    players: [
      P('p1', seatedLPR, 3), P('p2', seatedLPR, 3), P('p3', seatedLPR, 3), P('p4', seatedLPR, 3),
      P('p5', waitingLPR, 4), P('p6', waitingLPR, 4), P('p7', waitingLPR, 4), P('p8', waitingLPR, 4),
      P('p9', waitingLPR, 4),
    ],
    queueOrder,
    globalRound: 5,
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [{ id: 1, name: 'Court 1', round: 5, submitted: false, startedAt: 1700000000000,
               score1: '', score2: '', team1: ['p1','p2'], team2: ['p3','p4'] }],
  }))});`);
  return app;
}

const waiting = app => app.run(`getFreeWaiting().map(p=>p.id)`);

test('swapped-out player keeps their wait clock — no phantom round', () => {
  // p1 last really played at round 2; everyone waiting played at round 4.
  // p1 has therefore waited the LONGEST and must come out on top of the pool.
  const app = loadSession({
    seatedLPR: 2, waitingLPR: 4,
    queueOrder: ['p5','p6','p7','p8','p9','p1','p2','p3','p4'],
  });
  app.run(`swapContext = { type: 'court', courtId: 1, team: 'team1', playerIndex: 0 };`);
  app.run(`confirmSwap('p9');`);

  assert.ok(app.run(`courts[0].team1.includes('p9')`), 'p9 took the seat');
  assert.equal(app.run(`getPlayer('p1').lastPlayedRound`), 2,
    'p1 never played that game — their wait clock must not be reset to globalRound');
  assert.equal(app.run(`getPlayer('p1').gamesPlayed`), 3, 'no phantom game credited');
  assert.equal(waiting(app)[0], 'p1',
    'p1 waited since round 2 and must lead the pool, not sit behind round-4 players');
});

test('swapped-out player rejoins the front of the tiebreak, not the back', () => {
  // Everyone has waited exactly as long, so queueOrder alone decides. p1 sits at the
  // tail of queueOrder because being picked for a court moves you there.
  const app = loadSession({
    seatedLPR: 4, waitingLPR: 4,
    queueOrder: ['p5','p6','p7','p8','p9','p1','p2','p3','p4'],
  });
  app.run(`swapContext = { type: 'court', courtId: 1, team: 'team1', playerIndex: 0 };`);
  app.run(`confirmSwap('p9');`);

  assert.equal(waiting(app)[0], 'p1',
    'a bumped player goes back to the head of the line, not to the end of it');
});

test('put-on-hold fate still removes the swapped-out player from the queue', () => {
  const app = loadSession({
    seatedLPR: 2, waitingLPR: 4,
    queueOrder: ['p5','p6','p7','p8','p9','p1','p2','p3','p4'],
  });
  // The harness DOM has no real radios, so stand in for the "Put on hold" choice.
  app.run(`
    const _qs = document.querySelector;
    document.querySelector = sel => sel === 'input[name="swapFate"]:checked'
      ? { value: 'remove' } : _qs.call(document, sel);
    swapContext = { type: 'court', courtId: 1, team: 'team1', playerIndex: 0 };
    confirmSwap('p9');
    document.querySelector = _qs;
  `);
  assert.equal(app.run(`getPlayer('p1').present`), false, 'p1 put on hold');
  assert.ok(!waiting(app).includes('p1'), 'p1 is not in the waiting pool');
});
