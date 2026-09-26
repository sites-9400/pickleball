// Organizer request: tap a name in the Queue to see that player's games played,
// skill level and wins / losses without leaving the Live tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id, name, over = {}) => ({
  id, name, present: true, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0,
  lastPlayedRound: -1, skill: 'intermediate', events: [], ...over,
});

function app() {
  const a = loadApp();
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'waittime', format: 'doubles' },
    players: [P(1, 'Ana', { gamesPlayed: 5, wins: 3, losses: 2, skill: 'advanced' }), P(2, 'Ben')],
    queueOrder: [1, 2],
  }))});`);
  return a;
}

test('queue names open the player profile', () => {
  const a = app();
  a.run('renderQueue()');
  assert.match(a.captured['queueList'], /class="queue-item[^"]*"[^>]*onclick="openProfile\(1\)"/);
});

test('profile shows games played, skill, wins and losses', () => {
  const a = app();
  a.run(`document.getElementById('profileOverlay').classList.add('hidden')`); // as in the page
  a.run('openProfile(1)');
  assert.equal(a.els['profileName'].textContent, 'Ana');
  assert.equal(a.els['profileSkill'].textContent, 'Advanced');
  const body = a.captured['profileStats'];
  for (const [val, label] of [[5, 'Games'], [3, 'Wins'], [2, 'Losses']]) {
    assert.match(body, new RegExp(`<div class="stat-val">${val}</div><div class="stat-label">${label}</div>`));
  }
  assert.equal(a.els['profileOverlay'].classList.contains('hidden'), false, 'modal opened');
});

test('player with no games yet shows zeros, not blanks', () => {
  const a = app();
  a.run('openProfile(2)');
  assert.match(a.captured['profileStats'], /<div class="stat-val">0<\/div><div class="stat-label">Games<\/div>/);
  assert.equal(a.els['profileSkill'].textContent, 'Intermediate');
});
