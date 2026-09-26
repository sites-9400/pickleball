// Ended-session clock (app header + view.html) used sessionEndTime - start. Sep 13 was
// played 4:18-8:54 PM but ended at 2:31 AM, so both clocks read 10+ hours while the recap
// said 5. Both now use the recap's own play time (first game start to last game end,
// idle gaps over an hour skipped), so all three always agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../recap.js';
import { loadApp, snap } from './apphtml-harness.mjs';
import { loadView } from './viewhtml-harness.mjs';

const MIN = 60000, H = 60 * MIN;
const T0 = new Date(2026, 8, 13, 16, 10).getTime();
const game = (a, b) => ({ court: 1, courtName: 'Court 1', round: 1, team1: ['A', 'B'], team2: ['C', 'D'],
  team1Ids: [1, 2], team2Ids: [3, 4], score1: 11, score2: 5, startedAt: T0 + a * MIN, endedAt: T0 + b * MIN });
const P = id => ({ id, name: 'P' + id, present: true, gamesPlayed: 1, wins: 0, losses: 0, points: 0,
  pointsAgainst: 0, lastPlayedRound: 1, skill: 'intermediate', events: [] });
// played 4:18 PM to 8:54 PM, ended at 2:31 AM
const SESSION = { sessionStartTime: T0, sessionEndTime: T0 + (10 * 60 + 21) * MIN, sessionEnded: true,
  mode: { matchmaking: 'random', format: 'doubles' }, players: [1, 2, 3, 4].map(P),
  courtDefs: [{ id: 1, name: 'Court 1' }], gameHistory: [game(240, 284), game(170, 240), game(100, 170), game(30, 100), game(8, 30)] };

function appWith(s) {
  const app = loadApp();
  app.windowMock.PDRecap = globalThis.PDRecap;
  app.run(`this.PDRecap = window.PDRecap;`);   // the page loads recap.js as a classic script
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap(s))});`);
  app.run(`updateSessionClock();`);
  return app;
}
const appClock = app => app.run(`document.getElementById('sessionClock').textContent`);

test('app: an ended session shows play time, not the time until End was tapped', () => {
  assert.equal(appClock(appWith(SESSION)), '04:36:00', '4:18 PM to 8:54 PM');
});

test('view: the Ended clock matches', () => {
  const v = loadView();
  v.windowMock.PDRecap = globalThis.PDRecap;
  v.run(`this.PDRecap = window.PDRecap;`);
  v.call('showEndedState', SESSION);
  assert.equal(v.run(`document.getElementById('viewClock').textContent`), '04:36:00');
});

test('app, view and recap agree', () => {
  const r = globalThis.PDRecap.buildRecapData(SESSION, {});
  assert.deepEqual([r.stats.duration, r.stats.durationUnit], [5, 'HOURS'], 'recap rounds 4h36 to 5 hours');
  assert.equal(globalThis.PDRecap.playTime(SESSION.gameHistory).ms, (4 * 60 + 36) * MIN);
});

test('a running session keeps the live clock from session start', () => {
  const app = appWith({ ...SESSION, sessionEnded: false, sessionEndTime: null });
  const shown = appClock(app).split(':').map(Number);
  assert.ok(shown[0] * 60 + shown[1] > 4 * 60 + 36, `live clock counts from start to now, got ${appClock(app)}`);
});

test('ended with no timed games: falls back to start to End, as before', () => {
  assert.equal(appClock(appWith({ ...SESSION, sessionEndTime: T0 + 3 * H,
    gameHistory: SESSION.gameHistory.map(({ startedAt, endedAt, ...g }) => g) })), '03:00:00');
});
