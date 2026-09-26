// The main session CSV is the file that leaves the app, so it has to carry the two
// things a turnout post-mortem needs and used to be missing: when each player was
// actually on site, and how long each game took.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const T0 = new Date(2026, 8, 6, 16, 8).getTime();   // 4:08 PM local, whatever the box's zone
const mins = n => T0 + n * 60000;

const P = (id, over = {}) => ({
  id, name: id.toUpperCase(), present: true, gamesPlayed: 2, wins: 1, losses: 1,
  points: 20, pointsAgainst: 15, lastPlayedRound: 1, skill: 'intermediate', events: [], ...over,
});

function loadSession(over = {}) {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    sessionStartTime: T0,
    mode: { matchmaking: 'waittime', format: 'doubles' },
    courtDefs: [{ id: 1, name: 'Court 1' }],
    ...over,
  }))});`);
  return app;
}
const csvOf = app => { app.run(`exportCSV();`); return app.blobs[app.blobs.length - 1]; };
const rowFor = (csv, name) => csv.split('\n').find(l => l.startsWith(name + ','));

test('player rows carry check-in, checkout and time on site', () => {
  const app = loadSession({
    players: [
      P('p1', { events: [{ t: 'in', ts: mins(0) }] }),                                  // still here
      P('p2', { present: false, events: [{ t: 'in', ts: mins(10) }, { t: 'out', ts: mins(130) }] }),
    ],
  });
  app.run(`sessionEndTime = ${mins(240)};`);
  const csv = csvOf(app);
  const head = csv.split('\n')[0];
  assert.ok(head.includes('Checked in'), 'header has a check-in column');
  assert.ok(head.includes('Left'), 'header has a checkout column');
  assert.ok(head.includes('On site (min)'), 'header has time on site');

  const p1 = rowFor(csv, 'P1').split(',');
  const p2 = rowFor(csv, 'P2').split(',');
  assert.equal(p1[p1.length - 3], '4:08 PM', 'p1 check-in time');
  assert.equal(p1[p1.length - 2], '-', 'p1 has not left');
  assert.equal(p1[p1.length - 1], '240', 'p1 on site until session end');
  assert.equal(p2[p2.length - 3], '4:18 PM', 'p2 check-in time');
  assert.equal(p2[p2.length - 2], '6:18 PM', 'p2 checkout time');
  assert.equal(p2[p2.length - 1], '120', 'p2 on site only until they left');
});

test('a check-in from another day is date-qualified, not a bare time', () => {
  // Toggling a player two days after the session logged "in 2:09 PM", which read as
  // though they were on court mid-session. The date has to survive into the CSV.
  const app = loadSession({
    players: [P('p1', { events: [{ t: 'in', ts: new Date(2026, 8, 8, 14, 9).getTime() }] })],
  });
  const stamp = rowFor(csvOf(app), 'P1').split(',').slice(-3)[0];
  assert.match(stamp, /Sep 8/, `off-day check-in must name its date, got "${stamp}"`);
});

test('a player who never checked in reads as a dash, not a bogus duration', () => {
  const app = loadSession({ players: [P('p1', { gamesPlayed: 0, events: [] })] });
  const cells = rowFor(csvOf(app), 'P1').split(',');
  assert.deepEqual(cells.slice(-3), ['-', '-', '-']);
});

test('game rows carry start, end and length in minutes', () => {
  const app = loadSession({
    players: [P('p1'), P('p2'), P('p3'), P('p4')],
    gameHistory: [{
      round: 1, court: 1, courtName: 'Court 1', team1: ['P1', 'P2'], team2: ['P3', 'P4'],
      team1Ids: ['p1', 'p2'], team2Ids: ['p3', 'p4'], score1: 11, score2: 7,
      startedAt: mins(0), endedAt: mins(23),
    }],
  });
  const csv = csvOf(app);
  const head = csv.split('\n').find(l => l.startsWith('Game,'));
  assert.ok(head.endsWith('Started,Ended,Length (min)'), `game header, got "${head}"`);
  const row = csv.split('\n').find(l => l.startsWith('1,Court 1,'));
  assert.ok(row.endsWith('4:08 PM,4:31 PM,23'), `game row, got "${row}"`);
});

test('games recorded before timing existed export as dashes', () => {
  const app = loadSession({
    players: [P('p1'), P('p2'), P('p3'), P('p4')],
    gameHistory: [{ round: 1, court: 1, courtName: 'Court 1', team1: ['P1', 'P2'], team2: ['P3', 'P4'],
                    team1Ids: ['p1', 'p2'], team2Ids: ['p3', 'p4'], score1: 11, score2: 7 }],
  });
  const row = csvOf(app).split('\n').find(l => l.startsWith('1,Court 1,'));
  assert.ok(row.endsWith('-,-,-'), `untimed game row, got "${row}"`);
});

test('submitting a score records how long the game took', () => {
  const app = loadSession({
    players: [P('p1'), P('p2'), P('p3'), P('p4')],
    globalRound: 1,
    courts: [{ id: 1, name: 'Court 1', round: 1, submitted: false, startedAt: mins(0),
               score1: '', score2: '', team1: ['p1', 'p2'], team2: ['p3', 'p4'] }],
  });
  app.els['score1_1'].value = '11';
  app.els['score2_1'].value = '6';
  app.run(`submitScore(1);`);
  const g = app.run(`JSON.parse(JSON.stringify(gameHistory[0]))`);
  assert.equal(g.startedAt, mins(0), 'start time carried into history');
  assert.ok(g.endedAt >= g.startedAt, 'end time stamped on submit');
});
