// _fbApplyRemote must not wipe scores the host is typing when a co-host's
// save lands between keystrokes. Both score fields per court are preserved
// (not just the focused one), keyed to the match so a value is never restored
// onto a different match, and a score the remote snapshot brought in wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const COURT = {
  id: 1, name: 'Court 1', round: 1, submitted: false, startedAt: 1700000000000,
  score1: '', score2: '', team1: ['p1', 'p2'], team2: ['p3', 'p4'],
};
const PLAYERS = [
  { id: 'p1', name: 'Ana', present: true }, { id: 'p2', name: 'Ben', present: true },
  { id: 'p3', name: 'Cai', present: true }, { id: 'p4', name: 'Dee', present: true },
];

function liveSnap(over = {}) {
  return snap({
    players: PLAYERS,
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [COURT],
    ...over,
  });
}

function apply(app, s) {
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(s)});`);
}

test('both typed scores survive a remote snapshot without scores', () => {
  const app = loadApp();
  apply(app, liveSnap());
  // Owner types both scores; only the second field would be "focused"
  app.run(`document.getElementById('score1_1').value = '11'; updateScore(1);`);
  app.run(`document.getElementById('score2_1').value = '7'; updateScore(1);`);
  // Co-host action saves state (their local courts carry no typed scores)
  apply(app, liveSnap());
  assert.equal(app.els['score1_1'].value, '11', 'first typed score must survive');
  assert.equal(app.els['score2_1'].value, '7', 'second typed score must survive');
  assert.equal(app.run(`courts.find(c => c.id === 1).score1`), '11', 'state mirror kept in sync');
});

test('typed score survives while the other field is still empty', () => {
  const app = loadApp();
  apply(app, liveSnap());
  app.run(`document.getElementById('score1_1').value = '9'; updateScore(1);`);
  apply(app, liveSnap());
  assert.equal(app.els['score1_1'].value, '9');
  assert.equal(app.els['score2_1'].value, '');
});

test('a score brought in by the remote snapshot wins over the local draft', () => {
  const app = loadApp();
  apply(app, liveSnap());
  app.run(`document.getElementById('score1_1').value = '11'; updateScore(1);`);
  // Co-host typed their own score1 and saved
  apply(app, liveSnap({ courts: [{ ...COURT, score1: '9' }] }));
  assert.equal(app.els['score1_1'].value, '9', 'remote score must win');
});

test('typed scores are not restored onto a different match on the same court', () => {
  const app = loadApp();
  apply(app, liveSnap());
  app.run(`document.getElementById('score1_1').value = '11'; updateScore(1);`);
  // Co-host cancelled and re-seated the court with different teams
  apply(app, liveSnap({ courts: [{ ...COURT, team1: ['p1', 'p3'], team2: ['p2', 'p4'] }] }));
  assert.equal(app.els['score1_1'].value, '', 'stale score must not leak onto a new match');
});

test('typed scores are not restored onto a court the remote submitted', () => {
  const app = loadApp();
  apply(app, liveSnap());
  app.run(`document.getElementById('score1_1').value = '11'; updateScore(1);`);
  apply(app, liveSnap({ courts: [{ ...COURT, submitted: true, score1: 9, score2: 11 }] }));
  assert.equal(app.run(`courts.find(c => c.id === 1).score1`), 9, 'submitted result must stand');
});
