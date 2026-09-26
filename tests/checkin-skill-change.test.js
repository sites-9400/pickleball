// Organizer request: on the QR check-in list a player's level (Intermediate by default,
// e.g. after importing a previous roster) must be changeable. The chosen level travels
// with the check-in and updates the existing player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, snap } from './apphtml-harness.mjs';
import { checkinToPlayer } from '../tournament.js';

const P = (id, name, skill = 'intermediate', present = false) => ({
  id, name, present, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0,
  lastPlayedRound: -1, skill, events: [],
});

test('checkinToPlayer passes a valid level through for an existing player', () => {
  const ex = [P(1, 'Ana')];
  assert.deepEqual(checkinToPlayer({ name: 'ana', skill: 'advanced' }, ex), { markPresentName: 'Ana', skill: 'advanced' });
  assert.deepEqual(checkinToPlayer({ name: 'Ana', skill: 'bogus' }, ex), { markPresentName: 'Ana' }, 'invalid level ignored');
});

function app() {
  const a = loadApp();
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'waittime', format: 'doubles' },
    players: [P(1, 'Ana'), P(2, 'Ben', 'beginner')], queueOrder: [],
  }))});`);
  return a;
}

test('QR check-in of a listed player updates their level', () => {
  const a = app();
  a.run(`window._importCheckin('k1', { name: 'Ana', skill: 'advanced', ts: Date.now() })`);
  assert.equal(a.run(`getPlayer(1).skill`), 'advanced');
  assert.equal(a.run(`getPlayer(1).present`), true);
});

test('same level: nothing else changes', () => {
  const a = app();
  a.run(`window._importCheckin('k2', { name: 'Ben', skill: 'beginner', ts: Date.now() })`);
  assert.equal(a.run(`getPlayer(2).skill`), 'beginner');
});

test('check-in page offers level buttons on a selected row and sends the chosen level', () => {
  const html = readFileSync(new URL('../checkin.html', import.meta.url), 'utf8');
  assert.match(html, /class="lvl/);
  assert.match(html, /chosenSkill/);
});
