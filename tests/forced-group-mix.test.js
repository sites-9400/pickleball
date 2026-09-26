// Fixed-group lock (Numbering/Balanced): with players = (courts + 1) x match size
// (1 court + 8, 2 courts + 12, singles 1 court + 4) the only free players after a court
// is seated are the group that just finished, so the reserved next match was forced to
// be that same group and the groups never mixed all night. forcedGroupMix() holds the
// reservation in exactly that case and, when a court frees, lets k (team size) players
// stay on and k waiting players sit one more game. Everything else is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function withSeed(seed, fn) {
  const real = Math.random;
  Math.random = lcg(seed);
  try { return fn(); } finally { Math.random = real; }
}
function appWith({ n, courts = 1, matchmaking = 'random', format = 'doubles', locks = [] }) {
  const app = loadApp();
  const players = [...Array(n)].map((_, i) => ({
    id: i + 1, name: 'P' + (i + 1), present: true, gamesPlayed: 0, wins: 0, losses: 0,
    points: 0, pointsAgainst: 0, lastPlayedRound: -1,
    skill: ['beginner', 'intermediate', 'advanced'][i % 3], events: [], partnerId: null,
  }));
  for (const [a, b] of locks) { players[a - 1].partnerId = b; players[b - 1].partnerId = a; }
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking, format }, players,
    courtDefs: [...Array(courts)].map((_, i) => ({ id: i + 1, name: 'Court ' + (i + 1) })),
    queueOrder: players.map(p => p.id), playerIdCounter: n, courtIdCounter: courts,
  }))});`);
  return app;
}
const onCourt = (app, id) => JSON.parse(app.run(
  `JSON.stringify((()=>{const c=courts.find(x=>x.id===${id}&&!x.submitted);return c?[...c.team1,...c.team2]:[];})())`));
const finish = (app, id) => app.run(
  `document.getElementById('score1_${id}').value='11'; document.getElementById('score2_${id}').value='6'; submitScore(${id});`);
const queued = app => JSON.parse(app.run(`JSON.stringify(matchQueue.map(m=>[...m.team1,...m.team2]))`));
const gp = app => JSON.parse(app.run(`JSON.stringify(players.map(p=>p.gamesPlayed))`));

// Play a 1-court night; returns the foursome (or pair) of every game plus P/S runs.
function oneCourtNight(opts, games = 20, seed = 11) {
  return withSeed(seed, () => {
    const app = appWith(opts);
    const seq = {}; for (let i = 1; i <= opts.n; i++) seq[i] = '';
    const groups = [];
    app.run(`generateMatchForCourt(1)`);
    for (let g = 0; g < games; g++) {
      const on = onCourt(app, 1);
      groups.push(on.slice().sort((a, b) => a - b).join(','));
      for (let i = 1; i <= opts.n; i++) seq[i] += on.includes(i) ? 'P' : 'S';
      finish(app, 1);
      app.run(`generateMatchForCourt(1)`);
    }
    return { app, groups, seq };
  });
}
const maxRun = (seq, ch) => Math.max(...Object.values(seq).map(s => Math.max(0, ...s.split(ch === 'P' ? 'S' : 'P').map(x => x.length))));

for (const matchmaking of ['random', 'balanced']) {
  test(`${matchmaking}: 1 court + 8 players no longer splits into two fixed foursomes`, () => {
    const { groups, seq, app } = oneCourtNight({ n: 8, matchmaking });
    assert.ok(new Set(groups).size >= 8, `expected many different foursomes, got ${new Set(groups).size}`);
    assert.ok(maxRun(seq, 'P') <= 2, 'nobody plays more than 2 in a row');
    assert.ok(maxRun(seq, 'S') <= 2, 'nobody sits more than 2 in a row');
    const g = gp(app);
    assert.equal(Math.max(...g) - Math.min(...g), 0, `after 20 games everyone has played 10: ${g}`);
  });

  test(`${matchmaking}: the mixed game keeps 2 who just played and 2 who waited`, () => {
    withSeed(5, () => {
      const app = appWith({ n: 8, matchmaking });
      app.run(`generateMatchForCourt(1)`);
      const A = onCourt(app, 1);
      finish(app, 1); app.run(`generateMatchForCourt(1)`);
      const B = onCourt(app, 1);
      assert.deepEqual(queued(app), [], 'reservation is held while the only free players are the group that just played');
      finish(app, 1);
      const [next] = queued(app);
      assert.equal(next.length, 4);
      assert.equal(next.filter(id => B.includes(id)).length, 2, '2 stay on from the game that just ended');
      assert.equal(next.filter(id => A.includes(id)).length, 2, '2 of the waiting group play');
      app.run(`generateMatchForCourt(1)`);
      assert.deepEqual(onCourt(app, 1).sort(), next.slice().sort(), 'the mixed match is the one seated');
      // the other four are now forced and are not a repeat group, so they are reserved normally
      assert.equal(queued(app).length, 1);
    });
  });

  test(`${matchmaking} singles: 1 court + 4 players rotate opponents`, () => {
    const { groups, seq } = oneCourtNight({ n: 4, matchmaking, format: 'singles' }, 12);
    assert.equal(new Set(groups).size, 6, 'all 6 possible pairings appear');
    assert.ok(maxRun(seq, 'P') <= 2 && maxRun(seq, 'S') <= 2);
  });
}

test('2 courts + 12 players: groups mix, runs stay at most 2, games-played spread tight', () => {
  withSeed(3, () => {
    const app = appWith({ n: 12, courts: 2 });
    const ev = lcg(99), end = {}, seq = {}; for (let i = 1; i <= 12; i++) seq[i] = '';
    const seat = id => {
      const busy = new Set([1, 2].flatMap(c => onCourt(app, c)));
      app.run(`generateMatchForCourt(${id})`);
      const on = onCourt(app, id);
      for (let i = 1; i <= 12; i++) if (!busy.has(i)) seq[i] += on.includes(i) ? 'P' : 'S';
    };
    for (const id of [1, 2]) { seat(id); end[id] = 12 + Math.floor(ev() * 7); }
    for (;;) {
      const id = end[1] <= end[2] ? 1 : 2, t = end[id];
      if (t > 300) break;
      finish(app, id); seat(id); end[id] = t + 12 + Math.floor(ev() * 7);
    }
    const hist = JSON.parse(app.run(`JSON.stringify(gameHistory.map(g=>[...g.team1Ids,...g.team2Ids].sort((a,b)=>a-b).join(',')))`));
    assert.ok(new Set(hist).size > 20, `baseline had only 3 foursomes; got ${new Set(hist).size}`);
    assert.ok(maxRun(seq, 'P') <= 2, 'nobody seated 3 times in a row without sitting');
    const g = gp(app);
    assert.ok(Math.max(...g) - Math.min(...g) <= 3, `games-played spread ${g}`);
  });
});

test('1 court + 4 doubles players: the court still restarts with the same four', () => {
  const app = appWith({ n: 4 });
  app.run(`generateMatchForCourt(1)`);
  const first = onCourt(app, 1).sort();
  finish(app, 1); app.run(`generateMatchForCourt(1)`);
  assert.deepEqual(onCourt(app, 1).sort(), first, 'a free court is never held back');
});

test('no hold while a court is open: the forced group is reserved as before', () => {
  // 2 courts defined, only court 1 in use, 8 players: after the first game the 4 free
  // players are a whole last group, but court 2 is open, so nothing waits on a court.
  const app = appWith({ n: 8, courts: 2 });
  app.run(`generateMatchForCourt(1)`);
  assert.equal(queued(app).length, 1, 'first reservation (never-played group) is normal');
  finish(app, 1); app.run(`generateMatchForCourt(1)`);
  assert.equal(queued(app).length, 1, 'court 2 is open, so the queue is not held');
});

test('forcedGroupMix leaves ordinary pools alone', () => {
  withSeed(7, () => {
    const app = appWith({ n: 9 });
    app.run(`generateMatchForCourt(1)`);
    for (let g = 0; g < 6; g++) {
      assert.equal(app.run(`forcedGroupMix(getFreeWaiting(), 4)`), null, '9 players: never the forced case');
      finish(app, 1); app.run(`generateMatchForCourt(1)`);
    }
  });
});

test('locked partners are never split across the mixed game and the next one', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { app } = oneCourtNight({ n: 8, locks: [[1, 2], [5, 6]] }, 16, seed);
    const hist = JSON.parse(app.run(`JSON.stringify(gameHistory.map(g=>[...g.team1Ids,...g.team2Ids]))`));
    for (const ids of hist) {
      assert.equal(ids.includes(1), ids.includes(2), `seed ${seed}: 1 and 2 play together: ${ids}`);
      assert.equal(ids.includes(5), ids.includes(6), `seed ${seed}: 5 and 6 play together: ${ids}`);
    }
  }
});
