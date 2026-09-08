// The fixed "Up Next" match is shown for Numbering/Balanced from 3 courts up (it used
// to need 4). Measured at 3 courts: free at 24+ players, a modest variety cost at 18-20,
// and genuinely degenerate at 16 where 3 courts + a reserved match consume everyone.
// view.html mirrors the rule, so the viewer board matches the admin board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, snap } from './apphtml-harness.mjs';

function appWith(nCourts, matchmaking = 'random') {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking, format: 'doubles' },
    courtDefs: [...Array(nCourts)].map((_, i) => ({ id: i + 1, name: 'Court ' + (i + 1) })),
  }))});`);
  return app;
}

test('Up Next now shows from 3 courts, not 4', () => {
  assert.equal(appWith(3).run(`showUpNext()`), true, '3 courts shows Up Next');
  assert.equal(appWith(4).run(`showUpNext()`), true, '4 courts still shows it');
  assert.equal(appWith(5).run(`showUpNext()`), true, '5 courts still shows it');
});

test('Up Next stays hidden at 1-2 courts', () => {
  assert.equal(appWith(2).run(`showUpNext()`), false, 'two courts is too few to preview');
  assert.equal(appWith(1).run(`showUpNext()`), false);
});

test('the queue still reserves exactly one match for Numbering/Balanced', () => {
  // Reserving more than one at 3 courts would take 8 players out of the draw pool.
  const app = appWith(3);
  app.run(`
    players.length = 0; queueOrder.length = 0;
    for (let i = 1; i <= 24; i++) {
      players.push({id:'p'+i,name:'P'+i,present:true,gamesPlayed:0,wins:0,losses:0,
        points:0,pointsAgainst:0,lastPlayedRound:-1,skill:'intermediate',events:[],partnerId:null});
      queueOrder.push('p'+i);
    }
    rebuildMatchQueue();
  `);
  assert.equal(app.run(`matchQueue.length`), 1, 'exactly one match on deck');
});

test('view.html mirrors the 3-court rule', () => {
  const src = readFileSync(new URL('../view.html', import.meta.url), 'utf8');
  assert.match(src, /courtDefs\s*\|\|\s*\[\]\)\.length\s*<\s*3/,
    'view.html must hide Up Next below 3 courts, matching app.html');
});
