// lastPlayedRound is a round number, and -1 means "never played". waitOf() subtracts
// it from globalRound, so a player who checks in at round 60 scored a wait of 61 and
// outweighed the longest-waiting regular ~11,000:1. A player returning from a long
// break carried the same runaway. Both now enter on the median wait of the pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id, lastPlayedRound, over = {}) => ({
  id, name: id.toUpperCase(), present: true, gamesPlayed: 9, wins: 4, losses: 5,
  points: 90, pointsAgainst: 88, lastPlayedRound, skill: 'intermediate', events: [], ...over,
});

// 8 regulars waiting 1..8 rounds -> median wait is 5. Nobody is on a court. Manual
// matchmaking so the auto-queue does not consume half the pool mid-test.
function loadMidSession(extra = [], globalRound = 60) {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'manual', format: 'doubles' },
    players: [...Array(8)].map((_, i) => P('reg' + (i + 1), globalRound - (i + 1))).concat(extra),
    queueOrder: [...Array(8)].map((_, i) => 'reg' + (i + 1)).concat(extra.map(p => p.id)),
    globalRound,
    courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  return app;
}
const waitOf = (app, id) => app.run(`globalRound - getPlayer(${JSON.stringify(id)}).lastPlayedRound`);

test('a walk-in mid-session enters on the median wait, not the whole session', () => {
  const app = loadMidSession([P('late', -1, { present: false, gamesPlayed: 0 })]);
  app.run(`togglePresent('late');`);
  assert.equal(waitOf(app, 'late'), 5,
    'newcomer should enter as an average-waiting player, not with a wait of 61');
});

test('the newcomer no longer outranks the longest-waiting regular', () => {
  const app = loadMidSession([P('late', -1, { present: false, gamesPlayed: 0 })]);
  app.run(`togglePresent('late');`);
  const order = app.run(`getFreeWaiting().map(p=>p.id)`);
  assert.notEqual(order[0], 'late', 'a walk-in must not jump the whole queue');
  assert.equal(order[0], 'reg8', 'the player who has actually waited longest leads');
});

test('a player returning from a long break is clamped to the median too', () => {
  // stepped out at round 5, back at round 60 -> a raw wait of 55
  const app = loadMidSession([P('back', 5, { present: false })]);
  app.run(`togglePresent('back');`);
  assert.equal(waitOf(app, 'back'), 5, 'a long absence must not bank wait credit');
});

test('a quick out-and-in keeps its own smaller wait, unpenalised', () => {
  const app = loadMidSession([P('blip', 58, { present: false })]);   // raw wait 2, under the median
  app.run(`togglePresent('blip');`);
  assert.equal(waitOf(app, 'blip'), 2, 'a player below the median keeps their real wait');
});

test('before the first round nothing is seeded — everyone starts equal', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: [P('a', -1, { present: false, gamesPlayed: 0 }), P('b', -1, { gamesPlayed: 0 })],
    queueOrder: ['a', 'b'], globalRound: 0, courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  app.run(`togglePresent('a');`);
  assert.equal(app.run(`getPlayer('a').lastPlayedRound`), -1,
    'pre-start check-ins stay at -1 so the opening draw treats everyone the same');
});

test('the very first player to check in mid-session has nobody to compare to', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: [P('solo', -1, { present: false, gamesPlayed: 0 })],
    queueOrder: [], globalRound: 12, courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  app.run(`togglePresent('solo');`);
  assert.equal(app.run(`getPlayer('solo').lastPlayedRound`), -1, 'left alone, no crash');
});

test('QR self-check-in seeds the wait clock too', () => {
  // _importCheckin is how a latecomer scanning the QR marks themselves present --
  // the most common late-arrival path, and the one most likely to be a walk-in.
  const app = loadMidSession([P('qrlate', -1, { present: false, gamesPlayed: 0 })]);
  app.run(`window._removeCheckin = () => {};`);
  app.run(`window._importCheckin('k1', { name: 'QRLATE', skill: 'intermediate', ts: Date.now() });`);
  assert.equal(app.run(`getPlayer('qrlate').present`), true, 'marked present');
  assert.equal(waitOf(app, 'qrlate'), 5,
    'a QR check-in must be seeded like every other mid-session arrival');
});
