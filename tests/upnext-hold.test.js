// While forcedGroupMix holds the next match on purpose (every court busy, the only free
// players are the group that just played together), Up Next used to read "No upcoming
// matches yet." (app) or show nothing (view link). Both now say who plays next:
// "2 of A, B, C & D + 2 from the current game". Display only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';
import { loadView } from './viewhtml-harness.mjs';

const P = (id, name) => ({
  id, name, present: true, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0,
  lastPlayedRound: -1, skill: ['beginner', 'intermediate', 'advanced'][id % 3], events: [], partnerId: null,
});
const NAMES = ['Ana', 'Ben', 'Cai', 'Dee', 'Eve', 'Finn', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Mo', 'Ned', 'Oz', 'Pia'];

function appWith({ n, courts = 1, matchmaking = 'random', format = 'doubles' }) {
  const a = loadApp();
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking, format },
    players: NAMES.slice(0, n).map((nm, i) => P(i + 1, nm)),
    queueOrder: NAMES.slice(0, n).map((_, i) => i + 1),
    courtDefs: Array.from({ length: courts }, (_, i) => ({ id: i + 1, name: 'Court ' + (i + 1) })),
  }))});`);
  return a;
}
const finish = (a, id) => a.run(
  `document.getElementById('score1_${id}').value='11'; document.getElementById('score2_${id}').value='4'; submitScore(${id});`);
// Seat every court, then finish + reseat court 1 once: its old group is now the only
// free players and every court is busy, so the matchmaker holds.
function intoHold(a, courts) {
  for (let c = 1; c <= courts; c++) a.run(`generateMatchForCourt(${c})`);
  finish(a, 1); a.run('generateMatchForCourt(1)');
  assert.equal(a.run('matchQueue.length'), 0, 'held: nothing reserved');
  assert.equal(a.run('forcedGroupMix(getFreeWaiting(), matchSize())'), false);
}
const freeNames = a => JSON.parse(a.run('JSON.stringify(getFreeWaiting().map(p=>p.name))'));
const viewQueue = a => {
  const s = JSON.parse(a.run(`JSON.stringify({players, courts, courtDefs, matchQueue, gameHistory,
    queueOrder, mode: sessionMode, upNextAlways})`));
  const v = loadView();
  v.call('renderQueue', s);
  return v.captured['vQueue'];
};
const list = ns => ns.slice(0, -1).join(', ') + ' &amp; ' + ns[ns.length - 1];

for (const matchmaking of ['random', 'balanced']) {
  test(`${matchmaking} 1 court + 8: app and view say who is up next during the hold`, () => {
    const a = appWith({ n: 8, matchmaking });
    intoHold(a, 1);
    a.run('toggleUpNext()');   // 1 court: Up Next is shown only when the organizer switches it on
    const html = a.captured['queueList'];
    const free = freeNames(a);
    assert.equal(free.length, 4);
    const expected = `2 of ${list(free)} <span>+ 2 from the current game</span>`;
    assert.ok(html.includes(expected), `app shows "${expected}"`);
    assert.doesNotMatch(html, /No upcoming matches yet/);
    const v = viewQueue(a);
    assert.match(v, /class="upnext-placeholder"/);
    // the view lists names in roster order (it has no wait order), so compare as a set
    const m = v.match(/2 of ([^<]+) <span[^>]*>\+ 2 from the current game/);
    assert.ok(m, 'view link shows the hold line');
    assert.deepEqual(m[1].split(/, | &amp; /).sort(), free.slice().sort());
  });
}

test('3 courts + 16 (Up Next shown by default): names the game that finishes next', () => {
  const a = appWith({ n: 16, courts: 3 });
  intoHold(a, 3);
  a.run('renderQueue()');
  const free = freeNames(a);
  assert.ok(a.captured['queueList'].includes(`2 of ${list(free)} <span>+ 2 from the next game to finish</span>`));
  assert.match(viewQueue(a), /\+ 2 from the next game to finish/);
});

test('singles 1 court + 4: "1 of A & B + 1 from the current game"', () => {
  const a = appWith({ n: 4, format: 'singles' });
  intoHold(a, 1);
  a.run('toggleUpNext()');
  const free = freeNames(a);
  assert.ok(a.captured['queueList'].includes(`1 of ${free[0]} &amp; ${free[1]} <span>+ 1 from the current game</span>`));
  assert.match(viewQueue(a), /1 of \w+ &amp; \w+ <span[^>]*>\+ 1 from the current game/);
});

test('view: no hold line when the free four are not one whole group', () => {
  // Hand-built snapshot: court busy, queue empty, 4 free players who came from two
  // different games. The app would reserve them, so the view must not claim a hold.
  const players = NAMES.slice(0, 8).map((nm, i) => P(i + 1, nm));
  const s = {
    mode: { matchmaking: 'random', format: 'doubles' }, upNextAlways: true, players,
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [{ id: 1, name: 'Court 1', team1: [5, 6], team2: [7, 8], submitted: false, startedAt: 1 }],
    matchQueue: [], queueOrder: [1, 2, 3, 4, 5, 6, 7, 8],
    gameHistory: [
      { court: 1, team1Ids: [1, 2], team2Ids: [5, 6] },
      { court: 1, team1Ids: [3, 4], team2Ids: [7, 8] },
    ],
  };
  const v = loadView();
  v.call('renderQueue', s);
  assert.doesNotMatch(v.captured['vQueue'], /upnext-placeholder/);
  // ...and the same four as one whole last group does show it
  s.gameHistory = [{ court: 1, team1Ids: [1, 2], team2Ids: [3, 4] }];
  v.call('renderQueue', s);
  assert.match(v.captured['vQueue'], /2 of Ana, Ben, Cai &amp; Dee/);
});

test('view: By wait time holds like Numbering/Balanced (since 2026-09-26), shown when switched on', () => {
  const players = NAMES.slice(0, 8).map((nm, i) => P(i + 1, nm));
  const s = {
    mode: { matchmaking: 'waittime', format: 'doubles' }, players,
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [{ id: 1, name: 'Court 1', team1: [5, 6], team2: [7, 8], submitted: false, startedAt: 1 }],
    matchQueue: [], queueOrder: [1, 2, 3, 4, 5, 6, 7, 8],
    gameHistory: [{ court: 1, team1Ids: [1, 2], team2Ids: [3, 4] }],
  };
  const v = loadView();
  v.call('renderQueue', s);
  assert.doesNotMatch(v.captured['vQueue'], /upnext-placeholder/, '1 court: Up Next hidden by default');
  v.call('renderQueue', { ...s, upNextAlways: true });
  assert.match(v.captured['vQueue'], /2 of Ana, Ben, Cai &amp; Dee/);
});
