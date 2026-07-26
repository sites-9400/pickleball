// Rearranging players who are ALL already on courts.
// Reported by a real admin: with every court full the swap modal listed players
// from other courts but clicking one only produced "No waiting player to
// backfill…", so the only working choices were the two same-court trade chips.
// A swap between two live courts is a straight exchange: both players keep
// playing, nobody is benched, and no waiting player is consumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = id => ({
  id, name: 'P' + id, present: true, gamesPlayed: 0, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate',
});

function session({ nPlayers, courts = [], mode = 'waittime', format = 'doubles' }) {
  const app = loadApp();
  app.run(`window._uid='owner1';`);
  const players = Array.from({ length: nPlayers }, (_, i) => P(i + 1));
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: mode, format },
    players, playerIdCounter: nPlayers,
    queueOrder: players.map(p => p.id),
    courtDefs: courts.map(c => ({ id: c.id, name: 'Court ' + c.id })),
    courts: courts.map(c => ({
      id: c.id, name: 'Court ' + c.id, round: 1, submitted: false, startedAt: 1700000000000,
      score1: '', score2: '', team1: c.team1, team2: c.team2,
    })),
    courtIdCounter: courts.length,
  }))});`);
  // the harness's fake DOM has no .children, which filterSwapOptions walks
  app.run(`document.getElementById('swapOptions');`);
  app.els.swapOptions.children = [];
  return app;
}

const courtOf = (app, id) => app.run(`(()=>{const c=courts.find(c=>c.id===${id});return JSON.stringify([c.team1,c.team2]);})()`);
const seats = app => app.run(`JSON.stringify(courts.filter(c=>!c.submitted).flatMap(c=>[...c.team1,...c.team2]))`);
const options = app => app.run(`document.getElementById('swapOptions').innerHTML`);
const optionIds = app => [...options(app).matchAll(/confirmSwap\((\d+)\)/g)].map(m => Number(m[1]));

test('swapping with a player on another court exchanges the two seats', () => {
  const app = session({ nPlayers: 8, courts: [
    { id: 1, team1: [1, 2], team2: [3, 4] },
    { id: 2, team1: [5, 6], team2: [7, 8] },
  ] });
  const queueBefore = app.run(`JSON.stringify(queueOrder)`);
  app.run(`openSwapModal(1,'team1',0);`);   // swap out P1
  app.run(`confirmSwap(5);`);               // for P5, who is on court 2
  assert.equal(courtOf(app, 1), JSON.stringify([[5, 2], [3, 4]]), 'P5 takes P1\'s seat');
  assert.equal(courtOf(app, 2), JSON.stringify([[1, 6], [7, 8]]), 'P1 takes P5\'s seat');
  assert.equal(app.run(`JSON.stringify(queueOrder)`), queueBefore,
    'an exchange benches nobody, so the waiting queue is untouched');
});

test('an exchange between courts does not consume a waiting player', () => {
  const app = session({ nPlayers: 9, courts: [
    { id: 1, team1: [1, 2], team2: [3, 4] },
    { id: 2, team1: [5, 6], team2: [7, 8] },
  ] });
  app.run(`openSwapModal(1,'team1',0); confirmSwap(5);`);
  assert.equal(courtOf(app, 2), JSON.stringify([[1, 6], [7, 8]]), 'P1 goes to court 2, not the spare');
  assert.ok(app.run(`getFreeWaiting().some(p=>p.id===9)`), 'P9 is still waiting');
});

test('singles courts can be rearranged when every court is full', () => {
  const app = session({ nPlayers: 4, format: 'singles', courts: [
    { id: 1, team1: [1], team2: [2] },
    { id: 2, team1: [3], team2: [4] },
  ] });
  app.run(`openSwapModal(1,'team1',0); confirmSwap(3);`);
  assert.equal(courtOf(app, 1), JSON.stringify([[3], [2]]));
  assert.equal(courtOf(app, 2), JSON.stringify([[1], [4]]));
});

test('a court exchange keeps every player seated exactly once', () => {
  const app = session({ nPlayers: 8, courts: [
    { id: 1, team1: [1, 2], team2: [3, 4] },
    { id: 2, team1: [5, 6], team2: [7, 8] },
  ] });
  app.run(`openSwapModal(1,'team2',1); confirmSwap(7);`);   // P4 <-> P7
  assert.equal(courtOf(app, 1), JSON.stringify([[1, 2], [3, 7]]), 'the exchange happened');
  const seated = JSON.parse(seats(app));
  assert.equal(seated.length, 8);
  assert.equal(new Set(seated).size, 8, 'no player is seated twice');
});

test('seating one member of an arranged match keeps the rest of that match', () => {
  const app = session({ nPlayers: 8, mode: 'manual', courts: [{ id: 1, team1: [1, 2], team2: [3, 4] }] });
  app.run(`matchQueue=[{id:1,team1:[5,6],team2:[7,8]}];`);
  app.run(`openSwapModal(1,'team1',0); confirmSwap(5);`);   // pull P5 out of the arranged match
  const mq = JSON.parse(app.run(`JSON.stringify(matchQueue)`));
  assert.equal(mq.length, 1, 'P6, P7 and P8 keep their upcoming match');
  const ids = [...mq[0].team1, ...mq[0].team2];
  assert.deepEqual([6, 7, 8].filter(id => ids.includes(id)), [6, 7, 8]);
  assert.equal(ids.length, 4, 'the vacated slot is filled');
  assert.ok(!ids.includes(5), 'P5 is on court, not also in the queued match');
});

test('an arranged match survives its player being taken, filled from the waiting pool', () => {
  const app = session({ nPlayers: 9, mode: 'manual', courts: [{ id: 1, team1: [1, 2], team2: [3, 4] }] });
  app.run(`matchQueue=[{id:1,team1:[5,6],team2:[7,8]}];`);
  app.run(`openSwapModal(1,'team1',0); confirmSwap(5);`);
  const ids = JSON.parse(app.run(`JSON.stringify([...matchQueue[0].team1,...matchQueue[0].team2])`));
  assert.equal(new Set(ids).size, 4, 'no duplicate in the healed match');
  assert.ok(ids.includes(9) || ids.includes(1), 'a waiting player took the empty slot');
});

test('an upcoming-match swap does not offer players who are on a court', () => {
  const app = session({ nPlayers: 12, mode: 'manual', courts: [{ id: 1, team1: [1, 2], team2: [3, 4] }] });
  app.run(`matchQueue=[{id:1,team1:[5,6],team2:[7,8]},{id:2,team1:[9,10],team2:[11,12]}];`);
  app.run(`openQueueSwapModal(1,'team1',0);`);
  const offered = optionIds(app);
  assert.deepEqual(offered.filter(id => [1, 2, 3, 4].includes(id)), [],
    'players on a live court must not be offered for a future match');
});

// A co-host can seat a player while this modal is open, so the click must be
// re-checked against current state instead of trusting the rendered option list.
test('an upcoming-match swap refuses a player seated since the modal opened', () => {
  const app = session({ nPlayers: 12, mode: 'manual', courts: [{ id: 1, team1: [1, 2], team2: [3, 4] }] });
  app.run(`matchQueue=[{id:1,team1:[5,6],team2:[7,8]},{id:2,team1:[9,10],team2:[11,12]}];`);
  app.run(`openQueueSwapModal(1,'team1',0);`);
  app.run(`globalThis.__t=''; showToast = m => { globalThis.__t = m; };`);
  app.run(`confirmSwap(1);`);   // P1 is on a live court
  assert.match(app.run(`globalThis.__t`), /on a court/i, 'says why nothing happened');
  assert.ok(app.run(`matchQueue[0].team1.includes(5)`), 'Match 1 is left alone');
});

test('swapping between two upcoming matches exchanges the players', () => {
  const app = session({ nPlayers: 12, mode: 'manual' });
  app.run(`matchQueue=[{id:1,team1:[5,6],team2:[7,8]},{id:2,team1:[9,10],team2:[11,12]}];`);
  app.run(`openQueueSwapModal(1,'team1',0);`);   // swap out P5
  app.run(`confirmSwap(9);`);                    // for P9, in Match 2
  const mq = JSON.parse(app.run(`JSON.stringify(matchQueue)`));
  assert.equal(mq.length, 2, 'both matches survive');
  const all = mq.flatMap(m => [...m.team1, ...m.team2]);
  assert.equal(new Set(all).size, 8, 'nobody is booked into two matches');
  assert.ok(mq[0].team1.includes(9) && !mq[0].team1.includes(5), 'P9 moved into Match 1');
  assert.ok([...mq[1].team1, ...mq[1].team2].includes(5), 'P5 moved into Match 2');
});

test('waiting players held for an upcoming match are offered, not reported as an empty queue', () => {
  const app = session({ nPlayers: 8, courts: [{ id: 1, team1: [1, 2], team2: [3, 4] }] });
  assert.equal(app.run(`matchQueue.length`), 1, 'P5-P8 are reserved for an upcoming match');
  app.run(`openSwapModal(1,'team1',0);`);
  const html = options(app);
  assert.ok(!/Queue is empty/.test(html), 'four players are waiting, so do not claim the queue is empty');
  // the chips under the "waiting" label, up to whatever section label comes next
  const waitingSection = html
    .slice(html.indexOf('Pick from waiting queue'))
    .split('swap-section-label')[0];
  for (const id of [5, 6, 7, 8]) {
    assert.match(waitingSection, new RegExp(`confirmSwap\\(${id}\\)`),
      `P${id} is waiting and must be offered in the waiting section`);
  }
  assert.match(html, /Auto-generate/, 'the best-skill suggestion still works');
});
