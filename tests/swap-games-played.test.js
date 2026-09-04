// Every candidate in the swap modal shows games played this session. Picking a
// substitute is a fairness call, so the count has to be on the chip -- the admin
// was otherwise leaving the modal to cross-check the Waiting Queue panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id, gamesPlayed) => ({
  id, name: 'P' + id, present: true, gamesPlayed, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate',
});

// 4 players on one court, 4 waiting with differing game counts.
function session() {
  const app = loadApp();
  app.run(`window._uid='owner1';`);
  const players = [P(1,3), P(2,3), P(3,2), P(4,2), P(5,0), P(6,1), P(7,5), P(8,2)];
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players, playerIdCounter: 8,
    queueOrder: [5, 6, 7, 8],
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [{ id: 1, name: 'Court 1', round: 1, submitted: false, startedAt: 1700000000000,
               score1: '', score2: '', team1: [1, 2], team2: [3, 4] }],
    courtIdCounter: 1,
  }))});`);
  app.run(`document.getElementById('swapOptions');`);
  app.els.swapOptions.children = [];
  return app;
}

const html = app => app.run(`document.getElementById('swapOptions').innerHTML`);
// chip id -> games-played badge text, in render order
const badges = app => [...html(app).matchAll(/confirmSwap\((\d+)\)"><span class="swap-name">[^]*?<\/span><span class="swap-gp"[^>]*>(\d+)G</g)]
  .map(m => [Number(m[1]), Number(m[2])]);

test('waiting-queue candidates show their games played', () => {
  const app = session();
  app.run(`openSwapModal(1,'team1',0);`);   // sub out P1
  const seen = Object.fromEntries(badges(app));
  // the four waiting players, with the counts they were given
  assert.equal(seen[5], 0);
  assert.equal(seen[6], 1);
  assert.equal(seen[7], 5);
  assert.equal(seen[8], 2);
});

test('a player who has not played yet reads 0G rather than being left blank', () => {
  const app = session();
  app.run(`openSwapModal(1,'team1',0);`);
  assert.match(html(app), /confirmSwap\(5\)[^]*?swap-gp[^>]*>0G</);
});

test('same-court trade and other-court candidates carry the count too', () => {
  const app = loadApp();
  app.run(`window._uid='owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: [P(1,3), P(2,3), P(3,2), P(4,2), P(5,7), P(6,7), P(7,1), P(8,1)],
    playerIdCounter: 8, queueOrder: [],
    courtDefs: [{ id: 1, name: 'Court 1' }, { id: 2, name: 'Court 2' }],
    courts: [
      { id: 1, name: 'Court 1', round: 1, submitted: false, startedAt: 1, score1:'', score2:'', team1: [1,2], team2: [3,4] },
      { id: 2, name: 'Court 2', round: 1, submitted: false, startedAt: 1, score1:'', score2:'', team1: [5,6], team2: [7,8] },
    ],
    courtIdCounter: 2,
  }))});`);
  app.run(`document.getElementById('swapOptions');`);
  app.els.swapOptions.children = [];
  app.run(`openSwapModal(1,'team1',0);`);
  const seen = Object.fromEntries(badges(app));
  assert.equal(seen[3], 2, 'trade-sides candidate on the same court');
  assert.equal(seen[5], 7, 'candidate on another court');
});

test('the games count does not answer a name search', () => {
  const app = session();
  app.run(`openSwapModal(1,'team1',0);`);
  // Fake DOM: give filterSwapOptions real children carrying a .swap-name.
  const mk = (name, gp) => ({
    style: {},
    classList: { contains: c => c === 'swap-option' },
    textContent: `${name}${gp}G`,
    querySelector: sel => sel === '.swap-name' ? { textContent: name } : null,
  });
  const p5 = mk('P5', 0), p7 = mk('P7', 5);
  app.els.swapOptions.children = [p5, p7];
  app.els.swapSearch.value = '5';
  app.run(`filterSwapOptions();`);
  assert.equal(p5.style.display, '', 'P5 matches the name "5"');
  assert.equal(p7.style.display, 'none', 'P7 must NOT match just because it has 5 games');
});

// --- Manual pick modal -------------------------------------------------------
// Same fairness call as the swap modal: choosing who starts the next match.

function manualSession() {
  const app = loadApp();
  app.run(`window._uid='owner1';`);
  const players = [P(1,3), P(2,3), P(3,2), P(4,2), P(5,0), P(6,1), P(7,5), P(8,2)];
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'manual', format: 'doubles' },
    players, playerIdCounter: 8,
    queueOrder: [1, 2, 3, 4, 5, 6, 7, 8],
    courtDefs: [{ id: 1, name: 'Court 1' }],
    courts: [], courtIdCounter: 1,
  }))});`);
  return app;
}

const manualHtml = app => app.run(`document.getElementById('manualOptions').innerHTML`);
const manualBadges = app => [...manualHtml(app).matchAll(
  /toggleManualPlayer\((\d+)\)"[^]*?manual-chip-gp"[^>]*>(\d+)G</g)].map(m => [Number(m[1]), Number(m[2])]);

test('manual pick chips show games played', () => {
  const app = manualSession();
  app.run(`openManualPick(1);`);
  assert.deepEqual(Object.fromEntries(manualBadges(app)),
    { 1: 3, 2: 3, 3: 2, 4: 2, 5: 0, 6: 1, 7: 5, 8: 2 });
});

test('manual pick keeps the count when a player is selected into a team', () => {
  const app = manualSession();
  app.run(`openManualPick(1); toggleManualPlayer(5);`);
  const chip = manualHtml(app).match(/<button class="manual-chip on"[^]*?<\/button>/)[0];
  assert.match(chip, /manual-chip-gp"[^>]*>0G</, 'selected chip keeps its games count');
  assert.match(chip, /manual-chip-slot">A</, 'and still shows its A/B slot');
});
