import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

// Regression: on a fresh session with ZERO players, renderPlayers() used to
// early-return before calling renderCheckinPanel(), so the check-in link box
// stayed stuck on "Generating..." until the first player was added.
test('check-in link renders even when the player list is empty', () => {
  const app = loadApp();
  app.windowMock.checkinUrl = () => 'https://x.test/pickleball/checkin.html?session=s1';
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap())});`); // players: {_empty:true}
  assert.equal(
    app.els['checkinLinkDisplay'].textContent,
    'https://x.test/pickleball/checkin.html?session=s1'
  );
});

test('check-in link still renders with players present', () => {
  const app = loadApp();
  app.windowMock.checkinUrl = () => 'https://x.test/pickleball/checkin.html?session=s1';
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    players: [{ id: 1, name: 'Eve', present: true, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate', via: 'manual' }],
  }))});`);
  assert.equal(
    app.els['checkinLinkDisplay'].textContent,
    'https://x.test/pickleball/checkin.html?session=s1'
  );
});
