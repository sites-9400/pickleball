// Ending a session used to only flip a flag, stop the clock and open the recap — every
// mutating function stayed callable and the Submit Score buttons stayed on screen, so an
// ended night could still gain matches, scores and check-ins. An ended session is a
// closed record. Continue (continueSession) reopens it, so this is a lock, not a freeze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id, over = {}) => ({
  id, name: id.toUpperCase(), present: true, gamesPlayed: 1, wins: 0, losses: 1,
  points: 5, pointsAgainst: 11, lastPlayedRound: 1, skill: 'intermediate', events: [], ...over,
});

// 8 players, one live court, session ENDED.
function endedApp(extra = {}) {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: ['p1','p2','p3','p4','p5','p6','p7','p8'].map(id => P(id))
      .concat([P('away', { present: false })]),
    queueOrder: ['p1','p2','p3','p4','p5','p6','p7','p8'],
    globalRound: 2,
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [{ id: 1, name: 'Court 1', round: 2, submitted: false, startedAt: 1700000000000,
               score1: '', score2: '', team1: ['p1','p2'], team2: ['p3','p4'] }],
    sessionEnded: true, sessionEndTime: 1700000900000,
    ...extra,
  }))});`);
  return app;
}
const historyLen = app => app.run(`gameHistory.length`);

test('submitScore is refused on an ended session', () => {
  const app = endedApp();
  app.els['score1_1'].value = '11';
  app.els['score2_1'].value = '4';
  app.run(`submitScore(1);`);
  assert.equal(historyLen(app), 0, 'no game recorded');
  assert.equal(app.run(`courts[0].submitted`), false, 'court not closed out');
  assert.equal(app.run(`getPlayer('p1').gamesPlayed`), 1, 'no stats credited');
});

test('generateMatchForCourt is refused on an ended session', () => {
  const app = endedApp({ courts: [] });
  app.run(`generateMatchForCourt(1);`);
  assert.equal(app.run(`courts.length`), 0, 'no new match seated');
});

test('player check-in is locked on an ended session', () => {
  const app = endedApp();
  app.run(`togglePresent('away');`);
  assert.equal(app.run(`getPlayer('away').present`), false, 'cannot check someone in');
  app.run(`togglePresent('p1');`);
  assert.equal(app.run(`getPlayer('p1').present`), true, 'cannot check someone out either');
  assert.equal(app.run(`getPlayer('away').events.length`), 0, 'no stray attendance events');
});

test('QR self-check-in is locked on an ended session', () => {
  const app = endedApp();
  app.run(`window._removeCheckin = () => {};`);
  app.run(`window._importCheckin('k1', { name: 'AWAY', skill: 'intermediate', ts: Date.now() });`);
  assert.equal(app.run(`getPlayer('away').present`), false, 'QR scan cannot reopen attendance');
});

test('swapping and cancelling are refused on an ended session', () => {
  const app = endedApp();
  app.run(`swapContext = { type: 'court', courtId: 1, team: 'team1', playerIndex: 0 };`);
  app.run(`confirmSwap('p5');`);
  assert.ok(app.run(`courts[0].team1.includes('p1')`), 'swap did not happen');
  app.run(`cancelMatch(1);`);
  assert.equal(app.run(`courts.length`), 1, 'court not cancelled');
});

test('Continue reopens the session and everything works again', () => {
  const app = endedApp();
  app.run(`continueSession();`);
  assert.equal(app.run(`sessionEnded`), false, 'session reopened');
  app.run(`togglePresent('away');`);
  assert.equal(app.run(`getPlayer('away').present`), true, 'check-in works again');
  app.els['score1_1'].value = '11';
  app.els['score2_1'].value = '4';
  app.run(`submitScore(1);`);
  assert.equal(historyLen(app), 1, 'scores can be submitted again');
});

test('a live session is completely unaffected', () => {
  const app = endedApp({ sessionEnded: false, sessionEndTime: null });
  app.run(`togglePresent('away');`);
  assert.equal(app.run(`getPlayer('away').present`), true);
  app.els['score1_1'].value = '11';
  app.els['score2_1'].value = '6';
  app.run(`submitScore(1);`);
  assert.equal(historyLen(app), 1);
});
