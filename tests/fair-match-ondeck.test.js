// Numbering pre-builds at most ONE on-deck match (depth 3 re-creates repeats).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id) => ({
  id, name: 'p' + id, present: true, gamesPlayed: 0, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate',
});

test('random mode builds at most 1 on-deck match', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: Array.from({length:16}, (_,i)=>P(i+1)),   // 16 free -> could fill 3
    queueOrder: Array.from({length:16}, (_,i)=>i+1),
    courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  app.run(`rebuildMatchQueue();`);
  const n = app.run(`matchQueue.length`);
  assert.equal(n, 1, 'Numbering keeps a single on-deck preview');
});

test('waittime mode still builds up to 3', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'waittime', format: 'doubles' },
    players: Array.from({length:16}, (_,i)=>P(i+1)),
    queueOrder: Array.from({length:16}, (_,i)=>i+1),
    courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  app.run(`rebuildMatchQueue();`);
  const n = app.run(`matchQueue.length`);
  assert.equal(n, 3, 'other modes unchanged');
});
