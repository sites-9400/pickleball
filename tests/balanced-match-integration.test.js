// Balanced doubles chooseMatchPlayers must route through balancedMatch: with exactly
// 4 free players, all same skill, and a heavily-repeated partnership in history, it
// must split that pair (skill ties -> repeat tiebreak). The pair chosen (1 & 4) is
// the one the OLD skill-snake would re-pair (team1=[1,4]), so this fails on old code
// and passes only once routed through balancedMatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id) => ({
  id, name: 'p' + id, present: true, gamesPlayed: 2, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: 1, skill: 'intermediate',
});

test('balanced mode chooseMatchPlayers uses anti-repeat split', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'balanced', format: 'doubles' },
    players: [1,2,3,4].map(P),
    queueOrder: [1,2,3,4],
    globalRound: 5,
    courtDefs: [{ id: 1, name: 'Court 1' }],
    // history: players 1 & 4 partnered repeatedly -> must be split. (The old
    // skill-snake would re-pair them as team1=[1,4], ignoring history.)
    gameHistory: Array.from({length:4}, (_,i)=>({
      round: i+1, court: 1, courtName: 'Court 1',
      team1: ['p1','p4'], team2: ['p2','p3'],
      team1Ids: [1,4], team2Ids: [2,3], score1: 11, score2: 5,
    })),
  }))});`);
  // _fbApplyRemote already auto-built matchQueue from these same 4 free players
  // (rebuildMatchQueue -> chooseMatchPlayers), draining the pool. Clear it so this
  // direct call exercises chooseMatchPlayers() on a fresh pool.
  app.run(`matchQueue = [];`);
  const m = app.run(`JSON.stringify(chooseMatchPlayers())`);
  const { team1, team2 } = JSON.parse(m);
  const together = (team1.includes(1) && team1.includes(4)) ||
                   (team2.includes(1) && team2.includes(4));
  assert.equal(together, false, '1 & 4 partnered repeatedly -> must not be paired again');
  assert.equal([...team1, ...team2].sort().join(','), '1,2,3,4');
});
