// 1 court with too few players to reserve a match (5-7 doubles, 3 singles): the next
// match is drawn when the court frees, from everyone who sat plus the group that just
// came off. That whole group has wait 0, so the wait weight could not tell them apart:
// one player stayed on 16 games running at 5 players and games played drifted 4-6
// apart. smallPoolRotation(): everyone who sat plays; the longest run on court sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function night({ n, matchmaking = 'random', format = 'doubles', courts = 1, games = 20, seed = 1 }) {
  const real = Math.random;
  Math.random = lcg(seed * 7919 + 17);
  try {
    const app = loadApp();
    const players = [...Array(n)].map((_, i) => ({
      id: i + 1, name: 'P' + (i + 1), present: true, gamesPlayed: 0, wins: 0, losses: 0,
      points: 0, pointsAgainst: 0, lastPlayedRound: -1,
      skill: ['beginner', 'intermediate', 'advanced'][i % 3], events: [], partnerId: null,
    }));
    app.run(`window._uid = 'owner1';`);
    app.run(`window._fbApplyRemote(${JSON.stringify(snap({
      mode: { matchmaking, format }, players,
      courtDefs: [...Array(courts)].map((_, i) => ({ id: i + 1, name: 'Court ' + (i + 1) })),
      queueOrder: players.map(p => p.id), playerIdCounter: n, courtIdCounter: courts,
    }))});`);
    const seq = {}; for (let i = 1; i <= n; i++) seq[i] = '';
    // count picks the rotation actually decided (wrap the real function)
    app.run(`var __rot=[]; const __r=smallPoolRotation; smallPoolRotation=(...a)=>{ const x=__r(...a); __rot.push(x!==null); return x; };`);
    app.run(`generateMatchForCourt(1)`);
    for (let g = 0; g < games; g++) {
      const on = JSON.parse(app.run(`JSON.stringify([...courts[0].team1,...courts[0].team2])`));
      for (let i = 1; i <= n; i++) seq[i] += on.includes(i) ? 'P' : 'S';
      app.run(`document.getElementById('score1_1').value='11'; document.getElementById('score2_1').value='3'; submitScore(1); generateMatchForCourt(1);`);
    }
    const gp = JSON.parse(app.run(`JSON.stringify(players.map(p=>p.gamesPlayed))`));
    const rotations = JSON.parse(app.run('JSON.stringify(__rot)'));
    return { seq, gp, rotations };
  } finally { Math.random = real; }
}
const maxRun = (seq, ch) => Math.max(...Object.values(seq).map(s =>
  Math.max(0, ...s.split(ch === 'P' ? 'S' : 'P').map(x => x.length))));
const spread = gp => Math.max(...gp) - Math.min(...gp);

for (const matchmaking of ['random', 'balanced']) {
  for (const seed of [1, 2, 3, 10]) {
    test(`${matchmaking} 1 court + 5 (seed ${seed}): everyone sits in turn`, () => {
      const { seq, gp } = night({ n: 5, matchmaking, seed });
      // 4 of 5 play every game, so 4 in a row is the least possible; baseline reached 16
      assert.ok(maxRun(seq, 'P') <= 4, `max play run ${maxRun(seq, 'P')}`);
      assert.equal(maxRun(seq, 'S'), 1, 'nobody sits twice in a row');
      assert.ok(spread(gp) <= 1, `games played ${gp}`);
    });
    test(`${matchmaking} 1 court + 6 and + 7 (seed ${seed}): at most 2 in a row, tight spread`, () => {
      for (const n of [6, 7]) {
        const { seq, gp } = night({ n, matchmaking, seed });
        assert.ok(maxRun(seq, 'P') <= 2, `${n} players: max play run ${maxRun(seq, 'P')}`);
        assert.ok(maxRun(seq, 'S') <= 2, `${n} players: max sit run ${maxRun(seq, 'S')}`);
        assert.ok(spread(gp) <= 2, `${n} players: games played ${gp}`);
      }
    });
  }
  test(`${matchmaking} singles 1 court + 3: at most 2 in a row`, () => {
    const { seq, gp } = night({ n: 3, matchmaking, format: 'singles' });
    assert.ok(maxRun(seq, 'P') <= 2 && spread(gp) <= 1, `run ${maxRun(seq, 'P')} gp ${gp}`);
  });
}

test('the player who sat always plays the next game (1 court + 7)', () => {
  const { seq } = night({ n: 7, games: 30 });
  for (const s of Object.values(seq)) assert.doesNotMatch(s.slice(1), /SSS/);
  const { rotations } = night({ n: 7, games: 10 });
  assert.ok(rotations.filter(Boolean).length >= 9, 'the rotation decides every pick after the first game');
});

test('not used where a match can be reserved, at 2+ courts, or when the pick is forced', () => {
  // 1 court + 9: a match is always reserved, the court never frees with an empty queue
  assert.ok(!night({ n: 9, games: 10 }).rotations.some(Boolean));
  // 1 court + 4 doubles: everyone plays every game, nothing to decide
  assert.ok(!night({ n: 4, games: 6 }).rotations.some(Boolean));
  // 2 courts: out of scope (see report); normal draw
  const app = loadApp();
  app.run(`window._uid='owner1'; window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: [...Array(10)].map((_, i) => ({ id: i + 1, name: 'P' + (i + 1), present: true, gamesPlayed: 0,
      wins: 0, losses: 0, points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate', events: [] })),
    courtDefs: [{ id: 1, name: 'Court 1' }, { id: 2, name: 'Court 2' }], queueOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  }))});`);
  app.run(`generateMatchForCourt(1); generateMatchForCourt(2);
    document.getElementById('score1_1').value='11'; document.getElementById('score2_1').value='2'; submitScore(1);`);
  assert.equal(app.run(`smallPoolRotation(getFreeWaiting(), 4)`), null);
});
